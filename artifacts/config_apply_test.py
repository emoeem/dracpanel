import asyncio, json, time, urllib.request
from pathlib import Path
import websockets
BASE='http://127.0.0.1:9096/'
ROOT=Path(__file__).resolve().parents[1]
TOKEN=(ROOT/'.test-token').read_text().strip()

async def wait_cdp():
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:9223/json/list') as r:
                return next(t for t in json.load(r) if t['type']=='page')
        except Exception:
            await asyncio.sleep(0.5)
    raise SystemExit('chrome not ready')

async def main():
    page=await wait_cdp()
    async with websockets.connect(page['webSocketDebuggerUrl'],max_size=80*1024*1024) as ws:
        i=0
        async def send(m,p=None):
            nonlocal i
            i+=1; await ws.send(json.dumps({'id':i,'method':m,'params':p or {}}))
            while True:
                msg=json.loads(await asyncio.wait_for(ws.recv(),timeout=60))
                if 'method' in msg: continue
                if msg.get('id')==i: return msg.get('result',{})
        async def ev(e):
            r=await send('Runtime.evaluate',{'expression':e,'returnByValue':True,'awaitPromise':True})
            if 'exceptionDetails' in r: raise RuntimeError(str(r['exceptionDetails']))
            return r['result'].get('value')
        async def wait(e,t=40):
            end=time.time()+t
            while time.time()<end:
                try:
                    if await ev(e): return True
                except Exception: pass
                await asyncio.sleep(0.3)
            return False
        async def state():
            return await ev("fetch('/api/state',{headers:{'X-Panel-Token':localStorage.getItem('panel_token')}}).then(r=>r.json())")
        async def cfg_text():
            return await ev("fetch('/api/config',{headers:{'X-Panel-Token':localStorage.getItem('panel_token')}}).then(r=>r.json()).then(j=>j.text)")
        async def type_all(text):
            await ev("document.querySelector('.cm-content')?.focus()")
            await send('Input.dispatchKeyEvent',{'type':'keyDown','modifiers':2,'key':'a','code':'KeyA','windowsVirtualKeyCode':65,'nativeVirtualKeyCode':65})
            await send('Input.dispatchKeyEvent',{'type':'keyUp','modifiers':2,'key':'a','code':'KeyA','windowsVirtualKeyCode':65,'nativeVirtualKeyCode':65})
            await asyncio.sleep(0.2)
            await send('Input.insertText',{'text':text})
            await asyncio.sleep(1.0)
            await ev("(()=>{const s=document.querySelector('.cm-scroller');if(s)s.scrollTop=0;})()")
            await asyncio.sleep(0.4)
        async def confirm_apply():
            clicked=await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='应用并重启');if(!b)return false;b.click();return true})()")
            if not clicked: raise RuntimeError('apply toolbar button missing')
            await wait("document.querySelector('dialog[open]')!==null",8)
            ok=await ev("(()=>{const d=document.querySelector('dialog[open]');if(!d)return false;const b=[...d.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='应用并重启');if(!b)return false;b.click();return true})()")
            if not ok: raise RuntimeError('apply dialog button missing')
        async def wait_pid(old):
            end=time.time()+75
            while time.time()<end:
                try:
                    s=await state()
                    if s.get('service',{}).get('active') and s.get('service',{}).get('pid')!=old:
                        return s.get('service',{}).get('pid')
                except Exception: pass
                await asyncio.sleep(1)
            return None

        await send('Page.enable'); await send('Runtime.enable')
        await send('Page.addScriptToEvaluateOnNewDocument',{'source':"""
            try{
              if(!localStorage.getItem('sing-box-dashboard.language')) localStorage.setItem('sing-box-dashboard.language','zh-Hans');
              if(!localStorage.getItem('sing-box-dashboard.theme')) localStorage.setItem('sing-box-dashboard.theme','dark');
            }catch(e){}
        """})
        await send('Emulation.setDeviceMetricsOverride',{'width':1440,'height':900,'deviceScaleFactor':1,'mobile':False})
        await send('Page.navigate',{'url':BASE})
        await wait("document.querySelector('input[type=password]')!==null || [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='概览')",30)
        if await ev("document.querySelector('input[type=password]')!==null"):
            await ev(f"""(()=>{{const i=document.querySelector('input[type=password]');const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,{json.dumps(TOKEN)});i.dispatchEvent(new Event('input',{{bubbles:true}}));}})()""")
            await asyncio.sleep(0.3); await ev("document.querySelector('form button[type=submit]').click()")
        await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='概览')",45)
        await ev("location.hash='#/manage'"); await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='配置')",15)
        await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='配置')?.click()")
        await wait("document.querySelector('.cm-scroller')!==null",25)

        original=await cfg_text()
        data=json.loads(original)
        old_level=data.get('log',{}).get('level','warn')
        new_level='info' if old_level!='info' else 'debug'
        data.setdefault('log',{})['level']=new_level
        modified=json.dumps(data,ensure_ascii=False,indent=2)
        print('log level:',old_level,'->',new_level)
        st=await state(); pid_before=st.get('service',{}).get('pid')
        await ev("(()=>{window.__cfgNoReload='alive';return true})()")
        await type_all(modified)
        visible=await ev("document.querySelector('.cm-content')?.innerText||''")
        if f'"level": "{new_level}"' not in visible:
            raise SystemExit('modified text not visible in editor')
        await confirm_apply()
        new_pid=await wait_pid(pid_before)
        print('apply PID:',pid_before,'->',new_pid)
        if not new_pid: raise SystemExit('apply restart did not happen')
        ok=await wait("document.body.innerText.includes('配置已应用') || document.body.innerText.includes('应用并重启成功')",20)
        print('apply success message:',ok)
        level_now=await ev("fetch('/api/config',{headers:{'X-Panel-Token':localStorage.getItem('panel_token')}}).then(r=>r.json()).then(j=>JSON.parse(j.text).log.level)")
        print('level after apply:',level_now)
        survived=await ev("window.__cfgNoReload==='alive'")
        print('no reload after apply:',survived)
        await asyncio.sleep(1.5)
        # restore original
        await wait("document.querySelector('.cm-scroller')!==null",20)
        st=await state(); pid_before2=st.get('service',{}).get('pid')
        await type_all(original)
        await confirm_apply()
        new_pid2=await wait_pid(pid_before2)
        print('restore PID:',pid_before2,'->',new_pid2)
        if not new_pid2: raise SystemExit('restore restart did not happen')
        level_restored=await ev("fetch('/api/config',{headers:{'X-Panel-Token':localStorage.getItem('panel_token')}}).then(r=>r.json()).then(j=>JSON.parse(j.text).log.level)")
        print('level restored:',level_restored,'expected',old_level)
        survived2=await ev("window.__cfgNoReload==='alive'")
        print('no reload after restore:',survived2)
        print('errors:',await ev("window.__errs||[]"))
asyncio.run(main())
