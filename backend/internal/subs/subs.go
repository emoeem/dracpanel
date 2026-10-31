// Package subs ports the subscription subsystem: store, fetch, parsers for
// URI lists and Clash YAML, the managed-outbound apply and the scheduler.
package subs

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/singbox"
	"github.com/emoeem/dracpanel/backend/internal/sysutil"
)

// Subscriptions owns subscriptions.json and managed.json.
type Subscriptions struct {
	S       *settings.Settings
	Configs *singbox.Manager
	// ApplyFn overrides the config transaction in tests; nil = Configs.Apply.
	ApplyFn func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap

	mu      sync.Mutex
	Fetcher Fetcher
}

// Fetcher abstracts subscription download for tests.
type Fetcher func(url string) (ok bool, text string, userinfo map[string]int64)

// New builds the store with the real HTTP fetcher.
func New(s *settings.Settings, configs *singbox.Manager) *Subscriptions {
	subs := &Subscriptions{S: s, Configs: configs}
	subs.Fetcher = subs.httpFetch
	return subs
}

func okMap(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", true)
	m.Set("message", msg)
	return m
}

func errMap(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", false)
	m.Set("message", msg)
	return m
}

// NormalizeUpdateInterval ports normalize_update_interval: 0 disables,
// otherwise clamp to [300, 30 days].
func NormalizeUpdateInterval(value any) int {
	seconds := toInt(value)
	if seconds <= 0 {
		return 0
	}
	if seconds < 300 {
		seconds = 300
	}
	if seconds > 30*86400 {
		seconds = 30 * 86400
	}
	return seconds
}

func toInt(value any) int {
	switch v := value.(type) {
	case nil:
		return 0
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return 0
		}
		return n
	default:
		return 0
	}
}

// List ports Subscriptions.list(): read-time normalization; node_count is
// computed and the inline nodes are stripped from the API response.
func (st *Subscriptions) List() []jsonx.Value {
	st.mu.Lock()
	defer st.mu.Unlock()
	subs := st.S.Subscriptions()
	out := make([]jsonx.Value, 0, len(subs))
	for _, sub := range subs {
		nodes := arrField(sub, "nodes")
		sub.Set("node_count", len(nodes))
		sub.Delete("nodes")
		enabled := true
		if raw, ok := sub.Get("enabled"); ok {
			enabled = truthy(raw)
		}
		sub.Set("enabled", enabled)
		interval := NormalizeUpdateInterval(getOr(sub, "update_interval", int64(0)))
		sub.Set("update_interval", interval)
		lastAttempt := toInt(getOr(sub, "last_attempt", int64(0)))
		if lastAttempt == 0 {
			lastAttempt = toInt(getOr(sub, "last_update", int64(0)))
		}
		sub.Set("last_attempt", lastAttempt)
		if enabled && interval > 0 {
			sub.Set("next_update", lastAttempt+interval)
		} else {
			sub.Set("next_update", 0)
		}
		filtered := jsonx.NewOrderMap()
		if info, ok := sub.Get("userinfo"); ok {
			if infoMap, ok := info.(*jsonx.OrderMap); ok {
				for _, key := range []string{"upload", "download", "total", "expire"} {
					if value, ok := infoMap.Get(key); ok {
						if n, ok := toIntValue(value); ok {
							filtered.Set(key, n)
						}
					}
				}
			}
		}
		sub.Set("userinfo", filtered)
		out = append(out, sub)
	}
	return out
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

func truthy(value jsonx.Value) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(v, "true") || v == "1" || strings.EqualFold(v, "yes") || strings.EqualFold(v, "on")
	default:
		return false
	}
}

func getOr(sub *jsonx.OrderMap, key string, fallback jsonx.Value) jsonx.Value {
	if value, ok := sub.Get(key); ok && value != nil {
		return value
	}
	return fallback
}

func arrField(obj *jsonx.OrderMap, key string) []jsonx.Value {
	if value, ok := obj.Get(key); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			return arr
		}
	}
	return nil
}

// randomID mirrors secrets.token_hex(4): 8 lowercase hex chars.
func randomID() string {
	raw := make([]byte, 4)
	_, _ = rand.Read(raw)
	return hex.EncodeToString(raw)
}

