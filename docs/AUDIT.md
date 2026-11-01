# DracPanel 功能审计报告

> 审计对象：`dracula-panel-for-singbox`（DracPanel / sing-box-panel 0.2.0）
> 审计日期：2026-11-01
> 审计方式：静态代码审计（全量复读关键路径）+ 真机运行时验证 + 隔离沙箱复现
> 审计基线：**sing-box 原生能力**（用户确认口径）；demo.daeuniverse.org 的 IA 作为控制台页面基线；dae/dae-wing 功能清单作为交叉参照附录
> 代码版本：`1d113e6`（工作区 clean）

---

## 0. 执行摘要

**一句话结论**：这是一个工程质量不低、但**集成层断裂**的面板。后端事务管线（校验→备份→原子写→重启→健康检查→回滚）实现得相当扎实并有测试；真正的问题不在单个功能，而在**装配层**（main.go 漏接线）与**覆盖面**（只做了 sing-box 能力的一个子集，且部分子集没有 UI 入口）。

### 五条头条

| # | 结论 | 等级 | 证据 |
|---|---|---|---|
| 1 | `main.go` 装配 `httpapi.Deps` 时**漏接** `Feed`/`History`/`Sampler`，导致 2 个读接口恒 500、**4 个写接口「动作执行成功却返回 500」** | **P0** | 生产 journal 6 条 panic（§9.1）；沙箱行为级复现（§9.2） |
| 2 | 可观测性子系统**从未在生产运行过**：`/var/lib/sing-box-panel/` 下没有 `history.jsonl`、`notifications.json`，只有 `token` 与 3 字节的 `subscriptions.json` | **P0** | 真机文件系统（§9.3） |
| 3 | 健康监控 / 自动测速 / 故障转移**完整实现约 800 行，但没有任何 UI 入口**，默认关闭，用户永远触发不到 | **P1** | `useHealthMonitor.ts` 全套；唯一开关 `saveAutoTestInterval` 全库无生产调用方 |
| 4 | 面板**只用 `systemctl restart`**，而本机 sing-box 的 `ExecReload=kill -HUP` 实测**支持零断流热重载**——能力存在但被浪费，每次改配置都断流 | **P0** | 实测 17891→17892 端口热切换，PID 不变（§9.5） |
| 5 | 前后端测试**全绿**（后端 8 包 + 前端 38 文件 300 用例），但测试夹具**替 main.go 接好了依赖**，因此 P0 缺陷完全逃逸 | **P0** | `server_test.go:67-82` 对比 `main.go:69-80` |

### 补充发现（取得令牌后的真机鉴权验证）

| # | 结论 | 等级 | 证据 |
|---|---|---|---|
| 6 | **可视化规则编辑器无法编辑生产里的 2 条关键规则**（DNS 劫持、广告拦截），点开保存必被 `sing-box check` 拒绝（`missing conditions`） | **P0** | 生产 `route.rules[2]`/`[7]` 为 `type:"logical"`；`ruleEditor.ts:14` 把 `rules`/`mode` 列为保留键并在 `ruleToDraft` 丢弃；实测 check 拒绝（§9.8.4） |
| 7 | **托管状态丢失会导致重复节点**：`managed.json` 缺失但配置已有 11 个订阅节点，重新订阅将产生 `xxx #2` 重复出站 | **P1** | 生产 `managed.json` 不存在；沙箱实测 `Test-SS-01 #2`（§9.8.5） |
| 8 | **内网 IP 探测在 eBPF 模式失效**，恒返回 `127.0.0.1`（与你截图一致） | P2 | `localip.go:13-23`；`ip route get 8.8.8.8` 实为 `192.168.31.30`（§9.8.6） |
| 9 | 生产配置**无任何注释**，故"规则编辑器丢注释"目前为**潜伏缺陷**，尚未造成实际损失 | 降级说明 | `GET /api/config`：`//` 注释 0 行、`/* */` 0 处 |

### 与既定印象的对照

| 你的判断 | 审计结论 | 修正 |
|---|---|---|
| 「很多已补全的功能实际不生效」 | **成立，但根因集中**：绝大多数不是"功能写错"，而是装配漏接、无入口、或只做了半条链路 | 修复成本远低于重写 |
| 「编辑器风格不一致，表单/校验未实际验证」 | **成立**：两代组件族并存、两套弹窗、两套 i18n、三种空/错态；规则编辑器校验只有 1 条规则 | 见 §7 |
| 「缺少启动验证与功能测试」 | **成立且更严重**：CI 有单测但**没有一次真实 main 启动**；e2e 仅手工 CDP 脚本 | 见 §9.4 |
| 「仅支持 eBPF，TUN 缺失」 | **成立**：TUN 只有前端删/恢复 inbound 的开关，后端零实现；eBPF 侧也只是 UID 策略编辑 | 见 §6 |
| 「与 daeuniverse 相比缺失严重」 | **需换口径**：本项目管理 sing-box 而非 dae，全库无 dae 语法。应按 sing-box 原生能力比对，差距集中在「组/节点/DNS 的可视化编辑」与「多模式抽象」 | 见附录 A |

---

## 1. 审计范围与方法

### 1.1 环境基线（真机实测）

| 项 | 值 | 来源 |
|---|---|---|
| 面板版本 | 0.2.0，`api_version: 8` | `GET /api/ping`；`server.go:68` |
| 内核 | `sing-box v1.14.4-reF1nd`（reF1nd fork，含 `ebpf` inbound） | `sing-box version`；`/usr/bin/sing-box` 与 `/usr/sbin/sing-box` 同文件 |
| 内核 OS | Linux 7.3.0-2-cachyos-bore-lto x86_64 | `sing-box tools ebpf status` |
| 监听 | 9096 面板 / 9091 原生 gRPC / 9090 Clash API，均 127.0.0.1 | `ss -tln` |
| 面板配置 | `/etc/sing-box-panel/panel.json`（**0644**，仅 `ui_dir`/`zashboard_dir`） | 真机 `ls -la` + 读取 |
| 内核配置 | `/etc/sing-box/config.json`（0600，18184 字节） | 真机 `ls -la`；内容不可读（无权限，符合预期） |
| 状态目录 | `/var/lib/sing-box-panel/`：`token`(0600)、`subscriptions.json`(3 字节) | 真机 `ls -la` |
| 数据面 | eBPF：`local_data_plane=cgroup`，`shared_data_plane=packet_rewrite`，tcp/udp，ipv6=true | `sing-box tools ebpf status --mode all --json` |
| 热重载 | `ExecReload=/bin/kill -HUP $MAINPID`，**实测有效** | `systemctl show sing-box -p ExecReload` |

### 1.2 方法

1. **静态审计**：对每条结论亲自复读被引代码（不采信二手转述），结论一律附 `文件:行号`。
2. **真机验证**：只读接口、`journalctl`、`systemctl`、`sing-box tools`、文件系统；**未修改**任何生产配置。
3. **隔离沙箱**：真实二进制 + `--dry-run`（端口 9097）复现 500；再用 **PATH 注入的 `systemctl` 桩**（非 dry-run，端口 9098）验证"动作真实执行 + HTTP 返回 500"，全程未触碰真实 systemd，未写入 `/etc`。
4. **证伪**：对每个初判主动寻找反例，§10 记录被推翻的假设。

### 1.3 生效性判定标准

一条功能判定为「完整生效」必须四要件齐备，缺一即降级：

1. UI 可操作（或 API 可达）
2. 配置/状态正确解析并落盘
3. 运行时被热重载或重启应用
4. 运行时行为可验证（日志/状态/实际分流/文件变更）

> 四档：`完整生效` / `部分生效` / `UI存在但不生效` / `不存在`

---

## 2. 功能基线

### 2.1 sing-box 原生能力基线

来源：仓库内 `public/sing-box.schema.json`（479 KB 快照）+ `sing-box check` 实测（1.14 已移除 legacy DNS 格式）+ 真机 `tools ebpf status`。

- **Inbound 类型（schema）**：`anytls` `cloudflared` `direct` `http` `hysteria` `hysteria2` `mixed` `naive` `redirect` `shadowtls` `shadowsocks` `snell` `socks` `tailcat` `tproxy` `trojan` `tuic` `tun` `vless` `vmess` `gecko` `salamander` `proxy` `file`
  - **schema 中不含 `ebpf`**（fork 独有类型）——见 P2 风险
- **Outbound 类型（schema）**：`anytls` `block` `direct` `http` `hysteria` `hysteria2` `naive` `selector` `shadowsocks` `shadowtls` `snell` `socks` `ssh` `tailcat` `tor` `trojan` `tuic` `urltest` `vless` `vmess` `gecko` `salamander` `bridge`
- **Route 规则匹配器（schema `Rule`）**：`inbound` `ip_version` `network` `auth_user` `protocol` `client` `domain` `domain_suffix` `domain_keyword` `domain_regex` `source_ip_cidr` …（完整清单约 20+；本项目编辑器暴露 22 个，见 §5.4）
- **DNS**：`servers`（1.14 起须用 `type` 新格式）、`rules`、`cache`、`fixed_domain_ttl`、`optimistic_cache`
- **服务**：`api` `resolved` `ssm-api` `ocm` `derp` `ccm` `usbip-*` `oom-killer` 等
- **热重载**：SIGHUP（实测有效，见 §9.5）

### 2.2 控制台 IA 基线（doona → 本项目）

