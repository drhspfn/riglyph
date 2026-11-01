import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import {apply,invert,inheritTransform,validateIR} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
import type {Affine,IRDocument} from '@riglyph/core';

type Case={id:string;tx:number;ty:number;compress:boolean;uniform:boolean;parent:number[];child:number[]};
const cases:Case[]=[
 {id:'A20-IK-01',tx:55,ty:15,compress:false,uniform:false,
  parent:[1.34603083,-.26794529,.48244286,.71668613,17.32396507,1.49619865],
  child:[1.36865199,-.08152656,.3915047,.61611122,64.43504333,18.38169861]},
 {id:'A20-IK-02',tx:3,ty:3,compress:true,uniform:false,
  parent:[-.40925610,-.37696159,.04296582,-.80091667,17.32396507,1.49619865],
  child:[-.36026549,-.33922201,.14025275,-.63176847,3.00000191,3.00000238]},
 {id:'A20-IK-03',tx:3,ty:3,compress:true,uniform:true,
  parent:[-.40925610,-.11853004,.04296582,-.25183648,17.32396507,1.49619865],
  child:[-.39176038,-.13401784,.07333671,-.19577849,3.00000191,3.00000238]}
];
const matrix=(m:Affine)=>[m.a,m.c,m.b,m.d,m.x,m.y]; // Java m00,m01,m10,m11,tx,ty
function scene(v:Case):IRDocument{
 const ir=fixture();
 const root=ir.skeleton.bones[0]!;
 root.setup={...root.setup,x:12,y:-7,rotationDeg:19,scaleX:1.3,scaleY:.9};
 const parent=addBone(ir,'parent');
 Object.assign(parent.setup,{x:6,y:7,rotationDeg:13,scaleX:1.1,scaleY:.85,length:35});
 const child=addBone(ir,'child','parent');
 Object.assign(child.setup,{x:35,y:0,rotationDeg:-7,scaleX:1,scaleY:.8,length:25});
 const target=addBone(ir,'target');
 const base=inheritTransform({a:1,b:0,c:0,d:1,x:0,y:0},root.setup,'normal');
 const [x,y]=apply(invert(base),v.tx,v.ty);
 target.setup.x=x;target.setup.y=y;
 ir.skeleton.constraints.push({id:'ik',kind:'ik',order:0,activeInDefaultSkin:true,
  targetBoneId:'target',targetSlotId:null,boneIds:['parent'],
  parameters:{mix:1,bendDirection:1,softness:0,compress:v.compress,stretch:false,uniform:v.uniform}});
 ir.capabilities.push('ik_constraint');
 validateIR(ir);return ir;
}
for(const expected of cases)test(`A20 one-bone reference ${expected.id}`,()=>{
 const ir=scene(expected),instance=new SkeletonInstance(ir).evaluate();
 for(const bone of ['parent','child'] as const){
  const actual=matrix(instance.world.get(bone)!);
  const golden=expected[bone];
  const errors=actual.map((x,i)=>Math.abs(x-golden[i]!));
  assert.ok(Math.max(...errors)<=1e-4,`${expected.id} ${bone} expected ${golden} actual ${actual} deviation ${Math.max(...errors)}`);
 }
});
