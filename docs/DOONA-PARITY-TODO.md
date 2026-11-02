# Doona 对齐：交接与剩余工作清单

> 最后更新：2026-11-02（doona 演示站逐页对比报告见 `docs/DOONA-GAP-REPORT-2026-11.md`；i18n 统一进行中；§4.10 健康告警落 journal、关于页版本号、行内加规则组件 `src/views/AddRuleButton.tsx` 已完成）
> 适用对象：接手继续开发的人
> 前置阅读：`docs/AUDIT.md`（功能审计与证据）、`docs/COMPLETION-PLAN.md`（早期 P0–P3 计划）、`docs/HANDOFF.md`（原始维护交接）

---

## 0. 一句话现状

控制台已按 doona 的 IA 重排（活动/观测/路由/设置）。**策略、节点、连接（流量+列表）、事件、系统状态、分流（路径拓扑）、规则（三标签）、DNS（四标签）**已完成到可用；**配置四标签、设置两标签、日志直方图、活动部件化**仍是半成品或缺失。三项 sing-box 无法原生对应的功能按已批准方案做近似。

---

## 1. 已经完成、可以放心继续的部分

### 1.1 共享地基（不要再造轮子）

| 能力 | 位置 | 说明 |
|---|---|---|
| 装配 | `backend/internal/bootstrap/bootstrap.go` | 统一构造 Deps，注入 Feed/History/Sampler/ApplyConfigText |
| 配置事务 | `backend/internal/singbox/singbox.go` | `Apply`（dump 写入）/ `ApplyText`（**按原文写入，保 JSONC 注释**）；check→备份→原子写→reload-first→健康检查→回滚 |
| 冲突检测 | `POST /api/config` 的 `base_mtime` | 过期编辑器返回 `ok:false, code:"config_stale"` |
| 前端补丁 | `src/lib/configPatch.ts` | `patchConfigText(text,path,value)`，jsonc-parser 实现，**所有新编辑器必须用它** |
| 编辑写入 | `applyPanelConfig(text, mtime)` | 校验 → 应用 → `afterConfigChange` |
| 日志/事件 | `backend/internal/notifications`、`GET/POST /api/journal` | 500 条 / 7 天；severity(info/warn/error)、category(operation/event) |
| 托管覆盖 | `managed.json.group_overrides`、`subs.Apply` | 手工删除/排序在订阅 apply 后保留 |
| 节点排除 | `managed.json.node_exclude`、`subs.Apply` | 删除托管节点后不再复活 |
| UI 原语 | `src/components/flclash/` | `FcTabs`、`FcField`、`FcSelect`、`FcScatter`、`FcSheet`、`FcRecordTable` 等 |

### 1.2 逐页状态

| 页面 | 状态 | 备注 |
|---|---|---|
| 活动 `#/activity` | 🟡 基础完成 | 仍是原仪表盘；缺「编辑仪表盘」与 6 个 doona 小部件 |
| 系统状态 `#/overview` | 🟡 部分 | 服务/资源/配置/能力/控制完成；缺 导出 JSON、暂停、重载、数据路径、未开启功能 |
| 连接 `#/connections` | ✅ 完成 | 流量视图（散点/P50/P90/深链）+ 列表（状态/TCP·UDP 筛选、分组、排序、CSV·JSON 导出、偏好持久化） |
| 分流 `#/flows` | ✅ 完成 | 规则/设备 → 出站 → 节点 路径拓扑、点击筛选+清除、SVG 连线；记录表含时间/规则/出站 |
| DNS `#/dns` | ✅ 四标签完成 | 统计（中位/P95/失败率/缓存估算 + 上游延迟条 + 响应方格 + 排行 + 探测）、解析记录（含采集开关）、缓存、查询 |
| 日志 `#/logs` | 🟡 | 修了宽度；缺模块过滤、级别直方图、流式指示 |
| 事件 `#/events` | ✅ 基本完成 | 事件/操作记录双标签、级别筛选、导出 JSON；缺「排除运行状态更新」 |
| 策略 `#/policies` | ✅ 完成 | 组 CRUD、成员排序、类型/参数、托管覆盖、筛选与计数 |
| 节点 `#/nodes` | ✅ 完成 | 列表/延迟、筛选、粘贴、编辑、删除、全部测速、更新订阅 |
| 规则 `#/rules` | ✅ 三标签完成 | 路由（简易模板+高级）/ DNS 规则 / 追踪模拟；暂存+统一应用；见 §3.1 备注 |
| 配置 `#/config` | 🟡 仅原始编辑器 | 缺 模块导航、全局设置表单、备份与修订标签 |
| 设置 `#/settings` | 🟡 仍是工具页 | 缺 通用/外观 标签、配置方案、日志需求、地理数据、延迟探测 |

