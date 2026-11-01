package subs

import (
	"os"
	"testing"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
)

func writeFile(path, text string) error {
	return os.WriteFile(path, []byte(text), 0o600)
}

func writeConfigFile(s *settings.Settings, text string) error {
	return writeFile(s.SingBoxConfigPath(), text)
}

func TestApplyRebuildsManagedGroups(t *testing.T) {
	st, s := newTestSubs(t)
	config := `{
		"inbounds": [],
		"outbounds": [
			{"type": "direct", "tag": "direct"},
			{"type": "selector", "tag": "Proxy", "outbounds": ["direct", "Old-Managed-A"]},
			{"type": "urltest", "tag": "Auto", "outbounds": ["direct", "Old-Managed-B"]},
			{"type": "shadowsocks", "tag": "Old-Managed-A"},
			{"type": "shadowsocks", "tag": "Old-Managed-B"}
		]
	}`
	writeConfig(t, s, config)
	// Simulate a previous apply that recorded the two managed nodes.
	managed := `{"outbound_tags": ["Old-Managed-A", "Old-Managed-B"],
		"group_members": {"Proxy": ["Old-Managed-A"], "Auto": ["Old-Managed-B"]},
		"updated": 1, "by_subscription": {"beef": ["Old-Managed-A", "Old-Managed-B"]}}`
	if err := storeSubscriptions(s, `[]`); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.ManagedFile(), []byte(managed), 0o600); err != nil {
		t.Fatal(err)
	}
	// Two enabled subscriptions with node lists.
	store := `[{"id":"aa11","name":"s1","url":"","enabled":true,"nodes":[
			{"type":"trojan","tag":"香港 01","server":"a","server_port":1},
			{"type":"trojan","tag":"香港 01","server":"b","server_port":1}]},
		{"id":"bb22","name":"s2","url":"","enabled":false,"nodes":[
			{"type":"trojan","tag":"disabled","server":"c","server_port":1}]}]`
	if err := storeSubscriptions(s, store); err != nil {
		t.Fatal(err)
	}

	applied := jsonx.Value(nil)
	st.ApplyFn = func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap {
		applied = cfg
		out := jsonx.NewOrderMap()
		out.Set("ok", true)
		out.Set("message", "ok")
		return out
	}

	result := st.Apply()
	if ok, _ := result.Get("ok"); ok != true {
		t.Fatalf("apply failed: %v", result.Keys())
	}
	if applied == nil {
		t.Fatal("config apply was not called")
	}
	doc := applied.(*jsonx.OrderMap)
	var tags []string
	for _, item := range arrField(doc, "outbounds") {
		obj := item.(*jsonx.OrderMap)
		tag, _ := obj.Get("tag")
		tags = append(tags, strValue(tag))
	}
	// Old managed tags removed; duplicates renamed with #2; disabled sub skipped.
	joined := ""
	for _, tag := range tags {
		joined += tag + ","
	}
	for _, want := range []string{"direct,", "Proxy,", "Auto,", "香港 01,", "香港 01 #2,"} {
		if !contains(joined, want) {
			t.Fatalf("missing %q in %q", want, joined)
		}
	}
	if contains(joined, "Old-Managed-A") || contains(joined, "disabled") {
		t.Fatalf("stale managed/disabled nodes present: %q", joined)
	}

	// Proxy/Auto groups re-membered: manual members kept first, new appended.
	var proxyMembers, autoMembers string
	for _, item := range arrField(doc, "outbounds") {
		obj := item.(*jsonx.OrderMap)
		tag, _ := obj.Get("tag")
		if strValue(tag) == "Proxy" {
			proxyMembers = joinField(obj, "outbounds")
		}
		if strValue(tag) == "Auto" {
			autoMembers = joinField(obj, "outbounds")
		}
	}
	if proxyMembers != "direct,香港 01,香港 01 #2," {
		t.Fatalf("Proxy members = %q", proxyMembers)
	}
	if autoMembers != "direct,香港 01,香港 01 #2," {
		t.Fatalf("Auto members = %q", autoMembers)
	}

	// managed.json rewritten on success.
	managedOut := s.Managed()
	outTags, _ := managedOut.Get("outbound_tags")
	joinedTags := joinValues(toSlice(outTags))
	if !contains(joinedTags, "香港 01,") || !contains(joinedTags, "香港 01 #2,") {
		t.Fatalf("managed outbound_tags = %q", joinedTags)
	}
}

