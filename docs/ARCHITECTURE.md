# Architecture & kernel adapter boundary

DracPanel is a single-page React application. It ships no backend of its own;
instead it speaks to three services that own the privileged work. This document
records which client talks to which service, what each layer may do, and how
capability degradation works — the contract every view must go through.

## Runtime topology

```
Browser (React SPA, this repo)
  │
  ├─ sing-box-panel  (127.0.0.1:9096, external Python service)
  │    privileged management API, same-origin /api/*, X-Panel-Token auth
  │    · subscriptions (fetch + merge, SSRF-guarded server side)
  │    · config read/validate/apply/backup/restore (atomic, rollback)
  │    · systemd service start/stop/restart/reload
  │    · eBPF takeover policy, GeoIP lookups, panel logs
  │
  ├─ sing-box native API  (127.0.0.1:9091, services[type=api])
  │    Connect/gRPC-Web over HTTP (proto/daemon/started_service.proto)
  │    · server-side streams: status/traffic, groups, outbounds, logs,
  │      connections, clash mode, service status
  │    · unary: URLTest, SelectOutbound, SetClashMode, CloseConnection(s),
  │      GetStartedAt, GetVersion, GetDeprecatedWarnings
  │
  └─ sing-box Clash API  (e.g. 127.0.0.1:9190, experimental.clash_api)
       REST, browser-direct
       · /dns/query, /cache/dns/flush, /cache/fakeip/flush
       · /proxies/{tag}/delay, /group/{tag}/delay
```

## Clients (`src/api/`)

| Client | File | Talks to | Notes |
| --- | --- | --- | --- |
| Panel | `panel.ts` | sing-box-panel | Auth via `X-Panel-Token`; fails fast with `PanelUnavailableError` when no token is configured (direct mode). 401 raises the `panel-auth-error` window event, which bounces every tab to the gate. |
| Native | `daemon.ts` | sing-box API service | `StreamStore` based; exponential backoff, ref-counted subscriptions, reset-on-reconnect for closed-connection state. |
| Clash | `clash.ts` | sing-box Clash API | Endpoint resolution: panel mode reads it from `/api/state`; direct mode reads `clashUrl`/`clashSecret` from the active server entry. 30 s cache. |
| Transport | `websocket.ts`, `bidirectional.ts` | native API | gRPC-WebSocket fallback used by `openBidirectionalStream` (kept for protocol parity with the sing-box client). |

**Rule:** views never call `fetch` against a kernel endpoint directly. All
kernel access goes through these clients so capability probing, error
normalisation, and auth live in exactly one place per service.

## Panel capabilities & degradation

`panelCapabilities.ts` turns `PanelState.features` (or one-shot endpoint
probes on older panels) into a `PanelCapabilities` value. Features the panel
does not provide render as honest unavailable states, never as dead controls:

- No panel token (direct mode) → panel-backed dashboard cards hidden,
  Profiles page shows an explicit empty state, Clash API comes from the
  server entry instead of the panel.
- Feature probed as missing → the affected control shows why and what
  upgrades enable it.

The sing-box native API version (`makeCapabilities`) gates API-version-bound
RPCs the same way.

## Security boundaries

- The panel owns every privileged operation (config writes, process control,
  subscription fetching). The browser never gains file or process access.
- Subscription URLs are fetched server-side by the panel with its own
  SSRF guard; the UI only ever stores what the panel returns.
- The native API and Clash API are loopback services; CORS allow-lists are
  configured by `deploy/install.sh` (panel origin) or, in direct mode, by the
  operator for the UI origin.
- Tokens live in `localStorage` on the loopback origin only; the lock screen
  clears them and cross-tab storage events keep other tabs in sync. The lock
  is a convenience, not a security boundary (see SECURITY.md).

## Theme system

Design tokens live in `src/styles/globals.css` as CSS custom properties with
a `data-palette` (flclash | dracula) × `data-theme` (light | dark) matrix plus
an AMOLED variant (`data-amoled`). Accent colors are preset blocks or a seed
color expanded by `src/lib/tonalPalette.ts` (OKLCH-based, M3-style tones).
`applyAppearance` in `app/context.tsx` is the single entry point; the
pre-paint script in `index.html` mirrors it to avoid theme flashes.
