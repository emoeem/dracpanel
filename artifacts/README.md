# Acceptance artifacts

Dracula Panel for sing-box — real-environment acceptance run (2026-10-17).

> **Privacy:** these screenshots were captured from a live local instance.
> The connections, speedtest, subscription-test, and eBPF images have been
> pixelated over real destinations, node names, and installed application
> names; the settings footer's local source path is also pixelated. The config
> screenshot uses a hand-written sample; no token or secret was intentionally
> captured. Re-check new screenshots before committing them.

All screenshots were taken against the live stack:

- UI: `http://127.0.0.1:9096/` (panel `ui_dir`)
- Native API: `http://127.0.0.1:9091/` (RPC only, dashboard disabled)
- Clash API: `http://127.0.0.1:9090/` (zashboard fallback)
- sing-box: `v1.14.3-reF1nd`

## Screenshots

| File | Page | Notes |
| --- | --- | --- |
| `00-gate-dark.png` | 登录门 | Dracula gate, token only |
| `01-overview-dark.png` | 概览 | traffic, status, four-mode card |
| `02-groups-dark.png` | 代理 | real groups/nodes |
| `03-connections-dark.png` | 连接 | virtual list; destinations pixelated |
| `04-logs-dark.png` | 日志 | native log stream |
| `05-rules-dark.png` | 规则 | config-derived route/DNS rules |
| `06-speedtest-dark.png` | 测速 | native URLTest delays; node names pixelated |
| `07-settings-dark.png` | 设置 | About shows upstream + non-affiliation notice; local path pixelated |
| `08-manage-status-dark.png` | 管理 → 运行状态 | panel service state + native traffic |
| `09-manage-subscriptions-dark.png` | 管理 → 订阅 | empty state (no subscriptions configured) |
| `10-manage-ebpf-dark.png` | 管理 → eBPF | policy + app list + probe; app names pixelated |
| `11-manage-config-dark.png` | 管理 → 配置 | CodeMirror Dracula; **sanitized sample config (no secrets)** |
| `12-overview-light.png` | 概览（Alucard） | light variant |
| `13-manage-after-restart.png` | 管理 | after core restart, no page reload |
| `14-manage-ebpf-applied.png` | 管理 | after eBPF config apply; app names pixelated |
| `15-manage-stopped.png` | 管理 | core stopped, management still reachable |
| `16-manage-running.png` | 管理 | core started again |
| `17-overview-mobile.png` | 概览（390px） | mobile fallback, no overflow |
| `18-tools-dark.png` | 工具 | upstream tools page, Dracula styled |
| `19-connections-virtual-dark.png` | 连接（大数量） | 56 tracked connections rendered as 14 DOM rows; destinations/node names pixelated |
| `20-manage-subscription-test-dark.png` | 管理 → 订阅 | local mock subscription added, updated, then deleted (no config write); name/URL pixelated |

The config screenshot uses a hand-written sample JSON (geosite/cn, direct
outbound) inserted into the editor **without applying it**; the real config
contains node passwords and API secrets and is intentionally not captured.

## Test results

| Area | Result |
| --- | --- |
| Login, navigation, all primary pages | all checks passed; two initial failures were test-only selectors (hidden mobile header) and were re-verified in the final screenshots/checks |
| Management: restart/eBPF apply/stop/start | 33/33 checks; PID changed each time; `window.__noReloadMarker` survived |
| Config editor UI apply/restore | real config `log.level` warn → info → warn through the editor and panel; service healthy; no page reload |
| Subscriptions | add / update / delete against a local mock Clash YAML; record deleted afterwards; `写入配置` intentionally not run (no fake nodes in config) |
| Editor height | JSON editor constrained to the page; internal CodeMirror scrolling (fixed after the first apply attempt) |
| RPC auto-reconnect after restart/config apply | verified: header returns to 运行中, streams resume, no full page reload |
| Four modes via topbar | Rule / Proxy / RuleAllowAds / Direct each verified through Clash API; restored to Rule |
| Secret bootstrap cache | first login reads `/api/config`; reloads only call `/api/state`; after a config change the next load refreshes once, subsequent loads skip |
| CORS | `http://127.0.0.1:9096` allowed; `http://127.0.0.1:9999` has no ACAO; 9091 `/dashboard/` = 404 |
| Config permission | 600; `sing-box-config-perm.path` fixed 0644 → 600 with `stat -c %a` check |
| Connection virtualization | 56 connections total, 14 DOM rows |
| Rollback drill | old UI restored and verified, then new UI restored; config rollback removed 9091, then restored 9091 + CORS |
| Package integrity | `pacman -Qkk sing-box-panel`: 51 files, 0 changed |

## Backups from the deployment

- sing-box config: `/etc/sing-box/backups/config.json.bak.20261017-230321-dracula`
- previous UI: `/usr/local/share/sing-box-panel-ui.legacy-20261017-230321`
- rollback-drill safety copy: `/etc/sing-box/backups/config.json.bak.20261017-231437-before-rollback-test`

## Scripts

- `artifacts/acceptance.py` — pages, login, cache, modes
- `artifacts/acceptance2.py` — management actions, reconnect, light/narrow
- `artifacts/final_shots.py` — final screenshots and cache recheck
- `artifacts/config_apply_test.py` — first config apply attempt (editor viewport check)
- `artifacts/config_apply_continue.py` — config apply/restore through the UI state and panel API
- `deploy/install.sh` — deployment
- `deploy/rollback-test.sh` — rollback drill

The test scripts read a temporary token file that has been deleted after the
run; they contain no tokens or secrets.

To reproduce: stage the panel token as `.test-token` at the repository root,
start Chromium with `--remote-debugging-port=9223`, build/serve the UI at
`127.0.0.1:9096`, then run the scripts in order. The scripts resolve paths
relative to their own location.
