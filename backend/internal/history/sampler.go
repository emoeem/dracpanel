// The sampler polls the Clash API and feeds the history store: per-second
// /traffic aggregated into per-minute buckets, /connections deltas for
// per-outbound download totals, /proc/stat for CPU. Skipped silently while
// the Clash API is unreachable (the chart shows a gap, not fake zeros).
package history

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/settings"
)

// Sampler runs the collection loop.
type Sampler struct {
	S     *settings.Settings
	Store *Store

	mu          sync.Mutex
	minuteUp    uint64
	minuteDown  uint64
	minuteStart time.Time
	minuteOut   map[string]uint64
	outTotals   map[string]uint64
	outSeen     map[string]uint64
	cpuLast     cpuTimes
	cpuPercent  float64
	cpuSeen     bool

	client       *http.Client
	compactEvery time.Duration
	lastCompact  time.Time
	stop         chan struct{}
	once         sync.Once
}

type cpuTimes struct {
	idle  uint64
	total uint64
	valid bool
}

// NewSampler builds the loop (not started).
func NewSampler(s *settings.Settings, store *Store) *Sampler {
	return &Sampler{
		S:            s,
		Store:        store,
		outTotals:    map[string]uint64{},
		outSeen:      map[string]uint64{},
		minuteOut:    map[string]uint64{},
		client:       &http.Client{Timeout: 5 * time.Second},
		compactEvery: 6 * time.Hour,
		lastCompact:  time.Now(),
		stop:         make(chan struct{}),
	}
}

// CurrentCPU returns the latest instantaneous CPU percentage.
func (sp *Sampler) CurrentCPU() float64 {
	if sp == nil {
		return 0
	}
	sp.mu.Lock()
	defer sp.mu.Unlock()
	return sp.cpuPercent
}

// Ready reports whether at least one CPU sample has been taken, so callers can
// tell "not sampled yet" apart from a genuine 0%.
func (sp *Sampler) Ready() bool {
	if sp == nil {
		return false
	}
	sp.mu.Lock()
	defer sp.mu.Unlock()
	return sp.cpuSeen
}

// Start launches the 1s collection goroutine. Dry-run never starts (no
// Clash guarantee, and tests would hit the network).
func (sp *Sampler) Start() {
	if sp.S.DryRun {
		return
	}
	go sp.loop()
}

// Stop terminates the loop.
func (sp *Sampler) Stop() {
	sp.once.Do(func() { close(sp.stop) })
}

func (sp *Sampler) loop() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-sp.stop:
			return
		case <-ticker.C:
			sp.tick()
		}
	}
}

func (sp *Sampler) tick() {
	now := time.Now()
	sp.mu.Lock()
	if sp.minuteStart.IsZero() {
		sp.minuteStart = now.Truncate(time.Minute)
	}
	sp.mu.Unlock()

	if up, down, ok := sp.pollTraffic(); ok {
		sp.mu.Lock()
		sp.minuteUp += up
		sp.minuteDown += down
		sp.mu.Unlock()
	}
	sp.sampleCPU()
	sp.pollConnections()
	sp.maybeRotate(now)
}

// maybeRotate flushes the closed minute bucket into the store.
func (sp *Sampler) maybeRotate(now time.Time) {
	sp.mu.Lock()
	bucket := now.Truncate(time.Minute)
	if bucket.Equal(sp.minuteStart) {
		sp.mu.Unlock()
		return
	}
	sample := Sample{
		T:    sp.minuteStart.Unix(),
		Up:   sp.minuteUp,
		Down: sp.minuteDown,
		CPU:  sp.cpuPercent,
	}
	// Per-minute outbound deltas: diff the totals snapshot against the
	// previous minute's so the JSONL holds per-minute (not cumulative) values.
	current := make(map[string]uint64, len(sp.outTotals))
	for tag, bytes := range sp.outTotals {
		current[tag] = bytes
	}
	previous := sp.minuteOut
	sp.minuteOut = current
	sp.minuteStart = bucket
	sp.minuteUp = 0
	sp.minuteDown = 0
	sp.mu.Unlock()

	if len(current) > 0 {
		out := map[string]uint64{}
		for tag, bytes := range current {
			if prev, ok := previous[tag]; ok {
				if bytes > prev {
					out[tag] = bytes - prev
				}
			} else {
				out[tag] = bytes
			}
		}
		sample.Out = out
	}
	sp.Store.Append(sample)

	if time.Since(sp.lastCompact) >= sp.compactEvery {
		sp.lastCompact = time.Now()
		sp.Store.Compact()
	}
}

