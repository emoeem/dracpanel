# Deployment & operations

Unofficial Dracula-themed desktop web panel for sing-box. It is a fork of
[SagerNet/sing-box-dashboard](https://github.com/SagerNet/sing-box-dashboard)
(React 19 + Vite + TypeScript + Connect RPC), with a Dracula/Alucard color
system and an added management module backed by `sing-box-panel`.

> This build is not affiliated with or endorsed by SagerNet. See `NOTICE`.
> Project overview: [README.md](README.md).

Tested on Linux/systemd with `sing-box v1.14.3-reF1nd`. The base UI was
validated with `sing-box-panel 0.1.0-6`; the per-subscription auto-update,
`Subscription-Userinfo`, backup-download, and GeoIP endpoints are in the local
`0.1.0-8` build and were exercised with a dry-run integration test. This is a
deployment runbook for that layout, not a distro-agnostic installer.

## Architecture

| Endpoint | Purpose |
| --- | --- |
| `http://127.0.0.1:9096/` | **The only UI entry.** React dashboard + management module, served from the panel `ui_dir`. |
| `http://127.0.0.1:9091/` | sing-box native API (Connect / gRPC-Web). **RPC only**; its own dashboard is disabled. |
| `http://127.0.0.1:9090/` | Clash API, kept for the zashboard fallback and legacy panel node APIs. |
| `http://127.0.0.1:9096/dash/` | Optional zashboard fallback when the panel's `zashboard_dir` is configured. |
| `http://127.0.0.1:9096/api/*` | Privileged management API (same origin, `X-Panel-Token`). |
| `GET /api/geoip?ip=...` | Local City lookup from the configured mmdb; 404 for private/unresolvable IPs, 503 when the database is missing. |

The UI and panel API are same-origin, so management requests need no CORS.
The native API is cross-origin from the UI, so its CORS whitelist contains
only `http://127.0.0.1:9096` and `http://localhost:9096` (never `*`).

### Authentication

1. The login gate asks for the panel token (`/var/lib/sing-box-panel/token`).
2. After validating it, the gate reads `/api/config` once, extracts the
   `services[type=api]` secret/port, and stores a managed server entry in the
   dashboard's server list.
3. The config mtime **and byte size** are cached (`panel-api-cache`), so
   subsequent loads only fetch `/api/state`; the full config is fetched again
   only when the config actually changed. The panel token stays in
   `localStorage.panel_token`.
4. If the core is stopped, the gate shows the Dracula-styled recovery screen
   (start/restart via the panel API) **before** syncing the native server, so
   an unreadable config cannot hide the recovery controls.
5. Config text may contain `//`, `/* */`, and trailing commas (sing-box
   accepts them); the gate and installer normalize that subset before parsing.
   Full JSON5 (unquoted keys, single quotes) is rejected by sing-box.
6. If the native connection drops at runtime, the management page remains
   accessible; after a config apply/restart the dashboard streams are
   reconnected via `DaemonApi.reconnectNow()`.
7. “Lock panel” clears the panel token, `panel-api-cache`, and the managed
   `panel-local` server entry, and reloads other open tabs back to the gate.

### Threat model

The panel runs as root and can rewrite the core config and restart services.
The panel token and native API secret live in browser localStorage. The lock
button prevents accidental/on-screen use; it is not a boundary against
same-user processes, malicious browser extensions, or XSS. Use a separate OS
user/browser profile if that matters.

The UI is local-only by design: the native API URL is hard-coded to
`127.0.0.1:9091`, and CORS allows only `127.0.0.1:9096` /
`localhost:9096`. LAN IPs, reverse proxies, and HTTPS are not supported. If
`services.api.secret` is empty, sing-box disables native API authentication;
the management status tab warns about it. Downloaded config backups contain
the same secrets as the live config (API secret, Clash secret, outbound
passwords); treat them as sensitive files.

GeoIP lookups are served only by the local panel's `/api/geoip` from an
in-memory mmdb; the panel does not log, persist, or forward queried IPs. The
browser never calls an external geolocation service. The optional
`egress_ip_probe_url` is the only GeoIP-related external request and is empty
by default; when enabled, it receives a single cached GET with no connection
data.

## Management module

- **运行状态** — service start/stop/restart/reload, PID/start time, config path,
  native traffic stream; config read errors, `journalctl -u sing-box` logs,
  Clash API/key, and availability-gated fallback entries (zashboard with
  auto-filled secret, MetaCubeXD, official dashboard).
- **订阅** — add/update/update-all/apply/delete through the panel; per-subscription
  auto-update intervals, `Subscription-Userinfo` traffic/expiry, managed
  tags/groups, skipped protocols, and per-subscription failures are shown.
- **eBPF** — policy mode, UID selection, app list with execs/PIDs, and a
  structured PASS/FAIL/UNKNOWN capability probe.
- **配置** — CodeMirror (JSON5) editor with Dracula syntax colors, bundled
  sing-box schema completion, a pre-apply field/line diff, validate, apply with
  panel-side backup/rollback, backup list, restore, and download. Comments and
  trailing commas are accepted because sing-box accepts them; other JSON5
  extensions are rejected by both. The schema is served from the local
  `public/sing-box.schema.json` asset (official schema snapshot, 2026-10-11);
  update it when the target sing-box version changes.

The management module's UI strings are currently Chinese-only. The status tab
warns when `services.api.secret` is empty, because that disables native API
authentication for any local process.

The new subscription, backup, and GeoIP features require the companion
`sing-box-panel 0.1.0-8` build:

- `POST /api/subscriptions/<id>/schedule` with `{"update_interval": seconds}`
  (0 disables, values below 300s are clamped to 300s, maximum 30 days);
- `GET /api/subscriptions` now includes `update_interval`, `last_attempt`,
  `next_update`, and parsed `userinfo` (`upload`/`download`/`total`/`expire`);
- `GET /api/subscriptions/managed` returns managed `outbound_tags`,
  `group_members`, `updated`, `by_subscription`, and the configured group names;
- `GET /api/config/backups/<name>` returns the backup as an attachment;
- `GET /api/logs` and `GET /api/clash/version` power the status diagnostics;
- `/api/state` adds `zashboard_available`, `official_dashboard_available`, and
  `egress_ip` (the official URL is empty when its dashboard is disabled). The
  UI also uses `config_error`, `clash_api`/`clash_secret`, `token_file`,
  `panel_version`, `dry_run`, `inbounds`, `managed_group`, and
  `managed_urltest`;
- `GET /api/geoip?ip=1.2.3.4` returns
  `{"ok":true,"ip":...,"lon":...,"lat":...,"country":...,"city":...}`;
  private/reserved/invalid IPs return 404, and a missing database/library
  returns 503. The lookup is in-memory only.

Older panels lack these endpoints. The UI reads `features` from `/api/state`
when available; otherwise it probes the routes once after login, disables the
unsupported controls, and shows an upgrade hint instead of waiting for a 404.
The scheduler only refreshes subscription nodes; it never applies them to the
live config. "写入配置" remains a manual action.

The optional backend contract is `"api_version": 8` plus a `"features"` array
in `/api/state`. Recognized keys are `subscriptions.schedule`,
`subscriptions.managed`, `subscriptions.userinfo`, `config.backup.download`,
`logs`, `clash.version`, and `geoip`. When the array is present it is
authoritative; when it is absent the UI probes those routes once per page.

The management editor's schema completion uses
`public/sing-box.schema.json`, a local snapshot of the official schema
(2026-10-11). It is loaded from the same origin, never from a third party.
Refresh the file when upgrading sing-box; backend `sing-box check` remains the
authority for version-specific validation.

### GeoIP and the traffic map

The overview's "全球连接" card consumes the connection stream, extracts public
destination IPs, and asks only the local panel for coordinates. It does not
resolve domains and never sends a query to a third party. The panel uses a
lazy-loaded, memory-mapped mmdb; query IPs are not logged or persisted.

- Data: **DB-IP City Lite** (MMDB, CC BY 4.0), upstream
  <https://db-ip.com>, attribution "IP Geolocation by DB-IP".
- Install: `deploy/install.sh` downloads the pinned
  `dbip-city-lite@1.0.18` archive from the jsDelivr/npm mirror, verifies both
  the archive and extracted MMDB SHA-256, and installs
  `/usr/share/GeoIP/dbip-city-lite.mmdb` (about 122 MB). A download or
  checksum failure only warns; `/api/geoip` then returns 503 and the card shows
  `missing GeoIP database, see README`.
- Refresh: `sudo ./deploy/install.sh --refresh-geoip` (or reinstall a newer
  pinned package). The file is data, not a package-owned file.
- Config: the panel defaults to `/usr/share/GeoIP/GeoLite2-City.mmdb`, then
  falls back to `/usr/share/GeoIP/dbip-city-lite.mmdb`; set
  `geoip_database` in `panel.json` to use another mmdb. The Python dependency
  is `python-maxminddb` (declared by the panel package).
- Origin: the UI prefers panel `egress_ip`, then the first connection's
  `source` IP, then a Chengdu fallback (TODO in `TrafficMap.tsx`). `egress_ip`
  can be set statically; an optional `egress_ip_probe_url` (default empty)
  makes the panel perform one cached GET to that URL. It never includes
  connection destinations.
- Frontend: 500-entry GeoIP LRU, pending dedupe, 1° clustering, 30-arc cap,
  theme-aware canvas colors, reduced-motion static mode, and visibility-based
  rAF pause.

All management writes go through the panel's existing validation/backup/
atomic-replace/restart/rollback pipeline. A systemd path unit
(`sing-box-config-perm.path`) enforces `chmod 600` on
`/etc/sing-box/config.json` and re-checks it with `stat -c %a` after every
change, because the panel writes the config with mode 0644. The durable fix
belongs in the companion panel backend: create the temporary file with mode
0600 before `os.replace()`, and restore 0600 after a rollback write. The path
unit remains a defense-in-depth fallback, not the primary guarantee.

## Theme

- Dark: Dracula (`#282a36`, `#44475a`, `#f8f8f2`, `#6272a4`, `#bd93f9`, `#8be9fd`, …)
- Light: Alucard (`#fffbeb`, `#1f1f1f`, `#6c664b`, `#cfcfde`, `#644ac9`, …)
- CodeMirror uses the same design tokens: property → cyan, string → green,
  number → yellow, bool/null → orange, comment → comment, invalid → red.
- PWA/Service Worker is intentionally disabled so upgrades and rollbacks are
  never shadowed by a cached shell.

## Pages

概览 / 代理 / 连接 / 日志 / 规则 / 测速 / 设置 / 管理, plus the upstream
工具 pages. `Ctrl+1…8` jumps to the eight primary pages.
The 规则 page is derived from the live config via the panel API because the
native API has no rules RPC. 测速 uses the native URLTest/NetworkQuality/STUN
RPCs. The connections list is windowed (virtual scrolling), not capped at 500.

## Build

```bash
git clone --recursive https://github.com/emoeem/dracula-panel-for-sing-box.git
cd dracula-panel-for-sing-box
# if cloned without --recursive:
git submodule update --init --depth 1

npx --yes pnpm@11.13.1 install --frozen-lockfile --trust-lockfile
npx --yes pnpm@11.13.1 generate   # protobuf + icons + terminal themes
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build
```

`src/gen/` and `src/lib/terminalThemes.generated.ts` are generated (not
committed); `pnpm generate` creates them. The `vendor/iterm2-color-schemes`
submodule is required by the terminal-theme generator.

`--trust-lockfile` skips pnpm 11's per-entry supply-chain metadata check; the
lockfile is the upstream pinned lockfile. Omit it on fast/clean networks.

## Install / update

```bash
sudo ./deploy/install.sh                  # config + UI + GeoIP data
sudo ./deploy/install.sh --ui-only        # UI only; no config rewrite, no core restart
sudo ./deploy/install.sh --rotate-secret  # explicitly rotate the native API secret
sudo ./deploy/install.sh --refresh-geoip  # re-download the DB-IP City Lite mmdb
```

The script backs up `/etc/sing-box/config.json` with a timestamp, adds (or
updates) the `services[type=api]` entry on `127.0.0.1:9091` with the
9096-only CORS whitelist, keeps its dashboard disabled, installs the build
into `/usr/local/share/sing-box-panel-ui` (the previous UI is moved to
`...legacy-<timestamp>`), copies this runbook as the local
`README.md`/`DEPLOYMENT.md`, installs the permission path unit, and restarts
the affected services with health checks. **An existing secret is preserved
by default**; a new one is generated only on first install or with
`--rotate-secret`. The secret is generated inside the installer's Python
process and is never passed on a command line.

Panel config, its systemd drop-in, the permission units, and the UI are backed
up before modification. A failed run restores all of them (best-effort) and
restarts the affected services. `/etc/sing-box/panel.json` is moved to
`/etc/sing-box/backups/` instead of being deleted, because `sing-box -C
/etc/sing-box` would otherwise read every top-level `.json` file.

The config may contain comments and trailing commas; the installer normalizes
them to strict JSON before writing, so the rewritten `config.json` no longer
contains comments. The original remains in the backup. It never modifies
`/usr/bin` or package-managed files, but it does write GeoIP data under
`/usr/share/GeoIP`. The script resolves the repository root from its own
location, so it can be run from any checkout.

The DB-IP download is a warning-only step: if curl, gzip, or either SHA-256
check fails, the rest of the installation still proceeds and `/api/geoip`
returns 503. Existing databases are left alone unless `--refresh-geoip` is
passed.

The subscription schedule/Userinfo, backup-download, and GeoIP endpoints are
part of the companion `sing-box-panel` package, not this UI. Rebuild/install
that package (0.1.0-8) separately; `deploy/install.sh` only copies the static
build.

## Rollback

1. Restore the previous sing-box config and restart the core:

```bash
BACKUP=$(ls -t /etc/sing-box/backups/config.json.bak.*-dracula | head -1)
sudo cp -a "$BACKUP" /etc/sing-box/config.json
sudo chmod 600 /etc/sing-box/config.json
sudo systemctl restart sing-box
```

2. Restore the previous UI directory and restart the panel:

```bash
LEGACY=$(ls -d /usr/local/share/sing-box-panel-ui.legacy-* | tail -1)
sudo rm -rf /usr/local/share/sing-box-panel-ui
sudo mv "$LEGACY" /usr/local/share/sing-box-panel-ui
sudo systemctl restart sing-box-panel
```

3. Optionally remove the permission path unit:

```bash
sudo systemctl disable --now sing-box-config-perm.path
sudo rm -f /etc/systemd/system/sing-box-config-perm.path \
  /etc/systemd/system/sing-box-config-perm.service \
  /usr/local/bin/sing-box-config-perm
sudo systemctl daemon-reload
```

4. Optionally remove the downloaded GeoIP database:

```bash
sudo rm -f /usr/share/GeoIP/dbip-city-lite.mmdb
```

The zashboard fallback at `http://127.0.0.1:9096/dash/` is available only if
the panel's `zashboard_dir` points at a real zashboard build; `install.sh` does
not set that field. A panel configured with `zashboard_dir` pointing at an
empty directory returns 404 there. Package integrity can be checked with:

```bash
pacman -Qkk sing-box-panel
```

## Local data

| Key | Contents |
| --- | --- |
| `panel_token` | panel access token |
| `sing-box-dashboard.servers` | dashboard server list (includes the managed local API secret) |
| `sing-box-dashboard.theme` / `.accent` | theme preferences |
| `sing-box-dashboard.panel-api-cache` | config mtime/bytes + API port/secret cache |
| `panel-last-route` | last primary page |

The GeoIP database lives at `/usr/share/GeoIP/dbip-city-lite.mmdb` (or the
configured `geoip_database`). The frontend's GeoIP cache is module-memory only,
bounded to 500 entries, and is discarded with the page.

## Verification record

The live acceptance run and screenshots are kept in
[artifacts/README.md](artifacts/README.md). Sensitive destinations, node names,
application names, and the settings-page local path in the affected screenshots
have been pixelated; re-check new captures before committing them.

Verified on 2026-10-17 against sing-box v1.14.3-reF1nd:

- all primary pages and the four management tabs rendered in Dracula;
- four modes switched through the topbar and verified through the Clash API;
- config apply, eBPF apply, restart, stop and start all recovered the native
  RPC streams without a full page reload (PID changes + JS marker survived);
- the config editor's own apply/restore path changed `log.level` warn → info →
  warn through the panel and returned healthy, without a page reload;
- subscription add / update / delete was exercised against a local mock
  subscription and removed afterwards (no test nodes were written to config);
- the panel token bootstrap reads the full config once and then uses the
  config mtime cache; reloads issue only `/api/state`;
- CORS only allows `127.0.0.1/localhost:9096`; 9091 `/dashboard/` is gone;
- the config permission path unit restored 0644 to 600 and re-checked with
  `stat -c %a`;
- a UI rollback and a config rollback (including removing/restoring 9091)
  were drilled and restored;
- `pacman -Qkk sing-box-panel`: 51 files, 0 changed;
- the connections table virtualized 56 tracked connections into 14 DOM rows.

## Repository layout

```text
src/                 React source (upstream dashboard + Dracula shell + management)
public/              icons / static assets
proto/               StartedService protobuf
vendor/              iTerm2 color-schemes submodule (terminal theme generator)
artifacts/           acceptance scripts, screenshots, acceptance record
deploy/              install.sh, rollback-test.sh
NOTICE, LICENSE      GPL-3.0-or-later (full text) and upstream/palette/name notices
README-UPSTREAM.md   upstream README (kept for attribution)
```


## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This project is an unofficial fork of SagerNet/sing-box-dashboard. The upstream
license requires that derivative works must not use the upstream name or imply
official association; this project uses "Dracula Panel for sing-box" and states
the non-affiliation explicitly.
