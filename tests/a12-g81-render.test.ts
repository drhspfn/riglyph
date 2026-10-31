/** G8.1 independent, self-authored clipping and UV mathematical regressions.
 * These are NOT source/official visual parity evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addSlot,addAttachment,addMesh,addBone} from './helpers.js';
import {SkeletonInstance} from '../src/runtime/state.js';
import {prepareDrawPackets,drawBounds,atlasUV,originalMeshUVToTrimLocal} from '../src/render/packets.js';
import {validateIR} from '../src/ir/validate.js';
import {EngineError} from '../src/errors.js';
import type {IRDocument,Vertex} from '../src/ir/types.js';
import {rasterize,sampleTexture} from '../src/render/software.js';
const approx=(a:number,b:number,eps=1e-5)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const quad=(n:number):Vertex[]=>[[-n,-n],[n,-n],[n,n],[-n,n]].map(([x,y])=>({position:[x!,y!],influences:[]}));
function clipScene(end:string,options:{pages?:boolean;overlap?:boolean}={}):IRDocument{
 const ir=fixture();ir.skeleton.slots[0]!.setupAttachmentId='clip';
 addAttachment(ir,{kind:'clipping',id:'clip',name:'mask',color:[1,1,1,1],endSlotId:end,vertices:quad(.25)},'slot0','mask');
 for(const id of ['A','B','C']){addSlot(ir,id,'root','attachment0');ir.skeleton.skins[0]!.attachments.push({slotId:id,key:'square',attachmentId:'attachment0'});}
 if(options.pages){
  const page=structuredClone(ir.atlases.pages[0]!);page.id='second';ir.atlases.pages.push(page);
  const region=structuredClone(ir.atlases.regions[0]!);region.id='second-reg';region.pageId='second';ir.atlases.regions.push(region);
  const attach=structuredClone(ir.skeleton.attachments[0]!);
  if(attach.kind!=='region')throw Error('Expected synthetic region');
  attach.id='second-attach';attach.regionId='second-reg';ir.skeleton.attachments.push(attach);
  ir.skeleton.slots.find(s=>s.id==='C')!.setupAttachmentId=attach.id;
  ir.skeleton.skins[0]!.attachments.push({slotId:'C',key:'other',attachmentId:attach.id});
 }
 if(options.overlap){addAttachment(ir,{kind:'clipping',id:'clip2',name:'mask2',color:[1,1,1,1],endSlotId:'C',vertices:quad(.1)},'A','mask2');ir.skeleton.slots.find(s=>s.id==='A')!.setupAttachmentId='clip2';}
 validateIR(ir);return ir;
}
test('G8.1 self-end mask applies through final draw order, including second texture page',()=>{
 const inst=new SkeletonInstance(clipScene('slot0',{pages:true}));const packets=prepareDrawPackets(inst);
 assert.deepEqual(packets.map(p=>p.slotId),['A','B','C']);assert.deepEqual(packets.map(p=>p.pageId),['page0','page0','second']);
 for(const p of packets){const b=drawBounds([p])!;approx(b[2],.5);approx(b[3],.5);}
 assert.deepEqual(drawBounds(packets),[-.25,-.25,.5,.5]);
});
test('G8.1 explicit end slot is inclusive; later sprites are not clipped',()=>{
 const packets=prepareDrawPackets(new SkeletonInstance(clipScene('B')));
 assert.deepEqual(packets.map(p=>p.slotId),['A','B','C']);
 for(const p of packets.slice(0,2)){const b=drawBounds([p])!;approx(b[2],.5);approx(b[3],.5);}
 const outside=drawBounds([packets[2]!])!;approx(outside[2],1);approx(outside[3],1);
});
test('G8.1 animated draw-order traversal determines clip scope, not original slot index',()=>{
 const ir=clipScene('B');ir.skeleton.animations[0]!.timelines=[{
  targetKind:'skeleton',targetId:null,property:'drawOrder',deformBasis:'none',
  keys:[{timeSec:0,value:['C','slot0','A','B'],interpolation:{kind:'stepped'}}]
 }];validateIR(ir);
 const inst=new SkeletonInstance(ir).evaluate([{clipId:'rotate90',timeSec:.1}]);
 const packets=prepareDrawPackets(inst);assert.deepEqual(packets.map(p=>p.slotId),['C','A','B']);
 approx(drawBounds([packets[0]!])![2],1);
 approx(drawBounds([packets[1]!])![2],.5);
 approx(drawBounds([packets[2]!])![2],.5);
});
test('G8.1 clipping attachment switched off does not create a stale mask',()=>{
 const ir=clipScene('slot0');const inst=new SkeletonInstance(ir);
 inst.slots.get('slot0')!.attachmentId=null;
 assert.deepEqual(prepareDrawPackets(inst).map(p=>p.slotId),['A','B','C']);
 approx(drawBounds(prepareDrawPackets(inst))![2],1);
});
test('G8.1 rejects invalid polygons and overlapping clipping scopes',()=>{
 const nested=clipScene('slot0',{overlap:true});
 assert.throws(()=>prepareDrawPackets(new SkeletonInstance(nested)),(e:unknown)=>e instanceof EngineError&&e.code==='UNSUPPORTED_SEMANTIC_FEATURE');
 const broken=clipScene('slot0');const clip=broken.skeleton.attachments.find(a=>a.id==='clip')!;
 if(clip.kind!=='clipping')throw Error('Expected clip');
 clip.vertices=[{position:[0,0],influences:[]},{position:[.5,.5],influences:[]},{position:[0,.5],influences:[]},{position:[.5,0],influences:[]}];
 assert.throws(()=>prepareDrawPackets(new SkeletonInstance(broken)),(e:unknown)=>e instanceof EngineError&&e.code==='INVALID_TOPOLOGY');
});
function meshScene(rotation:0|90|180|270,linked=false,weighted=false):IRDocument{
 const ir=fixture();const reg=ir.atlases.regions[0]!;
 ir.atlases.pages[0]!.width=256;ir.atlases.pages[0]!.height=256;
 reg.bounds=[10,20,40,20];reg.originalSize=[100,50];reg.offset=[20,10];reg.rotationDeg=rotation;
 const localUV=[.2,.4,.6,.4,.6,.8,.2,.8];
 const points:[[number,number],[number,number],[number,number],[number,number]]=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
 if(weighted){const second=addBone(ir,'other');second.setup.x=2;second.setup.y=1;}
 const vertices:Vertex[]=points.map(([x,y])=>weighted?{position:null,influences:[{boneId:'root',x,y,weight:.5},{boneId:'other',x,y,weight:.5}]}:{position:[x,y],influences:[]});
 const mesh=addMesh(ir,'mesh',vertices,[0,1,2,0,2,3],localUV);
 if(linked){
  const region={...reg,id:'linked-region',name:'linked',pageId:'linked-page',bounds:[80,50,40,20] as [number,number,number,number]};
  ir.atlases.regions.push(region);ir.atlases.pages.push({...ir.atlases.pages[0]!,id:'linked-page'});
  ir.skeleton.attachments.push({id:'linked',name:'linked',kind:'linked_mesh',parentMeshId:mesh.id,regionId:region.id,
   color:[1,1,1,1],inheritDeform:true,deformTimelineOwnerId:mesh.id,sequence:null});
  ir.capabilities.push('linked_mesh');ir.skeleton.slots[0]!.setupAttachmentId='linked';
  ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'linked',attachmentId:'linked'});
 }else{ir.skeleton.slots[0]!.setupAttachmentId='mesh';ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'mesh',attachmentId:'mesh'});}
 validateIR(ir);return ir;
}
const expected:{[key:number]:number[][]}={
 0:[[10,20],[50,20],[50,40],[10,40]],
 90:[[10,60],[10,20],[30,20],[30,60]],
 180:[[50,40],[10,40],[10,20],[50,20]],
 270:[[30,20],[30,60],[10,60],[10,20]]
};
for(const rotation of [0,90,180,270] as const)test(`G8.1 original mesh UV transform: ${rotation}deg, exact packed-page corners`,()=>{
 const ir=meshScene(rotation);const region=ir.atlases.regions[0]!,page=ir.atlases.pages[0]!;
 const locals=[[.2,.4],[.6,.4],[.6,.8],[.2,.8]].map(([u,v])=>originalMeshUVToTrimLocal(region,u!,v!));
 for(let i=0;i<4;i++){approx(locals[i]![0],i===1||i===2?1:0);approx(locals[i]![1],i>=2?1:0);}
 const packets=prepareDrawPackets(new SkeletonInstance(ir));assert.equal(packets.length,1);
 const p=packets[0]!;assert.equal(p.indices.length,6);
 // Triangulated order: [0,1,2,0,2,3]
 const indices=[0,1,2,5];
 for(let i=0;i<4;i++){
  const expectedUv=expected[rotation]![i]!,observedIndex=indices[i]!;
  approx(p.uvs[observedIndex*2]!,expectedUv[0]!/256);
  approx(p.uvs[observedIndex*2+1]!,expectedUv[1]!/256);
  const local=locals[i]!;const packed=atlasUV(region,page,local[0]!,local[1]!);
  approx(packed[0],expectedUv[0]!/256);approx(packed[1],expectedUv[1]!/256);
 }
});
test('G8.1 nontrimmed UV unchanged; bottom-left source origin and overshoot stay unclamped',()=>{
 const ir=meshScene(0);const reg=ir.atlases.regions[0]!;reg.bounds=[0,0,50,50];reg.offset=[0,0];reg.originalSize=[50,50];
 approx(originalMeshUVToTrimLocal(reg,-.03,1.06)[0],-.03);approx(originalMeshUVToTrimLocal(reg,-.03,1.06)[1],1.06);
 ir.conventions.uvOrigin='bottom-left';const attachment=ir.skeleton.attachments.find(a=>a.id==='mesh')!;
 if(attachment.kind!=='mesh')throw Error('Expected mesh');
 attachment.uvs=[.2,.6,.6,.6,.6,.2,.2,.2];
 const packets=prepareDrawPackets(new SkeletonInstance(ir));approx(packets[0]!.uvs[1]!,.4*50/256);
});
test('G8.1 selected linked mesh maps inherited original UVs using its own region and supports weights',()=>{
 const ir=meshScene(90,true,true);const packet=prepareDrawPackets(new SkeletonInstance(ir))[0]!;
 assert.equal(packet.pageId,'linked-page');
 // Linked region is displaced by 70 source pixels in X relative to parent.
 approx(packet.uvs[0]!,80/256);approx(packet.uvs[1]!,90/256);
 // Weighted geometry remains evaluated in world, without modifying UVs.
 approx(packet.positions[0]!,.5);approx(packet.positions[1]!,0);
});
test('G8.1 region quad retains trimmed-local mapping rather than applying mesh conversion twice',()=>{
 const ir=fixture(),reg=ir.atlases.regions[0]!;reg.bounds=[10,20,40,20];reg.originalSize=[100,50];reg.offset=[20,10];
 ir.atlases.pages[0]!.width=256;ir.atlases.pages[0]!.height=256;
 const p=prepareDrawPackets(new SkeletonInstance(ir))[0]!;
 approx(p.uvs[0]!,10/256);approx(p.uvs[1]!,40/256);
 approx(p.uvs[2]!,50/256);approx(p.uvs[3]!,40/256);
 approx(p.uvs[4]!,50/256);approx(p.uvs[5]!,20/256);
});
test('G8.1 asymmetric self-authored RGBA texture maps all 4 UV orientations to distinct corner samples',()=>{
 // Draw first-class texture corner evidence without reading any game/reference PNG.
 const rgba=new Uint8Array(256*256*4);
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){
  const off=(y*256+x)*4;rgba[off]=x;rgba[off+1]=y;rgba[off+2]=(x^y);rgba[off+3]=255;
 }
 const texture={width:256,height:256,rgba,premultiplied:false};
 for(const rotation of [0,90,180,270] as const){
  const p=prepareDrawPackets(new SkeletonInstance(meshScene(rotation)))[0]!;
  for(const idx of [0,1,2,5]){
   const u=p.uvs[idx*2]!,v=p.uvs[idx*2+1]!;
   const actual=sampleTexture(texture,u,v);
   assert.equal(actual[0],Math.floor(u*256)/255);assert.equal(actual[1],Math.floor(v*256)/255);
  }
  const image=rasterize([p],new Map([['page0',texture]]),{left:-1,bottom:-1,width:2,height:2},16,16);
  assert.ok(image.some((byte,i)=>i%4===3&&byte===255));
 }
});

test('G8.1 weighted vertex deformation changes world XY but preserves selected source UV',()=>{
 const ir=meshScene(0,false,true);const inst=new SkeletonInstance(ir);
 const baseline=prepareDrawPackets(inst)[0]!;
 const influenceDelta=new Float32Array(16);influenceDelta[0]=.2;influenceDelta[1]=-.1;
 inst.deforms.set('mesh',influenceDelta);
 const changed=prepareDrawPackets(inst)[0]!;
 assert.deepEqual([...changed.uvs],[...baseline.uvs]);
 assert.notDeepEqual([...changed.positions],[...baseline.positions]);
});
