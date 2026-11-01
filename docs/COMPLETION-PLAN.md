# DracPanel 补全实施计划

> 配套文档：[`AUDIT.md`](./AUDIT.md)（审计报告，含全部代码证据与真机验证记录）
> 口径：以 **sing-box 原生能力**为基线；按 P0 → P1 → P2 → P3 推进
> 原则：**先止血、再补域、后抽象、最后统一风格**；每一项都必须可复现、可验证、可回滚

---

## 0. 总览

| 阶段 | 目标 | 项数 | 预估 | 依赖 |
|---|---|---|---|---|
| **P0** | 修复"不生效"核心缺陷 | 6 | 4–6 人日 | 无（可立即开始） |
| **P1** | 补齐缺失功能域 | 8 | 12–18 人日 | P0-1、P0-2 完成 |
| **P2** | TUN 与模式抽象 | 5 | 8–12 人日 | P1 配置编辑器可复用 |
| **P3** | UI 统一与打磨 | 4 | 8–12 人日 | 需先产出设计规范 |
| 合计 | | 23 | **32–48 人日** | |

**硬约束**：
1. P0 全部完成并验证后，才进入 P1。
2. 任何"修复不生效"类任务，必须依次记录 **复现 → 修复 → 生效验证** 三步（本次审计已提供复现步骤，可直接沿用）。
3. P3 必须先落地 `docs/DESIGN-SYSTEM.md`，再逐页套用；**禁止边改边发明新风格**。

---

## 1. P0 · 不生效核心修复

### P0-1 修复装配层：observability 接线 + nil 防御

**问题复现**（已完成，见 AUDIT §9.1–9.2）
```bash
journalctl -u sing-box-panel --since '7 days ago' | grep 'nil pointer'
curl -H "X-Panel-Token: $T" http://127.0.0.1:9096/api/history        # 500
curl -H "X-Panel-Token: $T" http://127.0.0.1:9096/api/notifications  # 500
```

**改动范围**
| 文件 | 改动 |
|---|---|
| `backend/cmd/sing-box-panel/main.go:62-81` | 抽出可测的 `buildDeps(s, dryRun) (*httpapi.Deps, cleanup func())`；装配 `notifications.Load(s)`、`history.Load(s.StateDir())`、`history.NewSampler(s, store)`、`Deps.Sampler`、`Deps.NotifyConfigs`；`sampler.Start()`（dry-run 自身会跳过） |
| `main.go` | 设置 `NotifyConfigs = func(cfg, reason, restart) { res := configs.Apply(...); feed.Record(...); return res }`，让手动配置应用也进事件流（当前二阶缺陷，`server.go:541-544`） |
| `backend/internal/notifications/notifications.go:56-111` | **所有方法加 nil 接收者守卫**（`if f == nil { return }`）：未来再漏接线也降级为"无通知"，而不是整请求 500 |
| `backend/internal/history/history.go:186` | `Range` 加 nil 守卫，返回空结果 |
| `backend/internal/httpapi/server.go:49-53` | 保留可选语义，但 `handleHistory/handleNotifications` 对 nil 返回 `ok:true`+空数据（诚实降级），而不是依赖 recover |

**依赖**：无
**预估**：1 人日（含测试）

**验收标准**

*启动验证*
```bash
# 1. 沙箱启动（不碰生产）
PANEL_TOKEN=audit-token ./backend/sing-box-panel \
  --config /tmp/dracpanel-audit/panel-real.json --port 9098
# 2. 全端点探活：不允许出现 5xx
for p in ping state config history notifications subscriptions managed cli/../; do :; done
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Panel-Token: audit-token" \
  http://127.0.0.1:9098/api/history          # 期望 200
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Panel-Token: audit-token" \
  http://127.0.0.1:9098/api/notifications    # 期望 200
```

*生效验证*
```bash
# 3. 触发一次服务动作，验证"动作与响应一致"
curl -s -H "X-Panel-Token: $T" -d '{"action":"restart"}' .../api/service
#   期望 {"ok":true,...}；且 state/notifications.json 出现该事件
# 4. 生产机器：等待 ≥2 分钟后
ls -l /var/lib/sing-box-panel/history.jsonl        # 必须出现且持续增长
curl -s -H "X-Panel-Token: $T" '.../api/history?range=10m' | jq '.points|length'  # >0
curl -s -H "X-Panel-Token: $T" .../api/notifications | jq '.notifications|length'  # 有记录
```
**回滚**：单文件改动，`git revert` 即可；无数据迁移。

