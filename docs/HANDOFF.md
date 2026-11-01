# DracPanel 维护交接文档（HANDOFF）

> 写给下一个维护这个项目的人。读完这一篇，你不需要翻 git 历史就能知道：
> 这个项目是什么、代码在哪里、怎么改、怎么发版、哪些坑已经踩过。
> 最后更新：2026-11-01（Go 后端 0.2.0 已发布至 pacman 仓库）。

---

## 1. 这个项目是什么

**DracPanel** 是一个跑在本机、管理本地 sing-box 内核的 Web 面板。界面 1:1 复刻
FlClash v0.9.2 桌面端（仪表盘/代理/配置/实时连接/工具），观测层借鉴了
daeuniverse/doona（流量时间范围图、出站占比环、设备/域名排行）。**它只是个壳，
数据全部来自本机的 sing-box**——面板本身不代理任何流量。

由两部分组成，同仓开发：

| 部分 | 技术 | 位置 | 职责 |
|---|---|---|---|
| 前端 | React 19 + Vite + CSS Modules | `src/` | FlClash 风格 UI，构建产物为纯静态文件 |
| 后端 | Go 1.25（模块 `backend/`） | `backend/` | HTTP API（9096）、配置安全管线、订阅、eBPF 策略、历史持久化 |

后端是旧 Python 面板（0.1.x，单文件 stdlib 脚本）的**逐端点移植**，行为契约以
Python 版为准；在此基础上新增了 FlClash 契约端点（系统代理、本地导入、内存拆分、
历史流量、事件通知流）。

### 1.1 运行拓扑（背下来）

```
浏览器 SPA
  │  同源 http://127.0.0.1:9096
  │  认证：X-Panel-Token 头（token 在 /var/lib/sing-box-panel/token，0600）
  ▼
sing-box-panel（Go，本仓库 backend/ 编译产物）── /api/* REST
  │                    │
  │ systemctl / 文件系统 │ 读 /etc/sing-box/config.json（改配置走安全管线）
  ▼                    ▼
sing-box.service      sing-box 内核自身暴露的两个 API：
                       ├─ 原生 gRPC-Web API  127.0.0.1:9091（services.api 注入）
                       │   → 前端直连：实时流量/连接/日志/延迟/模式切换
                       └─ Clash 兼容 API     127.0.0.1:9090
                           → 延迟测试、DNS 工具、后端历史采样
```

三个端口各司其职，**不要混**：9096 是唯一 UI 入口；9091 的 CORS 白名单只放行
9096；9090 是内核自己的。

### 1.2 配置安全管线（后端的灵魂）

所有写配置的操作（手动编辑、TUN 开关、局域网代理、订阅写入、eBPF 策略、恢复备份）
都走同一条管线，位于 `backend/internal/singbox`：

```
sing-box check 校验（cache_file 重定向到 /tmp，避免污染服务缓存）
  → 失败：直接返回"配置校验未通过，未做任何改动"，原文件一个字节都不动
  → 通过：备份到 backups/config.<时间戳>.<原因>.json（保留 30 份）
       → 0600 临时文件 + 原子 rename
       → systemctl restart
       → wait_healthy（等 is-active；配置含 tun 才等 tun0；可选代理探针）
       → 失败：自动回滚到应用前的内容并再次重启
```

改任何写配置的代码，先读这个文件，保持事务语义不变。

---

## 2. 仓库与发布拓扑（三个地方，别搞混）

| 位置 | 是什么 | 发布物 |
|---|---|---|
| `~/Projects/dracula-panel-for-singbox`（本仓库，github.com/emoeem/dracpanel） | **源头**：前端源码 + Go 后端源码 | 推送 main 即可，包仓库从这里取 |
| `~/Projects/pkgbuild-source`（github.com/emoeem/pkgbuild） | **Arch 打包仓库**：`packages/dracpanel`（UI tarball）+ `packages/sing-box-panel`（Go 二进制） | push 到 main 触发 CI → 干净 chroot 构建 → 发布到 GitHub release tag `repo` |
| GitHub release `repo` | **pacman 仓库** | 本机 `/etc/pacman.conf` 的 `[emoeem]` 源指向它（经 gh-proxy），`pacman -Syu` 直接消费 |

