import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import type {Vertex} from '@riglyph/core';
import {validateIR} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';

/** Synthetic behavioral invariant: zero-offset chain joins the evaluated tip,
 * whereas a nonzero rotation offset disables tip translation. */
for(const offsetRotation of [0,15]){
 test(`path chain tip connection at offset ${offsetRotation} degrees`,()=>{
  const ir=fixture();
  const first=addBone(ir,'first');
  Object.assign(first.setup,{x:2,y:5,rotationDeg:0,length:20});
  const second=addBone(ir,'second');
  Object.assign(second.setup,{x:-7,y:4,rotationDeg:0,length:5});
  const vertices:Vertex[]=[0,10,20,30].map(x=>({position:[x,0],influences:[]}));
  ir.skeleton.attachments.push({id:'straight',name:'straight',kind:'path',
   color:[1,1,1,1],vertices,closed:false,constantSpeed:true,lengths:[30]});
  ir.skeleton.slots[0]!.setupAttachmentId='straight';
  ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'straight',attachmentId:'straight'});
  ir.skeleton.constraints.push({id:'follow',kind:'path',order:0,
   boneIds:['first','second'],targetBoneId:null,targetSlotId:'slot0',
   parameters:{positionMode:'fixed',spacingMode:'fixed',rotateMode:'chain',
    position:0,spacing:8,mixRotate:1,mixX:1,mixY:1,offsetRotation}});
  ir.capabilities.push('path','path_constraint');
  validateIR(ir);
  const result=new SkeletonInstance(ir).evaluate();
  const a=result.world.get('first')!,b=result.world.get('second')!;
  const tipX=a.x+a.a*first.setup.length,tipY=a.y+a.b*first.setup.length;
  if(offsetRotation===0){
   assert.ok(Math.abs(b.x-tipX)<1e-6,`tip x: ${b.x} vs ${tipX}`);
   assert.ok(Math.abs(b.y-tipY)<1e-6,`tip y: ${b.y} vs ${tipY}`);
  }else{
   assert.ok(Math.abs(b.x-8)<1e-6,`nonzero offset must not snap: ${b.x}`);
   assert.ok(Math.abs(b.y)<1e-6);
  }
  const previous=[a.x,a.y,b.x,b.y];
  result.evaluate();
  assert.deepEqual([result.world.get('first')!.x,result.world.get('first')!.y,
   result.world.get('second')!.x,result.world.get('second')!.y],previous);
 });
}
