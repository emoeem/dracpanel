// Package ebpf ports the eBPF policy/probe/apps subsystem.
package ebpf

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/sysutil"
)

// Ebpf owns policy reads/writes and the probe passthrough.
type Ebpf struct {
	S       *settings.Settings
	ApplyFn func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap
}

// New builds the subsystem; ApplyFn is normally the singbox Manager.Apply.
func New(s *settings.Settings, apply func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap) *Ebpf {
	return &Ebpf{S: s, ApplyFn: apply}
}

func okEnvelope() *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", true)
	return m
}

func errMap(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", false)
	m.Set("message", msg)
	return m
}

// Inbound finds the first inbound with type == "ebpf".
func (e *Ebpf) Inbound(cfg *jsonx.OrderMap) *jsonx.OrderMap {
	if cfg == nil {
		return nil
	}
	if value, ok := cfg.Get("inbounds"); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			for _, item := range arr {
				if obj, ok := item.(*jsonx.OrderMap); ok {
					if typ, _ := obj.Get("type"); typ == "ebpf" {
						return obj
					}
				}
			}
		}
	}
	return nil
}

// Policy ports Ebpf.policy(): the state lives inside the live config.
func (e *Ebpf) Policy() *jsonx.OrderMap {
	cfg, err := e.S.LoadSingBoxConfig()
	out := okEnvelope()
	if err != nil {
		out.Set("present", false)
		out.Set("mode", "none")
		out.Set("uids", []jsonx.Value{})
		out.Set("local", jsonx.NewOrderMap())
		return out
	}
	inbound := e.Inbound(cfg)
	if inbound == nil {
		out.Set("present", false)
		out.Set("mode", "none")
		out.Set("uids", []jsonx.Value{})
		out.Set("local", jsonx.NewOrderMap())
		return out
	}
	local := jsonx.NewOrderMap()
	if value, ok := inbound.Get("local"); ok {
		if obj, ok := value.(*jsonx.OrderMap); ok {
			local = obj
		}
	}
	include := intList(local, "include_uid")
	exclude := intList(local, "exclude_uid")
	mode := "off"
	uids := []jsonx.Value{}
	if len(include) > 0 {
		mode, uids = "whitelist", intsToValues(include)
	} else if len(exclude) > 0 {
		mode, uids = "blacklist", intsToValues(exclude)
	}
	out.Set("present", true)
	out.Set("mode", mode)
	out.Set("uids", sortedUniqueInts(uids))
	out.Set("include", intsToValues(include))
	out.Set("exclude", intsToValues(exclude))
	out.Set("data_plane", strOr(local, "data_plane", "cgroup"))
	out.Set("dns_mode", strOr(local, "dns_mode", "hijack"))
	if ipv6, ok := local.Get("ipv6"); ok {
		out.Set("ipv6", ipv6)
	} else {
		out.Set("ipv6", true)
	}
	if shared, ok := inbound.Get("shared"); ok && shared != nil {
		out.Set("shared", shared)
	} else {
		out.Set("shared", jsonx.NewOrderMap())
	}
	return out
}

// SetPolicy ports Ebpf.set_policy(): edit the existing ebpf inbound's local
// dict then apply the config transaction.
func (e *Ebpf) SetPolicy(mode string, uids []int) *jsonx.OrderMap {
	if mode != "off" && mode != "blacklist" && mode != "whitelist" {
		return errMap(fmt.Sprintf("未知模式：%s", mode))
	}
	cfg, err := e.S.LoadSingBoxConfig()
	if err != nil {
		return errMap(err.Error())
	}
	inbound := e.Inbound(cfg)
	if inbound == nil {
		return errMap("当前配置里没有 ebpf 入站（面板只支持在 eBPF 模式下管理分应用策略）")
	}
	localValue, hasLocal := inbound.Get("local")
	local, ok := localValue.(*jsonx.OrderMap)
	if !ok || !hasLocal {
		local = jsonx.NewOrderMap()
		inbound.Set("local", local)
	}
	cleaned := map[int]bool{}
	for _, uid := range uids {
		if uid >= 0 && uid < 1<<32 {
			cleaned[uid] = true
		}
	}
	sorted := make([]int, 0, len(cleaned))
	for uid := range cleaned {
		sorted = append(sorted, uid)
	}
	sort.Ints(sorted)
	local.Delete("include_uid")
	local.Delete("exclude_uid")
	if mode == "whitelist" && len(sorted) > 0 {
		local.Set("include_uid", intsToValues(sorted))
	} else if mode == "blacklist" && len(sorted) > 0 {
		local.Set("exclude_uid", intsToValues(sorted))
	} else if mode != "off" {
		mode = "off"
	}
	return e.ApplyFn(cfg, fmt.Sprintf("ebpf-policy-%s", mode), true)
}

