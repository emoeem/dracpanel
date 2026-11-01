package bootstrap

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/emoeem/dracpanel/backend/internal/httpapi"
	"github.com/emoeem/dracpanel/backend/internal/settings"
)

// stubBin puts fake executables on PATH, mirroring the technique used by the
// singbox package tests.
func stubBin(t *testing.T, scripts map[string]string) {
	t.Helper()
	dir := t.TempDir()
	for name, body := range scripts {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// fakeClash answers the handful of Clash API calls the sampler and the
// handlers make, so tests never touch the network.
func fakeClash(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/proxies", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"proxies":{"Proxy":{"type":"Selector","now":"direct","all":["direct"]},"direct":{"type":"Direct"}}}`))
	})
	mux.HandleFunc("/proxies/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		_, _ = w.Write([]byte(`{"delay":1}`))
	})
	mux.HandleFunc("/connections", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"downloadTotal":0,"uploadTotal":0,"connections":[]}`))
	})
	mux.HandleFunc("/version", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"version":"stub-clash"}`))
	})
	mux.HandleFunc("/traffic", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"up":0,"down":0}`))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

type fixture struct {
	deps  *httpapi.Deps
	cfg   *settings.Settings
	token string
	dir   string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()

	stubBin(t, map[string]string{
		"sing-box":      "exit 0",
		"journalctl":    "echo stub-log",
		"ip":            "exit 0",
		"loginctl":      "exit 1",
		"runuser":       "exit 1",
		"id":            "echo 1000",
		"gsettings":     "exit 1",
		"kreadconfig5":  "exit 1",
		"kwriteconfig5": "exit 1",
		"systemctl": `case "$1" in
  is-active) echo active ;;
  is-enabled) echo enabled ;;
  show) printf 'ActiveEnterTimestamp=Sun 2026-01-01 00:00:00 CST\nMainPID=4242\n' ;;
esac
exit 0`,
	})

	dir := t.TempDir()
	configPath := filepath.Join(dir, "etc", "sing-box", "config.json")
	stateDir := filepath.Join(dir, "state")
	uiDir := filepath.Join(dir, "ui")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(uiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(`{"log":{"level":"info"},"inbounds":[],"outbounds":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}

	clash := fakeClash(t)
	panel := map[string]any{
		"listen":             "127.0.0.1",
		"port":               float64(9097),
		"sing_box_config":    configPath,
		"service":            "sing-box-stub",
		"sing_box_bin":       "sing-box",
		"clash_api":          clash.URL,
		"state_dir":          stateDir,
		"ui_dir":             uiDir,
		"zashboard_dir":      filepath.Join(dir, "dash"),
		"subscription_proxy": "",
	}
	raw, err := json.Marshal(panel)
	if err != nil {
		t.Fatal(err)
	}
	panelPath := filepath.Join(dir, "panel.json")
	if err := os.WriteFile(panelPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := settings.Load(panelPath, false)
	if err != nil {
		t.Fatal(err)
	}
	token, err := s.Token() // also creates the state dir
	if err != nil {
		t.Fatal(err)
	}
	deps, cleanup := Build(s)
	t.Cleanup(cleanup)

	return &fixture{deps: deps, cfg: s, token: token, dir: dir}
}

