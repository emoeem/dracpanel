// Package history samples sing-box traffic through the Clash API and persists
// per-minute samples to disk, powering the doona-style observability cards
// (time-range traffic chart, per-outbound totals, CPU trend).
//
// Storage: <state_dir>/history.jsonl — one JSON object per line
// {"t":unix,"up":n,"down":n,"cpu":p,"out":{"tag":downBytes}}.
// Retention is 7 days; older lines are dropped on load and compaction.
package history

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

// Retention keeps one week of per-minute samples.
const Retention = 7 * 24 * time.Hour

// MaxSamples is the theoretical capacity (7 days × 1440).
const MaxSamples = 7 * 24 * 60

// Sample is one minute of traffic.
type Sample struct {
	T    int64             `json:"t"`
	Up   uint64            `json:"up"`
	Down uint64            `json:"down"`
	CPU  float64           `json:"cpu,omitempty"`
	Out  map[string]uint64 `json:"out,omitempty"`
}

// Store accumulates samples and owns the JSONL file.
type Store struct {
	mu      sync.Mutex
	path    string
	samples []Sample
	since   int64
	file    *os.File
}

// Load reads the JSONL file, dropping expired entries, and returns the store.
// A missing or corrupt file starts fresh.
func Load(stateDir string) *Store {
	path := filepath.Join(stateDir, "history.jsonl")
	st := &Store{path: path, since: time.Now().Unix()}
	raw, err := os.Open(path)
	if err == nil {
		defer raw.Close()
		cutoff := time.Now().Add(-Retention).Unix()
		scanner := bufio.NewScanner(raw)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			var sample Sample
			if err := json.Unmarshal(scanner.Bytes(), &sample); err != nil {
				continue
			}
			if sample.T < cutoff {
				continue
			}
			st.samples = append(st.samples, sample)
			if sample.T < st.since {
				st.since = sample.T
			}
		}
	}
	if len(st.samples) > MaxSamples {
		st.samples = append([]Sample(nil), st.samples[len(st.samples)-MaxSamples:]...)
	}
	return st
}

// Since returns the earliest retained sample timestamp (unix seconds).
func (st *Store) Since() int64 {
	st.mu.Lock()
	defer st.mu.Unlock()
	if len(st.samples) > 0 {
		return st.samples[0].T
	}
	return st.since
}

// Append records one minute sample and persists it.
func (st *Store) Append(sample Sample) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.samples = append(st.samples, sample)
	if len(st.samples) > MaxSamples {
		st.samples = st.samples[len(st.samples)-MaxSamples:]
	}
	st.persistLocked()
}

func (st *Store) persistLocked() {
	if st.file == nil {
		file, err := os.OpenFile(st.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return
		}
		st.file = file
	}
	raw, err := json.Marshal(st.samples[len(st.samples)-1])
	if err != nil {
		return
	}
	st.file.Write(append(raw, '\n'))
}

// Compact rewrites the file from memory (drop expired lines).
func (st *Store) Compact() {
	st.mu.Lock()
	defer st.mu.Unlock()
	tmp := st.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return
	}
	writer := bufio.NewWriter(file)
	for _, sample := range st.samples {
		raw, err := json.Marshal(sample)
		if err != nil {
			continue
		}
		writer.Write(raw)
		writer.WriteByte('\n')
	}
	writer.Flush()
	file.Close()
	if st.file != nil {
		st.file.Close()
		st.file = nil
	}
	_ = os.Rename(tmp, st.path)
}

// Point is a downsampled chart point.
type Point struct {
	T    int64             `json:"t"`
	Up   uint64            `json:"up"`
	Down uint64            `json:"down"`
	CPU  float64           `json:"cpu,omitempty"`
	Out  map[string]uint64 `json:"out,omitempty"`
}

// Summary carries the range statistics shown beside the chart.
type Summary struct {
	DownPeak uint64 `json:"down_peak"`
	DownAvg  uint64 `json:"down_avg"`
	UpPeak   uint64 `json:"up_peak"`
	UpAvg    uint64 `json:"up_avg"`
}

