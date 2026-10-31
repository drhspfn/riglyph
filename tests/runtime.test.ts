import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,addBone,addSlot,addMesh,addAttachment,identity} from './helpers.js';
import {SkeletonInstance} from '../src/runtime/state.js';import {AnimationPlayer} from '../src/runtime/player.js';
import {prepareDrawPackets,drawBounds,clipAgainstTriangle,triangulatePolygon} from '../src/render/packets.js';
import {validateIR} from '../src/ir/validate.js';
import type {IRDocument,Vertex,Timeline} from '../src/ir/types.js';
import {EngineError} from '../src/errors.js';
const near=(a:number,b:number,eps=1e-4)=>assert.ok(Math.abs(a-b)<eps,`${a} not approximately ${b}`);
function setMesh(ir:IRDocument,vertices:Vertex[]){
 addMesh(ir,'mesh',vertices,[0,1,2],[0,0,1,0,0,1]);
 ir.skeleton.slots[0]!.setupAttachmentId='mesh';ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'mesh',attachmentId:'mesh'});
}
const scalar=(targetId:string,property:string,keys:[number,number][]):Timeline=>({targetKind:'bone',targetId,property,deformBasis:'none',keys:keys.map(([timeSec,value])=>({timeSec,value,interpolation:{kind:'linear'}}))});