// pollTraffic reads GET /traffic → {"up":bps,"down":bps} (bytes/s).
//
// /traffic is a streaming endpoint: it emits one object per second and never
// closes, so a whole-body read would block until the client timeout and lose
// the sample. Decoding one JSON value returns as soon as the first object is
// complete.
func (sp *Sampler) pollTraffic() (uint64, uint64, bool) {
	var parsed struct {
		Up   uint64 `json:"up"`
		Down uint64 `json:"down"`
	}
	if !sp.clashDecode("/traffic", &parsed) {
		return 0, 0, false
	}
	return parsed.Up, parsed.Down, true
}

type clashConnection struct {
	ID string `json:"id"`
	// sing-box/mihomo expose cumulative per-connection counters as
	// download/upload; the *Total names only appear on the envelope.
	Upload   uint64   `json:"upload"`
	Download uint64   `json:"download"`
	Chains   []string `json:"chains"`
}

// pollConnections accumulates download totals per exit outbound (chains[0] is
// the exit; the remaining entries are the groups it passed through). Deltas
// are computed against the previous snapshot so restarts of the Clash counter
// do not corrupt totals.
func (sp *Sampler) pollConnections() {
	body, ok := sp.clashGet("/connections")
	if !ok {
		return
	}
	var parsed struct {
		Connections []clashConnection `json:"connections"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return
	}
	seen := map[string]uint64{}
	for _, conn := range parsed.Connections {
		tag := exitTag(conn)
		if tag == "" {
			continue
		}
		seen[conn.ID] = conn.Download
		sp.mu.Lock()
		prev, watched := sp.outSeen[conn.ID]
		switch {
		case watched && conn.Download >= prev:
			sp.outTotals[tag] += conn.Download - prev
		case !watched:
			sp.outTotals[tag] += conn.Download
		}
		sp.mu.Unlock()
	}
	sp.mu.Lock()
	sp.outSeen = seen
	sp.mu.Unlock()
}

func exitTag(conn clashConnection) string {
	// Clash orders chains exit-first: ["node", "group", "group"...].
	if len(conn.Chains) > 0 {
		return conn.Chains[0]
	}
	return ""
}

func (sp *Sampler) clashGet(path string) ([]byte, bool) {
	resp, ok := sp.clashRequest(path)
	if !ok {
		return nil, false
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, false
	}
	return raw, true
}

// clashDecode reads exactly one JSON value, which is what streaming endpoints
// like /traffic need: the connection stays open, so reading to EOF blocks.
func (sp *Sampler) clashDecode(path string, target any) bool {
	resp, ok := sp.clashRequest(path)
	if !ok {
		return false
	}
	defer resp.Body.Close()
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(target) == nil
}

func (sp *Sampler) clashRequest(path string) (*http.Response, bool) {
	base := strings.TrimRight(sp.S.String("clash_api"), "/")
	req, err := http.NewRequest(http.MethodGet, base+path, nil)
	if err != nil {
		return nil, false
	}
	if secret := sp.S.ClashSecret(); secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := sp.client.Do(req)
	if err != nil || resp.StatusCode >= 400 {
		if resp != nil {
			resp.Body.Close()
		}
		return nil, false
	}
	return resp, true
}

// sampleCPU reads /proc/stat deltas (best-effort; 0 when unreadable).
func (sp *Sampler) sampleCPU() {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return
	}
	var total, idle uint64
	for i, field := range fields[1:] {
		n, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return
		}
		total += n
		if i == 3 || i == 4 { // idle + iowait
			idle += n
		}
	}
	sp.mu.Lock()
	defer sp.mu.Unlock()
	if sp.cpuLast.valid {
		dTotal := total - sp.cpuLast.total
		dIdle := idle - sp.cpuLast.idle
		if dTotal > 0 {
			sp.cpuPercent = float64(dTotal-dIdle) / float64(dTotal) * 100
			if sp.cpuPercent < 0 {
				sp.cpuPercent = 0
			}
		}
	}
	sp.cpuLast = cpuTimes{idle: idle, total: total, valid: true}
	sp.cpuSeen = true
}
