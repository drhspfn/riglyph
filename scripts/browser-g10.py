#!/usr/bin/env python3
"""Synthetic browser G10 API regression: WebGL2, single AnimationPlayer state, no reference data."""
import base64,json,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_importmap import map_modules
root=Path(__file__).resolve().parent.parent
imports=map_modules(root,['core','runtime','renderer-webgl2','player-web'])
ir64=base64.b64encode((root/'fixtures/minimal.json').read_bytes()).decode()
png64=base64.b64encode((root/'fixtures/synthetic-example.png').read_bytes()).decode()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=False,args=['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'])
 try:
  page=browser.new_page(viewport={'width':800,'height':620});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content('<!DOCTYPE html><html><head><script type="importmap">'+json.dumps({'imports':imports})+'</script></head><body><canvas id="a" width="96" height="96"></canvas><canvas id="b" width="96" height="96"></canvas></body></html>')
  result=page.evaluate('''async ({ir64,png64})=>{
   const bytes=x=>Uint8Array.from(atob(x),s=>s.charCodeAt(0));
   const {createPlayer}=await import('universal/player-web/index.js');
   const ir=JSON.parse(atob(ir64));ir.skeleton.animations.push({...ir.skeleton.animations[0],id:'secondary',name:'secondary',durationSec:4});
   const png=new Blob([bytes(png64)],{type:'image/png'});
   const ca=document.querySelector('#a'),cb=document.querySelector('#b');
   const a=await createPlayer({canvas:ca,autoResize:false}),b=await createPlayer({canvas:cb,autoResize:false});
   await a.load({ir,pages:new Map([['page0',png]])});await b.load({ir,pages:new Map([['page0',png]])});
   const notices=[];const unsub=a.on('transition',n=>notices.push(n));
   a.setDefaultMix(.3);a.setAnimation('rotate90');
   const direct=a.diagnostics().mix.active===false;
   a.play('secondary',{loop:true});const legacyInstant=a.diagnostics().mix.active===false;
   a.setSpeed(.29);a.advance(1);const slowed=a.diagnostics().elapsedTimelineSec;
   a.transitionTo('rotate90');a.enqueue('secondary',{loop:false});a.advance(.3/.29/2);
   const alpha=a.diagnostics().mix.alpha,queueSize=a.diagnostics().queue.length;
   const before=JSON.stringify(a.diagnostics()),viewport=JSON.stringify(a.view);
   const fixed=a.captureFixedFrame({clipId:'rotate90',timeSec:.5,viewport:{left:-2,bottom:-2,width:4,height:4}});
   const captureUnchanged=before===JSON.stringify(a.diagnostics())&&viewport===JSON.stringify(a.view);
   a.setSpeed(0);const frozen=a.diagnostics();a.advance(1);const afterFreeze=a.diagnostics();const stopped=afterFreeze.elapsedTimelineSec===frozen.elapsedTimelineSec&&afterFreeze.mix.elapsedSec===frozen.mix.elapsedSec&&afterFreeze.loopCount===frozen.loopCount;
   a.setSpeed(1);a.advance(.15);const mixCompleted=!a.diagnostics().mix.active;
   const isolated=b.diagnostics().tracks.length===0;
   let contextRestore='UNAVAILABLE';const extension=ca.getContext('webgl2').getExtension('WEBGL_lose_context');
   if(extension){a.transitionTo('secondary',{mixDurationSec:.5});a.advance(.1);const active=a.diagnostics().mix.active;
    extension.loseContext();await new Promise(r=>setTimeout(r,60));const frozenMix=a.diagnostics().mix.active;
    extension.restoreContext();await new Promise(r=>setTimeout(r,350));
    contextRestore=active&&frozenMix&&!a.diagnostics().playing&&a.diagnostics().mix.active?'PASS':'FAIL';}
   const err=ca.getContext('webgl2').getError();unsub();a.dispose();b.dispose();
   return {direct,legacyInstant,slowed,alpha,queueSize,captureUnchanged,stopped,mixCompleted,isolated,contextRestore,noticeCount:notices.length,frameBytes:fixed.rgba.length,glError:err};
  }''',{'ir64':ir64,'png64':png64})
  assert not errors,errors
  assert result['direct'] and result['legacyInstant'] and result['captureUnchanged'] and result['stopped'] and result['isolated'],result
  assert abs(result['slowed']-.29)<1e-8 and abs(result['alpha']-.5)<1e-8,result
  assert result['queueSize']==1 and result['mixCompleted'],result
  assert result['contextRestore'] in ('UNAVAILABLE','PASS') and result['glError']==0,result
  assert result['noticeCount']>=1 and result['frameBytes']==96*96*4,result
  out=root/'reports/g10';out.mkdir(parents=True,exist_ok=True)
  (out/'browser-g10.json').write_text(json.dumps({'status':'PASS','result':result,'pageErrors':errors,'referenceVerified':False},indent=2)+'\n')
  print(json.dumps({'status':'PASS','result':result,'pageErrors':errors},indent=2))
 finally:browser.close()
