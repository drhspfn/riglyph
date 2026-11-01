/** Review follow-up: numerical solver behavior, not additional official oracles.
 * Independent expected positions use forward kinematics, not the IK solver.
 * Six world-affine components are checked in reflected/sheared cases.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply,inheritTransform,shortestAngleDelta} from '@riglyph/core';
import type {Affine,Transform} from '@riglyph/core';
import {solveTwoLink} from '../packages/runtime/src/runtime/ik-solver.js';

const unit:Affine={a:1,b:0,c:0,d:1,x:0,y:0};
const pose=(overrides:Partial<Transform>={}):Transform=>({
 x:0,y:0,length:0,rotationDeg:0,scaleX:1,scaleY:1,shearXDeg:0,shearYDeg:0,...overrides
});
const components=(m:Affine)=>[m.a,m.c,m.b,m.d,m.x,m.y];
const world=(base:Affine,first:Transform,second:Transform)=>{
 const parent=inheritTransform(base,first,'normal');
 const child=inheritTransform(parent,second,'normal');
 return {parent,child,tip:apply(child,second.length,0)};
};
const near=(a:number,b:number,eps=1e-8)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);

test('IK softness selects a solution for the effective target, not the original unreachable target',()=>{
 const first=pose({length:35}),second=pose({x:35,length:25});
 const goal:[number,number]=[80,0],softness=20;
 // First pivot at origin; effective softened reach is 80 - (40-10) = 50.
 const effective:[number,number]=[50,0];
 for(const bend of [-1,1] as const){
  const full=solveTwoLink({parentBasis:null,first,second,firstInheritance:'normal',
   secondInheritance:'normal',target:goal,bend,mix:1,softness});
  const tip=world(unit,full.first,full.second).tip;
  assert.ok(Math.hypot(tip[0]-effective[0],tip[1]-effective[1])<0.02,
   `bend ${bend}: tip ${tip} does not meet softened goal ${effective}`);
  assert.ok(Math.hypot(tip[0]-goal[0],tip[1]-goal[1])>10);
  assert.ok(full.residual<0.02,`softened solve residual ${full.residual}`);
  const partial=solveTwoLink({parentBasis:null,first,second,firstInheritance:'normal',
   secondInheritance:'normal',target:goal,bend,mix:.4,softness});
  near(partial.first.rotationDeg,first.rotationDeg+
   shortestAngleDelta(first.rotationDeg,full.first.rotationDeg)*.4,1e-7);
  near(partial.second.rotationDeg,second.rotationDeg+
   shortestAngleDelta(second.rotationDeg,full.second.rotationDeg)*.4,1e-7);
 }
});

test('zero-X nonzero-Y IK offset retains a real lever under mirrored, nonuniform and sheared parents',()=>{
 for(const reflected of [false,true])for(const bend of [-1,1] as const){
  const base=inheritTransform(unit,pose({x:6,y:-5,rotationDeg:17,
   scaleX:reflected?-1.3:1.3,scaleY:.74,shearXDeg:6,shearYDeg:11}),'normal');
  const first=pose({x:5,y:8,rotationDeg:12,shearXDeg:7,shearYDeg:-9,
   scaleX:1.08,scaleY:.92,length:25});
  const second=pose({x:0,y:12,rotationDeg:-16,shearXDeg:-6,shearYDeg:8,
   scaleX:.95,scaleY:1.12,length:16});
  const expected=world(base,{...first,rotationDeg:37},{...second,rotationDeg:23}).tip;
  const opts={parentBasis:base,first,second,firstInheritance:'normal' as const,
   secondInheritance:'normal' as const,target:expected,bend};
  const none=solveTwoLink({...opts,mix:0});
  assert.deepEqual(none.first,first);
  assert.deepEqual(none.second,second);
  const full=solveTwoLink({...opts,mix:1}),half=solveTwoLink({...opts,mix:.5});
  const solvedWorld=world(base,full.first,full.second),halfWorld=world(base,half.first,half.second);
  for(const matrix of [solvedWorld.parent,solvedWorld.child,halfWorld.parent,halfWorld.child]){
   assert.equal(components(matrix).length,6);
   assert.ok(components(matrix).every(Number.isFinite));
  }
  // Both constrained matrices must be genuine, deterministic world-affine
  // updates; interpolated mix is applied to local rotations before world FK.
  const secondRun=solveTwoLink({...opts,mix:1});
  for(const [x,y] of [
   [solvedWorld.parent,world(base,secondRun.first,secondRun.second).parent],
   [solvedWorld.child,world(base,secondRun.first,secondRun.second).child]
  ] as [Affine,Affine][])components(x).forEach((v,i)=>near(v,components(y)[i]!,1e-10));
  const predictedFirst={...first,rotationDeg:first.rotationDeg+
   shortestAngleDelta(first.rotationDeg,full.first.rotationDeg)*.5};
  const predictedSecond={...second,rotationDeg:second.rotationDeg+
   shortestAngleDelta(second.rotationDeg,full.second.rotationDeg)*.5};
  const predicted=world(base,predictedFirst,predictedSecond);
  components(halfWorld.parent).forEach((v,i)=>near(v,components(predicted.parent)[i]!,1e-7));
  components(halfWorld.child).forEach((v,i)=>near(v,components(predicted.child)[i]!,1e-7));
  assert.ok(Math.abs(full.first.rotationDeg-first.rotationDeg)>1e-3,
   'Nonzero child Y must not be treated as the collapsed zero-length pivot branch');
 }
});