图例：✅ 完成 / 🟡 部分 / ❌ 未开始

---

## 2. 必须遵守的约定（违反会引入回归）

1. **配置写入只走一条路**：`patchConfigText` → `validatePanelConfig` → `applyPanelConfig(text, mtime)`。禁止 `JSON.parse` + `JSON.stringify` 整文件重写（会丢注释）。
2. **后端不要直接 Dump 写配置**：需要写原文时用 `Manager.ApplyText`；程序化生成配置才用 `Apply`。
3. **新增依赖别漏装配**：`httpapi.Deps` 只在 `bootstrap.Build` 构造；测试用 `internal/bootstrap/bootstrap_test.go` 的 fixture。新端点要加进 `TestAllRoutesNoServerError` 的路由矩阵。
4. **托管组/节点的编辑要落账**：组成员改动写 `POST /api/policies/{tag}/overrides`；删除托管节点写 `POST /api/nodes/{tag}/exclude`。
5. **能力协商**：新端点要么进 `/api/state.features`，要么在前端用 `optionalRequest` 降级，不能假设一定存在。
6. **UI 一致性**：新页面用 `FcPageToolbar` + `FcCard` + FlClash 原语；别再引入 `components/ui.tsx` 的新依赖（该组件族待迁移）。
7. **`.page` 宽度**：`shared.css` 的 `.page` 已设为 `width:100%`，别再给页面加 `margin-inline:auto` 之类的收缩写法。

---

## 3. 剩余工作（按建议顺序）

### 3.1 规则页三标签（✅ 已完成，2026-11-01）

**已交付**：
- 三标签 `FcTabs`：`路由规则 / DNS 规则 / 追踪模拟`（`src/views/tools/RulesView.tsx` 为外壳）。
- **暂存改动 + 统一应用**：路由与 DNS 两个标签的编辑都只改本地暂存；顶部出现「有未应用的暂存改动」应用条，一次 `patchConfigTextMany` 同时写两个段（注释保留），失败时保留暂存并刷新基线。
- **路由规则·简易模式**：服务模板卡（AI 服务 / 流媒体 / 广告拦截 / Telegram，`更多模板` 弹层含 Google / 开发者 / 国内直连 / Apple 共 8 个）；模板优先引用配置已有的 `route.rule_set`（`resolveTemplateRule`），没有则回退静态域名后缀列表，卡片上标注实际写入内容；目标出站可选（默认 `route.final`）。
- **路由规则·高级模式**：既有列表（搜索/重排/删除）+ `RuleEditorDialog`，目标输入带出站 datalist 补全。
- **DNS 规则**：读写 `dns.rules`，复用 `RuleEditorDialog` 的 `targetKey="server"`，`dns.servers[].tag` 作为 datalist。
- **追踪模拟**：`src/lib/ruleTrace.ts` 静态求值（domain/suffix/keyword/regex/ip_cidr/geoip-private/port/port_range/network/invert），`rule_set`、逻辑组合、geoip 库等明确标「需内核判定」并停止推演；UI 标注不覆盖 rule_set 内容、结果可能比内核宽松。
- 测试：`ruleTrace.test.ts`（17 例，含 invert 语义与「假匹配器压过未知匹配器」的推导顺序）、`ruleTemplates.test.ts`（7 例）；fixture 配置补齐 `outbounds`/`dns`/`services.api` 段以便后续页面验收。
- 浏览器验收（fixture 模式）：三标签渲染、模板添加→暂存→应用→刷新全链路、DNS 列表、追踪结论与免责声明、高级编辑器 datalist 均通过。

