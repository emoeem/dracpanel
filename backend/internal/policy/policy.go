// Package policy exposes sing-box selector/urltest groups as structured data
// for the Policies page, and records manual membership edits so subscription
// applies do not undo them.
package policy

import (
	"encoding/json"
	"fmt"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

// Group is one selector/urltest entry.
type Group struct {
	Tag       string
	Type      string
	Members   []string
	URL       string
	Interval  string
	Tolerance int
	// Managed is true for the groups the subscription apply rewrites
	// (managed_group / managed_urltest).
	Managed bool
}

// List reads the groups from the live config.
func List(cfg *jsonx.OrderMap, managedGroup, managedURLTest string) []Group {
	if cfg == nil {
		return nil
	}
	var out []Group
	for _, item := range arrayField(cfg, "outbounds") {
		obj, ok := item.(*jsonx.OrderMap)
		if !ok {
			continue
		}
		typ := stringField(obj, "type")
		if typ != "selector" && typ != "urltest" {
			continue
		}
		group := Group{
			Tag:      stringField(obj, "tag"),
			Type:     typ,
			Members:  stringList(obj, "outbounds"),
			URL:      stringField(obj, "url"),
			Interval: stringField(obj, "interval"),
		}
		if value, ok := obj.Get("tolerance"); ok {
			group.Tolerance = intValue(value)
		}
		group.Managed = group.Tag != "" && (group.Tag == managedGroup || group.Tag == managedURLTest)
		out = append(out, group)
	}
	return out
}

// Overrides is the manual edit for one group: members the user removed and the
// order they chose. Subscription apply applies both after rebuilding members.
type Overrides struct {
	Exclude []string `json:"exclude"`
	Order   []string `json:"order"`
}

// ApplyMembers rewrites a group's member list for the subscription apply:
// drop excluded tags, then order the remainder by the stored preference.
func ApplyMembers(members []string, overrides Overrides) []string {
	excluded := make(map[string]bool, len(overrides.Exclude))
	for _, tag := range overrides.Exclude {
		excluded[tag] = true
	}
	position := make(map[string]int, len(overrides.Order))
	for index, tag := range overrides.Order {
		position[tag] = index
	}
	kept := make([]string, 0, len(members))
	for _, tag := range members {
		if !excluded[tag] {
			kept = append(kept, tag)
		}
	}
	if len(position) == 0 {
		return kept
	}
	// Stable partition: tags with a stored position come first, in that order;
	// everything else keeps its original order.
	preferred := make([]string, 0, len(kept))
	rest := make([]string, 0, len(kept))
	for _, tag := range kept {
		if _, ok := position[tag]; ok {
			preferred = append(preferred, tag)
		} else {
			rest = append(rest, tag)
		}
	}
	for i := 1; i < len(preferred); i++ {
		for j := i; j > 0 && position[preferred[j]] < position[preferred[j-1]]; j-- {
			preferred[j], preferred[j-1] = preferred[j-1], preferred[j]
		}
	}
	return append(preferred, rest...)
}

func arrayField(obj *jsonx.OrderMap, key string) []jsonx.Value {
	if value, ok := obj.Get(key); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			return arr
		}
	}
	return nil
}

func stringField(obj *jsonx.OrderMap, key string) string {
	if value, ok := obj.Get(key); ok {
		if text, ok := value.(string); ok {
			return text
		}
	}
	return ""
}

func stringList(obj *jsonx.OrderMap, key string) []string {
	var out []string
	for _, item := range arrayField(obj, key) {
		out = append(out, fmt.Sprintf("%v", item))
	}
	return out
}

func intValue(value jsonx.Value) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	}
	return 0
}
