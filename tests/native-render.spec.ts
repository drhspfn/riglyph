/** A22 true Rust-vs-JS draw-packet and headless parity. No skipped native cases:
 * CI MUST set RIGLYPH_NATIVE_BIN to a compiled executable.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fixture} from './helpers.js';
import {SkeletonInstance} from '@riglyph/runtime';
import {prepareDrawPackets} from '@riglyph/renderer-webgl2';
import {rasterize,HeadlessRenderEngine} from '@riglyph/renderer-cpu';
import type {RawTexture} from '@riglyph/renderer-cpu';
import type {DrawPacket,Viewport} from '@riglyph/renderer-webgl2';
import {createNativeRenderer,nativeBinaryPath} from '@riglyph/renderer-native';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const binary=process.env['RIGLYPH_NATIVE_BIN'];
assert.ok(binary,'RIGLYPH_NATIVE_BIN is mandatory for A22 external native acceptance');
const viewport:Viewport={left:0,bottom:0,width:10,height:10};
const tri=new Float32Array([1,1,9,1,1,9]);
const uv=new Float32Array([0,0,1,0,0,1]);
const indices=new Uint32Array([0,1,2]);
const texture=(pma=false):RawTexture=>{
 const bytes=new Uint8Array([255,40,20,255,0,100,200,128,90,180,50,255,0,0,0,0]);
 if(pma){bytes[4]=0;bytes[5]=50;bytes[6]=100;}
 return {width:2,height:2,rgba:bytes,premultiplied:pma,wrapU:'repeat',wrapV:'clamp'};
};
function packet(blend:DrawPacket['blend']='normal',pma=false,dark=false):DrawPacket{
 return{slotId:'slot',attachmentId:'attachment',pageId:'p',positions:tri,uvs:uv,indices,blend,pma,
  light:[.85,.6,.75,.75],dark:dark?[.05,.3,.2]:null};
}
function maxDelta(a:Uint8Array|Uint8ClampedArray,b:Uint8Array):{max:number,count:number}{
 assert.equal(a.length,b.length);let max=0,count=0;
 for(let i=0;i<a.length;i++){let d=Math.abs(a[i]!-b[i]!);max=Math.max(max,d);if(d>0)count++;}
 return{max,count};
}
test('native handshake, protocol and binary version',async()=>{
 const p=spawnSync(nativeBinaryPath(binary),['--version'],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/protocol=1/);
 const r=await createNativeRenderer({binaryPath:binary,threads:2});
 await r.dispose();
});
for(const sampling of ['nearest','linear'] as const)
 for(const pma of [false,true])
  for(const blend of ['normal','additive','multiply','screen'] as const)
   for(const dark of [false,true])
 test(`JS/Rust pixel parity ${sampling} ${pma?'PMA':'straight'} ${blend} ${dark?'dark':'light'}`,async()=>{
  const r=await createNativeRenderer({binaryPath:binary,threads:3});
  try{
   const textures=new Map([['p',texture(pma)]]);
   const packets=[packet(blend,pma,dark),packet(blend,pma,dark)];
   const config={packets,textures,viewport,width:48,height:36,clear:[.1,.2,.3,.25] as [number,number,number,number],sampling};
   const js=rasterize(packets,textures,viewport,48,36,config.clear,{sampling});
   const native=await r.render(config);
   const diff=maxDelta(js,native);
   assert.ok(diff.max<=1,`Pixel deviation ${JSON.stringify(diff)} for ${sampling}/${pma}/${blend}/${dark}`);
   assert.deepEqual(await r.render(config),native,'native repeated frame is not deterministic');
  }finally{await r.dispose();}
 });
test('native single-thread and parallel paths produce identical pixels',async()=>{
 const a=await createNativeRenderer({binaryPath:binary,threads:1});
 const b=await createNativeRenderer({binaryPath:binary,threads:4});
 try{
  const config={packets:[packet(),packet('screen')],textures:new Map([['p',texture()]]),
   viewport,width:100,height:80,clear:[0,0,0,0] as [number,number,number,number],sampling:'linear' as const};
  assert.deepEqual(await a.render(config),await b.render(config));
 }finally{await a.dispose();await b.dispose();}
});
test('canonical Riglyph animation packets render identically using headless JS and Rust backends',async()=>{
 const ir=fixture();const instance=new SkeletonInstance(ir).evaluate([{clipId:'rotate90',timeSec:.35}]);
 const packets=prepareDrawPackets(instance);assert.ok(packets.length>0);
 const rgba=new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
 const textures=new Map<string,RawTexture>([['page0',{width:2,height:2,rgba,premultiplied:false}]]);
 const native=await createNativeRenderer({binaryPath:binary,threads:2});
 try{
  const common={ir,textures,width:80,height:60,fps:10,camera:{mode:'fit-scene' as const,fit:'start' as const}};
  const js=new HeadlessRenderEngine(common);
  const rs=new HeadlessRenderEngine({...common,rasterBackend:native});
  const frameA=await js.renderFrame({clipId:'rotate90',timeSec:.35});
  const frameB=await rs.renderFrame({clipId:'rotate90',timeSec:.35});
  assert.ok(maxDelta(frameA.rgba,frameB.rgba).max<=1);
  const refsA:Uint8Array[]=[],refsB:Uint8Array[]=[];
  await js.renderSequence({clipId:'rotate90',startSec:0,endSec:.3,fps:10,onFrame:f=>{refsA.push(f.rgba)}});
  await rs.renderSequence({clipId:'rotate90',startSec:0,endSec:.3,fps:10,onFrame:f=>{refsB.push(f.rgba)}});
  assert.equal(refsA.length,3);refsA.forEach((f,i)=>assert.ok(maxDelta(f,refsB[i]!).max<=1));
 }finally{await native.dispose();}
});
test('native explicitly requested with invalid binary must fail; no silent fallback',async()=>{
 await assert.rejects(()=>createNativeRenderer({binaryPath:join(tmpdir(),'no-native-executable')}));
});
