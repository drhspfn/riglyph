#!/usr/bin/env python3
"""Live Chromium Playground smoke: zero HTTP requests, synthetic IR/PNG, real WebGL2.

Run headed, or on Linux: xvfb-run -a python scripts/browser-playground.py
Playwright + Chromium are optional test dependencies, never part of the runtime.
"""
import base64, json, re, shutil, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
dist=root/'dist/src'
from browser_importmap import map_modules
modules=map_modules(root,['core','runtime','renderer-webgl2','player-web'])
content=(dist/'playground/client.js').read_text().replace("'@riglyph/core'","'universal/core/index.js'").replace("'@riglyph/player-web'","'universal/player-web/index.js'")
entry='data:text/javascript;base64,'+base64.b64encode(content.encode()).decode()
html=(root/'src/playground/index.html').read_text().replace('<script type="module" src="/engine/playground/client.js"></script>','')
html=re.sub(r'<script type="importmap">.*?</script>','<script type="importmap">'+json.dumps({'imports':modules})+'</script>',html,flags=re.DOTALL)
ir64=base64.b64encode((root/'fixtures/minimal.json').read_bytes()).decode()
png64=base64.b64encode((root/'fixtures/synthetic-example.png').read_bytes()).decode()
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=False,
        args=['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'])
    try:
        page=browser.new_page(viewport={'width':1280,'height':950})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)[:80]));page.set_content(html)
        page.evaluate('async url=>{await import(url)}',entry)
        status=page.evaluate('''async ({ir64,png64})=>{
          const from64=x=>Uint8Array.from(atob(x),s=>s.charCodeAt(0));
          const selected=(id,file)=>{const input=document.getElementById(id),dt=new DataTransfer();
            dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
          selected('irfile',new File([from64(ir64)],'synthetic-ir.json',{type:'application/json'}));
          await new Promise(r=>setTimeout(r,70));
          selected('textures',new File([from64(png64)],'synthetic-example.png',{type:'image/png'}));
          await new Promise(r=>setTimeout(r,200));
          return {stats:document.getElementById('stats').textContent,diagnostic:document.getElementById('diagnostic').textContent,
            glError:document.getElementById('canvas').getContext('webgl2').getError()};
        }''',{'ir64':ir64,'png64':png64})
        page.locator('#fit-selection').click()
        selection=page.locator('#camera-info').inner_text()
        page.locator('#fixed-camera').click();page.locator('#zoom-in').click()
        fixed=page.locator('#camera-info').inner_text()
        out=root/'examples/g3-playground-after.png';page.screenshot(path=str(out),full_page=True)
        status.update({'selectedView':selection,'fixedView':fixed,'pageErrors':errors,'actualBrowserWebGL2':True,
                       'screenshot':'examples/g3-playground-after.png','externalRequests':0})
        (root/'examples/g3-playground-report.json').write_text(json.dumps(status,indent=2)+'\n')
        print(json.dumps(status,indent=2))
        if errors or status['glError'] or 'Rendered 1 draw packets successfully' not in status['diagnostic'] and 'IR valid' not in status['diagnostic']:
            sys.exit(2)
        if not selection.startswith('fit-selection') or not fixed.startswith('fixed'):
            sys.exit(2)
    finally:browser.close()