| doona 页面 | 本项目对应 | 差距 |
|---|---|---|
| 活动 / Activity | ❌ 无 | 缺时间线页 |
| 系统状态 / System status | ✅ `tools/config` StatusTab | 基本对齐 |
| 连接 / Connections | ✅ `connections` | 对齐（有关闭连接） |
| 分流 / Flows（拓扑 + 记录） | ❌ 无 | 缺规则命中拓扑/记录 |
| DNS | 🟡 `tools/dns`（仅查询工具） | **无 DNS 配置编辑** |
| 日志 / Logs | ✅ `logs` | 对齐（级别/过滤/暂停） |
| 事件 / Events | 🟡 仅 Dashboard 卡片 | 无独立页 |
| 策略 / Policies（组） | 🟡 `proxies`（只读成员） | **无组编辑** |
| 节点 / Nodes | 🟡 `proxies`（只读） | **无节点 CRUD** |
| 规则 / Rules | ✅ `tools/rules` | 有编辑器（校验弱） |
| 配置 / Config | ✅ `tools/config` ConfigTab | 最强面（schema 补全+差异+撤销） |
| 设置 / Settings | ✅ `tools/*`（general/advanced/theme/backup/servers） | 对齐 |

**页面总数**：本项目 20 条路由（`App.tsx:126-146`），doona 12 类；缺项集中在"编辑类"与"观测类"。

---

## 3. 主审计表

> 列定义严格按用户要求。`生效性` 采用四档。`UI一致性` 判据：是否使用统一组件族/弹窗/空错态/i18n。

### 3.1 A · 服务与生命周期

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| A | 服务状态展示 | 展示 active/enabled/since/pid | UI 有；`GET /api/state` 轮询 15s | ✅ 完整生效 | `server.go:381`；`systemd.go:40-68`；真机 `systemctl` 对照一致 | ✅ Fc 卡片 | 🟡 无单测（systemd 包 0 测试） | — |
| A | 启动 / 停止 / 重启 | 按钮直达 systemd | **动作真实执行，但 HTTP 恒 500** | ❌ UI存在但不生效 | `server.go:489` 先 `Service.Control`，`server.go:490` 再 `Feed.Record`；`Feed` 为 nil，`notifications.go:105-111` 无守卫 → panic → `recoverMiddleware` 返回 500 | ✅ | ❌ 无集成测试 | **P0** |
| A | 热重载 reload | 改配置不断流 | 面板有 `reload` 动作且本机 `ExecReload` 有效；但 `Apply()` 永远 `restart` | 🟡 部分生效 | `singbox.go:248` 固定 `systemctl restart`；`systemd.go:95` 仅转发；实测 SIGHUP 可零断流（§9.5） | ✅ | ❌ | **P0** |
| A | 启动后健康等待 | active + tun0（若 TUN）+ 探测 URL | 已实现且分支正确 | ✅ 完整生效 | `systemd.go:114-160`；`systemd.go:136-149` 仅当配置含 tun 才等 tun0（本机 eBPF 无 tun0，正确跳过） | — | ✅ `singbox_test.go` 覆盖回滚 | — |
| A | 配置失败自动回滚 | 回滚到应用前 + 重启 | 已实现 | ✅ 完整生效 | `singbox.go:259-266`；单测 `TestApplyRestartFailureRollsBack` | — | ✅ | — |
| A | 面板自身启动 | 单二进制启动 | 已实现 | ✅ 完整生效 | `main.go:36-117`；真机 active + 沙箱双证 | — | ❌ 无 `main_test.go` | P1 |
| A | 启动自检 | 启动时校验依赖（systemd/sing-box/clash） | ❌ 无 | ❌ 不存在 | 无 `/healthz`、无依赖探测；配置路径陷阱仅在 HANDOFF 文档提醒 | — | ❌ | P1 |

### 3.2 B · 配置事务与编辑

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| B | 配置读取 | 原文 + 备份列表 | 已实现 | ✅ 完整生效 | `server.go:507-519` | ✅ | ✅ `TestConfigGetAndApply` | — |
| B | 配置校验 | `sing-box check` | 已实现（隔离 cache_file） | ✅ 完整生效 | `singbox.go:167-197`；沙箱实测：非法 JSON→ok:false，合法→"check 通过" | ✅ | ✅ | — |
| B | 配置应用（事务） | 校验→备份→原子写→重启→健康→回滚 | 已实现 | ✅ 完整生效 | `singbox.go:202-257`；沙箱实测成功路径（备份+落盘+重启桩+health） | ✅ 差异对比弹窗 | ✅ 5 个单测 | — |
| B | 备份 / 列表 / 下载 | 手动备份与下载 | 已实现（含路径穿越防护） | ✅ 完整生效 | `server.go:562-617`；`backupNameRe` + relative 校验 | ✅ | 🟡 部分 | — |
| B | 恢复备份 | 从备份恢复并生效 | **动作生效，HTTP 500**；且恢复后状态不一致 | ❌ UI存在但不生效 | `server.go:573-575` panic；沙箱实测：配置确实回滚，但 `managed.json` 残留已不存在的节点（悬空引用） | ✅ | ❌ | **P0** |
| B | 备份保留策略 | backup_keep 轮转 | 已实现 | ✅ 完整生效 | `singbox.go:105-127` | — | ✅ | — |
| B | JSON 配置编辑器 | 语法高亮/补全/差异/撤销/草稿 | 已实现，全库最强面 | ✅ 完整生效 | `ManageView.tsx:1114-1527`；`JsonEditor` + `jsonSchemaCompletion` + `configDraft` + `configDiff` | ✅ 旧 ui 族 | ✅ `configDiff/configDraft` 测试 | — |
| B | schema 补全正确性 | 覆盖 fork 类型 | fork 类型缺失 | 🟡 部分生效 | `public/sing-box.schema.json` 全文件无 `ebpf`；含 gecko/tailcat/snell | — | ✅ schema 测试 | P1 |
| B | 配置回滚可见性 | 失败提示+按钮状态 | 已实现 | ✅ 完整生效 | `showError` + 差异弹窗；`useRuntimeToggles.ts:29-40` | ✅ | 🟡 | — |
| B | 配置应用通知 | 写入事件流 | ❌ 从不记录 | ❌ 不存在（二阶缺陷） | `Deps.NotifyConfigs` 从未赋值，`server.go:541-544` 回退到 `Configs.Apply`，故手动编辑永不出现在通知流 | — | ❌ | P0（随 §P0-1 修） |

### 3.3 C · 订阅与节点

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| C | 添加订阅（URL） | 抓取→解析→入库 | 已实现 | ✅ 完整生效 | 沙箱实测：`更新成功：2 个节点`；`subs.go:193-225` | ✅ Fc 卡片 | ✅ 解析 13 测试 | — |
| C | 更新单个订阅 | 重新抓取 | **动作生效，HTTP 500** | ❌ UI存在但不生效 | `server.go:813-815` panic；沙箱实测 `last_update` 确实推进 | ✅ | ❌ | **P0** |
| C | 全部更新 | 批量更新 | 已实现（不写 Feed） | ✅ 完整生效 | `server.go:799-801` | ✅ | ✅ | — |
| C | 删除订阅 | 幂等删除 | 已实现 | ✅ 完整生效 | `server.go:818-820` | ✅ 确认弹窗 | ✅ | — |
| C | 订阅自动更新调度 | 定时任务 | 后端**已运行**（30s tick），**UI 无入口** | 🟡 部分生效 | `main.go:110-111` 启动 Scheduler；`subs.go:675-696`；`setSubscriptionSchedule` 无 UI 调用方（仅测试） | — | ✅ `subs_test` 覆盖区间钳制 | P1 |
| C | 订阅应用（写配置） | 重建托管节点+组 | 已实现 | ✅ 完整生效 | 沙箱实测：2 节点落盘、Proxy/Auto 成员正确、`managed.json` 生成；`subs.go:440-574` | ✅ | ✅ `TestApplyRebuildsManagedGroups` | — |
| C | 托管状态一致性 | 丢失 `managed.json` 后不产生重复 | **会重复** | 🟡 部分生效 | 生产 `managed.json` 缺失但配置已有 11 个订阅节点；`subs.go:478-512` 仅按"配置中已存在的 tag"去重并加 ` #N`。沙箱实测：删除 managed 后重新订阅 → `Test-SS-01 #2`（§9.8.5） | — | ❌ | **P1** |
| C | 订阅 userinfo | 流量/到期展示 | 已实现（capability 门控） | ✅ 完整生效 | `subs.go:595-603`；`ProfilesView.tsx:263-291` | ✅ | 🟡 | — |
| C | 本地文件导入 | 上传→解析→本地订阅 | **动作生效，HTTP 500** | ❌ UI存在但不生效 | `server.go:913-915` panic；沙箱实测：文件落 `profiles/`、订阅 `nodes` 新建（2 节点） | ✅ | ❌ | **P0** |
| C | 节点手动增删改 | 单节点 CRUD | ❌ 无 | ❌ 不存在 | 节点只能来自订阅；`subs.go` 无 CRUD API，前端无入口 | — | — | P1 |
| C | 协议覆盖 | 全协议 | 仅 ss/vmess/vless/trojan/hysteria2/tuic | 🟡 部分生效 | `parse.go:100-127` `ParseLink`；`parse.go:535-543` clash 映射；**缺 http/socks/ssr/juicity/anytls/ssh/wireguard** | — | ✅ 覆盖已支持项 | P1 |
| C | 代理链 / detour | 链式出口 | ❌ 无 | ❌ 不存在 | 全库无 `detour` 处理；schema 有 `detour` 字段但无 UI | — | — | P2 |
| C | 节点延迟测试 | 单点/整组/指定 URL | 已实现 | ✅ 完整生效 | `daemon.ts:412-414` urlTest；`clash.ts:174-210` 指定 URL + `/group/{tag}/delay` 回退；`delayPool.ts` 32 并发 | ✅ | ✅ | — |
| C | 节点切换 | 选中出站 | 已实现（乐观 UI） | ✅ 完整生效 | `ProxiesView.tsx:379-388`；`ProxyGroupSheet.tsx:23-32` | ✅ | ✅ | — |
| C | 订阅 SSRF 防护 | 内网地址拦截 | ❌ 无（文档声明为有意） | 🟡 设计取舍 | `fetch.go:40-44` 仅校验 scheme；HANDOFF §8 明示 | — | ❌ | P2 |

