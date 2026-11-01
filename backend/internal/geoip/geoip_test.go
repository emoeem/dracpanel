package geoip

import (
	"net/netip"
	"sync"
	"testing"

	"github.com/emoeem/dracpanel/backend/internal/settings"
)

func TestIsGlobalRejectsReservedRanges(t *testing.T) {
	rejected := []string{
		"127.0.0.1",       // loopback
		"10.0.0.1",        // RFC1918
		"192.168.1.1",     // RFC1918
		"172.16.0.1",      // RFC1918
		"169.254.169.254", // link-local (cloud metadata)
		"192.0.2.5",       // TEST-NET-1
		"198.51.100.7",    // TEST-NET-2
		"203.0.113.9",     // TEST-NET-3
		"100.64.1.1",      // CGNAT
		"100.127.255.1",   // CGNAT upper half
		"198.18.0.1",      // benchmarking
		"::1",             // IPv6 loopback
		"fe80::1",         // IPv6 link-local
	}
	for _, raw := range rejected {
		if isGlobal(netip.MustParseAddr(raw)) {
			t.Errorf("isGlobal(%s) = true, want false", raw)
		}
	}
}

func TestIsGlobalAcceptsPublicRanges(t *testing.T) {
	accepted := []string{"1.1.1.1", "8.8.8.8", "93.184.216.34", "100.63.255.255", "2606:4700:4700::1111"}
	for _, raw := range accepted {
		if !isGlobal(netip.MustParseAddr(raw)) {
			t.Errorf("isGlobal(%s) = false, want true", raw)
		}
	}
}

// TestConcurrentLookup exercises the lazy load path from many goroutines; run
// with -race to catch the unsynchronised reader/loaded reads this replaced.
func TestConcurrentLookup(t *testing.T) {
	g := New(&settings.Settings{})
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Whether a database is installed varies by host: 200 with a
			// country (installed) or 503 (missing). Anything else, a panic or a
			// race means the lazy-load path is broken.
			body, status := g.Lookup("1.1.1.1")
			if status == 200 {
				if country, _ := body.Get("country"); country == nil || country == "" {
					t.Errorf("200 without a country field: %+v", body)
				}
				return
			}
			if status != 503 {
				t.Errorf("status = %d, want 200 or 503", status)
			}
		}()
	}
	wg.Wait()
}
