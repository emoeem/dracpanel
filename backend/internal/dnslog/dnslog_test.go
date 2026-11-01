package dnslog

import (
	"testing"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/settings"
)

func TestParseLineExtractsDomainAndType(t *testing.T) {
	line := "2026-11-01T16:20:31+08:00 host sing-box[4242]: dns: exchange domain[www.example.com] type[A] with[tls://1.1.1.1] elapsed[42ms]"
	entry, ok := ParseLine(line)
	if !ok {
		t.Fatalf("expected the line to parse")
	}
	if entry.Domain != "www.example.com" {
		t.Errorf("domain = %q", entry.Domain)
	}
	if entry.Type != "A" {
		t.Errorf("type = %q", entry.Type)
	}
	if entry.Upstream != "tls://1.1.1.1" {
		t.Errorf("upstream = %q", entry.Upstream)
	}
	if entry.ElapsedMs != 42 {
		t.Errorf("elapsed = %d", entry.ElapsedMs)
	}
	if entry.Status != StatusOK {
		t.Errorf("status = %q", entry.Status)
	}
	if entry.At == 0 {
		t.Errorf("expected a parsed journal timestamp")
	}
}

func TestParseLineHandlesKeyValueFormat(t *testing.T) {
	line := "2026-11-01T16:21:00+08:00 host sing-box[4242]: dns: resolve google.com type=HTTPS server=https://dns.google elapsed=180ms client=192.168.1.5:5555"
	entry, ok := ParseLine(line)
	if !ok {
		t.Fatalf("expected the line to parse")
	}
	if entry.Domain != "google.com" {
		t.Errorf("domain = %q", entry.Domain)
	}
	if entry.Type != "HTTPS" {
		t.Errorf("type = %q", entry.Type)
	}
	if entry.Client != "192.168.1.5:5555" {
		t.Errorf("client = %q", entry.Client)
	}
	if entry.ElapsedMs != 180 {
		t.Errorf("elapsed = %d", entry.ElapsedMs)
	}
}

func TestParseLineMarksNxdomainAndFailures(t *testing.T) {
	nx, ok := ParseLine("2026-11-01T16:22:00+08:00 h sing-box[1]: dns: exchange domain[nope.invalid] type[A] NXDOMAIN")
	if !ok || nx.Status != StatusNX {
		t.Fatalf("nxdomain: ok=%v status=%q", ok, nx.Status)
	}
	failed, ok := ParseLine("2026-11-01T16:23:00+08:00 h sing-box[1]: dns: exchange domain[down.example] type[A] upstream timeout")
	if !ok || failed.Status != StatusFailed {
		t.Fatalf("failure: ok=%v status=%q", ok, failed.Status)
	}
}

func TestParseLineRejectsNoise(t *testing.T) {
	cases := []string{
		"",
		"2026-11-01T16:24:00+08:00 h sing-box[1]: router: matched rule -> direct",
		"2026-11-01T16:24:00+08:00 h sing-box[1]: dns: starting server", // DNS marker but no domain
		"garbage line without prefix",
	}
	for _, line := range cases {
		if entry, ok := ParseLine(line); ok {
			t.Errorf("expected rejection, got %+v for %q", entry, line)
		}
	}
}

func TestParseLineToleratesMissingFields(t *testing.T) {
	// No elapsed / upstream / type: the entry must still parse with zero values.
	entry, ok := ParseLine("2026-11-01T16:25:00+08:00 h sing-box[1]: dns: exchange domain[a.example] start")
	if !ok {
		t.Fatalf("expected the line to parse")
	}
	if entry.Domain != "a.example" {
		t.Errorf("domain = %q", entry.Domain)
	}
	if entry.ElapsedMs != 0 || entry.Type != "" || entry.Upstream != "" {
		t.Errorf("expected empty optional fields, got %+v", entry)
	}
}

func TestQueriesCacheHonoursWindow(t *testing.T) {
	var calls []time.Duration
	reader := &Reader{
		S: &settings.Settings{},
		readFn: func(window time.Duration) []Entry {
			calls = append(calls, window)
			return []Entry{{At: 1, Domain: "a.example", Status: StatusOK}}
		},
	}
	// First request populates the cache.
	if entries, note := reader.Queries(10*time.Minute, 10); len(entries) != 1 || note != "" {
		t.Fatalf("first read: entries=%d note=%q", len(entries), note)
	}
	// A narrower window is served from the wider cache.
	reader.Queries(5*time.Minute, 10)
	if len(calls) != 1 {
		t.Fatalf("narrower window re-read the journal: %v", calls)
	}
	// A wider window must re-read; the old cache was too narrow.
	reader.Queries(24*time.Hour, 10)
	if len(calls) != 2 || calls[1] != 24*time.Hour {
		t.Fatalf("wider window did not re-read: %v", calls)
	}
	// The refreshed, wider cache satisfies another narrow request.
	reader.Queries(time.Minute, 10)
	if len(calls) != 2 {
		t.Fatalf("cache after widening was not reused: %v", calls)
	}
}

func TestQueriesDryRunSkipsJournal(t *testing.T) {
	called := false
	reader := &Reader{
		S: &settings.Settings{DryRun: true},
		readFn: func(time.Duration) []Entry {
			called = true
			return nil
		},
	}
	entries, note := reader.Queries(time.Hour, 5)
	if called {
		t.Errorf("dry-run must not read the journal")
	}
	if len(entries) != 0 || note == "" {
		t.Errorf("dry-run: entries=%d note=%q", len(entries), note)
	}
}

func TestNewestIsNewestFirstAndLimited(t *testing.T) {
	entries := []Entry{{At: 1}, {At: 2}, {At: 3}}
	out := newest(entries, 2)
	if len(out) != 2 || out[0].At != 3 || out[1].At != 2 {
		t.Fatalf("newest = %+v", out)
	}
}
