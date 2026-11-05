import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineError,validateIR} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
import {prepareDrawPackets,triangulatePolygon,inspectPolygon,clipAgainstTriangle} from '@riglyph/renderer-webgl2';
import type {GeometryDiagnostic} from '@riglyph/renderer-webgl2';
import {HeadlessRenderEngine} from '@riglyph/renderer-cpu';
import {addSlot,addAttachment} from './helpers.js';
import {dynamicClipFixture} from './geometry-fixture.js';

const points=(xy:number[][])=>xy.map(([x,y])=>({x:x!,y:y!,u:x!,v:y!}));
const area=(tris:ReturnType<typeof triangulatePolygon>)=>tris.reduce((sum,[a,b,c])=>sum+Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2,0);
test('concave, reversed and collinear boundaries preserve area over coordinate scales',()=>{
 for(const scale of [1e-12,1e-5,1,1e6,1e15])for(const reverse of [false,true]){
  const p=points([[0,0],[2,0],[4,0],[4,4],[2,2],[0,4]].map(v=>v.map(x=>x*scale)));
  if(reverse)p.reverse();assert.ok(Math.abs(area(triangulatePolygon(p))/(12*scale*scale)-1)<1e-12);
 }
});
test('strict rejects crossings, touches, overlapping edges, duplicates and zero area',()=>{
 const cases=[[[0,0],[4,4],[0,4],[4,0]],[[0,0],[4,0],[4,4],[2,0],[0,4]],
  [[0,0],[4,0],[4,4],[1,0],[3,0],[0,4]],[[0,0],[4,0],[4,0],[0,4]],[[0,0],[1,0],[2,0]]];
 for(const p of cases)assert.throws(()=>triangulatePolygon(points(p)),e=>e instanceof EngineError&&e.code==='INVALID_TOPOLOGY');
 assert.equal(inspectPolygon(points(cases[0]!)).issues[0]!.classification,'edge-crossing');
 assert.deepEqual(inspectPolygon(points(cases[0]!)).issues[0]!.intersection,[2,2]);
});
test('geometry rejects nonfinite inputs and excessive vertices before decomposition',()=>{
 assert.throws(()=>triangulatePolygon(points([[0,0],[Infinity,1],[0,1]])),/Non-finite/);
 assert.throws(()=>triangulatePolygon(Array.from({length:4097},(_,i)=>({x:i,y:i%2,u:0,v:0}))),
  e=>e instanceof EngineError&&e.code==='LIMIT_EXCEEDED');
});
test('near crossings are distinguished without a world-unit epsilon',()=>{
 for(const scale of [1e-12,1,1e12]){
  const p=points([[0,0],[4,0],[4,4],[2,1e-10],[0,4]].map(v=>v.map(x=>x*scale)));
  assert.equal(inspectPolygon(p).issues.length,0);assert.ok(area(triangulatePolygon(p))>0);
  p[3]!.y=-1e-10*scale;assert.throws(()=>triangulatePolygon(p),/self-intersection/);
 }
});
test('compatible even-odd bow tie has two lobes, explicit warning and no overlapping fill',()=>{
 for(const reverse of [false,true]){
  const p=points([[0,0],[4,4],[0,4],[4,0]]);if(reverse)p.reverse();let warned=0;
  const triangles=triangulatePolygon(p,'compatible',()=>warned++);
  assert.equal(warned,1);assert.equal(area(triangles),8);
  assert.deepEqual(triangulatePolygon(p,'compatible',()=>{}),triangles);
 }
 assert.throws(()=>triangulatePolygon(points([[0,0],[4,0],[4,0],[0,4]]),'compatible'),/zero-length/);
});
test('clipping preserves affine UV interpolation at small and large scales',()=>{
 for(const scale of [1e-8,1,1e8]){
  const input=points([[0,0],[4,0],[0,4]]),clip=points([[0,0],[2,0],[0,2]]);
  for(const p of [...input,...clip]){p.x*=scale;p.y*=scale;}
  const output=clipAgainstTriangle(input as any,clip as any);
  assert.ok(Math.abs(area(output)/(2*scale*scale)-1)<1e-12);
  for(const t of output)for(const p of t){assert.ok(Math.abs(p.x/scale-p.u)<1e-12);assert.ok(Math.abs(p.y/scale-p.v)<1e-12);}
 }
});