依赖方向：pkgbuild 仓库的 `dracpanel` 包内含本仓库构建的 `dist/`（tarball 里带
`SOURCE_COMMIT` 文件，`check()` 会校验它与 `dist/build-info.json` 的 commit 一致——
**这是防"手改 dist 忘了重新构建"的机制，别绕过它**）。

---

## 3. 日常开发

```sh
# 前端（仓库根目录）
pnpm install
pnpm dev                 # http://localhost:5173

# 无内核开发：?fixture=1 注入全套假数据（仅 DEV 构建生效，生产会被摇树剔除）
# 浏览器打开 http://localhost:5173/?fixture=1
# 它 mock 了所有 /api/* 端点（见 src/lib/fixture/fixtureApi.ts，也是 API 契约的参考实现）

# Go 后端
cd backend
go test ./...            # 全部单测
go vet ./...
go run ./cmd/sing-box-panel --dry-run --listen 127.0.0.1 --port 9097
                         # dry-run：不碰 systemd，配置写到 /tmp，可安全联调
```

### 3.1 提交前门禁（CI 与 pre-push 都会跑，先本地跑一遍）

```sh
pnpm lint && pnpm lint:css && pnpm test && pnpm build   # 前端
node scripts/smoke-dist.mjs && node scripts/check-bundle-size.mjs
cd backend && go vet ./... && go test ./...             # 后端
```

### 3.2 代码风格强制（stylelint 会拦你）

- CSS 类名**必须 kebab-case**（`.myThing` → `.my-thing`；TSX 里 `styles.myThing`
  靠 vite 的 `camelCaseOnly` 转换照常工作）
- `font-size` / `font-weight` / `z-index` / `gap` / `padding` / `margin`
  **必须用 token**（`--fc-*` 或旧 `--text-*`/`--space-*`），不允许裸数字；
  负 margin 写成 `calc(var(--fc-space-8) * -1)`
- `color-no-hex`：只有 `src/styles/globals.css` 允许 hex，其它文件用 token
  （确需 hex 时局部 `/* stylelint-disable color-no-hex */`，参考 ThemeView 色板）
- 属性顺序走 recess-order，`pnpm lint:css --fix` 能自动修大部分

### 3.3 设计 token 在哪

`src/styles/globals.css`。两套并存：旧 token（`--bg/--card/--accent…`，登录页等
遗留界面用）和 FlClash 层 `--fc-*`（新页面全部用这套：`--fc-page/--fc-card/`
`--fc-block`、`--fc-radius-card`(32px)、`--fc-text-*`（iOS 字阶）、`--fc-shadow-e1/e2`、
`--fc-primary` 等）。主题通过 `<html data-theme/palette/amoled/accent>` 属性切换，
token 联动，前端组件不要硬编码颜色。

---

## 4. 部署到本机（两条路）

### 路 A：install.sh（开发迭代用，快）

```sh
pnpm build                                    # 或 make ui
sudo ./deploy/install.sh --ui-only            # 只换 UI，不重启任何服务
sudo ./deploy/install.sh --backend backend/sing-box-panel   # 换 Go 后端二进制
# 完整部署（改 services.api、GeoIP 等）：sudo ./deploy/install.sh
```

脚本自带全量备份 + trap 回滚。装完它会把 systemd drop-in
（`/etc/systemd/system/sing-box-panel.service.d/10-config-path.conf`）的 ExecStart
指向 `/usr/local/bin/sing-box-panel --config /etc/sing-box-panel/panel.json`。

### 路 B：pacman 仓库（正式发版用）

见 §5。**当前本机状态**：已切到 pacman 管理（`/usr/bin/sing-box-panel` 0.2.0），
drop-in 保留但指向 `/usr/bin`。如果你重新跑了 `install.sh --backend`，记得按
pkgbuild 仓库 README 里那样把 drop-in 改回 `/usr/bin`，否则 pacman 升级会被
`/usr/local/bin` 的旧二进制遮蔽。

> ⚠️ drop-in 里的 `--config /etc/sing-box-panel/panel.json` **必须保留**。
> 后端的裸默认路径是 `/etc/sing-box/panel.json`（Python 版 parity），没有 drop-in
> 会读错配置、丢掉 ui_dir/subscription_proxy 等设置。