// RangeResult is the /api/history body.
type RangeResult struct {
	Range   string            `json:"range"`
	Bucket  int64             `json:"bucket"`
	Since   int64             `json:"since"`
	Points  []Point           `json:"points"`
	Summary Summary           `json:"summary"`
	Samples []*jsonx.OrderMap `json:"-"`
}

var rangeBuckets = map[string]int64{
	"10m": 60,
	"1h":  60,
	"6h":  300,
	"24h": 900,
	"7d":  3600,
}

var rangeWindows = map[string]time.Duration{
	"10m": 10 * time.Minute,
	"1h":  time.Hour,
	"6h":  6 * time.Hour,
	"24h": 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
}

// Range returns downsampled points plus summary for a named range.
// bucketSeconds ≤ 0 means "use the default for the range".
func (st *Store) Range(name string, bucketSeconds int64) RangeResult {
	st.mu.Lock()
	defer st.mu.Unlock()
	if bucketSeconds <= 0 {
		bucketSeconds = rangeBuckets[name]
	}
	if bucketSeconds <= 0 {
		bucketSeconds = 60
	}
	window, ok := rangeWindows[name]
	if !ok {
		window = time.Hour
		name = "1h"
	}
	cutoff := time.Now().Add(-window).Unix()

	var inRange []Sample
	for _, sample := range st.samples {
		if sample.T >= cutoff {
			inRange = append(inRange, sample)
		}
	}

	points := bucketize(inRange, bucketSeconds)
	summary := summarize(inRange)
	return RangeResult{
		Range:   name,
		Bucket:  bucketSeconds,
		Since:   st.sinceLocked(),
		Points:  points,
		Summary: summary,
	}
}

func (st *Store) sinceLocked() int64 {
	if len(st.samples) > 0 {
		return st.samples[0].T
	}
	return st.since
}

func bucketize(samples []Sample, bucket int64) []Point {
	if len(samples) == 0 {
		return nil
	}
	buckets := map[int64]*Point{}
	var keys []int64
	for _, sample := range samples {
		key := (sample.T / bucket) * bucket
		point, ok := buckets[key]
		if !ok {
			point = &Point{T: key}
			buckets[key] = point
			keys = append(keys, key)
		}
		point.Up += sample.Up
		point.Down += sample.Down
		if sample.CPU > point.CPU {
			point.CPU = sample.CPU
		}
		if len(sample.Out) > 0 {
			if point.Out == nil {
				point.Out = map[string]uint64{}
			}
			for tag, bytes := range sample.Out {
				point.Out[tag] += bytes
			}
		}
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	out := make([]Point, 0, len(keys))
	for _, key := range keys {
		out = append(out, *buckets[key])
	}
	return out
}

func summarize(samples []Sample) Summary {
	var downPeak, upPeak, downSum, upSum uint64
	for _, sample := range samples {
		if sample.Down > downPeak {
			downPeak = sample.Down
		}
		if sample.Up > upPeak {
			upPeak = sample.Up
		}
		downSum += sample.Down
		upSum += sample.Up
	}
	summary := Summary{DownPeak: downPeak, UpPeak: upPeak}
	if len(samples) > 0 {
		summary.DownAvg = downSum / uint64(len(samples))
		summary.UpAvg = upSum / uint64(len(samples))
	}
	return summary
}

// PerMinute aggregates the raw per-minute outbound map for the donut: total
// download bytes per outbound tag over the whole retention window.
func (st *Store) OutboundTotals() (map[string]uint64, int64) {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := map[string]uint64{}
	for _, sample := range st.samples {
		for tag, bytes := range sample.Out {
			out[tag] += bytes
		}
	}
	return out, st.sinceLocked()
}

// TrimSpacePath is used by tests.
func TrimSpacePath(path string) string { return strings.TrimSpace(path) }
