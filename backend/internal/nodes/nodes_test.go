package nodes

import (
	"testing"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

func mustParse(t *testing.T, text string) *jsonx.OrderMap {
	t.Helper()
	cfg, err := jsonx.ParseObject(text)
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestListSkipsGroupsAndMarksManaged(t *testing.T) {
	cfg := mustParse(t, `{"outbounds":[
		{"type":"selector","tag":"Proxy","outbounds":["n1"]},
		{"type":"shadowsocks","tag":"n1","server":"a","server_port":8388},
		{"type":"trojan","tag":"manual","server":"b","server_port":443},
		{"type":"direct","tag":"direct"}
	]}`)
	managed := mustParse(t, `{"outbound_tags":["n1"]}`)
	list := List(cfg, managed)
	if len(list) != 2 {
		t.Fatalf("nodes = %d, want 2: %+v", len(list), list)
	}
	if list[0].Tag != "n1" || list[0].Origin != "managed" || list[0].ServerPort != 8388 {
		t.Fatalf("managed node = %+v", list[0])
	}
	if list[1].Origin != "manual" {
		t.Fatalf("manual node = %+v", list[1])
	}
}

func TestSanitizeMasksSecretsDeeply(t *testing.T) {
	cfg := mustParse(t, `{"outbounds":[{"type":"vless","tag":"n1","uuid":"abc","tls":{"reality":{"private_key":"pk","short_id":"sid"}}}]}`)
	node := Find(cfg, "n1")
	if node == nil {
		t.Fatal("node not found")
	}

	masked := Sanitize(node, false)
	if value := stringField(masked, "uuid"); value != Masked {
		t.Fatalf("uuid = %q, want masked", value)
	}
	tls, _ := masked.Get("tls")
	reality, _ := tls.(*jsonx.OrderMap).Get("reality")
	if value := stringField(reality.(*jsonx.OrderMap), "private_key"); value != Masked {
		t.Fatalf("private_key = %q, want masked", value)
	}

	revealed := Sanitize(node, true)
	if value := stringField(revealed, "uuid"); value != "abc" {
		t.Fatalf("revealed uuid = %q", value)
	}
	// The original config must not be mutated by masking.
	if value := stringField(node, "uuid"); value != "abc" {
		t.Fatalf("source mutated: uuid = %q", value)
	}
}