// Add ports Subscriptions.add(): append + immediate fetch/update.
func (st *Subscriptions) Add(name, subURL string, enabled bool, updateInterval any) *jsonx.OrderMap {
	interval := updateInterval
	if interval == nil {
		interval = st.S.Get("subscription_update_interval")
	}
	host := ""
	if parsed, err := url.Parse(subURL); err == nil {
		host = parsed.Host
	}
	if host == "" {
		host = "订阅"
	}
	sub := jsonx.NewOrderMap()
	sub.Set("id", randomID())
	sub.Set("name", firstNonEmpty(name, host))
	sub.Set("url", subURL)
	sub.Set("enabled", enabled)
	sub.Set("update_interval", NormalizeUpdateInterval(interval))
	sub.Set("last_update", 0)
	sub.Set("last_attempt", 0)
	sub.Set("last_error", "")
	sub.Set("userinfo", jsonx.NewOrderMap())
	sub.Set("nodes", []jsonx.Value{})

	st.mu.Lock()
	subs := st.S.Subscriptions()
	subs = append(subs, sub)
	id, _ := sub.Get("id")
	_ = st.S.WriteJSON(st.S.SubsFile(), orderArrayOf(subs))
	st.mu.Unlock()

	return st.Update(fmt.Sprintf("%v", id))
}

// Remove ports Subscriptions.remove(): store-only, idempotent.
func (st *Subscriptions) Remove(id string) *jsonx.OrderMap {
	st.mu.Lock()
	defer st.mu.Unlock()
	subs := st.S.Subscriptions()
	kept := subs[:0]
	for _, sub := range subs {
		if subID, _ := sub.Get("id"); fmt.Sprintf("%v", subID) != id {
			kept = append(kept, sub)
		}
	}
	_ = st.S.WriteJSON(st.S.SubsFile(), orderArrayOf(kept))
	return okMap("已删除订阅")
}

// AddLocal registers a local (file-imported) subscription with inline nodes
// and no fetch URL. Used by POST /api/profiles/import.
func (st *Subscriptions) AddLocal(name string, nodes []*jsonx.OrderMap) *jsonx.OrderMap {
	sub := jsonx.NewOrderMap()
	sub.Set("id", randomID())
	sub.Set("name", firstNonEmpty(name, "本地配置"))
	sub.Set("url", "")
	sub.Set("enabled", true)
	sub.Set("update_interval", 0)
	sub.Set("last_update", time.Now().Unix())
	sub.Set("last_attempt", 0)
	sub.Set("last_error", "")
	sub.Set("userinfo", jsonx.NewOrderMap())
	sub.Set("nodes", nodesToValues(nodes))
	st.mu.Lock()
	subs := st.S.Subscriptions()
	subs = append(subs, sub)
	_ = st.S.WriteJSON(st.S.SubsFile(), orderArrayOf(subs))
	st.mu.Unlock()
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("message", fmt.Sprintf("导入成功：%d 个节点", len(nodes)))
	out.Set("nodes", len(nodes))
	out.Set("skipped", []jsonx.Value{})
	return out
}

