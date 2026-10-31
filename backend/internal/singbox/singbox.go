// Package singbox ports ConfigManager: backup/check/apply with the
// validate → atomic replace → restart → health check → rollback pipeline.
package singbox

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/systemd"
	"github.com/emoeem/dracpanel/backend/internal/sysutil"
)

// Result mirrors the {ok, message, backup?} envelope.
type Result struct {
	OK      bool
	Message string
	Backup  string
}

func okResult(msg, backup string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", true)
	m.Set("message", msg)
	if backup != "" {
		m.Set("backup", backup)
	}
	return m
}

func errResult(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", false)
	m.Set("message", msg)
	return m
}

// Manager owns the config pipeline. Safe for concurrent use.
type Manager struct {
	S       *settings.Settings
	Service *systemd.Service

	mu sync.Mutex
}

// New builds a Manager.
func New(s *settings.Settings, svc *systemd.Service) *Manager {
	return &Manager{S: s, Service: svc}
}

// BackupDir ensures and returns <config dir>/backups.
func (m *Manager) BackupDir() string {
	dir := filepath.Join(filepath.Dir(m.S.SingBoxConfigPath()), "backups")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

var reasonSanitizer = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

// Backup copies the live config to backups/config.<ts>.<reason>.json.
func (m *Manager) Backup(reason string) string {
	src := m.S.SingBoxConfigPath()
	if _, err := os.Stat(src); err != nil {
		return ""
	}
	name := fmt.Sprintf("config.%s.%s.json",
		time.Now().Format("20060102-150405"),
		truncate(reasonSanitizer.ReplaceAllString(reason, "-"), 24),
	)
	dst := filepath.Join(m.BackupDir(), name)
	raw, err := os.ReadFile(src)
	if err != nil {
		return ""
	}
	if err := os.WriteFile(dst, raw, fileModeOf(src)); err != nil {
		return ""
	}
	m.pruneBackups()
	return name
}

func fileModeOf(path string) os.FileMode {
	info, err := os.Stat(path)
	if err != nil {
		return 0o600
	}
	return info.Mode().Perm()
}

func truncate(text string, max int) string {
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[:max])
}

