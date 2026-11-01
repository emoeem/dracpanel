// Package dnsprobe measures per-upstream DNS latency straight from the panel.
//
// sing-box does not expose upstream statistics, so each configured dns.servers
// entry is queried directly with a real DNS packet (UDP, TCP, TLS or DoH) and
// timed. Results are cached briefly so an open page cannot hammer upstreams.
package dnsprobe

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

// Server is one dns.servers[] entry that can be probed over the network.
type Server struct {
	Tag    string
	Type   string
	Address string // host (no port)
	Port   int
	Path   string // DoH path
}

// Result is one probe outcome.
type Result struct {
	Tag       string `json:"tag"`
	Type      string `json:"type"`
	Server    string `json:"server"`
	OK        bool   `json:"ok"`
	ElapsedMs int64  `json:"elapsed_ms"`
	Error     string `json:"error,omitempty"`
}

const (
	cacheTTL    = 30 * time.Second
	probeDomain = "www.gstatic.com"
)

// ParseServers extracts the probed-capable upstreams from a sing-box config.
// Hosts/local/legacy entries are skipped: they answer without a network round
// trip, so a latency figure for them would be meaningless.
func ParseServers(cfg *jsonx.OrderMap) []Server {
	value, ok := cfg.Get("dns")
	if !ok {
		return nil
	}
	dns, ok := value.(*jsonx.OrderMap)
	if !ok {
		return nil
	}
	value, ok = dns.Get("servers")
	if !ok {
		return nil
	}
	entries, ok := value.([]jsonx.Value)
	if !ok {
		return nil
	}
	servers := make([]Server, 0, len(entries))
	for _, item := range entries {
		obj, ok := item.(*jsonx.OrderMap)
		if !ok {
			continue
		}
		server := Server{
			Tag:  stringField(obj, "tag"),
			Type: strings.ToLower(stringField(obj, "type")),
			Path: stringField(obj, "path"),
		}
		address, port := splitAddress(stringField(obj, "server"))
		if address == "" {
			continue
		}
		if override := intField(obj, "server_port"); override > 0 {
			port = override
		}
		server.Address = address
		server.Port = port
		if server.Port == 0 {
			server.Port = defaultPort(server.Type)
		}
		switch server.Type {
		case "udp", "tcp", "tls", "https", "h3", "quic":
		default:
			continue
		}
		if server.Tag == "" {
			server.Tag = server.Address
		}
		servers = append(servers, server)
	}
	return servers
}

func defaultPort(typ string) int {
	switch typ {
	case "tls":
		return 853
	case "https", "h3":
		return 443
	case "quic":
		return 853
	default:
		return 53
	}
}

func splitAddress(raw string) (string, int) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", 0
	}
	// Strip a URL scheme the config may have left in the server field.
	if idx := strings.Index(trimmed, "://"); idx >= 0 {
		trimmed = trimmed[idx+3:]
	}
	if idx := strings.IndexByte(trimmed, '/'); idx >= 0 {
		trimmed = trimmed[:idx]
	}
	if host, portText, err := net.SplitHostPort(trimmed); err == nil {
		port := 0
		fmt.Sscanf(portText, "%d", &port)
		return host, port
	}
	return trimmed, 0
}

func stringField(obj *jsonx.OrderMap, key string) string {
	value, ok := obj.Get(key)
	if !ok {
		return ""
	}
	text, _ := value.(string)
	return text
}

func intField(obj *jsonx.OrderMap, key string) int {
	value, ok := obj.Get(key)
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	}
	return 0
}

// Prober runs the probes with a short result cache.
type Prober struct {
	mu       sync.Mutex
	results  []Result
	cachedAt time.Time
	timeout  time.Duration
}

func New() *Prober {
	return &Prober{timeout: 2 * time.Second}
}

// Probe queries every server concurrently and returns the results. A cached
// result younger than 30s is returned unless force is set.
func (p *Prober) Probe(servers []Server, force bool) []Result {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !force && !p.cachedAt.IsZero() && time.Since(p.cachedAt) < cacheTTL {
		return p.results
	}
	results := make([]Result, len(servers))
	var wg sync.WaitGroup
	for index, server := range servers {
		wg.Add(1)
		go func(index int, server Server) {
			defer wg.Done()
			results[index] = p.probe(server)
		}(index, server)
	}
	wg.Wait()
	p.results = results
	p.cachedAt = time.Now()
	return results
}

