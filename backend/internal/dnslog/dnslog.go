// Package dnslog extracts DNS query records from the sing-box journal.
//
// sing-box only logs per-query DNS lines at log.level=debug; at the default
// info level the journal carries no DNS lines and every read returns an empty
// list plus an honest note. Reads are on-demand journalctl(1) invocations with
// a short in-process cache, so no background daemon or state file is needed.
package dnslog

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/sysutil"
)

// Entry is one parsed DNS query line. Fields the journal line does not carry
// stay empty: the parser is deliberately tolerant of fork-specific formats.
type Entry struct {
	At        int64  `json:"at"` // unix milliseconds of the journal timestamp
	Domain    string `json:"domain"`
	Type      string `json:"type,omitempty"`
	Client    string `json:"client,omitempty"`
	Upstream  string `json:"upstream,omitempty"`
	Status    string `json:"status"` // ok | nxdomain | failed
	ElapsedMs int64  `json:"elapsed_ms,omitempty"`
}

const (
	StatusOK      = "ok"
	StatusNX      = "nxdomain"
	StatusFailed  = "failed"
	cacheTTL      = 15 * time.Second
	journalCap    = 8000
	defaultWindow = time.Hour
)

// Reader reads DNS entries from the sing-box unit journal.
type Reader struct {
	S  *settings.Settings
	mu sync.Mutex
	// cachedWindow records which --since window produced cache; a wider cached
	// read also satisfies a narrower request.
	cache        []Entry
	cachedAt     time.Time
	cachedWindow time.Duration
	// readFn overrides the journal read in tests.
	readFn func(window time.Duration) []Entry
}

func New(s *settings.Settings) *Reader {
	return &Reader{S: s}
}

// Queries returns the newest entries first, capped at limit. The note explains
// when and why the list may be empty (dry-run, no journalctl, info log level).
func (r *Reader) Queries(window time.Duration, limit int) ([]Entry, string) {
	if r.S == nil || r.S.DryRun {
		return []Entry{}, "dry-run 模式不读取系统日志"
	}
	if window <= 0 {
		window = defaultWindow
	}
	if limit <= 0 {
		limit = 500
	}

	// Fast path: a fresh cache that is at least as wide as this request.
	r.mu.Lock()
	if !r.cachedAt.IsZero() && time.Since(r.cachedAt) <= cacheTTL && r.cachedWindow >= window {
		cached := r.cache
		r.mu.Unlock()
		out := newest(cached, limit)
		return out, emptyNote(out)
	}
	r.mu.Unlock()

	// journalctl can take up to 30s; never hold the lock across it.
	reader := r.read
	if r.readFn != nil {
		reader = r.readFn
	}
	entries := reader(window)

	r.mu.Lock()
	// A concurrent wider read may have landed already; keep the better one.
	if r.cachedAt.IsZero() || r.cachedWindow < window || time.Since(r.cachedAt) > cacheTTL {
		r.cache = entries
		r.cachedAt = time.Now()
		r.cachedWindow = window
	}
	cached := r.cache
	r.mu.Unlock()

	out := newest(cached, limit)
	return out, emptyNote(out)
}

// newest returns up to limit entries, newest first.
func newest(entries []Entry, limit int) []Entry {
	out := make([]Entry, 0, limit)
	for i := len(entries) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, entries[i])
	}
	return out
}

func emptyNote(entries []Entry) string {
	if len(entries) == 0 {
		return "日志中没有 DNS 查询记录；sing-box 仅在 log.level=debug 时输出每条查询，当前配置可能为 info"
	}
	return ""
}

func (r *Reader) read(window time.Duration) []Entry {
	since := time.Now().Add(-window).Format("2006-01-02 15:04:05")
	_, out, _ := sysutil.Run("journalctl", []string{
		"-u", r.S.String("service"),
		"-o", "short-iso",
		"--no-pager",
		"--since", since,
		"-n", strconv.Itoa(journalCap),
	}, 30*time.Second)
	entries := make([]Entry, 0, 128)
	for _, line := range strings.Split(out, "\n") {
		if entry, ok := ParseLine(line); ok {
			entries = append(entries, entry)
		}
	}
	return entries
}

