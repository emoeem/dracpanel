// Package sysproxy implements the FlClash-parity OS system proxy endpoints.
// It supports GNOME (gsettings) and KDE (kwriteconfig5) sessions; anything
// else reports an honest failure instead of pretending success.
package sysproxy

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/systemd"
)

// Runner executes host commands; tests inject fakes.
type Runner interface {
	Output(name string, args ...string) (string, int)
}

// RealRunner shells out.
type RealRunner struct{}

// Output runs the command and returns trimmed stdout plus the exit code.
func (RealRunner) Output(name string, args ...string) (string, int) {
	cmd := exec.Command(name, args...)
	raw, err := cmd.Output()
	text := strings.TrimSpace(string(raw))
	code := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = 127
		}
	}
	return text, code
}

// Controller manages the desktop system proxy.
type Controller struct {
	S       *settings.Settings
	Service *systemd.Service
	Run     Runner
}

// New builds the controller with the real runner.
func New(s *settings.Settings, svc *systemd.Service) *Controller {
	return &Controller{S: s, Service: svc, Run: RealRunner{}}
}

func errMap(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", false)
	m.Set("message", msg)
	return m
}

// sessionUser finds the uid/username of an active graphical session via
// loginctl. Returns "" when there is none (headless server).
func (c *Controller) sessionUser() string {
	out, code := c.Run.Output("loginctl", "list-sessions", "--no-legend")
	if code != 0 {
		return ""
	}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		session, user := fields[0], fields[2]
		class := ""
		if len(fields) >= 5 {
			class = fields[4]
		}
		// `loginctl list-sessions --no-legend` columns: SEAT? no —
		// SESSION UID USER SEAT TTY CLASS? Varies by systemd version, so
		// confirm with show-session.
		probe, code := c.Run.Output("loginctl", "show-session", session, "-p", "Class", "-p", "Name")
		if code != 0 {
			continue
		}
		isUser, hasName := false, false
		name := user
		for _, field := range strings.Split(probe, "\n") {
			if strings.HasPrefix(field, "Class=") && strings.Contains(field, "user") {
				isUser = true
			}
			if strings.HasPrefix(field, "Name=") {
				if value := strings.TrimPrefix(field, "Name="); value != "" {
					name = value
					hasName = true
				}
			}
		}
		if isUser && hasName {
			_ = class
			return name
		}
	}
	return ""
}

// uidOf resolves a username to a uid via `id -u`.
func (c *Controller) uidOf(user string) int {
	out, code := c.Run.Output("id", "-u", user)
	if code != 0 {
		return -1
	}
	uid, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return -1
	}
	return uid
}

// gsettings runs gsettings inside the user's session bus.
func (c *Controller) gsettings(user string, uid int, args ...string) (string, int) {
	bus := fmt.Sprintf("/run/user/%d/bus", uid)
	return c.Run.Output("runuser", append([]string{
		"-u", user, "--", "env",
		fmt.Sprintf("DBUS_SESSION_BUS_ADDRESS=unix:path=%s", bus),
		"gsettings",
	}, args...)...)
}

// desktop returns "gnome", "kde" or "" by probing the session user.
func (c *Controller) desktop(user string, uid int) string {
	if out, code := c.gsettings(user, uid, "get", "org.gnome.system.proxy", "mode"); code == 0 {
		_ = out
		return "gnome"
	}
	if _, code := c.Run.Output("kreadconfig5", "--help"); code == 0 {
		return "kde"
	}
	if _, code := c.Run.Output("kwriteconfig5", "--help"); code == 0 {
		return "kde"
	}
	return ""
}

// mixedPort returns the local proxy port from the sing-box config.
func (c *Controller) mixedPort() int {
	cfg, err := c.S.LoadSingBoxConfig()
	if err != nil {
		return 0
	}
	if value, ok := cfg.Get("inbounds"); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			for _, item := range arr {
				if obj, ok := item.(*jsonx.OrderMap); ok {
					if typ, _ := obj.Get("type"); typ == "mixed" || typ == "http" {
						if port, ok := obj.Get("listen_port"); ok {
							return toInt(port)
						}
					}
				}
			}
		}
	}
	return 0
}

func toInt(value any) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	default:
		return 0
	}
}

