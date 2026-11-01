package ebpf

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

// fakeProc writes a minimal /proc tree with one process whose cmdline is
// /usr/bin/example, so ListApps can attribute the process to this uid.
func fakeProc(t *testing.T, pid int) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, strconv.Itoa(pid))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cmdline"), []byte("/usr/bin/example\x00--flag\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func writeDesktop(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "app.desktop"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func onlyApp(t *testing.T, apps []jsonx.Value) *jsonx.OrderMap {
	t.Helper()
	if len(apps) != 1 {
		t.Fatalf("expected one uid entry, got %d", len(apps))
	}
	entry, ok := apps[0].(*jsonx.OrderMap)
	if !ok {
		t.Fatalf("unexpected entry type %T", apps[0])
	}
	return entry
}

// A .desktop line that is exactly "Icon=" (empty value) used to panic with
// "slice bounds out of range [7:5]" because the parser sliced at a fixed 7.
func TestListAppsToleratesEmptyIconLine(t *testing.T) {
	proc := fakeProc(t, 4242)
	desktop := writeDesktop(t, "Name=Example\nIcon=\nExec=/usr/bin/example %U\n")

	entry := onlyApp(t, ListApps(proc, []string{desktop}))
	if icon, _ := entry.Get("icon"); icon != "" {
		t.Fatalf("icon = %v, want empty", icon)
	}
	if label, _ := entry.Get("label"); label != "Example" {
		t.Fatalf("label = %v, want Example", label)
	}
}

// The icon value must be preserved verbatim, not truncated by an off-by-two
// offset ("firefox" used to become "refox").
func TestListAppsParsesIconValue(t *testing.T) {
	proc := fakeProc(t, 4343)
	desktop := writeDesktop(t, "Name=Example\nIcon=firefox\nExec=/usr/bin/example\n")

	entry := onlyApp(t, ListApps(proc, []string{desktop}))
	if icon, _ := entry.Get("icon"); icon != "firefox" {
		t.Fatalf("icon = %v, want firefox", icon)
	}
}
