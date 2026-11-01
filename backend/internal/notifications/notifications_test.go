package notifications

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/settings"
)

func newFeed(t *testing.T) *Feed {
	t.Helper()
	s, err := settings.Load("", true)
	if err != nil {
		t.Fatal(err)
	}
	s.Data["state_dir"] = t.TempDir()
	return Load(s)
}

func TestAddDefaultsToOperationInfo(t *testing.T) {
	feed := newFeed(t)
	feed.Add("config", "应用配置", "ok", true)

	items := feed.List()
	if len(items) != 1 {
		t.Fatalf("entries = %d, want 1", len(items))
	}
	if items[0].Category != "operation" || items[0].Severity != "info" || items[0].Source != "panel" {
		t.Fatalf("unexpected defaults: %+v", items[0])
	}

	feed.Add("config", "应用失败", "boom", false)
	items = feed.List()
	if items[0].Severity != "error" {
		t.Fatalf("failed operation severity = %q, want error", items[0].Severity)
	}
}

func TestQueryFiltersByCategoryAndSeverity(t *testing.T) {
	feed := newFeed(t)
	feed.Add("config", "应用配置", "ok", true)
	feed.AddEvent(Entry{
		Kind: "health", Severity: "warn", Category: "event", Source: "browser",
		Title: "节点不可用", OK: false,
	})

	if got := feed.Query("operation", "", 0); len(got) != 1 || got[0].Title != "应用配置" {
		t.Fatalf("operation query = %+v", got)
	}
	if got := feed.Query("event", "", 0); len(got) != 1 || got[0].Title != "节点不可用" {
		t.Fatalf("event query = %+v", got)
	}
	if got := feed.Query("", "warn", 0); len(got) != 1 {
		t.Fatalf("severity query = %+v", got)
	}
	if got := feed.Query("", "", 1); len(got) != 1 {
		t.Fatalf("limit query = %+v", got)
	}
}

func TestLoadDropsExpiredEntries(t *testing.T) {
	s, err := settings.Load("", true)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	s.Data["state_dir"] = dir

	now := time.Now().Unix()
	items := []Entry{
		{T: now - int64(Retention/time.Second) - 60, Title: "expired"},
		{T: now, Title: "fresh"},
	}
	raw, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notifications.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	feed := Load(s)
	got := feed.List()
	if len(got) != 1 || got[0].Title != "fresh" {
		t.Fatalf("retention kept %+v", got)
	}
}
