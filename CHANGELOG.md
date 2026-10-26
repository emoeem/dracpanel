# Changelog

All notable changes to DracPanel are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### FlClash-style redesign (2026-10-27)

#### Added
- **Two more palettes**: `nord` (polar-night dark / snow-storm light) and
  `catppuccin` (mocha / latte) join `flclash` and `dracula`; the pure-black
  AMOLED variant now applies to every dark palette (it previously lost the
  specificity tie against palette-scoped blocks).
- **Appearance menu in the topbar** (`AppearanceMenuContent`): theme mode,
  palette grid, AMOLED toggle and accent swatches in one popover — on the
  desktop web topbar, the mobile topbar (≤900px, which previously had no
  appearance entry at all) and the settings/setup pages via `ThemeMenu`.
  The menu stays open while you preview palettes.

#### Fixed
- **Pages could not scroll at 601–900px widths**: `.web-column` lacked
  `min-height: 0`, so in the ≤900px column layout the content pushed the
  column past the viewport, `.content`'s `overflow-y: auto` never engaged and
  everything below the fold was unreachable. The mobile topbar also now shows
  on phones (brand + appearance button; navigation stays in the bottom bar).
- The accent popover could be squeezed to a ~36px anchor width; it now has a
  readable min-width.
- **Dual color palettes**: a new default `flclash` palette — neutral Material-style
  surfaces with dark / light / pure-black AMOLED variants and an orange default
  accent aligned with the FlClash reference dashboard — alongside the original
  `dracula` palette (Dracula dark / Alucard light), selectable in the theme menu.
  Pre-palette users keep Dracula automatically; fresh installs get flclash.
  All tokens are CSS custom properties combined via `data-palette` × `data-theme`
  × `data-amoled`; the pre-paint script in `index.html` applies them before
  first paint (no theme flash).
- Seed-derived accent scales (`src/lib/tonalPalette.ts`): custom accent colors
  now generate accent/strong/soft/on-accent tokens from the seed via OKLCH
  tone mapping (M3-style), unit tested.
- **New information architecture** aligned with FlClash: `dashboard` (was
  overview), `proxies` (was groups), `profiles` (new), `requests` (new),
  `connections`, `dns` (promoted from tools), `logs`, `rules`, `speedtest`,
  `tools`, `system` (was manage), `settings`. Old hashes keep working as
  aliases; stored last-route and manage-tab values migrate.
- **Profiles page** (`src/views/ProfilesView.tsx`): subscription management
  (add URL, update all/per item, auto-update schedule with userinfo, delete)
  extracted from the former manage tab, plus a dedicated route, sidebar entry
  and command-palette command.
- **Requests page**: a recent-request ledger derived from the live connections
  stream (`src/lib/requestLedger.ts`, unit tested), with search, state filter
  and a per-request detail dialog. The page states explicitly that the core
  keeps no historical request log.
- **DNS as a top-level page** with an honest data-source notice, a session
  query ledger (queries you start here, capped at 100) and the existing
  query/cache tools; `tools/dns` hashes redirect to it.
- **Direct-connect mode**: the login gate offers “Connect to a core directly”,
  which manages a sing-box API service without the privileged panel. In direct
  mode panel-backed dashboard cards are hidden, Profiles shows an explicit
  empty state, and the Clash API endpoint comes from the server entry
  (`ServerDialog` gained Clash API URL/secret fields).
- **FlClash-style mobile navigation bar** (`src/components/BottomNav.tsx`) at
  ≤600px with a pill active indicator; the drawer remains for 601–900px.
- Rebuilt dashboard card set: core status (state/uptime/version + panel-gated
  start/stop/restart with a stop confirmation), memory with sparkline,
  connections, egress IP, TUN state (derived from the live config, read-only),
  system takeover (eBPF, read-only), active profile, proxy-group quick switcher
  with inline node selection, and a live-connections table — all backed by the
  existing streams/panel API, no mock data. Cards stay user-arrangeable.
- `docs/ARCHITECTURE.md` documenting the three-service topology, the
  kernel-adapter client boundary, capability degradation and the theme system.
- Acceptance screenshots for the redesign under `artifacts/screenshots/flclash/`
  (4 viewports × palettes, captured against an isolated test instance).