### 3.4 D · 分组与策略

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| D | 分组列表/成员/延迟 | 只读展示 | 已实现 | ✅ 完整生效 | `daemon.ts:199-231` groups 流；`ProxiesView` | ✅ | ✅ | — |
| D | 分组创建/编辑/删除 | selector/urltest 可视化管理 | ❌ 无 | ❌ 不存在 | 组必须预先存在于配置；`subs.go:514-557` 注释自证"只重整成员" | — | — | **P1** |
| D | 分组策略选择 | fixed/min/random 等 | ❌ 无 | ❌ 不存在 | sing-box 侧等价为 `selector` 手动 + `urltest` 自动；无 UI 切换类型 | — | — | P1 |
| D | 分组下拉展开持久化 | 记住展开态 | 未接入 | 🟡 部分生效 | `daemon.ts:420-422` `setGroupExpand` 有实现，UI 未调用 | — | ❌ | P2 |
| D | 自动测速（内核 urltest） | 按间隔选优 | 依赖配置项 | ✅ 完整生效（配置层） | 由 sing-box 自身执行；面板仅展示 | — | — | — |
| D | 健康监控/自动测速/故障转移 | 定时探测+掉线提示+自动切换 | **完整实现，零 UI 入口** | ❌ UI 不存在（代码存在） | `useHealthMonitor.ts` 全量（探测池 66-86、公告 144-181、自愈 184-208）；`useHealthMonitor.ts:241` `intervalMs<=0` 直接返回；唯一写入 `saveAutoTestInterval` 无生产调用方；`saveHealthSettings` 同 | — | ✅ `healthPreferences.test` | **P1** |
| D | eBPF 分应用策略 | UID 黑白名单 | 已实现 | ✅ 完整生效 | `ebpf.go:121-160`；沙箱实测无 ebpf inbound 时返回友好错误；真机 `tools ebpf status` 可用 | ✅ 旧 ui 族 | ❌ ebpf 包 0 测试 | — |

### 3.5 E · 路由规则

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| E | 规则列表/搜索/重排 | CRUD + 顺序 | 已实现 | ✅ 完整生效 | `RulesView.tsx:123-146`；重排/删除各自触发一次写+重启 | 🟡 混用 Fc+ConfirmDialog | ✅ | — |
| E | 可视化规则编辑 | 动作+匹配器表单 | 已实现（22 个匹配器） | ✅ 完整生效 | `ruleEditor.ts:38-61`；`RuleEditorDialog.tsx`；未知键保留为原始匹配器 | 🟡 旧 Dialog | ✅ 2 个测试文件 | — |
| E | 规则保存（落盘） | 写回配置并生效 | 已实现，但**整文件重写丢注释** | 🟡 部分生效 | `RulesView.tsx:100-102`：`JSON.parse(normalizeConfigJson(text))` → `JSON.stringify`；`panel.ts:581-621` 证明注释被剥离。对比 TUN/LAN 走 `configEdit.ts:105-116` 的 jsonc `modify` 保注释 | — | ✅ | **P1** |
| E | 嵌套规则（logical）编辑 | 支持编辑或明确禁止 | **UI 可点开，保存必失败** | ❌ UI存在但不生效 | `ruleEditor.ts:14` 把 `rules`/`mode` 列为保留键，`ruleToDraft`（`:103-126`）直接丢弃；`RuleEditorDialog.tsx:19-21` 注释承诺"拒绝打开并引导到 JSON 编辑器"，但**无任何代码实现**（`grep` 无命中）。生产 `rule[2]`=DNS 劫持、`rule[7]`=广告拦截均为 logical，保存产物被 check 拒绝（§9.8.4） | 🟡 旧 Dialog | ✅ 但只测非嵌套 | **P0** |
| E | 规则校验 | 引用完整性/端口格式 | 仅 1 条规则 | 🟡 部分生效 | `ruleEditor.ts:187-192` 仅校验 route 需 target；不校验 outbound tag 存在性、`port_range` 格式、数值字段非法字符 | — | ✅ 但只测已实现项 | P1 |
| E | 规则集（route_set） | 在线更新/编辑 | 只读列表 | ❌ 不存在（编辑） | `RuleSetsView.tsx:29-48`；页面自述"请在配置文件中编辑" | 🟡 | ❌ | P1 |
| E | 默认出站 final | 可视化设置 | 仅配置编辑器 | 🟡 部分生效 | 无专门 UI | — | — | P2 |
| E | DNS 规则编辑 | dns.rules 可视化 | ❌ 无 | ❌ 不存在 | `RulesView.tsx:226-228` 提示"DNS 规则请在配置文件中编辑"；`RuleEditorDialog` 有 `server` 模式但无调用方 | — | — | **P1** |
| E | 分流命中观测（拓扑） | 规则→出站→节点 | ❌ 无 | ❌ 不存在 | 连接流有 `rule`/`outbound` 字段可聚合，但无页面 | — | — | P2 |

### 3.6 F · DNS

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| F | DNS 查询工具 | 任意域名/类型查询 | 已实现 | ✅ 完整生效 | `clash.ts:156-160`；`RecordsView.tsx:495` | ✅ | 🔴 无 DNS 专属测试 | — |
| F | DNS 缓存清理 | flush | 已实现 | ✅ 完整生效 | `clash.ts:162-164`；`RecordsView.tsx:451` | ✅ | 🔴 | — |
| F | FakeIP 缓存清理 | flush fakeip | API 有，UI 无 | 🟡 部分生效 | `clash.ts:166-168` 零调用方 | — | 🔴 | P2 |
| F | DNS 服务器/规则配置 | servers + rules 编辑 | ❌ 无 | ❌ 不存在 | 仅能进配置编辑器手写；且 1.14 已改 DNS 新格式，旧写法会被 check 拒绝（实测） | — | 🔴 | **P1** |
| F | DNS 查询日志 | 全量日志 | ❌ 不存在（会话台账） | 🟡 部分生效（诚实降级） | `dnsLedger.ts` 仅记录面板内手动查询；页面明示"核心不提供 DNS 日志接口" | ✅ 诚实 | 🔴 | P2 |
| F | DNS 高级项 | fixed_domain_ttl/optimistic_cache | 仅配置编辑器 | 🟡 部分生效 | 无表单 | — | 🔴 | P2 |

### 3.7 G · 观测

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| G | 实时上下行速度 | daemon 流 | 已实现 | ✅ 完整生效 | `daemon.ts:152-190` 1s 流 + 30/3600 样本 | ✅ | ✅ | — |
| G | 历史流量图 | `/api/history` 持久化 | **恒 500** | ❌ UI存在但不生效 | `main.go:69-80` 未接 `History`；`server.go:851` 空指针；前端 `useObservability.ts:73-77` catch→null→卡片空白 | ✅ | ❌ | **P0** |
| G | 出站环形图 | 持久化占比 | 降级为会话级 | 🟡 部分生效 | `mergeOutboundTotals` 回退；根因同上 | ✅ 诚实标注 | 🟡 | P0（随上） |
| G | 流量排行 | 设备/域名 Top | 会话级聚合 | 🟡 部分生效 | `useObservability.ts:132-153`；自述"会话级统计" | ✅ | ❌ | P2 |
| G | CPU 使用率 | 面板采样 | **永不产出**，且文案误报"直接模式" | ❌ UI存在但不生效 | `Sampler` 未接线 → `server.go:404-406` 不写 `cpu_percent`；前端 `ObservabilityCards.tsx:319-320` 在 `cpu===null` 时硬编码"直接模式下不可用"，即使面板在线 | ✅ | ❌ | **P0** |
| G | 内存 | app/kernel | 已实现 | ✅ 完整生效 | `server.go:398-403`；`meminfo` | ✅ | ❌ | — |
| G | 内网 IP 探测 | 展示本机 LAN 地址 | eBPF 模式下恒 `127.0.0.1` | 🟡 部分生效 | `localip.go:13-23` 用 UDP dial 取源地址；eBPF cgroup `connect` 钩子把目标改写到回环，源地址随之变 `127.0.0.1`。真机 `/api/local-ip`=127.0.0.1，而 `ip route get 8.8.8.8`=`192.168.31.30`；前端 `localIp.ts` 只在空值时回退 WebRTC，非空即采信 | ✅ | ❌ | P2 |
| G | 通知与问题 | 面板事件流 | **恒 500** | ❌ UI存在但不生效 | `main.go` 未接 `Feed`；`server.go:893`；`useObservability.ts:211-214` catch→`[]`→"暂无事件" | ✅ | ❌ | **P0** |
| G | 连接列表/关闭 | 实时 + 单条/全部关闭 | 已实现 | ✅ 完整生效 | `daemon.ts:300-367`；`RecordsView.tsx:177-186, 249-263` | ✅ | ✅ | — |
| G | 请求台账 | 历史请求 | 派生数据（会话级） | 🟡 部分生效 | `requestLedger.ts` 自连接事件派生；页面明示 | ✅ 诚实 | 🟡 | P2 |
| G | 日志 | 流+级别+过滤+清空 | 已实现 | ✅ 完整生效 | `LogsView.tsx`；`daemon.ts:272` | ✅ i18n | ✅ | — |
| G | 事件页 | 独立事件列表 | ❌ 无 | ❌ 不存在 | 仅 Dashboard 卡片（且当前 500） | — | — | P2 |
| G | 活动时间线 | 操作审计 | ❌ 无 | ❌ 不存在 | 无 | — | — | P2 |
| G | GeoIP 归属 | IP→国家/城市 | 已实现 | ✅ 完整生效 | `server.go:619-628`；`geoip.go`；本机 mmdb 存在性由配置决定 | ✅ | ❌ | — |
| G | 服务可用性探测 | Google/GitHub/… | 已实现 | ✅ 完整生效 | `serviceStatus.ts:8-22` + clash delay 4 并发 | ✅ | ✅ | — |
| G | 出站模式切换 | 规则/全局/直连 | 已实现 | ✅ 完整生效 | `daemon.ts:424-426`；`DashboardView.tsx:1317-1326` | ✅ | ✅ | — |