test('two independently mutable skeleton instances share one immutable definition',()=>{
 const ir=fixture();const a=new SkeletonInstance(ir),b=new SkeletonInstance(ir);
 a.evaluate([{clipId:'rotate90',timeSec:1}]);near(a.world.get('root')!.a,0);near(b.world.get('root')!.a,1);near(ir.skeleton.bones[0]!.setup.rotationDeg,0);
});
test('region builds two textured triangles, CPU bounds reflect arbitrary seek',()=>{
 const ir=fixture();const instance=new SkeletonInstance(ir);
 let packets=prepareDrawPackets(instance);assert.equal(packets.length,1);assert.equal(packets[0]!.positions.length,12);
 assert.deepEqual(drawBounds(packets),[-.5,-.5,1,1]);
 instance.evaluate([{clipId:'rotate90',timeSec:1}]);packets=prepareDrawPackets(instance);
 near(drawBounds(packets)![0],-.5);near(drawBounds(packets)![3],1);
});
test('unweighted mesh positions plus dense and sparse deform interpolation',()=>{
 const ir=fixture();setMesh(ir,[{position:[0,0],influences:[]},{position:[1,0],influences:[]},{position:[0,1],influences:[]}]);
 const anim=ir.skeleton.animations[0]!;anim.timelines=[{targetKind:'attachment',targetId:'mesh',property:'deform',deformBasis:'vertex_delta',keys:[{timeSec:0,value:[0,0,0,0,0,0],interpolation:{kind:'linear'}},{timeSec:1,value:[.4,0,0,0,0,0],interpolation:{kind:'stepped'}}]}];
 validateIR(ir);const instance=new SkeletonInstance(ir);
 instance.evaluate([{clipId:'rotate90',timeSec:.5}]);const p=prepareDrawPackets(instance)[0]!;near(p.positions[0]!,.2);
 anim.timelines[0]!.keys[1]!.value={offset:0,values:[.4]};
 instance.evaluate([{clipId:'rotate90',timeSec:1}]);near(prepareDrawPackets(instance)[0]!.positions[0]!,.4);
 instance.evaluate();near(prepareDrawPackets(instance)[0]!.positions[0]!,0);
});
test('two-bone weighted skinning and influence-local deform are mathematically applied',()=>{
 const ir=fixture();const arm=addBone(ir,'arm');arm.setup.x=2;
 setMesh(ir,[{position:null,influences:[{boneId:'root',x:0,y:0,weight:.25},{boneId:'arm',x:1,y:0,weight:.75}]},{position:[1,0],influences:[]},{position:[0,1],influences:[]}]);
 const anim=ir.skeleton.animations[0]!;
 anim.timelines=[{targetKind:'attachment',targetId:'mesh',property:'deform',deformBasis:'influence_delta',keys:[{timeSec:0,value:[1,0,1,0,0,0,0,0],interpolation:{kind:'linear'}},{timeSec:1,value:[3,0,3,0,0,0,0,0],interpolation:{kind:'stepped'}}]}];
 validateIR(ir);const instance=new SkeletonInstance(ir).evaluate([{clipId:'rotate90',timeSec:0}]);
 near(prepareDrawPackets(instance)[0]!.positions[0]!,3.25); // .25*(0+1) + .75*(2+1+1)
 instance.evaluate([{clipId:'rotate90',timeSec:1}]);near(prepareDrawPackets(instance)[0]!.positions[0]!,5.25);
});
test('linked mesh shares bind geometry but uses explicit deform timeline owner',()=>{
 const ir=fixture();setMesh(ir,[{position:[0,0],influences:[]},{position:[1,0],influences:[]},{position:[0,1],influences:[]}]);
 ir.capabilities.push('linked_mesh');
 ir.skeleton.attachments.push({id:'linked',name:'linked',kind:'linked_mesh',color:[1,1,1,1],parentMeshId:'mesh',regionId:'reg0',inheritDeform:true,deformTimelineOwnerId:'mesh',sequence:null});
 ir.skeleton.slots[0]!.setupAttachmentId='linked';ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'linked',attachmentId:'linked'});
 ir.skeleton.animations[0]!.timelines=[{targetKind:'attachment',targetId:'mesh',property:'deform',deformBasis:'vertex_delta',keys:[{timeSec:0,value:[0,0,0,0,0,0],interpolation:{kind:'linear'}},{timeSec:1,value:[2,0,0,0,0,0],interpolation:{kind:'stepped'}}]}];
 validateIR(ir);
 const instance=new SkeletonInstance(ir).evaluate([{clipId:'rotate90',timeSec:1}]);
 near(prepareDrawPackets(instance)[0]!.positions[0]!,2);
});
test('selected skin swaps attachments using authored slot key, no shared mutable state',()=>{
 const ir=fixture();ir.skeleton.attachments.push({...ir.skeleton.attachments[0]!,id:'alt'});
 ir.skeleton.skins.push({id:'other',isDefault:false,attachments:[{slotId:'slot0',key:'square',attachmentId:'alt'}],activeBoneIds:[],activeConstraintIds:[]});
 validateIR(ir);const instance=new SkeletonInstance(ir);
 instance.setSkin('other');assert.equal(instance.slots.get('slot0')!.attachmentId,'alt');
 instance.setSkin('default');assert.equal(instance.slots.get('slot0')!.attachmentId,'attachment0');
});
test('zero-duration pose, attachment hide/null, draw-order animation',()=>{
 const ir=fixture();addSlot(ir,'slot1','root','attachment0');ir.skeleton.skins[0]!.attachments.push({slotId:'slot1',key:'square',attachmentId:'attachment0'});
 ir.skeleton.animations.push({id:'pose',name:'pose',durationSec:0,timelines:[
  {targetKind:'slot',targetId:'slot0',property:'attachment',deformBasis:'none',keys:[{timeSec:0,value:null,interpolation:{kind:'stepped'}}]},
  {targetKind:'skeleton',targetId:null,property:'drawOrder',deformBasis:'none',keys:[{timeSec:0,value:['slot1','slot0'],interpolation:{kind:'stepped'}}]}
 ]});validateIR(ir);
 const inst=new SkeletonInstance(ir).evaluate([{clipId:'pose',timeSec:32,loop:true}]);
 assert.deepEqual(inst.drawOrder,['slot1','slot0']);assert.equal(inst.slots.get('slot0')!.attachmentId,null);
 assert.equal(prepareDrawPackets(inst).length,1);
});
test('normal/additive/multiply/screen and PMA and color retained by draw-packet boundary',()=>{
 const ir=fixture();ir.skeleton.slots[0]!.blend='screen';ir.skeleton.slots[0]!.light=[.4,.5,.6,.7];ir.skeleton.slots[0]!.dark=[.1,.2,.3];ir.skeleton.attachments[0]!.color=[.5,.5,1,.5];ir.atlases.pages[0]!.pma=true;
 const p=prepareDrawPackets(new SkeletonInstance(ir))[0]!;assert.equal(p.pma,true);assert.equal(p.blend,'screen');assert.deepEqual(p.light,[.2,.25,.6,.35]);assert.deepEqual(p.dark,[.1,.2,.3]);
});
test('discrete draw-order timeline changes packet order across pages',()=>{
 const ir=fixture();ir.atlases.pages.push({...ir.atlases.pages[0]!,id:'page1',path:'second.png'});ir.atlases.regions.push({...ir.atlases.regions[0]!,id:'reg1',pageId:'page1'});
 const original=ir.skeleton.attachments[0]!;assert.equal(original.kind,'region');
 addAttachment(ir,{...original,id:'second',regionId:'reg1'} as typeof original & {kind:'region';regionId:string},'slot1','square');
 addSlot(ir,'slot1','root','second');
 ir.skeleton.animations[0]!.timelines=[{targetKind:'skeleton',targetId:null,property:'drawOrder',deformBasis:'none',keys:[{timeSec:0,value:['slot1','slot0'],interpolation:{kind:'stepped'}}]}];
 validateIR(ir);
 const packets=prepareDrawPackets(new SkeletonInstance(ir).evaluate([{clipId:'rotate90',timeSec:.5}]));assert.deepEqual(packets.map(p=>p.pageId),['page1','page0']);
});
test('CPU clipping clips only between start slot and end slot (inclusive)',()=>{
 const ir=fixture();ir.skeleton.slots[0]!.setupAttachmentId='clip';
 const quad:Vertex[]=[{position:[-.25,-.25],influences:[]},{position:[.25,-.25],influences:[]},{position:[.25,.25],influences:[]},{position:[-.25,.25],influences:[]}];
 addAttachment(ir,{kind:'clipping',id:'clip',name:'clip',color:[1,1,1,1],endSlotId:'end',vertices:quad},'slot0','clip');
 addSlot(ir,'middle','root','attachment0');addSlot(ir,'end','root','attachment0');addSlot(ir,'outside','root','attachment0');
 for(const id of ['middle','end','outside'])ir.skeleton.skins[0]!.attachments.push({slotId:id,key:'square',attachmentId:'attachment0'});
 validateIR(ir);const packets=prepareDrawPackets(new SkeletonInstance(ir));assert.deepEqual(packets.map(p=>p.slotId),['middle','end','outside']);
 const clipped=drawBounds(packets.slice(0,1))!,after=drawBounds(packets.slice(2))!;
 near(clipped[2],.5);near(clipped[3],.5);near(after[2],1);near(after[3],1);
});
test('ear clipping supports convex and concave polygon and UV-interpolated intersection',()=>{
 const p=(x:number,y:number)=>({x,y,u:x,v:y});
 const concave=[p(0,0),p(3,0),p(3,3),p(1.5,1),p(0,3)];
 const tris=triangulatePolygon(concave);assert.equal(tris.length,3);
 const a:[ReturnType<typeof p>,ReturnType<typeof p>,ReturnType<typeof p>]=[p(-1,-1),p(2,-1),p(0,2)];
 const c:[ReturnType<typeof p>,ReturnType<typeof p>,ReturnType<typeof p>]=[p(0,0),p(1,0),p(0,1)];
 const clipped=clipAgainstTriangle(a,c);assert.ok(clipped.length>0);for(const t of clipped)for(const q of t){near(q.u,q.x);near(q.v,q.y);}
});
test('single-bone IK looks at target; two-bone IK reaches constructed target',()=>{
 const ir=fixture();const target=addBone(ir,'target');target.setup.y=2;
 ir.skeleton.constraints.push({id:'aim',kind:'ik',order:0,boneIds:['root'],targetBoneId:'target',targetSlotId:null,parameters:{mix:1}});
 const inst=new SkeletonInstance(ir).evaluate();near(inst.bones.get('root')!.rotationDeg,90);
 const twin=fixture();const arm=addBone(twin,'arm');arm.setup.x=1;arm.setup.length=1;const t=addBone(twin,'target');t.setup.y=2;
 twin.skeleton.constraints.push({id:'ik2',kind:'ik',order:0,boneIds:['root','arm'],targetBoneId:'target',targetSlotId:null,parameters:{mix:1,bendDirection:1}});
 const player=new SkeletonInstance(twin).evaluate();const m=player.world.get('arm')!;
 near(m.x+m.a*arm.setup.length,0);near(m.y+m.b*arm.setup.length,2);
});
test('path and transform constraints operate on canonical IR, not source-version field',()=>{
 const ir=fixture();addBone(ir,'follower');addSlot(ir,'pathslot','root','path0');
 addAttachment(ir,{id:'path0',kind:'path',name:'path',color:[1,1,1,1],closed:false,constantSpeed:true,lengths:[],vertices:[{position:[0,0],influences:[]},{position:[0,1],influences:[]},{position:[1,1],influences:[]},{position:[1,0],influences:[]}]},'pathslot','path');
 ir.skeleton.constraints.push({id:'pathc',kind:'path',order:0,boneIds:['follower'],targetBoneId:null,targetSlotId:'pathslot',parameters:{position:.5,positionMode:'percent',spacing:0,mixX:1,mixY:1,mixRotate:0}});
 const player=new SkeletonInstance(ir).evaluate();near(player.world.get('follower')!.x,.5,.01);near(player.world.get('follower')!.y,.75,.01);
 const target=addBone(ir,'target');target.setup.x=2;target.setup.y=3;
 ir.skeleton.constraints.push({id:'move',kind:'transform',order:1,boneIds:['follower'],targetBoneId:'target',targetSlotId:null,parameters:{mixX:1,mixY:1,mixRotate:0}});
 const again=new SkeletonInstance(ir).evaluate();near(again.world.get('follower')!.x,2);near(again.world.get('follower')!.y,3);
});
test('multiple clips, layering, queue and deterministic loop event delivery',()=>{
 const ir=fixture();ir.skeleton.animations[0]!.timelines=[scalar('root','x',[[0,0],[1,10]])];
 ir.skeleton.animations.push({id:'overlay',name:'overlay',durationSec:1,timelines:[scalar('root','x',[[0,0],[1,20]])]});
 ir.skeleton.events.push({id:'e',name:'hit'});
 ir.skeleton.animations[0]!.timelines.push({targetKind:'event',targetId:'e',property:'fire',deformBasis:'none',keys:[{timeSec:.25,value:{eventId:'e'},interpolation:{kind:'stepped'}},{timeSec:.75,value:{eventId:'e'},interpolation:{kind:'stepped'}}]});
 validateIR(ir);
 const instance=new SkeletonInstance(ir);
 instance.evaluate([{clipId:'rotate90',timeSec:1},{clipId:'overlay',timeSec:1,alpha:.5}]);near(instance.bones.get('root')!.x,15);
 const player=new AnimationPlayer(new SkeletonInstance(ir));player.set(0,'rotate90',true);player.advance(1.3);
 assert.deepEqual(player.events.map(e=>+e.timeSec.toFixed(2)),[.25,.75,1.25]);
 player.queue(0,'overlay',false);player.set(0,'rotate90',false);player.queue(0,'overlay',false);player.advance(1.1);
 assert.equal(player.current(0)!.clipId,'overlay');
});
test('unsupported semantic channels throw; no silent fallback',()=>{
 const ir=fixture();ir.skeleton.animations[0]!.timelines[0]!.property='undocumented_feature';
 assert.throws(()=>new SkeletonInstance(ir).evaluate([{clipId:'rotate90',timeSec:0}]),e=>e instanceof EngineError&&e.code==='UNSUPPORTED_TIMELINE_TYPE');
});
test('skin-required bones hide associated draw slots until active in the selected skin',()=>{
 const ir=fixture();const extra=addBone(ir,'optional');extra.skinRequired=true;
 addSlot(ir,'optionalSlot','optional','attachment0');ir.skeleton.skins[0]!.attachments.push({slotId:'optionalSlot',key:'square',attachmentId:'attachment0'});
 validateIR(ir);
 const hidden=new SkeletonInstance(ir);assert.equal(hidden.activeBones.has('optional'),false);assert.deepEqual(prepareDrawPackets(hidden).map(p=>p.slotId),['slot0']);
 ir.skeleton.skins[0]!.activeBoneIds.push('optional');
 const shown=new SkeletonInstance(ir);assert.equal(shown.activeBones.has('optional'),true);assert.deepEqual(prepareDrawPackets(shown).map(p=>p.slotId),['slot0','optionalSlot']);
});
test('bottom-left canonical mesh UVs are normalized to top-left atlas sampling',()=>{
 const ir=fixture();setMesh(ir,[{position:[0,0],influences:[]},{position:[1,0],influences:[]},{position:[0,1],influences:[]}]);
 ir.conventions.uvOrigin='bottom-left';validateIR(ir);
 const packet=prepareDrawPackets(new SkeletonInstance(ir))[0]!;
 near(packet.uvs[0]!,0);near(packet.uvs[1]!,1);near(packet.uvs[2]!,1);near(packet.uvs[3]!,1);
});
test('nonfinite explicit seek time is rejected with typed error',()=>{
 const ir=fixture();assert.throws(()=>new SkeletonInstance(ir).evaluate([{clipId:'rotate90',timeSec:NaN}]),e=>e instanceof EngineError&&e.code==='INVALID_TIMELINE');
});