#### Changed
- Removed the upstream desktop-host surface that was unreachable in the web
  build (Tailscale, Taildrop, USB/IP, OpenConnect/OpenVPN, terminal, crash/OOM/
  power reports, profile editor window, tray menu, terminal theme machinery,
  the iterm2-color-schemes submodule and the `@xterm/*`, `luby-transform`,
  `react-markdown`, `remark-*` dependencies). Bundle total drops from ~2.26 MB
  to ~1.32 MB.
- `PanelGate` fails fast with `PanelUnavailableError` when no panel token is
  configured instead of firing `panel-auth-error` (a missing token is not an
  expired one), so direct mode cannot bounce the user to the gate.
- `ToolsView` slimmed to the network tools that exist on the web panel;
  DNS moved to its own page.
- Sidebar follows the FlClash page order; the command palette and Ctrl+1…8
  shortcuts follow the renamed routes.
- `hasPanelToken()` added to `src/api/panel.ts`; all feature gating uses it
  (the raw getter returns `""`, which previously defeated `!== null` checks).

#### Fixed
- Rules page error banners now translate known error strings instead of
  showing raw English text.
- Stale `.gitignore` entry for the removed terminal-theme generated file;
  `_review/` and `.mimosa/` local directories are ignored.

### Added
- React `ErrorBoundary` (with i18n-aware fallback and a reset shortcut) wrapped around every route view, so a crashing view no longer white-screens the panel.
- Route views are now code-split via `React.lazy`; the main bundle no longer pulls in the settings editors, terminal theme picker or report readers until they are opened.
- New generic UI primitives under `src/components/`: `Skeleton`, `Tooltip`, `Breadcrumb`, `Tabs`, `Table`, `Toast` (+ `ToastProvider` / `useToast`).
- `pnpm build` now auto-runs `pnpm generate` when the generated files are missing (fresh clones no longer fail the first build).
- `.github/dependabot.yml` for weekly dependency updates.
- `.github/workflows/upstream-check.yml` surfaces upstream Tailscale dashboard releases.
- Rate limiting on the panel token gate: 5 wrong tokens in 5 minutes lock the gate for 15 minutes. Counts persist in preference storage so a reload does not reset the budget (`src/panel/loginThrottle.ts`, covered by unit tests).
- Git hooks via husky: `pre-commit` runs lint-staged (eslint/stylelint `--fix`), `pre-push` runs `tsc --noEmit` and the test suite.
- `SkeletonLines`, used for the shared stream loading state.
- A `.sr-only` utility class for status text that should only reach screen readers.
- `src/lib/errorReporting.ts`: a no-op error reporting seam (`reportError`) so a Sentry-style backend can be wired in through `VITE_ERROR_REPORTING_DSN` without touching call sites.
- `src/app/useAsyncGeneration.ts`: a generation guard so an abandoned async load can no longer write over newer data.
- ⌘K / Ctrl+K command palette (`src/lib/commandPalette.ts` + `src/components/CommandPalette.tsx`) over every route, with ranked matching that is unit tested.
- Rule hit statistics: `src/lib/ruleHits.ts` diffs connection snapshots into per-rule hit/active/traffic counters, surfaced as a "本次会话命中" card and a per-rule badge in `RulesView`.
- Visual rule editor (`src/lib/ruleEditor.ts` + `src/views/RuleEditorDialog.tsx`): edit route/DNS rules as action + target + matchers, reorder and delete them, review the diff, then validate and apply through the panel API.
- Webhook notifications (`src/lib/notifier.ts`): posts panel errors, core fatal errors and config-applied events to a user-owned URL, since the browser cannot push to a closed tab. Configured from a new 通知 tab in 管理, with a test button.
- `Retry` button on the stream error banner.
- Component render tests (`@testing-library/react` + jsdom) covering `Tabs`, `Table`, `Toast`, `ErrorBoundary` and `SkeletonLines`.
- `notifications` icon.
- Config draft + undo for the config editor (`src/lib/configDraft.ts`): unsaved JSON is autosaved to browser storage and offered back after a reload, the last successfully applied config can be restored with one click, and edits are undoable (coalesced into ~0.7s steps). `RulesView` gets an in-memory undo stack for rule edits.
- Log view virtualization (`src/lib/virtualWindow.ts` + `src/app/useVirtualList.ts`): only the rows intersecting the viewport are mounted, heights are measured after paint so wrapped lines still scroll correctly, and the max-entry cap now goes up to 10000.
- Periodic health checks (`src/lib/healthCheck.ts` + `src/app/useHealthMonitor.ts`): the interval sweep pauses while the tab is hidden, probes groups with a bounded concurrency of 3, persists its schedule state per server, announces new outages once (toast + webhook `health` event), and can optionally fail a group over to its fastest usable node. A 健康巡检 card in `GroupsView` shows the summary, thresholds and a "立即巡检" button; the sidebar warns when nodes are down.
- Drawer swipe gestures (`src/app/useDrawerGestures.ts`): edge swipe opens the navigation drawer, swipe back closes it, with a live drag and flick detection (RTL aware).