// Get ports GET /api/system-proxy: {enabled, port?}.
func (c *Controller) Get() *jsonx.OrderMap {
	out := jsonx.NewOrderMap()
	user := c.sessionUser()
	if user == "" {
		out.Set("ok", false)
		out.Set("message", "未检测到活动的图形会话，无法管理系统代理")
		out.Set("enabled", false)
		return out
	}
	uid := c.uidOf(user)
	desktop := c.desktop(user, uid)
	if desktop == "" {
		out.Set("ok", false)
		out.Set("message", "未检测到受支持的桌面环境（GNOME/KDE）")
		out.Set("enabled", false)
		return out
	}
	enabled := false
	if desktop == "gnome" {
		mode, code := c.gsettings(user, uid, "get", "org.gnome.system.proxy", "mode")
		enabled = code == 0 && strings.Contains(mode, "manual")
	} else {
		enabled = c.kdeProxyEnabled()
	}
	out.Set("ok", true)
	out.Set("enabled", enabled)
	if port := c.mixedPort(); port > 0 {
		out.Set("port", port)
	}
	return out
}

func (c *Controller) kdeProxyEnabled() bool {
	out, code := c.Run.Output("kreadconfig5", "--file", "kioslaverc", "--group", "Proxy Settings", "--key", "ProxyType")
	if code != 0 {
		return false
	}
	return strings.TrimSpace(out) == "1"
}

// Set ports POST /api/system-proxy {enabled}: point the desktop proxy at the
// local mixed inbound (GNOME) or kioslaverc (KDE).
func (c *Controller) Set(enabled bool) *jsonx.OrderMap {
	user := c.sessionUser()
	if user == "" {
		return errMap("未检测到活动的图形会话，无法管理系统代理")
	}
	uid := c.uidOf(user)
	desktop := c.desktop(user, uid)
	if desktop == "" {
		return errMap("未检测到受支持的桌面环境（GNOME/KDE）")
	}
	port := c.mixedPort()
	if port == 0 {
		return errMap("配置里没有 mixed/http 入站，无法确定代理端口")
	}
	if desktop == "gnome" {
		mode := "none"
		if enabled {
			mode = "manual"
		}
		hosts := jsonx.NewOrderMap()
		_ = hosts
		same := "'127.0.0.1'"
		if enabled {
			sets := [][]string{
				{"set", "org.gnome.system.proxy.http", "host", same},
				{"set", "org.gnome.system.proxy.http", "port", strconv.Itoa(port)},
				{"set", "org.gnome.system.proxy.https", "host", same},
				{"set", "org.gnome.system.proxy.https", "port", strconv.Itoa(port)},
				{"set", "org.gnome.system.proxy.socks", "host", same},
				{"set", "org.gnome.system.proxy.socks", "port", strconv.Itoa(port)},
				{"set", "org.gnome.system.proxy", "use-same-proxy", "true"},
				{"set", "org.gnome.system.proxy", "mode", mode},
			}
			for _, args := range sets {
				if _, code := c.gsettings(user, uid, args...); code != 0 {
					return errMap("gsettings 写入失败，系统代理未更改")
				}
			}
			return okMap(fmt.Sprintf("系统代理已%s（127.0.0.1:%d）", enabledText(enabled), port))
		}
		if _, code := c.gsettings(user, uid, "set", "org.gnome.system.proxy", "mode", mode); code != 0 {
			return errMap("gsettings 写入失败，系统代理未更改")
		}
		return okMap("系统代理已关闭")
	}
	proxyType := "0"
	if enabled {
		proxyType = "1"
	}
	sets := [][]string{
		{"--file", "kioslaverc", "--group", "Proxy Settings", "--key", "ProxyType", proxyType},
		{"--file", "kioslaverc", "--group", "Proxy Settings", "--key", "httpProxy", fmt.Sprintf("http://127.0.0.1 %d", port)},
		{"--file", "kioslaverc", "--group", "Proxy Settings", "--key", "httpsProxy", fmt.Sprintf("http://127.0.0.1 %d", port)},
	}
	for _, args := range sets {
		if _, code := c.Run.Output("kwriteconfig5", args...); code != 0 {
			return errMap("kwriteconfig5 写入失败，系统代理未更改")
		}
	}
	return okMap(fmt.Sprintf("系统代理已%s（127.0.0.1:%d）", enabledText(enabled), port))
}

func enabledText(enabled bool) string {
	if enabled {
		return "开启"
	}
	return "关闭"
}

func okMap(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", true)
	m.Set("message", msg)
	return m
}

var _ = os.Environ