func (m *Manager) pruneBackups() {
	keep := m.S.Int("backup_keep", 30)
	entries, err := os.ReadDir(m.BackupDir())
	if err != nil {
		return
	}
	var names []string
	for _, entry := range entries {
		if matchBackupName(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if keep <= 0 {
		return
	}
	if len(names) <= keep {
		return
	}
	for _, name := range names[:len(names)-keep] {
		_ = os.Remove(filepath.Join(m.BackupDir(), name))
	}
}

func matchBackupName(name string) bool {
	// config.*.json
	if !strings.HasPrefix(name, "config.") || !strings.HasSuffix(name, ".json") {
		return false
	}
	return len(name) > len("config..json")
}

// BackupInfo mirrors the list_backups entries.
type BackupInfo struct {
	Name  string
	Size  int64
	MTime int64
}

// ListBackups returns backups newest-first.
func (m *Manager) ListBackups() []BackupInfo {
	entries, err := os.ReadDir(m.BackupDir())
	if err != nil {
		return nil
	}
	var out []BackupInfo
	for _, entry := range entries {
		if !matchBackupName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out = append(out, BackupInfo{Name: entry.Name(), Size: info.Size(), MTime: info.ModTime().Unix()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	return out
}

// Check runs `sing-box check` against a temp copy whose cache_file points to
// /tmp, so the service's cache.db is never touched.
func (m *Manager) Check(cfg *jsonx.OrderMap) (bool, string) {
	probe := cfg.Clone()
	if experimental, ok := probe.Get("experimental"); ok {
		if expMap, ok := experimental.(*jsonx.OrderMap); ok {
			if cache, ok := expMap.Get("cache_file"); ok {
				if cacheMap, ok := cache.(*jsonx.OrderMap); ok {
					if path, ok := cacheMap.Get("path"); ok && path != nil && path != "" {
						cacheMap.Set("path", "/tmp/sing-box-panel-check-cache.db")
					}
				}
			}
		}
	}
	tmp, err := os.CreateTemp("", "sing-box-panel-check-*.json")
	if err != nil {
		return false, err.Error()
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if _, err := tmp.WriteString(m.S.DumpSingBoxConfig(probe)); err != nil {
		tmp.Close()
		return false, err.Error()
	}
	tmp.Close()
	_ = os.Chmod(tmpPath, 0o600)
	rc, out, e := sysutil.Run(m.S.String("sing_box_bin"), []string{"check", "-c", tmpPath}, 60*time.Second)
	if rc == 0 {
		return true, firstNonEmpty(e, out, "check 通过")
	}
	return false, strings.TrimSpace(firstNonEmpty(e, out, fmt.Sprintf("check 退出码 %d", rc)))
}

// Apply ports ConfigManager.apply(): check → backup → atomic replace →
// restart → health check → rollback on failure. The temp file is 0600
// (fixing the Python build's 0644).
func (m *Manager) Apply(newCfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap {
	m.mu.Lock()
	defer m.mu.Unlock()

	okc, msg := m.Check(newCfg)
	if !okc {
		return errResult(fmt.Sprintf("配置校验未通过，未做任何改动：%s", msg))
	}

	backupName := ""
	if !m.S.DryRun {
		backupName = m.Backup(reason)
	}
	target := m.S.SingBoxConfigPath()
	if m.S.DryRun {
		dry, err := os.CreateTemp("", "sing-box-panel-dryrun-*.json")
		if err != nil {
			return errResult(err.Error())
		}
		dryPath := dry.Name()
		if _, err := dry.WriteString(m.S.DumpSingBoxConfig(newCfg)); err != nil {
			dry.Close()
			return errResult(err.Error())
		}
		dry.Close()
		return okResult(fmt.Sprintf("[dry-run] 校验通过，已写入 %s（未重启）", dryPath), "")
	}

	previous := ""
	if raw, err := os.ReadFile(target); err == nil {
		previous = string(raw)
	}
	tmp := target + ".panel-tmp"
	if err := os.WriteFile(tmp, []byte(m.S.DumpSingBoxConfig(newCfg)), 0o600); err != nil {
		return errResult(err.Error())
	}
	_ = os.Chmod(tmp, 0o600)
	if err := os.Rename(tmp, target); err != nil {
		return errResult(err.Error())
	}

	if !restart {
		out := okResult("配置已写入（未重启）", backupName)
		return out
	}

	rc, _, e := sysutil.Run("systemctl", []string{"restart", m.S.String("service")}, 60*time.Second)
	if rc != 0 {
		return m.rollback(previous, fmt.Sprintf("重启失败：%s", orCode(e, rc)), backupName)
	}
	healthy, why := m.Service.WaitHealthy()
	if !healthy {
		return m.rollback(previous, why, backupName)
	}
	return okResult(fmt.Sprintf("配置已应用并重启成功（%s）", why), backupName)
}

func (m *Manager) rollback(previous, why, backupName string) *jsonx.OrderMap {
	if previous != "" {
		if err := os.WriteFile(m.S.SingBoxConfigPath(), []byte(previous), 0o600); err == nil {
			_, _, _ = sysutil.Run("systemctl", []string{"restart", m.S.String("service")}, 60*time.Second)
		}
	}
	return errResult(fmt.Sprintf("%s；已回滚到应用前的配置（备份 %s）", why, orStr(backupName, "无")))
}

// Restore applies a backup by name.
func (m *Manager) Restore(name string) *jsonx.OrderMap {
	src := filepath.Join(m.BackupDir(), name)
	if _, err := os.Stat(src); err != nil {
		return errResult(fmt.Sprintf("找不到备份 %s", name))
	}
	raw, err := os.ReadFile(src)
	if err != nil {
		return errResult(err.Error())
	}
	cfg, err := jsonx.ParseObject(string(raw))
	if err != nil {
		return errResult(fmt.Sprintf("备份内容不是合法 JSON：%v", err))
	}
	return m.Apply(cfg, sanitizeRestoreReason(name), true)
}

func sanitizeRestoreReason(name string) string {
	// Mirror python f"restore-{name}" then the reason sanitizer runs in Backup.
	clean := reasonSanitizer.ReplaceAllString("restore-"+name, "-")
	return truncate(clean, 24)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func orCode(text string, code int) string {
	if text != "" {
		return text
	}
	return fmt.Sprintf("%d", code)
}

func orStr(text, fallback string) string {
	if text != "" {
		return text
	}
	return fallback
}
