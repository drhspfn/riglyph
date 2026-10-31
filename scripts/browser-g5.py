#!/usr/bin/env python3
"""G5 packed consumer WebGL2 lifecycle / error regression. Own synthetic assets only."""
import json,sys,shutil,re,base64,threading,tempfile
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
consumer=Path(sys.argv[1]).resolve()
root=Path(__file__).resolve().parent.parent
imports={}
for pkg in ['core','runtime','renderer-webgl2','player-web']:
 dist=consumer/'node_modules'/'@riglyph'/pkg/'dist'
 for path in dist.rglob('*'):
  if path.suffix not in ('.js','.json'): continue
  key='universal/'+pkg+'/'+path.relative_to(dist).as_posix()
  if path.suffix=='.json': content=path.read_bytes();mime='application/json'
  else:
   text=path.read_text()
   def rewrite(m):
    spec=m.group(2)
    if spec.startswith('@riglyph/'): dest='universal/'+spec.split('/')[1]+'/index.js'
    elif spec.startswith('.'):dest='universal/'+pkg+'/'+(path.parent/spec).resolve().relative_to(dist.resolve()).as_posix()
    else:raise RuntimeError('Unexpected nonbrowser import: '+spec)
    return m.group(1)+dest+m.group(3)
   text=re.sub(r"((?:\bfrom\s*|\bimport\s*|\bimport\s*\()\s*['\"])([^'\"]+)(['\"])",rewrite,text)
   content=text.encode();mime='text/javascript'
  imports[key]='data:'+mime+';base64,'+base64.b64encode(content).decode()
