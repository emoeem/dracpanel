// Package systemd wraps systemctl the way the Python Service class does.
package systemd

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/sysutil"
)

// Service controls the sing-box systemd unit.
type Service struct {
	S *settings.Settings
}

// New builds a Service.
func New(s *settings.Settings) *Service { return &Service{S: s} }

func ok(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", true)
	m.Set("message", msg)
	return m
}

func err(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", false)
	m.Set("message", msg)
	return m
}

// Status ports Service.status().
func (s *Service) Status() *jsonx.OrderMap {
	unit := s.S.String("service")
	out := jsonx.NewOrderMap()
	if s.S.DryRun {
		out.Set("active", false)
		out.Set("enabled", false)
		out.Set("since", "")
		out.Set("pid", "")
		out.Set("dry_run", true)
		return out
	}
	_, active, _ := sysutil.Run("systemctl", []string{"is-active", unit}, 30*time.Second)
	_, enabled, _ := sysutil.Run("systemctl", []string{"is-enabled", unit}, 30*time.Second)
	rc, show, _ := sysutil.Run("systemctl", []string{"show", "-p", "ActiveEnterTimestamp", "-p", "MainPID", unit}, 30*time.Second)
	fields := map[string]string{}
	if rc == 0 {
		for _, line := range strings.Split(show, "\n") {
			if key, value, found := strings.Cut(line, "="); found {
				fields[key] = value
			}
		}
	}
	out.Set("active", active == "active")
	out.Set("enabled", enabled == "enabled" || enabled == "enabled-runtime")
	out.Set("since", fields["ActiveEnterTimestamp"])
	out.Set("pid", fields["MainPID"])
	out.Set("raw", active)
	return out
}

// MainPID returns the unit's MainPID ("" when unknown).
func (s *Service) MainPID() string {
	if s.S.DryRun {
		return ""
	}
	rc, show, _ := sysutil.Run("systemctl", []string{"show", "-p", "MainPID", s.S.String("service")}, 30*time.Second)
	if rc != 0 {
		return ""
	}
	for _, line := range strings.Split(show, "\n") {
		if key, value, found := strings.Cut(line, "="); found && key == "MainPID" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// Control ports Service.control().
func (s *Service) Control(action string) *jsonx.OrderMap {
	if action != "start" && action != "stop" && action != "restart" && action != "reload" {
		return err(fmt.Sprintf("不支持的操作：%s", action))
	}
	if s.S.DryRun {
		return ok(fmt.Sprintf("[dry-run] 跳过 systemctl %s %s", action, s.S.String("service")))
	}
	rc, _, e := sysutil.Run("systemctl", []string{action, s.S.String("service")}, 60*time.Second)
	if rc != 0 {
		return err(fmt.Sprintf("systemctl %s 失败：%s", action, orCode(e, rc)))
	}
	return ok(fmt.Sprintf("已执行 systemctl %s %s", action, s.S.String("service")))
}

// Journal ports Service.journal().
func (s *Service) Journal(lines int) string {
	if s.S.DryRun {
		return "(dry-run：无日志)"
	}
	_, out, _ := sysutil.Run("journalctl", []string{
		"-u", s.S.String("service"), "-n", fmt.Sprintf("%d", lines), "--no-pager", "-o", "short-iso",
	}, 20*time.Second)
	return out
}

// WaitHealthy ports Service.wait_healthy().
func (s *Service) WaitHealthy() (bool, string) {
	if s.S.DryRun {
		return true, "[dry-run] 跳过健康检查"
	}
	unit := s.S.String("service")
	deadline := time.Now().Add(time.Duration(s.S.Int("restart_timeout", 20)) * time.Second)
	last := ""
	for time.Now().Before(deadline) {
		_, active, _ := sysutil.Run("systemctl", []string{"is-active", unit}, 30*time.Second)
		last = active
		if active == "active" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if last != "active" {
		return false, fmt.Sprintf("服务未在 %ds 内 active（当前：%s）", s.S.Int("restart_timeout", 20), orStr(last, "unknown"))
	}
	cfg, err := s.S.LoadSingBoxConfig()
	if err != nil {
		return false, fmt.Sprintf("配置无法读取：%v", err)
	}
	if hasTunInbound(cfg) {
		for {
			if _, statErr := os.Stat("/sys/class/net/tun0"); statErr == nil {
				break
			}
			if rc, _, _ := sysutil.Run("ip", []string{"link", "show", "tun0"}, 10*time.Second); rc == 0 {
				break
			}
			if !time.Now().Before(deadline) {
				return false, "服务 active 但 tun0 未出现"
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
	probe := s.S.String("health_probe_url")
	if probe != "" {
		proxy := MixedProxy(cfg)
		if proxy != "" {
			if !probeThroughProxy(probe, proxy) {
				return false, fmt.Sprintf("经代理探测 %s 失败", probe)
			}
		}
	}
	return true, "服务已恢复健康"
}

// MixedProxy returns the first mixed/http inbound as an http proxy URL.
func MixedProxy(cfg *jsonx.OrderMap) string {
	inbounds := arrayField(cfg, "inbounds")
	for _, item := range inbounds {
		obj, ok := item.(*jsonx.OrderMap)
		if !ok {
			continue
		}
		typ, _ := obj.Get("type")
		if typ == "mixed" || typ == "http" {
			host := "127.0.0.1"
			if listen, ok := obj.Get("listen"); ok {
				if str, ok := listen.(string); ok && str != "" {
					host = str
				}
			}
			port, hasPort := obj.Get("listen_port")
			if !hasPort || port == nil {
				continue
			}
			return fmt.Sprintf("http://%s:%v", host, port)
		}
	}
	return ""
}

func hasTunInbound(cfg *jsonx.OrderMap) bool {
	for _, item := range arrayField(cfg, "inbounds") {
		if obj, ok := item.(*jsonx.OrderMap); ok {
			if typ, _ := obj.Get("type"); typ == "tun" {
				return true
			}
		}
	}
	return false
}

// ArrayField extracts an array-of-any field from an ordered object.
func ArrayField(cfg *jsonx.OrderMap, key string) []jsonx.Value {
	return arrayField(cfg, key)
}

func arrayField(cfg *jsonx.OrderMap, key string) []jsonx.Value {
	if cfg == nil {
		return nil
	}
	if value, ok := cfg.Get(key); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			return arr
		}
	}
	return nil
}

func probeThroughProxy(probe, proxy string) bool {
	proxyURL, err := url.Parse(proxy)
	if err != nil {
		return false
	}
	client := &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
	}
	resp, err := client.Get(probe)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return true
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
