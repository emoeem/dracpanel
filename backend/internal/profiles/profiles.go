// Package profiles implements POST /api/profiles/import: accept an uploaded
// YAML/JSON profile, parse it with the subscription pipeline and register it
// as a local subscription (url == "" means "no refetch, inline nodes").
package profiles

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/subs"
)

// Importer stores uploaded profiles.
type Importer struct {
	S    *settings.Settings
	Subs *subs.Subscriptions
}

// errMap builds the failure envelope.
func errMap(msg string) *jsonx.OrderMap {
	m := jsonx.NewOrderMap()
	m.Set("ok", false)
	m.Set("message", msg)
	return m
}

// Import handles the multipart upload (field "file").
func (p *Importer) Import(filename string, content []byte) *jsonx.OrderMap {
	name := strings.TrimSpace(filename)
	if name == "" {
		name = fmt.Sprintf("profile-%d", time.Now().Unix())
	}
	dir := filepath.Join(p.S.String("state_dir"), "profiles")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return errMap(err.Error())
	}
	safe := filepath.Base(name)
	stored := filepath.Join(dir, fmt.Sprintf("%d-%s", time.Now().Unix(), safe))
	if err := os.WriteFile(stored, content, 0o600); err != nil {
		return errMap(err.Error())
	}
	text := strings.ToValidUTF8(string(content), "\uFFFD")
	nodes, skipped := subs.ParseSubscription(text)
	if len(nodes) == 0 {
		message := "未解析出任何节点"
		if len(skipped) > 0 {
			message = fmt.Sprintf("未解析出任何节点（不支持的类型：%s）", strings.Join(skipped, "、"))
		}
		return errMap(message)
	}
	result := p.Subs.AddLocal(strings.TrimSuffix(safe, filepath.Ext(safe)), nodes)
	if ok, _ := result.Get("ok"); ok != true {
		return result
	}
	result.Set("message", fmt.Sprintf("导入成功：%d 个节点（本地文件 %s）", len(nodes), stored))
	return result
}
