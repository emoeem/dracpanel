#!/bin/bash
# Deploy Dracula Panel for sing-box on top of the local sing-box-panel setup.
#
# - backs up /etc/sing-box/config.json
# - adds/updates services[type=api] on 127.0.0.1:9091, keeps an existing
#   secret (use --rotate-secret to replace it), 9096-only CORS whitelist,
#   dashboard disabled
# - installs the build into /usr/local/share/sing-box-panel-ui
# - installs a systemd path unit enforcing config mode 600 with a stat %a check
# - restarts both services with health checks and automatic rollback
# - optionally installs the DB-IP City Lite mmdb for /api/geoip
#
# Use --ui-only to update just the UI (no config rewrite, no sing-box restart).
# Run once with sudo/pkexec. Does not touch /usr/bin or package files; the
# GeoIP database is data under /usr/share/GeoIP.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "需要 root 权限" >&2
  exit 1
fi

usage() {
  cat <<'EOF'
用法: sudo ./deploy/install.sh [--ui-only] [--rotate-secret] [--refresh-geoip]

  --ui-only        只替换 UI，不改配置、不重启 sing-box
  --rotate-secret  为 services.api 生成新的 secret（默认保留已有 secret）
  --refresh-geoip  重新下载 DB-IP City Lite 数据库
  -h, --help       显示本帮助
EOF
}

ROTATE_SECRET=0
UI_ONLY=0
REFRESH_GEOIP=0
for arg in "$@"; do
  case "$arg" in
    --ui-only) UI_ONLY=1 ;;
    --rotate-secret) ROTATE_SECRET=1 ;;
    --refresh-geoip) REFRESH_GEOIP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$arg" >&2; usage >&2; exit 2 ;;
  esac
done
if [ "$UI_ONLY" -eq 1 ] && [ "$ROTATE_SECRET" -eq 1 ]; then
  echo "--ui-only 不能与 --rotate-secret 同时使用" >&2
  exit 2
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DIST="$ROOT/dist"
CFG=/etc/sing-box/config.json
PANEL_CFG=/etc/sing-box-panel/panel.json
PANEL_DROPIN=/etc/systemd/system/sing-box-panel.service.d/10-config-path.conf
DST=/usr/local/share/sing-box-panel-ui
PERM_SCRIPT=/usr/local/bin/sing-box-config-perm
PERM_SERVICE=/etc/systemd/system/sing-box-config-perm.service
PERM_PATH=/etc/systemd/system/sing-box-config-perm.path
TS=$(date +%Y%m%d-%H%M%S)
BACKUP=/etc/sing-box/backups/config.json.bak.$TS-dracula
NEWCFG=$(mktemp /tmp/dracula-panel-config.XXXXXX.json)
chmod 600 "$NEWCFG"
UI_BACKUP="$DST.legacy-$TS"
UI_STAGE="$DST.new-$TS"
PANEL_CFG_BAK="$PANEL_CFG.bak.$TS-dracula"
PANEL_DROPIN_BAK="$PANEL_DROPIN.bak.$TS-dracula"
PANEL_JSON=/etc/sing-box/panel.json
PANEL_JSON_BAK=/etc/sing-box/backups/panel.json.bak.$TS-dracula
PERM_SCRIPT_BAK="$PERM_SCRIPT.bak.$TS-dracula"
PERM_SERVICE_BAK="$PERM_SERVICE.bak.$TS-dracula"
PERM_PATH_BAK="$PERM_PATH.bak.$TS-dracula"
GEOIP_DIR=/usr/share/GeoIP
GEOIP_DB="$GEOIP_DIR/dbip-city-lite.mmdb"
GEOIP_URL="https://cdn.jsdelivr.net/npm/dbip-city-lite@1.0.18/dbip-city-lite.mmdb.gz"
GEOIP_GZ_SHA256=c839d407f85a1e0bddba354cef16b2c398182d1c34ed8d985555dce134b36b14
GEOIP_MMDB_SHA256=9e250f02722d1ad1780f88192f0e908af285478a33e76b88b349c9181ae9d0f5

CONFIG_CHANGED=0
UI_MOVED=0
UI_INSTALLED=0
PANEL_CONFIG_CHANGED=0
PANEL_CONFIG_EXISTED=0
DROPIN_CHANGED=0
DROPIN_EXISTED=0
PANEL_JSON_MOVED=0
PERM_CHANGED=0
PERM_SCRIPT_EXISTED=0
PERM_SERVICE_EXISTED=0
PERM_PATH_EXISTED=0
PERM_WAS_ENABLED=0
SECRET_STATE=preserved
OK=0

