import asyncio, base64, json, time, urllib.request
from pathlib import Path
import websockets
BASE='http://127.0.0.1:9096/'
ROOT=Path(__file__).resolve().parents[1]
SHOTS=ROOT/'artifacts'/'screenshots'
TOKEN=(ROOT/'.test-token').read_text().strip()
SAMPLE={"$schema":"https://sing-box.sagernet.org/schema.json","log":{"level":"warn","timestamp":True},
 "dns":{"servers":[{"tag":"dns-direct","type":"https","server":"dns.alidns.com","domain_resolver":"hosts"}],
        "rules":[{"rule_set":["geosite/cn"],"action":"route","server":"dns-direct"}],"final":"dns-direct"},
 "route":{"rule_set":[{"type":"remote","tag":"geosite/cn","format":"binary","url":"https://example.com/geosite-cn.srs"}],
          "rules":[{"action":"sniff"},{"ip_is_private":True,"action":"route","outbound":"direct"},
                   {"rule_set":["geosite/cn"],"action":"route","outbound":"direct"}],"final":"direct"},
 "outbounds":[{"type":"direct","tag":"direct"}]}
class C:
    def __init__(self,ws): self.ws=ws; self.i=0; self.events=[]
    async def send(self,m,p=None):
        self.i+=1; await self.ws.send(json.dumps({'id':self.i,'method':m,'params':p or {}}))
        while True:
            msg=json.loads(await asyncio.wait_for(self.ws.recv(),timeout=40))
            if 'method' in msg: self.events.append(msg); continue
            if msg.get('id')==self.i: return msg.get('result',{})
    async def ev(self,e):
        r=await self.send('Runtime.evaluate',{'expression':e,'returnByValue':True,'awaitPromise':True})
        if 'exceptionDetails' in r: raise RuntimeError(str(r['exceptionDetails']))
        return r['result'].get('value')
    async def wait(self,e,t=30):
        end=time.time()+t
        while time.time()<end:
            try:
                if await self.ev(e): return True
            except Exception: pass
            await asyncio.sleep(0.2)
        return False
    async def shot(self,n):
        d=await self.send('Page.captureScreenshot',{'format':'png'}); (SHOTS/f'{n}.png').write_bytes(base64.b64decode(d['data'])); print('shot',n)
async def main():
    with urllib.request.urlopen('http://127.0.0.1:9223/json/list') as r:
        page=next(t for t in json.load(r) if t['type']=='page')
    async with websockets.connect(page['webSocketDebuggerUrl'],max_size=80*1024*1024) as ws:
        c=C(ws); await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable')
        await c.send('Emulation.setDeviceMetricsOverride',{'width':1440,'height':900,'deviceScaleFactor':1,'mobile':False})
        await c.send('Page.navigate',{'url':BASE})
        await c.wait("document.querySelector('input[type=password]')!==null || [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='概览')",25)
        if await c.ev("document.querySelector('input[type=password]')!==null"):
            await c.ev(f"""(()=>{{const i=document.querySelector('input[type=password]');const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,{json.dumps(TOKEN)});i.dispatchEvent(new Event('input',{{bubbles:true}}));}})()""")
            await asyncio.sleep(0.3); await c.ev("document.querySelector('form button[type=submit]').click()")
        await c.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='概览')",40)
        await asyncio.sleep(1.5)
        await c.ev("location.hash='#/overview'"); await asyncio.sleep(1.2); await c.shot('01-overview-dark')
        await c.ev("location.hash='#/settings'"); await asyncio.sleep(1.0); await c.shot('07-settings-dark')
        await c.ev("location.hash='#/manage'"); await asyncio.sleep(1.0)
        await c.ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='配置')?.click()")
        ok=await c.wait("document.querySelector('.cm-scroller')!==null",25)
        if ok:
            await c.ev("document.querySelector('.cm-content')?.focus()")
            await c.send('Input.dispatchKeyEvent',{'type':'keyDown','modifiers':2,'key':'a','code':'KeyA','windowsVirtualKeyCode':65,'nativeVirtualKeyCode':65})
            await c.send('Input.dispatchKeyEvent',{'type':'keyUp','modifiers':2,'key':'a','code':'KeyA','windowsVirtualKeyCode':65,'nativeVirtualKeyCode':65})
            await asyncio.sleep(0.2); await c.send('Input.insertText',{'text':json.dumps(SAMPLE,ensure_ascii=False,indent=2)})
            await asyncio.sleep(0.8)
            await c.send('Input.dispatchKeyEvent',{'type':'keyDown','modifiers':2,'key':'Home','code':'Home','windowsVirtualKeyCode':36,'nativeVirtualKeyCode':36})
            await c.send('Input.dispatchKeyEvent',{'type':'keyUp','modifiers':2,'key':'Home','code':'Home','windowsVirtualKeyCode':36,'nativeVirtualKeyCode':36})
            await asyncio.sleep(0.4)
            await c.ev("(()=>{const s=document.querySelector('.cm-scroller');if(s)s.scrollTop=0;const m=document.querySelector('main');if(m)m.scrollTop=0;})()")
            await asyncio.sleep(0.5)
            text=await c.ev("document.querySelector('.cm-content')?.innerText||''")
            if 'geosite/cn' in text and 'secret' not in text and 'password' not in text:
                await c.shot('11-manage-config-dark'); print('config screenshot safe')
            else:
                print('unsafe config, skip')
        opts=await c.ev("[...document.querySelectorAll('header select option')].map(o=>o.value)")
        print('modes:',opts)
        # cache after mtime-changing rollback: first load just refreshed; reload must skip config
        await c.ev("location.hash='#/overview'"); await asyncio.sleep(0.8)
        c.events.clear(); await c.send('Page.reload')
        await c.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='概览')",40); await asyncio.sleep(1.5)
        urls=[e['params']['request']['url'].split('9096',1)[-1] for e in c.events if e.get('method')=='Network.requestWillBeSent' and e['params']['request']['url'].startswith('http://127.0.0.1:9096')]
        print('panel requests:',urls)
        print('no config refetch:', not any(u.endswith('/api/config') for u in urls))
        print('errors:', await c.ev('window.__errs||[]'))
asyncio.run(main())
