#!/usr/bin/env python3
"""DracPanel acceptance test with real panel + native API."""
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
        self.events = []

    async def send(self, method, params=None):
        self.msg_id += 1
        await self.ws.send(json.dumps({"id": self.msg_id, "method": method, "params": params or {}}))
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=30)
            msg = json.loads(raw)
            if "method" in msg:
                self.events.append(msg)
                continue
            if msg.get("id") == self.msg_id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def evaluate(self, expression, await_promise=True):
        result = await self.send(
            "Runtime.evaluate",
            {"expression": expression, "awaitPromise": await_promise, "returnByValue": True},
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            desc = (details.get("exception") or {}).get("description") or details.get("text") or "eval failed"
            raise RuntimeError(desc)
        return result["result"].get("value")

    async def wait_for(self, expression, timeout=15.0, interval=0.2):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if await self.evaluate(expression):
                    return True
            except Exception:
                pass
            await asyncio.sleep(interval)
        return False

    async def shot(self, name):
        data = await self.send("Page.captureScreenshot", {"format": "png"})
        (SHOTS / f"{name}.png").write_bytes(base64.b64decode(data["data"]))
        print("screenshot:", SHOTS / f"{name}.png")

    async def click_text(self, label, selector="button"):
        script = f"""
        (() => {{
          const nodes = [...document.querySelectorAll({json.dumps(selector)})];
          const node = nodes.find((n) => (n.textContent || '').trim() === {json.dumps(label)});
          if (!node) return false;
          node.click();
          return true;
        }})()
        """
        return await self.evaluate(script)

    async def nav(self, label, hash_value, timeout=12):
        clicked = await self.click_text(label)
        if not clicked:
            return False
        ok = await self.wait_for(f"location.hash === {json.dumps(hash_value)}", timeout)
        await asyncio.sleep(0.6)
        return ok


async def main():
    with urllib.request.urlopen("http://127.0.0.1:9223/json/list") as response:
        page = next(t for t in json.load(response) if t["type"] == "page")
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=80 * 1024 * 1024) as ws:
        cdp = CDP(ws)
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("Network.enable")
        await cdp.send(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": """
                window.__errs = [];
                addEventListener('error', e => window.__errs.push('error: ' + e.message));
                addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
                try {
                  if (!localStorage.getItem('sing-box-dashboard.language')) localStorage.setItem('sing-box-dashboard.language', 'zh-Hans');
                  if (!localStorage.getItem('sing-box-dashboard.theme')) localStorage.setItem('sing-box-dashboard.theme', 'dark');
                } catch (e) {}
                """,
            },
        )
        try:
            await cdp.send("Storage.clearDataForOrigin", {"origin": "http://127.0.0.1:9096", "storageTypes": "local_storage"})
        except Exception as exc:
            print("clear storage skipped:", exc)

        await cdp.send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        await cdp.send("Page.navigate", {"url": BASE})
        ok = await cdp.wait_for("document.readyState === 'complete'")
        check("页面加载", ok)
        ok = await cdp.wait_for("document.querySelector('input[type=password]') !== null", 12)
        check("登录门显示", ok)
        await cdp.shot("00-gate-dark")

        filled_js = (
            "(() => {"
            " const input = document.querySelector('input[type=password]');"
            " if (!input) return false;"
            " const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;"
            f" setter.call(input, {json.dumps(TOKEN)});"
            " input.dispatchEvent(new Event('input', { bubbles: true }));"
            " return input.value.length > 0;"
            "})()"
        )
        filled = await cdp.evaluate(filled_js)
        check("填入令牌", filled)
        await asyncio.sleep(0.3)
        clicked = await cdp.evaluate("(() => { const b = document.querySelector('form button[type=submit]'); if (!b) return false; b.click(); return true; })()")
        check("提交令牌", clicked)
        ok = await cdp.wait_for("[...document.querySelectorAll('button')].some(b => (b.textContent||'').trim() === '概览')", 35)
        if not ok:
            body = await cdp.evaluate("document.body.innerText.slice(0, 800)")
            print("BODY:", body)
            check("登录进入应用", False)
            raise SystemExit(1)
        check("登录进入应用", ok)

        ok = await cdp.wait_for("document.querySelector('header') && document.body.innerText.includes('运行中')", 20)
        check("顶栏状态为运行中", ok)
        version = await cdp.evaluate("""
            (() => {
              const header = [...document.querySelectorAll('header')].find(h => h.textContent.includes('DracPanel'));
              return header ? header.innerText.replace(/\\s+/g, ' ').slice(0, 200) : '';
            })()
        """)
        print("HEADER:", version)
        check("顶栏含版本与模式", "v1.14" in version and "模式" in version, version)
        await asyncio.sleep(1.6)
        await cdp.shot("01-overview-dark")

        # Page screenshots
        pages = [
            ("代理", "#/groups", "02-groups-dark"),
            ("连接", "#/connections", "03-connections-dark"),
            ("日志", "#/logs", "04-logs-dark"),
            ("规则", "#/rules", "05-rules-dark"),
            ("测速", "#/speedtest", "06-speedtest-dark"),
            ("设置", "#/settings", "07-settings-dark"),
        ]
        for label, hash_value, name in pages:
            ok = await cdp.nav(label, hash_value, 20)
            check(f"导航 {label}", ok, hash_value)
            await asyncio.sleep(0.8)
            await cdp.shot(name)

        # Management tabs
        ok = await cdp.nav("管理", "#/manage", 15)
        check("导航 管理", ok)
        await asyncio.sleep(1.0)
        await cdp.shot("08-manage-status-dark")
        for label, name in [("订阅", "09-manage-subscriptions-dark"), ("eBPF", "10-manage-ebpf-dark"), ("配置", "11-manage-config-dark")]:
            clicked = await cdp.click_text(label)
            check(f"管理标签 {label}", clicked)
            await asyncio.sleep(1.0 if label != "配置" else 2.0)
            if label == "配置":
                await cdp.evaluate("""
                    (() => {
                      const scroller = document.querySelector('.cm-scroller');
                      if (scroller) scroller.scrollTop = Math.min(9000, Math.max(0, scroller.scrollHeight - 500));
                    })()
                """)
                await asyncio.sleep(0.6)
            await cdp.shot(name)

        # Light theme
        await cdp.nav("概览", "#/overview", 15)
        theme_clicked = await cdp.evaluate("""
            (() => {
              const header = [...document.querySelectorAll('header')].find(h => h.textContent.includes('DracPanel'));
              if (!header) return false;
              const buttons = [...header.querySelectorAll('button')];
              const theme = buttons.find(b => /浅|亮|Light/i.test(b.getAttribute('title') || ''));
              if (!theme) return false;
              theme.click();
              return true;
            })()
        """)
        check("切换亮色主题", theme_clicked)
        await asyncio.sleep(0.8)
        theme = await cdp.evaluate("document.documentElement.dataset.theme")
        check("当前为亮色", theme == "light", theme)
        await cdp.shot("12-overview-light")
        await cdp.evaluate("""
            (() => {
              const header = [...document.querySelectorAll('header')].find(h => h.textContent.includes('DracPanel'));
              const buttons = [...header.querySelectorAll('button')];
              const theme = buttons.find(b => /深|暗|Dark/i.test(b.getAttribute('title') || ''));
              theme && theme.click();
            })()
        """)

        # Mode switching via topbar, verified through Clash API
        original = await cdp.evaluate("document.querySelector('header select')?.value || ''")
        options = await cdp.evaluate("[...document.querySelectorAll('header select option')].map(o => o.value)")
        print("MODES:", options, "current:", original)
        check("模式列表含四种自定义模式", all(m in options for m in ["Rule", "Proxy", "RuleAllowAds", "Direct"]), options)
        target = "RuleAllowAds" if original != "RuleAllowAds" else "Proxy"
        await cdp.evaluate(f"""
            (() => {{
              const select = document.querySelector('header select');
              select.value = {json.dumps(target)};
              select.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }})()
        """)
        await asyncio.sleep(1.5)
        mode = await cdp.evaluate("""
            (async () => {
              const state = await fetch('/api/state', { headers: { 'X-Panel-Token': localStorage.getItem('panel_token') } }).then(r => r.json());
              const config = await fetch('http://127.0.0.1:9090/configs', { headers: { Authorization: 'Bearer ' + state.clash_secret } }).then(r => r.json());
              return config.mode;
            })()
        """)
        check("模式切换落到 Clash API", mode == target, mode)
        await cdp.evaluate(f"""
            (() => {{
              const select = document.querySelector('header select');
              select.value = {json.dumps(original)};
              select.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }})()
        """)
        await asyncio.sleep(1.2)

        # Secret bootstrap cache: a reload must not refetch /api/config
        await cdp.nav("概览", "#/overview", 15)
        await asyncio.sleep(0.8)
        cdp.events.clear()
        await cdp.send("Page.reload")
        ok = await cdp.wait_for("document.body.innerText.includes('运行中')", 30)
        check("重载后免登录进入", ok)
        await asyncio.sleep(1.5)
        urls = []
        for event in cdp.events:
            if event.get("method") == "Network.requestWillBeSent":
                url = event.get("params", {}).get("request", {}).get("url", "")
                if url.startswith("http://127.0.0.1:9096"):
                    urls.append(url)
        print("PANEL REQUESTS:", [u.split("9096", 1)[-1] for u in urls])
        check("重载未重新拉取完整配置", not any(u.endswith("/api/config") for u in urls))
        check("重载仍校验 /api/state", any(u.endswith("/api/state") for u in urls))

        errs = await cdp.evaluate("window.__errs")
        check("页面无 JS 错误", not errs, errs)

    print("\n===== SUMMARY =====")
    failed = [item for item in results if not item[1]]
    for name, ok, detail in results:
        print(("✓ " if ok else "✗ ") + name)
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
