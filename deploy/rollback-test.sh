#!/bin/bash
# Drill the documented UI/config rollback without leaving the system changed.
#
# The oldest legacy UI is the pre-install upstream UI, and the oldest dracula
# config backup predates the first 9091 install. Both are intentionally used to
# simulate a full rollback; newer backups would already contain the deployment.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "需要 root" >&2; exit 1; fi

TS=$(date +%Y%m%d-%H%M%S)
DST=/usr/local/share/dracpanel-ui
CFG=/etc/sing-box/config.json
CURRENT=/etc/sing-box/backups/config.json.bak.$TS-before-rollback-test
UI_HOLD="${DST}.new-hold-$TS"

shopt -s nullglob
LEGACIES=(/usr/local/share/dracpanel-ui.legacy-*)
BACKUPS=(/etc/sing-box/backups/config.json.bak.*-dracpanel)
shopt -u nullglob

LEGACY=""
if [ "${#LEGACIES[@]}" -gt 0 ]; then
  LEGACY="${LEGACIES[0]}"
fi
PRE=""
if [ "${#BACKUPS[@]}" -gt 0 ]; then
  PRE="${BACKUPS[0]}"
fi

LEGACY_AT_DST=0
DONE=0

restore_all() {
  echo "↩ 恢复部署状态…" >&2
  set +e
  if [ -f "$CURRENT" ]; then
    cp -a "$CURRENT" "$CFG"
    chmod 600 "$CFG"
  fi
  if [ "$LEGACY_AT_DST" -eq 1 ] && [ -n "$LEGACY" ] && [ -d "$DST" ]; then
    # DST currently holds the legacy UI; put it back before restoring the new one.
    mv "$DST" "$LEGACY"
    LEGACY_AT_DST=0
  fi
  if [ -d "$UI_HOLD" ]; then
    rm -rf "$DST"
    mv "$UI_HOLD" "$DST"
  fi
  systemctl restart sing-box >/dev/null 2>&1
  systemctl restart sing-box-panel >/dev/null 2>&1
  set -e
}

[ -f "$CFG" ] || { echo "缺少配置"; exit 1; }
[ -d "$DST" ] || { echo "缺少当前 UI 目录 $DST"; exit 1; }
if [ -z "$LEGACY" ] || [ ! -d "$LEGACY" ]; then
  echo "缺少旧 UI 备份" >&2
  exit 1
fi
if [ -z "$PRE" ] || [ ! -f "$PRE" ]; then
  echo "缺少配置备份" >&2
  exit 1
fi
[ ! -e "$UI_HOLD" ] || { echo "临时目录已存在：$UI_HOLD"; exit 1; }

trap 'if [ "$DONE" -eq 0 ]; then restore_all; fi' EXIT

echo "== [1/4] 备份当前配置"
cp -a "$CFG" "$CURRENT"
chmod 600 "$CURRENT"

echo "== [2/4] UI 回滚演练"
mv "$DST" "$UI_HOLD"
LEGACY_AT_DST=1
mv "$LEGACY" "$DST"
systemctl restart sing-box-panel
sleep 1
curl -fsS --max-time 5 http://127.0.0.1:9096/ | grep -q 'shell.js' || { echo "旧 UI 未生效"; exit 1; }
echo "  ✓ 旧 iframe 外壳可恢复"
mv "$DST" "$LEGACY"
LEGACY_AT_DST=0
mv "$UI_HOLD" "$DST"
systemctl restart sing-box-panel
sleep 1
curl -fsS --max-time 5 http://127.0.0.1:9096/ | grep -q 'DracPanel' || { echo "新 UI 未恢复"; exit 1; }
echo "  ✓ 新 Dracula UI 已恢复"

echo "== [3/4] 配置回滚演练（移除 9091）"
cp -a "$PRE" "$CFG"
chmod 600 "$CFG"
sing-box check -C /etc/sing-box
systemctl restart sing-box
sleep 3
systemctl is-active --quiet sing-box || { echo "回滚配置未启动"; exit 1; }
if ss -ltn | grep -q '127.0.0.1:9091'; then echo "9091 仍在监听"; exit 1; fi
echo "  ✓ 旧配置可恢复，9091 已关闭"

echo "== [4/4] 恢复当前部署配置"
cp -a "$CURRENT" "$CFG"
chmod 600 "$CFG"
sing-box check -C /etc/sing-box
systemctl restart sing-box
sleep 3
systemctl is-active --quiet sing-box || { echo "部署配置未恢复"; exit 1; }
ss -ltn | grep -q '127.0.0.1:9091' || { echo "9091 未恢复"; exit 1; }
ALLOWED=$(curl -s -D- -o /dev/null --max-time 5 -X OPTIONS \
  -H 'Origin: http://127.0.0.1:9096' \
  -H 'Access-Control-Request-Method: POST' \
  http://127.0.0.1:9091/daemon.StartedService/GetVersion | tr -d '\r' | grep -i '^Access-Control-Allow-Origin:' || true)
case "$ALLOWED" in *'http://127.0.0.1:9096'*) ;; *) echo "CORS 未恢复"; exit 1;; esac
DONE=1
trap - EXIT
echo "  ✓ 部署配置与 CORS 已恢复"
echo
echo "回滚演练通过"
echo "当前配置备份：$CURRENT"