**遗留（小项，不阻塞）**：
- 模板不可编辑参数（如自定义域名集合），只能生成后到高级模式改；
- 追踪模拟无「按暂存前基线对比」视图。

### 3.2 DNS 四标签（✅ 已完成，2026-11-01）

**已交付**：
- 后端 `internal/dnslog`：按需 `journalctl` 读取并宽容解析 debug 级 `dns:` 行（domain/type/client/upstream/status/elapsed），15s 缓存；`internal/dnsprobe` 对 `dns.servers[]` 做真实 UDP/TCP/TLS/DoH 探测，2s 超时、30s 缓存。
- 端点：`GET /api/dns`、`GET /api/dns/queries?minutes&limit`、`GET /api/dns/probe[?force=1]`；`api_version` 8→9，Features 增 `dns.stats`；三路由进装配级路由矩阵，dnslog 5 例 / dnsprobe 8 例单测。
- 前端 `src/views/dns/DnsView.tsx` 四标签：统计（四指标卡、按上游 log 轴延迟条、响应结果方格、域名/设备排行、探测上游）、解析记录（表 + 搜索 + 采集开关）、缓存（配置/文件足迹 + 清 DNS/FakeIP）、查询（原工具内联）。
- `src/lib/dnsStats.ts` 纯函数 + 7 例单测。

**如实标注（不伪造）**：缓存命中率为估算（无上游归属的应答）；缓存条目列表 sing-box 不提供；记录仅 debug 级存在，页面提供改 `log.level` 的开关并提示日志噪音。

### 3.3 活动页部件化 + 编辑仪表盘（✅ 已完成，2026-11-02）

**已落地**：`dashboard/widgets.ts` 22 个部件注册表 + `normalizeLayout` 纯函数 + localStorage `dashboard-widgets-v1`；`DashboardEditSheet` 显隐/上下排序/宽 span/高 rows/撤销/恢复默认；网格按 4/2/1 列自适应；新增节点延迟、各出站连接数、DNS 结果、策略组、全局出站、会话统计部件；流量卡新增「实时」档（读 status 流的秒级 history，不发 `/api/history` 请求）。
**未做**：部件间深链只做了「打开节点页 / 打开 DNS 页 / 打开代理页 / 打开配置页」四处，`#/connections?tab=traffic&out=` 这类 exact 深链仍未接。

**原始要求**：
- `DashboardView` 增加部件注册表：流量、出站下载量、流量排行、内存、通知、各出站连接数、策略组当前节点、连接流量、节点延迟、DNS 查询结果。
- 「编辑仪表盘」`FcSheet`：勾选显隐、上下排序、尺寸；localStorage 持久化；沿用 `lib/flclash/layout.ts` 的栅格。
- 快捷指标与图例加 doona 深链：`#/connections?tab=traffic|list`、`?out=`、`?src=`、`#/nodes?q=`、`#/overview`。
- 补「全局出站」选择器 + 应用。

### 3.4 配置页四标签（未开始）

**现状**：`views/ManageView.tsx` 有四个内部标签（状态/eBPF/配置/通知），路由 `#/config` 直接渲染它。

**要做**：
- 拆成 doona 的 `模块 / 全局设置 / 配置文件 / 备份与修订`：
  - 模块导航：全局(log)、入站、出站、分组、DNS、路由、实验性（映射到 sing-box 结构）。
  - 全局设置：`log`、`experimental`、`inbounds` 的结构化表单（`FcField/FcSelect` + configPatch）。
  - 配置文件：现有 CodeMirror 编辑器（保留 schema 补全、差异、草稿、撤销）。
  - 备份与修订：备份列表 + 应用历史（可复用 `configDraft`/`configDiff`）+ 一键还原。