### 3.8 H · 系统集成与接入模式

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| H | 系统代理开关 | 桌面代理 | 已实现 | ✅ 完整生效（未在真机执行，避免改动桌面网络） | `sysproxy.go`；`useRuntimeToggles.ts:52-104` | ✅ | ❌ | — |
| H | LAN 代理开关 | listen 0.0.0.0 | 已实现 | ✅ 完整生效 | `configEdit.ts:151-159`（jsonc 保注释）+ 事务管线 | ✅ | ✅ | — |
| H | TUN 开关 | 一键 TUN | 仅前端删/恢复 inbound；**真机确认当前配置无 tun 入站 → 开关不可用**；eBPF 模式锁定 | 🟡 部分生效 | `useRuntimeToggles.ts:120-209`；`:138-144` 锁定；`:151-153` 无预设时拒绝；`tunPreset.ts` 存 localStorage；真机 `inbounds=['mixed','ebpf']` | ✅ 有确认弹窗 | ✅ `configEdit.test` | P2 |
| H | TUN 模式运行 | 后端管理 TUN inbound | ❌ 无 | ❌ 不存在 | 后端仅"侦测"：`server.go:294-308`、`systemd.go:188-197`；无创建/编辑代码 | — | ✅ 仅 `hasTunInbound` 间接覆盖 | **P2** |
| H | eBPF 模式运行 | 接口/cgroup/tproxy 配置 | 内核侧完整；面板侧仅 UID 策略 | 🟡 部分生效 | `ebpf.go` 只读写 `local.include_uid/exclude_uid`；`data_plane/dns_mode/ipv6/shared` 只读展示 | ✅ | ❌ | P2 |
| H | 模式抽象层 | 按模式切换能力集 | ❌ 无 | ❌ 不存在 | 模式是 `server.go:294-308` 的字符串推断；UI 靠 `inbounds.includes("ebpf")` 各页硬判 | 🟡 | — | **P2** |
| H | 网络质量测试 | 内核 RPC | 已实现 | ✅ 完整生效 | `ToolsView.tsx:165-311` | 🟡 旧 ui | ✅ | — |
| H | STUN 测试 | 内核 RPC | 已实现 | ✅ 完整生效 | `ToolsView.tsx:323-432` | 🟡 旧 ui | ✅ | — |
| H | 连通性测试 | 多目标多轮 | 已实现 | ✅ 完整生效 | `ConnectivityTestView.tsx:107-169` | 🟡 旧 ui | ✅ | — |

### 3.9 I · 面板自管理

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| I | Token 认证 | 头/ Cookie，常量时间比较 | 已实现 | ✅ 完整生效 | `server.go:140-185`；token 0600；`PANEL_TOKEN` 可覆盖 | — | ✅ | — |
| I | 锁定面板 | 前端遮罩 | 已实现（非安全边界，已声明） | ✅ 完整生效 | `GeneralView.tsx:134-141`；SECURITY.md 诚实说明 | ✅ | — | — |
| I | 服务器列表 | 多实例 | localStorage only（设计如此） | 🟡 部分生效 | `SettingsView.tsx:140-207`；`saveServersState` | 🟡 | ✅ | P3 |
| I | 主题/配色 | 明暗/调色板/强调色 | 已实现（4 调色板 + AMOLED + 自定义强调色） | ✅ 完整生效 | `globals.css:272-692`；`tonalPalette.ts` | ✅ | ✅ | — |
| I | 国际化 | 多语言 | **两套机制并存** | 🟡 部分生效 | 旧页 `t()`（ManageView 213 处）；新页硬编码中文（DashboardView 104 处中文字面量 / 16 处 `t()`）；5 语言资源仅覆盖旧面 | ❌ | ✅ i18n 测试 | P3 |
| I | 面板配置路径 | 部署即生效 | 默认 `/etc/sing-box/panel.json`，部署实际用 `/etc/sing-box-panel/panel.json`，靠 drop-in 覆盖 | 🟡 风险 | `settings.go:94-96`；本机 drop-in `ExecStart=...--config /etc/sing-box-panel/panel.json` | — | ❌ | P2 |
| I | 面板配置权限 | 最小权限 | **0644 全局可读** | 🟡 安全瑕疵 | 真机 `ls -la /etc/sing-box-panel/panel.json`；含 ui_dir/zashboard_dir，敏感度低但不符合最小权限 | — | ❌ | P2 |
| I | Clash secret 暴露面 | 不落明文到前端 | `secret` 出现在 `zash_setup_url` 查询串 | 🟡 设计取舍 | `server.go:430-452`；`/api/state` 本就返回 `clash_secret`（同源鉴权保护） | — | ❌ | P2 |

### 3.10 J · 工程与测试

| 模块 | 功能 | 对标应有 | 实际状态 | 生效性判定 | 问题根因（代码证据） | UI一致性 | 测试覆盖 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| J | CI | lint/test/build | 已实现（前端+后端两 job） | ✅ 完整生效 | `.github/workflows/ci.yml` | — | — | — |
| J | 单元测试 | 核心逻辑 | 已实现 | 🟡 部分生效 | 后端 8 包有测试；**systemd/clashapi/ebpf/settings/profiles/notifications/main 零测试**；前端 38 文件 300 用例 | — | 🟡 | P1 |
| J | 集成测试（装配层） | 真实 main 启动 | ❌ 无 | ❌ 不存在 | 这正是 P0 逃逸的原因：`server_test.go:67-82` 替 main 接好了 `Feed`/`History` | — | ❌ | **P0** |
| J | e2e | 浏览器级核心链路 | ❌ 无（手工 CDP） | ❌ 不存在 | `artifacts/*.py` 手工脚本，未入 CI；README Roadmap 自认 | — | ❌ | P1 |
| J | 启动验证脚本 | 一键起栈+自检 | ❌ 无 | ❌ 不存在 | 无 `smoke.sh`；`deploy/install.sh` 只在安装时 curl `/api/ping` | — | ❌ | P1 |
| J | 仓库卫生 | 无产物入库 | 🟡 | — | 83 个截图/CDP 脚本入库；`.gitmodules` 为空壳；二进制已移出版本库 | — | — | P3 |

---

## 4. 死代码与孤儿清单（含证据）

| 类型 | 对象 | 位置 | 判定 |
|---|---|---|---|
| 死分支 | `Apply(restart=false)` → "配置已写入（未重启）" | `singbox.go:243-245` | 全库无调用方传 false |
| 未用函数 | `history.Store.OutboundTotals` | `history.go:285-295` | 零调用 |
| 未用函数 | `ebpf.JSONMarshal`、`systemd.ArrayField` | `ebpf.go:426-429`、`systemd.go:199-202` | 零调用 |
| 只读字段 | `data_plane/dns_mode/ipv6/shared` | `ebpf.go:104-115` | 可读不可写 |
| 孤儿 API（后端有、UI 无） | `setSubscriptionSchedule` | `panel.ts:512-520` | 仅测试引用 |
| 孤儿 API | `flushFakeIpCache` | `clash.ts:166-168` | 零引用 |
| 孤儿 API | `getMemoryBreakdown` | `panel.ts:862-864` | 零引用 |
| 孤儿 RPC | `setGroupExpand`、`getDeprecatedWarnings`、`clearConnectionHistory`、`openBidirectionalStream` | `daemon.ts:420/460/436/379` | 仅定义/fixture |
| 孤儿组件 | `Breadcrumb`、`Tooltip`、`HistoryChart`（`Tabs/Table/Skeleton/ErrorBoundary` 仅测试引用） | `src/components/` | 生产零引用 |
| 死页面 | `SettingsView`（除 ServersView）、`PreferencesView`、根 `ToolsView` | `SettingsView.tsx:25-138`、`views/ToolsView.tsx:37-63` | 未挂路由 / 被同名覆盖 |
| 休眠子系统 | 健康监控 + 自动测速 + 故障转移 + webhook 通知 | `useHealthMonitor.ts`、`healthPreferences.ts`、`groupPreferences.ts` | 无 UI 入口，默认 off |
| 永久禁用控件 | 订阅"二维码"导入项 | `ProfilesView.tsx:229-237` | `disabled` |

