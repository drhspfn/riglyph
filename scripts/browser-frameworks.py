#!/usr/bin/env python3
"""Hosted CI only: production React/Vite + Next SSR/hydration + vanilla packed ESM.
Requires dependencies already installed by scripts/framework-builds.mjs.
"""
import os,subprocess,time,json,shutil,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
processes=[]
apps=[('react',root/'examples/react',['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4175'],4175),
 ('nextjs',root/'examples/nextjs',['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','4176'],4176),
 ('vanilla',root/'examples/vanilla-web',['node','serve.mjs'],4177)]
try:
 for name,cwd,args,port in apps:
  environment=os.environ.copy();environment['PORT']=str(port)
  proc=subprocess.Popen(args,cwd=cwd,env=environment,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  processes.append(proc)
  ready=False
  for _ in range(50):
   if proc.poll() is not None:break
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=1) as resp:
     ready=resp.status==200
     if ready:break
   except Exception:pass
   time.sleep(.2)
  if not ready:raise RuntimeError(f'{name} production HTTP server could not start')
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'])
  results=[]
  for name,_,_,port in apps:
   page=browser.new_page(viewport={'width':960,'height':720})
   errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.goto(f'http://127.0.0.1:{port}/',wait_until='networkidle',timeout=25000)
   if name=='nextjs':page.get_by_text('Independent Skeleton Player').wait_for(timeout=10000)
   page.wait_for_function("()=>!!document.querySelector('canvas')&&document.querySelector('canvas').getContext('webgl2')",timeout=10000)
   def painted():
    return page.evaluate("""()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl2');
     const pixels=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,pixels);
     return {nonTransparent:pixels.filter((v,i)=>i%4===3&&v>0).length,error:g.getError()};}""")
   reading=None
   for _ in range(45):
    reading=painted()
    if reading['nonTransparent']>0:break
    time.sleep(.2)
   if errors or reading['nonTransparent']<=0 or reading['error']!=0:raise RuntimeError(f'{name}: errors={errors}, framebuffer={reading}')
   results.append({'framework':name,'status':'PASS','rgbaPixels':reading['nonTransparent'],'glError':reading['error']})
   page.close()
  browser.close()
 print(json.dumps({'result':'PASS','tests':results}))
finally:
 for proc in processes:
  proc.terminate()
  try:proc.wait(timeout=3)
  except subprocess.TimeoutExpired:proc.kill()