- 状态/eBPF/通知 三块迁到 `#/overview` 与 `#/settings`。

### 3.5 设置页两标签（未开始）

**要做**：
- `通用 / 外观` 两标签整合现有工具页。
- 通用：配置方案（新建/重命名/删除，基于命名快照）、退出登录、测试连接、保存、日志需求预设（信息/按流程/按日志/DNS 日志 → 映射 `log.level` + 采集开关）、地理数据（规则集来源/更新周期/立即更新）、延迟探测（HTTP/自动/暖探测/直接成员 → `healthPreferences` + urltest 参数）、详细信息、复制最近错误、重置默认。
- 外观：主题/调色板/强调色/AMOLED（迁移 `tools/theme`）。

### 3.6 其余收口（部分完成，2026-11-02）

- ~~**日志页**：模块前缀过滤、级别时间直方图（错误/警告/信息）、「流式接收中」指示、记录设置面板。~~ ✅ 直方图为「到达时间」15 分钟 × 12 桶（sing-box 日志无可靠时间戳，见 `src/lib/logHistogram.ts` 注释），点击桶可按窗口过滤；流式指示含行/分钟；模块筛选与设置面板此前已有。
- ~~**事件页**：「排除运行状态更新」开关~~ ✅ `kind === "service"` 行可一键隐藏并持久化；健康掉线/恢复落 journal 已在 `useHealthMonitor.ts` 完成。
- **节点页**：~~按订阅来源分组~~ ✅（managed/manual 分卡，带计数；协议化编辑表单仍未做）。
- ~~**连接列表**：CSV/JSON 导出、按主机/进程/出站/规则分组~~（✅ 已接入，含设备分组与表头排序）。
- ~~**分流**：按设备维度、点击路径高亮/清除筛选、记录表补时间/规则/出站列~~（✅ 已完成）。
- **系统状态**：~~导出状态 JSON、暂停轮询、重载~~ ✅ + **能力矩阵**（`PANEL_FEATURES` × 后端 `features` 声明）✅；数据路径段（eBPF 程序/挂钩/连接表）、TCP/UDP 计数、内存趋势图仍未做。
- ~~**配置页标题**：`ManageView` 页头仍是「系统」~~（✅ 已改为「配置」）。
- **能力与版本**：`APIVersion` 已 8 → 9，Features 增 `dns.stats`（前端 capabilities 与 API 契约已同步）；`rules.edit`/`flows` 等尚未声明，按需再补。

---

## 4. 已知问题与风险（接手前务必知道）

| # | 问题 | 影响 | 处理建议 |
|---|---|---|---|
| 1 | **后端二进制未随前端一起发布**：`/usr/bin/sing-box-panel` 可能不是最新构建 | 新端点 404（如 `/api/nodes/parse`、`/api/nodes/{tag}/exclude`） | 每次发布同时安装后端；用 `md5sum /usr/bin/sing-box-panel` 与构建产物比对 |
| 2 | 部署路径陷阱：仓库 `deploy/install.sh` 写 `/usr/local/bin`，本机 systemd 用 `/usr/bin` | `install` 后 `restart` 仍跑旧二进制 | 安装到 `/usr/bin`；或改 `install.sh` 读取 `systemctl show -p ExecStart` |
| 3 | 静态资源按 hash 命名 + `rsync --delete` | 打开中的标签页切到懒加载页面会因旧 chunk 引用已删除 CSS 而崩 | 部署用 `rsync -a`（不加 `--delete`），或提示硬刷新；已按前者执行 |
| 4 | 沙箱实例（如 9098）无法使用 daemon 流 | sing-box gRPC CORS 白名单只允许 9096 | 联调请直接在生产 9096 或临时加 CORS；不要用 9098 验证 daemon 页面 |
| 5 | DNS 解析记录依赖 `log.level=debug` | 默认 info 级别下没有数据 | UI 必须给出采集开关与「仅 debug 级别有数据」的说明 |
| 6 | 规则追踪模拟不覆盖 `rule_set` | 模拟结果可能比内核宽松 | UI 明示「rule_set 需内核判定」 |
| 7 | 策略组不支持 TCP/UDP 分选 | 与 doona 有可见差异 | 已在 UI 标注 sing-box 限制 |
| 8 | 节点编辑仅支持 JSON | 易用性不如 doona 的协议表单 | 后续按协议补结构化表单 |
| 9 | ~~`ManageView` 标题与导航不一致~~ | 已修：页头改为「配置」 | — |
| 10 | 会话期内的健康告警只到 toast/webhook | 事件页看不到掉线/恢复 | 见 3.6，接 `POST /api/journal` |

