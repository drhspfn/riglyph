import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import type {IRDocument,Vertex} from '@riglyph/core';
import {validateIR} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';

function scene(weighted:boolean):IRDocument{
 const ir=fixture();const one=addBone(ir,'one');
 one.setup.x=3;one.setup.y=8;one.setup.length=10;
 const points:[[number,number],[number,number],[number,number],[number,number]]=[
  [0,0],[10,0],[20,0],[30,0]];
 const vertices:Vertex[]=points.map(([x,y])=>weighted?
  {position:null,influences:[{boneId:'root',x,y,weight:.6},{boneId:'root',x,y,weight:.4}]}:
  {position:[x,y],influences:[]});
 const path={id:'p',name:'p',kind:'path' as const,color:[1,1,1,1] as [number,number,number,number],
  vertices,closed:false,constantSpeed:true,lengths:[30]};
 ir.skeleton.attachments.push(path);
 ir.skeleton.slots[0]!.setupAttachmentId='p';
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'path',attachmentId:'p'});
 ir.skeleton.constraints.push({id:'follow',kind:'path',order:0,boneIds:['one'],targetBoneId:null,targetSlotId:'slot0',
  parameters:{rotateMode:'tangent',positionMode:'fixed',spacingMode:'fixed',position:6,spacing:0,
   mixRotate:1,mixX:1,mixY:1,offsetRotation:0}});
 ir.capabilities.push('path','path_constraint','deform');
 if(weighted)ir.capabilities.push('weighted_mesh');
 const count=weighted?16:8;
 const blank=Array(count).fill(0),moved=Array.from({length:count},(_,i)=>i%2===0?5:-3);
 ir.skeleton.animations=[{id:'reshape',name:'reshape',durationSec:1,timelines:[{
  targetKind:'attachment',targetId:'p',property:'deform',
  deformBasis:weighted?'influence_delta':'vertex_delta',keys:[
   {timeSec:0,value:blank,interpolation:{kind:'linear'}},
   {timeSec:1,value:moved,interpolation:{kind:'linear'}}]
 }]}];
 validateIR(ir);return ir;
}
for(const weighted of [false,true])test(`A20 path constraint consumes ${weighted?'weighted':'unweighted'} deform and seeks without drift`,()=>{
 const instance=new SkeletonInstance(scene(weighted));
 const at=(time:number)=>{
  instance.evaluate([{clipId:'reshape',timeSec:time}]);
  const w=instance.world.get('one')!;
  return [w.a,w.b,w.c,w.d,w.x,w.y];
 };
 const start=at(0),end=at(1);
 assert.ok(Math.abs(end[4]!-start[4]!-5)<1e-4,`x translation: ${start[4]} -> ${end[4]}`);
 assert.ok(Math.abs(end[5]!-start[5]!+3)<1e-4,`y translation: ${start[5]} -> ${end[5]}`);
 assert.deepEqual(at(0),start);
 assert.deepEqual(at(1),end);
 assert.deepEqual(at(.5),at(.5));
});