---

### P0-2 配置应用改为"热重载优先"

**问题复现**（已完成，见 AUDIT §9.5）
```bash
systemctl show sing-box -p ExecReload    # ExecReload=/bin/kill -HUP $MAINPID
# 实测：SIGHUP 后端口切换生效、PID 不变、连接不断
```
现状：`singbox.go:248` 固定 `systemctl restart`，每次改规则/订阅/策略都断流。

**改动范围**
| 文件 | 改动 |
|---|---|
| `backend/internal/systemd/systemd.go` | 新增 `SupportsReload() bool`（`systemctl show -p ExecReload` 非空）与 `Reload() *jsonx.OrderMap` |
| `backend/internal/singbox/singbox.go:243-256` | 引入策略：`ApplyStrategy{ReloadFirst, RestartOnly}`；默认 `ReloadFirst`。原子写后：`reload` → `WaitHealthy`（等待窗口内视情况退避）→ 失败则退回 `restart` → 再失败才回滚 |
| `backend/internal/settings/settings.go` | 新增 `apply_strategy` 配置项（默认 `reload-first`），支持用户强制 restart |
| `backend/internal/httpapi/server.go:487-492` | 暴露 `GET /api/state.apply_capability`（`{"reload":true,"strategy":"reload-first"}`），供 UI 显示 |

**关键设计点**：SIGHUP 失败无法从退出码判断（`kill -HUP` 总是返回 0）。必须用**行为探针**判定：reload 后在同一健康检查窗口内确认服务 active 且（若配置了）探测 URL 通过；否则自动 fallback 到 restart。降级路径必须记入事件流。

**依赖**：P0-1（事件流要先能记录切换过程）
**预估**：1.5 人日

**验收标准**

*启动验证*
```bash
# 沙箱：桩 systemctl 需支持 show -p ExecReload 返回非空
PATH=/tmp/dracpanel-audit/bin:$PATH ./backend/sing-box-panel --config panel-real.json --port 9098
curl -s .../api/state | jq '.apply_capability'   # 期望 {"reload":true,...}
```

*生效验证（关键：断流为 0）*
```bash
# 终端 A：持续经代理发请求，统计失败数
while true; do curl -s -m 2 -x http://127.0.0.1:7890 -o /dev/null -w '%{http_code}\n' https://www.gstatic.com/generate_204; sleep 0.2; done | sort | uniq -c
# 终端 B：应用一次无实质变化的配置
curl -s -H "X-Panel-Token: $T" -d "{\"text\":$(cat cfg.json|jq -Rs .)}" .../api/config
# 判据：终端 A 中 000/5xx 计数为 0（restart 会必然出现若干 000）
journalctl -u sing-box --since '1 min ago' | grep -c 'sing-box started'   # 应 +1（reload 会打印 started）
ps -p $(systemctl show -p MainPID --value sing-box)                        # PID 不变
```
**回滚**：`apply_strategy` 改回 `restart` 即恢复旧行为。

---

### P0-3 CPU 卡：数据与文案双修

**问题复现**：面板在线但 CPU 卡显示"直接模式下不可用"（AUDIT §9.3 + `ObservabilityCards.tsx:319-320`）。

**改动范围**
| 文件 | 改动 |
|---|---|
| 后端 | 随 P0-1 接线 Sampler（`server.go:404-406` 已能写 `cpu_percent`） |
| `src/views/dashboard/ObservabilityCards.tsx:310-331` | 三态区分：`panel.state == null` → "直接模式"；`cpu_percent === undefined` → "采样未就绪（等待首次采样）"；有值 → 正常展示 |
| `src/api/panel.ts:51-58` | 更新 parity 字段注释（`cpu_percent` 已由 Sampler 提供） |

**依赖**：P0-1
**预估**：0.5 人日

**验收标准**
- 启动验证：`go run ... --dry-run` 下 CPU 卡显示"采样未就绪"（dry-run 不采样），不显示"直接模式"。
- 生效验证：生产启动 ≥5s 后，卡片显示百分比且随负载变化；`api/state` 含数值型 `cpu_percent`。

