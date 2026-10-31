// Package clashapi ports the Clash passthrough endpoints.
package clashapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
)

// Clash proxies requests to the core's Clash API.
type Clash struct {
	S *settings.Settings
}

type requestResult struct {
	ok   bool
	data jsonx.Value
	text string
}

func (c *Clash) request(path, method string, body any) requestResult {
	base := strings.TrimRight(c.S.String("clash_api"), "/")
	full := base + path
	var payload io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err == nil {
			payload = bytes.NewReader(raw)
		}
	}
	req, err := http.NewRequest(method, full, payload)
	if err != nil {
		return requestResult{ok: false, text: err.Error()}
	}
	if secret := c.S.ClashSecret(); secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return requestResult{ok: false, text: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return requestResult{ok: false, text: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return requestResult{ok: false, text: err.Error()}
	}
	if value, err := jsonx.Parse(string(raw)); err == nil {
		return requestResult{ok: true, data: value}
	}
	return requestResult{ok: true, data: jsonx.NewOrderMap(), text: string(raw)}
}

// Proxies ports Clash.proxies(): groups/nodes split with sorted groups.
func (c *Clash) Proxies() *jsonx.OrderMap {
	result := c.request("/proxies", http.MethodGet, nil)
	out := jsonx.NewOrderMap()
	if !result.ok {
		out.Set("ok", false)
		out.Set("message", result.text)
		out.Set("proxies", jsonx.NewOrderMap())
		return out
	}
	proxies := jsonx.NewOrderMap()
	if obj, ok := result.data.(*jsonx.OrderMap); ok {
		if value, ok := obj.Get("proxies"); ok {
			if p, ok := value.(*jsonx.OrderMap); ok {
				proxies = p
			}
		}
	}
	type entry struct {
		name    string
		payload *jsonx.OrderMap
		isGroup bool
	}
	var groups, nodes []entry
	for _, name := range proxies.Keys() {
		value, _ := proxies.Get(name)
		item, ok := value.(*jsonx.OrderMap)
		if !ok {
			continue
		}
		now := ""
		if value, ok := item.Get("now"); ok {
			now, _ = value.(string)
		}
		var members []jsonx.Value
		if value, ok := item.Get("all"); ok {
			if arr, ok := value.([]jsonx.Value); ok {
				members = arr
			}
		}
		var delay any
		if value, ok := item.Get("history"); ok {
			if arr, ok := value.([]jsonx.Value); ok && len(arr) > 0 {
				if last, ok := arr[len(arr)-1].(*jsonx.OrderMap); ok {
					delay, _ = last.Get("delay")
				}
			}
		}
		var alive any
		if value, ok := item.Get("alive"); ok {
			alive = value
		}
		entryOut := jsonx.NewOrderMap()
		entryOut.Set("name", name)
		if typ, ok := item.Get("type"); ok {
			entryOut.Set("type", typ)
		}
		entryOut.Set("now", now)
		entryOut.Set("members", members)
		entryOut.Set("history", delay)
		entryOut.Set("alive", alive)
		isGroup := len(members) > 0
		if isGroup {
			groups = append(groups, entry{name: name, payload: entryOut, isGroup: true})
		} else {
			nodes = append(nodes, entry{name: name, payload: entryOut})
		}
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].name < groups[j].name })
	groupValues := make([]jsonx.Value, 0, len(groups))
	for _, item := range groups {
		groupValues = append(groupValues, item.payload)
	}
	nodeValues := make([]jsonx.Value, 0, len(nodes))
	for _, item := range nodes {
		nodeValues = append(nodeValues, item.payload)
	}
	out.Set("ok", true)
	out.Set("groups", groupValues)
	out.Set("nodes", nodeValues)
	return out
}

// Select ports Clash.select().
func (c *Clash) Select(group, name string) *jsonx.OrderMap {
	result := c.request("/proxies/"+url.PathEscape(group), http.MethodPut, map[string]string{"name": name})
	out := jsonx.NewOrderMap()
	if result.ok {
		out.Set("ok", true)
		out.Set("message", fmt.Sprintf("已切换到 %s", name))
	} else {
		out.Set("ok", false)
		out.Set("message", fmt.Sprintf("切换失败：%s", result.text))
	}
	return out
}

// Delay ports Clash.delay().
func (c *Clash) Delay(name, target string, timeout int) *jsonx.OrderMap {
	path := fmt.Sprintf("/proxies/%s/delay?url=%s&timeout=%d",
		url.PathEscape(name), url.QueryEscape(target), timeout)
	result := c.request(path, http.MethodGet, nil)
	out := jsonx.NewOrderMap()
	if !result.ok {
		out.Set("ok", false)
		out.Set("message", result.text)
		return out
	}
	var delay any
	message := ""
	if obj, ok := result.data.(*jsonx.OrderMap); ok {
		if value, ok := obj.Get("delay"); ok {
			delay = value
		}
		if value, ok := obj.Get("message"); ok {
			message, _ = value.(string)
		}
	}
	out.Set("ok", true)
	out.Set("delay", delay)
	out.Set("message", message)
	return out
}

// Connections ports Clash.connections().
func (c *Clash) Connections() *jsonx.OrderMap {
	result := c.request("/connections", http.MethodGet, nil)
	out := jsonx.NewOrderMap()
	out.Set("ok", result.ok)
	if result.ok {
		out.Set("data", result.data)
		out.Set("message", "")
	} else {
		out.Set("data", jsonx.NewOrderMap())
		out.Set("message", result.text)
	}
	return out
}

// Version ports Clash.version().
func (c *Clash) Version() *jsonx.OrderMap {
	result := c.request("/version", http.MethodGet, nil)
	out := jsonx.NewOrderMap()
	out.Set("ok", result.ok)
	if result.ok {
		out.Set("data", result.data)
	} else {
		out.Set("data", jsonx.NewOrderMap())
	}
	return out
}
