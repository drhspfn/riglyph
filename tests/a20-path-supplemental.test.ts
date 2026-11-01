/** A20 17 independent supplemental Path observations. Goldens are losslessly
 * deflated: expected matrices and original parameters remain unchanged.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {fixture,addBone} from './helpers.js';
import type {IRDocument,Affine,Vertex} from '@riglyph/core';
import {validateIR} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
import {pathReferenceTolerance} from './path-reference-precision.js';
type Parameters={count:number;closed:boolean;constant:boolean;rotate:string;spacingMode:string;posMode:string;position:number;spacing:number;mixRotate:number;mixX:number;mixY:number;offset:number;rootSX:number;helperSX:number;weighted?:boolean;deform?:boolean};
type Row=[string,Parameters,[number[],number[],number[]]];
const rows=JSON.parse(inflateSync(Buffer.from('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','base64')).toString()) as Row[];
assert.equal(rows.length,17);
const coords:[number,number][]=[[-20,0],[0,0],[30,0],[60,20],[90,30],[110,20]];
const matrix=(m:Affine)=>[m.a,m.c,m.b,m.d,m.x,m.y];
function make(p:Parameters):IRDocument{
 const ir=fixture(),root=ir.skeleton.bones[0]!;
 Object.assign(root.setup,{x:20,y:-10,rotationDeg:17,scaleX:p.rootSX,scaleY:.9});
 const one=addBone(ir,'one');Object.assign(one.setup,{x:5,y:6,rotationDeg:22,scaleX:1,scaleY:1,length:30});
 const two=addBone(ir,'two','one');Object.assign(two.setup,{x:30,y:0,rotationDeg:-4,scaleX:1,scaleY:1,length:25});
 const three=addBone(ir,'three','two');Object.assign(three.setup,{x:25,y:0,rotationDeg:9,scaleX:1,scaleY:1,length:18});
 const helper=addBone(ir,'helper');Object.assign(helper.setup,{x:22,y:-12,rotationDeg:-14,scaleX:p.helperSX,scaleY:1.1});
 const vertices:Vertex[]=coords.map(([x,y])=>p.weighted?{position:null,influences:[
  {boneId:'root',x,y,weight:.7},{boneId:'helper',x,y,weight:.3}]}:{position:[x,y],influences:[]});
 ir.skeleton.attachments.push({id:'path',name:'path',kind:'path',color:[1,1,1,1],vertices,
  closed:p.closed,constantSpeed:p.constant,lengths:[75,155]});
 ir.skeleton.slots[0]!.setupAttachmentId='path';
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'path',attachmentId:'path'});
 ir.skeleton.constraints.push({id:'follow',kind:'path',order:0,
  boneIds:p.count===3?['one','two','three']:['one','two'],targetSlotId:'slot0',targetBoneId:null,
  parameters:{rotateMode:p.rotate,spacingMode:p.spacingMode,positionMode:p.posMode,
   position:p.position,spacing:p.spacing,mixRotate:p.mixRotate,mixX:p.mixX,mixY:p.mixY,
   offsetRotation:p.offset}});
 ir.capabilities.push('path','path_constraint');if(p.weighted)ir.capabilities.push('weighted_mesh');
 if(p.deform){
  const floatCount=p.weighted?24:12;
  // Spine unweighted wire deform stores absolute vertex coordinates; the
  // canonical IR keeps vertex_delta. Weighted wire data are influence deltas.
  const values=p.weighted?Array.from({length:floatCount},(_,i)=>i%2?-2.25:1.5):
   coords.flatMap(([x,y])=>[1.5-x,-2.25-y]);
  ir.skeleton.animations=[{id:'deform',name:'deform',durationSec:1,timelines:[{
   targetKind:'attachment',targetId:'path',property:'deform',
   deformBasis:p.weighted?'influence_delta':'vertex_delta',keys:[
    {timeSec:0,value:Array(floatCount).fill(0),interpolation:{kind:'linear'}},
    {timeSec:1,value:values,interpolation:{kind:'stepped'}}]
  }]}];
 }
 validateIR(ir);return ir;
}
for(const [id,p,expected] of rows)test(`${id}: independent Path affine`,()=>{
 const instance=new SkeletonInstance(make(p));
 instance.evaluate(p.deform?[{clipId:'deform',timeSec:1}]:[]);
 let max=0;const details:string[]=[];const outOfBudget:string[]=[];
 for(const [i,name] of ['one','two','three'].entries()){
  const actual=matrix(instance.world.get(name)!);
  const errors=actual.map((value,index)=>Math.abs(value-expected[i]![index]!));
  max=Math.max(max,...errors);
  errors.forEach((delta,j)=>{const limit=pathReferenceTolerance(expected[i]![j]!,j);if(delta>limit)outOfBudget.push(`${name}[${j}]: delta=${delta}, limit=${limit}`);});
  details.push(`${name} expected=[${expected[i]}] actual=[${actual}]`);
 }
 assert.ok(outOfBudget.length===0,`${id}: maxDelta=${max} outOfBudget=[${outOfBudget}] ${details.join(' | ')}`);
});