---

## 5. 模式覆盖矩阵

### 5.1 矩阵（行=功能，列=接入模式）

✅ 完整 / 🟡 部分或降级 / ❌ 不可用或锁定 / — 不适用

| 核心功能 | 直连模式（无面板后端） | 面板 + mixed | 面板 + TUN | 面板 + eBPF（本机） |
|---|---|---|---|---|
| 实时速度/连接/日志 | ✅（gRPC） | ✅ | ✅ | ✅ |
| 节点/分组只读 + 切换 + 测速 | ✅ | ✅ | ✅ | ✅ |
| 出站模式切换（规则/全局/直连） | ✅ | ✅ | ✅ | ✅ |
| 节点/订阅管理 | ❌ 需面板 | ✅ | ✅ | ✅ |
| 配置事务（校验/备份/回滚） | ❌ | ✅ | ✅ | ✅ |
| 规则可视化编辑 | ❌ | ✅ | ✅ | ✅ |
| DNS 查询/清缓存 | ✅（Clash API） | ✅ | ✅ | ✅ |
| DNS 配置编辑 | ❌ | ❌ 全模式缺失 | ❌ | ❌ |
| 分组创建/编辑 | ❌ | ❌ 全模式缺失 | ❌ | ❌ |
| 节点手动 CRUD | ❌ | ❌ 全模式缺失 | ❌ | ❌ |
| 系统代理开关 | ❌ | ✅ | ✅ | ✅ |
| LAN 代理开关 | ❌ | ✅ | ✅ | ✅ |
| TUN 开关 | ❌ | ✅（需已有 tun inbound） | ✅ | ❌ 锁定（设计） |
| TUN 运行管理 | — | — | ❌ 后端无实现 | — |
| eBPF 分应用策略 | ❌ | ❌ 无 ebpf inbound | ❌ | ✅ |
| eBPF 接口/cgroup/tproxy 配置 | — | — | — | ❌ 无实现 |
| 历史流量/通知/CPU | ❌ | ❌ **全模式均 500** | ❌ | ❌ |
| 自动测速/故障转移 | ❌ 无 UI | ❌ 无 UI | ❌ 无 UI | ❌ 无 UI |

### 5.2 模式耦合点（写死在哪里）

| 耦合 | 位置 | 影响 |
|---|---|---|
| 模式靠 inbound 类型字符串推断 | `server.go:294-308` | 新增模式必须改这里 |
| 仅 TUN 才等 tun0 | `systemd.go:136-149` | eBPF 模式下正确跳过，但无统一"就绪探针"抽象 |
| eBPF 策略只作用于 fork 的 `ebpf` inbound | `ebpf.go:47-63, 121-160` | 非 fork 内核直接不可用 |
| 前端以 `inbounds.includes("ebpf")` 锁 TUN | `useRuntimeToggles.ts:124, 138-144` | 模式判断散落前端 |
| schema 无 `ebpf` | `public/sing-box.schema.json` | 配置编辑器对自家核心 inbound 无补全 |
| 系统代理实现是 Linux 桌面 | `sysproxy.go` | 跨平台不可用 |

---

## 6. 缺失模式影响评估

**TUN 缺失的真实影响面**：

1. **无法覆盖非 eBPF 场景**：eBPF 依赖 fork 内核 + cgroup v2 + 特定内核版本（本机 7.3.0 cachyos-bore）；标准 sing-box 用户、容器、较旧内核全部无法使用本面板的"流量接管"。
2. **无法跨平台**：`sysproxy` 为 Linux 实现，TUN 是唯一的跨平台接管路径；当前 macOS/Windows 完全无接管能力。
3. **TUN 开关是"半成品"**：仅能从既有配置中删除/恢复，**无法创建**。用户新建实例时第一次开 TUN 必须先手写 inbound，等于把最难的一步留给用户。
4. **健康检查语义分裂**：`wait_healthy` 对 TUN 等 tun0，对 eBPF 不等——未来新增模式需再改代码，而非配置。

**eBPF 缺失的部分（相对完整 eBPF 能力）**：接口绑定（wan/lan）、cgroup 路径、tproxy 端口、DNS 劫持模式切换均在配置编辑器里手写，面板只提供 UID 黑白名单。这与你原清单里 dae 的 `wan_interface/lan_interface/tproxy_port` 需求对应，但**在 sing-box 语境下这些属于 inbound 配置项**，面板缺的是"结构化编辑"而非"运行支持"。

---

## 7. 风格不一致点汇总

| # | 不一致 | 量化证据 | 影响 |
|---|---|---|---|
| 1 | **两代组件族并存** | `components/flclash` 被 14 个文件引入；`components/ui.tsx` 被 11 个引入；`ProfilesView` 同时引入两族 | 同一产品两种视觉语言 |
| 2 | **三种弹窗** | `FcSheet`（新，底部抽屉）/ `Dialog`（旧，居中）/ `ConfirmDialog`（旧族包装，但被 4 个新页面使用） | 删除用居中、编辑用抽屉 |
| 3 | **两套 i18n** | `DashboardView` 104 处中文字面量 vs 16 处 `t()`；`ManageView` 1 处 vs 213 处 `t()`；`LogsView` 0 vs 30 | 切英文后新壳仍全中文 |
| 4 | **三种空/错/载态** | `FcSkeleton`/纯文本空态（新）；`Spinner`/`EmptyState`（旧）；`errorBox/successBox/warnBox`（ManageView） | 加载体验割裂 |
| 5 | **工具栏未统一** | `FcPageToolbar` 已存在，但 Dashboard/Proxies/Records 各自手搓 | 标题栏高度/按钮位置不一致 |
| 6 | **孤儿组件** | `Breadcrumb/Tooltip/HistoryChart` 生产零引用；`Tabs/Table/Skeleton/ErrorBoundary` 仅测试引用 | 维护噪音 |
| 7 | **同文件两套写入路径** | 规则编辑器 `JSON.stringify` 全量重写；TUN/LAN 用 jsonc `modify` 局部编辑（`configEdit.ts:105-116`） | 前者静默丢注释 |
| 8 | **误导性空态文案** | CPU 卡 `cpu===null` 一律显示"直接模式下不可用"，面板在线也这么说（`ObservabilityCards.tsx:319-320`） | 用户误判为部署错误 |
| 9 | **内联样式残留** | 旧页 `ToolsView`/`ServerDialog`/`SettingsView`/`ConnectionErrorView` 多处 `style={{...}}` | 主题切换边缘失效 |
| 10 | **语言混杂** | 新页面中文、`ruleEditor.ts:189` 校验文案英文（"The route action needs an outbound tag"） | 提示语突兀 |

**结论**：这不是"随手写乱"，而是**一次未完成的重构**——FlClash 重设计只覆盖了壳与高频页，旧面（Manage/Logs/Setup/Servers/工具类）保持原样，迁移中断处留下双份实现。**修复必须先定规范再逐页套用**（见补全计划 P3）。

---

## 8. Top 问题清单（按影响排序）

| 排名 | 问题 | 影响 | 等级 |
|---|---|---|---|
| 1 | `main.go` 未接线 `Feed/History/Sampler` | 2 读接口恒 500；4 写接口成功后返 500；CPU/历史/通知三块功能全废；目录里从未生成 `history.jsonl`/`notifications.json` | **P0** |
| 2 | 配置应用固定 `restart`，浪费 SIGHUP 热重载 | 每次改规则/订阅/策略都断流；本机实测 SIGHUP 可零断流 | **P0** |
| 3 | 装配层无集成测试 | 上述两个 P0 都能被一条"起真实 main 打全部端点"的测试拦住 | **P0** |
| 4 | CPU 卡文案与数据双缺 | 面板在线却报"直接模式下不可用" | **P0** |
| 5 | 可视化编辑器改不了 2 条生产关键规则（DNS 劫持 / 广告拦截） | 规则页对 logical 规则不可用，保存必失败且报错晦涩 | **P0** |
| 6 | 健康监控/自动测速/故障转移无 UI | ~800 行能力不可达 | P1 |
| 7 | 恢复备份/托管状态丢失导致 `managed.json` 悬空与重复节点 | 下次 apply 依赖错误的托管集合，重新订阅产生 `#2` 重复 | P1 |
| 8 | 无分组编辑器 / 无节点 CRUD / 无 DNS 编辑器 | 三大编辑域缺失，是"对标 doona"差距主体 | P1 |
| 9 | 规则保存丢注释 + 校验仅 1 条（生产暂无注释，潜伏） | 有注释的配置会被静默破坏 | P1 |
| 10 | 订阅调度、规则集更新、FakeIP 清缓存无入口 | 后端能力空转 | P1/P2 |
| 11 | 内网 IP 在 eBPF 模式下恒为 `127.0.0.1` | 概览页"内网 IP"永远错误 | P2 |
| 12 | 无 TUN 后端、无模式抽象 | 场景与平台覆盖受限 | P2 |
| 13 | schema 不含 ebpf / 面板配置 0644 | 编辑器失明 + 最小权限 | P2 |
| 14 | 双组件族/双 i18n/三弹窗 | 体验割裂、维护成本 | P3 |

