// Package notifications keeps a persistent event feed for the 通知与问题
// dashboard card: config applies, restores, service control, subscription
// updates and imports. Ring buffer persisted to
// <state_dir>/notifications.json.
package notifications

import (
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
)

// MaxEntries caps the persisted ring buffer.
const MaxEntries = 50

// Entry is one feed row.
type Entry struct {
	T      int64  `json:"t"`
	Kind   string `json:"kind"` // config | service | subscription | import
	Title  string `json:"title"`
	Detail string `json:"detail,omitempty"`
	OK     bool   `json:"ok"`
}

// Feed owns the notification ring buffer.
type Feed struct {
	S *settings.Settings

	mu    sync.Mutex
	items []Entry
}

// Load reads the persisted feed (corrupt file → fresh).
func Load(s *settings.Settings) *Feed {
	f := &Feed{S: s}
	raw, err := os.ReadFile(path(s))
	if err == nil {
		var items []Entry
		if err := json.Unmarshal(raw, &items); err == nil {
			if len(items) > MaxEntries {
				items = items[len(items)-MaxEntries:]
			}
			f.items = items
		}
	}
	return f
}

func path(s *settings.Settings) string { return s.StateDir() + "/notifications.json" }

// Add appends an event and persists the feed.
func (f *Feed) Add(kind, title, detail string, ok bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.items = append(f.items, Entry{
		T:      time.Now().Unix(),
		Kind:   kind,
		Title:  title,
		Detail: detail,
		OK:     ok,
	})
	if len(f.items) > MaxEntries {
		f.items = f.items[len(f.items)-MaxEntries:]
	}
	raw, err := json.Marshal(f.items)
	if err == nil {
		_ = os.WriteFile(path(f.S), raw, 0o600)
	}
}

// List returns the feed newest-first.
func (f *Feed) List() []Entry {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Entry, 0, len(f.items))
	for i := len(f.items) - 1; i >= 0; i-- {
		out = append(out, f.items[i])
	}
	return out
}

// ListValue returns the feed as ordered JSON values for the API body.
func (f *Feed) ListValue() jsonx.Value {
	items := f.List()
	out := make([]jsonx.Value, 0, len(items))
	for _, item := range items {
		obj := jsonx.NewOrderMap()
		obj.Set("t", item.T)
		obj.Set("kind", item.Kind)
		obj.Set("title", item.Title)
		if item.Detail != "" {
			obj.Set("detail", item.Detail)
		}
		obj.Set("ok", item.OK)
		out = append(out, obj)
	}
	return out
}

// Record wraps a config-apply style result into a notification.
func (f *Feed) Record(kind, title string, result *jsonx.OrderMap) {
	okValue, _ := result.Get("ok")
	ok := okValue == true
	detail, _ := result.Get("message")
	detailText, _ := detail.(string)
	f.Add(kind, title, detailText, ok)
}
