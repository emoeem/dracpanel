# 安全策略

## 本文件的范围

只覆盖**本仓库**：DracPanel 的前端源码、构建产物和 `deploy/` 脚本。

不在这里处理的问题：

- `sing-box` 本体、原生 API（9091）本身的问题 → 报给
  [SagerNet/sing-box](https://github.com/SagerNet/sing-box)；
- `sing-box-panel`（9096 的服务端、以 root 写配置/重启服务）的问题 → 报给它
  自己的维护者；本仓库只有它的 HTTP 客户端（`src/api/panel.ts`）；
- 上游 dashboard 的既有行为 → 报给
  [SagerNet/sing-box-dashboard](https://github.com/SagerNet/sing-box-dashboard)。

## 威胁模型（诚实版）

- **UI 只在本机**。入口是 `http://127.0.0.1:9096`（或 `localhost:9096`），
  由本机 `sing-box-panel` 的 `ui_dir` 提供静态产物；原生 API 地址写死为
  `127.0.0.1:9091`，CORS 白名单只有 9096/localhost:9096。**从局域网 IP、
  反向代理或 HTTPS 打开不受支持**：原生连接会失败，这是设计约束而不是待配置
  项。把自己暴露到局域网等于把核心控制权交出去，属于配置错误，本仓库不打算
  “修好”它。
- **凭据存在浏览器 localStorage**。panel token 存在 `localStorage`
  （`src/api/panel.ts` 的 `PANEL_TOKEN_KEY`），原生 API secret 与端口缓存在
  `panel-api-cache` 与托管服务器条目里。构建产物本身不含任何 token/secret。
- **“锁定面板”不是安全边界**。它清 token、清缓存、清托管服务器条目并让其他
  标签页回到登录页，防的是误操作和他人顺手使用当前浏览器。**它防不住本机同
  用户进程、恶意浏览器扩展，也防不住 XSS。** 需要隔离就用独立的桌面用户或
  浏览器 profile。
- **GeoIP 不出本机**。地图只走本机 panel 的 `GET /api/geoip`，浏览器不会向
  第三方发地理查询；`egress_ip_probe_url` 默认空，启用后也只是一次不带连接
  信息的 GET。
- **panel 以 root 运行**，能改配置和重启服务。这意味着拿到 panel token 就等
  于拿到核心控制权 —— token 的可读性（`/var/lib/sing-box-panel/token` 的权
  限）由服务端包负责。
- **下载的配置备份是敏感文件**：含 `services.api` secret、Clash secret 和
  出站密码。
- 配置文件权限：panel 写配置时是 0644，本仓库的
  `sing-box-config-perm.path` 只是兜底复核；真正的修复在服务端包里。

已知不在防护范围内的东西，我们不会假装它能防护：**XSS、恶意扩展、同用户本
机进程、把 9096 暴露给非本机**。

## 报告漏洞

优先用 GitHub 的**私有漏洞报告**（不要开公开 issue 讨论可利用细节）：

- <https://github.com/emoeem/dracpanel/security/advisories>

如果该入口不可用，就在仓库开 issue，但**不要**贴真实 token、secret、配置
全文、真实节点/订阅地址；用占位符复现即可。

报告里尽量给：

1. 影响的版本/commit（`git rev-parse HEAD`）与浏览器；
2. 复现步骤（从 `deploy/install.sh` 之后的哪个状态开始）；
3. 你认为的影响（例如“非本机可访问 9096”、“token 被第三方脚本读到”）；
4. 如果涉及 XSS/注入，说明是否需要已登录状态。

## 响应时间

这是一个个人维护的非官方项目，**没有 SLA，也不承诺修复时限**。目标是几天内
给出首次回复（确认收到或要求补充信息）；确认为真的问题会修在 `main` 上，
需要用户**重新构建并重新部署**（`sudo ./deploy/install.sh --ui-only`）——
我们不为历史 `dist` 快照单独发补丁。

严重且容易利用的问题如果迟迟没有回复，可以在 issue 里礼貌地催一次；请不要
在未修复前公开细节。

## 相关文档

- [README.md](README.md#安全) —— 用户视角的安全说明与限制
- [DEPLOYMENT.md](DEPLOYMENT.md#threat-model) —— 部署侧的威胁模型
- [CONTRIBUTING.md](CONTRIBUTING.md) —— 提交与测试约定