### Changed
- Renamed package from `dracpanel` to `@emoeem/dracpanel` (scoped, matches the GitHub org).
- Dropped the upstream `vite-plugin-pwa` / `@vite-pwa/assets-generator` devDependencies (PWA was disabled in `vite.config.ts`).
- Dropped the unused `exports` field (`private: true` made it dead code anyway).
- `pnpm generate:dev` now honours `$SINGBOX_PROTO`, so the proto path is no longer hard-coded.
- "全部测速" now runs URL tests with a bounded concurrency of 6 instead of sequentially, shows live `{done}/{total}` progress, reports the outcome through a toast, and keeps per-group spinners independent.
- `Tabs` supports roving tabindex plus `ArrowLeft`/`ArrowRight`/`Home`/`End` navigation, and emits `aria-controls` when given an `idPrefix`.
- Log lines use `content-visibility: auto`, so the browser skips layout and paint for the thousands of off-screen lines.
- The shared stream loading state renders a skeleton instead of the literal "Loading..." text (the text is still announced to screen readers).
- `RulesView` tabs carry `role="tablist"` / `role="tab"` / `aria-selected`.
- Node buttons in the speed test view carry `aria-pressed`; gate errors are announced via `role="alert"`.
- `--transition-slow` token (0.18s ease); the drawer slide-in no longer hard-codes its duration.
- `--text-faint` in both themes, to reach the WCAG AA 4.5:1 contrast minimum: dark `#6272a4` → `#8296c9` (3.08:1 → 4.99:1), light `#8d866e` → `#7a7358` (3.51:1 → 4.64:1). The token is used by ~80 hint/label rules.
- `ManageView` polls the panel state only while the tab is visible, instead of every 5s regardless of `document.hidden`.
- `RulesView` rule cards are memoised, so typing in the search box no longer re-renders every rule.
- Responsive breakpoints: the drawer layout now kicks in at ≤900px (was 720px), so tablets in portrait get the drawer instead of a squeezed sidebar, and a 901–1180px tier narrows the sidebar to 208px with tighter page padding. `useIsMobile()` matches the same 900px query.
- The auto URL-test timer was replaced by the health monitor: it no longer runs a long serial chain regardless of tab visibility, and it keeps its schedule and reported outages across reloads.

### Fixed
- Dashboard URLs returned by the backend (`zashboard`, MetaCubeXD, official dashboard in `ManageView`, and the update dialog's release link) were rendered straight into `href` without validation; they are now gated on `isHttpUrl()`, matching what the deprecated-warning banner already did.
- `ServerDialog` was extracted into its own module so `ConnectionErrorView` no longer drags in the whole settings chunk, but `ConnectionErrorView` still imported it from `SettingsView`, so the split never took effect.
- Stale results could overwrite newer ones (or write into a detached component) when leaving the connectivity test or speed test mid-run; both now guard with a per-run id.
- `OOMReportListContent` scheduled a 1s reload timer that was never cleared on unmount.
- `ToastProvider` did not clear pending dismiss timers when it unmounted.
- A malformed JSON schema from `generateSchema()` was swallowed by a trailing `.catch(() => {})`, leaving the editor silently schema-less; parsing is now reported separately.
- `index.html` blocked pinch-zoom via `maximum-scale=1.0, user-scalable=no`, which fails WCAG 1.4.4.

## [0.1.0] - 2026-10-18

Initial self-hosted release. Forked from upstream Tailscale dashboard, rebranded for sing-box, and trimmed of the desktop-only parts (Electron, tray) so it builds as a pure static site.