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

## DNS statistics (api_version 9)

Three endpoints back the four-tab DNS page. All are read-only and answer `200`
even when the subsystem cannot produce data, with an explanatory `note`.

### `GET /api/dns`

```json
{
  "ok": true,
  "config_path": "/etc/sing-box/config.json",
  "servers": [{ "type": "https", "tag": "dns_proxy", "server": "8.8.8.8", "path": "/dns-query" }],
  "rules": [{ "domain_suffix": ["google.com"], "server": "dns_proxy" }],
  "final": "",
  "cache_enabled": true,
  "cache": { "capacity": 4096 },
  "cache_file": { "enabled": true, "path": "/var/lib/sing-box/cache.db", "size": 48512, "mtime": 1793600000 },
  "log_level": "debug",
  "debug_logging": true
}
```

`cache_file` mirrors `experimental.cache_file` plus the file's on-disk size and
mtime. `debug_logging` tells the UI whether per-query records can exist at all.

### `GET /api/dns/queries?minutes=60&limit=500`

```json
{
  "ok": true,
  "entries": [
    { "at": 1793600000000, "domain": "www.google.com", "type": "A",
      "client": "192.168.31.30:51234", "upstream": "tls://1.1.1.1",
      "status": "ok", "elapsed_ms": 27 }
  ],
  "note": "",
  "source": "journalctl -u sing-box"
}
```

Records are parsed from the sing-box journal and only exist at
`log.level=debug`. Missing fields stay empty rather than being guessed. When
the list is empty the `note` explains why (dry-run, info level, no journalctl).

### `GET /api/dns/probe[?force=1]`

```json
{
  "ok": true,
  "servers": [
    { "tag": "dns_proxy", "type": "https", "server": "8.8.8.8:443", "ok": true, "elapsed_ms": 21 },
    { "tag": "dns_tls", "type": "tls", "server": "1.1.1.1:853", "ok": false, "elapsed_ms": 2002, "error": "i/o timeout" }
  ]
}
```

Each `dns.servers[]` entry is queried with a real DNS packet (UDP, TCP, TLS or
DoH) and timed; results are cached for 30 s unless `force=1`. `hosts`/`local`
entries are skipped — they never touch the network.

**Honest limits** (surfaced in the UI, not faked):

- sing-box exposes no cache-entry list or hit counter; the page labels its
  cache-hit ratio as an estimate and states that entries are unavailable.
- Failures/queries only exist at debug log level; the page offers a switch that
  rewrites `log.level` through the standard config transaction.

`GET /api/state.features` includes `dns.stats` from api_version 9.

## Traffic capture mode (api_version 10)

`GET /api/state` gained a `capture` block so the UI no longer has to guess the
capture mode from inbound *types* — a guess that showed "virtual NIC: disabled"
on machines where the reF1nd eBPF fork captures every packet through a kernel
`ebpf` inbound.

```json
"capture": {
  "mode": "ebpf",
  "inbounds": ["mixed", "ebpf"],
  "tun": false,
  "proxy_ports": [7892],
  "ebpf": {
    "ok": true, "present": true, "mode": "off",
    "uids": [], "include": [], "exclude": [],
    "data_plane": "cgroup", "dns_mode": "hijack", "ipv6": true,
    "shared": {
      "enabled": true, "data_plane": "packet_rewrite",
      "interface": ["virbr0"], "dns_mode": "hijack",
      "bypass_private_address": true, "ipv6": true
    }
  }
}
```

- `mode` — the classified mode, same precedence as the UI always used: `ebpf`
  → `tun` → `mixed` (port-based) → `proxy`; `none` when the config has no
  inbounds at all, `unknown` when the config could not be read.
- `tun` — whether a `tun` inbound exists. Independent of `mode`, because the
  fork supports both at once (eBPF still wins).
- `proxy_ports` — listen ports of `mixed`/`http`/`socks`/`redirect`/`tproxy`
  inbounds, i.e. what a client may point at.
- `ebpf` — omitted entirely when no `ebpf` inbound exists. `mode` is the policy
  selector (`off` / `whitelist` / `blacklist`), `uids` the selected app UIDs,
  `shared` mirrors the fork's `local.shared` block (VMs behind a bridge).

`mode` and `inbounds` at the top level are unchanged, so older UIs keep
working; a UI that finds no `capture` block must fall back to classifying
`inbounds` itself.
