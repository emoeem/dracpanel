package history

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/settings"
)

// Clash's /traffic is a stream: it sends one object per second and never
// closes. Reading to EOF used to block until the client timeout, so every
// sample was dropped and the traffic chart stayed at zero.
func TestPollTrafficHandlesStreamingEndpoint(t *testing.T) {
	stop := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"up":614,"down":5489}`)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-stop
	}))
	defer func() {
		close(stop)
		server.Close()
	}()

	s, err := settings.Load("", true)
	if err != nil {
		t.Fatal(err)
	}
	s.Data["clash_api"] = server.URL
	s.Data["state_dir"] = t.TempDir()
	s.Data["sing_box_config"] = t.TempDir() + "/config.json"

	sampler := NewSampler(s, Load(s.StateDir()))
	sampler.client.Timeout = 2 * time.Second

	started := time.Now()
	up, down, ok := sampler.pollTraffic()
	elapsed := time.Since(started)

	if !ok {
		t.Fatal("pollTraffic failed on a streaming response")
	}
	if up != 614 || down != 5489 {
		t.Fatalf("up/down = %d/%d, want 614/5489", up, down)
	}
	if elapsed > time.Second {
		t.Fatalf("pollTraffic blocked for %v; it must decode the first object", elapsed)
	}
}

func TestPollTrafficReportsFailureOnHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	s, err := settings.Load("", true)
	if err != nil {
		t.Fatal(err)
	}
	s.Data["clash_api"] = server.URL
	s.Data["state_dir"] = t.TempDir()
	s.Data["sing_box_config"] = t.TempDir() + "/config.json"

	sampler := NewSampler(s, Load(s.StateDir()))
	if _, _, ok := sampler.pollTraffic(); ok {
		t.Fatal("pollTraffic should fail on 401")
	}
}

// sing-box lists the exit first in chains and counts bytes as download/upload;
// using the last chain entry or the *Total names leaves per-outbound totals at
// zero (and attributes traffic to the selector instead of the node).
func TestPollConnectionsUsesExitNodeAndDownloadCounter(t *testing.T) {
	download := int64(100)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/connections" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, `{"connections":[{"id":"c1","download":`+
			itoa(download)+`,"upload":7,"chains":["Node-A","Auto","Proxy"]}]}`)
	}))
	defer server.Close()

	s, err := settings.Load("", true)
	if err != nil {
		t.Fatal(err)
	}
	s.Data["clash_api"] = server.URL
	s.Data["state_dir"] = t.TempDir()
	s.Data["sing_box_config"] = t.TempDir() + "/config.json"

	sampler := NewSampler(s, Load(s.StateDir()))
	sampler.pollConnections()
	if got := outTotal(sampler, "Node-A"); got != 100 {
		t.Fatalf("Node-A total = %d, want 100", got)
	}
	if got := outTotal(sampler, "Proxy"); got != 0 {
		t.Fatalf("Proxy total = %d; traffic must be attributed to the exit node", got)
	}

	download = 150
	sampler.pollConnections()
	if got := outTotal(sampler, "Node-A"); got != 150 {
		t.Fatalf("after delta Node-A = %d, want 150", got)
	}
}

func outTotal(sampler *Sampler, tag string) uint64 {
	sampler.mu.Lock()
	defer sampler.mu.Unlock()
	return sampler.outTotals[tag]
}
