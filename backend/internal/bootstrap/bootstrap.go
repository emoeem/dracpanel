// Package bootstrap assembles every subsystem the HTTP API needs.
//
// It exists so production (cmd/sing-box-panel) and integration tests build the
// same dependency graph. The wiring bug that left Feed/History/Sampler nil in
// main.go was invisible to tests because they assembled their own deps; with a
// single Build() the two can no longer drift apart.
package bootstrap

import (
	"github.com/emoeem/dracpanel/backend/internal/clashapi"
	"github.com/emoeem/dracpanel/backend/internal/dnslog"
	"github.com/emoeem/dracpanel/backend/internal/dnsprobe"
	"github.com/emoeem/dracpanel/backend/internal/ebpf"
	"github.com/emoeem/dracpanel/backend/internal/geoip"
	"github.com/emoeem/dracpanel/backend/internal/history"
	"github.com/emoeem/dracpanel/backend/internal/httpapi"
	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/meminfo"
	"github.com/emoeem/dracpanel/backend/internal/notifications"
	"github.com/emoeem/dracpanel/backend/internal/profiles"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/singbox"
	"github.com/emoeem/dracpanel/backend/internal/subs"
	"github.com/emoeem/dracpanel/backend/internal/sysproxy"
	"github.com/emoeem/dracpanel/backend/internal/systemd"
)

// Build constructs the panel's dependency graph and starts the background
// sampler. The returned cleanup stops the sampler; callers must invoke it on
// shutdown. subs.Scheduler is intentionally left to the caller because it has
// no stop method.
func Build(s *settings.Settings) (*httpapi.Deps, func()) {
	service := systemd.New(s)
	configs := singbox.New(s, service)
	feed := notifications.Load(s)

	// Every config write funnels through here, so manual edits, subscription
	// applies and eBPF policy changes all land in the notification feed.
	apply := func(cfg *jsonx.OrderMap, reason string, restart bool) *jsonx.OrderMap {
		result := configs.Apply(cfg, reason, restart)
		feed.Record("config", "应用配置（"+reason+"）", result)
		return result
	}
	// Manual edits arrive as text: writing the original preserves JSONC
	// comments that a parse+dump round-trip would drop.
	applyText := func(cfg *jsonx.OrderMap, text, reason string) *jsonx.OrderMap {
		result := configs.ApplyText(text, cfg, reason, true)
		feed.Record("config", "应用配置（"+reason+"）", result)
		return result
	}

	subsStore := subs.New(s, configs)
	subsStore.ApplyFn = apply
	ebpfSystem := ebpf.New(s, apply)

	store := history.Load(s.StateDir())
	sampler := history.NewSampler(s, store)
	sampler.Start() // no-op under --dry-run

	deps := &httpapi.Deps{
		S:               s,
		Service:         service,
		Configs:         configs,
		Subs:            subsStore,
		Ebpf:            ebpfSystem,
		Clash:           &clashapi.Clash{S: s},
		GeoIP:           geoip.New(s),
		SysProxy:        sysproxy.New(s, service),
		Mem:             &meminfo.Controller{S: s, Service: service},
		Profiles:        &profiles.Importer{S: s, Subs: subsStore},
		Feed:            feed,
		History:         store,
		Sampler:         sampler,
		ApplyConfigText: applyText,
		DNSLog:          dnslog.New(s),
		DNSProbe:        dnsprobe.New(),
	}

	return deps, sampler.Stop
}
