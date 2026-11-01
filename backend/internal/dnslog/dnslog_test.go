package dnslog

import "testing"

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