---

## 9. 真机与沙箱验证记录

> 所有命令均可复跑。生产环境**未做任何写操作**。

### 9.1 生产环境 panic（复现证据）

```bash
journalctl -u sing-box-panel --no-pager --since '7 days ago' | grep -E '内部错误|nil pointer'
```

```
11月 01 12:30:45 ... API GET /api/history 出错：runtime error: invalid memory address or nil pointer dereference
11月 01 12:30:45 ... API GET /api/history 出错：runtime error: invalid memory address or nil pointer dereference
11月 01 12:30:45 ... API GET /api/notifications 出错：runtime error: invalid memory address or nil pointer dereference
11月 01 12:41:58 ... API GET /api/history 出错：runtime error: invalid memory address or nil pointer dereference
11月 01 12:41:58 ... API GET /api/history 出错：runtime error: invalid memory address or nil pointer dereference
11月 01 12:41:58 ... API GET /api/notifications 出错：runtime error: invalid memory address or nil pointer dereference
```
命中 6 条，时间与用户截图时刻吻合。

### 9.2 沙箱复现（真实二进制，端口 9097/9098，未触碰 systemd）

```
GET  /api/history        -> HTTP 500  {"ok":false,"message":"内部错误：runtime error: invalid memory address or nil pointer dereference"}
GET  /api/notifications  -> HTTP 500  同上
POST /api/service        -> HTTP 500  同上；但 systemctl 桩调用日志新增一行 restart（动作已执行）
POST /api/subscriptions/{id}/update -> HTTP 500；但 subscriptions.json 的 last_update 由 1793510273 推进到 1793510309
POST /api/config/restore -> HTTP 500；但 config.json 已被备份内容覆盖（动作已执行）
POST /api/profiles/import-> HTTP 500；但 state/profiles/ 新增文件且订阅列表新增 nodes=2 的本地订阅
```

**结论**：`Deps.Feed == nil` 时 `Record/ListValue` 解引用 nil 接收者（`notifications.go:56-73/87-111` 无守卫）→ panic → `recoverMiddleware`（`server.go:128-138`）兜成 500，而业务动作已提交。**这是"用户以为失败、其实已生效"的最危险形态**。

### 9.3 状态目录证据（可观测性从未运行）

```bash
ls -la /var/lib/sing-box-panel/
-rw------- 1 root root   3 10月17日 23:24 subscriptions.json   # 内容 "[]"
-rw------- 1 root root  18 10月 2日 09:36 token
```

缺失：`history.jsonl`（Sampler 从未 Start）、`notifications.json`（Feed.Add 从未执行）、`managed.json`（从未 apply 订阅）、`profiles/`。与代码证据完全互洽。

### 9.4 测试现状（全绿但漏掉 P0）

```
go test ./...        -> 8 包 ok（systemd/clashapi/ebpf/settings/profiles/notifications/main 无测试）
npx vitest run       -> Test Files 38 passed / Tests 300 passed
```

`server_test.go:67-82` 在夹具中显式 `Feed: feed, History: historyStore`，而 `main.go:69-80` 没有——**测试把生产缺口补上了，所以永远测不出来**。同时夹具也未设置 `Sampler`，`cpu_percent` 路径无人覆盖。

### 9.5 SIGHUP 热重载实测（决定 P0-2 方案）

```bash
# 独立实例，端口 17891，然后改配置为 17892 并 SIGHUP
kill -HUP 99679
```

```
inbound/mixed[reload-in]: tcp server started at 127.0.0.1:17892
sing-box started (0.01s)
进程 PID 99679 存活；17891 -> HTTP 000（已关闭）；17892 -> HTTP 200（已接管）
```

**结论**：`sing-box v1.14.4-reF1nd` 支持 SIGHUP 热重载，**进程不重启、连接不断**。面板 `Apply()` 固定走 `restart`（`singbox.go:248`），把可用的零断流能力闲置了。

### 9.6 订阅与配置事务成功路径（沙箱桩验证）

```
POST /api/subscriptions/apply
{"ok":true,"message":"配置已应用并重启成功（服务已恢复健康）","backup":"config.20261101-131821.subscriptions-apply.json"}

落盘 outbounds: Proxy(selector), Auto(urltest), direct, block, Test-SS-01, Test-SS-02
Proxy members : ['Auto','direct','Test-SS-01','Test-SS-02']   # 保留手工成员 direct
Auto  members : ['direct','Test-SS-01','Test-SS-02']
managed.json  : 正确记录 outbound_tags / group_members / by_subscription
```

**结论**：订阅域与配置事务**本身是可靠的**，问题仅在装配层与 UI 入口。

### 9.7 eBPF 与模式侦测

```bash
sing-box tools ebpf status --mode all --json
 -> platform Linux, local_data_plane=cgroup, shared_data_plane=packet_rewrite, tcp/udp, ipv6=true
GET /api/ebpf/policy（无 ebpf inbound 的沙箱）-> {"ok":true,"present":false,"mode":"none"}
POST /api/ebpf/policy（无 ebpf inbound）      -> {"ok":false,"message":"当前配置里没有 ebpf 入站…"}
```

**结论**：eBPF 侧降级与报错**正确**；能力边界（只能改 UID 黑白名单）与代码一致。

---

### 9.8 鉴权后的生产验证（令牌由用户提供，全部只读）

#### 9.8.1 生产状态

```bash
curl -H "X-Panel-Token: $T" http://127.0.0.1:9096/api/state
```
```
mode            : ebpf
inbounds        : ['mixed', 'ebpf']        # 无 tun
cpu_percent     : <缺失>                   # P0-3 真机确认
memory_app      : 12943360 | memory_kernel: 125116416
config_bytes    : 18184 | config_error: ''
service         : {'active': True, 'enabled': True, 'pid': '2070'}
local_ip        : 127.0.0.1                # P2 缺陷
```

#### 9.8.2 生产配置结构（脱敏摘要）

```
inbounds : mixed(127.0.0.1:7892) + ebpf(tag=ebpf-in, data_plane=cgroup,
           dns_mode=hijack, ipv6=true, include_uid/exclude_uid 均为空)
outbounds: direct + 11×shadowsocks(订阅节点) + 9 个组 = 21
           + Proxy(selector,17) / Auto(urltest,10)
           + Japan/HongKong/Singapore(selector) / Auto-*(urltest) / Download(selector)
route    : final=Proxy, rules=14, rule_set=17
           其中 rule[2]=logical(or) action=hijack-dns（嵌套 port/protocol）
               rule[7]=logical(and) action=reject（嵌套 clash_mode/rule_set → 广告拦截）
dns      : servers=7（均为 1.14 新格式：hosts/https/group）, rules=11
experimental: cache_file + clash_api
注释     : `//` 0 行、`/* */` 0 处
```

**判读**：
- TUN 开关**当前不可用**——配置里没有可删除/恢复的 tun 入站。
- 11 个订阅节点已在配置中，但 `subscriptions.json` 为空、`managed.json` 不存在 → 托管血缘已断。
- 规则结构（logical 嵌套、rule_set、clash_mode）比可视化编辑器能表达的更复杂。

#### 9.8.3 真机 500 与"动作与响应脱钩"的零副作用证明

```bash
GET  /api/history?range=10m  -> HTTP 500  nil pointer dereference
GET  /api/notifications      -> HTTP 500  nil pointer dereference
POST /api/service {"action":"noop"} -> HTTP 500
        # 非法 action 在 systemd.go:89-91 立即返回错误，不触碰 systemd；
        # 但仍然 500 —— 证明 panic 与业务结果无关，是 unconditionally 的。
systemctl is-active sing-box -> active ；MainPID 仍为 2070
```
其余只读端点（subscriptions / managed / ebpf/policy / clash/version / local-ip / memory）均 200。

#### 9.8.4 嵌套规则：编辑器产物被 check 拒绝

生产 `rule[2]`、`rule[7]` 经 `ruleToDraft` 转换后（`rules`/`mode` 被丢弃）等价于：

```json
[{"action": "hijack-dns", "type": "logical"}]
[{"action": "reject",     "type": "logical"}]
```

`sing-box check` 实测：

```
FATAL initialize router: parse rule[0]: missing conditions    (exit=1)
```

**结论**：数据不会损坏（事务管线会拦下并回滚），但**这两条关键规则在 UI 里完全不可编辑**，且用户只会看到"配置校验未通过：missing conditions"这种无法自我解释的错误。`RuleEditorDialog.tsx:19-21` 的注释承诺"拒绝打开并引导到 JSON 编辑器"，代码并未实现。

#### 9.8.5 托管状态丢失 → 重复节点

沙箱复现（删除 `managed.json` 后重新订阅同一来源）：

```
apply 前 tags: ['Proxy','Auto','direct','block']
apply 后 tags: [..., 'Test-SS-01', 'Test-SS-02',
                     'Test-SS-01 #2', 'Test-SS-02 #2']
```

生产正处于该前置状态（配置有 11 个订阅节点、`managed.json` 缺失、`subscriptions.json` 为空）。用户一旦重新添加同一订阅，将得到 11 个 `#2` 重复出站并混入 Proxy 组。

#### 9.8.6 内网 IP 在 eBPF 模式下失效

```
GET /api/local-ip  -> {"ok":true,"ip":"127.0.0.1"}
ip route get 8.8.8.8 -> ... src 192.168.31.30
ip -4 addr          -> 192.168.31.30 / 192.168.122.1
```

