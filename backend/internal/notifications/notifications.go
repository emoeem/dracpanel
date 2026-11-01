// Package notifications keeps the panel's persistent journal: config applies,
// restores, service control, subscription updates, imports and client-reported
// health events. The dashboard's 通知与问题 card reads the newest slice; the
// Activity and Events pages filter the same store by category and severity.
// Persisted to <state_dir>/notifications.json.
package notifications

import (
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
)

const (
	// MaxEntries caps the persisted ring buffer.
	MaxEntries = 500
	// Retention drops entries older than a week on load.
	Retention = 7 * 24 * time.Hour
	// FeedLimit is what the dashboard card asks for.
	FeedLimit = 50
)

// Entry is one journal row.
//
// Severity: info | warn | error.
// Category: operation (someone changed something) | event (state changed).
type Entry struct {
	T        int64  `json:"t"`
	Kind     string `json:"kind"` // config | service | subscription | import | health | system
	Severity string `json:"severity,omitempty"`
	Category string `json:"category,omitempty"`
	Source   string `json:"source,omitempty"` // panel | browser | sing-box
	Title    string `json:"title"`
	Detail   string `json:"detail,omitempty"`
	OK       bool   `json:"ok"`
}

// Feed owns the journal ring buffer.
type Feed struct {
	S *settings.Settings

	mu    sync.Mutex
	items []Entry
}

// Load reads the persisted journal (corrupt file → fresh), dropping entries
// past the retention window.
func Load(s *settings.Settings) *Feed {
	f := &Feed{S: s}
	raw, err := os.ReadFile(path(s))
	if err == nil {
		var items []Entry
		if err := json.Unmarshal(raw, &items); err == nil {
			cutoff := time.Now().Add(-Retention).Unix()
			kept := items[:0]
			for _, item := range items {
				if item.T >= cutoff {
					kept = append(kept, item)
				}
			}
			if len(kept) > MaxEntries {
				kept = kept[len(kept)-MaxEntries:]
			}
			f.items = kept
		}
	}
	return f
}

func path(s *settings.Settings) string { return s.StateDir() + "/notifications.json" }

// Add appends an operation-level event (severity info, category operation).
func (f *Feed) Add(kind, title, detail string, ok bool) {
	severity := "info"
	if !ok {
		severity = "error"
	}
	f.AddEvent(Entry{
		Kind:     kind,
		Severity: severity,
		Category: "operation",
		Source:   "panel",
		Title:    title,
		Detail:   detail,
		OK:       ok,
	})
}

// AddEvent appends a fully described entry and persists the journal.
func (f *Feed) AddEvent(entry Entry) {
	if f == nil {
		return
	}
	if entry.T == 0 {
		entry.T = time.Now().Unix()
	}
	if entry.Severity == "" {
		entry.Severity = "info"
		if !entry.OK {
			entry.Severity = "error"
		}
	}
	if entry.Category == "" {
		entry.Category = "operation"
	}
	if entry.Source == "" {
		entry.Source = "panel"
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.items = append(f.items, entry)
	if len(f.items) > MaxEntries {
		f.items = f.items[len(f.items)-MaxEntries:]
	}
	raw, err := json.Marshal(f.items)
	if err == nil {
		_ = os.WriteFile(path(f.S), raw, 0o600)
	}
}

// List returns the whole journal newest-first.
func (f *Feed) List() []Entry {
	if f == nil {
		return nil
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Entry, 0, len(f.items))
	for i := len(f.items) - 1; i >= 0; i-- {
		out = append(out, f.items[i])
	}
	return out
}

// Query returns newest-first entries matching the filters. An empty filter
// matches everything; limit <= 0 means "all remaining".
func (f *Feed) Query(category, severity string, limit int) []Entry {
	items := f.List()
	out := make([]Entry, 0, len(items))
	for _, item := range items {
		if category != "" && item.Category != category {
			continue
		}
		if severity != "" && item.Severity != severity {
			continue
		}
		out = append(out, item)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// ListValue returns the newest FeedLimit entries as ordered JSON values.
func (f *Feed) ListValue() jsonx.Value {
	return Values(f.Query("", "", FeedLimit))
}

// Values encodes entries for an API body.
func Values(items []Entry) jsonx.Value {
	out := make([]jsonx.Value, 0, len(items))
	for _, item := range items {
		obj := jsonx.NewOrderMap()
		obj.Set("t", item.T)
		obj.Set("kind", item.Kind)
		obj.Set("severity", item.Severity)
		obj.Set("category", item.Category)
		obj.Set("source", item.Source)
		obj.Set("title", item.Title)
		if item.Detail != "" {
			obj.Set("detail", item.Detail)
		}
		obj.Set("ok", item.OK)
		out = append(out, obj)
	}
	return out
}

// Record wraps a config-apply style result into a journal entry.
func (f *Feed) Record(kind, title string, result *jsonx.OrderMap) {
	if f == nil || result == nil {
		return
	}
	okValue, _ := result.Get("ok")
	ok := okValue == true
	detail, _ := result.Get("message")
	detailText, _ := detail.(string)
	f.Add(kind, title, detailText, ok)
}
