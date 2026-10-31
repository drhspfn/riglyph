/** A18: numeric behavior contract measured independently against Spine 4.1.24.
 * These are independently authored minimal inputs, never proprietary samples.
 * The official G3 comparison is performed by Agent A, not by these tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addSlot,addMesh} from './helpers.js';
import {SkeletonInstance} from '../src/runtime/state.js';
import {atlasUV,originalMeshUVToTrimLocal,prepareDrawPackets} from '../src/render/packets.js';
import {validateIR} from '../src/ir/validate.js';
import type {AtlasRegion,IRDocument,Vertex} from '../src/ir/types.js';

const page={width:1024,height:512};
const region:AtlasRegion={id:'reg0',name:'authored-crop',pageId:'page0',bounds:[120,80,100,40],originalSize:[120,80],offset:[10,20],rotationDeg:0};
const reference=new Map<0|90|180|270,[number,number]>([
 [0,[0.154296875,0.15625]],
 [90,[0.1171875,0.27734375]],
 [180,[0.177734375,0.234375]],
 [270,[0.15625,0.23046875]],
]);
const near=(actual:number,expected:number,eps=1e-6)=>assert.ok(Math.abs(actual-expected)<=eps,`actual ${actual}, expected ${expected}`);
const v=(x:number,y:number):Vertex=>({position:[x,y],influences:[]});
const sourceUVs=[.4,.25, .8,.25, .4,.75];
function createMeshScene(rotationDeg:0|90|180|270):IRDocument{
 const ir=fixture();
 ir.atlases.pages[0]!.width=page.width;ir.atlases.pages[0]!.height=page.height;
 Object.assign(ir.atlases.regions[0]!,{...region,rotationDeg});
 const mesh=addMesh(ir,'authored-mesh',[v(0,0),v(2,0),v(0,2)],[0,1,2],sourceUVs);
 ir.skeleton.slots[0]!.setupAttachmentId=mesh.id;
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'mesh',attachmentId:mesh.id});
 validateIR(ir);return ir;
}
for(const [rotationDeg,expected] of reference){
 test(`A18 numeric atlas UV: trimmed original image, physical ${rotationDeg}deg packing`,()=>{
  const trim=originalMeshUVToTrimLocal({...region,rotationDeg},.4,.25);
  near(trim[0],.38,1e-12);near(trim[1],0,1e-12);
  const uv=atlasUV({...region,rotationDeg},page,...trim);
  near(uv[0],expected[0]);near(uv[1],expected[1]);
  // Assert the *published* draw packet, not just the private utility.
  const ir=createMeshScene(rotationDeg);
  const packet=prepareDrawPackets(new SkeletonInstance(ir))[0]!;
  assert.equal(packet.pageId,'page0');assert.equal(packet.uvs.length,6);
  near(packet.uvs[0]!,expected[0]);near(packet.uvs[1]!,expected[1]);
 });
}
test('A18 quarter-turn packing uses physical h × w, not logical w × h',()=>{
 const thin:AtlasRegion={...region,bounds:[980,10,100,40],rotationDeg:90};
 const ir=createMeshScene(90);ir.atlases.regions[0]=thin;
 // x + logical width = 1080 exceeds page width, but x + physical width = 1020 fits.
 validateIR(ir);
 const packet=prepareDrawPackets(new SkeletonInstance(ir))[0]!;
 assert.ok(packet.uvs[0]!>=0&&packet.uvs[0]!<=1);
});
test('A18 region quads start with trimmed-local UV and never apply mesh-trim twice',()=>{
 for(const rotationDeg of [0,90,180,270] as const){
  const ir=fixture();ir.atlases.pages[0]!.width=1024;ir.atlases.pages[0]!.height=512;
  Object.assign(ir.atlases.regions[0]!,{...region,rotationDeg});
  validateIR(ir);
  const packet=prepareDrawPackets(new SkeletonInstance(ir))[0]!;
  // Source region-quad vertex zero is bottom-left (u=0, v=1).
  const expected=atlasUV({...region,rotationDeg},page,0,1);
  near(packet.uvs[0]!,expected[0]);near(packet.uvs[1]!,expected[1]);
 }
});
test('A18 independent atlas pages and rotated linked mesh resolve selected region',()=>{
 const ir=createMeshScene(90);
 ir.atlases.pages.push({...ir.atlases.pages[0]!,id:'page-2',width:512,height:1024});
 ir.atlases.regions.push({...region,id:'reg-2',name:'second-crop',pageId:'page-2',bounds:[200,320,100,40],rotationDeg:270});
 const parent=ir.skeleton.attachments.find(a=>a.id==='authored-mesh')!;
 if(parent.kind!=='mesh')throw new Error('Expected mesh');
 const linked={kind:'linked_mesh' as const,id:'linked-mesh',name:'linked-mesh',regionId:'reg-2',color:[1,1,1,1] as [number,number,number,number],parentMeshId:parent.id,inheritDeform:true,deformTimelineOwnerId:parent.id,sequence:null};
 ir.skeleton.attachments.push(linked);ir.capabilities.push('linked_mesh');
 addSlot(ir,'linked-slot','root',linked.id);
 ir.skeleton.skins[0]!.attachments.push({slotId:'linked-slot',key:'linked',attachmentId:linked.id});
 validateIR(ir);
 const packets=prepareDrawPackets(new SkeletonInstance(ir));
 assert.deepEqual(packets.map(p=>p.pageId),['page0','page-2']);
 const [tu,tv]=originalMeshUVToTrimLocal(region,.4,.25);
 const p1=atlasUV({...region,rotationDeg:90},page,tu,tv);
 const p2=atlasUV(ir.atlases.regions[1]!,{width:512,height:1024},tu,tv);
 near(packets[0]!.uvs[0]!,p1[0]);near(packets[0]!.uvs[1]!,p1[1]);
 near(packets[1]!.uvs[0]!,p2[0]);near(packets[1]!.uvs[1]!,p2[1]);
 assert.notDeepEqual(p1,p2);
});
test('A18 does not clamp out-of-trim UVs or change 0/180 orientation',()=>{
 const trim=originalMeshUVToTrimLocal(region,-.1,1.1);
 assert.ok(trim[0]<0&&trim[1]>1);
 const r0=atlasUV({...region,rotationDeg:0},page,trim[0],trim[1]);
 const r180=atlasUV({...region,rotationDeg:180},page,trim[0],trim[1]);
 near(r0[0],(region.bounds[0]+trim[0]*100)/1024);
 near(r180[1],(region.bounds[1]+(1-trim[1])*40)/512);
});