---

## 5. 发版到 pacman 仓库（最容易踩坑的流程，完整走一遍）

以"改了前端"为例：

```sh
# 1) 源仓库：提交（commit hash 会进 build-info，必须真实）
git commit -m "..."          # pre-commit 会跑 lint-staged

# 2) 用 HEAD 的代码构建 dist（不要用旧的！）
pnpm build
cat dist/build-info.json     # 确认 commit 字段 == 你刚提交的 short hash

# 3) 打 tarball：git archive 打包 HEAD + 用新 dist 覆盖 + 写 SOURCE_COMMIT
STAGE=/tmp/pkgstage && rm -rf $STAGE && mkdir -p $STAGE
git archive HEAD --format=tar --prefix=dracpanel-0.1.0/ --output=/tmp/base.tar
tar -xf /tmp/base.tar -C $STAGE
rm -rf $STAGE/dracpanel-0.1.0/dist && cp -a dist $STAGE/dracpanel-0.1.0/dist
git rev-parse HEAD > $STAGE/dracpanel-0.1.0/SOURCE_COMMIT
tar --zstd -cf /tmp/dracpanel-0.1.0.tar.zst -C $STAGE dracpanel-0.1.0

# 4) 改 pkgbuild 仓库
cd ~/Projects/pkgbuild-source/packages/dracpanel
cp /tmp/dracpanel-0.1.0.tar.zst .
# 编辑 PKGBUILD：pkgrel +1，sha256sums 换成 sha256sum *.tar.zst 的新值
makepkg --printsrcinfo > .SRCINFO    # ← 忘了这步 = CI 直接红（见 §7 坑 1）
makepkg -f                           # 本地验证能构建
cd ../sing-box-panel && makepkg --printsrcinfo > .SRCINFO   # 没改就跳过

# 5) 提交推送（CI 自动构建并发布到 release tag repo）
cd ~/Projects/pkgbuild-source
git add packages/dracpanel && git commit -m "chore(dracpanel): ..."
# 远端常有 rule-sets 机器人自动提交，push 被拒就 stash→rebase→pop→push：
git stash push -m wip && git pull --rebase && git push origin main && git stash pop

# 6) 等 CI（Actions → Build private Arch repository，约 15-25 分钟）绿了之后
sudo pacman -Syu
```

Go 后端发版同理，但注意 `packages/sing-box-panel/PKGBUILD` 是**二进制包**：
先在 backend/ 里 `go build -trimpath -ldflags "-s -w -X main.version=..."` 出
linux-amd64 二进制，拷贝为 `packages/sing-box-panel/sing-box-panel-linux-amd64`，
更新 PKGBUILD 里它的 sha256sums，pkgver 升 `0.x.0`。

### 5.1 语义版本约定

- 前端 `package.json` version 目前停在 0.1.0，靠 `pkgrel` 递增区分包版本；
  tarball 文件名 = `dracpanel-<pkgver>.tar.zst`，必须与 PKGBUILD 的 `pkgver` 一致
- 后端 `pkgver` 跟 Go 语义版本（0.2.0 = 当前），`main.version` 由 ldflags 注入，
  `/api/ping` 与 `/api/state.panel_version` 会如实上报
- `api_version: 8` 是面板 HTTP 契约版本（见 `docs/PANEL_API_CONTRACT.md`），
  **只有改 API 形状时才 +1**，并在该文档记录

---

## 6. 关键文件地图（改哪去哪）

### 前端（本仓库）

