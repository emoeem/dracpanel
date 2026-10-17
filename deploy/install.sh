#!/bin/bash
# Deploy Dracula Panel for sing-box on top of the local sing-box-panel setup.
#
# - backs up /etc/sing-box/config.json
# - adds/updates services[type=api] on 127.0.0.1:9091 with a random secret,
#   9096-only CORS whitelist, dashboard disabled
# - installs the build into /usr/local/share/sing-box-panel-ui
# - installs a systemd path unit enforcing config mode 600 with a stat %a check
# - restarts both services with health checks and automatic rollback
#
# Run once with sudo/pkexec. Does not touch /usr/bin or /usr/share.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "需要 root 权限" >&2
  exit 1
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

CONFIG_CHANGED=0
UI_INSTALLED=0
OK=0

rollback() {
  echo "↩ 回滚中…" >&2
  if [ "$CONFIG_CHANGED" -eq 1 ] && [ -f "$BACKUP" ]; then
    cp -a "$BACKUP" "$CFG"
    chmod 600 "$CFG"
    systemctl restart sing-box || true
  fi
  if [ "$UI_INSTALLED" -eq 1 ]; then
    rm -rf "$DST"
    if [ -d "$UI_BACKUP" ]; then
      mv "$UI_BACKUP" "$DST"
    fi
    systemctl restart sing-box-panel || true
  fi
  rm -f "$NEWCFG"
}

trap 'if [ "$OK" -ne 1 ]; then rollback; fi' EXIT

fail() {
  echo "✗ $*" >&2
  exit 1
}

[ -f "$DIST/index.html" ] || fail "找不到构建产物 $DIST/index.html，请先构建"
[ -f "$CFG" ] || fail "找不到 $CFG"

echo "== [1/8] 备份 sing-box 配置"
mkdir -p /etc/sing-box/backups
cp -a "$CFG" "$BACKUP"
chmod 600 "$BACKUP"
echo "  备份：$BACKUP"

echo "== [2/8] 写入 services.api（9091，仅 9096 可跨域）"
SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
python3 - "$CFG" "$NEWCFG" "$SECRET" <<'PY'
import json
import sys

src, dst, secret = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src) as handle:
    cfg = json.load(handle)

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

api["type"] = "api"
api["listen"] = "127.0.0.1"
api["listen_port"] = 9091
api["secret"] = secret
api["access_control_allow_origin"] = [
    "http://127.0.0.1:9096",
    "http://localhost:9096",
]
api["access_control_allow_private_network"] = True
api["dashboard"] = {"enabled": False}
cfg["services"] = services

with open(dst, "w") as handle:
    json.dump(cfg, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
chmod 600 "$NEWCFG"
sing-box check -c "$NEWCFG"
install -m 600 -o root -g root "$NEWCFG" "$CFG"
CONFIG_CHANGED=1
# sing-box runs with -C /etc/sing-box: no other .json may live there.
rm -f /etc/sing-box/panel.json
sing-box check -C /etc/sing-box
echo "  配置已更新（secret 不输出）"

echo "== [3/8] 确认面板配置与 systemd drop-in"
mkdir -p /etc/sing-box-panel
python3 - "$PANEL_CFG" <<'PY'
import json
import os
import sys

path = sys.argv[1]
data = {}
if os.path.exists(path):
    try:
        with open(path) as handle:
            data = json.load(handle)
    except ValueError:
        data = {}
data["ui_dir"] = "/usr/local/share/sing-box-panel-ui"
with open(path, "w") as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
chmod 644 "$PANEL_CFG"
mkdir -p "$(dirname "$PANEL_DROPIN")"
cat > "$PANEL_DROPIN" <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/sing-box-panel --config /etc/sing-box-panel/panel.json
EOF
chmod 644 "$PANEL_DROPIN"
systemctl daemon-reload
echo "  面板配置：$PANEL_CFG"

echo "== [4/8] 安装配置权限守护（chmod 600 + stat %a 复核）"
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

echo "== [5/8] 安装 UI（旧目录备份为 $(basename "$UI_BACKUP")）"
if [ -d "$DST" ]; then
  mv "$DST" "$UI_BACKUP"
fi
install -d -m 755 "$DST"
cp -a "$DIST/." "$DST/"
install -m 644 "$ROOT/DEPLOYMENT.md" "$DST/README.md"
install -m 644 "$ROOT/DEPLOYMENT.md" "$DST/DEPLOYMENT.md"
install -m 644 "$ROOT/NOTICE" "$DST/NOTICE"
install -m 644 "$ROOT/LICENSE" "$DST/LICENSE"
chmod -R a+rX "$DST"
UI_INSTALLED=1
echo "  UI 文件：$(find "$DST" -type f | wc -l) 个"

echo "== [6/8] 重启服务"
systemctl restart sing-box
sleep 3
systemctl is-active --quiet sing-box || fail "sing-box 未启动"
systemctl restart sing-box-panel
sleep 1
systemctl is-active --quiet sing-box-panel || fail "sing-box-panel 未启动"
curl -fsS --max-time 5 http://127.0.0.1:9096/api/ping >/dev/null || fail "面板 API 无响应"
echo "  sing-box / sing-box-panel 均 active"

echo "== [7/8] 验收检查"
if curl -fsS --max-time 5 http://127.0.0.1:9096/ | grep -q 'Dracula Panel'; then
  echo "  ✓ 9096 返回 Dracula Panel"
else
  fail "9096 未返回 Dracula Panel"
fi

if curl -fsS --max-time 5 http://127.0.0.1:9096/api/ping >/dev/null; then
  echo "  ✓ 面板 API 正常"
fi

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

echo "== [8/8] 配置摘要"
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

rm -f "$NEWCFG"
OK=1
echo
echo "✓ 部署完成"
echo "  入口：http://127.0.0.1:9096/"
echo "  令牌：sudo cat /var/lib/sing-box-panel/token"
echo "  配置备份：$BACKUP"
echo "  UI 备份：$UI_BACKUP"
echo "  回滚：见 $DST/README.md"
