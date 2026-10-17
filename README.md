# Dracula Panel for sing-box

**English summary:** An unofficial Dracula/Alucard-themed desktop web UI for
[sing-box](https://sing-box.sagernet.org/). It keeps the upstream native-API
dashboard and adds a local management module (service control, subscriptions,
eBPF policy, JSON config editor) through `sing-box-panel`. One UI entry, one
panel token, and the native API secret is bootstrapped and cached automatically.

> **Unofficial fork.** This project is built on top of
> [SagerNet/sing-box-dashboard](https://github.com/SagerNet/sing-box-dashboard)
> (GPL-3.0). It is not affiliated with or endorsed by SagerNet or the sing-box
> project. See [NOTICE](NOTICE) and [LICENSE](LICENSE).

![Dracula Panel overview](artifacts/screenshots/01-overview-dark.png)

## 这是什么

一个桌面形态的 sing-box Web 面板：

- 以**官方 sing-box-dashboard 源码**为底版做深度定制，保留 React 19 + Vite +
  TypeScript + Connect RPC 的架构和对原生 gRPC API 的完整封装。
- 全局换成 **Dracula**（暗）/ **Alucard**（亮）主题，覆盖官方页面、管理模块、
  CodeMirror 配置编辑器和图表。
- 增加一个**管理模块**：服务启停/重启/重载、订阅、eBPF 分应用策略、配置编辑
  （校验 → 备份 → 原子替换 → 重启 → 失败回滚），与官方页面同一设计系统，
  没有 iframe。
- **一个浏览器入口**：`http://127.0.0.1:9096/`。原生 API 仅作为内部 RPC
  (`9091`)，自带 dashboard 已关闭；zashboard 保留在 `/dash/` 作回退。

## 功能

- **概览 / 代理 / 连接 / 日志 / 规则 / 测速 / 设置 / 管理**，外加官方工具页
- 四模式顶栏下拉：`Rule` / `Proxy` / `RuleAllowAds` / `Direct`，走原生
  `SetClashMode`，切换后立即生效
- 原生 API：节点切换、URLTest、连接流、日志流、实时流量、NetworkQuality/STUN
- 规则页从**实时配置**派生（原生 API 没有规则 RPC），展示 route/DNS 规则、
  规则集、final
- 连接表窗口化虚拟滚动（不再截断 500 条）
- `Ctrl+1…8` 切换八个主页面；主题/强调色/最后页面/管理标签页持久化
- 44px 顶栏：logo、运行状态灯、版本、模式下拉、亮暗、刷新
- 窄屏自动降级：侧栏抽屉、模式选择器降级为下拉、无横向溢出

## 架构

```text
Browser
  │
  ▼
127.0.0.1:9096  Dracula Panel（React 静态产物，由 sing-box-panel 的 ui_dir 提供）
  ├─ /api/*    sing-box-panel 管理 API（同源，X-Panel-Token）
  ├─ 127.0.0.1:9091  sing-box 原生 API（Connect / gRPC-Web，仅 RPC，dashboard 关闭）
  └─ 127.0.0.1:9090  Clash API（zashboard 回退和面板遗留节点接口）
```

### 为什么 UI 由 panel `ui_dir` 提供

构建产物放在 `/usr/local/share/sing-box-panel-ui`，由 `sing-box-panel` 在
9096 提供，而不是放在 `/var/lib/sing-box/dashboard` 由原生 API 的
`/dashboard/` 提供：

- 管理 API 与 UI 同源，不需要给 panel 再加 CORS；
- 原生 API 支持 CORS 白名单，9096 可以安全访问 9091；
- 最终只有一个浏览器入口（9096），9091 只做内部 RPC；
- zashboard 继续在 `/dash/` 作为回退。

原生 API 的 `services.api` 显式配置了
`access_control_allow_origin = ["http://127.0.0.1:9096", "http://localhost:9096"]`，
没有 `*` 兜底；`dashboard.enabled = false`。

### 登录与密钥引导

1. 登录只需 **panel token**（`/var/lib/sing-box-panel/token`）。
2. 校验后从 `/api/config` 读取一次完整配置，提取 `services[type=api]` 的
   secret 和端口，写入 dashboard 的 server 列表并连接原生 API。
3. 配置 mtime 会缓存：普通刷新只请求 `/api/state`，不重复拉全量配置；只有
   配置真的变化后才重新同步一次。
4. 核心停止时登录闸门提供 Dracula 风格的服务恢复界面；配置应用/重启后
   `DaemonApi.reconnectNow()` 自动恢复数据流，不整页刷新。

## 页面与快捷键

| Page | 说明 |
| --- | --- |
| 概览 | 流量、内存、连接数、四模式卡片 |
| 代理 | 策略组、节点切换、延迟 |
| 连接 | 实时连接、搜索、关闭、虚拟滚动 |
| 日志 | 原生日志流、级别过滤、搜索 |
| 规则 | 配置派生的路由/DNS 规则、规则集、final |
| 测速 | 分组 URLTest、网络质量/STUN 入口 |
| 设置 | 偏好、服务器、上游链接、非官方声明 |
| 管理 | 运行状态、订阅、eBPF、配置 |

`Ctrl+1` 概览 · `Ctrl+2` 代理 · `Ctrl+3` 连接 · `Ctrl+4` 日志 ·
`Ctrl+5` 规则 · `Ctrl+6` 测速 · `Ctrl+7` 设置 · `Ctrl+8` 管理

## 管理模块

- **运行状态**：启动/停止/重启/重载（panel API），PID/启动时间/配置路径，
  原生实时流量。核心停止时该页面仍然可用。
- **订阅**：添加 URL、全量更新、单条更新、写入配置、删除；写入走 panel 的
  校验/备份/重启/回滚事务。
- **eBPF**：策略模式、应用列表、UID 选择、能力预检。
- **配置**：CodeMirror JSON5 编辑器（Dracula 语法色）、校验、应用并重启、
  备份列表与恢复。应用失败由 panel 自动回滚。

## 主题

- 暗色：Dracula（`#282a36` / `#44475a` / `#f8f8f2` / `#6272a4` / `#bd93f9` / `#8be9fd`）
- 亮色：Alucard（`#fffbeb` / `#1f1f1f` / `#6c664b` / `#cfcfde` / `#644ac9`）
- CodeMirror：属性/字符串/数字/布尔/注释/错误分别映射到 cyan/green/yellow/
  orange/comment/red
- PWA / Service Worker 已关闭，升级/回滚不会被旧缓存挡住

更多截图见 [artifacts/README.md](artifacts/README.md)（含验收记录）。

## 环境要求

- Linux + systemd；本项目在 CachyOS（Arch 系）上用 `sing-box-panel 0.1.0-6`
  和 `sing-box v1.14.3-reF1nd` 验证
- sing-box 1.14+，支持 `services.api` / Connect API
- Node.js 22+（验证使用 24.22.0）、pnpm 11、Git
- 已安装 `sing-box-panel`，并准备好它的 `--config` systemd drop-in
- `deploy/install.sh` 假定 panel 在 `127.0.0.1:9096`、UI 目录为
  `/usr/local/share/sing-box-panel-ui`；不同发行版/目录结构请先阅读脚本再运行

## 构建

```bash
git clone --recursive https://github.com/emoeem/dracula-panel-for-sing-box.git
cd dracula-panel-for-sing-box
# 如果克隆时没有 --recursive：
git submodule update --init --depth 1

npx --yes pnpm@11.13.0 install --frozen-lockfile --trust-lockfile
npx --yes pnpm@11.13.0 generate   # protobuf + 图标 + 终端主题
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build
```

> `--trust-lockfile` 用于跳过 pnpm 11 对 lockfile 每个条目的供应链元数据校验；
> 仓库使用的是上游固定 lockfile。网络条件好时可以省略。

`src/gen/` 和 `src/lib/terminalThemes.generated.ts` 是生成文件，按上游约定
不提交；`pnpm generate` 会生成它们。

## 部署

```bash
sudo ./deploy/install.sh
```

脚本会（一次 sudo）：

1. 备份 `/etc/sing-box/config.json`（时间戳，600）；
2. 添加/更新 `services[type=api]`：`127.0.0.1:9091`、随机 secret、
   9096-only CORS 白名单、私有网络、dashboard 关闭；
3. 确认 panel 配置（`/etc/sing-box-panel/panel.json`）和 systemd drop-in；
4. 安装 `sing-box-config-perm.path`（配置变更后 `chmod 600`，并用
   `stat -c %a` 复核）；
5. 备份旧 UI 到 `...legacy-<timestamp>`，安装新构建；
6. 重启两个服务并做健康检查（失败自动回滚）。

脚本不会修改 `/usr/bin` 或 `/usr/share` 下的包文件。

### 首次登录

```bash
sudo cat /var/lib/sing-box-panel/token
```

打开 <http://127.0.0.1:9096/>，输入 token。原生 API secret 会自动引导并缓存，
不需要再输第二个密钥。

## 安全

- panel API 与 UI 同源，使用 `X-Panel-Token`；
- 原生 API 只监听 `127.0.0.1:9091`，CORS 白名单仅 9096/localhost:9096；
- 9091 的 dashboard 已关闭（`/dashboard/` = 404）；
- panel 写配置时是 0644，`sing-box-config-perm.path` 会立即恢复 600 并复核；
- 静态产物不含任何 token/secret；登录后 secret 存在本机 localStorage；
- 仓库中的验收截图来自真实本机实例，**部分截图包含本地测试域名/流量**；
  如果要把本仓库公开，请先审阅/脱敏 `artifacts/screenshots/`。

## 验收

真实环境（非 mock）验收结果摘要：

| 项目 | 结果 |
| --- | --- |
| 四个自定义模式 | 顶栏切换，Clash API 逐一复核，已复位 Rule |
| 重启 / eBPF 应用 / 停止 / 启动 | 33/33；PID 变化，页面未整页刷新，RPC 自动恢复 |
| 配置编辑器应用/恢复 | `log.level` warn → info → warn，服务健康，无整页刷新 |
| 订阅 | 本地 mock 源添加/更新/删除，已删除；未写入测试节点 |
| secret 引导缓存 | 首次登录读一次完整配置；刷新只请求 `/api/state` |
| 连接虚拟滚动 | 56 条连接仅渲染 14 个 DOM 行 |
| CORS / 9091 | 9096 允许，非白名单无 ACAO；`/dashboard/` 404 |
| 配置权限 | 600；模拟 644 后被 path unit 复核回 600 |
| 回滚演练 | UI + 配置回滚均通过并恢复 |
| 包完整性 | `pacman -Qkk sing-box-panel`：51 文件，0 变化 |

完整截图和记录见 [artifacts/README.md](artifacts/README.md)。

## 回滚

完整步骤见 [DEPLOYMENT.md](DEPLOYMENT.md#rollback)。核心是：

```bash
# 恢复 sing-box 配置（移除 9091 API）
sudo cp -a /etc/sing-box/backups/config.json.bak.<timestamp>-dracula /etc/sing-box/config.json
sudo chmod 600 /etc/sing-box/config.json
sudo systemctl restart sing-box

# 恢复旧 UI
sudo rm -rf /usr/local/share/sing-box-panel-ui
sudo mv /usr/local/share/sing-box-panel-ui.legacy-<timestamp> /usr/local/share/sing-box-panel-ui
sudo systemctl restart sing-box-panel
```

zashboard 回退入口 `http://127.0.0.1:9096/dash/` 始终保留。

## 限制

- 原生 API 没有规则 RPC；规则页只能从实时配置派生，不是“内核实际命中规则”的
  实时日志。
- 上游仅桌面宿主可用的页面（崩溃/功耗/OOM 报告等）在 Web 构建中仍保持
  host-only 行为。
- `Global` 模式保留在配置中供 zashboard 回退使用，但新 UI 只展示四个目标模式。
- 订阅的“写入配置”使用与配置应用相同的 panel 事务；验收中未把测试节点写入
  真实配置。
- `deploy/install.sh` 是针对本机 systemd/panel 布局的部署脚本，不是通用安装器。

## 目录

```text
├── src/                 React 源码（官方 dashboard + 新增管理/规则/测速/顶栏）
├── public/              图标等静态资源
├── proto/               StartedService protobuf
├── vendor/              iTerm2 色板 submodule（生成终端主题）
├── artifacts/           验收脚本、截图、验收记录
├── deploy/              一次性部署脚本、回滚演练脚本
├── NOTICE               上游/主题/非官方声明
├── LICENSE              GPL-3.0
├── README-UPSTREAM.md   上游原始 README（保留）
└── DEPLOYMENT.md        构建、部署、安全、回滚细节
```

## 许可证与致谢

- 本项目基于 [SagerNet/sing-box-dashboard](https://github.com/SagerNet/sing-box-dashboard)，
  遵循 **GNU GPL v3.0**；见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
- Dracula / Alucard 色板来自 [Dracula Theme](https://github.com/dracula/dracula-theme)。
- 图标来自 Material Design Icons（Apache-2.0）。
- 上游许可证明确要求衍生作品不得使用原名或暗示官方关联；本项目使用
  “Dracula Panel for sing-box” 并明确声明非官方。
