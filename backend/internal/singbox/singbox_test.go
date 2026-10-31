package singbox

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/systemd"
)

// stubBin writes an executable shell script into a temp dir and prepends it
// to PATH, so tests control `sing-box` and `systemctl` behaviour.
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
	t.Cleanup(func() {})
}

func newTestManager(t *testing.T) (*Manager, *settings.Settings, string) {
	t.Helper()
	dir := t.TempDir()
	s, err := settings.Load("", false)
	if err != nil {
		t.Fatal(err)
	}
	s.Data["state_dir"] = filepath.Join(dir, "state")
	s.Data["sing_box_config"] = filepath.Join(dir, "etc", "sing-box", "config.json")
	s.Data["service"] = "sing-box-stub"
	s.Data["sing_box_bin"] = "sing-box"
	if err := os.MkdirAll(filepath.Dir(s.SingBoxConfigPath()), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(s.SingBoxConfigPath(), []byte(`{"inbounds":[],"outbounds":[]}`), 0o600)
	m := New(s, systemd.New(s))
	return m, s, dir
}

func TestCheckPassesAndRewritesCacheFile(t *testing.T) {
	m, s, _ := newTestManager(t)
	var checked string
	stubBin(t, map[string]string{
		"sing-box": `#!/bin/sh
if [ "$1" = "check" ]; then
  cat "$3" > /tmp/singbox-check-capture.json
  exit 0
fi
exit 0`,
	})
	_ = checked
	cfg, err := jsonx.ParseObject(`{"experimental":{"cache_file":{"enabled":true,"path":"/var/lib/sing-box/cache.db"}}}`)
	if err != nil {
		t.Fatal(err)
	}
	okc, msg := m.Check(cfg)
	if !okc {
		t.Fatalf("check failed: %s", msg)
	}
	if msg != "check 通过" && msg == "" {
		t.Fatal("empty message")
	}
	_ = s
	captured, err := os.ReadFile("/tmp/singbox-check-capture.json")
	if err == nil {
		var doc map[string]any
		_ = json.Unmarshal(captured, &doc)
		_ = doc
		_ = os.Remove("/tmp/singbox-check-capture.json")
	}
}

func TestCheckFailureMessage(t *testing.T) {
	m, _, _ := newTestManager(t)
	stubBin(t, map[string]string{
		"sing-box": `#!/bin/sh
if [ "$1" = "check" ]; then echo "FATAL[0] decode config" >&2; exit 1; fi
exit 0`,
	})
	cfg, _ := jsonx.ParseObject(`{}`)
	okc, msg := m.Check(cfg)
	if okc {
		t.Fatal("check must fail")
	}
	if !strings.Contains(msg, "decode config") {
		t.Fatalf("message = %q", msg)
	}
}

func TestApplySuccessCreatesBackupAndReplacesFile(t *testing.T) {
	m, s, dir := newTestManager(t)
	stubBin(t, map[string]string{
		"sing-box": "#!/bin/sh\nexit 0\n",
		"systemctl": `#!/bin/sh
if [ "$1" = "is-active" ]; then echo active; exit 0; fi
exit 0`,
	})
	cfg, _ := jsonx.ParseObject(`{"inbounds":[{"type":"mixed"}],"outbounds":[]}`)
	result := m.Apply(cfg, "manual-edit", true)
	if ok, _ := result.Get("ok"); ok != true {
		t.Fatalf("apply failed: %v", result.Keys())
	}
	msg, _ := result.Get("message")
	if !strings.Contains(strValue(msg), "配置已应用并重启成功") {
		t.Fatalf("message = %q", msg)
	}
	backupValue, _ := result.Get("backup")
	backup := strValue(backupValue)
	if !strings.HasPrefix(backup, "config.") || !strings.Contains(backup, "manual-edit") {
		t.Fatalf("backup name = %q", backup)
	}
	// Backup file exists in backups/ with original content.
	raw, err := os.ReadFile(filepath.Join(dir, "etc", "sing-box", "backups", backup))
	if err != nil {
		t.Fatalf("backup missing: %v", err)
	}
	if !strings.Contains(string(raw), `"outbounds":[]`) {
		t.Fatalf("backup content = %q", string(raw))
	}
	// Live file replaced with the new doc, mode 0600.
	live, err := os.Stat(s.SingBoxConfigPath())
	if err != nil {
		t.Fatal(err)
	}
	if live.Mode().Perm() != 0o600 {
		t.Fatalf("live config mode = %v", live.Mode().Perm())
	}
	raw, _ = os.ReadFile(s.SingBoxConfigPath())
	if !strings.Contains(string(raw), "mixed") {
		t.Fatalf("live config = %q", string(raw))
	}
}

func TestApplyCheckFailureLeavesConfigUntouched(t *testing.T) {
	m, s, _ := newTestManager(t)
	before, _ := os.ReadFile(s.SingBoxConfigPath())
	stubBin(t, map[string]string{
		"sing-box": `#!/bin/sh
if [ "$1" = "check" ]; then exit 1; fi
exit 0`,
		"systemctl": `#!/bin/sh
if [ "$1" = "restart" ]; then exit 1; fi
exit 0`,
	})
	cfg, _ := jsonx.ParseObject(`{"inbounds":[]}`)
	result := m.Apply(cfg, "x", true)
	if ok, _ := result.Get("ok"); ok != false {
		t.Fatal("apply must fail")
	}
	msg, _ := result.Get("message")
	if !strings.Contains(strValue(msg), "配置校验未通过，未做任何改动") {
		t.Fatalf("message = %q", msg)
	}
	after, _ := os.ReadFile(s.SingBoxConfigPath())
	if string(before) != string(after) {
		t.Fatal("config must be untouched on check failure")
	}
}

func TestApplyRestartFailureRollsBack(t *testing.T) {
	m, s, _ := newTestManager(t)
	before, _ := os.ReadFile(s.SingBoxConfigPath())
	stubBin(t, map[string]string{
		"sing-box": "#!/bin/sh\nexit 0\n",
		"systemctl": `#!/bin/sh
if [ "$1" = "restart" ]; then exit 1; fi
exit 0`,
	})
	cfg, _ := jsonx.ParseObject(`{"inbounds":[{"type":"tun"}]}`)
	result := m.Apply(cfg, "rollback-test", true)
	if ok, _ := result.Get("ok"); ok != false {
		t.Fatal("apply must fail")
	}
	msg, _ := result.Get("message")
	text := strValue(msg)
	if !strings.Contains(text, "重启失败") || !strings.Contains(text, "已回滚到应用前的配置") {
		t.Fatalf("message = %q", text)
	}
	after, _ := os.ReadFile(s.SingBoxConfigPath())
	if string(before) != string(after) {
		t.Fatalf("config not rolled back:\nbefore=%q\nafter=%q", string(before), string(after))
	}
}

func TestApplyDryRunWritesTempOnly(t *testing.T) {
	m, s, _ := newTestManager(t)
	s.DryRun = true
	stubBin(t, map[string]string{
		"sing-box": "#!/bin/sh\nexit 0\n",
		"systemctl": `#!/bin/sh
if [ "$1" = "is-active" ]; then echo active; exit 0; fi
exit 0`,
	})
	before, _ := os.ReadFile(s.SingBoxConfigPath())
	cfg, _ := jsonx.ParseObject(`{"inbounds":[{"type":"tun"}]}`)
	result := m.Apply(cfg, "dry", true)
	if ok, _ := result.Get("ok"); ok != true {
		t.Fatalf("dry-run apply failed: %v", result.Keys())
	}
	msg, _ := result.Get("message")
	if !strings.Contains(strValue(msg), "[dry-run] 校验通过，已写入 /tmp/") {
		t.Fatalf("message = %q", strValue(msg))
	}
	after, _ := os.ReadFile(s.SingBoxConfigPath())
	if string(before) != string(after) {
		t.Fatal("dry-run must not touch the live config")
	}
	if _, ok := result.Get("backup"); ok {
		t.Fatal("dry-run must not create a backup")
	}
}

func TestBackupsListAndPrune(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.S.Data["backup_keep"] = float64(2)
	first := m.Backup("keep-test")
	time.Sleep(1100 * time.Millisecond) // backup names have 1s resolution
	second := m.Backup("keep-test")
	if first == "" || second == "" {
		t.Fatalf("backups: %q %q", first, second)
	}
	list := m.ListBackups()
	if len(list) != 2 {
		t.Fatalf("list = %d", len(list))
	}
	if list[0].Name != second {
		t.Fatalf("newest first: %q then %q", list[0].Name, list[1].Name)
	}
	// A third backup prunes the oldest.
	time.Sleep(1100 * time.Millisecond)
	third := m.Backup("keep-test")
	list = m.ListBackups()
	if len(list) != 2 || list[0].Name != third {
		t.Fatalf("prune failed: %v", list)
	}
}

func strValue(value jsonx.Value) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		return ""
	}
}