rollback() {
  echo "↩ 回滚中…" >&2
  # Rollback is best-effort: one failed restore must not stop the rest.
  set +e

  rm -f "$CFG.permtest"

  if [ "$CONFIG_CHANGED" -eq 1 ] && [ -f "$BACKUP" ]; then
    cp -a "$BACKUP" "$CFG"
    chmod 600 "$CFG"
  fi

  if [ "$PANEL_JSON_MOVED" -eq 1 ] && [ -f "$PANEL_JSON_BAK" ]; then
    mv -f "$PANEL_JSON_BAK" "$PANEL_JSON"
  fi

  if [ "$PANEL_CONFIG_CHANGED" -eq 1 ]; then
    if [ "$PANEL_CONFIG_EXISTED" -eq 1 ] && [ -f "$PANEL_CFG_BAK" ]; then
      cp -a "$PANEL_CFG_BAK" "$PANEL_CFG"
    else
      rm -f "$PANEL_CFG"
    fi
  fi

  if [ "$DROPIN_CHANGED" -eq 1 ]; then
    if [ "$DROPIN_EXISTED" -eq 1 ] && [ -f "$PANEL_DROPIN_BAK" ]; then
      cp -a "$PANEL_DROPIN_BAK" "$PANEL_DROPIN"
    else
      rm -f "$PANEL_DROPIN"
    fi
  fi

  if [ "$PERM_CHANGED" -eq 1 ]; then
    systemctl disable --now sing-box-config-perm.path >/dev/null 2>&1
    if [ "$PERM_SCRIPT_EXISTED" -eq 1 ] && [ -f "$PERM_SCRIPT_BAK" ]; then
      cp -a "$PERM_SCRIPT_BAK" "$PERM_SCRIPT"
    else
      rm -f "$PERM_SCRIPT"
    fi
    if [ "$PERM_SERVICE_EXISTED" -eq 1 ] && [ -f "$PERM_SERVICE_BAK" ]; then
      cp -a "$PERM_SERVICE_BAK" "$PERM_SERVICE"
    else
      rm -f "$PERM_SERVICE"
    fi
    if [ "$PERM_PATH_EXISTED" -eq 1 ] && [ -f "$PERM_PATH_BAK" ]; then
      cp -a "$PERM_PATH_BAK" "$PERM_PATH"
    else
      rm -f "$PERM_PATH"
    fi
    systemctl daemon-reload >/dev/null 2>&1
    if [ "$PERM_WAS_ENABLED" -eq 1 ] && [ -f "$PERM_PATH" ]; then
      systemctl enable --now sing-box-config-perm.path >/dev/null 2>&1
    fi
  fi

  if [ "$UI_MOVED" -eq 1 ] || [ "$UI_INSTALLED" -eq 1 ]; then
    rm -rf "$DST" "$UI_STAGE"
    if [ -d "$UI_BACKUP" ]; then
      mv "$UI_BACKUP" "$DST"
    fi
  else
    rm -rf "$UI_STAGE"
  fi

  if [ "$DROPIN_CHANGED" -eq 1 ] || [ "$PERM_CHANGED" -eq 1 ]; then
    systemctl daemon-reload >/dev/null 2>&1
  fi
  if [ "$PANEL_CONFIG_CHANGED" -eq 1 ] || [ "$DROPIN_CHANGED" -eq 1 ] || [ "$PERM_CHANGED" -eq 1 ] || [ "$UI_INSTALLED" -eq 1 ]; then
    systemctl restart sing-box-panel >/dev/null 2>&1
  fi
  if [ "$CONFIG_CHANGED" -eq 1 ]; then
    systemctl restart sing-box >/dev/null 2>&1
  fi

  rm -f "$NEWCFG"
  rm -rf "$UI_STAGE"
  set -e
}

trap 'if [ "$OK" -ne 1 ]; then rollback; fi' EXIT

fail() {
  echo "✗ $*" >&2
  exit 1
}