// Re-applying the same subscription after managed.json is lost must be
// idempotent: identical outbounds are reused instead of cloned as "tag #2".
func TestApplyIsIdempotentWithoutManagedState(t *testing.T) {
	st, s := newTestSubs(t)
	config := `{
		"inbounds": [],
		"outbounds": [
			{"type": "direct", "tag": "direct"},
			{"type": "selector", "tag": "Proxy", "outbounds": ["direct", "Node-A"]},
			{"type": "shadowsocks", "tag": "Node-A", "server": "a", "server_port": 1}
		]
	}`
	writeConfig(t, s, config)
	if err := storeSubscriptions(s, `[{"id":"aa11","name":"s1","url":"","enabled":true,"nodes":[
		{"type":"shadowsocks","tag":"Node-A","server":"a","server_port":1}]}]`); err != nil {
		t.Fatal(err)
	}
	// No managed.json on purpose — the previous bookkeeping is gone.

	var applied *jsonx.OrderMap
	st.ApplyFn = func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap {
		applied = cfg
		out := jsonx.NewOrderMap()
		out.Set("ok", true)
		out.Set("message", "ok")
		return out
	}

	result := st.Apply()
	if ok, _ := result.Get("ok"); ok != true {
		t.Fatal("apply failed")
	}
	if reused, _ := result.Get("reused"); reused != float64(1) && reused != 1 {
		t.Fatalf("reused = %v, want 1", reused)
	}

	var tags []string
	for _, item := range arrField(applied, "outbounds") {
		obj := item.(*jsonx.OrderMap)
		tag, _ := obj.Get("tag")
		tags = append(tags, strValue(tag))
	}
	if len(tags) != 3 {
		t.Fatalf("outbounds changed despite identical node: %v", tags)
	}
	for _, tag := range tags {
		if tag == "Node-A #2" {
			t.Fatalf("duplicate node created: %v", tags)
		}
	}
}

