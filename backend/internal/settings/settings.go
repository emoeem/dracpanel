// Package settings ports the Python Settings class: panel.json loading,
// defaults, token lifecycle, sing-box config access and the egress-IP cache.
package settings

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/sysutil"
)

func logf(format string, args ...any) {
	sysutil.Logf(format, args...)
}

// Version is overridden at build time via -ldflags.
var Version = "0.2.0"

// Defaults mirror DEFAULT_CONFIG in the Python backend.
const (
	DefaultListen                     = "127.0.0.1"
	DefaultPort                       = 9096
	DefaultSingBoxConfig              = "/etc/sing-box/config.json"
	DefaultService                    = "sing-box"
	DefaultSingBoxBin                 = "/usr/bin/sing-box"
	DefaultClashAPI                   = "http://127.0.0.1:9090"
	DefaultStateDir                   = "/var/lib/sing-box-panel"
	DefaultUIDir                      = "/usr/share/sing-box-panel/ui"
	DefaultZashboardDir               = "/usr/share/sing-box-panel/zashboard"
	DefaultSubscriptionProxy          = "http://127.0.0.1:7892"
	DefaultManagedGroup               = "Proxy"
	DefaultManagedURLTest             = "Auto"
	DefaultRestartTimeout             = 20
	DefaultBackupKeep                 = 30
	DefaultSubscriptionUpdateInterval = 0
	DefaultSchedulerTick              = 30
	DefaultGeoIPDatabase              = "/usr/share/GeoIP/GeoLite2-City.mmdb"
)

// Settings holds the effective panel configuration.
type Settings struct {
	Data map[string]any

	DryRun bool

	tokenCreated bool

	secretMu    sync.Mutex
	secretMTime int64
	secretVal   string

	egressMu    sync.Mutex
	egressAt    time.Time
	egressValue string
	egressHave  bool
}

// Load builds Settings from the optional config path.
func Load(path string, dryRun bool) (*Settings, error) {
	s := &Settings{DryRun: dryRun}
	s.Data = map[string]any{
		"listen":                       DefaultListen,
		"port":                         float64(DefaultPort),
		"sing_box_config":              DefaultSingBoxConfig,
		"service":                      DefaultService,
		"sing_box_bin":                 DefaultSingBoxBin,
		"clash_api":                    DefaultClashAPI,
		"state_dir":                    DefaultStateDir,
		"ui_dir":                       DefaultUIDir,
		"zashboard_dir":                DefaultZashboardDir,
		"subscription_proxy":           DefaultSubscriptionProxy,
		"managed_group":                DefaultManagedGroup,
		"managed_urltest":              DefaultManagedURLTest,
		"restart_timeout":              float64(DefaultRestartTimeout),
		"health_probe_url":             "",
		"backup_keep":                  float64(DefaultBackupKeep),
		"subscription_update_interval": float64(DefaultSubscriptionUpdateInterval),
		"subscription_scheduler_tick":  float64(DefaultSchedulerTick),
		"geoip_database":               DefaultGeoIPDatabase,
		"egress_ip":                    "",
		"egress_ip_probe_url":          "",
	}
	// Python 版默认读取 /etc/sing-box/panel.json；保持一致。
	if path == "" {
		path = "/etc/sing-box/panel.json"
	}
	explicitStateDir := false
	if path != "" {
		// Python 版行为：读不到或解析失败 → 记日志并使用默认值，绝不因此退出。
		raw, err := os.ReadFile(path)
		if err != nil {
			if !os.IsNotExist(err) {
				logf("读取面板配置 %s 失败：%v，使用默认值", path, err)
			}
		} else {
			fileData, err := jsonx.ParseObject(string(raw))
			if err != nil {
				logf("读取面板配置 %s 失败：%v，使用默认值", path, err)
			} else {
				for _, key := range fileData.Keys() {
					value, _ := fileData.Get(key)
					s.Data[key] = value
					if key == "state_dir" {
						explicitStateDir = true
					}
				}
			}
		}
	}
	// dry-run 只在配置没有显式指定 state_dir 时才改用临时目录。
	if dryRun && !explicitStateDir {
		if env := os.Getenv("PANEL_STATE_DIR"); env != "" {
			s.Data["state_dir"] = env
		} else {
			s.Data["state_dir"] = "/tmp/sing-box-panel-state"
		}
	}
	return s, nil
}

// Get returns a raw setting.
func (s *Settings) Get(key string) any { return s.Data[key] }

// GetDefault returns the setting or the fallback.
func (s *Settings) GetDefault(key string, fallback any) any {
	if value, ok := s.Data[key]; ok && value != nil {
		return value
	}
	return fallback
}

// String returns a string setting.
func (s *Settings) String(key string) string {
	value, _ := s.Data[key].(string)
	return value
}

// Int returns an int setting (numbers arrive as float64 from JSON).
func (s *Settings) Int(key string, fallback int) int {
	switch v := s.Data[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case json.Number:
		if parsed, err := strconv.Atoi(v.String()); err == nil {
			return parsed
		}
	}
	return fallback
}

// ListenAddr returns "host:port" honouring --listen/--port overrides.
func (s *Settings) ListenAddr() string {
	port := s.Int("port", DefaultPort)
	return net.JoinHostPort(s.String("listen"), strconv.Itoa(port))
}

// StateDir returns the effective state directory (evaluated lazily so tests
// can override it after Load).
func (s *Settings) StateDir() string { return s.String("state_dir") }

// TokenFile is the token path inside the state dir.
func (s *Settings) TokenFile() string { return filepath.Join(s.StateDir(), "token") }

// TokenCreated reports whether this process generated the token.
func (s *Settings) TokenCreated() bool { return s.tokenCreated }