func (p *Prober) probe(server Server) Result {
	result := Result{
		Tag:    server.Tag,
		Type:   server.Type,
		Server: net.JoinHostPort(server.Address, fmt.Sprintf("%d", server.Port)),
	}
	started := time.Now()
	err := p.roundTrip(server)
	result.ElapsedMs = time.Since(started).Milliseconds()
	if err != nil {
		result.Error = err.Error()
		if result.Error == "" {
			result.Error = "查询失败"
		}
		return result
	}
	result.OK = true
	return result
}

func (p *Prober) roundTrip(server Server) error {
	query := buildQuery(probeDomain)
	address := net.JoinHostPort(server.Address, fmt.Sprintf("%d", server.Port))
	switch server.Type {
	case "udp", "quic":
		return udpQuery(address, query, p.timeout)
	case "tcp":
		return tcpQuery(address, query, p.timeout, nil)
	case "tls":
		return tcpQuery(address, query, p.timeout, &tls.Config{ServerName: server.Address})
	case "https", "h3":
		return dohQuery(server, query, p.timeout)
	default:
		return fmt.Errorf("不支持的上游类型 %q", server.Type)
	}
}

func udpQuery(address string, query []byte, timeout time.Duration) error {
	conn, err := net.DialTimeout("udp", address, timeout)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		return err
	}
	if _, err := conn.Write(query); err != nil {
		return err
	}
	buf := make([]byte, 512)
	n, err := conn.Read(buf)
	if err != nil {
		return err
	}
	return checkResponse(buf[:n])
}

func tcpQuery(address string, query []byte, timeout time.Duration, config *tls.Config) error {
	dialer := &net.Dialer{Timeout: timeout}
	var conn net.Conn
	var err error
	if config != nil {
		conn, err = tls.DialWithDialer(dialer, "tcp", address, config)
	} else {
		conn, err = dialer.Dial("tcp", address)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		return err
	}
	framed := make([]byte, 2+len(query))
	binary.BigEndian.PutUint16(framed, uint16(len(query)))
	copy(framed[2:], query)
	if _, err := conn.Write(framed); err != nil {
		return err
	}
	length := make([]byte, 2)
	if _, err := io.ReadFull(conn, length); err != nil {
		return err
	}
	body := make([]byte, binary.BigEndian.Uint16(length))
	if _, err := io.ReadFull(conn, body); err != nil {
		return err
	}
	return checkResponse(body)
}

func dohQuery(server Server, query []byte, timeout time.Duration) error {
	path := server.Path
	if path == "" {
		path = "/dns-query"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	url := fmt.Sprintf("https://%s%s", net.JoinHostPort(server.Address, fmt.Sprintf("%d", server.Port)), path)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(query))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/dns-message")
	request.Header.Set("Accept", "application/dns-message")
	client := &http.Client{Timeout: timeout}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("DoH 返回 HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		return err
	}
	return checkResponse(body)
}

// buildQuery encodes a minimal A-record query packet.
func buildQuery(domain string) []byte {
	packet := make([]byte, 12)
	binary.BigEndian.PutUint16(packet[0:2], randomID())
	packet[2] = 0x01 // RD (recursion desired)
	packet[5] = 0x01 // QDCOUNT = 1
	for _, label := range strings.Split(domain, ".") {
		packet = append(packet, byte(len(label)))
		packet = append(packet, label...)
	}
	packet = append(packet, 0x00)       // end of QNAME
	packet = append(packet, 0x00, 0x01) // QTYPE  A
	packet = append(packet, 0x00, 0x01) // QCLASS IN
	return packet
}

func randomID() uint16 {
	buf := make([]byte, 2)
	if _, err := rand.Read(buf); err != nil {
		return 1
	}
	return binary.BigEndian.Uint16(buf)
}

func checkResponse(packet []byte) error {
	if len(packet) < 12 {
		return errors.New("响应过短")
	}
	if binary.BigEndian.Uint16(packet[0:2]) == 0 && packet[3] == 0 {
		return errors.New("响应无效")
	}
	rcode := packet[3] & 0x0f
	switch rcode {
	case 0: // NOERROR
		return nil
	case 3: // NXDOMAIN — the server answered; latency is still valid
		return nil
	default:
		return fmt.Errorf("上游返回 RCODE %d", rcode)
	}
}