// Update ports Subscriptions.update(): fetch outside the lock, then persist.
func (st *Subscriptions) Update(id string) *jsonx.OrderMap {
	var targetURL string
	st.mu.Lock()
	target := findByID(st.S.Subscriptions(), id)
	if target != nil {
		if u, ok := target.Get("url"); ok {
			targetURL, _ = u.(string)
		}
	}
	st.mu.Unlock()

	if target == nil {
		return errMap("找不到该订阅")
	}

	// 本地导入的配置文件没有 url：保留内联 nodes，不重新抓取。
	if targetURL == "" {
		st.mu.Lock()
		subs := st.S.Subscriptions()
		target = findByID(subs, id)
		if target == nil {
			st.mu.Unlock()
			return errMap("找不到该订阅")
		}
		nodes := arrField(target, "nodes")
		target.Set("last_update", time.Now().Unix())
		target.Set("last_error", "")
		_ = st.S.WriteJSON(st.S.SubsFile(), orderArrayOf(subs))
		st.mu.Unlock()
		msg := fmt.Sprintf("更新成功：%d 个节点", len(nodes))
		out := jsonx.NewOrderMap()
		out.Set("ok", len(nodes) > 0)
		out.Set("message", msg)
		out.Set("nodes", len(nodes))
		out.Set("skipped", []string{})
		return out
	}

	okc, text, userinfo := st.Fetcher(targetURL)

	st.mu.Lock()
	subs := st.S.Subscriptions()
	target = findByID(subs, id)
	if target == nil {
		st.mu.Unlock()
		return errMap("找不到该订阅")
	}
	target.Set("last_attempt", time.Now().Unix())
	if !okc {
		target.Set("last_error", text)
		_ = st.S.WriteJSON(st.S.SubsFile(), orderArrayOf(subs))
		st.mu.Unlock()
		return errMap(fmt.Sprintf("下载失败：%s", text))
	}
	nodes, skipped := ParseSubscription(text)
	target.Set("nodes", nodesToValues(nodes))
	target.Set("last_update", time.Now().Unix())
	if len(nodes) > 0 {
		target.Set("last_error", "")
	} else {
		target.Set("last_error", "未解析出任何节点")
	}
	target.Set("userinfo", userInfoMap(userinfo))
	_ = st.S.WriteJSON(st.S.SubsFile(), orderArrayOf(subs))
	st.mu.Unlock()

	msg := fmt.Sprintf("更新成功：%d 个节点", len(nodes))
	if len(skipped) > 0 {
		uniq := sortedUnique(skipped)
		head := uniq
		if len(head) > 6 {
			head = uniq[:6]
		}
		msg += fmt.Sprintf("，%d 个暂不支持（%s…）", len(uniq), strings.Join(head, "、"))
	}
	out := jsonx.NewOrderMap()
	out.Set("ok", len(nodes) > 0)
	out.Set("message", msg)
	out.Set("nodes", len(nodes))
	out.Set("skipped", stringSliceToValues(sortedUnique(skipped)))
	return out
}

// UpdateAll ports Subscriptions.update_all(): enabled subs only, results
// carry {name, ok, message, nodes, skipped} without id.
func (st *Subscriptions) UpdateAll() *jsonx.OrderMap {
	allOK := true
	results := []jsonx.Value{}
	for _, value := range st.List() {
		sub, ok := value.(*jsonx.OrderMap)
		if !ok || !truthy(getOr(sub, "enabled", true)) {
			continue
		}
		name, _ := sub.Get("name")
		id, _ := sub.Get("id")
		result := st.Update(fmt.Sprintf("%v", id))
		entry := jsonx.NewOrderMap()
		entry.Set("name", name)
		for _, key := range result.Keys() {
			v, _ := result.Get(key)
			entry.Set(key, v)
		}
		if okv, _ := entry.Get("ok"); okv == false {
			allOK = false
		}
		results = append(results, entry)
	}
	out := jsonx.NewOrderMap()
	out.Set("ok", len(results) > 0 && allOK)
	out.Set("results", results)
	return out
}

// Configure ports Subscriptions.configure() (the schedule endpoint).
func (st *Subscriptions) Configure(id string, updateInterval any, enabled any) *jsonx.OrderMap {
	st.mu.Lock()
	defer st.mu.Unlock()
	subs := st.S.Subscriptions()
	target := findByID(subs, id)
	if target == nil {
		return errMap("找不到该订阅")
	}
	if updateInterval != nil {
		target.Set("update_interval", NormalizeUpdateInterval(updateInterval))
	}
	if enabled != nil {
		if text, ok := enabled.(string); ok {
			enabled = strings.EqualFold(text, "1") || strings.EqualFold(text, "true") ||
				strings.EqualFold(text, "yes") || strings.EqualFold(text, "on")
		}
		target.Set("enabled", enabled)
	}
	_ = st.S.WriteJSON(st.S.SubsFile(), orderArrayOf(subs))
	interval := NormalizeUpdateInterval(getOr(target, "update_interval", int64(0)))
	active := interval > 0 && truthy(getOr(target, "enabled", true))
	if active {
		return okMap("自动更新设置已保存")
	}
	return okMap("自动更新已关闭")
}