// Restoring an older backup leaves managed.json pointing at tags the config no
// longer has; ReconcileManaged drops them.
func TestReconcileManagedPrunesStaleTags(t *testing.T) {
	st, s := newTestSubs(t)
	writeConfig(t, s, `{"outbounds":[
		{"type":"direct","tag":"direct"},
		{"type":"shadowsocks","tag":"Keep-1"}
	]}`)
	managed := `{"outbound_tags":["Gone-1","Keep-1"],
		"group_members":{"Proxy":["Gone-1","Keep-1"]},
		"by_subscription":{"aa":["Gone-1"]},
		"updated":1}`
	if err := os.WriteFile(s.ManagedFile(), []byte(managed), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := s.LoadSingBoxConfig()
	if err != nil {
		t.Fatal(err)
	}
	if pruned := st.ReconcileManaged(cfg); pruned != 3 {
		t.Fatalf("pruned = %d, want 3", pruned)
	}

	after := s.Managed()
	tags, _ := after.Get("outbound_tags")
	if joined := joinValues(toSlice(tags)); joined != "Keep-1," {
		t.Fatalf("outbound_tags = %q", joined)
	}
	groups, _ := after.Get("group_members")
	proxy, _ := groups.(*jsonx.OrderMap)
	members, _ := proxy.Get("Proxy")
	if joined := joinValues(toSlice(members)); joined != "Keep-1," {
		t.Fatalf("Proxy members = %q", joined)
	}
	bySub, _ := after.Get("by_subscription")
	perSub, _ := bySub.(*jsonx.OrderMap)
	left, _ := perSub.Get("aa")
	if joined := joinValues(toSlice(left)); joined != "" {
		t.Fatalf("by_subscription[aa] = %q", joined)
	}
}

func joinField(obj *jsonx.OrderMap, key string) string {
	out := ""
	for _, item := range arrField(obj, key) {
		out += strValue(item) + ","
	}
	return out
}

func joinValues(list []jsonx.Value) string {
	out := ""
	for _, item := range list {
		out += strValue(item) + ","
	}
	return out
}

// Manual removals and ordering recorded by the Policies page must survive a
// subscription apply.
func TestApplyHonorsGroupOverrides(t *testing.T) {
	st, s := newTestSubs(t)
	writeConfig(t, s, `{
		"inbounds": [],
		"outbounds": [
			{"type": "direct", "tag": "direct"},
			{"type": "selector", "tag": "Proxy", "outbounds": ["direct"]}
		]
	}`)
	managed := `{"outbound_tags": [],
		"group_members": {},
		"group_overrides": {"Proxy": {"exclude": ["B"], "order": ["C", "A"]}},
		"updated": 1}`
	if err := os.WriteFile(s.ManagedFile(), []byte(managed), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := storeSubscriptions(s, `[{"id":"aa11","name":"s1","url":"","enabled":true,"nodes":[
		{"type":"trojan","tag":"A","server":"a","server_port":1},
		{"type":"trojan","tag":"B","server":"b","server_port":1},
		{"type":"trojan","tag":"C","server":"c","server_port":1}]}]`); err != nil {
		t.Fatal(err)
	}

	var applied *jsonx.OrderMap
	st.ApplyFn = func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap {
		applied = cfg
		out := jsonx.NewOrderMap()
		out.Set("ok", true)
		out.Set("message", "ok")
		return out
	}
	if result := st.Apply(); func() bool { ok, _ := result.Get("ok"); return ok == true }() != true {
		t.Fatal("apply failed")
	}

	var members string
	for _, item := range arrField(applied, "outbounds") {
		obj := item.(*jsonx.OrderMap)
		if strValue(func() jsonx.Value { v, _ := obj.Get("tag"); return v }()) == "Proxy" {
			members = joinField(obj, "outbounds")
		}
	}
	if members != "direct,C,A," {
		t.Fatalf("Proxy members = %q, want direct,C,A", members)
	}
}

// A node the user removed from a managed group must not come back on the next
// subscription apply.
func TestApplySkipsExcludedNodes(t *testing.T) {
	st, s := newTestSubs(t)
	writeConfig(t, s, `{"inbounds":[],"outbounds":[{"type":"direct","tag":"direct"}]}`)
	if err := os.WriteFile(s.ManagedFile(), []byte(`{"outbound_tags":[],"group_members":{},"node_exclude":["B"],"updated":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := storeSubscriptions(s, `[{"id":"aa11","name":"s1","url":"","enabled":true,"nodes":[
		{"type":"trojan","tag":"A","server":"a","server_port":1},
		{"type":"trojan","tag":"B","server":"b","server_port":1}]}]`); err != nil {
		t.Fatal(err)
	}

	var applied *jsonx.OrderMap
	st.ApplyFn = func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap {
		applied = cfg
		out := jsonx.NewOrderMap()
		out.Set("ok", true)
		out.Set("message", "ok")
		return out
	}
	result := st.Apply()
	if ok, _ := result.Get("ok"); ok != true {
		t.Fatal("apply failed")
	}
	if excluded, _ := result.Get("excluded"); excluded != 1 && excluded != float64(1) {
		t.Fatalf("excluded = %v, want 1", excluded)
	}
	var tags string
	for _, item := range arrField(applied, "outbounds") {
		obj := item.(*jsonx.OrderMap)
		tag, _ := obj.Get("tag")
		tags += strValue(tag) + ","
	}
	if contains(tags, "B,") {
		t.Fatalf("excluded node present: %s", tags)
	}
	if !contains(tags, "A,") {
		t.Fatalf("included node missing: %s", tags)
	}
}