// Probe ports Ebpf.probe(): a pure passthrough to the sing-box fork's
// `tools ebpf status` command.
func (e *Ebpf) Probe(iface string) jsonx.Value {
	if e.S.DryRun {
		out := jsonx.NewOrderMap()
		out.Set("ok", true)
		out.Set("result", "dry-run")
		out.Set("findings", []jsonx.Value{})
		return out
	}
	args := []string{"tools", "ebpf", "status", "--mode", "all", "--json"}
	if iface != "" {
		args = append(args, "--interface", iface)
	}
	rc, out, stderr := sysutil.Run(e.S.String("sing_box_bin"), args, 120*time.Second)
	var data *jsonx.OrderMap
	if parsed, err := jsonx.Parse(out); err == nil {
		if obj, ok := parsed.(*jsonx.OrderMap); ok {
			data = obj
		}
	}
	if data == nil {
		data = jsonx.NewOrderMap()
		data.Set("findings", []jsonx.Value{})
		data.Set("raw", out)
		data.Set("stderr", stderr)
	}
	data.Set("exit_code", rc)
	required := false
	if summary, ok := data.Get("summary"); ok {
		if summaryMap, ok := summary.(*jsonx.OrderMap); ok {
			if value, ok := summaryMap.Get("required_issues"); ok {
				required = !isZeroValue(value)
			}
		}
	}
	data.Set("ok", rc == 0 && !required)
	return data
}

func isZeroValue(value jsonx.Value) bool {
	switch v := value.(type) {
	case nil:
		return true
	case float64:
		return v == 0
	case int:
		return v == 0
	case json.Number:
		return v.String() == "0"
	default:
		return false
	}
}

func intList(local *jsonx.OrderMap, key string) []int {
	var out []int
	if value, ok := local.Get(key); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			for _, item := range arr {
				switch v := item.(type) {
				case float64:
					out = append(out, int(v))
				case json.Number:
					if n, err := v.Int64(); err == nil {
						out = append(out, int(n))
					}
				}
			}
		}
	}
	return out
}

func intsToValues(list []int) []jsonx.Value {
	out := make([]jsonx.Value, 0, len(list))
	for _, item := range list {
		out = append(out, item)
	}
	return out
}

func sortedUniqueInts(values []jsonx.Value) []jsonx.Value {
	seen := map[int]bool{}
	var out []int
	for _, value := range values {
		if n, ok := toIntValue(value); ok && !seen[int(n)] {
			seen[int(n)] = true
			out = append(out, int(n))
		}
	}
	sort.Ints(out)
	return intsToValues(out)
}

func toIntValue(value jsonx.Value) (int64, bool) {
	switch v := value.(type) {
	case int64:
		return v, true
	case float64:
		return int64(v), true
	case json.Number:
		n, err := v.Int64()
		return n, err == nil
	default:
		return 0, false
	}
}

func strOr(local *jsonx.OrderMap, key, fallback string) string {
	if value, ok := local.Get(key); ok {
		if str, ok := value.(string); ok && str != "" {
			return str
		}
	}
	return fallback
}

// ── apps ────────────────────────────────────────────────────────────────────

type appEntry struct {
	uid   int
	names []string
	execs []string
	pids  []int
	icon  string
}