---

### P0-4 装配层集成测试（防回归）

**改动范围**
| 文件 | 改动 |
|---|---|
| `backend/cmd/sing-box-panel/main_test.go`（新增） | 调 `buildDeps()` 后断言：`Feed/History/Sampler/NotifyConfigs` 均非 nil |
| `backend/internal/httpapi/wiring_test.go`（新增） | **用 main 同款装配**（非测试专用夹具）遍历全部路由，断言无 5xx；对写接口用最小合法载荷 |
| `backend/internal/httpapi/server_test.go:67-82` | 夹具改为复用生产装配函数，消除"测试补线" |

**依赖**：P0-1（需 `buildDeps` 可导出/可测）
**预估**：1 人日

**验收标准**
```bash
go test ./backend/... -run 'Wiring|Deps' -v    # 全绿
# 反向验证：临时注释掉 main.go 的 Feed 赋值，测试必须失败
```
**这是本次 P0 唯一能"防止同类问题再次发生"的项，优先级最高。**

---

### P0-5 托管状态一致性（悬空引用 + 重复节点）

**问题复现**（已完成，见 AUDIT §9.8.5）
- restore 后 `managed.json` 仍记着已不存在的 tag；
- 生产 `managed.json` 缺失但配置已有 11 个订阅节点，重新订阅产生 `xxx #2` 重复出站。

**改动范围**
| 文件 | 改动 |
|---|---|
| `backend/internal/subs/subs.go` | 新增 `ReconcileManaged(cfg)`：剔除配置中不存在的 tag，同步 `group_members`；apply 去重时除"配置中已存在"外，还需按**来源订阅 id**（`by_subscription`）识别旧节点，避免重复订阅产生 `#2` |
| `backend/internal/subs/subs.go:478-512` | 标签去重前先按 `managed.by_subscription` 做一次"同源旧节点"回收（即使 `managed.json` 丢失，也可用 tag 前缀 + 类型指纹做软匹配，冲突时**提示用户**而非静默加 `#2`） |
| `backend/internal/singbox/singbox.go:269-283` | `Restore` 成功后调用 reconcile |
| `backend/internal/httpapi/server.go:571-576` | restore 响应返回 `pruned` 数量 |

**依赖**：P0-1
**预估**：1 人日
**验收标准**
- 复现：删除 `managed.json` 后重新订阅 → 出现 `#2`。
- 修复后：同一订阅重复 apply 幂等（tag 集合不变）；restore 后 `managed.json` 与配置差集为空；无法判定归属时返回明确提示而非静默重命名。

---

### P0-6 嵌套规则保护（生产可触发）

**问题复现**（已完成，见 AUDIT §9.8.4）
生产 `route.rules[2]`（DNS 劫持）、`rules[7]`（广告拦截）为 `type:"logical"`；在规则页点开会话并保存，产物 `{"action":"reject","type":"logical"}` 被 `sing-box check` 拒绝（`missing conditions`），用户只能看到晦涩报错。

**改动范围**
| 文件 | 改动 |
|---|---|
| `src/lib/ruleEditor.ts:14` | 增加 `isNestedRule(rule)` 判定（存在 `rules`/`type:"logical"`） |
| `src/views/tools/RulesView.tsx:192-199` | 列表行对嵌套规则**禁用编辑**（置灰 + 提示"此规则为逻辑组合，请在配置编辑器中修改"），并提供"跳转到配置编辑器"入口；删除/排序仍允许 |
| `src/views/RuleEditorDialog.tsx` | 打开时二次防御：`initial` 含 `rules` 直接拒绝（兑现 `:19-21` 的注释承诺） |
| `src/lib/ruleEditor.test.ts` | 新增用例：嵌套规则不允许进入编辑器 |

**依赖**：无（纯前端）
**预估**：0.5 人日
**验收标准**
- 启动验证：规则页中 `logical` 规则显示为不可编辑态。
- 生效验证：点击后不再打开编辑器；生产 14 条规则中 12 条可编辑、2 条明确引导；排序/删除这 2 条后配置仍通过 check。

---

## 2. P1 · 缺失功能域