`localip.Detect()`（`localip.go:13-23`）用 UDP dial 读源地址；面板以 root 运行且 `include_uid/exclude_uid` 为空，eBPF cgroup `connect` 钩子把代理流量目标改写到回环，源地址随之变成 `127.0.0.1`。前端 `localIp.ts` 仅在空值时回退 WebRTC，非空即采信 → 概览页"内网 IP"永久显示 127.0.0.1。

---

## 10. 证伪记录（被推翻的初判）

| 初判 | 实测/复核结果 | 状态 |
|---|---|---|
| 订阅自动更新调度器没在跑 | `main.go:110-111` 已 `Scheduler.Start()`，`subs.go:679-695` 每 30s `RunDue` | **推翻**：后端在跑，只缺 UI |
| `reload` 动作是空操作/无效 | 本机 `ExecReload=kill -HUP`，实测 SIGHUP 真重载 | **推翻**：reload 有效，只是没人用 |
| 配置导入完全失败 | 沙箱：文件落盘、订阅新增，仅响应 500 | **部分推翻**：功能成功，响应错误 |
| 订阅应用只改成员不重写出站 | 实测出站被正确重建（含 tag 去重） | **推翻**：出站重建正确，组只重整成员是设计 |
| CPU 卡不可用是前端没接 | 后端 `Sampler` 未接线是主因，前端文案是次因 | **修正**：双因 |
| 后端测试覆盖差到没跑 | 8 包全绿 | **修正**：有测试，缺装配层集成测试 |
| 规则编辑器完全不生效 | 写回链路完整，仅丢注释+校验弱 | **修正**：部分生效 |

---

## 11. 待确认项（需用户提供）

| # | 事项 | 为何需要 | 影响 |
|---|---|---|---|
| ✅ 已解决 | 面板访问令牌 | 已用其完成 §9.8 全部鉴权验证 | — |
| ✅ 已解决 | 生产 `config.json` 内容 | 已通过 `GET /api/config` 获取结构摘要（脱敏，§9.8.2） | — |
| 1 | 是否使用 pacman 部署分支（`~/Projects/pkgbuild-source`） | 决定修复后如何交付发布 | 影响补全计划的交付步骤 |
| 2 | 是否接受"订阅导入作为唯一节点来源"的产品定位 | 决定节点 CRUD 的优先级 | 若接受，P1-3 可降为 P2 |
| 3 | eBPF fork（reF1nd）是否跟进 1.14 上游 | 决定是否要抽象内核适配层 | 影响 P2 工作量 |
| 4 | P0-2 验收是否允许在生产做一次"无实质变化配置"的 reload 灰度 | 行为探针 + fallback 需要在真机确认 | 影响 P0-2 能否判定"完整生效" |

---

## 附录 A · dae/dae-wing 功能域交叉参照

> 口径：本项目管理 sing-box，**全库无 dae 语法**（`grep -ri dae backend src` 零命中）。下表把用户原始清单逐项映射到 sing-box 等价物，标注本项目实现度。

| dae 功能域 | dae 概念 | sing-box 等价物 | 本项目实现度 |
|---|---|---|---|
| global | `tproxy_port` / `wan_interface` / `lan_interface` | inbound(`tproxy`/`ebpf`) 的 `listen_port`/接口/shared 字段 | 🟡 仅 eBPF `shared` 只读；其余手写配置 |
| global | `dial_mode`(ip/domain/domain+/domain++) | `route.default_domain_resolver` + `domain_resolver` | ❌ 无 UI |
| global | `tcp_check_url` / `check_interval` / `check_tolerance` | `urltest` outbound 的 `url`/`interval`/`tolerance` | 🟡 仅配置编辑器 |
| global | `sniffing_timeout` | `route.rules` action `sniff` + inbound `sniff` | 🟡 规则编辑器可写 action=sniff |
| global | `mptcp` | `outbound.mptcp` | ❌ 无 UI |
| global | `auto_config_kernel_parameter` | 无直接对应（systemd sysctl） | ❌ 无 |
| global | `ipversion_prefer` | `route.rules` `ip_version` + `domain_strategy` | 🟡 |
| subscription | 订阅导入/标记/合并 | `outbounds` + 面板 `subscriptions.json` | ✅ URL 订阅完整；🟡 无节点手工合并 |
| node | vmess/vless/ss/trojan/tuic/hysteria2 | 同名 outbound 类型 | ✅ |
| node | ssr / juicity / http / socks4/4a/5 | `ssr` 已从 sing-box 移除；http/socks outbound 存在 | 🟡 解析器缺 http/socks |
| node | proxy chain | `outbound.detour` | ❌ |
| group | `filter`（name/subtag/keyword/regex/取反） | 无直接等价（`route.rules` + selector 组合） | ❌ |
| group | `policy`（random/fixed/min/min_avg10/min_moving_avg） | `selector` / `urltest` | ❌ 无组编辑 |
| routing | direct/must_direct/block/proxy | `direct` / `block` / selector 组 | ✅ 内核侧；🟡 无组管理 |
| routing | domain/sip/dip/sport/dport/ipversion/l4proto/pname/mac | `domain*` / `source_ip_cidr` / `ip_cidr` / `port` / `ip_version` / `network` / `process_name` / `source_mac_address` | 🟡 编辑器暴露 22 项，未含 `source_mac_address` |
| routing | suffix/keyword/regex/full | `domain_suffix`/`domain_keyword`/`domain_regex`/`domain` | ✅ |
| routing | `&& || !` 逻辑组合 | `route.rules` 嵌套 `rules[]`（本项目编辑器**明确不支持嵌套**） | ❌ |
| routing | geosite/geoip | `geosite`/`geoip` 或 `rule_set` | 🟡 可写、无在线更新 |
| routing | fallback | `final` + 规则顺序 | 🟡 仅配置编辑器 |
| dns | upstream(tcp/udp/https/tls/h3/quic) | `dns.servers[].type` | ❌ 无编辑 UI |
| dns | request routing(qname/qtype/sub/node) | `dns.rules` | ❌ |
| dns | response routing(ip/upstream) | `dns.rules` + `action` | ❌ |
| dns | fixed_domain_ttl / optimistic_cache | 同名配置项 | ❌ 仅配置编辑器 |

**判读**：dae 清单中"运行能力"多数在 sing-box 侧有等价物且内核已支持；本项目缺的是**结构化编辑层**（组/节点/DNS/逻辑组合），而非运行能力。这与阶段一结论一致：**差距在 UI 与装配，不在内核**。

---

## 附录 B · 证据索引（关键路径）

```
backend/cmd/sing-box-panel/main.go:36-117        启动与装配（P0-1 现场）
backend/internal/httpapi/server.go:49-53         Deps 可选依赖
backend/internal/httpapi/server.go:128-138       recoverMiddleware（500 兜底）
backend/internal/httpapi/server.go:294-308       模式侦测
backend/internal/httpapi/server.go:404-406       cpu_percent 条件写入
backend/internal/httpapi/server.go:489-491       服务控制先执行后记录
backend/internal/httpapi/server.go:541-545       NotifyConfigs 回退
backend/internal/httpapi/server.go:571-576       恢复备份
backend/internal/httpapi/server.go:840-895       history/notifications
backend/internal/httpapi/server.go:897-916       导入
backend/internal/notifications/notifications.go:56-111  nil 无守卫
backend/internal/history/history.go:186-218      Range（nil 解引用点）
backend/internal/history/sampler.go:50-83        NewSampler/Start/Stop
backend/internal/singbox/singbox.go:202-257      Apply 事务
backend/internal/singbox/singbox.go:243-245      restart=false 死分支
backend/internal/systemd/systemd.go:88-100       Control
backend/internal/systemd/systemd.go:114-160      WaitHealthy
backend/internal/subs/subs.go:440-574            Apply（组只重整成员）
backend/internal/subs/subs.go:675-696            Scheduler
backend/internal/ebpf/ebpf.go:121-160            SetPolicy
backend/internal/subs/parse.go:100-127           ParseLink 协议白名单
src/app/useRuntimeToggles.ts:29-209              TUN/LAN 开关
src/app/useHealthMonitor.ts:66-261               休眠的健康监控
src/app/groupPreferences.ts:34-44                自动测速开关（无 UI 写入口）
src/views/tools/RulesView.tsx:91-121             规则整文件重写
src/api/panel.ts:581-621                         normalizeConfigJson（剥注释）
src/views/dashboard/ObservabilityCards.tsx:310-331 CPU 卡
src/views/dashboard/useObservability.ts:39-225   历史/通知降级
backend/internal/httpapi/server_test.go:67-82    测试夹具（掩盖 P0）
```

---

## 12. 修复记录（P0，2026-11-01）

> 三步格式：**复现 → 修复 → 验证**。本轮未部署到生产（等你确认），生产验证步骤附在每项末尾。

### 12.1 P0-1 装配层：observability 接线 + nil 防御

- **复现**：`journalctl -u sing-box-panel` 6 条 nil pointer panic；沙箱 `GET /api/history`、`/api/notifications` 均 500；`POST /api/service` 动作执行成功却 500（桩日志可证）。
- **修复**：
  - 新增 `backend/internal/bootstrap/bootstrap.go`：`Build()` 统一装配，补齐 `Feed`/`History`/`Sampler`/`NotifyConfigs`，并让 `subs.ApplyFn`、eBPF 策略与手动编辑共用同一条"应用 + 记录事件"闭包。
  - `cmd/sing-box-panel/main.go` 改为 `run() int` + `bootstrap.Build`，`defer cleanup()` 不再被 `os.Exit` 跳过。
  - `notifications`/`history` 包所有方法加 nil 接收者守卫（再漏接线也只降级为空数据）。
  - `/api/state` 新增 `cpu_ready`，仅在真实采样后输出 `cpu_percent`。