---

## 5. 验证方法（每次改动后）

```bash
# 后端
cd backend && go vet ./... && go test ./...

# 前端
npx tsc --noEmit && npx vitest run && npx eslint src

# 构建 + 部署（前端）
pnpm build && rsync -a dist/ /usr/local/share/dracpanel-ui/

# 构建 + 部署（后端，需要 sudo）
go build -trimpath -o sing-box-panel ./cmd/sing-box-panel
sudo install -m755 sing-box-panel /usr/bin/sing-box-panel
sudo systemctl restart sing-box-panel
md5sum /usr/bin/sing-box-panel   # 与构建产物一致才算成功
```

**浏览器验收（必须）**：逐页打开并确认 `h1` 正确、无「页面出现错误」、目标控件可操作；写操作先在沙箱（`--dry-run` 9097 或 systemctl 桩 9098）验证，再上生产。

**沙箱启动示例**（9097，dry-run，不碰 systemd）：
```bash
cd /tmp/dracpanel-audit
PANEL_TOKEN=audit /home/emo/Projects/dracula-panel-for-singbox/backend/sing-box-panel \
  --config /tmp/dracpanel-audit/panel.json --dry-run --listen 127.0.0.1 --port 9097
```

---

## 6. 关键文件索引

```
backend/internal/bootstrap/bootstrap.go        装配（Deps 唯一构造点）
backend/internal/singbox/singbox.go            Apply / ApplyText / 回滚
backend/internal/httpapi/server.go             路由表与新端点
backend/internal/notifications/                journal 存储
backend/internal/policy/                       组读取与成员覆盖算法
backend/internal/nodes/                        节点列表与脱敏
backend/internal/subs/subs.go                  subscriptions apply、overrides、node_exclude
src/lib/configPatch.ts                         JSONC 补丁（所有编辑器共用）
src/lib/ruleEditor.ts                          规则/匹配器模型（含 DNS 匹配器）
src/lib/ruleTrace.ts                           追踪模拟静态求值（纯函数）
src/lib/ruleTemplates.ts                       简易模式服务模板（rule_set 优先）
src/lib/dnsStats.ts                            DNS 统计聚合（纯函数）
src/views/dns/DnsView.tsx                      DNS 四标签页
backend/internal/dnslog/                       journal DNS 行解析
backend/internal/dnsprobe/                     上游延迟探测
src/views/tools/RulesView.tsx                  规则页外壳（三标签 + 暂存应用）
src/views/tools/rules/                         RouteRulesTab / DnsRulesTab / TraceRulesTab / RuleEditorList
src/components/flclash/                        UI 原语
src/views/policies/PoliciesView.tsx            策略页
src/views/nodes/NodesView.tsx                  节点页
src/views/records/ConnectionsTraffic.tsx       连接流量视图
src/views/flows/FlowsView.tsx                  分流页
src/views/events/EventsView.tsx                事件/操作记录
src/views/system/SystemStatusView.tsx          系统状态
src/views/tools/RulesView.tsx                  规则页（待扩三标签）
src/views/ManageView.tsx                       配置页（待拆四标签）
src/views/tools/*                              设置域（待整合两标签）
```