> 统一前置：先抽一个 `internal/configedit` 抽象（读原文 → jsonc 定位编辑 → 事务应用），供下列所有编辑器复用，**避免再出现"规则编辑器丢注释"这类分叉**。

### P1-0（前置）配置编辑内核统一
- **改动**：后端提供 `POST /api/config/patch`，载荷为 `{path:["route","rules",3], value:…}` 语义（服务端用 jsonc 保持注释与格式），替代前端整文件 `JSON.stringify`。
- **收益**：P1 全部编辑器共用一条保注释写入路径；规则编辑器可立即切到该路径修复 §E-规则保存。
- **预估**：1.5 人日
- **验收**：编辑前后 `diff` 仅目标行变化，注释 100% 保留。

### P1-1 规则编辑增强
- 切到 P1-0 的 patch 路径；增加校验：outbound tag 必须存在于配置、`port/port_range` 格式、数值字段类型、`domain_regex` 可编译、嵌套 `rules[]` 支持。
- 校验失败给出**字段级**错误（而非单一 toast）。
- 预估 2 人日。验收：添加/重排/删除后注释与格式不变；非法 tag 被拦截且定位到字段。

### P1-2 分组编辑器
- 后端：`internal/groups` — 创建/编辑/删除 `selector`/`urltest` outbound（含 `interval`/`tolerance`/`default`），并维护 `route.final` 引用。
- 前端：Proxies 页"新建组/编辑组"（沿用 FcSheet）。
- 依赖：P1-0。
- 预估 2.5 人日。
- 验收：新建组后 `GET /api/clash/proxies` 与 daemon groups 流均出现该组；删除时若被规则引用则拒绝并提示。

### P1-3 节点手动 CRUD + 协议扩展
- 后端：`internal/nodes` — 单节点增删改，表单字段按协议生成 outbound；订阅节点与手工节点分区存储（`managed.json` 加 `origin`）。
- 协议：补齐 http/socks（解析与生成）、`anytls`；评估 ssr（sing-box 已移除，建议明确"不支持"并给出替代）。
- 依赖：P1-0。
- 预估 4 人日。
- 验收：手工节点保存后出现在 Proxy 组候选、可测速、可切换；重启后仍在。

### P1-4 DNS 编辑器
- 后端/前端：`dns.servers`（1.14 新格式：`type`+`server`）、`dns.rules`、`cache`、`fixed_domain_ttl`、`optimistic_cache`。
- 内置迁移提示：载入旧格式配置时提示"1.14 已移除旧 DNS 格式"，并给一键迁移预览。
- 依赖：P1-0。
- 预估 3 人日。
- 验收：新建 DNS server + 规则后 `sing-box check` 通过、配置落盘、`/dns/query` 实际走新上游（可用 `dig @` 对照或看连接出口）。

### P1-5 健康监控 / 自动测速 UI
- 前端：高级设置页增加"自动测速间隔（关闭/5/15/30 分钟）"、"掉线通知"、"自动切换"三组开关，接 `saveAutoTestInterval`/`saveHealthSettings`；Proxies 页展示 `summary` 与"立即巡检"按钮（`HEALTH_RUN_NOW_EVENT`）。
- 预估 1.5 人日。
- 验收：设为 5 分钟后，`localStorage` 键更新；关闭一个节点（停其服务/改错端口）后 1 个周期内出现 toast + webhook；若开自动切换，组被切到可用节点（`/api/clash/proxies` 的 `now` 变化可证）。

### P1-6 订阅自动更新 UI + 规则集在线更新
- 订阅卡片增加间隔选择（复用后端 `/schedule`）；规则集页增加"更新"按钮（触发 `rule_set` 下载或内核 reload）。
- 预估 1.5 人日。验收：设置 5 分钟间隔后 `next_update` 正确；到点 `last_update` 推进（journal 有"自动更新订阅"）。

### P1-7 活动 / 事件页
- 新增 `activity` 路由：操作时间线（来自通知流扩展为含 actor/耗时），与 Events 分离或合并为一级页面。
- 预估 1.5 人日。

### P1-8 分流观测（拓扑 + 记录）
- 用连接流的 `rule`/`outbound` 字段聚合：规则→出站→节点 的桑基/流量条；记录表可按规则筛选。
- 预估 2.5 人日。

