// Package httpapi builds the panel HTTP server: routes 1:1 with the Python
// backend plus the FlClash-parity endpoints, token auth, the 未知接口 404
// contract and static UI serving.
package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/clashapi"
	"github.com/emoeem/dracpanel/backend/internal/ebpf"
	"github.com/emoeem/dracpanel/backend/internal/geoip"
	"github.com/emoeem/dracpanel/backend/internal/history"
	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/localip"
	"github.com/emoeem/dracpanel/backend/internal/meminfo"
	"github.com/emoeem/dracpanel/backend/internal/notifications"
	"github.com/emoeem/dracpanel/backend/internal/profiles"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/singbox"
	"github.com/emoeem/dracpanel/backend/internal/subs"
	"github.com/emoeem/dracpanel/backend/internal/sysproxy"
	"github.com/emoeem/dracpanel/backend/internal/systemd"
	"github.com/emoeem/dracpanel/backend/internal/sysutil"
)

// Deps bundles every subsystem the handlers need.
type Deps struct {
	S        *settings.Settings
	Service  *systemd.Service
	Configs  *singbox.Manager
	Subs     *subs.Subscriptions
	Ebpf     *ebpf.Ebpf
	Clash    *clashapi.Clash
	GeoIP    *geoip.GeoIP
	SysProxy *sysproxy.Controller
	Mem      *meminfo.Controller
	Profiles *profiles.Importer
	Feed     *notifications.Feed
	History  *history.Store
	Sampler  *history.Sampler
	// NotifyConfigs lets main() record manual config applies; nil skips it.
	NotifyConfigs func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap
}

// Features is the documented capability list (api_version 8 contract).
var Features = []string{
	"subscriptions.schedule",
	"subscriptions.managed",
	"subscriptions.userinfo",
	"config.backup.download",
	"logs",
	"clash.version",
	"geoip",
}

// APIVersion mirrors DEPLOYMENT.md's backend contract revision.
const APIVersion = 8

// Handler serves the panel.
type Handler struct {
	Deps Deps
}

// New builds the root handler with auth, API routing and static serving.
func New(deps Deps) http.Handler {
	h := &Handler{Deps: deps}
	mux := http.NewServeMux()
	registerAPI(mux, h)

	mux.HandleFunc("/api/", h.unknownAPI)
	mux.HandleFunc("/", h.serveStatic)

	return h.recoverMiddleware(h.authMiddleware(mux))
}

// registerAPI wires the exact route table.
func registerAPI(mux *http.ServeMux, h *Handler) {
	mux.HandleFunc("GET /api/ping", h.handlePing)
	mux.HandleFunc("GET /api/state", h.handleState)
	mux.HandleFunc("POST /api/service", h.handleService)
	mux.HandleFunc("GET /api/logs", h.handleLogs)
	mux.HandleFunc("GET /api/config", h.handleGetConfig)
	mux.HandleFunc("POST /api/config", h.handlePostConfig)
	mux.HandleFunc("POST /api/config/validate", h.handleValidateConfig)
	mux.HandleFunc("POST /api/config/backup", h.handleBackupConfig)
	mux.HandleFunc("POST /api/config/restore", h.handleRestoreConfig)
	mux.HandleFunc("GET /api/config/backups/{name}", h.handleDownloadBackup)
	mux.HandleFunc("GET /api/geoip", h.handleGeoIP)
	mux.HandleFunc("GET /api/ebpf/policy", h.handleGetPolicy)
	mux.HandleFunc("POST /api/ebpf/policy", h.handleSetPolicy)
	mux.HandleFunc("POST /api/ebpf/probe", h.handleProbe)
	mux.HandleFunc("GET /api/apps", h.handleApps)
	mux.HandleFunc("GET /api/clash/proxies", h.handleClashProxies)
	mux.HandleFunc("GET /api/clash/connections", h.handleClashConnections)
	mux.HandleFunc("GET /api/clash/version", h.handleClashVersion)
	mux.HandleFunc("GET /api/clash/proxies/{name}/delay", h.handleClashDelay)
	mux.HandleFunc("PUT /api/clash/proxies/{name}", h.handleClashSelect)
	mux.HandleFunc("GET /api/subscriptions/managed", h.handleManaged)
	mux.HandleFunc("GET /api/subscriptions", h.handleListSubs)
	mux.HandleFunc("POST /api/subscriptions", h.handleAddSub)
	mux.HandleFunc("POST /api/subscriptions/update_all", h.handleUpdateAll)
	mux.HandleFunc("POST /api/subscriptions/apply", h.handleApplySubs)
	mux.HandleFunc("POST /api/subscriptions/{id}/schedule", h.handleSchedule)
	mux.HandleFunc("POST /api/subscriptions/{id}/update", h.handleUpdateSub)
	mux.HandleFunc("DELETE /api/subscriptions/{id}", h.handleDeleteSub)
	mux.HandleFunc("GET /api/system-proxy", h.handleGetSystemProxy)
	mux.HandleFunc("POST /api/system-proxy", h.handleSetSystemProxy)
	mux.HandleFunc("GET /api/local-ip", h.handleLocalIP)
	mux.HandleFunc("GET /api/memory", h.handleMemory)
	mux.HandleFunc("POST /api/profiles/import", h.handleProfilesImport)
	mux.HandleFunc("GET /api/history", h.handleHistory)
	mux.HandleFunc("GET /api/notifications", h.handleNotifications)
}

