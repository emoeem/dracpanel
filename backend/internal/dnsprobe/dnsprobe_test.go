package dnsprobe

import (
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

func TestParseServersKeepsProbeableEntries(t *testing.T) {
	cfg, err := jsonx.ParseObject(`{
		"dns": {
			"servers": [
				{"type": "https", "tag": "dns_proxy", "server": "8.8.8.8", "path": "/dns-query"},
				{"type": "udp", "tag": "dns_direct", "server": "223.5.5.5"},
				{"type": "tls", "tag": "tls_up", "server": "1.1.1.1", "server_port": 853},
				{"type": "hosts", "tag": "hosts_local", "path": "/etc/hosts"},
				{"type": "udp", "tag": "with_port", "server": "9.9.9.9:5353"}
			]
		}
	}`)
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	servers := ParseServers(cfg)
	if len(servers) != 4 {
		t.Fatalf("expected 4 probeable servers, got %d: %+v", len(servers), servers)
	}
	byTag := map[string]Server{}
	for _, server := range servers {
		byTag[server.Tag] = server
	}
	if _, ok := byTag["hosts_local"]; ok {
		t.Errorf("hosts entries must be skipped")
	}
	if s := byTag["dns_proxy"]; s.Port != 443 || s.Path != "/dns-query" || s.Address != "8.8.8.8" {
		t.Errorf("dns_proxy = %+v", s)
	}
	if s := byTag["dns_direct"]; s.Port != 53 {
		t.Errorf("dns_direct port = %d", s.Port)
	}
	if s := byTag["tls_up"]; s.Port != 853 {
		t.Errorf("tls_up port = %d", s.Port)
	}
	if s := byTag["with_port"]; s.Port != 5353 || s.Address != "9.9.9.9" {
		t.Errorf("with_port = %+v", s)
	}
}

func TestParseServersOnMissingDNS(t *testing.T) {
	cfg, err := jsonx.ParseObject(`{"inbounds": []}`)
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	if servers := ParseServers(cfg); len(servers) != 0 {
		t.Errorf("expected no servers, got %+v", servers)
	}
}

func TestSplitAddress(t *testing.T) {
	cases := map[string]struct {
		host string
		port int
	}{
		"8.8.8.8":            {host: "8.8.8.8", port: 0},
		"8.8.8.8:53":         {host: "8.8.8.8", port: 53},
		"https://dns.google": {host: "dns.google", port: 0},
		"https://dns.google/dns-query": {host: "dns.google", port: 0},
		"[2001:db8::1]:853":  {host: "2001:db8::1", port: 853},
		"  1.1.1.1  ":        {host: "1.1.1.1", port: 0},
	}
	for input, want := range cases {
		host, port := splitAddress(input)
		if host != want.host || port != want.port {
			t.Errorf("splitAddress(%q) = (%q, %d), want (%q, %d)", input, host, port, want.host, want.port)
		}
	}
}

func TestBuildQueryEncodesName(t *testing.T) {
	packet := buildQuery("a.example.com")
	if len(packet) < 18 {
		t.Fatalf("packet too short: %d bytes", len(packet))
	}
	if packet[5] != 0x01 {
		t.Errorf("QDCOUNT = %d", packet[5])
	}
	// After the 12-byte header: 01 'a' 07 'example' 03 'com' 00 0001 0001
	offset := 12
	if packet[offset] != 1 || string(packet[offset+1:offset+2]) != "a" {
		t.Errorf("first label wrong: %v", packet[offset:offset+2])
	}
	if packet[len(packet)-1] != 0x01 {
		t.Errorf("QCLASS tail wrong")
	}
}

func TestProbeAgainstLocalUDPServer(t *testing.T) {
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer conn.Close()
	go func() {
		buf := make([]byte, 512)
		for {
			n, addr, err := conn.ReadFrom(buf)
			if err != nil {
				return
			}
			// Reply NOERROR with no answers, echoing the query id.
			reply := make([]byte, 12)
			copy(reply[0:2], buf[0:2])
			reply[2] = 0x81
			reply[3] = 0x80
			reply[5] = 0x01
			_, _ = conn.WriteTo(reply[:min(len(reply), n)], addr)
		}
	}()
	address := conn.LocalAddr().String()
	host, portText, _ := net.SplitHostPort(address)
	port := 0
	for _, ch := range portText {
		port = port*10 + int(ch-'0')
	}
	prober := New()
	prober.timeout = 500 * time.Millisecond
	results := prober.Probe([]Server{{Tag: "local", Type: "udp", Address: host, Port: port}}, true)
	if len(results) != 1 {
		t.Fatalf("results = %+v", results)
	}
	if !results[0].OK {
		t.Errorf("expected a successful probe, got %+v", results[0])
	}
	if results[0].ElapsedMs < 0 {
		t.Errorf("elapsed must not be negative")
	}
}

func TestProbeReportsUnreachableUpstream(t *testing.T) {
	// Port 1 on loopback refuses TCP; the probe must report an error, not hang.
	prober := New()
	prober.timeout = 300 * time.Millisecond
	results := prober.Probe([]Server{{Tag: "dead", Type: "tcp", Address: "127.0.0.1", Port: 1}}, true)
	if len(results) != 1 || results[0].OK {
		t.Fatalf("expected a failed probe, got %+v", results)
	}
	if strings.TrimSpace(results[0].Error) == "" {
		t.Errorf("expected an error message")
	}
}

func TestProbeCachesUntilForced(t *testing.T) {
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer conn.Close()
	var received int32
	go func() {
		buf := make([]byte, 512)
		for {
			n, addr, err := conn.ReadFrom(buf)
			if err != nil {
				return
			}
			atomic.AddInt32(&received, 1)
			reply := make([]byte, min(12, n))
			copy(reply[0:2], buf[0:2])
			reply[2] = 0x81
			reply[3] = 0x80
			_, _ = conn.WriteTo(reply, addr)
		}
	}()
	host, portText, _ := net.SplitHostPort(conn.LocalAddr().String())
	port := 0
	for _, ch := range portText {
		port = port*10 + int(ch-'0')
	}
	prober := New()
	prober.timeout = 500 * time.Millisecond
	servers := []Server{{Tag: "local", Type: "udp", Address: host, Port: port}}

	if first := prober.Probe(servers, false); len(first) != 1 || !first[0].OK {
		t.Fatalf("first probe failed: %+v", first)
	}
	time.Sleep(50 * time.Millisecond)
	if got := atomic.LoadInt32(&received); got != 1 {
		t.Fatalf("expected exactly 1 upstream query, got %d", got)
	}
	// Cached call must not touch the network.
	_ = prober.Probe(servers, false)
	time.Sleep(50 * time.Millisecond)
	if got := atomic.LoadInt32(&received); got != 1 {
		t.Errorf("cached probe reached the upstream: %d queries", got)
	}
	// Forced call must re-probe.
	_ = prober.Probe(servers, true)
	time.Sleep(50 * time.Millisecond)
	if got := atomic.LoadInt32(&received); got != 2 {
		t.Errorf("forced probe did not re-query: %d queries", got)
	}
}

func TestCheckResponseRejectsShortAndRcode(t *testing.T) {
	if err := checkResponse([]byte{0, 1}); err == nil {
		t.Errorf("short packet must fail")
	}
	packet := make([]byte, 12)
	packet[0] = 0x12
	packet[1] = 0x34
	packet[3] = 0x82 // SERVFAIL
	if err := checkResponse(packet); err == nil {
		t.Errorf("SERVFAIL must fail")
	}
	packet[3] = 0x80 // NOERROR
	if err := checkResponse(packet); err != nil {
		t.Errorf("NOERROR must pass: %v", err)
	}
	packet[3] = 0x83 // NXDOMAIN
	if err := checkResponse(packet); err != nil {
		t.Errorf("NXDOMAIN must still count as an answer: %v", err)
	}
}
