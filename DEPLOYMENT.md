# Deployment & operations

Unofficial Dracula-themed desktop web panel for sing-box. It is a fork of
[SagerNet/sing-box-dashboard](https://github.com/SagerNet/sing-box-dashboard)
(React 19 + Vite + TypeScript + Connect RPC), with a Dracula/Alucard color
system and an added management module backed by `sing-box-panel`.

> This build is not affiliated with or endorsed by SagerNet. See `NOTICE`.
> Project overview: [README.md](README.md).

Tested on Linux/systemd with `sing-box v1.14.3-reF1nd` and
`sing-box-panel 0.1.0-6`. This is a deployment runbook for that layout, not a
distro-agnostic installer.

## Architecture

| Endpoint | Purpose |
| --- | --- |
| `http://127.0.0.1:9096/` | **The only UI entry.** React dashboard + management module, served from the panel `ui_dir`. |
| `http://127.0.0.1:9091/` | sing-box native API (Connect / gRPC-Web). **RPC only**; its own dashboard is disabled. |
| `http://127.0.0.1:9090/` | Clash API, kept for the zashboard fallback and legacy panel node APIs. |
| `http://127.0.0.1:9096/dash/` | zashboard fallback (kept as a safety net). |
| `http://127.0.0.1:9096/api/*` | Privileged management API (same origin, `X-Panel-Token`). |

The UI and panel API are same-origin, so management requests need no CORS.
The native API is cross-origin from the UI, so its CORS whitelist contains
only `http://127.0.0.1:9096` and `http://localhost:9096` (never `*`).

### Authentication

1. The login gate asks for the panel token (`/var/lib/sing-box-panel/token`).
2. After validating it, the gate reads `/api/config` once, extracts the
   `services[type=api]` secret/port, and stores a managed server entry in the
   dashboard's server list.
3. The config mtime is cached (`panel-api-cache`), so subsequent loads only
   fetch `/api/state`; the full config is fetched again only when the config
   actually changed. The panel token stays in `localStorage.panel_token`.
4. If the core is stopped, the gate offers a Dracula-styled recovery screen
   (start/restart via the panel API).
5. If the native connection drops at runtime, the management page remains
   accessible; after a config apply/restart the dashboard streams are
   reconnected via `DaemonApi.reconnectNow()`.

## Management module

- **运行状态** — service start/stop/restart/reload, PID/start time, config path,
  native traffic stream.
- **订阅** — add/update/update-all/apply/delete through the panel.
- **eBPF** — policy mode, UID selection, app list, capability probe.
- **配置** — CodeMirror (JSON5) editor with Dracula syntax colors, validate,
  apply with panel-side backup/rollback, backup list and restore.

All management writes go through the panel's existing validation/backup/
atomic-replace/restart/rollback pipeline. A systemd path unit
(`sing-box-config-perm.path`) enforces `chmod 600` on
`/etc/sing-box/config.json` and re-checks it with `stat -c %a` after every
change, because the panel writes the config with mode 0644.

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

npx --yes pnpm@11.13.0 install --frozen-lockfile --trust-lockfile
npx --yes pnpm@11.13.0 generate   # protobuf + icons + terminal themes
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
sudo ./deploy/install.sh
```

The script backs up `/etc/sing-box/config.json` with a timestamp, adds (or
updates) the `services[type=api]` entry on `127.0.0.1:9091` with a random
secret and the 9096-only CORS whitelist, keeps its dashboard disabled,
installs the build into `/usr/local/share/sing-box-panel-ui` (the previous UI
is moved to `...legacy-<timestamp>`), copies this runbook as the local
`README.md`/`DEPLOYMENT.md`, installs the permission path unit, and restarts
both services with health checks. It never modifies `/usr/bin` or
`/usr/share`. The script resolves the repository root from its own location,
so it can be run from any checkout.

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

The zashboard fallback at `http://127.0.0.1:9096/dash/` remains available
throughout. Package integrity can be checked with:

```bash
pacman -Qkk sing-box-panel
```

## Local data

| Key | Contents |
| --- | --- |
| `panel_token` | panel access token |
| `sing-box-dashboard.servers` | dashboard server list (includes the managed local API secret) |
| `sing-box-dashboard.theme` / `.accent` | theme preferences |
| `sing-box-dashboard.panel-api-cache` | config mtime + API port/secret cache |
| `panel-last-route` | last primary page |

## Verification record

The live acceptance run and screenshots are kept in
[artifacts/README.md](artifacts/README.md). Some screenshots contain local
test domains/traffic; review/redact them before publishing this checkout.

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
NOTICE, LICENSE      GPL-3.0 and upstream/palette/name notices
README-UPSTREAM.md   upstream README (kept for attribution)
```


## License

GPL-3.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This project is an unofficial fork of SagerNet/sing-box-dashboard. The upstream
license requires that derivative works must not use the upstream name or imply
official association; this project uses "Dracula Panel for sing-box" and states
the non-affiliation explicitly.