wait_active() {
  local unit=$1
  local attempts=$2
  local attempt
  for ((attempt = 0; attempt < attempts; attempt += 1)); do
    if systemctl is-active --quiet "$unit"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

[ -f "$DIST/index.html" ] || fail "找不到构建产物 $DIST/index.html，请先构建"
[ -f "$CFG" ] || fail "找不到 $CFG"
command -v python3 >/dev/null || fail "缺少 python3"
command -v curl >/dev/null || fail "缺少 curl"
command -v sing-box >/dev/null || fail "缺少 sing-box"
[ -x /usr/bin/sing-box-panel ] || fail "找不到 /usr/bin/sing-box-panel（本脚本按已验证的包布局假定该路径）"
systemctl cat sing-box.service >/dev/null 2>&1 || fail "找不到 sing-box.service"
systemctl cat sing-box-panel.service >/dev/null 2>&1 || fail "找不到 sing-box-panel.service"

if [ "$UI_ONLY" -eq 0 ]; then
echo "== [1/9] 备份 sing-box 配置"
mkdir -p /etc/sing-box/backups
cp -a "$CFG" "$BACKUP"
chmod 600 "$BACKUP"
echo "  备份：$BACKUP"

echo "== [2/9] 写入 services.api（9091，仅 9096 可跨域）"
# The config may legally contain //, /* */, and trailing commas. Normalize
# those before json.load; full JSON5 (unquoted keys/single quotes) is not
# accepted by sing-box and is rejected with a clear error.
SECRET_STATE=$(python3 - "$CFG" "$NEWCFG" "$ROTATE_SECRET" <<'PY'
import json
import secrets
import sys

src, dst, rotate_arg = sys.argv[1], sys.argv[2], sys.argv[3]
rotate = rotate_arg == "1"


def strip_json5(text):
    # Remove comments outside strings, then trailing commas before } or ].
    without_comments = []
    in_string = False
    escaped = False
    index = 0
    while index < len(text):
        char = text[index]
        if in_string:
            without_comments.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            without_comments.append(char)
            index += 1
            continue
        if char == "/" and index + 1 < len(text) and text[index + 1] == "/":
            index += 2
            while index < len(text) and text[index] not in "\r\n":
                index += 1
            continue
        if char == "/" and index + 1 < len(text) and text[index + 1] == "*":
            index += 2
            while index + 1 < len(text) and not (text[index] == "*" and text[index + 1] == "/"):
                index += 1
            index += 2
            continue
        without_comments.append(char)
        index += 1

    stripped = "".join(without_comments)
    normalized = []
    in_string = False
    escaped = False
    index = 0
    while index < len(stripped):
        char = stripped[index]
        if in_string:
            normalized.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            normalized.append(char)
            index += 1
            continue
        if char == ",":
            next_index = index + 1
            while next_index < len(stripped) and stripped[next_index] in " \t\r\n":
                next_index += 1
            if next_index < len(stripped) and stripped[next_index] in "}]":
                index += 1
                continue
        normalized.append(char)
        index += 1
    return "".join(normalized)


try:
    with open(src, encoding="utf-8-sig") as handle:
        raw = handle.read()
    cfg = json.loads(strip_json5(raw))
    if not isinstance(cfg, dict):
        raise ValueError("顶层必须是 JSON 对象")
except (OSError, ValueError, json.JSONDecodeError) as error:
    print(f"✗ 无法解析 {src}：{error}", file=sys.stderr)
    print("  安装器支持标准 JSON 以及 sing-box 接受的注释和 trailing comma；", file=sys.stderr)
    print("  请先修正配置中的其他 JSON5 语法（例如单引号或无引号键）。", file=sys.stderr)
    sys.exit(1)

services = cfg.get("services")
if not isinstance(services, list):
    services = []

api = None
for service in services:
    if isinstance(service, dict) and service.get("type") == "api":
        api = service
        break
if api is None:
    api = {"type": "api"}
    services.append(api)

state = "preserved"
existing_secret = api.get("secret")
if rotate or not isinstance(existing_secret, str) or existing_secret == "":
    api["secret"] = secrets.token_urlsafe(32)
    state = "rotated"

api["type"] = "api"
api["listen"] = "127.0.0.1"
api["listen_port"] = 9091
api["access_control_allow_origin"] = [
    "http://127.0.0.1:9096",
    "http://localhost:9096",
]
api["access_control_allow_private_network"] = True
api["dashboard"] = {"enabled": False}
cfg["services"] = services

with open(dst, "w", encoding="utf-8") as handle:
    json.dump(cfg, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
print(state)
PY
)
chmod 600 "$NEWCFG"
sing-box check -c "$NEWCFG"
CONFIG_CHANGED=1
install -m 600 -o root -g root "$NEWCFG" "$CFG"

# sing-box runs with -C /etc/sing-box: no other .json may live there. Keep the
# old file as a backup instead of deleting it; rollback moves it back.
if [ -f "$PANEL_JSON" ]; then
  PANEL_JSON_MOVED=1
  mv "$PANEL_JSON" "$PANEL_JSON_BAK"
  echo "  已将 $PANEL_JSON 移至 $PANEL_JSON_BAK（避免 -C 读取额外配置）"
fi
sing-box check -C /etc/sing-box
case "$SECRET_STATE" in
  rotated) SECRET_LABEL="已轮换" ;;
  preserved) SECRET_LABEL="已保留" ;;
  *) SECRET_LABEL="未知" ;;
