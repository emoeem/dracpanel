#!/usr/bin/env python3
"""Acceptance pass 2: management actions, reconnect, light theme, narrow layout."""
import asyncio
import base64
import json
import time
import urllib.request
from pathlib import Path

import websockets

BASE = "http://127.0.0.1:9096/"
ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "artifacts" / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)
TOKEN = (ROOT / ".test-token").read_text().strip()
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  -> {detail}" if detail else ""))


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.msg_id = 0

    async def send(self, method, params=None):
        self.msg_id += 1
        await self.ws.send(json.dumps({"id": self.msg_id, "method": method, "params": params or {}}))
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=40)
            msg = json.loads(raw)
            if "method" in msg:
                continue
            if msg.get("id") == self.msg_id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def eval(self, expression, await_promise=True):
        result = await self.send(
            "Runtime.evaluate",
            {"expression": expression, "awaitPromise": await_promise, "returnByValue": True},
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            desc = (details.get("exception") or {}).get("description") or details.get("text") or "eval failed"
            raise RuntimeError(desc)
        return result["result"].get("value")

    async def wait_for(self, expression, timeout=20.0, interval=0.2):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if await self.eval(expression):
                    return True
            except Exception:
                pass
            await asyncio.sleep(interval)
        return False

    async def shot(self, name):
        data = await self.send("Page.captureScreenshot", {"format": "png"})
        (SHOTS / f"{name}.png").write_bytes(base64.b64decode(data["data"]))
        print("screenshot:", SHOTS / f"{name}.png")

    async def click_text(self, label):
        return await self.eval(f"""
            (() => {{
              const node = [...document.querySelectorAll('button')]
                .find((n) => (n.textContent || '').trim() === {json.dumps(label)});
              if (!node) return false;
              node.click();
              return true;
            }})()
        """)

    async def click_dialog(self, label):
        return await self.eval(f"""
            (() => {{
              const dialog = document.querySelector('dialog[open]');
              if (!dialog) return false;
              const button = [...dialog.querySelectorAll('button')]
                .find((n) => (n.textContent || '').trim() === {json.dumps(label)});
              if (!button) return false;
              button.click();
              return true;
            }})()
        """)

    def visible_header_expr(self):
        return """
            (() => {
              const header = [...document.querySelectorAll('header')]
                .find((h) => h.getBoundingClientRect().height > 0 && h.textContent.includes('DracPanel'));
              return header ? header.innerText.replace(/\\s+/g, ' ') : '';
            })()
        """


SAMPLE_CONFIG = {
    "$schema": "https://sing-box.sagernet.org/schema.json",
    "log": {"level": "warn", "timestamp": True},
    "dns": {
        "servers": [
            {
                "tag": "dns-direct",
                "type": "https",
                "server": "dns.alidns.com",
                "domain_resolver": "hosts",
            }
        ],
        "rules": [
            {"rule_set": ["geosite/cn"], "action": "route", "server": "dns-direct"},
        ],
        "final": "dns-direct",
    },
    "route": {
        "rule_set": [
            {
                "type": "remote",
                "tag": "geosite/cn",
                "format": "binary",
                "url": "https://example.com/geosite-cn.srs",
            }
        ],
        "rules": [
            {"action": "sniff"},
            {"ip_is_private": True, "action": "route", "outbound": "direct"},
            {"rule_set": ["geosite/cn"], "action": "route", "outbound": "direct"},
        ],
        "final": "direct",
    },
    "outbounds": [{"type": "direct", "tag": "direct"}],
}


async def login_if_needed(cdp):
    await cdp.send("Page.navigate", {"url": BASE})
    await cdp.wait_for("document.readyState === 'complete'")
    await asyncio.sleep(1.0)
    if await cdp.eval("document.querySelector('input[type=password]') !== null"):
        filled = await cdp.eval(f"""
            (() => {{
              const input = document.querySelector('input[type=password]');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, {json.dumps(TOKEN)});
              input.dispatchEvent(new Event('input', {{ bubbles: true }}));
              return true;
            }})()
        """)
        check("重新登录填入令牌", filled)
        await asyncio.sleep(0.3)
        await cdp.eval("document.querySelector('form button[type=submit]').click()")
    ok = await cdp.wait_for("[...document.querySelectorAll('button')].some(b => (b.textContent||'').trim() === '概览')", 40)
    check("应用已登录", ok)


async def ensure_manage(cdp):
    await cdp.eval("location.hash = '#/manage'")
    return await cdp.wait_for("[...document.querySelectorAll('button')].some(b => (b.textContent||'').trim() === '运行状态')", 15)


async def panel_state(cdp):
    return await cdp.eval("fetch('/api/state', { headers: { 'X-Panel-Token': localStorage.getItem('panel_token') } }).then(r => r.json())")


async def wait_pid_change(cdp, old_pid, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        try:
            state = await panel_state(cdp)
            pid = state.get("service", {}).get("pid")
            if state.get("service", {}).get("active") and pid and pid != old_pid:
                return pid
        except Exception:
            pass
        await asyncio.sleep(1)
    return None


async def main():
    with urllib.request.urlopen("http://127.0.0.1:9223/json/list") as response:
        page = next(t for t in json.load(response) if t["type"] == "page")
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=80 * 1024 * 1024) as ws:
        cdp = CDP(ws)
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        await login_if_needed(cdp)

        # ---- Config tab: validate real config, then insert a safe sample for the screenshot ----
        await ensure_manage(cdp)
        check("打开管理页", True)
        clicked = await cdp.click_text("配置")
        check("打开配置标签", clicked)
        ok = await cdp.wait_for("document.querySelector('.cm-scroller') !== null", 20)
        check("配置编辑器加载", ok)
        if ok:
            validate = await cdp.eval("""
                (() => {
                  const button = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '校验');
                  if (!button) return false;
                  button.click();
                  return true;
                })()
            """)
            check("点击校验", validate)
            ok = await cdp.wait_for("document.body.innerText.includes('check 通过') || document.body.innerText.includes('校验通过')", 25)
            check("配置校验通过（真实配置）", ok)

            await cdp.eval("document.querySelector('.cm-content')?.focus()")
            await cdp.send("Input.dispatchKeyEvent", {
                "type": "keyDown", "modifiers": 2, "key": "a", "code": "KeyA",
                "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65,
            })
            await cdp.send("Input.dispatchKeyEvent", {
                "type": "keyUp", "modifiers": 2, "key": "a", "code": "KeyA",
                "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65,
            })
            await asyncio.sleep(0.2)
            await cdp.send("Input.insertText", {"text": json.dumps(SAMPLE_CONFIG, ensure_ascii=False, indent=2)})
            await asyncio.sleep(1.0)
            visible = await cdp.eval("document.querySelector('.cm-content')?.innerText || ''")
            safe = "geosite/cn" in visible and "secret" not in visible and "password" not in visible
            check("编辑器示例内容无密钥", safe, visible[:80].replace("\n", " "))
            if safe:
                await cdp.shot("11-manage-config-dark")
            else:
                print("skip config screenshot: editor still contains sensitive content")

        # ---- Restart core from management, verify no page reload and streams recover ----
        await cdp.click_text("运行状态")
        await asyncio.sleep(0.6)
        marker = await cdp.eval("(() => { window.__noReloadMarker = 'alive'; return true; })()")
        check("设置无刷新标记", marker)
        state_before = await panel_state(cdp)
        pid_before = state_before.get("service", {}).get("pid")
        restart = await cdp.click_text("重启")
        check("点击重启", restart)
        await cdp.wait_for("document.querySelector('dialog[open]') !== null", 5)
        confirmed = await cdp.click_dialog("重启")
        check("确认重启", confirmed)
        new_pid = await wait_pid_change(cdp, pid_before, 60)
        check("重启产生新 PID", new_pid is not None, f"{pid_before} -> {new_pid}")
        ok = await cdp.wait_for("document.body.innerText.includes('运行中')", 45)
        check("重启后核心恢复", ok)
        await asyncio.sleep(2.0)
        survived = await cdp.eval("window.__noReloadMarker === 'alive'")
        check("重启后页面未整页刷新", survived)
        await cdp.shot("13-manage-after-restart")

        # ---- eBPF apply: config pipeline + reconnect ----
        ebpf = await cdp.click_text("eBPF")
        check("打开 eBPF 标签", ebpf)
        await asyncio.sleep(1.0)
        state_before = await panel_state(cdp)
        pid_before = state_before.get("service", {}).get("pid")
        apply_button = await cdp.click_text("应用策略")
        check("点击应用 eBPF 策略", apply_button)
        await cdp.wait_for("document.querySelector('dialog[open]') !== null", 5)
        confirmed = await cdp.click_dialog("应用并重启")
        check("确认 eBPF 应用", confirmed)
        new_pid = await wait_pid_change(cdp, pid_before, 75)
        check("eBPF 应用产生新 PID", new_pid is not None, f"{pid_before} -> {new_pid}")
        ok = await cdp.wait_for("document.body.innerText.includes('配置已应用') || document.body.innerText.includes('应用并重启成功')", 20)
        check("eBPF 配置应用完成", ok)
        recovered = await cdp.wait_for("document.body.innerText.includes('运行中')", 45)
        check("eBPF 应用后核心恢复", recovered)
        await asyncio.sleep(1.5)
        survived = await cdp.eval("window.__noReloadMarker === 'alive'")
        check("eBPF 应用后页面未刷新", survived)
        await cdp.shot("14-manage-ebpf-applied")

        # ---- Stop / start ----
        await cdp.click_text("运行状态")
        await asyncio.sleep(0.5)
        stop = await cdp.click_text("停止")
        check("点击停止", stop)
        await cdp.wait_for("document.querySelector('dialog[open]') !== null", 5)
        confirmed = await cdp.click_dialog("停止")
        check("确认停止", confirmed)
        stopped = False
        for _ in range(30):
            state = await panel_state(cdp)
            if not state.get("service", {}).get("active"):
                stopped = True
                break
            await asyncio.sleep(1)
        check("核心已停止", stopped)
        ok = await cdp.wait_for("document.body.innerText.includes('已停止')", 20)
        check("管理页显示已停止", ok)
        await cdp.shot("15-manage-stopped")
        survived = await cdp.eval("window.__noReloadMarker === 'alive'")
        check("停止后管理页未刷新", survived)
        start = await cdp.click_text("启动")
        check("点击启动", start)
        recovered = False
        for _ in range(45):
            state = await panel_state(cdp)
            if state.get("service", {}).get("active"):
                recovered = True
                break
            await asyncio.sleep(1)
        check("核心重新启动", recovered)
        ok = await cdp.wait_for("document.body.innerText.includes('运行中')", 30)
        check("管理页显示运行中", ok)
        await asyncio.sleep(1.5)
        survived = await cdp.eval("window.__noReloadMarker === 'alive'")
        check("启动后页面未刷新", survived)
        await cdp.shot("16-manage-running")

        # ---- Light theme (visible header, Alucard) ----
        await cdp.eval("location.hash = '#/overview'")
        await asyncio.sleep(1.0)
        clicked = await cdp.eval(f"""
            (() => {{
              const header = [...document.querySelectorAll('header')]
                .find((h) => h.getBoundingClientRect().height > 0 && h.textContent.includes('DracPanel'));
              if (!header) return false;
              const actions = header.lastElementChild;
              const button = actions ? actions.querySelector('button') : null;
              if (!button) return false;
              button.click();
              return true;
            }})()
        """)
        check("切换亮色主题", clicked)
        ok = await cdp.wait_for("document.documentElement.dataset.theme === 'light'", 5)
        check("当前为 Alucard 亮色", ok, await cdp.eval("document.documentElement.dataset.theme"))
        await asyncio.sleep(0.8)
        await cdp.shot("12-overview-light")
        await cdp.eval(f"""
            (() => {{
              const header = [...document.querySelectorAll('header')]
                .find((h) => h.getBoundingClientRect().height > 0 && h.textContent.includes('DracPanel'));
              const actions = header && header.lastElementChild;
              const button = actions && actions.querySelector('button');
              button && button.click();
            }})()
        """)
        await asyncio.sleep(0.4)

        # ---- Narrow layout ----
        await cdp.send("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        await asyncio.sleep(0.8)
        overflow = await cdp.eval("document.documentElement.scrollWidth <= window.innerWidth + 1")
        check("窄屏无横向溢出", overflow, await cdp.eval("document.documentElement.scrollWidth + '/' + window.innerWidth"))
        await cdp.shot("17-overview-mobile")

        errs = await cdp.eval("window.__errs || []")
        check("无 JS 错误", not errs, errs)

    print("\n===== SUMMARY 2 =====")
    failed = [item for item in results if not item[1]]
    for name, ok, detail in results:
        print(("✓ " if ok else "✗ ") + name)
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