---

## 3. P2 · TUN 与模式抽象

### P2-0 模式抽象层（前置）
- 新增 `internal/mode`：`Descriptor{Name, Supported, Capabilities, ReadyProbe}`；
  - `mixed`：仅代理端口；
  - `tun`：需 tun inbound + `tun0` + `ip` 可用；
  - `ebpf`：需 fork 内核 + cgroup v2 + `tools ebpf status` 通过。
- `GET /api/state` 返回 `mode` + `capabilities`，前端**只读能力位**，删除散落的 `inbounds.includes("ebpf")` 判断（`useRuntimeToggles.ts:124,138-144`）。
- 预估 2 人日。验收：三个模式切换时，UI 控件可用性由服务端能力驱动（可用 mock 配置覆盖三种情况）。

### P2-1 TUN inbound 管理与一键接管
- 后端：创建/编辑 `tun` inbound（`interface_name`/`address`/`auto_route`/`stack`/`mtu`），平台探测（Linux/macOS/Windows 差异化默认值）。
- 前端：TUN 开关从"删/恢复"升级为"创建/删除"，带预设模板；eBPF 模式下仍锁定但给出切换指引。
- 依赖：P2-0。
- 预估 3 人日。
- 验收：干净配置（无 tun）下一键开启 → 配置落盘 → `ip link` 出现 tun0 → 流量经代理（`curl ifconfig.me` 出口变化）→ 一键关闭后恢复。

### P2-2 eBPF 结构化配置
- 在 eBPF 页补齐 `data_plane`/`dns_mode`/`ipv6`/`shared`（接口、cgroup 路径）编辑，写入走 P1-0 patch。
- 预估 2 人日。

### P2-3 部署与权限收口
- 面板配置路径：把默认值统一为 `/etc/sing-box-panel/panel.json`（或启动时若 drop-in 缺失则显式警告），消除 HANDOFF §7 陷阱 5。
- 面板配置权限：安装脚本 `install -m 0600`；启动时检测并告警 0644。
- schema 增补 `ebpf` inbound（本地 fork 扩展），使配置编辑器补全不再失明。
- 预估 1 人日。

### P2-4 内网 IP 探测兼容 eBPF
- **问题**：`localip.Detect()` 的 UDP dial 被 eBPF cgroup `connect` 钩子改写到回环，恒返回 `127.0.0.1`（AUDIT §9.8.6）。
- **改动**：`backend/internal/localip/localip.go` — 改为枚举物理网卡（排除 `lo`/虚拟网卡/无 `global` 作用域地址），取默认路由出口网卡的 IPv4；保留 dial 作为 fallback。前端 `localIp.ts` 对 `127.0.0.1`/`::1` 视为无效并回退 WebRTC。
- **依赖**：无
- **预估**：0.5 人日
- **验收**：eBPF 模式下 `GET /api/local-ip` 返回 `192.168.x.x`；概览页"内网 IP"卡片显示真实地址。

---

## 4. P3 · UI 统一与打磨

### P3-0 设计规范（必须先行）
产出 `docs/DESIGN-SYSTEM.md`，内容：
1. **Token 层**：`--fc-*` 为唯一消费入口；禁止页面直接使用 `--bg/--card` 旧 token；禁止硬编码色值。
2. **组件矩阵**：每个场景指定唯一组件——卡片 `FcCard`、按钮 `FcButton/FcIconButton`、开关 `FcSwitch`、分段 `FcSegmented`、弹层 `FcSheet`（编辑）/`ConfirmDialog`（确认）、表格 `FcRecordTable`、空态 `FcEmpty`（新增）、骨架 `FcSkeleton`。
3. **三态规范**：空/加载/错误各一种写法（含文案模板与图标）。
4. **表单与校验**：字段级错误展示位置、提交禁用条件、异步校验时机；错误文案统一样式（`t()` + 中文资源）。
5. **i18n 规则**：新增代码禁止中文字面量，一律进 `translations.ts`。
6. **迁移清单**：旧 `ui.tsx` 组件 → 新组件一一映射表（含 `Dialog→FcSheet` 迁移示例）。
- 预估 1.5 人日（不写代码，只定规范 + 评审）。

