#!/bin/bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "需要 root" >&2; exit 1; fi

TS=$(date +%Y%m%d-%H%M%S)
DST=/usr/local/share/sing-box-panel-ui
LEGACY=$(ls -d /usr/local/share/sing-box-panel-ui.legacy-* 2>/dev/null | head -1 || true)
CFG=/etc/sing-box/config.json
PRE=$(ls -t /etc/sing-box/backups/config.json.bak.*-dracula 2>/dev/null | tail -1 || true)
CURRENT=/etc/sing-box/backups/config.json.bak.$TS-before-rollback-test

DONE=0
restore_all() {
  echo "↩ 恢复部署状态…" >&2
  if [ -f "$CURRENT" ]; then
    cp -a "$CURRENT" "$CFG"
    chmod 600 "$CFG"
  fi
  if [ -d "${DST}.new-hold-$TS" ]; then
    rm -rf "$DST"
    mv "${DST}.new-hold-$TS" "$DST"
  fi
  systemctl restart sing-box || true
  systemctl restart sing-box-panel || true
}
trap 'if [ "$DONE" -eq 0 ]; then restore_all; fi' EXIT

[ -f "$CFG" ] || { echo "缺少配置"; exit 1; }
[ -n "$LEGACY" ] && [ -d "$LEGACY" ] || { echo "缺少旧 UI 备份"; exit 1; }
[ -n "$PRE" ] && [ -f "$PRE" ] || { echo "缺少配置备份"; exit 1; }

echo "== [1/4] 备份当前配置"
cp -a "$CFG" "$CURRENT"
chmod 600 "$CURRENT"

echo "== [2/4] UI 回滚演练"
mv "$DST" "${DST}.new-hold-$TS"
mv "$LEGACY" "$DST"
systemctl restart sing-box-panel
sleep 1
curl -fsS --max-time 5 http://127.0.0.1:9096/ | grep -q 'shell.js' || { echo "旧 UI 未生效"; exit 1; }
echo "  ✓ 旧 iframe 外壳可恢复"
mv "$DST" "$LEGACY"
mv "${DST}.new-hold-$TS" "$DST"
systemctl restart sing-box-panel
sleep 1
curl -fsS --max-time 5 http://127.0.0.1:9096/ | grep -q 'Dracula Panel' || { echo "新 UI 未恢复"; exit 1; }
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
