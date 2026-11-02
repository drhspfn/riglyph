import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,addBone} from './helpers.js';
import {validateIR} from '@riglyph/core';
import {HeadlessRenderEngine,countScheduledFrames} from '@riglyph/renderer-cpu';
import type {RawTexture,HeadlessOptions} from '@riglyph/renderer-cpu';
import {decodePNG,parseRenderOptions} from '@riglyph/cli';

function engine(overrides:Partial<HeadlessOptions>={}):HeadlessRenderEngine{
 const ir=fixture();
 const tex=new Uint8Array([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255]);
 const textures=new Map<string,RawTexture>([['page0',{width:2,height:2,rgba:tex,premultiplied:false}]]);
 return new HeadlessRenderEngine({ir,textures,width:32,height:32,fps:10,...overrides});
}
test('headless frame sampler deterministic with no browser or WebGL',async()=>{
 const r=engine();
 const first=await r.renderFrame({clipId:'rotate90',timeSec:0});
 const last=await r.renderFrame({clipId:'rotate90',timeSec:.5});
 assert.equal(first.rgba.length,32*32*4);
 assert.deepEqual(first.rgba,(await r.renderFrame({clipId:'rotate90',timeSec:0})).rgba);
 assert.notDeepEqual(first.rgba,last.rgba,'animated geometry must change');
 assert.ok([...first.rgba].some(n=>n>0));
});
test('frame schedule is integer-index based, half-open unless endpoint requested',()=>{
 assert.equal(countScheduledFrames(0,3,60),180);
 assert.equal(countScheduledFrames(0,1,3),3);
 assert.equal(countScheduledFrames(0,1,3,true),4);
 assert.equal(countScheduledFrames(0,1.1,2,true),4);
 assert.equal(countScheduledFrames(.2,.7,4),2);
 assert.equal(countScheduledFrames(0,0,30,true),1);
 assert.throws(()=>countScheduledFrames(0,0,30));
 assert.throws(()=>countScheduledFrames(0,1,0));
 assert.throws(()=>countScheduledFrames(0,Infinity,30));
 assert.throws(()=>countScheduledFrames(0,5000,120));
});
test('sequence streams frames individually, respects offsets/loops and abort signals',async()=>{
 const r=engine(),samples:number[]=[];
 const result=await r.renderSequence({clipId:'rotate90',startSec:.2,endSec:.7,fps:4,
  onFrame:async f=>{samples.push(f.timeSec);}});
 assert.deepEqual(samples,[.2,.45]);assert.equal(result.frameCount,2);
 const inclusive:number[]=[];
 await r.renderSequence({clipId:'rotate90',startSec:0,endSec:1.1,fps:2,includeEnd:true,onFrame:f=>{inclusive.push(f.timeSec);}});
 assert.deepEqual(inclusive,[0,.5,1,1.1]);
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(()=>r.renderSequence({clipId:'rotate90',startSec:0,endSec:1,fps:10,
  signal:aborted.signal,onFrame:()=>{throw Error('must not render');}}),/cancelled/);
 const loops:number[]=[];
 await r.renderSequence({clipId:'rotate90',startSec:0,endSec:3,fps:2,loop:true,
  onFrame:f=>{loops.push(f.timeSec);}});
 assert.equal(loops.length,6);
 assert.deepEqual((await r.renderFrame({clipId:'rotate90',timeSec:.5})).rgba,
  (await r.renderFrame({clipId:'rotate90',timeSec:1.5,loop:true})).rgba);
});
test('transparent and opaque backgrounds, nearest and linear sampling, supersample',async()=>{
 const plain=await engine({background:{mode:'transparent'}}).renderFrame({timeSec:0});
 const green=await engine({background:{mode:'solid',color:'#00FF00'}}).renderFrame({timeSec:0});
 assert.equal(plain.rgba[3],0);
 assert.equal(green.rgba[0],0);assert.equal(green.rgba[1],255);assert.equal(green.rgba[2],0);assert.equal(green.rgba[3],255);
 const ss=await engine({quality:{supersampling:2,sampling:'linear'}}).renderFrame({timeSec:0});
 assert.equal(ss.rgba.length,plain.rgba.length);
 assert.ok([...ss.rgba].some(x=>x>0));
 assert.throws(()=>engine({width:4096,height:4096,quality:{supersampling:4}}),/surface/);
});
test('fixed, follow and animation-stable cameras are deterministic',async()=>{
 const ir=fixture();addBone(ir,'follow');
 ir.skeleton.animations=[{id:'move',name:'move',durationSec:1,timelines:[{
  targetKind:'bone',targetId:'follow',property:'x',deformBasis:'none',
  keys:[{timeSec:0,value:0,interpolation:{kind:'linear'}},{timeSec:1,value:20,interpolation:{kind:'linear'}}]}]}];
 validateIR(ir);
 const options={ir} as Partial<HeadlessOptions>;
 const fixed=engine({...options,camera:{mode:'fixed',worldWidth:20,x:3,y:-2}});
 const f=await fixed.renderFrame({clipId:'move',timeSec:.5});
 assert.equal(f.viewport.width,20);assert.equal(f.viewport.left,-7);
 const follow=engine({...options,camera:{mode:'follow',targetBoneId:'follow',worldWidth:20}});
 const a=await follow.renderFrame({clipId:'move',timeSec:0}),b=await follow.renderFrame({clipId:'move',timeSec:1});
 assert.ok(b.viewport.left>a.viewport.left+19);
 const stable=engine({...options,camera:{mode:'fit-scene',fit:'animation'}});
 const views:string[]=[];
 await stable.renderSequence({clipId:'move',startSec:0,endSec:1,fps:4,
  onFrame:frame=>{views.push(JSON.stringify(frame.viewport));}});
 assert.equal(new Set(views).size,1);
});
test('CLI renderer rejects unknown args and honors explicit config overrides',async()=>{
 const root=await mkdtemp(join(tmpdir(),'riglyph-render-'));
 try{
  const file=join(root,'cfg.json');
  const {writeFile}=await import('node:fs/promises');
  await writeFile(file,JSON.stringify({fps:23,width:20,format:'png-sequence'}));
  const o=await parseRenderOptions(['--config',file,'--fps','17']);
  assert.equal(o.fps,17);assert.equal(o.width,20);
  await assert.rejects(()=>parseRenderOptions(['--bogus','abc']),/Unknown render option/);
  await writeFile(file,JSON.stringify({camera:{mode:'fixed',madeUp:1}}));
  await assert.rejects(()=>parseRenderOptions(['--config',file]),/Unknown camera field/);
  await writeFile(file,JSON.stringify({timeline:[{atSec:0,track:0,clipId:'idle',bad:1}]}));
  await assert.rejects(()=>parseRenderOptions(['--config',file]),/Unknown timeline action field/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI writes actual PNG frames and manifest; existing destination is protected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'riglyph-png-'));
 const out=join(root,'frames');
 try{
  const cli=resolve('packages/cli/dist/cli/main.js');
  const args=[cli,'render',resolve('fixtures/minimal.json'),'--images',resolve('fixtures'),
   '--clip','rotate90','--start','0','--end','1','--fps','4','--width','32','--height','32',
   '--out-dir',out,'--progress','none'];
  const a=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});
  assert.equal(a.status,0,a.stderr+'\n'+a.stdout);
  const names=await readdir(out);
  assert.ok(names.includes('frame_000000.png'));assert.ok(names.includes('frame_000003.png'));
  assert.equal(names.filter(x=>x.endsWith('.png')).length,4);
  const frame=decodePNG(await readFile(join(out,'frame_000001.png')));
  assert.equal(frame.width,32);assert.equal(frame.height,32);
  const manifest=JSON.parse(await readFile(join(out,'render-manifest.json'),'utf8'));
  assert.equal(manifest.status,'completed');assert.equal(manifest.frameCount,4);
  const b=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});
  assert.notEqual(b.status,0);assert.match(b.stderr,/OUTPUT_EXISTS/);
  const c=spawnSync(process.execPath,[...args,'--overwrite'],{encoding:'utf8',timeout:30000});
  assert.equal(c.status,0,c.stderr);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('bounded-memory sequence renders 180 frames without accumulating RGBA arrays',async()=>{
 const r=engine({width:64,height:64,fps:60});
 const first=process.memoryUsage().rss;
 let peak=first,count=0;
 await r.renderSequence({clipId:'rotate90',startSec:0,endSec:3,fps:60,
  onFrame:(frame,index,total)=>{
   assert.equal(frame.rgba.length,64*64*4);
   assert.equal(index,count++);assert.equal(total,180);
   peak=Math.max(peak,process.memoryUsage().rss);
  }});
 assert.equal(count,180);
 const growth=peak-first;
 console.log(`A21_MEMORY_BEHAVIOR frames=180 frameBytes=16384 startRss=${first} peakRss=${peak} deltaBytes=${growth}`);
 assert.ok(growth<128*1024*1024,`Unexpected RSS growth ${growth} across 180 frames`);
});

test('timeline rejects unknown future clips before output and disallows nonfinite time',async()=>{
 const r=engine();
 await assert.rejects(()=>r.renderFrame({timeSec:.25,timeline:[{atSec:4,track:0,clipId:'not-found'}]}),/Unknown render timeline clip/);
 await assert.rejects(()=>r.renderFrame({timeSec:.25,timeline:[{atSec:NaN,track:0,clipId:'rotate90'}]}),/Invalid render timeline event/);
});
