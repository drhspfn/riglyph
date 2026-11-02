/** A21 integration regressions: track mixing, constrained poses, camera and validation. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone,addMesh,addSlot} from './helpers.js';
import type {IRDocument,Vertex} from '@riglyph/core';
import {validateIR} from '@riglyph/core';
import {HeadlessRenderEngine} from '@riglyph/renderer-cpu';
import type {RawTexture} from '@riglyph/renderer-cpu';
const rgba=new Uint8Array(16).fill(255);
const textures=new Map<string,RawTexture>([['page0',{width:2,height:2,rgba,premultiplied:false}]]);
const make=(ir:IRDocument,camera:ConstructorParameters<typeof HeadlessRenderEngine>[0]['camera']={mode:'fixed',worldWidth:5})=>
 new HeadlessRenderEngine({ir,textures,width:64,height:64,fps:20,camera,background:{mode:'transparent'}});
const hasInk=(data:Uint8Array)=>data.filter((_,i)=>i%4===3).some(v=>v>0);
test('serialized multiple tracks/mixing evaluate from absolute render-time configuration',async()=>{
 const ir=fixture(),a=ir.skeleton.animations[0]!;
 const b=structuredClone(a);b.id='reverse';b.name='reverse';
 b.timelines[0]!.keys[1]!.value=-90;
 ir.skeleton.animations.push(b);
 const attach=ir.skeleton.attachments[0]!;
 if(attach.kind==='region')attach.local.x=1.4;
 validateIR(ir);
 const r=make(ir);
 const actions=[
  {atSec:0,track:0,clipId:a.id,loop:true,mixDurationSec:0},
  {atSec:.25,track:0,clipId:b.id,loop:false,mixDurationSec:.5},
  {atSec:.6,track:1,clipId:a.id,loop:true,mixDurationSec:0}
 ];
 const p=await r.renderFrame({timeSec:.45,timeline:actions});
 const repeated=await r.renderFrame({timeSec:.45,timeline:actions});
 assert.deepEqual(p.rgba,repeated.rgba);
 const before=await r.renderFrame({timeSec:.1,timeline:actions});
 assert.notDeepEqual(before.rgba,p.rgba,'timeline must visibly mix source poses');
 const later=await r.renderFrame({timeSec:.75,timeline:actions});
 assert.deepEqual(later.rgba,(await r.renderFrame({timeSec:.75,timeline:actions})).rgba);
});
test('IK constraints drive actual exported draw packets rather than being bypassed',async()=>{
 const ir=fixture();
 const bone=addBone(ir,'aim');Object.assign(bone.setup,{x:0,y:0,length:3});
 ir.skeleton.slots[0]!.boneId='aim';
 const target=addBone(ir,'target');target.setup.x=4;target.setup.y=0;
 ir.skeleton.constraints.push({id:'follow-ik',kind:'ik',order:0,
  boneIds:['aim'],targetBoneId:'target',targetSlotId:null,
  activeInDefaultSkin:true,
  parameters:{mix:1,bendDirection:1,softness:0,compress:false,stretch:false,uniform:false}});
 ir.skeleton.animations=[{id:'moving-target',name:'moving-target',durationSec:1,timelines:[{
  targetKind:'bone',targetId:'target',property:'y',deformBasis:'none',
  keys:[{timeSec:0,value:0,interpolation:{kind:'linear'}},{timeSec:1,value:4,interpolation:{kind:'linear'}}]}]}];
 ir.capabilities.push('ik_constraint');
 validateIR(ir);
 const renderer=make(ir);
 const a=await renderer.renderFrame({clipId:'moving-target',timeSec:0});
 const b=await renderer.renderFrame({clipId:'moving-target',timeSec:1});
 assert.ok(hasInk(a.rgba)&&hasInk(b.rgba));
 assert.notDeepEqual(a.rgba,b.rgba);
});
test('weighted mesh and deformation are passed through full CPU render pipeline',async()=>{
 const ir=fixture();
 const verts:Vertex[]=[
  {position:null,influences:[{boneId:'root',x:-1,y:-1,weight:1}]},
  {position:null,influences:[{boneId:'root',x:1,y:-1,weight:1}]},
  {position:null,influences:[{boneId:'root',x:0,y:1,weight:1}]}
 ];
 const mesh=addMesh(ir,'weighted',verts,[0,1,2]);
 ir.skeleton.slots[0]!.setupAttachmentId=mesh.id;
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'weighted',attachmentId:mesh.id});
 ir.skeleton.animations=[{id:'deform',name:'deform',durationSec:1,timelines:[{
  targetKind:'attachment',targetId:'weighted',property:'deform',deformBasis:'influence_delta',
  keys:[{timeSec:0,value:[0,0,0,0,0,0],interpolation:{kind:'linear'}},
    {timeSec:1,value:[1,0,1,0,1,0],interpolation:{kind:'linear'}}]}]}];
 validateIR(ir);
 const r=make(ir,{mode:'fixed',worldWidth:6});
 const a=await r.renderFrame({clipId:'deform',timeSec:0});
 const b=await r.renderFrame({clipId:'deform',timeSec:1});
 assert.ok(hasInk(a.rgba)&&hasInk(b.rgba));
 assert.notDeepEqual(a.rgba,b.rgba);
});
test('follow, selection, invalid inputs and output budgets are explicit',async()=>{
 const ir=fixture(),r=make(ir);
 await assert.rejects(()=>r.renderFrame({timeSec:0,skinId:'unknown'}),/Skin not found/);
 await assert.rejects(()=>r.renderFrame({timeSec:NaN}),/Invalid frame time/);
 const selected=make(ir,{mode:'fit-selection',targetSlotId:'slot0'});
 const frame=await selected.renderFrame({timeSec:0});
 assert.ok(frame.viewport.width>0);
 await assert.rejects(()=>make(ir,{mode:'fit-selection',targetSlotId:'missing'}).renderFrame({timeSec:0}),/no rendered attachment/);
 await assert.rejects(()=>make(ir,{mode:'follow',targetBoneId:'missing'}).renderFrame({timeSec:0}),/missing\/inactive/);
 assert.throws(()=>new HeadlessRenderEngine({ir,textures,width:1920,height:1080,
  quality:{supersampling:4}}),/surface/);
});

test('Path constraint and animated constraint position affect exported PNG-ready pose',async()=>{
 const ir=fixture();
 const follower=addBone(ir,'path-follow');Object.assign(follower.setup,{length:2});
 const verts:Vertex[]=([[0,0],[10,0],[20,0],[30,0]] as [number,number][])
  .map(([x,y])=>({position:[x,y],influences:[]}));
 ir.skeleton.attachments.push({id:'path-source',name:'path-source',kind:'path',
  color:[1,1,1,1],vertices:verts,closed:false,constantSpeed:true,lengths:[30]});
 ir.skeleton.slots[0]!.setupAttachmentId='path-source';
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'path-source',attachmentId:'path-source'});
 addSlot(ir,'renderable','path-follow','attachment0');
 ir.skeleton.skins[0]!.attachments.push({slotId:'renderable',key:'square',attachmentId:'attachment0'});
 ir.skeleton.constraints.push({id:'path-follow-constraint',kind:'path',order:0,
  boneIds:['path-follow'],targetSlotId:'slot0',targetBoneId:null,
  activeInDefaultSkin:true,parameters:{
   rotateMode:'tangent',spacingMode:'fixed',positionMode:'fixed',
   position:0,spacing:0,mixRotate:1,mixX:1,mixY:1,offsetRotation:0
  }});
 ir.skeleton.animations=[{id:'travel',name:'travel',durationSec:1,timelines:[{
  targetKind:'constraint',targetId:'path-follow-constraint',property:'position',deformBasis:'none',
  keys:[{timeSec:0,value:0,interpolation:{kind:'linear'}},
   {timeSec:1,value:20,interpolation:{kind:'linear'}}]
 }]}];
 ir.capabilities.push('path','path_constraint');
 validateIR(ir);
 const r=make(ir,{mode:'fixed',worldWidth:40,x:15,y:0});
 const a=await r.renderFrame({clipId:'travel',timeSec:0});
 const b=await r.renderFrame({clipId:'travel',timeSec:1});
 assert.ok(hasInk(a.rgba)&&hasInk(b.rgba));
 assert.notDeepEqual(a.rgba,b.rgba);
});
test('nearest/linear color sampling differs and premultiplied downsample keeps translucent edges',async()=>{
 const ir=fixture(),pixels=new Uint8Array([
  255,0,0,255, 0,255,0,128,
  0,0,255,255, 0,0,0,0
 ]);
 const tex=new Map<string,RawTexture>([['page0',{width:2,height:2,rgba:pixels,premultiplied:false}]]);
 const settings={ir,textures:tex,width:64,height:64,camera:{mode:'fit-scene' as const,padding:1.05}};
 const a=await new HeadlessRenderEngine({...settings,quality:{sampling:'nearest'}}).renderFrame({timeSec:0});
 const b=await new HeadlessRenderEngine({...settings,quality:{sampling:'linear',supersampling:2}}).renderFrame({timeSec:0});
 assert.notDeepEqual(a.rgba,b.rgba);
 assert.ok(b.rgba.some((v,i)=>i%4===3&&v>0&&v<255),'Semi-transparent pixels should survive filtering');
});
test('fit-scene frame mode tracks visible motion while animation mode uses sampled global envelope',async()=>{
 const ir=fixture();ir.skeleton.animations=[{id:'translate',name:'translate',durationSec:1,timelines:[{
  targetKind:'bone',targetId:'root',property:'x',deformBasis:'none',
  keys:[{timeSec:0,value:0,interpolation:{kind:'linear'}},{timeSec:1,value:20,interpolation:{kind:'linear'}}]
 }]}];
 validateIR(ir);
 const stable=new HeadlessRenderEngine({ir,textures,width:64,height:64,
  camera:{mode:'fit-scene',fit:'animation'}});
 const adaptive=new HeadlessRenderEngine({ir,textures,width:64,height:64,
  camera:{mode:'fit-scene',fit:'frame'}});
 const a:number[]=[],b:number[]=[];
 await stable.renderSequence({clipId:'translate',startSec:0,endSec:1,fps:4,onFrame:frame=>{a.push(frame.viewport.left);}});
 await adaptive.renderSequence({clipId:'translate',startSec:0,endSec:1,fps:4,onFrame:frame=>{b.push(frame.viewport.left);}});
 assert.equal(new Set(a).size,1);
 assert.ok(new Set(b).size>1);
});
