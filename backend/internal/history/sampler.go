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
	sp.mu.Lock()
	defer sp.mu.Unlock()
	return sp.cpuPercent
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
func (sp *Sampler) pollTraffic() (uint64, uint64, bool) {
	body, ok := sp.clashGet("/traffic")
	if !ok {
		return 0, 0, false
	}
	var parsed struct {
		Up   uint64 `json:"up"`
		Down uint64 `json:"down"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return 0, 0, false
	}
	return parsed.Up, parsed.Down, true
}

type clashConnection struct {
	ID            string   `json:"id"`
	UploadTotal   uint64   `json:"uploadTotal"`
	DownloadTotal uint64   `json:"downloadTotal"`
	Chains        []string `json:"chains"`
}

// pollConnections accumulates download totals per exit outbound (the last
// chain entry is the exit). Deltas are computed against the previous
// snapshot so restarts of the Clash counter do not corrupt totals.
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
		seen[conn.ID] = conn.DownloadTotal
		sp.mu.Lock()
		prev, watched := sp.outSeen[conn.ID]
		switch {
		case watched && conn.DownloadTotal >= prev:
			sp.outTotals[tag] += conn.DownloadTotal - prev
		case !watched:
			sp.outTotals[tag] += conn.DownloadTotal
		}
		sp.mu.Unlock()
	}
	sp.mu.Lock()
	sp.outSeen = seen
	sp.mu.Unlock()
}

func exitTag(conn clashConnection) string {
	if len(conn.Chains) > 0 {
		return conn.Chains[len(conn.Chains)-1]
	}
	return ""
}

func (sp *Sampler) clashGet(path string) ([]byte, bool) {
	base := strings.TrimRight(sp.S.String("clash_api"), "/")
	req, err := http.NewRequest(http.MethodGet, base+path, nil)
	if err != nil {
		return nil, false
	}
	if secret := sp.S.ClashSecret(); secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := sp.client.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, false
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, false
	}
	return raw, true
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
}
