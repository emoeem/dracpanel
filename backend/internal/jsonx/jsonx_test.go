package jsonx

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStripJSON5(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"line comment", "{\n  // 注释\n  \"a\": 1\n}", "{\n  \n  \"a\": 1\n}"},
		{"block comment", "{ /* c */ \"a\": 1 }", "{  \"a\": 1 }"},
		{"comment inside string kept", "{\"u\": \"http://x\"}", "{\"u\": \"http://x\"}"},
		{"trailing comma object", "{\"a\": 1, \"b\": [1, 2,],}", "{\"a\": 1, \"b\": [1, 2]}"},
		{"escaped quote", "{\"a\": \"x \\\" // not comment\"}", "{\"a\": \"x \\\" // not comment\"}"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StripJSON5(tc.in); got != tc.want {
				t.Fatalf("StripJSON5(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestParsePreservesOrder(t *testing.T) {
	text := "{\n  \"log\": {\"level\": \"warn\"},\n  \"inbounds\": [{\"type\": \"tun\"}],\n  \"outbounds\": []\n}"
	value, err := Parse(text)
	if err != nil {
		t.Fatal(err)
	}
	obj, ok := value.(*OrderMap)
	if !ok {
		t.Fatal("top level must be an object")
	}
	keys := strings.Join(obj.Keys(), ",")
	if keys != "log,inbounds,outbounds" {
		t.Fatalf("key order = %q", keys)
	}
}

func TestParseObjectRejectsNonObject(t *testing.T) {
	if _, err := ParseObject("[1, 2]"); err == nil {
		t.Fatal("expected error for array top level")
	}
}

func TestParseRejectsTrailingGarbage(t *testing.T) {
	if _, err := Parse("{} extra"); err == nil {
		t.Fatal("expected error for trailing data")
	}
}

func TestDumpKeepsOrderAndFormat(t *testing.T) {
	obj := NewOrderMap()
	inner := NewOrderMap()
	inner.Set("b", true)
	inner.Set("n", json.Number("42"))
	obj.Set("z", inner)
	obj.Set("a", []Value{json.Number("1"), "x"})
	got := Dump(obj)
	want := "{\n  \"z\": {\n    \"b\": true,\n    \"n\": 42\n  },\n  \"a\": [\n    1,\n    \"x\"\n  ]\n}\n"
	if got != want {
		t.Fatalf("Dump = %q, want %q", got, want)
	}
}

func TestDumpKeepsNonASCIIRaw(t *testing.T) {
	obj := NewOrderMap()
	obj.Set("文本", "中文")
	got := Dump(obj)
	if !strings.Contains(got, "中文") || strings.Contains(got, "\\u") {
		t.Fatalf("non-ASCII must stay raw: %q", got)
	}
}

func TestRoundTrip(t *testing.T) {
	text := "{\"inbounds\": [{\"type\": \"tun\", \"tag\": \"tun-in\"}], \"route\": {\"final\": \"direct\"}}"
	value, err := Parse(text)
	if err != nil {
		t.Fatal(err)
	}
	reparsed, err := Parse(Dump(value))
	if err != nil {
		t.Fatal(err)
	}
	if Dump(reparsed) != Dump(value) {
		t.Fatal("round trip mismatch")
	}
}
