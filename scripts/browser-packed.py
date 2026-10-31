#!/usr/bin/env python3
"""Real Chromium WebGL2 smoke loaded from external installed .tgz packages.
No network navigation: module graph is encoded into data URLs from consumer/node_modules.
"""
import json,sys,shutil,re,base64
from pathlib import Path
from playwright.sync_api import sync_playwright
consumer=Path(sys.argv[1]).resolve()
root=Path(__file__).resolve().parent.parent
# Use an import map with one data URL per installed .js/.json module.
# Unlike recursive inline data URL replacement, this grows linearly in source size.
mapdata={}
for pkg in ['core','runtime','renderer-webgl2','player-web']:
 dist=consumer/'node_modules'/'@riglyph'/pkg/'dist'
 for path in dist.rglob('*'):
  if path.suffix not in ('.js','.json'):continue
  key='universal/'+pkg+'/'+path.relative_to(dist).as_posix()
  if path.suffix=='.json':
   url='data:application/json;base64,'+base64.b64encode(path.read_bytes()).decode()
  else:
   content=path.read_text()
   def rewrite(m):
    spec=m.group(2)
    if spec.startswith('@riglyph/'):
     dst='universal/'+spec.split('/')[1]+'/index.js'
    elif spec.startswith('.'):
     dep=(path.parent/spec).resolve();dst='universal/'+pkg+'/'+dep.relative_to(dist.resolve()).as_posix()
    else:raise RuntimeError('Unknown module import: '+spec)
    return m.group(1)+dst+m.group(3)
   content=re.sub(r"((?:\bfrom\s*|\bimport\s*|\bimport\s*\()\s*['\"])([^'\"]+)(['\"])",rewrite,content)
   url='data:text/javascript;base64,'+base64.b64encode(content.encode()).decode()
  mapdata[key]=url
url='universal/player-web/index.js'
ir64=base64.b64encode((root/'fixtures/minimal.json').read_bytes()).decode()
png64=base64.b64encode((root/'fixtures/synthetic-example.png').read_bytes()).decode()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=False,
  args=['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'])
 try:
  page=browser.new_page(viewport={'width':960,'height':720})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content('''<!DOCTYPE html><html><head><script type="importmap">'''+json.dumps({'imports':mapdata})+'''</script></head><body><canvas id="canvas" width="320" height="240" style="width:320px;height:240px"></canvas><canvas id="other" width="320" height="240" style="width:320px;height:240px"></canvas></body></html>''')
  result=page.evaluate('''async ({moduleUrl,ir64,png64})=>{
   const {createPlayer}=await import(moduleUrl);
   const ir=JSON.parse(atob(ir64));const bytes=Uint8Array.from(atob(png64),s=>s.charCodeAt(0));
   const file=new File([bytes],'page.png',{type:'image/png'});
   const fetcher=async (url)=>{const p=new URL(url).pathname;
    if(p.endsWith('manifest.json'))return new Response(JSON.stringify({assetFormat:'universal-skeleton-asset',assetVersion:'1.0.0',ir:'skeleton.ir.json',pages:[{pageId:'page0',url:'page.png'}],defaultAnimation:'rotate90'}),{status:200});
    if(p.endsWith('skeleton.ir.json'))return new Response(JSON.stringify(ir),{status:200});
    if(p.endsWith('page.png'))return new Response(bytes,{status:200});
    return new Response('Not Found',{status:404});
   };
   const c=document.querySelector('#canvas'),o=document.querySelector('#other');
   const first=await createPlayer({canvas:c,assetUrl:'https://assets.example.test/manifest.json',autoResize:false,fetcher});
   const second=await createPlayer({canvas:o,assetUrl:'https://assets.example.test/manifest.json',autoResize:false,fetcher});
   const before={animations:first.animations().length,skins:first.skins().length,view:first.view,textureCount:first.document.atlases.pages.length};
   first.setAnimation('rotate90');first.seek(.5);first.setSkin('default');first.setCamera({mode:'fit-scene'});
   first.setSpeed(1);const beforeCapture=first.status.timeSec;
   const captureOpts={clipId:'rotate90',timeSec:.25,viewport:{left:-2,bottom:-2,width:4,height:4},capturedAtISO:'2026-10-30T00:00:00Z'};
   const capturedA=first.captureFixedFrame(captureOpts),capturedB=first.captureFixedFrame(captureOpts);
   const repeatable=capturedA.rgba.every((v,i)=>v===capturedB.rgba[i]);
   const capture={repeatable,restoredTime:first.status.timeSec===beforeCapture,
    duration:capturedA.playback.nominalDurationSec,speed:capturedA.playback.playbackSpeed,
    mixing:capturedA.playback.mix.active,loopCount:capturedA.playback.loopCount,
    fixedCamera:capturedA.playback.camera.mode==='fixed',pixelOrigin:capturedA.pixelOrigin,
    pixels:capturedA.rgba.length,painted:capturedA.rgba.filter((v,i)=>i%4===3&&v>0).length,
    stamp:capturedA.capturedAtISO};

   const gl=c.getContext('webgl2'),other=o.getContext('webgl2');
   first.render();const pixels=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   const paintedPixels=pixels.filter((x,i)=>i%4===3&&x>0).length;
   first.setCamera({mode:'fixed',viewport:{left:-2,bottom:-2,width:4,height:4}});first.pan(5,0);first.zoom(.9);first.resize();
   first.play('rotate90',{loop:true});await new Promise(r=>setTimeout(r,90));first.pause();
   const state={playing:first.status.playing,time:first.status.timeSec,cam:first.status.camera.mode};
   const glError=gl.getError(),otherGL=other.getError();
   first.dispose();second.seek(.4);
   const extension=other.getExtension('WEBGL_lose_context');let contextRestored='UNAVAILABLE';
   if(extension){extension.loseContext();await new Promise(r=>setTimeout(r,70));extension.restoreContext();await new Promise(r=>setTimeout(r,250));
    second.seek(.4);contextRestored=other.getError()===0&&second.instance!==null?'PASS':'FAIL';}
   const secondStatus=second.status;second.dispose();
   const replacement=await createPlayer({canvas:c,assetUrl:'https://assets.example.test/manifest.json',autoResize:false,fetcher});replacement.seek(.4);
   const restored=replacement.document!==null;replacement.dispose();
   let invalid=false;try{await createPlayer({canvas:c,assetUrl:'https://assets.example.test/no-file.json',autoResize:false,fetcher});}catch(e){invalid=true;}
   return {before,capture,state,glError,otherGL,paintedPixels,contextRestored,secondStatus,restored,missingManifestRejected:invalid};
  }''', {'moduleUrl':url,'ir64':ir64,'png64':png64})
  assert not errors,errors
  assert result['before']['animations']==1 and result['before']['textureCount']==1,result
  assert result['capture']['repeatable'] and result['capture']['restoredTime'] and result['capture']['fixedCamera'],result
  assert result['capture']['duration']==1 and result['capture']['speed']==1 and result['capture']['mixing'] is False,result
  assert result['capture']['pixelOrigin']=='top-left' and result['capture']['painted']>0,result
  assert result['glError']==0 and result['otherGL']==0,result
  assert result['paintedPixels']>0,result
  assert result['contextRestored'] in ('PASS','UNAVAILABLE'),result
  assert result['state']['playing'] is False and result['state']['time']>=.5,result
  assert result['state']['cam']=='fixed',result
  assert result['restored'] and result['missingManifestRejected'],result
  print(json.dumps(result))
 finally:browser.close()
