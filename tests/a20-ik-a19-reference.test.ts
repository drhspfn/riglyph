/** A19 independent reference corpus, emitted by the 4.1.24 black-box
 * executor. Compressed losslessly to keep self-authored synthetic fixture small.
 * No official runtime code, JAR, game data or binaries are embedded.
 */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {fixture,addBone} from './helpers.js';
import {apply,invert,inheritTransform,validateIR} from '@riglyph/core';
import type {IRDocument,Affine} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
type Oracle={chainLength:number;bendDirection:number;softness:number;flags:number;targetXY:number[];
 negativeParentScaleX:boolean;mix:number;worldAffine:{parent:number[];child:number[]}};
const corpus=JSON.parse(inflateSync(Buffer.from('eNrtmE1r3DAQhv+Lz1qjGc2MRr4Veuyh0EtKycHdeDeGrVN23Q8I+e8duRTSQ5xkS3BM5cMiZHmkef14eWduq2176k5V8+m22l63/fCuG/bjddWAqz53w9Xb/thtx/5mqJqNTZ1uduPQnWy9r72rdod2n8euGtvjvhsvPlogZrsF9nPpqqHbt2P/vXvfHrth/LBtD91F1ezaw6lz1Zf+p+2T4/y4OR6u3ux2/dBVzW31dVptoaAOJD54dRtfo8REHJyvSZEIk40iiKiAg1gHDEnYhjUlgaTRtt9e94er33FsGWMO4xUYRezhkIA9RRsJCACgE6op2FwIDrQOCpJULu/u3DPFydk/oA6EfC/6GXnG47c/6tjR+GF5cjYhS5Gz9jFENaVsBBiR2PJC75l8fEweiwMSvJgCvlYylTXrk9RimrgWh2OKaHGkBrUFoC5InQiYVc/Q5z488HLw+CiWSvgbnqCs+Dx4wINXTTkO+CxyVgcTi88iixdJJl0+er6iTAnkC/6VHSjszLGD5Y9nBh4s8MzBQwWeGXiowDMHjxR4ZuCRAs80U+zyU7QpbvnJ6BSzXLzyeeQUq9wUp3weOsUoN8Unn4dOsclNccn35MHX0FW2VCIqTVZHA6tlkJMyPUKg/PYZyRM+Jo5lr2zaTIqExMxTxBhFI6lNsk8MlBxF29BwtTcWDCMElUhniLM+n2z+L0DIn6NyBEwpx7HgKFlxSAZMgheBBwo8a28rLwcPFnjW3lZeDh4q8Ky9rbwcPFLgWXtb+aXhWaKtjCrKKZ+fPKep5rLySpgzOlYBsFUJT5AGrYCwsmFju7GxkTIwMVOSpnYheivfrJgQtKKMfLBSbEN1CEYOPF+a4pZfQ1d59eQUq7xQV3n15BSfvFBTefXkFJO8UE959eT8Bw758u4XUmwSlg==','base64')).toString()) as {cases:Oracle[]};
assert.equal(corpus.cases.length,40);
function make(row:Oracle):IRDocument{
 const ir=fixture();
 Object.assign(ir.skeleton.bones[0]!.setup,{x:12,y:-7,rotationDeg:19,scaleX:1.3,scaleY:.9});
 const parent=addBone(ir,'parent');
 Object.assign(parent.setup,{x:6,y:7,rotationDeg:13,scaleX:row.negativeParentScaleX?-1.1:1.1,scaleY:.85,length:35});
 const child=addBone(ir,'child','parent');
 Object.assign(child.setup,{x:35,y:0,rotationDeg:-7,scaleX:1,scaleY:.8,length:25});
 const target=addBone(ir,'target');
 const root=inheritTransform({a:1,b:0,c:0,d:1,x:0,y:0},ir.skeleton.bones[0]!.setup,'normal');
 const [x,y]=apply(invert(root),row.targetXY[0]!,row.targetXY[1]!);
 target.setup.x=x;target.setup.y=y;
 ir.skeleton.constraints.push({id:'ik',kind:'ik',order:0,
  targetBoneId:'target',targetSlotId:null,boneIds:row.chainLength===2?['parent','child']:['parent'],
  parameters:{mix:row.mix,bendDirection:row.bendDirection,softness:row.softness,
   compress:!!(row.flags&1),stretch:!!(row.flags&2),uniform:!!(row.flags&4)}});
 ir.capabilities.push('ik_constraint');validateIR(ir);return ir;
}
const matrix=(m:Affine)=>[m.a,m.c,m.b,m.d,m.x,m.y];
let measuredCases=0,numericMaxDelta=0;
after(()=>console.log('NUMERIC_REFERENCE_SUMMARY A19 IK: '+measuredCases+' cases, maxAbsDelta='+numericMaxDelta.toPrecision(12)));
for(const [index,row] of corpus.cases.entries())test(`A19 IK reference ${index+1}/40`,()=>{
 const instance=new SkeletonInstance(make(row)).evaluate();
 const names=['parent','child'] as const;
 let worst=0;
 const comparisons:string[]=[];
 for(const name of names){
  const actual=matrix(instance.world.get(name)!);
  const expected=row.worldAffine[name];
  const deltas=actual.map((n,i)=>Math.abs(n-expected[i]!));
  worst=Math.max(worst,...deltas);
  comparisons.push(`${name} expected=[${expected}] actual=[${actual}]`);
 }
 measuredCases++;
 numericMaxDelta=Math.max(numericMaxDelta,worst);
 assert.ok(worst<=1e-4,`A19 IK ${index+1} maxDelta=${worst}; ${comparisons.join(' | ')}`);
});