func (f *fixture) do(t *testing.T, handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("X-Panel-Token", f.token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// TestBuildWiresOptionalDeps is the regression gate for the production bug:
// main.go used to leave Feed/History/Sampler/ApplyConfigText nil.
func TestBuildWiresOptionalDeps(t *testing.T) {
	f := newFixture(t)
	if f.deps.Feed == nil {
		t.Fatal("Deps.Feed is nil — /api/notifications and every Feed.Record caller would 500")
	}
	if f.deps.History == nil {
		t.Fatal("Deps.History is nil — /api/history would 500")
	}
	if f.deps.Sampler == nil {
		t.Fatal("Deps.Sampler is nil — /api/state would never emit cpu_percent")
	}
	if f.deps.ApplyConfigText == nil {
		t.Fatal("Deps.ApplyConfigText is nil — manual edits would drop JSONC comments and the feed entry")
	}
	if f.deps.Subs.ApplyFn == nil {
		t.Fatal("Subs.ApplyFn is nil — subscription applies would bypass the notification feed")
	}
	if f.deps.DNSLog == nil {
		t.Fatal("Deps.DNSLog is nil — /api/dns/queries would always be empty")
	}
	if f.deps.DNSProbe == nil {
		t.Fatal("Deps.DNSProbe is nil — /api/dns/probe would always be empty")
	}
}

// TestAllRoutesNoServerError drives every route through the production
// assembly; a nil dependency used to surface as HTTP 500 here.
func TestAllRoutesNoServerError(t *testing.T) {
	f := newFixture(t)
	handler := httpapi.New(*f.deps)

	// A backup must exist for the restore endpoint.
	backupName := "config.20260101-000000.gate.json"
	backupDir := filepath.Join(filepath.Dir(f.cfg.SingBoxConfigPath()), "backups")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backupDir, backupName), []byte(`{"log":{"level":"info"}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	subscription := base64.StdEncoding.EncodeToString([]byte(
		"ss://YWVzLTI1Ni1nY206cGFzcw@127.0.0.1:8388#Gate-Node-1\n" +
			"ss://YWVzLTI1Ni1nY206cGFzcw@127.0.0.1:8389#Gate-Node-2",
	))
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile("file", "nodes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(subscription)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name   string
		method string
		target string
		body   string
	}{
		{"ping", http.MethodGet, "/api/ping", ""},
		{"state", http.MethodGet, "/api/state", ""},
		{"service-noop", http.MethodPost, "/api/service", `{"action":"noop"}`},
		{"service-restart", http.MethodPost, "/api/service", `{"action":"restart"}`},
		{"logs", http.MethodGet, "/api/logs?n=5", ""},
		{"config-get", http.MethodGet, "/api/config", ""},
		{"config-validate-bad", http.MethodPost, "/api/config/validate", `{"text":"{ not json"}`},
		{"config-validate", http.MethodPost, "/api/config/validate", `{"text":"{\"log\":{\"level\":\"info\"}}"}`},
		{"config-apply", http.MethodPost, "/api/config", `{"text":"{\"log\":{\"level\":\"info\"},\"inbounds\":[],\"outbounds\":[]}"}`},
		{"config-backup", http.MethodPost, "/api/config/backup", ""},
		{"config-download", http.MethodGet, "/api/config/backups/" + backupName, ""},
		{"config-restore", http.MethodPost, "/api/config/restore", `{"name":"` + backupName + `"}`},
		{"geoip-private", http.MethodGet, "/api/geoip?ip=127.0.0.1", ""},
		{"ebpf-policy-get", http.MethodGet, "/api/ebpf/policy", ""},
		{"ebpf-policy-set", http.MethodPost, "/api/ebpf/policy", `{"mode":"off"}`},
		{"ebpf-probe", http.MethodPost, "/api/ebpf/probe", `{}`},
		{"apps", http.MethodGet, "/api/apps", ""},
		{"clash-proxies", http.MethodGet, "/api/clash/proxies", ""},
		{"clash-connections", http.MethodGet, "/api/clash/connections", ""},
		{"clash-version", http.MethodGet, "/api/clash/version", ""},
		{"clash-delay", http.MethodGet, "/api/clash/proxies/direct/delay?timeout=100", ""},
		{"clash-select", http.MethodPut, "/api/clash/proxies/Proxy", `{"name":"direct"}`},
		{"subs-list", http.MethodGet, "/api/subscriptions", ""},
		{"subs-add", http.MethodPost, "/api/subscriptions", `{"name":"gate","url":"http://127.0.0.1:1/none.txt"}`},
		{"subs-update-all", http.MethodPost, "/api/subscriptions/update_all", ""},
		{"subs-apply", http.MethodPost, "/api/subscriptions/apply", ""},
		{"subs-schedule", http.MethodPost, "/api/subscriptions/none/schedule", `{"update_interval":0}`},
		{"subs-update", http.MethodPost, "/api/subscriptions/none/update", ""},
		{"subs-delete", http.MethodDelete, "/api/subscriptions/none", ""},
		{"system-proxy-get", http.MethodGet, "/api/system-proxy", ""},
		{"local-ip", http.MethodGet, "/api/local-ip", ""},
		{"memory", http.MethodGet, "/api/memory", ""},
		{"history", http.MethodGet, "/api/history?range=10m", ""},
		{"notifications", http.MethodGet, "/api/notifications", ""},
		{"journal-list", http.MethodGet, "/api/journal?category=operation&limit=10", ""},
		{"journal-append", http.MethodPost, "/api/journal", `{"kind":"health","severity":"warn","category":"event","source":"browser","title":"节点不可用","detail":"probe","ok":false}`},
		{"policies", http.MethodGet, "/api/policies", ""},
		{"policy-overrides", http.MethodPost, "/api/policies/Proxy/overrides", `{"exclude":["x"],"order":["y"]}`},
		{"nodes", http.MethodGet, "/api/nodes", ""},
		{"node-detail", http.MethodGet, "/api/nodes/missing", ""},
		{"node-parse", http.MethodPost, "/api/nodes/parse", `{"links":"ss://YWVzLTI1Ni1nY206cGFzcw@127.0.0.1:8388#T1"}`},
		{"node-exclude", http.MethodPost, "/api/nodes/T1/exclude", `{"exclude":true}`},
		{"dns-config", http.MethodGet, "/api/dns", ""},
		{"dns-queries", http.MethodGet, "/api/dns/queries?minutes=60&limit=50", ""},
		{"dns-probe", http.MethodGet, "/api/dns/probe", ""},
		{"unknown-api", http.MethodGet, "/api/does-not-exist", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := f.do(t, handler, tc.method, tc.target, tc.body)
			if rec.Code >= 500 {
				t.Fatalf("%s %s -> HTTP %d: %s", tc.method, tc.target, rec.Code, rec.Body.String())
			}
		})
	}

	t.Run("profiles-import", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/profiles/import", &upload)
		req.Header.Set("X-Panel-Token", f.token)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("import -> HTTP %d: %s", rec.Code, rec.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("import body: %v", err)
		}
		if body["ok"] != true {
			t.Fatalf("import should succeed, got %v", body)
		}
	})
}

// TestRegressionEndpointsReturnSuccess pins the four write endpoints that used
// to perform their action and then answer 500.
func TestRegressionEndpointsReturnSuccess(t *testing.T) {
	f := newFixture(t)
	handler := httpapi.New(*f.deps)

	rec := f.do(t, handler, http.MethodPost, "/api/service", `{"action":"restart"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("service -> %d %s", rec.Code, rec.Body.String())
	}
	if !bodyOK(t, rec) {
		t.Fatalf("service should report ok:true, got %s", rec.Body.String())
	}

	rec = f.do(t, handler, http.MethodGet, "/api/history?range=10m", "")
	if rec.Code != http.StatusOK || !bodyOK(t, rec) {
		t.Fatalf("history -> %d %s", rec.Code, rec.Body.String())
	}

	rec = f.do(t, handler, http.MethodGet, "/api/notifications", "")
	if rec.Code != http.StatusOK || !bodyOK(t, rec) {
		t.Fatalf("notifications -> %d %s", rec.Code, rec.Body.String())
	}

	// The service action must have been recorded in the feed.
	var feed struct {
		Notifications []struct {
			Kind  string `json:"kind"`
			Title string `json:"title"`
		} `json:"notifications"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &feed); err != nil {
		t.Fatal(err)
	}
	if len(feed.Notifications) == 0 {
		t.Fatal("notification feed is empty after a service action")
	}
}

func bodyOK(t *testing.T, rec *httptest.ResponseRecorder) bool {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	ok, _ := body["ok"].(bool)
	return ok
}

// A stale editor must not clobber a newer config write.
func TestConfigRejectsStaleBaseMtime(t *testing.T) {
	f := newFixture(t)
	handler := httpapi.New(*f.deps)
	body := `{"text":"{\"inbounds\":[],\"outbounds\":[]}","base_mtime":1}`
	rec := f.do(t, handler, http.MethodPost, "/api/config", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["ok"] != false || parsed["code"] != "config_stale" {
		t.Fatalf("expected config_stale, got %v", parsed)
	}
}