| 想改什么 | 去哪 |
|---|---|
| 全局设计 token / 主题 | `src/styles/globals.css`（`--fc-*` 层在文件中部） |
| 仪表盘 | `src/views/dashboard/DashboardView.tsx` + `Dashboard.module.css`；数据 hooks 在 `useDashboardData.ts` / `useRuntimeToggles.ts` / `useObservability.ts`；观测卡在 `ObservabilityCards.tsx` |
| 代理 / 配置 / 连接记录页 | `src/views/proxies|profiles|records/` |
| 工具页（主题/常规/进阶/规则/备份/资源） | `src/views/tools/` |
| 侧栏 / 底部导航 / 路由 | `src/App.tsx`（Route 联合类型 + ROUTE_ALIASES）、`src/components/Sidebar|MobileNav` |
| FlClash 基础组件 | `src/components/flclash/`（FcCard/FcSwitch/FcSegmented/FcRecordTable/FcSheet/FcTimeChart/FcDonut…） |
| 面板 REST 客户端 + 契约类型 | `src/api/panel.ts`（超时常量也在最上面） |
| 内核 gRPC 客户端 / 流存储 | `src/api/daemon.ts` + `src/api/stream.ts`（StreamStore，勿轻易动） |
| fixture 假数据 | `src/lib/fixture/fixtureApi.ts` |
| TUN/局域网/系统代理开关逻辑 | `src/app/useRuntimeToggles.ts` + `src/lib/flclash/configEdit.ts`（jsonc 注释保留式编辑） |
| 登录门 | `src/panel/PanelGate.tsx` |

### Go 后端（backend/）

| 想改什么 | 去哪 |
|---|---|
| 入口 / 装配 | `cmd/sing-box-panel/main.go` |
| 路由 / 认证 / 404 契约 / 静态服务 | `internal/httpapi/server.go` |
| 配置事务 / 备份 | `internal/singbox` |
| systemctl 封装 / 健康等待 | `internal/systemd` |
| 订阅（store/解析/apply/调度器） | `internal/subs`（parse.go 一个文件一个 scheme） |
| eBPF 策略 / probe 透传 / apps 扫描 | `internal/ebpf` |
| 历史采样 / 落盘 / 降采样 | `internal/history` |
| 有序 JSON + JSON5 剥离 | `internal/jsonx`（配置键序不乱全靠它） |
| 系统代理 / 本地 IP / 内存拆分 | `internal/sysproxy` / `localip` / `meminfo` |
| 事件通知流 | `internal/notifications`（事件挂接点在 main.go 与 httpapi） |
| GeoIP | `internal/geoip`（City 库，503/404 语义勿改） |

### 打包仓库（pkgbuild-source）