ir64=base64.b64encode((root/'fixtures/minimal.json').read_bytes()).decode()
png64=base64.b64encode((root/'fixtures/synthetic-example.png').read_bytes()).decode()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=False,
   args=['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'])
 try:
  page=browser.new_page(viewport={'width':760,'height':560})
  errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.set_content('<!DOCTYPE html><html><head><script type="importmap">'+json.dumps({'imports':imports})+'</script></head><body><canvas id="a" width="160" height="120"></canvas><canvas id="b" width="160" height="120"></canvas></body></html>')
  report=page.evaluate('''async ({ir64,png64})=>{
   const {createPlayer}=await import('universal/player-web/index.js');
   const ir=JSON.parse(atob(ir64)),bytes=Uint8Array.from(atob(png64),c=>c.charCodeAt(0));
   const manifest=(options={})=>({assetFormat:'universal-skeleton-asset',assetVersion:'1.0.0',ir:'skeleton.ir.json',pages:[{pageId:'page0',url:'page.png'}],defaultAnimation:'rotate90',...options});
   let pauseFetch;
   const fetcher=async (url,options)=>{
    if(url.includes('/slow/'))await new Promise(resolve=>{pauseFetch=resolve;options.signal?.addEventListener('abort',resolve,{once:true});});
    const u=new URL(url),scenario=u.pathname.split('/').filter(Boolean).at(0),leaf=u.pathname.split('/').at(-1);
    if(scenario==='404')return new Response('missing',{status:404});
    if(leaf==='manifest.json'){
     const m=scenario==='bad-default'?manifest({defaultAnimation:'missing-clip'}):
       scenario==='duplicate'?manifest({pages:[{pageId:'page0',url:'page.png'},{pageId:'page0',url:'page2.png'}]}):
       scenario==='bad-version'?manifest({assetVersion:'9.0.0'}):
       scenario==='unsafe'?manifest({ir:'../steal.json'}):
       scenario==='encoded'?manifest({ir:'textures/%2e%2e/skeleton.ir.json'}):manifest();
     return new Response(JSON.stringify(m),{status:200});
    }
    if(leaf==='skeleton.ir.json')return new Response(JSON.stringify(scenario==='bad-schema'?{...ir,schemaVersion:'2.0.0'}:ir),{status:200});
    if(leaf==='page.png')return new Response(scenario==='bad-png'?new Uint8Array([3,4,5,6,7]):bytes,{status:200,headers:scenario==='oversize'?{'content-length':String(70*1024*1024)}:{}});
    return new Response('missing',{status:404});
   };
   const base='https://assets.example.test/';
   const first=await createPlayer({canvas:document.querySelector('#a'),fetcher,autoResize:false,assetUrl:base+'good/manifest.json'});
   first.seek(.45);first.setAnimation('rotate90');first.play('rotate90');
   const snapshot=first.document, status=first.status;
   const failures={};
   for(const [name,code] of Object.entries({'bad-default':'ANIMATION_NOT_FOUND','duplicate':'INVALID_REFERENCE','bad-version':'UNSUPPORTED_IR_SCHEMA','bad-schema':'UNSUPPORTED_IR_SCHEMA','unsafe':'INVALID_ATLAS','encoded':'INVALID_ATLAS','bad-png':'INVALID_ATLAS','oversize':'LIMIT_EXCEEDED','404':'MISSING_TEXTURE_PAGE'})){
    try{await first.loadUrl(base+name+'/manifest.json');failures[name]='unexpected-success';}
    catch(error){failures[name]=error.code??error.name;}
    if(first.document!==snapshot||first.status.animation!==status.animation||first.status.playing!==status.playing)throw Error('Atomic rollback failed for '+name);
   }
   const wrong=new Map([['page0',new Blob([new Uint8Array([1,2,3])],{type:'image/png'})]]);
   let badLoad;
   try{await first.load({ir,pages:wrong});badLoad='unexpected-success';}catch(e){badLoad=e.code;}
   if(first.document!==snapshot)throw Error('Direct load lost previous scene');
   const slow=first.loadUrl(base+'slow/manifest.json').then(()=> 'unexpected-success',e=>e.code);
   await new Promise(resolve=>setTimeout(resolve,20));
   await first.loadUrl(base+'good/manifest.json');const slowCode=await slow;
   const second=await createPlayer({canvas:document.querySelector('#b'),fetcher,autoResize:false});
   const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
   await second.load({ir,pages:new Map([['page0',bitmap]])});bitmap.close();
   const ext=second.canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
   let restored='UNAVAILABLE';
   if(ext){ext.loseContext();await new Promise(resolve=>setTimeout(resolve,45));ext.restoreContext();await new Promise(resolve=>setTimeout(resolve,180));second.seek(.25);restored=second.canvas.getContext('webgl2').getError()===0?'PASS':'FAIL';}
   const gone=first.loadUrl(base+'slow/manifest.json').then(()=> 'unexpected-success',e=>e.code);
   await new Promise(resolve=>setTimeout(resolve,20));first.dispose();const disposeCode=await gone;
   second.dispose();
   let noWebGL='UNAVAILABLE';
   const fake=document.createElement('canvas');fake.getContext=()=>null;
   try{await createPlayer({canvas:fake,autoResize:false});noWebGL='unexpected-success';}catch(e){noWebGL=e.code;}
   return {failures,badLoad,slowCode,disposeCode,restored,noWebGL,glError:second.canvas.getContext('webgl2').getError()};
  }''', {'ir64':ir64,'png64':png64})
  assert not errors,errors
  for name,expected in {'bad-default':'ANIMATION_NOT_FOUND','duplicate':'INVALID_REFERENCE','bad-version':'UNSUPPORTED_IR_SCHEMA','bad-schema':'UNSUPPORTED_IR_SCHEMA','unsafe':'INVALID_ATLAS','encoded':'INVALID_ATLAS','bad-png':'INVALID_ATLAS','oversize':'LIMIT_EXCEEDED','404':'MISSING_TEXTURE_PAGE'}.items():
   assert report['failures'][name]==expected,report
  assert report['badLoad']=='INVALID_ATLAS',report
  assert report['slowCode']=='INVALID_REFERENCE' and report['disposeCode']=='INVALID_REFERENCE',report
  assert report['restored']=='PASS',report
  assert report['noWebGL']=='UNSUPPORTED_SEMANTIC_FEATURE',report
  assert report['glError']==0,report
  # Real local HTTP, not a supplied fetcher: static manifest/IR/Unicode texture.
  with tempfile.TemporaryDirectory(prefix='skeleton-g5-http-') as served:
   site=Path(served);(site/'scene'/'textures').mkdir(parents=True)
   (site/'scene'/'skeleton.ir.json').write_bytes((root/'fixtures/minimal.json').read_bytes())
   (site/'scene'/'textures'/'вид тест.png').write_bytes((root/'fixtures/synthetic-example.png').read_bytes())
   (site/'scene'/'manifest.json').write_text(json.dumps({'assetFormat':'universal-skeleton-asset','assetVersion':'1.0.0','ir':'skeleton.ir.json','pages':[{'pageId':'page0','url':'textures/вид тест.png'}],'defaultAnimation':'rotate90'}))
   (site/'index.html').write_text('<!DOCTYPE html><html><head><script type="importmap">'+json.dumps({'imports':imports})+'</script></head><body><canvas id="httpcanvas" width="320" height="240"></canvas></body></html>')
   class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=served,**kwargs)
    def log_message(self,*args):pass
   server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
   t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
   url=f'http://127.0.0.1:{server.server_port}/index.html'
   try:
    try:
     page.goto(url,wait_until='domcontentloaded',timeout=10000)
     native=page.evaluate("""async ()=>{
      const {createPlayer}=await import('universal/player-web/index.js');
      const instance=await createPlayer({canvas:document.querySelector('#httpcanvas'),assetUrl:'./scene/manifest.json',autoResize:false});
      instance.seek(.25);instance.render();
      const gl=instance.canvas.getContext('webgl2'),pixels=new Uint8Array(instance.canvas.width*instance.canvas.height*4);
      gl.readPixels(0,0,instance.canvas.width,instance.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      const result={pages:instance.document.atlases.pages.length,painted:pixels.filter((x,i)=>i%4===3&&x>0).length,error:gl.getError()};
      instance.dispose();return result;
     }""")
     assert native['pages']==1 and native['painted']>0 and native['error']==0,native
     report['nativeHttp']=native
    except Exception as error:
     report['nativeHttp']={'status':'NOT_VERIFIED','reason':str(error)[:250]}
   finally:server.shutdown();server.server_close()
  print(json.dumps({'result':'PASS','cases':len(report['failures'])+5,**report}))
 finally:browser.close()
