package subs

import (
	"strings"
	"testing"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

func str(t *testing.T, obj *jsonx.OrderMap, key string) string {
	t.Helper()
	value, ok := obj.Get(key)
	if !ok {
		t.Fatalf("missing key %q", key)
	}
	return strValue(value)
}

func num(t *testing.T, obj *jsonx.OrderMap, key string) int {
	t.Helper()
	value, _ := obj.Get(key)
	return toInt(value)
}

func TestParseSS_SIP002(t *testing.T) {
	node, kind := ParseLink("ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@192.168.1.1:8388#HK%2001")
	if kind != "" || node == nil {
		t.Fatalf("kind=%q node=%v", kind, node)
	}
	if got := str(t, node, "type"); got != "shadowsocks" {
		t.Fatalf("type = %q", got)
	}
	if got := str(t, node, "method"); got != "aes-256-gcm" {
		t.Fatalf("method = %q", got)
	}
	if got := str(t, node, "password"); got != "password" {
		t.Fatalf("password = %q", got)
	}
	if got := str(t, node, "server"); got != "192.168.1.1" {
		t.Fatalf("server = %q", got)
	}
	if got := num(t, node, "server_port"); got != 8388 {
		t.Fatalf("port = %d", got)
	}
	if got := str(t, node, "tag"); got != "HK 01" {
		t.Fatalf("tag = %q", got)
	}
}

func TestParseSS_Plugin(t *testing.T) {
	node, kind := ParseLink("ss://YWVzLTI1Ni1nY206cHc@1.2.3.4:443?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dexample.com#n")
	if kind != "" || node == nil {
		t.Fatalf("kind=%q", kind)
	}
	if got := str(t, node, "plugin"); got != "obfs-local" {
		t.Fatalf("plugin = %q", got)
	}
	if got := str(t, node, "plugin_opts"); got != "obfs=http;obfs-host=example.com" {
		t.Fatalf("plugin_opts = %q", got)
	}
}

func TestParseSS_LegacyBase64(t *testing.T) {
	// whole-body base64: method:password@host:port
	link := "ss://" + base64Std("aes-128-gcm:secret@5.6.7.8:9999")
	node, kind := ParseLink(link)
	if kind != "" || node == nil {
		t.Fatalf("kind=%q", kind)
	}
	if got := str(t, node, "method"); got != "aes-128-gcm" {
		t.Fatalf("method = %q", got)
	}
	if got := num(t, node, "server_port"); got != 9999 {
		t.Fatalf("port = %d", got)
	}
}

func TestParseVMess(t *testing.T) {
	payload := `{"v":"2","ps":"东京 01","add":"tokyo.example.com","port":"443","id":"uuid-1","scy":"auto","aid":"0","net":"ws","host":"cdn.example.com","path":"/ws","tls":"tls","sni":"sni.example.com"}`
	node, kind := ParseLink("vmess://" + base64Std(payload))
	if kind != "" || node == nil {
		t.Fatalf("kind=%q", kind)
	}
	if got := str(t, node, "tag"); got != "东京 01" {
		t.Fatalf("tag = %q", got)
	}
	if got := str(t, node, "server"); got != "tokyo.example.com" {
		t.Fatalf("server = %q", got)
	}
	if got := num(t, node, "server_port"); got != 443 {
		t.Fatalf("port = %d", got)
	}
	tlsValue, _ := node.Get("tls")
	tlsMap := tlsValue.(*jsonx.OrderMap)
	if got := str(t, tlsMap, "server_name"); got != "sni.example.com" {
		t.Fatalf("sni = %q", got)
	}
	trValue, _ := node.Get("transport")
	tr := trValue.(*jsonx.OrderMap)
	if got := str(t, tr, "type"); got != "ws" {
		t.Fatalf("transport = %q", got)
	}
	headersValue, _ := tr.Get("headers")
	headers := headersValue.(*jsonx.OrderMap)
	if got := str(t, headers, "Host"); got != "cdn.example.com" {
		t.Fatalf("host header = %q", got)
	}
}

func TestParseVLESS_RealityWS(t *testing.T) {
	link := "vless://uuid-2@example.com:443?security=reality&pbk=pubkey&sid=abcd&fp=chrome&flow=xtls-rprx-vision&type=ws&path=%2Fw&encryption=none#US"
	node, kind := ParseLink(link)
	if kind != "" || node == nil {
		t.Fatalf("kind=%q", kind)
	}
	if got := str(t, node, "flow"); got != "xtls-rprx-vision" {
		t.Fatalf("flow = %q", got)
	}
	tlsMap := nodeValue(t, node, "tls").(*jsonx.OrderMap)
	realityValue, ok := tlsMap.Get("reality")
	if !ok {
		t.Fatal("missing reality")
	}
	reality := realityValue.(*jsonx.OrderMap)
	if got := str(t, reality, "public_key"); got != "pubkey" {
		t.Fatalf("pbk = %q", got)
	}
	utlsValue, _ := tlsMap.Get("utls")
	utls := utlsValue.(*jsonx.OrderMap)
	if got := str(t, utls, "fingerprint"); got != "chrome" {
		t.Fatalf("fp = %q", got)
	}
}

func TestParseTrojanForcesTLS(t *testing.T) {
	node, kind := ParseLink("trojan://pw@trojan.example.com:443?sni=t.example.com#t")
	if kind != "" || node == nil {
		t.Fatalf("kind=%q", kind)
	}
	tlsMap := nodeValue(t, node, "tls").(*jsonx.OrderMap)
	if got := str(t, tlsMap, "server_name"); got != "t.example.com" {
		t.Fatalf("sni = %q", got)
	}
}

func TestParseHysteria2Obfs(t *testing.T) {
	node, kind := ParseLink("hy2://pw@hy.example.com:8443?sni=h.example.com&insecure=1&obfs=salamander&obfs-password=ob123#hy")
	if kind != "" || node == nil {
		t.Fatalf("kind=%q", kind)
	}
	obfsValue, ok := node.Get("obfs")
	if !ok {
		t.Fatal("missing obfs")
	}
	obfs := obfsValue.(*jsonx.OrderMap)
	if got := str(t, obfs, "type"); got != "salamander" {
		t.Fatalf("obfs type = %q", got)
	}
	if got := str(t, obfs, "password"); got != "ob123" {
		t.Fatalf("obfs password = %q", got)
	}
	tlsMap := nodeValue(t, node, "tls").(*jsonx.OrderMap)
	if _, ok := tlsMap.Get("insecure"); !ok {
		t.Fatal("insecure flag missing")
	}
}

func TestParseTUIC(t *testing.T) {
	node, kind := ParseLink("tuic://uuid-3:pw@tuic.example.com:443?sni=tu.example.com&alpn=h3&congestion_control=bbr#tu")
	if kind != "" || node == nil {
		t.Fatalf("kind=%q", kind)
	}
	if got := str(t, node, "uuid"); got != "uuid-3" {
		t.Fatalf("uuid = %q", got)
	}
	if got := str(t, node, "congestion_control"); got != "bbr" {
		t.Fatalf("cc = %q", got)
	}
}

func TestParseUnsupportedSchemeSkipped(t *testing.T) {
	nodes, skipped := ParseSubscription("ssr://abc\ntuic://u:p@h:1#ok\nhttps://example.com")
	if len(nodes) != 1 {
		t.Fatalf("nodes = %d", len(nodes))
	}
	joined := strings.Join(skipped, ",")
	if !strings.Contains(joined, "ssr") || !strings.Contains(joined, "https") {
		t.Fatalf("skipped = %v", skipped)
	}
}

func TestParseSubscriptionBase64Body(t *testing.T) {
	body := base64Std("trojan://pw@1.1.1.1:443#n1\nvless://u@2.2.2.2:80#n2")
	nodes, skipped := ParseSubscription(body)
	if len(skipped) != 0 || len(nodes) != 2 {
		t.Fatalf("nodes=%d skipped=%v", len(nodes), skipped)
	}
}

func TestParseClashYAMLMapping(t *testing.T) {
	yaml := `proxies:
  - name: 香港 01
    type: ss
    server: hk.example.com
    port: 8388
    cipher: aes-128-gcm
    password: pw
  - name: 日本 02
    type: vmess
    server: jp.example.com
    port: 443
    uuid: uuid-9
    alterId: 0
    cipher: auto
    tls: true
    servername: sni.jp
    network: ws
    ws-opts:
      path: /wspath
  - name: 老协议
    type: ssr
    server: x
    port: 1
`
	nodes, skipped := ParseSubscription(yaml)
	if len(skipped) != 1 || skipped[0] != "ssr" {
		t.Fatalf("skipped = %v", skipped)
	}
	if len(nodes) != 2 {
		t.Fatalf("nodes = %d", len(nodes))
	}
	first := nodes[0]
	if got := str(t, first, "type"); got != "shadowsocks" {
		t.Fatalf("type = %q", got)
	}
	if got := str(t, first, "method"); got != "aes-128-gcm" {
		t.Fatalf("method = %q", got)
	}
	second := nodes[1]
	if got := str(t, second, "security"); got != "auto" {
		t.Fatalf("security = %q", got)
	}
	tlsMap := nodeValue(t, second, "tls").(*jsonx.OrderMap)
	if got := str(t, tlsMap, "server_name"); got != "sni.jp" {
		t.Fatalf("sni = %q", got)
	}
	tr := nodeValue(t, second, "transport").(*jsonx.OrderMap)
	if got := str(t, tr, "path"); got != "/wspath" {
		t.Fatalf("ws path = %q", got)
	}
}

func TestParseClashYAMLRealityAndTuic(t *testing.T) {
	yaml := `proxies:
  - name: r1
    type: vless
    server: r.example.com
    port: 443
    uuid: u
    tls: true
    client-fingerprint: chrome
    reality-opts:
      public-key: pk
      short-id: sid
  - name: t1
    type: tuic
    server: tu.example.com
    port: 443
    uuid: u
    password: p
    congestion-controller: cubic
`
	nodes, skipped := ParseSubscription(yaml)
	if len(skipped) != 0 || len(nodes) != 2 {
		t.Fatalf("nodes=%d skipped=%v", len(nodes), skipped)
	}
	tlsMap := nodeValue(t, nodes[0], "tls").(*jsonx.OrderMap)
	reality := nodeValue(t, tlsMap, "reality").(*jsonx.OrderMap)
	if got := str(t, reality, "short_id"); got != "sid" {
		t.Fatalf("short_id = %q", got)
	}
	if got := str(t, nodes[1], "congestion_control"); got != "cubic" {
		t.Fatalf("cc = %q", got)
	}
}

func nodeValue(t *testing.T, obj *jsonx.OrderMap, key string) jsonx.Value {
	t.Helper()
	value, ok := obj.Get(key)
	if !ok {
		t.Fatalf("missing key %q", key)
	}
	return value
}

func base64Std(text string) string {
	return base64Encode(text)
}
