package history

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDropsExpiredAndKeepsOrder(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().Unix()
	lines := ""
	// 8 days old → dropped; 2 days old → kept.
	lines += sampleJSON(now-8*86400, 1, 2) + "\n"
	lines += sampleJSON(now-2*86400, 3, 4) + "\n"
	lines += sampleJSON(now-60, 5, 6) + "\n"
	if err := os.WriteFile(filepath.Join(dir, "history.jsonl"), []byte(lines), 0o600); err != nil {
		t.Fatal(err)
	}
	store := Load(dir)
	points := store.Range("7d", 0).Points
	if len(points) != 2 {
		t.Fatalf("points = %d, want 2", len(points))
	}
	if points[0].Up != 3 || points[1].Up != 5 {
		t.Fatalf("up values = %+v", points)
	}
	if store.Since() > now-2*86400 {
		t.Fatalf("since = %d", store.Since())
	}
}

func TestRangeBucketsAndSummary(t *testing.T) {
	dir := t.TempDir()
	store := Load(dir)
	now := time.Now().Truncate(time.Minute).Unix()
	// 3 samples one minute apart: up 100/200/300, down 1000/2000/3000.
	for i, up := range []uint64{100, 200, 300} {
		store.Append(Sample{
			T:    now - int64(2-i)*60,
			Up:   up,
			Down: up * 10,
			Out:  map[string]uint64{"proxy": up},
		})
	}
	result := store.Range("1h", 60)
	if len(result.Points) != 3 {
		t.Fatalf("points = %d", len(result.Points))
	}
	if result.Summary.UpPeak != 300 || result.Summary.DownPeak != 3000 {
		t.Fatalf("peaks = %+v", result.Summary)
	}
	if result.Summary.UpAvg != 200 || result.Summary.DownAvg != 2000 {
		t.Fatalf("averages = %+v", result.Summary)
	}
	if got := result.Points[2].Out["proxy"]; got != 300 {
		t.Fatalf("out proxy = %d", got)
	}
}

func TestRangeDownsamplesLongWindows(t *testing.T) {
	dir := t.TempDir()
	store := Load(dir)
	now := time.Now().Truncate(time.Hour).Unix()
	// 6 hours of per-minute samples → 6h range buckets at 300s → ≤72 points.
	for i := 0; i < 360; i++ {
		store.Append(Sample{T: now - int64(359-i)*60, Up: 1, Down: 2})
	}
	result := store.Range("6h", 0)
	if result.Bucket != 300 {
		t.Fatalf("bucket = %d", result.Bucket)
	}
	if len(result.Points) == 0 || len(result.Points) > 73 {
		t.Fatalf("points = %d", len(result.Points))
	}
	// The window is measured against the real clock, so compute the expected
	// total the same way instead of assuming all 360 samples are in range.
	cutoff := time.Now().Add(-6 * time.Hour).Unix()
	expected := 0
	for i := 0; i < 360; i++ {
		if now-int64(359-i)*60 >= cutoff {
			expected++
		}
	}
	var total uint64
	for _, point := range result.Points {
		total += point.Up
	}
	if total != uint64(expected) {
		t.Fatalf("up total = %d, want %d", total, expected)
	}
}

func TestCompactPersistsOnlyRetained(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().Unix()
	store := Load(dir)
	store.Append(Sample{T: now - 8*86400, Up: 1, Down: 1})
	store.Append(Sample{T: now - 60, Up: 2, Down: 2})
	store.Compact()
	reloaded := Load(dir)
	if got := len(reloaded.Range("7d", 60).Points); got != 1 {
		t.Fatalf("points after compaction = %d", got)
	}
}

func TestUnknownRangeFallsBackToHour(t *testing.T) {
	dir := t.TempDir()
	store := Load(dir)
	result := store.Range("bogus", 0)
	if result.Range != "1h" || result.Bucket != 60 {
		t.Fatalf("fallback = %+v", result)
	}
}

func sampleJSON(tUnix int64, up, down uint64) string {
	return `{"t":` + itoa(tUnix) + `,"up":` + itoa64(up) + `,"down":` + itoa64(down) + `}`
}

func itoa(n int64) string {
	return itoa64(uint64(n))
}

func itoa64(n uint64) string {
	digits := "0123456789"
	if n == 0 {
		return "0"
	}
	var out []byte
	for n > 0 {
		out = append([]byte{digits[n%10]}, out...)
		n /= 10
	}
	return string(out)
}
