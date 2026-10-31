#!/usr/bin/env python3
"""G9 public browser playback API and controls; synthetic data only."""
import base64,json,re,shutil,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_importmap import map_modules
root=Path(__file__).resolve().parent.parent
imports=map_modules(root,['core','runtime','renderer-webgl2','player-web'])
client=(root/'dist/src/playground/client.js').read_text().replace("'@riglyph/core'","'universal/core/index.js'").replace("'@riglyph/player-web'","'universal/player-web/index.js'")
entry='data:text/javascript;base64,'+base64.b64encode(client.encode()).decode()
html=(root/'src/playground/index.html').read_text().replace('<script type="module" src="/engine/playground/client.js"></script>','')
html=re.sub(r'<script type="importmap">.*?</script>','<script type="importmap">'+json.dumps({'imports':imports})+'</script>',html,flags=re.DOTALL)
ir64=base64.b64encode((root/'fixtures/minimal.json').read_bytes()).decode();png64=base64.b64encode((root/'fixtures/synthetic-example.png').read_bytes()).decode()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=False,args=['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'])
 try:
  page=browser.new_page(viewport={'width':1300,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html);page.evaluate('async url=>await import(url)',entry)
  result=page.evaluate('''async ({ir64,png64})=>{
    const bytes=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
    const assign=(id,file)=>{const node=document.getElementById(id),dt=new DataTransfer();dt.items.add(file);node.files=dt.files;node.dispatchEvent(new Event('change',{bubbles:true}));};
    assign('irfile',new File([bytes(ir64)],'synthetic.json',{type:'application/json'}));
    await new Promise(r=>setTimeout(r,100));
    assign('textures',new File([bytes(png64)],'synthetic-example.png',{type:'image/png'}));
    await new Promise(r=>setTimeout(r,250));
    document.querySelector('[data-speed="0.25"]').click();
    const preset=document.querySelector('#speed-number').value;
    document.querySelector('#speed-number').value='0.29';document.querySelector('#speed-number').dispatchEvent(new Event('change'));
    const exact=document.querySelector('#speed-label').textContent;
    document.querySelector('#mix-duration').value='0.3';document.querySelector('#mix-duration').dispatchEvent(new Event('change'));
    document.querySelector('#animation').value='rotate90';
    document.querySelector('#crossfade').click();document.querySelector('#enqueue').click();
    const inspector=document.querySelector('#playback-inspector').textContent;
    document.querySelector('#clear-queue').click();
    document.querySelector('[data-speed="1"]').click();
    const reset=document.querySelector('#speed-label').textContent;
    const {createPlayer}=await import('universal/player-web/index.js');
    const ir=JSON.parse(atob(ir64)),png=new Blob([bytes(png64)],{type:'image/png'});
    ir.skeleton.animations.push({...ir.skeleton.animations[0],id:'clipB',name:'clipB',durationSec:4});
    const c1=document.createElement('canvas'),c2=document.createElement('canvas');c1.width=c2.width=100;c1.height=c2.height=100;document.body.append(c1,c2);
    const a=await createPlayer({canvas:c1,autoResize:false}),b=await createPlayer({canvas:c2,autoResize:false});
    await a.load({ir,pages:new Map([['page0',png]])});await b.load({ir,pages:new Map([['page0',png]])});
    const received=[];const off=a.on('transition',e=>received.push(e.type));
    a.setAnimation('rotate90');b.setAnimation('rotate90');a.play();a.setSpeed(.29);a.advance(1);
    const elapsed=a.diagnostics().elapsedTimelineSec;
    a.setDefaultMix(.3);a.transitionTo('clipB');a.enqueue('rotate90',{loop:false});
    const before=JSON.stringify(a.diagnostics()),bounds=JSON.stringify(a.view);
    const captured=a.captureFixedFrame({clipId:'clipB',timeSec:1,viewport:{left:-1,bottom:-1,width:2,height:2}});
    const preserved=JSON.stringify(a.diagnostics())===before&&JSON.stringify(a.view)===bounds;
    a.advance(.3/.29/2);const half=a.diagnostics().mix.alpha;
    a.setSpeed(0);const frozen=a.diagnostics();a.advance(1);const after=a.diagnostics();
    const still=after.elapsedTimelineSec===frozen.elapsedTimelineSec&&after.mix.elapsedSec===frozen.mix.elapsedSec&&after.loopCount===frozen.loopCount;
    const isolated=b.diagnostics().elapsedTimelineSec===0;
    const err=c1.getContext('webgl2').getError();off();a.dispose();b.dispose();
    return {preset,exact,reset,inspector,elapsed,half,preserved,still,isolated,events:received,rgba:captured.rgba.length,glError:err};
  }''',{'ir64':ir64,'png64':png64})
  assert not errors,errors
  assert result['preset']=='0.25',result
  assert '0.29' in result['exact'] and '1.00' in result['reset'],result
  assert 'track 0' in result['inspector'] and 'rotate90' in result['inspector'],result
  assert abs(result['elapsed']-.29)<1e-8 and abs(result['half']-.5)<1e-8,result
  assert result['preserved'] and result['still'] and result['isolated'],result
  assert result['events']==['transition'] and result['rgba']==40000 and result['glError']==0,result
  out=root/'reports/g9';out.mkdir(parents=True,exist_ok=True)
  page.screenshot(path=str(out/'g9-playground.png'),full_page=True)
  (out/'browser-g9.json').write_text(json.dumps({'status':'PASS','result':result,'pageErrors':errors},indent=2)+'\n')
  print(json.dumps({'status':'PASS','result':result,'pageErrors':errors},indent=2))
 finally:browser.close()