| 文件 | 说明 |
|---|---|
| `packages/dracpanel/PKGBUILD` | UI 包；`check()` 校验 build-info ↔ SOURCE_COMMIT |
| `packages/sing-box-panel/PKGBUILD` | 后端二进制包；依赖仅 `sing-box` |
| `.github/workflows/build.yml` | push packages/** 自动构建 + 发布到 release tag `repo` |
| `scripts/configure-build-repo.sh` | chroot 构建时的 [emoeem] 仓库注入 |

---

## 7. 踩坑记录（都是真实付出过时间的）

1. **`.SRCINFO` 忘了重新生成** → CI 的元数据校验直接红（PKGBUILD 与 .SRCINFO 的
   sha 不一致）。每次改 PKGBUILD 后必须 `makepkg --printsrcinfo > .SRCINFO`。
   这是 2026-10-31 首次发 Go 包时真实失败过的。
2. **`git archive` 忘了 `--prefix`** → 解包后 backend/ 落在 /tmp 根下，tarball 缺
   一半文件。上面 §5 的命令已带 prefix，照抄即可。
3. **改了源码但用旧 dist 打 tarball** → 包的 `check()` 会报 "dist was built from
   xxx but the sources are yyy"。这是设计行为：先提交、再 `pnpm build`、再打 tarball。
4. **pkgbuild 远端常有机器人自动提交**（sing-box-rule-sets 每 6 小时刷新）→ push
   被拒就 `git stash push -m wip && git pull --rebase && git push && git stash pop`。
   工作区有你自己的未提交 WIP 也不怕，stash 会保住。
5. **Go 后端裸跑（无 --config）默认读 `/etc/sing-box/panel.json`**（Python parity），
   不是 `/etc/sing-box-panel/panel.json`。部署必须带 drop-in 或显式 `--config`。
6. **PKGBUILD heredoc 里不能再写 `EOF`**（会被提前截断），用 `LICENSE_EOF` 之类的
   独立标记。
7. **StreamStore 的 producer 必须挂起**（`await new Promise<never>(() => {})`），
   return 会被当作断流触发无限重连——写 fixture 或新 store 时注意（见
   `src/lib/fixture/fixtureApi.ts`）。
8. **eBPF 模式机器**：本机是 eBPF 接管（无 tun0）。`wait_healthy` 只在配置含 tun
   入站时才等 tun0，所以后端不会卡；仪表盘「流量接管」卡在 eBPF 模式显示锁定态，
   这是有意的，别把它改回 TUN 开关。
9. **npm/pacman 走的镜像可能很慢**（npmmirror），CI 超时不一定是代码问题，先看
   失败日志再动手。

---

## 8. 设计决策与已知限制（别"修复"它们，除非你理解后果）

- **订阅抓取没有 SSRF 防护**（仅 http/https scheme 检查 + 可选
  `subscription_proxy`，默认 `http://127.0.0.1:7892`）：与 Python 版保持一致的有意
  决策。面板只监听 127.0.0.1 且需要 token；若要加防护，需同时改 UI 的错误文案预期。
- **eBPF probe 是纯透传**：`sing-box tools ebpf status --mode all --json`（reF1nd
  fork 提供，包 `sing-box-ebpf`）。findings/summary 的语义归那个二进制，面板不解析。
- **节点不去重、tag 冲突靠 `#N` 重命名**、**Proxy/Auto 组必须已存在于配置**（面板只
  重整成员，不创建组）：全部沿用 Python 版行为，订阅 apply 的可预期性优先。
- **历史流量从后端启动起积累**（`/var/lib/sing-box-panel/history.jsonl`，7 天保留，
  每分钟一条，Clash API 不可达时留空隙而非补零）。没有回填，重启面板不清零。
- **DNS 标签页是会话账本**：内核没有 DNS 日志 API，只记录面板自己发起的查询。
  页面有明确文案，不要假装它是全量日志。
- **通知流只记录面板动作**（配置/服务/订阅/导入），不是内核事件总线。
- **i18n**：重建后的新页面文案是中文硬编码（基准与 FlClash 中文一致）；i18n 框架
  （五语言）仍在，老页面继续走 `t()`。要接入新文案时在 `src/app/translations.ts`
  加 key 并替换硬编码，工作量集中但机械。
- **无 TUI/桌面壳**：曾有 Tauri/desktop 宿主，已在重构中删除，浏览器是唯一形态。

---

## 9. 想加新功能？检查清单

1. 数据从哪来？→ 先看 §1.1 三个 API 有没有；没有就考虑 `docs/PANEL_API_CONTRACT.md`
   的可选端点模式（UI 端 `optionalRequest` + 缺失时禁用并如实提示，**绝不造假数据**）
2. 新页面 → `src/App.tsx` 加 Route + 路由项 + 侧栏/底部导航项 + lazy import
3. 新组件 → 优先复用 `src/components/flclash/`；几何参数照 FlClash（卡片圆角 32、
   间距 8/12/16、断点 600/640/840/860）
4. 写操作 → 走既有管线（配置类用 singbox 事务；内核操作走 daemon API；面板特权操作
   走 panelFetch），并在 `internal/notifications` 挂一条事件
5. 跑完 §3.1 全部门禁；改了 API 形状就同步 `docs/PANEL_API_CONTRACT.md` 和
   `src/lib/fixture/fixtureApi.ts`（它是契约的活文档）

---

## 10. 一分钟速查

```sh
# 日常
pnpm dev                                   # 带内核开发
pnpm dev + 浏览器 ?fixture=1               # 无内核开发
cd backend && go test ./...                # 后端测试

# 发布 UI
git commit && pnpm build && （§5 的 tarball 流程） && push pkgbuild-source
sudo pacman -Syu                           # 等 CI 绿后

# 部署到本机（不走 pacman 的快速迭代）
sudo ./deploy/install.sh --ui-only
sudo ./deploy/install.sh --backend backend/sing-box-panel

# 验证线上
curl -s http://127.0.0.1:9096/api/ping | grep version
systemctl status sing-box-panel sing-box
```

有问题先读 `docs/ARCHITECTURE.md`（运行细节）、`docs/PANEL_API_CONTRACT.md`
（API 契约）、`DEPLOYMENT.md`（部署细节），再读代码。git 历史里 2026-10-31 的
"FlClash v0.9.2 UI rebuild + Go backend 0.2.0" 两个大提交是当前形态的起点。
