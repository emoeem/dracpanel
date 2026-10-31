# Optional panel API contract for FlClash parity

**Implementation status:** the Go backend (`backend/`, sing-box-panel 0.2.0)
implements every endpoint and optional `/api/state` field listed below.
The legacy Python backend (0.1.0) implements none of them; the UI probes or
degrades accordingly.

The rebuilt FlClash-style UI drives every switch through the existing panel
endpoints when possible (`/api/config` read/validate/apply already powers the
TUN and LAN toggles). The endpoints below are **optional**: the UI probes them
and degrades honestly (disabled control + explanation) when the panel does not
implement them. Nothing is faked.

## `GET /api/system-proxy`

```json
{ "enabled": false, "port": 7890 }
```

- `enabled` — whether the host OS proxy (HTTP/HTTPS/SOCKS) is currently set.
- `port` — optional; shown as `端口 {port}` when present.

## `POST /api/system-proxy`

```json
{ "enabled": true }
```

Response: `{ "ok": true }` or `{ "ok": false, "message": "…" }`.

Semantics: the panel sets/clears the desktop environment's proxy settings
(GNOME/gsettings, KDE, or `http_proxy` for the session — implementation is up
to the panel). Returning 404/405/501 makes the UI disable the 系统代理 switch
with the hint `需要面板后端接口`.

## `GET /api/local-ip`

```json
{ "ip": "192.168.31.30" }
```

Optional primary source for the 内网 IP card. When absent the UI falls back to
a WebRTC host-candidate probe and finally to `无网络`.

## `GET /api/memory`

```json
{ "app": 325058560, "kernel": 101711872, "total": 426770432 }
```

Optional split for the 内存信息 card. When absent the UI shows the native API's
total RSS only (single-segment bar, `总计` legend) — it never invents the
app/kernel split.

## `POST /api/profiles/import` (multipart/form-data)

Field `file` — a YAML/JSON profile (e.g. a subscription export).

Response: `{ "ok": true }` or `{ "ok": false, "message": "…" }`.

Enables the 配置 → 添加配置 → 文件 action. 404/405/501 disables the entry with
a hint instead of pretending it worked.

## Fields already honoured in `GET /api/state` (all optional)

| Field | Used by |
|---|---|
| `egress_ip` | 状态 card exit IP |
| `local_ip` | 内网 IP card |
| `ip_type` | 状态 card `类型` chip (住宅/移动网络/商业/机房) |
| `ip_quality` | 状态 card `质量` chip |
| `memory_app` / `memory_kernel` | 内存信息 split |
| `inbounds` | 虚拟网卡 state (TUN presence) |
| `config_path` / `config_mtime` | 配置 card fallback name/update time |

## Error semantics

- Unknown route: panel may answer 404 with its usual "未知接口/Unknown endpoint"
  message; the UI treats 404/405/501 as "feature not implemented".
- Auth failures keep the existing `X-Panel-Token` + `panel-auth-error` flow.
- Mutating endpoints must be idempotent and validate before applying, matching
  the existing `/api/config` behaviour (auto backup + rollback on failure).
