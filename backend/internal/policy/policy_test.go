package policy

import (
	"testing"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

func TestListReadsGroups(t *testing.T) {
	cfg, err := jsonx.ParseObject(`{"outbounds":[
		{"type":"selector","tag":"Proxy","outbounds":["Auto","direct"],"default":"Auto"},
		{"type":"urltest","tag":"Auto","outbounds":["n1"],"url":"http://x","interval":"10m","tolerance":50},
		{"type":"shadowsocks","tag":"n1"}
	]}`)
	if err != nil {
		t.Fatal(err)
	}
	groups := List(cfg, "Proxy", "Auto")
	if len(groups) != 2 {
		t.Fatalf("groups = %d, want 2", len(groups))
	}
	if groups[0].Tag != "Proxy" || !groups[0].Managed || len(groups[0].Members) != 2 {
		t.Fatalf("proxy group = %+v", groups[0])
	}
	if groups[1].Tolerance != 50 || groups[1].URL != "http://x" {
		t.Fatalf("urltest group = %+v", groups[1])
	}
}

func TestApplyMembersExcludesAndOrders(t *testing.T) {
	members := []string{"n1", "n2", "n3", "n4"}
	got := ApplyMembers(members, Overrides{
		Exclude: []string{"n2"},
		Order:   []string{"n4", "n1"},
	})
	want := []string{"n4", "n1", "n3"}
	if len(got) != len(want) {
		t.Fatalf("members = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("members = %v, want %v", got, want)
		}
	}
}

func TestApplyMembersWithoutOverridesIsIdentity(t *testing.T) {
	members := []string{"a", "b"}
	got := ApplyMembers(members, Overrides{})
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("members = %v", got)
	}
}