// ListApps ports list_apps(): aggregate /proc processes per uid, then label
// them via .desktop files under /usr/share/applications.
func ListApps(procRoot string, desktopDirs []string) []jsonx.Value {
	apps := map[int]*appEntry{}
	ensure := func(uid int) *appEntry {
		entry, ok := apps[uid]
		if !ok {
			entry = &appEntry{uid: uid}
			apps[uid] = entry
		}
		return entry
	}
	entries, err := os.ReadDir(procRoot)
	if err == nil {
		for _, entry := range entries {
			if !isDigits(entry.Name()) {
				continue
			}
			procPath := filepath.Join(procRoot, entry.Name())
			info, err := os.Stat(procPath)
			if err != nil {
				continue
			}
			rawCmdline, err := os.ReadFile(filepath.Join(procPath, "cmdline"))
			if err != nil {
				continue
			}
			exe := ""
			if target, err := os.Readlink(filepath.Join(procPath, "exe")); err == nil {
				exe = filepath.Base(target)
			}
			uid := -1
			if stat, ok := info.Sys().(*syscall.Stat_t); ok {
				uid = int(stat.Uid)
			}
			if uid < 0 {
				continue
			}
			appEntry := ensure(uid)
			if pid, err := strconv.Atoi(entry.Name()); err == nil {
				appEntry.pids = append(appEntry.pids, pid)
			}
			first := ""
			parts := strings.Split(string(rawCmdline), "\x00")
			if len(parts) > 0 && parts[0] != "" {
				first = parts[0]
			} else {
				first = exe
			}
			if first != "" {
				appEntry.execs = append(appEntry.execs, filepath.Base(first))
			}
		}
	}

	for _, dir := range desktopDirs {
		desktopEntries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range desktopEntries {
			if !strings.HasSuffix(entry.Name(), ".desktop") {
				continue
			}
			file, err := os.Open(filepath.Join(dir, entry.Name()))
			if err != nil {
				continue
			}
			name, execLine, icon := "", "", ""
			scanner := bufio.NewScanner(file)
			for scanner.Scan() {
				line := scanner.Text()
				switch {
				case strings.HasPrefix(line, "Name=") && name == "":
					name = strings.TrimSpace(line[5:])
				case strings.HasPrefix(line, "Exec=") && execLine == "":
					execLine = strings.TrimSpace(line[5:])
				case strings.HasPrefix(line, "Icon=") && icon == "":
					icon = strings.TrimSpace(line[7:])
				}
			}
			file.Close()
			fields := strings.Fields(fieldCodeRe.ReplaceAllString(execLine, ""))
			if len(fields) == 0 {
				continue
			}
			binary := filepath.Base(fields[0])
			if binary == "" {
				continue
			}
			for _, app := range apps {
				if containsStr(app.execs, binary) || anySubstring(binary, app.execs) {
					if name != "" && !containsStr(app.names, name) {
						app.names = append(app.names, name)
					}
					if app.icon == "" {
						app.icon = icon
					}
				}
			}
		}
	}

	keys := make([]int, 0, len(apps))
	for uid := range apps {
		keys = append(keys, uid)
	}
	sort.Ints(keys)
	out := make([]jsonx.Value, 0, len(apps))
	for _, uid := range keys {
		entry := apps[uid]
		execValues := uniqueSortedLimit(entry.execs, 6)
		pidValues := uniqueSortedIntLimit(entry.pids, 30)
		label := ""
		if len(entry.names) > 0 {
			label = strings.Join(entry.names, " / ")
		} else if len(execValues) > 0 {
			label = strOf(execValues[0])
		} else {
			label = fmt.Sprintf("UID %d", uid)
		}
		obj := jsonx.NewOrderMap()
		obj.Set("uid", uid)
		obj.Set("label", label)
		obj.Set("execs", execValues)
		obj.Set("pids", pidValues)
		obj.Set("names", stringsToValues(entry.names))
		obj.Set("icon", entry.icon)
		out = append(out, obj)
	}
	// Python sorts by (uid, label); uid is unique per entry so this matches.
	return out
}

// JSONMarshaller re-encodes a value through encoding/json for raw passthrough
// bodies (probe data keeps arbitrary keys, so it is sent as-is).
func JSONMarshal(value jsonx.Value) []byte {
	raw, _ := json.Marshal(value)
	return raw
}

func containsStr(list []string, needle string) bool {
	for _, item := range list {
		if item == needle {
			return true
		}
	}
	return false
}

func anySubstring(needle string, list []string) bool {
	for _, item := range list {
		if strings.Contains(item, needle) {
			return true
		}
	}
	return false
}

func uniqueSortedLimit(list []string, limit int) []jsonx.Value {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range list {
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	sort.Strings(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return stringsToValues(out)
}

func uniqueSortedIntLimit(list []int, limit int) []jsonx.Value {
	seen := map[int]bool{}
	out := []int{}
	for _, item := range list {
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	sort.Ints(out)
	if len(out) > limit {
		out = out[:limit]
	}
	values := make([]jsonx.Value, 0, len(out))
	for _, item := range out {
		values = append(values, item)
	}
	return values
}

func stringsToValues(list []string) []jsonx.Value {
	out := make([]jsonx.Value, 0, len(list))
	for _, item := range list {
		out = append(out, item)
	}
	return out
}

func strOf(value jsonx.Value) string {
	if str, ok := value.(string); ok {
		return str
	}
	return fmt.Sprintf("%v", value)
}

var fieldCodeRe = regexp.MustCompile(`%[a-zA-Z]`)

func isDigits(text string) bool {
	if text == "" {
		return false
	}
	for _, r := range text {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