### P3-1 组件收编
- 按 P3-0 迁移 ManageView / LogsView / SetupView / ServersView / RuleEditorDialog / 工具类页面；删除孤儿组件（`Breadcrumb/Tooltip/HistoryChart` 等）。
- 预估 4 人日。验收：`grep -r "components/ui\"" src` 仅剩 1 处（或 0）；截图对比无回归。

### P3-2 i18n 补全
- 新页面全部改 `t()`；补 en/zh-Hant/fa/ru 资源；`language` 切换后无中文残留。
- 预估 3 人日。验收：设 en 后遍历所有页面，无 CJK 字符（可用 e2e 断言的 DOM 文本扫描）。

### P3-3 交互与可访问性打磨
- 焦点管理（Sheet 打开/关闭）、`aria-*` 完整、键盘可达、移动端触控目标 ≥44px、对比度校验。
- 预估 2–4 人日。

---

## 5. 测试方案

### 5.1 自动化分层

| 层 | 范围 | 工具 | 归属 |
|---|---|---|---|
| 单元 | 已有 8 包 + 新增 `groups/nodes/dnsconf/mode/configedit` | `go test` | 每次 PR |
| **装配集成** | `buildDeps` + 全路由矩阵（P0-4） | `go test` | 每次 PR |
| 配置事务 | check/apply/reload/rollback + 悬空清理 | `go test`（stub bin） | 每次 PR |
| 前端逻辑 | 已有 300 用例 + 新编辑器纯函数 | `vitest` | 每次 PR |
| **e2e** | 5 条核心链路（见下） | Playwright | 每次 PR（可先 nightly） |
| 冒烟 | 真机/沙箱起栈 + 全端点探活 | `scripts/audit-smoke.sh` | 发布前 + 手动 |

### 5.2 核心链路 e2e（5 条）

1. **启动**：面板起 → 登录 → Dashboard 显示运行中、CPU/内存有值、通知卡非 500。
2. **配置应用**：编辑一条规则 → 校验 → 应用 → 断言配置文件变化 + 服务 PID 不变（reload 路径）+ 规则出现在列表。
3. **分流**：加 `domain_suffix: example.com → direct` → 经代理访问 → `/api/clash/connections` 该连接 `outbound=direct`。
4. **DNS**：新增 DNS server → 设为默认 → `/dns/query` 返回可解析 → `sing-box check` 通过。
5. **节点切换**：切组内节点 → `/api/clash/proxies` 的 `now` 更新 → 新连接走新节点（连接流 `outbound` 变化）。

### 5.3 手动验证脚本（每项都可用）

新建 `scripts/audit-smoke.sh`（本次审计所用命令的固化版），支持 `--base http://127.0.0.1:9098 --token xxx`，逐项输出 PASS/FAIL：
- 全端点非 5xx
- 写接口"动作与响应一致"（对比副作用文件/桩日志）
- 配置事务成功/失败回滚
- 热重载 PID 不变
- 订阅 add/apply/update 三链
- eBPF 降级报错

> 该脚本即为"启动验证 + 生效验证"的统一入口，P0 每项验收直接调用它。

### 5.4 CI 增补

```yaml
# .github/workflows/ci.yml 追加
- name: wiring integration
  run: go test ./backend/... -run 'Wiring|AllRoutes'
- name: e2e
  run: pnpm exec playwright test    # 需在 job 内起 dry-run 面板 + fixture
```

---

## 6. 依赖关系图

```
P0-1 装配 ──┬─> P0-3 CPU 卡
            ├─> P0-4 装配测试
            ├─> P0-5 一致性（悬空 + 重复）
            └─> P0-2 热重载（需事件流记录降级）
P0-6 嵌套规则保护        （独立，纯前端）
P1-0 配置编辑内核 ──┬─> P1-1 规则增强
                    ├─> P1-2 分组编辑
                    ├─> P1-3 节点 CRUD
                    ├─> P1-4 DNS 编辑
                    └─> P2-2 eBPF 结构化配置
P2-0 模式抽象 ──┬─> P2-1 TUN 管理
                └─> P2-3 权限/schema
P2-4 内网 IP 探测        （独立）
P3-0 设计规范 ──┬─> P3-1 组件收编
                ├─> P3-2 i18n
                └─> P3-3 打磨
P1-5/P1-6/P1-7/P1-8 相互独立，可并行
```

