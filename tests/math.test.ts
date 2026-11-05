import test from 'node:test';import assert from 'node:assert/strict';
import {multiply,localMatrix,apply,inheritTransform,polarDecompose,invert,mixAngle} from '../src/math/affine.js';
import {timelineValue,bezierFraction} from '../src/runtime/curves.js';
import {identity} from './helpers.js';
const near=(a:number,b:number,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
test('affine rotation, shear and inversion are numerically stable',()=>{
 const m=localMatrix({...identity(),x:3,y:-4,rotationDeg:90});
 near(m.a,0);near(m.b,1);near(m.c,-1);near(m.d,0);
 assert.deepEqual(apply(m,2,0).map(x=>Math.round(x)),[3,-2]);
 const inv=invert(m),pt:[number,number]=[2,7];const dst=apply(m,...pt);assert.deepEqual(apply(inv,...dst).map(x=>+x.toFixed(6)),pt);
});
test('all five inheritance modes yield distinct predictable transforms',()=>{
 const parent=localMatrix({...identity(),x:1,y:2,rotationDeg:90,scaleX:2,scaleY:3});
 const child={...identity(),x:4,y:0};
 const normal=inheritTransform(parent,child,'normal');near(normal.x,1);near(normal.y,10);near(Math.hypot(normal.a,normal.b),2);
 const only=inheritTransform(parent,child,'only_translation');near(only.x,1);near(only.y,10);near(only.a,1);
 const noScale=inheritTransform(parent,child,'no_scale');near(Math.hypot(noScale.a,noScale.b),1);
 // Independent Viewer observation: retained stretch is in world axes.
 const noRot=inheritTransform(parent,child,'no_rotation_or_reflection');near(noRot.a,3);near(noRot.d,2);
 const noScaleNoRefl=inheritTransform(parent,child,'no_scale_or_reflection');near(Math.hypot(noScaleNoRefl.a,noScaleNoRefl.b),1);
});
test('negative reflection and polar decomposition remove scale without NaN',()=>{
 const m=localMatrix({...identity(),rotationDeg:30,scaleX:-4,scaleY:2});
 const p=polarDecompose(m),recomposed=multiply(p.rotation,p.stretch);
 near(recomposed.a,m.a);near(recomposed.d,m.d);near(Math.abs(p.rotation.a*p.rotation.d-p.rotation.b*p.rotation.c),1);
});
test('Bezier inverts time X instead of assuming curve parameter equals time',()=>{
 near(bezierFraction(.5,[.25,.1,.25,1]),.8024033876,1e-5);
 near(bezierFraction(0,[.25,0,.75,1]),0);near(bezierFraction(1,[.25,0,.75,1]),1);
});
test('timeline before first key leaves setup and last holds after end',()=>{
 const keys=[{timeSec:.5,value:0,interpolation:{kind:'linear' as const}},{timeSec:1.5,value:100,interpolation:{kind:'stepped' as const}}];
 assert.equal(timelineValue(keys,0),undefined);assert.equal(timelineValue(keys,1),50);assert.equal(timelineValue(keys,100),100);
});
test('stepped stays on previous key; channel-specific Bezier works',()=>{
 const keys=[{timeSec:0,value:[0,0],interpolation:{kind:'cubic_bezier' as const,bezierByChannel:[[0,0,1,1] as [number,number,number,number],[.25,.1,.25,1] as [number,number,number,number]]}},{timeSec:1,value:[10,10],interpolation:{kind:'stepped' as const}}];
 const value=timelineValue(keys,.5) as number[];near(value[0]!,5);assert.ok(value[1]!>8);
 assert.equal(timelineValue([{timeSec:0,value:4,interpolation:{kind:'stepped'}},{timeSec:1,value:9,interpolation:{kind:'linear'}}],.75),4);
});
test('rotation winding uses the shortest difference',()=>{near(mixAngle(350,10,.5),360);near(mixAngle(10,350,.5),0);});
