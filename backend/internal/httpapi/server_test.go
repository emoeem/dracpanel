package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/emoeem/dracpanel/backend/internal/clashapi"
	"github.com/emoeem/dracpanel/backend/internal/ebpf"
	"github.com/emoeem/dracpanel/backend/internal/geoip"
	"github.com/emoeem/dracpanel/backend/internal/history"
	"github.com/emoeem/dracpanel/backend/internal/meminfo"
	"github.com/emoeem/dracpanel/backend/internal/notifications"
	"github.com/emoeem/dracpanel/backend/internal/profiles"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/singbox"
	"github.com/emoeem/dracpanel/backend/internal/subs"
	"github.com/emoeem/dracpanel/backend/internal/sysproxy"
	"github.com/emoeem/dracpanel/backend/internal/systemd"
)

type fixture struct {
	handler  http.Handler
	s        *settings.Settings
	token    string
	uiDir    string
	_dashDir string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dir := t.TempDir()
	s, err := settings.Load("", false)
	if err != nil {
		t.Fatal(err)
	}
	s.Data["state_dir"] = filepath.Join(dir, "state")
	s.Data["sing_box_config"] = filepath.Join(dir, "etc", "sing-box", "config.json")
	s.Data["ui_dir"] = filepath.Join(dir, "ui")
	s.Data["zashboard_dir"] = filepath.Join(dir, "dash")
	s.Data["sing_box_bin"] = "sing-box"
	s.Data["service"] = "sing-box-stub"
	s.Data["subscription_proxy"] = ""
	if err := os.MkdirAll(filepath.Dir(s.SingBoxConfigPath()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.SingBoxConfigPath(), []byte("{\"inbounds\":[{\"type\":\"tun\"}],\"outbounds\":[],\"services\":[{\"type\":\"api\",\"listen_port\":9091}]}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(s.Data["ui_dir"].(string), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Data["ui_dir"].(string), "index.html"), []byte("<html>FlClash</html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := systemd.New(s)
	configs := singbox.New(s, service)
	subsStore := subs.New(s, configs)
	ebpfSystem := ebpf.New(s, configs.Apply)

	feed := notifications.Load(s)
	historyStore := history.Load(s.StateDir())
	deps := Deps{
		S:        s,
		Service:  service,
		Configs:  configs,
		Subs:     subsStore,
		Ebpf:     ebpfSystem,
		Clash:    &clashapi.Clash{S: s},
		GeoIP:    geoip.New(s),
		SysProxy: sysproxy.New(s, service),
		Mem:      &meminfo.Controller{S: s, Service: service},
		Profiles: &profiles.Importer{S: s, Subs: subsStore},
		Feed:     feed,
		History:  historyStore,
	}
	token, err := s.Token()
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{
		handler: New(deps),
		s:       s,
		token:   token,
		uiDir:   s.Data["ui_dir"].(string),
	}
}

func (f *fixture) do(t *testing.T, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("X-Panel-Token", f.token)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	return out
}

func TestPingNoAuth(t *testing.T) {
	f := newFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/api/ping", nil)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("code = %d", rec.Code)
	}
	body := decode(t, rec)
	if body["ok"] != true || body["auth_required"] != true {
		t.Fatalf("body = %v", body)
	}
}

func TestUnauthorizedShape(t *testing.T) {
	f := newFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("code = %d", rec.Code)
	}
	var out struct {
		OK      bool   `json:"ok"`
		Message string `json:"message"`
		Auth    bool   `json:"auth"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.OK || out.Auth {
		t.Fatalf("flags = %+v", out)
	}
	if out.Message != "未授权：请在面板里填入访问令牌" {
		t.Fatalf("message = %q", out.Message)
	}
}

func TestUnknownAPIRouteContract(t *testing.T) {
	f := newFixture(t)
	rec := f.do(t, http.MethodGet, "/api/definitely-not-here", "")
	if rec.Code != 404 {
		t.Fatalf("code = %d", rec.Code)
	}
	body := decode(t, rec)
	if body["ok"] != false {
		t.Fatalf("ok = %v", body["ok"])
	}
	message, _ := body["message"].(string)
	if !strings.Contains(message, "未知接口") || !strings.Contains(message, "GET /api/definitely-not-here") {
		t.Fatalf("message = %q", message)
	}
}

func TestStateShape(t *testing.T) {
	f := newFixture(t)
	stubBinDir(t, map[string]string{
		"sing-box": `#!/bin/sh
if [ "$1" = "version" ]; then echo "sing-box version v1.12.0"; exit 0; fi
exit 0`,
		"systemctl": `#!/bin/sh
case "$1" in
  is-active) echo active; exit 0;;
  is-enabled) echo enabled; exit 0;;
  show) printf "ActiveEnterTimestamp=Sat 2026-10-31 12:00:00 CST\nMainPID=1234\n"; exit 0;;
