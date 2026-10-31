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