// Token returns the panel token, creating the file on first use (the Python
// backend re-reads it per request, so token rotation via PANEL_TOKEN or the
// file is honoured without a restart).
func (s *Settings) Token() (string, error) {
	if env := os.Getenv("PANEL_TOKEN"); env != "" {
		return env, nil
	}
	if raw, err := os.ReadFile(s.TokenFile()); err == nil {
		if value := strings.TrimSpace(string(raw)); value != "" {
			return value, nil
		}
	}
	value, err := newToken()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(s.StateDir(), 0o755); err != nil {
		return "", err
	}
	tokenFile := s.TokenFile()
	if err := os.WriteFile(tokenFile, []byte(value+"\n"), 0o600); err != nil {
		return "", err
	}
	_ = os.Chmod(tokenFile, 0o600)
	s.tokenCreated = true
	return value, nil
}

func newToken() (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// SingBoxConfigPath returns the managed sing-box config path.
func (s *Settings) SingBoxConfigPath() string { return s.String("sing_box_config") }

// LoadSingBoxConfig reads the live sing-box config (comment tolerant).
func (s *Settings) LoadSingBoxConfig() (*jsonx.OrderMap, error) {
	raw, err := os.ReadFile(s.SingBoxConfigPath())
	if err != nil {
		return nil, err
	}
	return jsonx.ParseObject(string(raw))
}

// DumpSingBoxConfig serializes the config the way the Python backend does.
func (s *Settings) DumpSingBoxConfig(cfg *jsonx.OrderMap) string {
	return jsonx.Dump(cfg)
}

// ClashSecret reads experimental.clash_api.secret, cached by file mtime.
func (s *Settings) ClashSecret() string {
	path := s.SingBoxConfigPath()
	info, err := os.Stat(path)
	if err != nil {
		return ""
	}
	mtime := info.ModTime().UnixNano()
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	if s.secretMTime == mtime {
		return s.secretVal
	}
	value := ""
	if cfg, err := s.LoadSingBoxConfig(); err == nil {
		if experimental, ok := cfg.Get("experimental"); ok {
			if expMap, ok := experimental.(*jsonx.OrderMap); ok {
				if clash, ok := expMap.Get("clash_api"); ok {
					if clashMap, ok := clash.(*jsonx.OrderMap); ok {
						if secret, ok := clashMap.Get("secret"); ok {
							if str, ok := secret.(string); ok {
								value = str
							}
						}
					}
				}
			}
		}
	}
	s.secretMTime = mtime
	s.secretVal = value
	return value
}

// EgressIP returns the configured egress IP or probes egress_ip_probe_url
// (cached: 6h on success, 300s on failure). No request without config.
func (s *Settings) EgressIP() string {
	configured := strings.TrimSpace(s.String("egress_ip"))
	if configured != "" && net.ParseIP(configured) != nil {
		return configured
	}
	probeURL := strings.TrimSpace(s.String("egress_ip_probe_url"))
	if probeURL == "" {
		return ""
	}
	s.egressMu.Lock()
	defer s.egressMu.Unlock()
	ttl := 300 * time.Second
	if s.egressHave {
		ttl = 6 * time.Hour
	}
	if s.egressHave && time.Since(s.egressAt) < ttl {
		return s.egressValue
	}
	value := ""
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest(http.MethodGet, probeURL, nil)
	if err == nil {
		req.Header.Set("User-Agent", "sing-box-panel/"+Version)
		if resp, err := client.Do(req); err == nil {
			defer resp.Body.Close()
			buf := make([]byte, 128)
			n, _ := resp.Body.Read(buf)
			candidate := strings.TrimSpace(string(buf[:n]))
			if net.ParseIP(candidate) != nil {
				value = candidate
			}
		}
	}
	s.egressAt = time.Now()
	s.egressValue = value
	s.egressHave = true
	return value
}

// SubsFile is the subscriptions store path.
func (s *Settings) SubsFile() string { return filepath.Join(s.StateDir(), "subscriptions.json") }

// ManagedFile is the managed-tags store path.
func (s *Settings) ManagedFile() string { return filepath.Join(s.StateDir(), "managed.json") }

// ReadJSON reads a JSON file, returning the default on any error.
func (s *Settings) ReadJSON(path string, fallback jsonx.Value) jsonx.Value {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fallback
	}
	value, err := jsonx.Parse(string(raw))
	if err != nil {
		return fallback
	}
	return value
}

// WriteJSON atomically writes a JSON document (0600, like the Python backend).
func (s *Settings) WriteJSON(path string, value jsonx.Value) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(jsonx.Dump(value)), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

// Subscriptions loads the raw subscription list.
func (s *Settings) Subscriptions() []*jsonx.OrderMap {
	return orderListOf(s.ReadJSON(s.SubsFile(), jsonx.Value([]jsonx.Value{})))
}

// Managed loads managed.json with the Python defaults.
func (s *Settings) Managed() *jsonx.OrderMap {
	value := s.ReadJSON(s.ManagedFile(), nil)
	if obj, ok := value.(*jsonx.OrderMap); ok {
		return obj
	}
	managed := jsonx.NewOrderMap()
	managed.Set("outbound_tags", []jsonx.Value{})
	managed.Set("group_members", jsonx.NewOrderMap())
	return managed
}

func orderListOf(value jsonx.Value) []*jsonx.OrderMap {
	arr, ok := value.([]jsonx.Value)
	if !ok {
		return nil
	}
	out := make([]*jsonx.OrderMap, 0, len(arr))
	for _, item := range arr {
		if obj, ok := item.(*jsonx.OrderMap); ok {
			out = append(out, obj)
		}
	}
	return out
}
