/** Independent numerical observations from the user-supplied 4.1.24
 * reference executor, 2026-11-01. Expected components are Java
 * m00,m01,m10,m11,worldX,worldY (not internal a,b,c,d,x,y).
 * Input scenes below are fully self-authored Universal IR.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import {apply,inheritTransform,invert,validateIR} from '@riglyph/core';
import type {IRDocument,Affine} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
const rows = [["A20-IK-01",0,0,0,0,0,1,55,15,1.3,1.1,0.85,1,35,[1.34603083,-0.26794529,0.48244286,0.71668613,17.32396507,1.49619865],[1.36865199,-0.08152656,0.3915047,0.61611122,64.43504333,18.38169861]],["A20-IK-02",0,0,1,0,0,1,3,3,1.3,1.1,0.85,1,35,[-0.4092561,-0.37696159,0.04296582,-0.80091667,17.32396507,1.49619865],[-0.36026549,-0.33922201,0.14025275,-0.63176847,3.00000191,3.00000238]],["A20-IK-03",0,0,1,0,1,1,3,3,1.3,1.1,0.85,1,35,[-0.4092561,-0.11853004,0.04296582,-0.25183648,17.32396507,1.49619865],[-0.39176038,-0.13401784,0.07333671,-0.19577849,3.00000191,3.00000238]],["A20-IK-04",0,0,0,1,0,1,180,80,1.3,1.1,0.85,1,35,[4.64788771,-0.42183098,2.24296618,0.65222406,17.32396507,1.49619865],[4.66465139,0.11819857,2.14676118,0.73656899,180.00003052,80.00001526]],["A20-IK-05",0,0,0,1,1,1,180,80,1.3,1.1,0.85,1,35,[4.64788771,-1.53378296,2.24296618,2.37149525,17.32396507,1.49619865],[4.80016422,-0.7647323,1.93723476,2.10173392,180.00003052,80.00001526]],["A20-IK-06",0,0,1,1,1,0.5,180,80,1.3,1.1,0.85,1,35,[2.92562652,-1.04299295,1.48537815,1.47958839,17.32396507,1.49619865],[3.03092813,-0.5429396,1.2939899,1.31966543,119.72089386,53.48443604]],["A20-IK-07",0,0,0,0,0,0,55,15,1.3,1.1,0.85,1,35,[1.24493301,-0.47770452,0.66419858,0.62385631,17.32396507,1.49619865],[1.29387093,-0.2579397,0.58321881,0.5601213,60.8966217,24.7431488]],["A20-IK-08",0,0,0,1,1,0.6,55,15,-1.3,-1.1,0.85,-1,35,[1.37414455,-0.16165173,0.38641807,0.75063771,2.57387733,-3.58266449],[1.38360226,0.00561541,0.29205805,0.63370806,50.66893768,9.94196796]],["A20-IK-09",1,0,0,0,0,1,55,15,1.3,1.1,0.85,1,35,[1.28685915,0.40598002,-0.16665542,0.79751635,17.32396507,1.49619865],[-0.29456103,-1.05346978,0.77346992,-0.20482273,62.36403656,-4.33674097]],["A20-IK-10",1,0,0,0,0,1,55,15,1.3,1.1,0.85,-1,35,[0.87284297,-0.83589721,0.94073343,0.35240418,17.32396507,1.49619865],[0.2850616,0.93955529,-0.77687478,0.50951493,47.87346649,34.42186737]],["A20-IK-11",1,15,0,0,0,1,80,25,1.3,1.1,0.85,1,35,[1.37851477,0.13765338,0.10333902,0.80389059,17.32396507,1.49619865],[0.57413721,-1.00864041,0.79435879,0.12878059,65.57198334,5.11306429]],["A20-IK-12",1,0,0,1,0,1,180,80,1.3,1.1,0.85,1,35,[1.27829218,-0.42183098,0.61687511,0.65222406,17.32396507,1.49619865],[1.27829218,-0.33746481,0.61687511,0.52177924,62.06419373,23.08682823]],["A20-IK-13",1,0,1,0,1,1,3,3,1.3,1.1,0.85,-1,35,[-1.38928306,-0.03394254,-0.20351127,-0.79239267,17.32396507,1.49619865],[1.37203789,-0.17667429,0.3450681,0.59342051,-31.30094337,-5.62669563]],["A20-IK-14",1,15,1,1,1,0.65,135,70,1.3,-1.1,0.85,-1,35,[-0.03244209,1.07378078,1.01272452,0.20054066,17.32396507,1.49619865],[-0.07831392,0.85712993,1.00322616,0.19491906,16.18849182,36.94155884]],["A20-IK-15",1,15,1,1,1,0,135,70,1.3,-1.1,0.85,-1,35,[-1.24493301,-0.47770452,-0.66419858,0.62385631,17.32396507,1.49619865],[-1.17743587,-0.50069034,-0.7352767,0.43060857,-26.24868965,-21.7507515]],["A20-IK-16",1,0,0,0,0,1,55,15,1.3,1.1,0.85,1,0,[1.34603083,-0.26794529,0.48244286,0.71668613,17.32396507,1.49619865],[1.34603083,-0.21435627,0.48244286,0.57334894,17.32396507,1.49619865]],["A20-IK-17",1,0,0,0,0,1,55,15,1.3,1.1,0.85,1,35,[1.28685915,0.40598002,-0.16665542,0.79751635,17.32396507,1.49619865],[-0.29456103,-1.05346978,0.77346992,-0.20482273,62.36403656,-4.33674097]]] as const;
const matrix=(m:Affine)=>[m.a,m.c,m.b,m.d,m.x,m.y];
function make(row:typeof rows[number]):IRDocument{
 const [id,two,soft,compress,stretch,uniform,mix,tx,ty,baseSX,parentSX,parentSY,bend,childX]=row;
 const ir=fixture();
 Object.assign(ir.skeleton.bones[0]!.setup,{x:12,y:-7,rotationDeg:19,scaleX:baseSX,scaleY:.9});
 const parent=addBone(ir,'parent');
 Object.assign(parent.setup,{x:6,y:7,rotationDeg:13,scaleX:parentSX,scaleY:parentSY,length:35});
 const child=addBone(ir,'child','parent');
 Object.assign(child.setup,{x:childX,y:0,rotationDeg:-7,scaleX:1,scaleY:.8,length:25});
 const target=addBone(ir,'target');
 const root=inheritTransform({a:1,b:0,c:0,d:1,x:0,y:0},ir.skeleton.bones[0]!.setup,'normal');
 const position=apply(invert(root),tx,ty);target.setup.x=position[0];target.setup.y=position[1];
 ir.skeleton.constraints.push({id:'ik',kind:'ik',order:0,activeInDefaultSkin:true,
  boneIds:two?['parent','child']:['parent'],targetBoneId:'target',targetSlotId:null,
  parameters:{mix,bendDirection:bend,softness:soft,compress:!!compress,stretch:!!stretch,uniform:!!uniform}});
 ir.capabilities.push('ik_constraint');
 validateIR(ir);
 return ir;
}
for(const row of rows)test(`independent A20 IK ${row[0]}`,()=>{
 const instance=new SkeletonInstance(make(row)).evaluate();
 const expected=[row[14],row[15]];
 let maximum=0;
 const observations:string[]=[];
 for(const [i,name] of ['parent','child'].entries()){
  const actual=matrix(instance.world.get(name)!);
  const errors=actual.map((v,j)=>Math.abs(v-expected[i]![j]!));
  maximum=Math.max(maximum,...errors);
  observations.push(`${name}: expected=[${expected[i]}] actual=[${actual}] deltas=[${errors}]`);
 }
 assert.ok(maximum<=1e-4,`${row[0]} maxDelta=${maximum} ${observations.join(' | ')}`);
});