esac
exit 0`,
	})
	rec := f.do(t, http.MethodGet, "/api/state", "")
	if rec.Code != 200 {
		t.Fatalf("code = %d body=%s", rec.Code, rec.Body.String())
	}
	body := decode(t, rec)
	if body["ok"] != true {
		t.Fatalf("ok = %v", body["ok"])
	}
	if body["api_version"] != float64(APIVersion) {
		t.Fatalf("api_version = %v", body["api_version"])
	}
	features, _ := body["features"].([]any)
	if len(features) != len(Features) {
		t.Fatalf("features = %v", features)
	}
	if body["mode"] != "tun" {
		t.Fatalf("mode = %v", body["mode"])
	}
	inbounds, _ := body["inbounds"].([]any)
	if len(inbounds) != 1 || inbounds[0] != "tun" {
		t.Fatalf("inbounds = %v", inbounds)
	}
	if body["version"] != "v1.12.0" {
		t.Fatalf("version = %v", body["version"])
	}
	if body["managed_group"] != "Proxy" || body["managed_urltest"] != "Auto" {
		t.Fatalf("managed = %v / %v", body["managed_group"], body["managed_urltest"])
	}
	service, _ := body["service"].(map[string]any)
	if service["active"] != true || service["pid"] != "1234" {
		t.Fatalf("service = %v", service)
	}
	if body["egress_ip"] != "" {
		t.Fatalf("egress_ip = %v", body["egress_ip"])
	}
	if body["token_file"] == "" {
		t.Fatal("token_file missing")
	}
}

func TestConfigGetAndApply(t *testing.T) {
	f := newFixture(t)
	stubBinDir(t, map[string]string{
		"sing-box":  "#!/bin/sh\nexit 0\n",
		"systemctl": "#!/bin/sh\nif [ \"$1\" = \"is-active\" ]; then echo active; exit 0; fi\nexit 0\n",
	})
	rec := f.do(t, http.MethodGet, "/api/config", "")
	body := decode(t, rec)
	if body["ok"] != true || body["path"] == "" {
		t.Fatalf("get config = %v", body)
	}
	if _, ok := body["backups"].([]any); !ok {
		t.Fatalf("backups = %v", body["backups"])
	}
	newText := "{\"inbounds\":[{\"type\":\"mixed\"}],\"outbounds\":[]}"
	rec = f.do(t, http.MethodPost, "/api/config", `{"text":`+quote(newText)+`}`)
	body = decode(t, rec)
	if body["ok"] != true {
		t.Fatalf("apply = %v", body)
	}
	message, _ := body["message"].(string)
	if !strings.Contains(message, "配置已应用并重启成功") {
		t.Fatalf("message = %q", message)
	}
	backup, _ := body["backup"].(string)
	if backup == "" {
		t.Fatal("backup name missing")
	}
	// Live config now holds the new text.
	raw, _ := os.ReadFile(f.s.SingBoxConfigPath())
	if !strings.Contains(string(raw), "mixed") {
		t.Fatalf("live = %q", string(raw))
	}
	// Backup is downloadable (whitelisted).
	rec = f.do(t, http.MethodGet, "/api/config/backups/"+backup, "")
	if rec.Code != 200 {
		t.Fatalf("download code = %d", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Content-Disposition"), backup) {
		t.Fatalf("disposition = %q", rec.Header().Get("Content-Disposition"))
	}
	// Unknown backup name → 404 找不到备份.
	rec = f.do(t, http.MethodGet, "/api/config/backups/does-not-exist.json", "")
	if rec.Code != 404 {
		t.Fatalf("missing backup code = %d", rec.Code)
	}
	body = decode(t, rec)
	if message, _ := body["message"].(string); message != "找不到备份" {
		t.Fatalf("message = %q", message)
	}
}

func TestGeoIPPrivateIP404(t *testing.T) {
	f := newFixture(t)
	rec := f.do(t, http.MethodGet, "/api/geoip?ip=192.168.1.1", "")
	if rec.Code != 404 {
		t.Fatalf("code = %d", rec.Code)
	}
	body := decode(t, rec)
	if message, _ := body["message"].(string); message != "private or unresolvable ip" {
		t.Fatalf("message = %q", message)
	}
	rec = f.do(t, http.MethodGet, "/api/geoip?ip=not-an-ip", "")
	if rec.Code != 404 {
		t.Fatalf("code = %d", rec.Code)
	}
}

func TestSubscriptionsEndpoints(t *testing.T) {
	f := newFixture(t)
	stubBinDir(t, map[string]string{
		"sing-box":  "#!/bin/sh\nexit 0\n",
		"systemctl": "#!/bin/sh\nexit 0\n",
	})
	rec := f.do(t, http.MethodGet, "/api/subscriptions", "")
	body := decode(t, rec)
	subs, _ := body["subscriptions"].([]any)
	if body["ok"] != true || len(subs) != 0 {
		t.Fatalf("list = %v", body)
	}
	rec = f.do(t, http.MethodGet, "/api/subscriptions/managed", "")
	body = decode(t, rec)
	if body["managed_group"] != "Proxy" || body["managed_urltest"] != "Auto" {
		t.Fatalf("managed = %v", body)
	}
	if _, ok := body["outbound_tags"].([]any); !ok {
		t.Fatal("outbound_tags missing")
	}
	// add with unreachable URL → ok:false 下载失败 shape (no proxy on test box)
	rec = f.do(t, http.MethodPost, "/api/subscriptions", `{"name":"x","url":"http://127.0.0.1:1/sub"}`)
	body = decode(t, rec)
	message, _ := body["message"].(string)
	if body["ok"] != false || !strings.Contains(message, "下载失败") {
		t.Fatalf("add = %v", body)
	}
	// schedule endpoint accepts {update_interval}
	rec = f.do(t, http.MethodPost, "/api/subscriptions/abcd1234/schedule", `{"update_interval":3600}`)
	body = decode(t, rec)
	if _, ok := body["message"].(string); !ok {
		t.Fatalf("schedule = %v", body)
	}
}

func TestEBPFPolicyShape(t *testing.T) {
	f := newFixture(t)
	rec := f.do(t, http.MethodGet, "/api/ebpf/policy", "")
	body := decode(t, rec)
	if body["ok"] != true || body["present"] != false || body["mode"] != "none" {
		t.Fatalf("policy = %v", body)
	}
	// set policy without ebpf inbound → honest error
	rec = f.do(t, http.MethodPost, "/api/ebpf/policy", `{"mode":"whitelist","uids":[1000]}`)
	body = decode(t, rec)
	if body["ok"] != false {
		t.Fatalf("set policy = %v", body)
	}
	message, _ := body["message"].(string)
	if !strings.Contains(message, "ebpf 入站") {
		t.Fatalf("message = %q", message)
	}
}

func TestClashPassthroughShapes(t *testing.T) {
	f := newFixture(t)
	// No Clash API on the test box → honest failure shapes.
	rec := f.do(t, http.MethodGet, "/api/clash/version", "")
	body := decode(t, rec)
	if body["ok"] != false {
		t.Fatalf("version = %v", body)
	}
	if _, ok := body["data"].(map[string]any); !ok {
		t.Fatal("data missing")
	}
}

func TestStaticServing(t *testing.T) {
	f := newFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("code = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Fatalf("ctype = %q", got)
	}
	if !strings.Contains(rec.Body.String(), "FlClash") {
		t.Fatalf("body = %q", rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache-control = %q", got)
	}
	// Missing file → 404 "not found"
	req = httptest.NewRequest(http.MethodGet, "/missing.js", nil)
	rec = httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	if rec.Code != 404 || rec.Body.String() != "not found" {
		t.Fatalf("missing = %d %q", rec.Code, rec.Body.String())
	}
	// Traversal → 403
	req = httptest.NewRequest(http.MethodGet, "/..%2f..%2fetc%2fpasswd", nil)
	rec = httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("traversal = %d", rec.Code)
	}
}

func stubBinDir(t *testing.T, scripts map[string]string) {
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

func quote(text string) string {
	raw, _ := json.Marshal(text)
	return string(raw)
}