var (
	journalTimeRe = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})`)
	dnsMarkerRe   = regexp.MustCompile(`(?i)\bdns\b|resolved|exchange`)
	domainRe      = regexp.MustCompile(`domain\[([^\]\s]+)\]|domain=([^\s,;]+)|qname=([^\s,;]+)|query\s+([a-z0-9._-]+\.[a-z]{2,})|resolve\s+([a-z0-9._-]+\.[a-z]{2,})`)
	typeRe        = regexp.MustCompile(`(?i)\btype\[([A-Z0-9]+)\]|\btype=([A-Za-z0-9]+)|\bqtype=([A-Za-z0-9]+)|\btype\s+([A-Z0-9]{1,10})\b`)
	upstreamRe    = regexp.MustCompile(`with\[([^\]]+)\]|server=([^\s,;]+)|upstream=([^\s,;]+)|(?:-->|->)\s*([^\s,;\]]+)`)
	clientRe      = regexp.MustCompile(`client\[([^\]]+)\]|client=([^\s,;]+)|from\s+(\[?[0-9a-fA-F.:]+\]?:\d+)`)
	elapsedRe     = regexp.MustCompile(`elapsed\[(\d+)\s*m?s\]|elapsed=(\d+)(m?s)?|(\d+(?:\.\d+)?)\s*ms\b`)
)

// ParseLine parses one journal line (short-iso output) into an Entry. It
// returns false for lines without a DNS marker or without a resolvable domain,
// so the caller never stores unparseable noise.
func ParseLine(line string) (Entry, bool) {
	message := line
	at := int64(0)
	if match := journalTimeRe.FindStringSubmatch(line); match != nil {
		if parsed, err := time.ParseInLocation("2006-01-02T15:04:05", match[1], time.Local); err == nil {
			at = parsed.UnixMilli()
		}
	}
	// The journal prefix ends at "]: " (unit[pid]: message).
	if idx := strings.Index(line, "]: "); idx >= 0 {
		message = line[idx+3:]
	}
	if !dnsMarkerRe.MatchString(message) {
		return Entry{}, false
	}
	domain := firstMatch(domainRe, message)
	if domain == "" {
		return Entry{}, false
	}
	entry := Entry{
		At:       at,
		Domain:   domain,
		Type:     strings.ToUpper(firstMatch(typeRe, message)),
		Client:   firstMatch(clientRe, message),
		Upstream: firstMatch(upstreamRe, message),
		Status:   StatusOK,
	}
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "nxdomain"):
		entry.Status = StatusNX
	case strings.Contains(lower, "fail") || strings.Contains(lower, "error") || strings.Contains(lower, "timeout"):
		entry.Status = StatusFailed
	}
	entry.ElapsedMs = parseElapsed(elapsedRe.FindStringSubmatch(message))
	return entry, true
}

func firstMatch(re *regexp.Regexp, text string) string {
	match := re.FindStringSubmatch(text)
	if match == nil {
		return ""
	}
	for _, group := range match[1:] {
		if group != "" {
			return group
		}
	}
	return ""
}

func parseElapsed(match []string) int64 {
	if match == nil {
		return 0
	}
	for _, group := range match[1:] {
		if group == "" {
			continue
		}
		if value, err := strconv.ParseFloat(group, 64); err == nil {
			// "elapsed=500" without a unit suffix means milliseconds already;
			// a bare "500" captured by the (\d+)ms branch carries "ms".
			return int64(value)
		}
	}
	return 0
}

// Describe explains the reader's data source for the API envelope.
func (r *Reader) Describe() string {
	if r.S == nil {
		return "journalctl"
	}
	return fmt.Sprintf("journalctl -u %s", r.S.String("service"))
}