---

## 7. 建议里程碑

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| M1（本周） | P0 全部（含 P0-6 嵌套规则保护、P0-5 一致性） | 生产 `history.jsonl` 增长；四个写接口不再 500；配置应用 PID 不变；`logical` 规则不再可误编辑；`go test -run Wiring` 有效拦截 |
| M2（+2 周） | P1-0 ~ P1-4 | 组/节点/DNS/规则四类编辑可用且保注释 |
| M3（+3 周） | P1-5 ~ P1-8 | 观测与自动化能力全部可达 |
| M4（+5 周） | P2 全部 | TUN 一键接管 + 能力位驱动 UI |
| M5（+7 周） | P3 全部 | 单一组件族、单一 i18n、规范落地 |

---

## 8. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| SIGHUP reload 在当前 fork 上行为与上游不同（如 eBPF 数据面未重挂） | 中 | P0-2 必须带**行为探针 + 自动 fallback**；先在生产用"无实质变化配置"灰度一次 |
| 编辑器改动破坏用户配置 | 中 | 全部走 P1-0 patch + 事务管线；每次写入前自动备份；提供"一键回滚上一次" |
| TUN 需要 root 权限，面板以 root 运行面扩大攻击面 | 中 | TUN 仅写配置，不直接操作内核；权限仍由 systemd 单元承担；文档明确威胁模型 |
| eBPF fork 与上游 schema 漂移 | 高 | P2-3 引入 fork 扩展 schema + 启动时 `sing-box check` 双向校验 |
| e2e 依赖真实内核，CI 难跑 | 中 | e2e 分两级：dry-run + stub 的资源级测试（CI）；真机 TUN/eBPF 测试（nightly/本地） |

---

## 9. 立即开始的三个动作

1. **P0-1 + P0-4**（同一 PR）：`buildDeps` 抽取 + 接线 + nil 防御 + 装配测试。
2. **P0-6 + P0-3**（小 PR，风险最低）：嵌套规则保护 + CPU 卡三态文案。
3. **P0-2**（独立 PR，需灰度）：reload-first 策略 + 行为探针；随后 P0-5 一致性。

> 建议先把 `scripts/audit-smoke.sh` 落地（0.5 人日），作为后续所有验收的统一工具——本次审计的复现命令可直接固化进去（含真机鉴权版与非鉴权沙箱版两套用例）。

---

## 10. 实施进度（更新于 2026-11-01）

| 项 | 状态 | 交付物 |
|---|---|---|
| P0-1 装配修复 | ✅ 已完成 | `internal/bootstrap/bootstrap.go`、`main.go` 重构、nil 守卫 |
| P0-2 热重载优先 | ✅ 已完成 | `systemd.ReloadSupported/Reload`、`Apply` 策略、`apply_strategy` 配置项 |
| P0-3 CPU 卡三态 | ✅ 已完成 | `cpu_ready` 字段 + 前端三态 |
| P0-4 装配级测试 | ✅ 已完成 | `bootstrap_test.go`（依赖断言 + 35 路由矩阵 + 四接口回归） |
| P0-5 托管一致性 | ✅ 已完成 | `oldTags` 折叠、同构去重、`ReconcileManaged`、restore 返回 `pruned` |
| P0-6 嵌套规则保护 | ✅ 已完成 | `isNestedRule`、规则页不可编辑态 + 配置编辑器跳转 |
| P2-4 内网 IP | ✅ 已完成（顺手） | `localip.go` 重写 + 前端回环过滤 |
| 额外：`/api/apps` panic | ✅ 已修复 | `Icon=` 越界 + 截断；`ebpf_test.go` |

**验证结果**：`go vet ./...`、`go test ./...`、`tsc --noEmit`、`vitest`（307）、`eslint src`、`stylelint` 全绿；沙箱两路（dry-run 9097 / systemctl 桩 9098）端到端通过。

**尚未执行**：生产部署（`install` + `systemctl restart sing-box-panel`）。按约定需你确认后再做；建议先以 `apply_strategy=restart` 灰度一次，再切回 `reload-first`。

**下一步**：P1-0 配置编辑内核 → P1-1/2/3/4；详见 §2。