// ── plumbing ────────────────────────────────────────────────────────────────

func (h *Handler) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logf("API %s %s 出错：%v", r.Method, r.URL.Path, rec)
				writeJSON(w, r, 500, errMap(fmt.Sprintf("内部错误：%v", rec)))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (h *Handler) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/ping" {
			if !h.authorized(r) {
				body := jsonx.NewOrderMap()
				body.Set("ok", false)
				body.Set("message", "未授权：请在面板里填入访问令牌")
				body.Set("auth", false)
				writeJSON(w, r, 401, body)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (h *Handler) authorized(r *http.Request) bool {
	supplied := r.Header.Get("X-Panel-Token")
	if supplied == "" {
		for _, part := range strings.Split(r.Header.Get("Cookie"), ";") {
			key, value, found := strings.Cut(strings.TrimSpace(part), "=")
			if found && key == "panel_token" {
				supplied = value
			}
		}
	}
	if supplied == "" {
		return false
	}
	expected, err := h.Deps.S.Token()
	if err != nil {
		return false
	}
	return subtleEqual(supplied, expected)
}

func subtleEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

func writeJSON(w http.ResponseWriter, r *http.Request, code int, body *jsonx.OrderMap) {
	raw, err := json.Marshal(body)
	if err != nil {
		raw = []byte(`{"ok":false,"message":"内部错误：marshal"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.WriteHeader(code)
	if r.Method != http.MethodHead {
		_, _ = w.Write(raw)
	}
}

func (h *Handler) unknownAPI(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 404, errMap(fmt.Sprintf("未知接口：%s %s", r.Method, unquote(r.URL.Path))))
}

func unquote(text string) string {
	if unescaped, err := url.PathUnescape(text); err == nil {
		return unescaped
	}
	return text
}

func errMap(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", false)
	m.Set("message", msg)
	return m
}

func okMap(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", true)
	m.Set("message", msg)
	return m
}

func (h *Handler) body(r *http.Request) *jsonx.OrderMap {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil || len(raw) == 0 {
		return jsonx.NewOrderMap()
	}
	if value, err := jsonx.Parse(string(raw)); err == nil {
		if obj, ok := value.(*jsonx.OrderMap); ok {
			return obj
		}
	}
	return jsonx.NewOrderMap()
}

func bodyString(body *jsonx.OrderMap, key, fallback string) string {
	if value, ok := body.Get(key); ok {
		if str, ok := value.(string); ok {
			return str
		}
		if value != nil {
			return fmt.Sprintf("%v", value)
		}
	}
	return fallback
}

func logf(format string, args ...any) {
	sysutil.Logf(format, args...)
}

func timeNow() time.Time { return time.Now() }

func runBin(name string, args []string, timeout time.Duration) (int, string, string) {
	return sysutil.Run(name, args, timeout)
}

// ── handlers ────────────────────────────────────────────────────────────────

func (h *Handler) handlePing(w http.ResponseWriter, r *http.Request) {
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("version", settings.Version)
	out.Set("auth_required", true)
	writeJSON(w, r, 200, out)
}

func (h *Handler) handleState(w http.ResponseWriter, r *http.Request) {
	s := h.Deps.S
	cfgError := ""
	var cfg *jsonx.OrderMap
	if loaded, err := s.LoadSingBoxConfig(); err != nil {
		cfgError = err.Error()
	} else {
		cfg = loaded
	}
	var inbounds []string
	if cfg != nil {
		if value, ok := cfg.Get("inbounds"); ok {
			if arr, ok := value.([]jsonx.Value); ok {
				for _, item := range arr {
					if obj, ok := item.(*jsonx.OrderMap); ok {
						if typ, ok := obj.Get("type"); ok {
							inbounds = append(inbounds, fmt.Sprintf("%v", typ))
						}
					}
				}
			}
		}
	}
	mode := "mixed"
	for _, inbound := range inbounds {
		if inbound == "ebpf" {
			mode = "ebpf"
			break
		}
	}
	if mode == "mixed" {
		for _, inbound := range inbounds {
			if inbound == "tun" {
				mode = "tun"
				break
			}
		}
	}
	configPath := s.SingBoxConfigPath()
	mtime, bytes := int64(0), int64(0)
	if info, err := os.Stat(configPath); err == nil {
		mtime, bytes = info.ModTime().Unix(), info.Size()
	}
	version := ""
	if s.DryRun {
		version = fmt.Sprintf("%s (dry-run)", settings.Version)
	} else {
		rc, out, _ := runBin(s.String("sing_box_bin"), []string{"version"}, 10*time.Second)
		if rc == 0 && out != "" {
			version = strings.TrimSpace(strings.ReplaceAll(strings.Split(out, "\n")[0], "sing-box version ", ""))
		}
	}

	apiService := (*jsonx.OrderMap)(nil)
	if cfg != nil {
		if value, ok := cfg.Get("services"); ok {
			if arr, ok := value.([]jsonx.Value); ok {
				for _, item := range arr {
					if obj, ok := item.(*jsonx.OrderMap); ok {
						if typ, _ := obj.Get("type"); typ == "api" {
							apiService = obj
							break
						}
					}
				}
			}
		}
	}
	dashboardAvailable := apiService != nil
	if apiService != nil {
		if dashboard, ok := apiService.Get("dashboard"); ok {
			switch value := dashboard.(type) {
			case bool:
				dashboardAvailable = value
			case *jsonx.OrderMap:
				if enabled, ok := value.Get("enabled"); ok {
					dashboardAvailable = truthyAny(enabled)
				} else {
					dashboardAvailable = true
				}
			case string:
				dashboardAvailable = value != ""
			}
		}
	}
	officialURL := ""
	if dashboardAvailable {
		if configured := s.String("official_dashboard_url"); configured != "" {
			officialURL = configured
		} else {
			officialURL = "http://127.0.0.1:9091/dashboard/"
		}
	}
	zashboardAvailable := false
	if info, err := os.Stat(filepath.Join(s.String("zashboard_dir"), "index.html")); err == nil && !info.IsDir() {
		zashboardAvailable = true
	}

	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("version", version)
	out.Set("panel_version", settings.Version)
	out.Set("api_version", APIVersion)
	features := make([]jsonx.Value, 0, len(Features))
	for _, feature := range Features {
		features = append(features, feature)
	}
	out.Set("features", features)
	out.Set("mode", mode)
	out.Set("inbounds", stringsToAny(inbounds))
	out.Set("service", h.Deps.Service.Status())
	out.Set("config_path", configPath)
	out.Set("config_mtime", mtime)
	out.Set("config_bytes", bytes)
	out.Set("config_error", cfgError)
	out.Set("dry_run", s.DryRun)
	out.Set("clash_api", s.String("clash_api"))
	out.Set("clash_secret", s.ClashSecret())
	out.Set("zash_setup_url", zashSetupURL(s))
	out.Set("zashboard_available", zashboardAvailable)
	out.Set("official_dashboard_url", officialURL)
	out.Set("official_dashboard_available", dashboardAvailable)
	out.Set("metacubexd_url", metacubexdURL(s, cfg))
	out.Set("managed_group", s.String("managed_group"))
	out.Set("managed_urltest", s.String("managed_urltest"))
	out.Set("egress_ip", s.EgressIP())
	out.Set("local_ip", localip.Detect())
	if mem, ok := h.Deps.Mem.Get().Get("app"); ok {
		out.Set("memory_app", mem)
	}
	if mem, ok := h.Deps.Mem.Get().Get("kernel"); ok {
		out.Set("memory_kernel", mem)
	}
	if h.Deps.Sampler != nil {
		out.Set("cpu_percent", h.Deps.Sampler.CurrentCPU())
	}
	out.Set("token_file", s.TokenFile())
	writeJSON(w, r, 200, out)
}

func truthyAny(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v != "" && v != "false"
	default:
		return false
	}
}

func stringsToAny(list []string) []jsonx.Value {
	out := make([]jsonx.Value, 0, len(list))
	for _, item := range list {
		out = append(out, item)
	}
	return out
}

func zashSetupURL(s *settings.Settings) string {
	parsed, err := url.Parse(s.String("clash_api"))
	host, port := "127.0.0.1", "9090"
	if err == nil {
		if parsed.Hostname() != "" {
			host = parsed.Hostname()
		}
		if parsed.Port() != "" {
			port = parsed.Port()
		}
		protocol := parsed.Scheme
		if protocol == "" {
			protocol = "http"
		}
		query := url.Values{}
		query.Set("hostname", host)
		query.Set("port", port)
		query.Set("secret", s.ClashSecret())
		query.Set("protocol", protocol)
		return "/dash/#/setup?" + query.Encode()
	}
	return "/dash/#/setup?"
}

func metacubexdURL(s *settings.Settings, cfg *jsonx.OrderMap) string {
	if cfg == nil {
		return ""
	}
	experimental, ok := cfg.Get("experimental")
	if !ok {
		return ""
	}
	expMap, ok := experimental.(*jsonx.OrderMap)
	if !ok {
		return ""
	}
	clash, ok := expMap.Get("clash_api")
	if !ok {
		return ""
	}
	clashMap, ok := clash.(*jsonx.OrderMap)
	if !ok {
		return ""
	}
	if externalUI, ok := clashMap.Get("external_ui"); !ok || externalUI == nil || externalUI == "" {
		return ""
	}
	parsed, err := url.Parse(s.String("clash_api"))
	scheme, netloc := "http", parsed.Host
	if err == nil {
		if parsed.Scheme != "" {
			scheme = parsed.Scheme
		}
	}
	return fmt.Sprintf("%s://%s/ui/", scheme, netloc)
}

func (h *Handler) handleService(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	result := h.Deps.Service.Control(bodyString(body, "action", ""))
	h.Deps.Feed.Record("service", "服务控制（"+bodyString(body, "action", "")+"）", result)
	writeJSON(w, r, 200, result)
}

func (h *Handler) handleLogs(w http.ResponseWriter, r *http.Request) {
	n := 200
	if raw := r.URL.Query().Get("n"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			n = parsed
		}
	}
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("lines", h.Deps.Service.Journal(n))
	writeJSON(w, r, 200, out)
}

func (h *Handler) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	path := h.Deps.S.SingBoxConfigPath()
	text := ""
	if raw, err := os.ReadFile(path); err == nil {
		text = string(raw)
	}
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("path", path)
	out.Set("text", text)
	out.Set("backups", backupsToValues(h.Deps.Configs.ListBackups()))
	writeJSON(w, r, 200, out)
}

func backupsToValues(list []singbox.BackupInfo) []jsonx.Value {
	out := make([]jsonx.Value, 0, len(list))
	for _, item := range list {
		entry := jsonx.NewOrderMap()
		entry.Set("name", item.Name)
		entry.Set("size", item.Size)
		entry.Set("mtime", item.MTime)
		out = append(out, entry)
	}
	return out
}

func (h *Handler) handlePostConfig(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	text := bodyString(body, "text", "")
	cfg, err := jsonx.ParseObject(text)
	if err != nil {
		writeJSON(w, r, 200, errMap(fmt.Sprintf("JSON 语法错误：%v", err)))
		return
	}
	apply := h.Deps.NotifyConfigs
	if apply == nil {
		apply = h.Deps.Configs.Apply
	}
	writeJSON(w, r, 200, apply(cfg, "manual-edit", true))
}

func (h *Handler) handleValidateConfig(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	cfg, err := jsonx.ParseObject(bodyString(body, "text", ""))
	if err != nil {
		writeJSON(w, r, 200, errMap(fmt.Sprintf("JSON 语法错误：%v", err)))
		return
	}
	okc, msg := h.Deps.Configs.Check(cfg)
	out := jsonx.NewOrderMap()
	out.Set("ok", okc)
	out.Set("message", msg)
	writeJSON(w, r, 200, out)
}

func (h *Handler) handleBackupConfig(w http.ResponseWriter, r *http.Request) {
	name := h.Deps.Configs.Backup("manual")
	if name == "" {
		writeJSON(w, r, 200, errMap("线上配置不存在"))
		return
	}
	writeJSON(w, r, 200, okMap(fmt.Sprintf("已备份为 %s", name)))
}

func (h *Handler) handleRestoreConfig(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	result := h.Deps.Configs.Restore(bodyString(body, "name", ""))
	h.Deps.Feed.Record("config", "恢复备份", result)
	writeJSON(w, r, 200, result)
}

var backupNameRe = regexp.MustCompile(`^config\.[0-9]{8}-[0-9]{6}\.[A-Za-z0-9_-]{1,24}\.json$`)

func (h *Handler) handleDownloadBackup(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	found := false
	for _, item := range h.Deps.Configs.ListBackups() {
		if item.Name == name {
			found = true
			break
		}
	}
	if !found {
		writeJSON(w, r, 404, errMap("找不到备份"))
		return
	}
	// Path traversal guard, mirroring the resolve+relative_to check.
	baseAbs, err := filepath.Abs(h.Deps.Configs.BackupDir())
	if err != nil {
		writeJSON(w, r, 400, errMap("非法备份路径"))
		return
	}
	target := filepath.Clean(filepath.Join(baseAbs, name))
	if !strings.HasPrefix(target, baseAbs+string(filepath.Separator)) || !backupNameRe.MatchString(name) {
		writeJSON(w, r, 400, errMap("非法备份路径"))
		return
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		writeJSON(w, r, 500, errMap(fmt.Sprintf("读取备份失败：%v", err)))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(200)
	if r.Method != http.MethodHead {
		_, _ = w.Write(raw)
	}
}

func (h *Handler) handleGeoIP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			logf("GeoIP 查询出错（地址不记录）")
			writeJSON(w, r, 503, errMap("geoip database unavailable"))
		}
	}()
	body, status := h.Deps.GeoIP.Lookup(r.URL.Query().Get("ip"))
	writeJSON(w, r, status, body)
}

func (h *Handler) handleGetPolicy(w http.ResponseWriter, r *http.Request) {
	out := okEnvelope()
	policy := h.Deps.Ebpf.Policy()
	for _, key := range policy.Keys() {
		value, _ := policy.Get(key)
		out.Set(key, value)
	}
	writeJSON(w, r, 200, out)
}

func okEnvelope() *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", true)
	return m
}

func (h *Handler) handleSetPolicy(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	mode := bodyString(body, "mode", "off")
	var uids []int
	if value, ok := body.Get("uids"); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			for _, item := range arr {
				switch v := item.(type) {
				case float64:
					uids = append(uids, int(v))
				case int:
					uids = append(uids, v)
				case json.Number:
					if n, err := v.Int64(); err == nil {
						uids = append(uids, int(n))
					}
				}
			}
		}
	}
	writeJSON(w, r, 200, h.Deps.Ebpf.SetPolicy(mode, uids))
}

func (h *Handler) handleProbe(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	iface := bodyString(body, "interface", "")
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("data", h.Deps.Ebpf.Probe(iface))
	writeJSON(w, r, 200, out)
}

func (h *Handler) handleApps(w http.ResponseWriter, r *http.Request) {
	apps := ebpf.ListApps("/proc", []string{
		"/usr/share/applications",
		"/usr/local/share/applications",
	})
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("apps", apps)
	writeJSON(w, r, 200, out)
}

func (h *Handler) handleClashProxies(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, h.Deps.Clash.Proxies())
}

func (h *Handler) handleClashConnections(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, h.Deps.Clash.Connections())
}

func (h *Handler) handleClashVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, h.Deps.Clash.Version())
}

func (h *Handler) handleClashDelay(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	target := r.URL.Query().Get("url")
	if target == "" {
		target = "http://www.gstatic.com/generate_204"
	}
	timeout := 5000
	if raw := r.URL.Query().Get("timeout"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			timeout = parsed
		}
	}
	writeJSON(w, r, 200, h.Deps.Clash.Delay(name, target, timeout))
}

func (h *Handler) handleClashSelect(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	body := h.body(r)
	writeJSON(w, r, 200, h.Deps.Clash.Select(name, bodyString(body, "name", "")))
}

func (h *Handler) handleManaged(w http.ResponseWriter, r *http.Request) {
	s := h.Deps.S
	managed := s.Managed()
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("outbound_tags", listOf(managed, "outbound_tags"))
	out.Set("group_members", mapOf(managed, "group_members"))
	out.Set("updated", intValue(managed, "updated"))
	out.Set("by_subscription", mapOf(managed, "by_subscription"))
	out.Set("managed_group", s.String("managed_group"))
	out.Set("managed_urltest", s.String("managed_urltest"))
	writeJSON(w, r, 200, out)
}

func listOf(obj *jsonx.OrderMap, key string) []jsonx.Value {
	if value, ok := obj.Get(key); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			return arr
		}
	}
	return []jsonx.Value{}
}

func mapOf(obj *jsonx.OrderMap, key string) *jsonx.OrderMap {
	if value, ok := obj.Get(key); ok {
		if m, ok := value.(*jsonx.OrderMap); ok {
			return m
		}
	}
	return jsonx.NewOrderMap()
}

func intValue(obj *jsonx.OrderMap, key string) int64 {
	if value, ok := obj.Get(key); ok {
		switch v := value.(type) {
		case float64:
			return int64(v)
		case int:
			return int64(v)
		case int64:
			return v
		case json.Number:
			n, _ := v.Int64()
			return n
		}
	}
	return 0
}

func (h *Handler) handleListSubs(w http.ResponseWriter, r *http.Request) {
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("subscriptions", h.Deps.Subs.List())
	writeJSON(w, r, 200, out)
}

func (h *Handler) handleAddSub(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	enabled := true
	if value, ok := body.Get("enabled"); ok {
		enabled = truthyAny(value)
	}
	writeJSON(w, r, 200, h.Deps.Subs.Add(
		bodyString(body, "name", ""),
		bodyString(body, "url", ""),
		enabled,
		bodyGet(body, "update_interval"),
	))
}

func bodyGet(body *jsonx.OrderMap, key string) any {
	if value, ok := body.Get(key); ok {
		return value
	}
	return nil
}

func (h *Handler) handleUpdateAll(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, h.Deps.Subs.UpdateAll())
}

func (h *Handler) handleApplySubs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, h.Deps.Subs.Apply())
}

func (h *Handler) handleSchedule(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	writeJSON(w, r, 200, h.Deps.Subs.Configure(r.PathValue("id"), bodyGet(body, "update_interval"), bodyGet(body, "enabled")))
}

func (h *Handler) handleUpdateSub(w http.ResponseWriter, r *http.Request) {
	result := h.Deps.Subs.Update(r.PathValue("id"))
	h.Deps.Feed.Record("subscription", "订阅更新", result)
	writeJSON(w, r, 200, result)
}

func (h *Handler) handleDeleteSub(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, h.Deps.Subs.Remove(r.PathValue("id")))
}

func (h *Handler) handleGetSystemProxy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, h.Deps.SysProxy.Get())
}

func (h *Handler) handleSetSystemProxy(w http.ResponseWriter, r *http.Request) {
	body := h.body(r)
	enabled := truthyAny(bodyGet(body, "enabled"))
	writeJSON(w, r, 200, h.Deps.SysProxy.Set(enabled))
}

func (h *Handler) handleLocalIP(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, localip.Handler())
}

func (h *Handler) handleMemory(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, 200, h.Deps.Mem.Get())
}

func (h *Handler) handleHistory(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("range")
	if name == "" {
		name = "1h"
	}
	bucket := int64(0)
	if raw := r.URL.Query().Get("bucket"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			bucket = parsed
		}
	}
	result := h.Deps.History.Range(name, bucket)
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("range", result.Range)
	out.Set("bucket", result.Bucket)
	out.Set("since", result.Since)
	points := make([]jsonx.Value, 0, len(result.Points))
	for _, point := range result.Points {
		obj := jsonx.NewOrderMap()
		obj.Set("t", point.T)
		obj.Set("up", point.Up)
		obj.Set("down", point.Down)
		if point.CPU > 0 {
			obj.Set("cpu", point.CPU)
		}
		if len(point.Out) > 0 {
			outMap := jsonx.NewOrderMap()
			tags := make([]string, 0, len(point.Out))
			for tag := range point.Out {
				tags = append(tags, tag)
			}
			sort.Strings(tags)
			for _, tag := range tags {
				outMap.Set(tag, point.Out[tag])
			}
			obj.Set("out", outMap)
		}
		points = append(points, obj)
	}
	out.Set("points", points)
	summary := jsonx.NewOrderMap()
	summary.Set("down_peak", result.Summary.DownPeak)
	summary.Set("down_avg", result.Summary.DownAvg)
	summary.Set("up_peak", result.Summary.UpPeak)
	summary.Set("up_avg", result.Summary.UpAvg)
	out.Set("summary", summary)
	writeJSON(w, r, 200, out)
}

func (h *Handler) handleNotifications(w http.ResponseWriter, r *http.Request) {
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("notifications", h.Deps.Feed.ListValue())
	writeJSON(w, r, 200, out)
}

func (h *Handler) handleProfilesImport(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeJSON(w, r, 200, errMap(fmt.Sprintf("读取上传失败：%v", err)))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, r, 200, errMap("缺少 file 字段"))
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, r, 200, errMap(fmt.Sprintf("读取上传失败：%v", err)))
		return
	}
	result := h.Deps.Profiles.Import(header.Filename, raw)
	h.Deps.Feed.Record("import", "导入配置文件", result)
	writeJSON(w, r, 200, result)
}

// ── static ──────────────────────────────────────────────────────────────────

var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "application/javascript; charset=utf-8",
	".mjs":         "application/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".ico":         "image/x-icon",
	".webmanifest": "application/manifest+json",
	".jpg":         "image/jpeg",
	".woff2":       "font/woff2",
	".txt":         "text/plain; charset=utf-8",
	".md":          "text/plain; charset=utf-8",
}

func (h *Handler) serveStatic(w http.ResponseWriter, r *http.Request) {
	target := unquote(r.URL.Path)
	if target == "/dash" {
		w.Header().Set("Location", "/dash/")
		w.WriteHeader(302)
		return
	}
	if strings.HasPrefix(target, "/dash/") {
		h.serve(w, r, h.Deps.S.String("zashboard_dir"), strings.TrimPrefix(target, "/dash/"), true)
		return
	}
	rel := strings.TrimPrefix(target, "/")
	if rel == "" {
		rel = "index.html"
	}
	rel = strings.TrimPrefix(rel, "ui/")
	h.serve(w, r, h.Deps.S.String("ui_dir"), rel, false)
}

func (h *Handler) serve(w http.ResponseWriter, r *http.Request, base, rel string, spa bool) {
	baseAbs, err := filepath.Abs(base)
	if err != nil {
		plain(w, r, 403, "forbidden")
		return
	}
	// Mirror the Python resolve()+relative_to() guard: join the raw relative
	// path (no pre-cleaning), then require the result to stay inside base.
	target := filepath.Join(baseAbs, rel)
	if target != baseAbs && !strings.HasPrefix(target, baseAbs+string(filepath.Separator)) {
		plain(w, r, 403, "forbidden")
		return
	}
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		if spa {
			target = filepath.Join(baseAbs, "index.html")
		}
		if _, err := os.Stat(target); err != nil {
			plain(w, r, 404, "not found")
			return
		}
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		plain(w, r, 404, "not found")
		return
	}
	ext := strings.ToLower(filepath.Ext(target))
	ctype := contentTypes[ext]
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.WriteHeader(200)
	if r.Method != http.MethodHead {
		_, _ = w.Write(raw)
	}
}

func plain(w http.ResponseWriter, r *http.Request, code int, text string) {
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	if r.Method != http.MethodHead {
		_, _ = w.Write([]byte(text))
	}
}