esac
echo "  配置已更新（secret $SECRET_LABEL；注释不会保留，原文件已备份）"

echo "== [3/9] 确认面板配置与 systemd drop-in"
mkdir -p /etc/sing-box-panel
if [ -f "$PANEL_CFG" ]; then
  PANEL_CONFIG_EXISTED=1
  cp -a "$PANEL_CFG" "$PANEL_CFG_BAK"
fi
PANEL_CONFIG_CHANGED=1
python3 - "$PANEL_CFG" <<'PY'
import json
import os
import sys

path = sys.argv[1]
data = {}
if os.path.exists(path):
    try:
        with open(path, encoding="utf-8-sig") as handle:
            data = json.load(handle)
    except ValueError as error:
        print(f"✗ {path} 不是有效 JSON：{error}", file=sys.stderr)
        print("  请先修复或删除该文件；安装器不会覆盖无法解析的面板配置。", file=sys.stderr)
        sys.exit(1)
data["ui_dir"] = "/usr/local/share/sing-box-panel-ui"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
chmod 644 "$PANEL_CFG"

mkdir -p "$(dirname "$PANEL_DROPIN")"
if [ -f "$PANEL_DROPIN" ]; then
  DROPIN_EXISTED=1
  cp -a "$PANEL_DROPIN" "$PANEL_DROPIN_BAK"
fi
DROPIN_CHANGED=1
cat > "$PANEL_DROPIN" <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/sing-box-panel --config /etc/sing-box-panel/panel.json
EOF
chmod 644 "$PANEL_DROPIN"
systemctl daemon-reload
echo "  面板配置：$PANEL_CFG"

echo "== [4/9] 安装配置权限守护（chmod 600 + stat %a 复核）"
if [ -f "$PERM_SCRIPT" ]; then
  PERM_SCRIPT_EXISTED=1
  cp -a "$PERM_SCRIPT" "$PERM_SCRIPT_BAK"
fi
if [ -f "$PERM_SERVICE" ]; then
  PERM_SERVICE_EXISTED=1
  cp -a "$PERM_SERVICE" "$PERM_SERVICE_BAK"
fi
if [ -f "$PERM_PATH" ]; then
  PERM_PATH_EXISTED=1
  cp -a "$PERM_PATH" "$PERM_PATH_BAK"
fi
if systemctl is-enabled --quiet sing-box-config-perm.path 2>/dev/null; then
  PERM_WAS_ENABLED=1
fi
PERM_CHANGED=1

cat > "$PERM_SCRIPT" <<'EOF'
#!/bin/bash
set -euo pipefail
file=/etc/sing-box/config.json
chmod 600 "$file"
mode=$(stat -c '%a' "$file")
if [ "$mode" != "600" ]; then
  echo "sing-box config mode is $mode, expected 600" >&2
  exit 1
fi
EOF
chmod 755 "$PERM_SCRIPT"

cat > "$PERM_SERVICE" <<'EOF'
[Unit]
Description=Enforce sing-box config file permissions
After=sing-box.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/sing-box-config-perm
EOF

cat > "$PERM_PATH" <<'EOF'
[Unit]
Description=Watch sing-box config file permissions

[Path]
PathChanged=/etc/sing-box/config.json
Unit=sing-box-config-perm.service

[Install]
WantedBy=paths.target
EOF