---

## 7. 待产品确认（不要自行假设）

1. 「活动」页是否要彻底替换为 doona 式可编辑部件仪表盘（当前是原仪表盘 + 已并入事件页的操作时间线）？
2. 设置页的「配置方案」是否允许多套命名快照并存（当前只有一份配置 + 备份）？
3. 地理数据在线更新是否要引入外部下载源（需要网络与校验策略）？
4. DNS 采集开关默认是否允许自动切到 `debug`（会放大日志量）？

---

## 8. 最短路径建议

1. ~~先修 §4 的 1–3（部署与资源），否则任何前端改动都可能"看不见"。~~（已按 rsync -a 执行）
2. ~~做 §3.1 规则三标签（用户感知最强、纯前端 + 现有补丁链路）。~~（✅ 2026-11-01 完成）
3. ~~做 §3.2 DNS~~（✅ 已完成，含 dnslog/dnsprobe 后端）。
4. ~~§3.3 分流路径拓扑、§3.6 连接列表/策略筛选/标题收口~~（✅ 已完成）。
5. 剩余：§3.4 配置四标签、§3.3 活动部件化、§3.5 设置两标签、§3.6 日志直方图。

---

## 9. 验证记录（2026-11-01，fixture + 生产只读）

### 9.1 fixture 全量（`?fixture=1`，无核心）
- 23 条路由逐页检查：h1 正确、无错误文案（唯一问题是 fixture 缺 `/api/journal`，已补齐）
- 新控件实测：连接列表分组展开 6 行 + 表头排序；分流点选后节点 11→3 且「清除路径筛选」出现、按设备切换生效；策略 JP chip 过滤 + 只显示可用 13→5；规则 10 个模板（QUIC/私有地址显示「固定匹配器」）；DNS 四标签 + 探测三态（21ms/12ms/失败）
- 该轮抓到并修复 3 个真实缺陷：`countryCodeOf` 只精确匹配导致地区 chips 必空；`styles["a-b"]` 在 `camelCaseOnly` 下为 undefined 静默丢样式（4 个文件）；`#/settings` 死路由与配置页标题不一致
- 前端 369 用例、`tsc`、`eslint`、全仓 `stylelint` 全绿；后端 13 包 `go vet`/`go test` 全绿

### 9.2 生产 9096 只读
- 部署校验：二进制 md5 一致、服务 active、`/api/dns*` 返回 401（非 404）、前端 `index.html` 与 `dist` 同哈希、`DnsView-*.js/css` 200
- `/api/state`：`api_version=9`、`features` 含 `dns.stats`、`cpu_percent=9.29`、`cpu_ready=true`、`local_ip=192.168.31.30`、`mode=ebpf`
- `/api/dns`：7 个 servers（4 个 https + 2 group + 1 hosts）、11 条规则、`log_level=info`、`cache_file` 131.1 KB
- `/api/dns/queries`：0 条 + 如实提示「仅 debug 级别输出」；`/api/dns/probe`：4 个 DoH 上游实测 111–1428ms 全部成功
- 页面实测：DNS 四标签（统计空态如实、探测 chip、缓存足迹与两条清除按钮、记录采集开关 off 且副标题说明）；分流 9 节点/34 连线、点选筛选与清除；连接列表 24 行、按出口分组带流量合计、CSV/JSON 导出可用；策略 9 组、地区 chips 识别真实节点名（JP 6 / HK 5 / SG 3）并过滤生效；规则 14 条、第 3/8 条 logical 明确引导、12 条可编辑
- 生产 20 条路由全扫：全部 h1 正确、无错误文案；事件页显示真实 journal 记录

### 9.3 生产验收发现并修复
- 「包含所有节点」对所有组误显：`Map.has()` 被当成取值判断，改为 `get(tag) === true`（提交 `d18e3e7`），需前端重新 rsync 后生效