test('weighted deform crossing carries a complete contextual reproduction and deterministic seeks',()=>{
 const ir=dynamicClipFixture(),s=new SkeletonInstance(ir),records:GeometryDiagnostic[]=[];
 s.evaluate([{clipId:'dynamic',timeSec:.5}]);
 assert.throws(()=>prepareDrawPackets(s,{clipId:'dynamic',timeSec:.5,frameIndex:6,onGeometryDiagnostic:d=>records.push(d)}),/slot clip, attachment mask/);
 const d=records[0]!;assert.equal(d.frameIndex,6);assert.equal(d.timeSec,.5);assert.equal(d.deform.basis,'influence_delta');
 assert.equal(d.localVertices.length,4);assert.equal(d.worldVertices.length,8);assert.ok(d.boneMatrices['mask']);
 const options={clippingPolicy:'compatible' as const,onGeometryWarning:()=>{}};
 const expected=prepareDrawPackets(s,options);
 for(const time of [0,.75,.5,1,.5]){s.evaluate([{clipId:'dynamic',timeSec:time}]);if(time===.5)assert.deepEqual(prepareDrawPackets(s,options),expected);}
});
test('full dynamic clipping sequence inspects alpha, changing frames and stable viewport',async()=>{
 const ir=dynamicClipFixture(),texture={width:2,height:2,rgba:new Uint8Array(16).fill(255),premultiplied:false};
 const engine=new HeadlessRenderEngine({ir,textures:new Map([['page0',texture]]),width:48,height:48,
  geometry:{clippingPolicy:'compatible',onGeometryWarning:()=>{}}});
 const images:Uint8Array[]=[],views:string[]=[];
 await engine.renderSequence({clipId:'dynamic',startSec:0,endSec:1,fps:12,onFrame:f=>{
  assert.ok(f.rgba.some((v,i)=>i%4===3&&v>0),'every frame contains visible geometry');
  assert.ok(f.rgba.some((v,i)=>i%4===3&&v===0),'transparent exterior is preserved');images.push(f.rgba);views.push(JSON.stringify(f.viewport));
 }});
 assert.equal(images.length,12);assert.equal(new Set(views).size,1);assert.notDeepEqual(images[0],images[6]);
});
test('sequential clipping scopes close inclusively and reset across frames and draw-order changes',()=>{
 const ir=dynamicClipFixture();const end=ir.skeleton.slots[0]!;
 addSlot(ir,'second','root','second-mask');addSlot(ir,'second-end','root',end.setupAttachmentId);
 const first=ir.skeleton.attachments.find(a=>a.id==='mask')!;
 addAttachment(ir,{...structuredClone(first),id:'second-mask',endSlotId:'second-end'} as any,'second','second-mask');
 const s=new SkeletonInstance(ir).evaluate();assert.equal(prepareDrawPackets(s).length,2);
 s.drawOrder=['clip','second',end.id,'second-end'];assert.throws(()=>prepareDrawPackets(s),/Overlapping/);
 s.evaluate();assert.equal(prepareDrawPackets(s).length,2);
 s.slots.get('clip')!.attachmentId=null;assert.equal(prepareDrawPackets(s).length,2);
 s.activeBones.delete('mask'); // weighted transform remains sampled; owning root remains active
 s.drawOrder=['clip',end.id,'second','second-end'];assert.equal(prepareDrawPackets(s).length,2);
 for(const scale of [-2,2]){ir.skeleton.bones[0]!.setup.scaleX=scale;ir.skeleton.bones[0]!.setup.scaleY=.5;s.evaluate();assert.equal(prepareDrawPackets(s).length,2);}
});