- **验证**：新增 `internal/bootstrap/bootstrap_test.go`（`TestBuildWiresOptionalDeps` + 35 条路由矩阵 + 四接口成功断言）。反向验证：临时删除 `Feed` 接线 → 测试立即红；恢复 → 绿。沙箱实测：`/api/history` 200 且 `points` 数组存在，`/api/notifications` 200，`POST /api/service` 返回 `ok:true`，`history.jsonl` 1 分钟后生成并增长。
- **生产验证**：`journalctl -u sing-box-panel | grep -c 'nil pointer'` 应为 0；`ls -l /var/lib/sing-box-panel/history.jsonl` 应出现。

### 12.2 P0-4 装配级回归闸门

- **修复**：见 12.1 的 `bootstrap_test.go`；`TestAllRoutesNoServerError` 覆盖 35 条路由（含 4 个曾 500 的写接口与 multipart 导入），任意 5xx 即失败。
- **验证**：`go test ./internal/bootstrap/ -run 'Wires|AllRoutes|Regression' -v` 全绿；反向验证已执行。

### 12.3 P0-6 嵌套规则保护

- **复现**：生产 `route.rules[2]`（DNS 劫持）、`rules[7]`（广告拦截）为 `type:"logical"`；编辑器丢弃 `mode`/`rules`，产物被 `sing-box check` 拒绝（`missing conditions`）。
- **修复**：`ruleEditor.ts` 新增 `isNestedRule`；`RulesView.tsx` 对嵌套规则改用静态行 + 复用既有文案 key + "编辑配置"按钮（写 `panel_manage_tab=config` 后跳转）；`RuleEditorDialog.tsx` 的失真注释改为事实。
- **验证**：`ruleEditor.test.ts` 新增 4 例（logical / rules[] / 普通规则 / type 非 logical），全绿；`tsc`、ESLint 通过。手动验收：规则页 14 条中 2 条显示为不可编辑。

### 12.4 P0-3 CPU 卡三态

- **复现**：面板在线但卡片显示"直接模式下不可用"（`ObservabilityCards.tsx:319`）。
- **修复**：后端 `cpu_ready` + 前端三态（无面板 / 采样未就绪 / 有值）。
- **验证**：沙箱 dry-run `cpu_ready:false` 且无 `cpu_percent`；非 dry-run 实例 2 秒后 `cpu_ready:true`、`cpu_percent:14.07`。

### 12.5 P0-5 托管状态一致性

- **复现**：`managed.json` 缺失时重新订阅产生 `Test-SS-01 #2`；restore 后 `managed.json` 残留已不存在的 tag。
- **修复**：`subs.Apply` 的 `oldTags` 折叠 `by_subscription`；冲突时先做**同构去重**（除 tag 外完全一致则复用，不再克隆 `#N`）；新增 `ReconcileManaged`，`handleRestoreConfig` 在恢复成功后调用并返回 `pruned`。
- **验证**：新增 `TestApplyIsIdempotentWithoutManagedState`、`TestReconcileManagedPrunesStaleTags`；沙箱 restore 返回 `pruned:3`，`managed.json` 三个映射均清空 Ghost-Node。

### 12.6 P0-2 热重载优先

- **复现**：`Apply` 固定 `systemctl restart`；本机 SIGHUP 实测可零断流。
- **修复**：`systemd.ReloadSupported/Reload`；`Apply` 改为 reload-first（reload → 健康检查 → 失败自动 fallback restart → 再失败回滚）；新增 `apply_strategy`（默认 `reload-first`，`restart` 可强制旧行为）；`/api/state` 暴露 `apply_capability`。
- **验证**：`TestApplyPrefersReloadWhenSupported` / `TestApplyFallsBackToRestartWhenReloadFails` / `TestApplyRestartStrategySkipsReload` 全绿；沙箱实测 `systemctl show -p ExecReload` → `reload` → `is-active`，**无 restart 调用**，响应为"配置已热重载，连接未中断"。
- **生产验证**：灰度一次后确认 `MainPID` 不变、`journalctl` 出现 `sing-box started`。

### 12.7 P2-4 内网 IP 探测（顺手）

- **复现**：`/api/local-ip` 返回 `127.0.0.1`，而同机 `ip route get 8.8.8.8` 为 `192.168.31.30`。
- **修复**：`localip.go` 改为枚举网卡 + 默认路由接口优先 + 过滤回环/链路本地；前端 `isUsablePanelIp` 视回环为无效并回退 WebRTC。
- **验证**：新增 5 个 Go 用例 + 1 个前端用例；沙箱实测 `/api/state.local_ip` = `192.168.31.30`。

### 12.8 额外发现并修复（审计未覆盖）

- **`GET /api/apps` panic**：`.desktop` 解析用 `line[7:]` 取 `Icon=`（应为 5），遇到空 `Icon=` 行触发 `slice bounds out of range [7:5]`；且非空时会把 `firefox` 截成 `refox`。修复为 `line[len("Icon="):]`，新增 `internal/ebpf/ebpf_test.go` 两例（假 `/proc` 端到端）。沙箱实测该端点由 500 → 200（10 个 uid 条目）。

### 12.9 本轮测试增量

| 项 | 修复前 | 修复后 |
|---|---|---|
| 后端测试包 | 8 个包有测试 | + `bootstrap`、`ebpf`、`localip`（共 11 个包） |
| 前端用例 | 300 | 307 |
| 装配层测试 | 0 | 37 个断言组（依赖 + 路由矩阵 + 回归四接口） |

### 12.10 额外发现并修复：流量历史恒为 0（部署后发现）

- **复现**：部署后 `/api/history` 有数据点，但 `up/down` 始终为 0，前端流量图空、峰值/均值为 0；同机 `GET /traffic` 实测为 chunked 长连接，立即推送 `{"up":614,"down":5489}` 但**永不关闭**。
- **根因**：`history/sampler.go` 的 `clashGet` 对 `/traffic` 使用 `io.ReadAll`，连接不结束 → 5s 客户端超时 → 整段数据被丢弃（`sampler.go:181-194`）。
- **修复**：新增 `clashDecode`，用 `json.Decoder` 只解码第一个 JSON 值，适用于流式端点；`pollTraffic` 改用它。`/connections` 仍走整段读取。
- **验证**：新增 `internal/history/sampler_test.go`（不结束的流式 handler，断言 1s 内返回且数值正确；旧实现会阻塞到超时并失败）。用真实 Clash API 起沙箱探针实例，1 分钟后采到 `up=4553 down=27484 cpu=5.1`，`out` 含 2 个出站 tag。
- **生产验证**：重启面板 2 分钟后，`/api/history?range=10m` 的 `points[].up/down` 非 0，前端"流量"卡片出现曲线与峰值/均值。

### 12.11 部署路径陷阱（本次遇到）

- 本机 systemd 单元使用 `/usr/bin/sing-box-panel`（`/usr/lib/systemd/system/sing-box-panel.service` + drop-in），而仓库 `deploy/install.sh` 写入的是 `/usr/local/bin/sing-box-panel`。
- 首次部署按 `install.sh` 路径安装后，`systemctl restart` 成功但跑的是旧二进制（MainPID 变化掩盖了问题）。
- **规避命令**：`sudo install -m755 <build>/sing-box-panel /usr/bin/sing-box-panel && sudo systemctl restart sing-box-panel`；核对方式：`md5sum /usr/bin/sing-box-panel` 与构建产物一致。
- 建议后续在 `install.sh` 启动时读取 `systemctl show -p ExecStart` 并据此决定安装路径（P2）。

### 12.12 额外发现并修复：出站占比恒为 0（浏览器实测发现）

- **复现**：仪表盘"流量"卡片已有曲线，但"出站下载量"环形图为 `0 B / 暂无数据`。
- **根因（两处）**：
  1. `clashConnection` 期望 `uploadTotal/downloadTotal`，而 sing-box 的连接对象字段是 `download/upload`（`{"download":39005,"upload":64836,...}`）→ 计数恒 0。
  2. `exitTag` 取 `chains[len-1]`，但 Clash 的 `chains` 是**出口在前**（`["🇯🇵 日本Z01 | IEPL","Auto","Proxy"]`）→ 即使有计数也会归因到 `Proxy` 选择器而非真实节点。
  3. 附带：`jsonx` 编码缺少 `uint64` 分支，`up/down/summary` 被输出成字符串（前端类型标注为 number）。
- **修复**：字段改为 `download/upload`；`exitTag` 取 `chains[0]`；`jsonx` 增加 `uint64` 数字编码。
- **验证**：新增 `TestPollConnectionsUsesExitNodeAndDownloadCounter`（断言归因到 Node-A 而非 Proxy、增量正确）与 `TestDumpEncodesUint64AsNumber`。真实 Clash API 探针实测：`out={'🇭🇰 香港Z04 | IEPL': 2763610, 'direct': 4628, ...}`，`up/down` 为 int。
- **前端效果**：环形图将按真实节点展示占比，不再显示"暂无数据"。