chmod 644 "$PERM_SERVICE" "$PERM_PATH"
systemctl daemon-reload
systemctl enable --now sing-box-config-perm.path >/dev/null
systemctl start sing-box-config-perm.service
echo "  path unit 已启用"
else
  echo "== [1-4/9] 跳过配置与权限守护（--ui-only）"
fi

echo "== [5/9] 安装 UI（旧目录备份为 $(basename "$UI_BACKUP")）"
if [ -d "$DST" ]; then
  if [ -e "$UI_BACKUP" ]; then
    fail "UI 备份目录已存在：$UI_BACKUP（请稍后重试）"
  fi
  mv "$DST" "$UI_BACKUP"
  UI_MOVED=1
fi
rm -rf "$UI_STAGE"
install -d -m 755 "$UI_STAGE"
cp -a "$DIST/." "$UI_STAGE/"
install -m 644 "$ROOT/DEPLOYMENT.md" "$UI_STAGE/README.md"
install -m 644 "$ROOT/DEPLOYMENT.md" "$UI_STAGE/DEPLOYMENT.md"
install -m 644 "$ROOT/NOTICE" "$UI_STAGE/NOTICE"
install -m 644 "$ROOT/LICENSE" "$UI_STAGE/LICENSE"
chmod -R a+rX "$UI_STAGE"
mv "$UI_STAGE" "$DST"
UI_INSTALLED=1
echo "  UI 文件：$(find "$DST" -type f | wc -l) 个"

echo "== [6/9] 安装 GeoIP 城市库（DB-IP City Lite）"
if [ "$UI_ONLY" -eq 1 ]; then
  echo "  跳过（--ui-only）"
elif [ -s "$GEOIP_DB" ] && [ "$REFRESH_GEOIP" -eq 0 ]; then
  echo "  已存在：$GEOIP_DB（--refresh-geoip 可更新）"
elif ! command -v gzip >/dev/null || ! command -v sha256sum >/dev/null; then
  echo "⚠ 缺少 gzip/sha256sum，跳过 GeoIP 安装（/api/geoip 将返回 503）" >&2
else
  GEOIP_GZ_TMP="$GEOIP_DIR/.dbip-city-lite.mmdb.gz.$$"
  GEOIP_MMDB_TMP="$GEOIP_DIR/.dbip-city-lite.mmdb.$$"
  geoip_ok=0
  if mkdir -p "$GEOIP_DIR" &&
    curl -fsSL --http1.1 --retry 3 --retry-delay 2 --max-time 600 -o "$GEOIP_GZ_TMP" "$GEOIP_URL"; then
    if echo "$GEOIP_GZ_SHA256  $GEOIP_GZ_TMP" | sha256sum -c --quiet -; then
      if gzip -dc "$GEOIP_GZ_TMP" > "$GEOIP_MMDB_TMP" &&
        echo "$GEOIP_MMDB_SHA256  $GEOIP_MMDB_TMP" | sha256sum -c --quiet -; then
        if chmod 644 "$GEOIP_MMDB_TMP" && mv "$GEOIP_MMDB_TMP" "$GEOIP_DB"; then
          geoip_ok=1
        fi
      fi
    fi
  fi
  rm -f "$GEOIP_GZ_TMP" "$GEOIP_MMDB_TMP"
  if [ "$geoip_ok" -eq 1 ]; then
    echo "  ✓ 已安装：$GEOIP_DB"
  else
    echo "⚠ GeoIP 下载/校验失败，已跳过；/api/geoip 将返回 503，UI 会显示提示" >&2
  fi
fi

echo "== [7/9] 重启服务"
if [ "$UI_ONLY" -eq 0 ]; then
  systemctl restart sing-box
  wait_active sing-box 30 || fail "sing-box 30 秒内未进入 active"
else
  echo "  跳过 sing-box 重启（--ui-only）"
fi
systemctl restart sing-box-panel
wait_active sing-box-panel 15 || fail "sing-box-panel 15 秒内未进入 active"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 2 http://127.0.0.1:9096/api/ping >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
curl -fsS --max-time 5 http://127.0.0.1:9096/api/ping >/dev/null || fail "面板 API 无响应"
if [ "$UI_ONLY" -eq 0 ]; then
  echo "  sing-box / sing-box-panel 均 active"
else
  echo "  sing-box-panel 已 active（sing-box 未改动）"
fi

