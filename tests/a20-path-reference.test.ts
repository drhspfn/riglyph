/** Independent Path 4.1.24 reference baseline, using a synthetic Universal IR. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import {validateIR} from '@riglyph/core';
import type {Affine,Vertex} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';

test('A20-PATH-01: open constant-speed tangent with follower, world affine',()=>{
 const ir=fixture();
 Object.assign(ir.skeleton.bones[0]!.setup,{x:20,y:-10,rotationDeg:17,scaleX:1.2,scaleY:.9});
 const one=addBone(ir,'one');
 Object.assign(one.setup,{x:5,y:6,rotationDeg:22,scaleX:1,scaleY:1,length:30});
 const two=addBone(ir,'two','one');
 Object.assign(two.setup,{x:30,y:0,rotationDeg:-4,scaleX:1,scaleY:1,length:25});
 const three=addBone(ir,'three','two');
 Object.assign(three.setup,{x:25,y:0,rotationDeg:9,scaleX:1,scaleY:1,length:18});
 const helper=addBone(ir,'helper');
 Object.assign(helper.setup,{x:22,y:-12,rotationDeg:-14,scaleX:1,scaleY:1.1});
 const points=[[-20,0],[0,0],[30,0],[60,20],[90,30],[110,20]];
 const vertices:Vertex[]=points.map(p=>({position:[p[0]!,p[1]!],influences:[]}));
 ir.skeleton.attachments.push({id:'path',name:'path',kind:'path',color:[1,1,1,1],
  closed:false,constantSpeed:true,lengths:[75,155],vertices});
 ir.skeleton.slots[0]!.setupAttachmentId='path';
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'path',attachmentId:'path'});
 ir.skeleton.constraints.push({id:'pc',kind:'path',order:0,boneIds:['one','two'],
  targetSlotId:'slot0',targetBoneId:null,parameters:{positionMode:'fixed',spacingMode:'fixed',
   rotateMode:'tangent',position:12,spacing:10,mixRotate:.7,mixX:.8,mixY:.5,offsetRotation:15}});
 ir.capabilities.push('path','path_constraint');
 validateIR(ir);
 const sk=new SkeletonInstance(ir).evaluate();
 const matrix=(m:Affine)=>[m.a,m.c,m.b,m.d,m.x,m.y];
 const expected={
  one:[.93305928,-.70523423,.69353634,.63328731,29.85266685,-4.48883152],
  two:[.91507131,-.69927406,.73653603,.61739421,44.06437683,7.69788456],
  three:[.7944147,-.83381349,.82404983,.49457347,66.94116211,26.11128616]
 };
 let max=0;const lines:string[]=[];
 for(const [name,reference] of Object.entries(expected)){
  const actual=matrix(sk.world.get(name)!);
  const d=actual.map((x,i)=>Math.abs(x-reference[i]!));max=Math.max(max,...d);
  lines.push(`${name}: expected=[${reference}] actual=[${actual}]`);
 }
 assert.ok(max<=1e-4,`A20-PATH-01 maxDelta=${max}; ${lines.join(' | ')}`);
});
