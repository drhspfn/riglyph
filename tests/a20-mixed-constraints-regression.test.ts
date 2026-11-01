/** Synthetic scheduler invariants. These tests are not independent Spine oracles:
 * they protect sequential constraint order, world matrices, and deterministic seeks.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import {validateIR} from '@riglyph/core';
import type {IRDocument,Constraint,Vertex} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';

const matrix=(m:{a:number;b:number;c:number;d:number;x:number;y:number})=>[m.a,m.c,m.b,m.d,m.x,m.y];
const transform=(id:string,order:number,boneIds:string[],target:string):Constraint=>({
 id,kind:'transform',order,boneIds,targetBoneId:target,targetSlotId:null,
 activeInDefaultSkin:true,parameters:{local:false,relative:false,offsetRotation:12,
 offsetX:3,offsetY:-4,offsetScaleX:0,offsetScaleY:0,offsetShearY:0,
 mixRotate:.32,mixX:.45,mixY:.27,mixScaleX:0,mixScaleY:0,mixShearY:0}
});
function make(kinds:readonly ('transform-pre'|'ik'|'path'|'transform-post')[]):IRDocument{
 const ir=fixture();
 Object.assign(ir.skeleton.bones[0]!.setup,{x:7,y:-3,rotationDeg:13,scaleX:1.1,scaleY:.92});
 const drive=addBone(ir,'drive');Object.assign(drive.setup,{x:9,y:5,rotationDeg:18,length:16});
 const knee=addBone(ir,'knee','drive');Object.assign(knee.setup,{x:16,y:0,rotationDeg:-11,length:13});
 const tip=addBone(ir,'tip','knee');Object.assign(tip.setup,{x:13,y:0,rotationDeg:8,length:11});
 const follower=addBone(ir,'follower','tip');Object.assign(follower.setup,{x:11,y:2,rotationDeg:5,length:3});
 const target=addBone(ir,'target');Object.assign(target.setup,{x:40,y:21});
 const xTarget=addBone(ir,'xTarget');Object.assign(xTarget.setup,{x:-6,y:25,rotationDeg:-27});
 const vertices:Vertex[]=[[0,0],[18,0],[38,12],[70,0]].map(([x,y])=>({position:[x,y],influences:[]}));
 ir.skeleton.attachments.push({id:'track',name:'track',kind:'path',
  color:[1,1,1,1],vertices,closed:false,constantSpeed:true,lengths:[70]});
 ir.skeleton.slots[0]!.setupAttachmentId='track';
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'track',attachmentId:'track'});
 const c:Record<string,Constraint>={
  'transform-pre':transform('pre',0,['drive'],'xTarget'),
  ik:{id:'ik',kind:'ik',order:1,boneIds:['drive','knee'],targetBoneId:'target',
   targetSlotId:null,activeInDefaultSkin:true,parameters:{mix:.72,bendDirection:1,
    softness:0,compress:false,stretch:false,uniform:false}},
  path:{id:'path',kind:'path',order:2,boneIds:['knee','tip'],targetBoneId:null,
   targetSlotId:'slot0',activeInDefaultSkin:true,parameters:{positionMode:'fixed',
   spacingMode:'fixed',rotateMode:'chain',position:6,spacing:12,mixRotate:.46,mixX:.65,mixY:.75,offsetRotation:7}},
  'transform-post':transform('post',3,['tip'],'xTarget')
 };
 ir.skeleton.constraints=kinds.map(k=>structuredClone(c[k]!));
 ir.capabilities.push('path','path_constraint','ik_constraint');
 validateIR(ir);
 return ir;
}
const variants=[
 ['transform-pre','ik'],
 ['ik','path'],
 ['path','transform-post'],
 ['transform-pre','ik','path','transform-post']
] as const;
for(const variant of variants)test(`scheduler: ${variant.join(' -> ')} repeats and preserves finite world matrices`,()=>{
 const s=new SkeletonInstance(make(variant));
 const capture=()=>new Map([...s.evaluate().world].map(([id,m])=>[id,matrix(m)]));
 const expected=capture();
 for(let pass=0;pass<12;pass++){
  const actual=capture();
  for(const [id,reference] of expected){
   const values=actual.get(id)!;
   values.forEach((v,i)=>{
    assert.ok(Number.isFinite(v),`${variant.join('>')} ${id} nonfinite[${i}]`);
    assert.ok(Math.abs(v-reference[i]!)<1e-9,`${variant.join('>')} ${id} drift[${i}] ${v} vs ${reference[i]}`);
   });
  }
 }
 const tail=matrix(s.world.get('follower')!);
 assert.ok(tail.every(Number.isFinite));
});
test('scheduler: all four constraints produce an observable composition, not a last-writer-only reset',()=>{
 const full=new SkeletonInstance(make(['transform-pre','ik','path','transform-post'])).evaluate();
 const last=new SkeletonInstance(make(['transform-post'])).evaluate();
 const m1=matrix(full.world.get('follower')!),m2=matrix(last.world.get('follower')!);
 assert.ok(m1.some((v,i)=>Math.abs(v-m2[i]!)>1e-3),
  'Preceding constraints must influence the world transform seen by the last constraint');
});