// RunDue updates every enabled subscription past its next_update.
func (st *Subscriptions) RunDue() {
	now := time.Now().Unix()
	for _, value := range st.List() {
		sub, ok := value.(*jsonx.OrderMap)
		if !ok {
			continue
		}
		if !truthy(getOr(sub, "enabled", true)) {
			continue
		}
		interval := toInt(getOr(sub, "update_interval", int64(0)))
		if interval <= 0 {
			continue
		}
		nextUpdate := toInt(getOr(sub, "next_update", int64(0)))
		if int64(nextUpdate) > now {
			continue
		}
		id, _ := sub.Get("id")
		name, _ := sub.Get("name")
		logf("自动更新订阅：%v", orAny(name, id))
		st.Update(fmt.Sprintf("%v", id))
	}
}

// Apply ports Subscriptions.apply(): rebuild managed outbounds, re-member the
// existing Proxy/Auto groups, run the config transaction, then persist
// managed.json on success.
func (st *Subscriptions) Apply() *jsonx.OrderMap {
	st.mu.Lock()
	defer st.mu.Unlock()

	enabledSubs := []*jsonx.OrderMap{}
	for _, value := range st.S.Subscriptions() {
		if truthy(getOr(value, "enabled", true)) {
			enabledSubs = append(enabledSubs, value)
		}
	}
	cfg, err := st.S.LoadSingBoxConfig()
	if err != nil {
		return errMap(err.Error())
	}
	managed := st.S.Managed()
	oldTags := map[string]bool{}
	if value, ok := managed.Get("outbound_tags"); ok {
		for _, tag := range toSlice(value) {
			oldTags[fmt.Sprintf("%v", tag)] = true
		}
	}

	keptOutbounds := []jsonx.Value{}
	for _, item := range arrField(cfg, "outbounds") {
		obj, ok := item.(*jsonx.OrderMap)
		if !ok {
			keptOutbounds = append(keptOutbounds, item)
			continue
		}
		tag, _ := obj.Get("tag")
		if oldTags[fmt.Sprintf("%v", tag)] {
			continue
		}
		keptOutbounds = append(keptOutbounds, item)
	}
	newTags := []string{}
	perSub := jsonx.NewOrderMap()

	existing := map[string]bool{}
	for _, item := range keptOutbounds {
		if obj, ok := item.(*jsonx.OrderMap); ok {
			tag, _ := obj.Get("tag")
			existing[fmt.Sprintf("%v", tag)] = true
		}
	}
	for _, sub := range enabledSubs {
		tags := []string{}
		subID, _ := sub.Get("id")
		subIDStr := fmt.Sprintf("%v", subID)
		for _, nodeValue := range arrField(sub, "nodes") {
			node, ok := nodeValue.(*jsonx.OrderMap)
			if !ok {
				continue
			}
			node = node.Clone()
			tag, _ := node.Get("tag")
			tagStr := strings.TrimSpace(fmt.Sprintf("%v", tag))
			if tagStr == "" || tagStr == "<nil>" {
				tagStr = "node"
			}
			base := tagStr
			i := 2
			for existing[tagStr] || containsStr(newTags, tagStr) {
				tagStr = fmt.Sprintf("%s #%d", base, i)
				i++
			}
			node.Set("tag", tagStr)
			keptOutbounds = append(keptOutbounds, node)
			newTags = append(newTags, tagStr)
			tags = append(tags, tagStr)
		}
		perSub.Set(subIDStr, stringSliceToValues(tags))
	}

	// 组：默认托管 Proxy（selector）与 Auto（urltest）；组必须已存在于配置中，
	// 面板只重整成员（剔除上次托管成员，保留手工成员在前，新成员追加）。
	membersMap := jsonx.NewOrderMap()
	groupTag := st.S.String("managed_group")
	if groupTag != "" && len(newTags) > 0 {
		membersMap.Set(groupTag, stringSliceToValues(newTags))
	}
	urltestTag := st.S.String("managed_urltest")
	if urltestTag != "" && len(newTags) > 0 {
		membersMap.Set(urltestTag, stringSliceToValues(newTags))
	}

	byTag := map[string]*jsonx.OrderMap{}
	for _, item := range keptOutbounds {
		if obj, ok := item.(*jsonx.OrderMap); ok {
			tag, _ := obj.Get("tag")
			byTag[fmt.Sprintf("%v", tag)] = obj
		}
	}
	for _, groupTag := range membersMap.Keys() {
		membersValue, _ := membersMap.Get(groupTag)
		node, found := byTag[groupTag]
		if !found {
			continue
		}
		previous := map[string]bool{}
		if gm, ok := managed.Get("group_members"); ok {
			if gmMap, ok := gm.(*jsonx.OrderMap); ok {
				if prev, ok := gmMap.Get(groupTag); ok {
					for _, member := range toSlice(prev) {
						previous[fmt.Sprintf("%v", member)] = true
					}
				}
			}
		}
		kept := []jsonx.Value{}
		for _, member := range arrField(node, "outbounds") {
			if !previous[fmt.Sprintf("%v", member)] {
				kept = append(kept, member)
			}
		}
		kept = append(kept, toSlice(membersValue)...)
		node.Set("outbounds", kept)
	}

	cfg.Set("outbounds", keptOutbounds)
	apply := st.ApplyFn
	if apply == nil {
		apply = st.Configs.Apply
	}
	result := apply(cfg, "subscriptions-apply", true)
	if okValue, _ := result.Get("ok"); okValue == true {
		out := jsonx.NewOrderMap()
		out.Set("outbound_tags", stringSliceToValues(newTags))
		out.Set("group_members", membersMap)
		out.Set("updated", time.Now().Unix())
		out.Set("by_subscription", perSub)
		_ = st.S.WriteJSON(st.S.ManagedFile(), out)
	}
	return result
}

