package subs

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
)

func base64Encode(text string) string {
	return base64.StdEncoding.EncodeToString([]byte(text))
}

func newTestSubs(t *testing.T) (*Subscriptions, *settings.Settings) {
	t.Helper()
	dir := t.TempDir()
	s, err := settings.Load("", false)
	if err != nil {
		t.Fatal(err)
	}
	s.Data["state_dir"] = dir
	s.Data["sing_box_config"] = dir + "/sing-box.json"
	s.Data["subscription_proxy"] = ""
	st := New(s, nil)
	return st, s
}

func writeConfig(t *testing.T, s *settings.Settings, text string) {
	t.Helper()
	if err := writeConfigFile(s, text); err != nil {
		t.Fatal(err)
	}
}

func TestListNormalization(t *testing.T) {
	st, s := newTestSubs(t)
	store := `[{"id":"abcd1234","name":"sub","url":"https://x/y","enabled":true,
	 "update_interval":60,"last_attempt":100,"userinfo":{"upload":"5","download":7,"total":100,"expire":9,"bogus":1},
	 "nodes":[{"type":"direct","tag":"n1"}]}]`
	writeConfig(t, s, `{"outbounds":[],"inbounds":[]}`)
	if err := storeSubscriptions(s, store); err != nil {
		t.Fatal(err)
	}
	list := st.List()
	if len(list) != 1 {
		t.Fatalf("list len = %d", len(list))
	}
	sub := list[0].(*jsonx.OrderMap)
	if got := num(t, sub, "node_count"); got != 1 {
		t.Fatalf("node_count = %d", got)
	}
	if _, exists := sub.Get("nodes"); exists {
		t.Fatal("nodes must be popped from the response")
	}
	if got := num(t, sub, "update_interval"); got != 300 {
		t.Fatalf("interval clamp = %d", got)
	}
	if got := num(t, sub, "next_update"); got != 400 {
		t.Fatalf("next_update = %d", got)
	}
	info := nodeValue(t, sub, "userinfo").(*jsonx.OrderMap)
	if _, ok := info.Get("upload"); ok {
		t.Fatal("string userinfo values must be dropped")
	}
	if got := num(t, info, "download"); got != 7 {
		t.Fatalf("download = %d", got)
	}
	if _, ok := info.Get("bogus"); ok {
		t.Fatal("unknown userinfo keys must be dropped")
	}
}

func TestAddAndUpdateWithFakeFetcher(t *testing.T) {
	st, s := newTestSubs(t)
	writeConfig(t, s, `{"inbounds":[],"outbounds":[]}`)
	var fetchedURL string
	st.Fetcher = func(target string) (bool, string, map[string]int64) {
		fetchedURL = target
		body := base64Encode("trojan://pw@1.2.3.4:443#n1\nhysteria://bad")
		return true, body, map[string]int64{"upload": 1, "download": 2, "total": 10, "expire": 20}
	}
	result := st.Add("我的订阅", "https://example.com/sub", true, nil)
	if ok, _ := result.Get("ok"); ok != true {
		t.Fatalf("add result = %v", result.Keys())
	}
	if fetchedURL != "https://example.com/sub" {
		t.Fatalf("fetched %q", fetchedURL)
	}
	list := st.List()
	sub := list[0].(*jsonx.OrderMap)
	if got := str(t, sub, "name"); got != "我的订阅" {
		t.Fatalf("name = %q", got)
	}
	if got := num(t, sub, "node_count"); got != 1 {
		t.Fatalf("node_count = %d", got)
	}
	// 更新成功：1 个节点，1 个暂不支持（hysteria…）
	if got := str(t, result, "message"); !contains(got, "更新成功：1 个节点") || !contains(got, "hysteria") {
		t.Fatalf("message = %q", got)
	}
}

func TestUpdateFailureRecordsError(t *testing.T) {
	st, s := newTestSubs(t)
	writeConfig(t, s, `{"inbounds":[],"outbounds":[]}`)
	st.Fetcher = func(string) (bool, string, map[string]int64) {
		return false, "connection refused", nil
	}
	result := st.Add("x", "https://example.com/sub", true, nil)
	if ok, _ := result.Get("ok"); ok != false {
		t.Fatal("fetch failure must not be ok")
	}
	if got := str(t, result, "message"); !contains(got, "下载失败：connection refused") {
		t.Fatalf("message = %q", got)
	}
	list := st.List()
	sub := list[0].(*jsonx.OrderMap)
	if got := str(t, sub, "last_error"); got != "connection refused" {
		t.Fatalf("last_error = %q", got)
	}
}

func TestConfigureClampsInterval(t *testing.T) {
	st, s := newTestSubs(t)
	writeConfig(t, s, `{"inbounds":[],"outbounds":[]}`)
	st.Fetcher = func(string) (bool, string, map[string]int64) { return true, "", nil }
	result := st.Add("x", "https://example.com/sub", true, nil)
	id := subIDFromResult(t, result, s)
	got := st.Configure(id, float64(3600), "true")
	if str(t, got, "message") != "自动更新设置已保存" {
		t.Fatalf("configure = %v", got.Keys())
	}
	got = st.Configure(id, float64(10), "0")
	if str(t, got, "message") != "自动更新已关闭" {
		t.Fatalf("disable = %v", got.Keys())
	}
	list := st.List()
	sub := list[0].(*jsonx.OrderMap)
	if got := num(t, sub, "update_interval"); got != 300 {
		t.Fatalf("interval = %d", got)
	}
}

func subIDFromResult(t *testing.T, result *jsonx.OrderMap, s *settings.Settings) string {
	t.Helper()
	list := stList(s)
	if len(list) == 0 {
		t.Fatal("no subscriptions")
	}
	sub := list[0].(*jsonx.OrderMap)
	id, _ := sub.Get("id")
	return strValue(id)
}

func storeSubscriptions(s *settings.Settings, text string) error {
	return writeFile(s.SubsFile(), text)
}

func stList(s *settings.Settings) []jsonx.Value {
	value := s.ReadJSON(s.SubsFile(), jsonx.Value([]jsonx.Value{}))
	arr, _ := value.([]jsonx.Value)
	return arr
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (haystack == needle || indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

var _ = time.Now
