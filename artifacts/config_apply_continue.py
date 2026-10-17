import asyncio, json, time, urllib.request
import websockets
async def main():
    with urllib.request.urlopen('http://127.0.0.1:9223/json/list') as r:
        page=next(t for t in json.load(r) if t['type']=='page')
    async with websockets.connect(page['webSocketDebuggerUrl'],max_size=80*1024*1024) as ws:
        i=0
        async def send(m,p=None):
            nonlocal i
            i+=1; await ws.send(json.dumps({'id':i,'method':m,'params':p or {}}))
            while True:
                msg=json.loads(await asyncio.wait_for(ws.recv(),timeout=90))
                if 'method' in msg: continue
                if msg.get('id')==i: return msg.get('result',{})
        async def ev(e):
            r=await send('Runtime.evaluate',{'expression':e,'returnByValue':True,'awaitPromise':True})
            if 'exceptionDetails' in r: raise RuntimeError(str(r['exceptionDetails']))
            return r['result'].get('value')
        async def wait(e,t=30):
            end=time.time()+t
            while time.time()<end:
                try:
                    if await ev(e): return True
                except Exception: pass
                await asyncio.sleep(0.3)
            return False
        async def state():
            return await ev("fetch('/api/state',{headers:{'X-Panel-Token':localStorage.getItem('panel_token')}}).then(r=>r.json())")
        async def apply_ui():
            clicked=await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='应用并重启');if(!b)return false;b.click();return true})()")
            print('toolbar apply:',clicked)
            await wait("document.querySelector('dialog[open]')!==null",8)
            ok=await ev("(()=>{const d=document.querySelector('dialog[open]');if(!d)return false;const b=[...d.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='应用并重启');if(!b)return false;b.click();return true})()")
            print('dialog apply:',ok)
        original=await ev("fetch('/api/config',{headers:{'X-Panel-Token':localStorage.getItem('panel_token')}}).then(r=>r.json()).then(j=>j.text)")
        print('hash:',await ev('location.hash'))
        print('dirty:',await ev("document.body.innerText.includes('有未应用的修改')"))
        print('level on disk:',json.loads(original).get('log',{}).get('level'))
        await ev("(()=>{window.__cfgNoReload='alive';return true})()")
        st=await state(); pid0=st.get('service',{}).get('pid')
        await apply_ui()
        # wait for the panel response; either success or a validation error
        await asyncio.sleep(2)
        for _ in range(45):
            body=await ev('document.body.innerText')
            if '配置已应用' in body or '应用并重启成功' in body or '校验未通过' in body or 'JSON 语法错误' in body or '失败' in body:
                break
            await asyncio.sleep(1)
        body=await ev('document.body.innerText')
        applied='配置已应用' in body or '应用并重启成功' in body
        print('apply success:',applied)
        if '校验未通过' in body or 'JSON 语法错误' in body:
            print('validation error surfaced (config unchanged)')
            await ev("location.reload()")
            return
        if not applied:
            print('no clear apply result; body excerpt:', body[-300:].replace('\n',' | '))
        # verify log level and restore via API fallback if needed
        level=await ev("fetch('/api/config',{headers:{'X-Panel-Token':localStorage.getItem('panel_token')}}).then(r=>r.json()).then(j=>JSON.parse(j.text).log.level)")
        print('level after apply:',level)
        # restore original through the same config endpoint as a safety net
        result=await ev(f"""(async()=>{{const r=await fetch('/api/config',{{method:'POST',headers:{{'X-Panel-Token':localStorage.getItem('panel_token'),'Content-Type':'application/json'}},body:JSON.stringify({{text:{json.dumps(original)}}})}});return await r.json()}})()""")
        print('restore api ok:',result.get('ok'), 'message:', (result.get('message') or '')[:60])
        await asyncio.sleep(3)
        level2=await ev("fetch('/api/config',{headers:{'X-Panel-Token':localStorage.getItem('panel_token')}}).then(r=>r.json()).then(j=>JSON.parse(j.text).log.level)")
        print('level restored:',level2)
        print('no reload marker:',await ev("window.__cfgNoReload==='alive'"))
        await ev("location.reload()")
asyncio.run(main())