func toSlice(value jsonx.Value) []jsonx.Value {
	if arr, ok := value.([]jsonx.Value); ok {
		return arr
	}
	return nil
}

func orderArrayOf(items []*jsonx.OrderMap) jsonx.Value {
	out := make([]jsonx.Value, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func nodesToValues(nodes []*jsonx.OrderMap) jsonx.Value {
	return orderArrayOf(nodes)
}

func userInfoMap(info map[string]int64) *jsonx.OrderMap {
	out := jsonx.NewOrderMap()
	for _, key := range []string{"upload", "download", "total", "expire"} {
		if value, ok := info[key]; ok {
			out.Set(key, value)
		}
	}
	return out
}

func findByID(subs []*jsonx.OrderMap, id string) *jsonx.OrderMap {
	for _, sub := range subs {
		if subID, _ := sub.Get("id"); fmt.Sprintf("%v", subID) == id {
			return sub
		}
	}
	return nil
}

func containsStr(list []string, needle string) bool {
	for _, item := range list {
		if item == needle {
			return true
		}
	}
	return false
}

func sortedUnique(list []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range list {
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	sort.Strings(out)
	return out
}

func stringSliceToValues(list []string) []jsonx.Value {
	out := make([]jsonx.Value, 0, len(list))
	for _, item := range list {
		out = append(out, item)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func orAny(value, fallback any) any {
	switch v := value.(type) {
	case string:
		if v != "" {
			return v
		}
	case nil:
		return fallback
	}
	if value != nil && fmt.Sprintf("%v", value) != "" {
		return value
	}
	return fallback
}

// Scheduler runs RunDue on a fixed tick (skipped in dry-run).
type Scheduler struct {
	Subs *Subscriptions
	S    *settings.Settings
}

// Start launches the background loop.
func (s *Scheduler) Start() {
	if s.S.DryRun {
		return
	}
	go func() {
		tick := time.Duration(s.S.Int("subscription_scheduler_tick", 30)) * time.Second
		if tick < 5*time.Second {
			tick = 5 * time.Second
		}
		for {
			func() {
				defer func() {
					if r := recover(); r != nil {
						logf("订阅自动更新出错：%v", r)
					}
				}()
				s.Subs.RunDue()
			}()
			time.Sleep(tick)
		}
	}()
}

func logf(format string, args ...any) {
	sysutil.Logf(format, args...)
}
