/** Independent synthetic black-box observations from Agent A19, not official runtime code.
 * Each case is a four-bone self-contained IR setup.  Reference: Viewer 4.1.24.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SkeletonInstance,inspectEvaluability} from '@riglyph/runtime';
import type {Transform,IRDocument,Constraint} from '@riglyph/core';
import {fixture} from './helpers.js';

type BoneOracle={worldAffine:number[];applied:number[];local:number[]};
type RefCase={space:'world'|'local';mode:'absolute'|'relative';mixMask:number;reflection:boolean;bones:Record<'target'|'driven'|'follower',BoneOracle>};
const ref=JSON.parse(readFileSync(new URL('../../tests/fixtures/a19-transform-goldens.json',import.meta.url),'utf8')) as {
 fixture:{target:{parent:null;pose:number[]};parent:{parent:null;pose:number[]};driven:{parent:string;pose:number[];reflectedScaleY:number};follower:{parent:string;pose:number[]};offsets:Record<string,number>;activeMixes:Record<string,number>};cases:RefCase[]
};
const f=ref.fixture;
function transform(p:readonly number[]):Transform{return {x:p[0]!,y:p[1]!,rotationDeg:p[2]!,scaleX:p[3]!,scaleY:p[4]!,shearXDeg:p[5]!,shearYDeg:p[6]!,length:0};}
function make(refCase:RefCase):IRDocument{
 const ir=fixture();
 ir.skeleton.bones=(['target','parent','driven','follower'] as const).map(id=>{
  const src=f[id];const pose=transform(src.pose);
  if(id==='driven'&&refCase.reflection)pose.scaleY=f.driven.reflectedScaleY;
  return {id,parentId:src.parent,setup:pose,inheritance:'normal' as const,skinRequired:false};
 });
 const m=f.activeMixes,o=f.offsets,mask=refCase.mixMask;
 const constraint:Constraint={id:'synthetic-xform',kind:'transform',order:0,activeInDefaultSkin:true,boneIds:['driven'],targetBoneId:'target',targetSlotId:null,
  parameters:{local:refCase.space==='local',relative:refCase.mode==='relative',offsetRotation:o['rotationDeg']!,offsetX:o['x']!,offsetY:o['y']!,offsetScaleX:o['scaleX']!,offsetScaleY:o['scaleY']!,offsetShearY:o['shearYDeg']!,
   mixRotate:mask&1?m['rotate']!:0,mixX:mask&2?m['x']!:0,mixY:mask&4?m['y']!:0,
   mixScaleX:mask&8?m['scaleX']!:0,mixScaleY:mask&16?m['scaleY']!:0,mixShearY:mask&32?m['shearY']!:0}};
 ir.skeleton.constraints=[constraint];return ir;
}
function assertVector(actual:number[],expected:number[],name:string,tolerance=1e-4):void{
 assert.equal(actual.length,expected.length,name);
 actual.forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-expected[i]!)<=tolerance,
  `${name}[${i}] expected ${expected[i]}, received ${v}; delta=${v-expected[i]!}`));
}
const affine=(m:{a:number;b:number;c:number;d:number;x:number;y:number})=>[m.a,m.c,m.b,m.d,m.x,m.y];
const applied=(t:Transform)=>[t.x,t.y,t.rotationDeg,t.scaleX,t.scaleY,t.shearXDeg,t.shearYDeg];
for(const [i,c] of ref.cases.entries())test(`A19 reference ${i}: ${c.space}/${c.mode} mask=${c.mixMask} reflection=${c.reflection}`,()=>{
 const ir=make(c),instance=new SkeletonInstance(ir).evaluate();
 assert.equal(inspectEvaluability(ir).fullyEvaluable,true);
 for(const id of ['target','driven','follower'] as const)
  assertVector(affine(instance.world.get(id)!),c.bones[id].worldAffine,`${id} world`);
 assertVector(applied(instance.applied.get('driven')!),c.bones.driven.applied,'driven applied',2e-4);
});
test('A19 chained constraints preserve first constrained world basis and update dependent child',()=>{
 const ir=make(ref.cases.find(c=>c.space==='world'&&c.mode==='absolute'&&c.mixMask===63&&!c.reflection)!);
 const drivenId='driven';
 const first=new SkeletonInstance(ir).evaluate();
 const parentWorld=affine(first.world.get(drivenId)!);
 const followerBefore=affine(first.world.get('follower')!);
 const c=structuredClone(ir.skeleton.constraints[0]!);
 c.id='second';c.order=1;c.targetBoneId='driven';c.boneIds=['follower'];c.parameters['mixRotate']=.55;c.parameters['mixX']=.25;c.parameters['mixY']=.35;
 ir.skeleton.constraints.push(c);
 const final=new SkeletonInstance(ir).evaluate();
 assertVector(affine(final.world.get(drivenId)!),parentWorld,'first constraint retained');
 const followerAfter=affine(final.world.get('follower')!);
 assert.ok(followerAfter.every(Number.isFinite));
 assert.ok(followerAfter.some((v,i)=>Math.abs(v-followerBefore[i]!)>1e-3));
 const again=new SkeletonInstance(ir).evaluate();
 assertVector(affine(again.world.get('follower')!),followerAfter,'deterministic chain',1e-7);
});

// The complete independent 0/1/2-constraint reference is verified separately
// by a19-chained-reference.test.ts.