echo "== [8/9] 验收检查"
if curl -fsS --max-time 5 http://127.0.0.1:9096/ | grep -q 'Dracula Panel'; then
  echo "  ✓ 9096 返回 Dracula Panel"
else
  fail "9096 未返回 Dracula Panel"
fi

if curl -fsS --max-time 5 http://127.0.0.1:9096/api/ping >/dev/null; then
  echo "  ✓ 面板 API 正常"
fi

if [ "$UI_ONLY" -eq 0 ]; then
  DASH_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:9091/dashboard/ || true)
  if [ "$DASH_CODE" = "200" ]; then
    fail "9091 /dashboard/ 仍可访问"
  else
    echo "  ✓ 9091 dashboard 已关闭（HTTP $DASH_CODE）"
  fi

  ALLOWED=$(curl -s -D- -o /dev/null --max-time 5 -X OPTIONS \
    -H 'Origin: http://127.0.0.1:9096' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: authorization,content-type' \
    http://127.0.0.1:9091/daemon.StartedService/GetVersion | tr -d '\r' | grep -i '^Access-Control-Allow-Origin:' || true)
  case "$ALLOWED" in
    *'http://127.0.0.1:9096'*) echo "  ✓ CORS 允许 9096" ;;
    *) fail "CORS 白名单未生效：$ALLOWED" ;;
  esac

  BAD_ORIGIN=$(curl -s -D- -o /dev/null --max-time 5 -X OPTIONS \
    -H 'Origin: http://127.0.0.1:9999' \
    -H 'Access-Control-Request-Method: POST' \
    http://127.0.0.1:9091/daemon.StartedService/GetVersion | tr -d '\r' | grep -i '^Access-Control-Allow-Origin:' || true)
  if [ -n "$BAD_ORIGIN" ]; then
    fail "CORS 未收口：$BAD_ORIGIN"
  else
    echo "  ✓ 非白名单 Origin 无 CORS 响应"
  fi
else
  echo "  - 跳过 9091 dashboard/CORS 检查（--ui-only）"
fi

if [ "$UI_ONLY" -eq 0 ]; then
  # Simulate the panel's atomic replace with 0644 and verify the path unit fixes it.
  chmod 644 "$CFG"
  cp -a "$CFG" "$CFG.permtest"
  mv "$CFG.permtest" "$CFG"
  for _ in $(seq 1 20); do
    MODE=$(stat -c '%a' "$CFG")
    [ "$MODE" = "600" ] && break
    sleep 0.25
  done
  if [ "$(stat -c '%a' "$CFG")" = "600" ]; then
    echo "  ✓ path unit 将配置权限复核为 600"
  else
    fail "path unit 未将配置权限恢复为 600（当前 $(stat -c '%a' "$CFG")）"
  fi
else
  echo "  - 跳过配置权限测试（--ui-only）"
fi

if [ "$UI_ONLY" -eq 0 ]; then
  echo "== [9/9] 配置摘要"
python3 - <<'PY'
import json
cfg = json.load(open('/etc/sing-box/config.json'))
api = next((s for s in cfg.get('services', []) if isinstance(s, dict) and s.get('type') == 'api'), None)
print("  API service:", "9091" if api else "缺失")
if api:
    print("  监听:", api.get('listen'), api.get('listen_port'))
    print("  CORS:", api.get('access_control_allow_origin'))
    print("  dashboard:", api.get('dashboard'))
print("  services 数量:", len(cfg.get('services', [])))
PY
else
  echo "== [9/9] 配置摘要（--ui-only 跳过）"
fi

rm -f "$NEWCFG"
OK=1
echo
echo "✓ 部署完成"
echo "  入口：http://127.0.0.1:9096/"
echo "  令牌：sudo cat /var/lib/sing-box-panel/token"
if [ "$UI_ONLY" -eq 0 ]; then
  echo "  配置备份：$BACKUP"
else
  echo "  配置：未改动（--ui-only）"
fi
if [ "$UI_MOVED" -eq 1 ]; then
  echo "  UI 备份：$UI_BACKUP"
else
  echo "  UI 备份：无（首次安装）"
fi
if [ -f "$GEOIP_DB" ]; then
  echo "  GeoIP：$GEOIP_DB"
else
  echo "  GeoIP：未安装（/api/geoip 返回 503）"
fi
echo "  回滚：见 $DST/README.md"
