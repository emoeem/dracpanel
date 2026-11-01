// Package nodes exposes the config's outbound nodes for the Nodes page.
// Secrets are masked unless the caller explicitly asks to reveal them.
package nodes

import (
	"encoding/json"
	"fmt"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

// Masked replaces every secret value in list responses.
const Masked = "••••••"

// Node is the list row for one outbound.
type Node struct {
	Tag        string
	Type       string
	Server     string
	ServerPort int
	// Origin is "managed" for tags created by subscription apply, else "manual".
	Origin string
}

var nonNodeTypes = map[string]bool{
	"selector": true,
	"urltest":  true,
	"direct":   true,
	"block":    true,
	"dns":      true,
}

// List returns the config's leaf outbounds (everything that is not a group or
// a built-in outbound).
func List(cfg *jsonx.OrderMap, managed *jsonx.OrderMap) []Node {
	if cfg == nil {
		return nil
	}
	managedTags := map[string]bool{}
	if managed != nil {
		if value, ok := managed.Get("outbound_tags"); ok {
			for _, item := range toSlice(value) {
				managedTags[fmt.Sprintf("%v", item)] = true
			}
		}
	}
	var out []Node
	for _, item := range arrayField(cfg, "outbounds") {
		obj, ok := item.(*jsonx.OrderMap)
		if !ok {
			continue
		}
		typ := stringField(obj, "type")
		if nonNodeTypes[typ] {
			continue
		}
		tag := stringField(obj, "tag")
		origin := "manual"
		if managedTags[tag] {
			origin = "managed"
		}
		port := 0
		if value, ok := obj.Get("server_port"); ok {
			port = intValue(value)
		}
		out = append(out, Node{
			Tag:        tag,
			Type:       typ,
			Server:     stringField(obj, "server"),
			ServerPort: port,
			Origin:     origin,
		})
	}
	return out
}

// Find returns the outbound with the given tag.
func Find(cfg *jsonx.OrderMap, tag string) *jsonx.OrderMap {
	if cfg == nil {
		return nil
	}
	for _, item := range arrayField(cfg, "outbounds") {
		if obj, ok := item.(*jsonx.OrderMap); ok && stringField(obj, "tag") == tag {
			return obj
		}
	}
	return nil
}

var secretKeys = map[string]bool{
	"password":        true,
	"uuid":            true,
	"auth_str":        true,
	"obfs_password":   true,
	"private_key":     true,
	"pre_shared_key":  true,
	"token":           true,
	"secret":          true,
	"psk":             true,
	"key":             true,
	"public_key":      true,
	"short_id":        true,
	"server_password": true,
}

// Sanitize clones the outbound and masks secret fields when reveal is false.
func Sanitize(node *jsonx.OrderMap, reveal bool) *jsonx.OrderMap {
	if node == nil {
		return nil
	}
	clone := node.Clone()
	if reveal {
		return clone
	}
	mask(clone)
	return clone
}

func mask(obj *jsonx.OrderMap) {
	for _, key := range obj.Keys() {
		if secretKeys[key] {
			obj.Set(key, Masked)
			continue
		}
		value, _ := obj.Get(key)
		switch nested := value.(type) {
		case *jsonx.OrderMap:
			mask(nested)
		case []jsonx.Value:
			for _, item := range nested {
				if child, ok := item.(*jsonx.OrderMap); ok {
					mask(child)
				}
			}
		}
	}
}

func arrayField(obj *jsonx.OrderMap, key string) []jsonx.Value {
	if value, ok := obj.Get(key); ok {
		if arr, ok := value.([]jsonx.Value); ok {
			return arr
		}
	}
	return nil
}

func toSlice(value jsonx.Value) []jsonx.Value {
	if arr, ok := value.([]jsonx.Value); ok {
		return arr
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
