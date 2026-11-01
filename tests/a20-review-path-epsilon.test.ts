/** Review follow-up: near-coincident chord behavior at the 1e-8
 * world-space threshold. These are self-authored invariants, not source oracles.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import type {Vertex,Affine} from '@riglyph/core';
import {validateIR} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';

function evaluate(closed:boolean,reflected:boolean,mode:'chain'|'chainScale',spacing:number):number[]{
 const ir=fixture();
 ir.skeleton.bones[0]!.setup.scaleX=reflected?-1:1;
 const bone=addBone(ir,'one');
 Object.assign(bone.setup,{x:2,y:1,rotationDeg:10,length:6});
 const vertices:Vertex[]=([[0,0],[10,0],[20,0],[30,0]] as [number,number][])
  .map(([x,y]):Vertex=>({position:[x,y],influences:[]}));
 ir.skeleton.attachments.push({id:'track',name:'track',kind:'path',
  color:[1,1,1,1],vertices,closed,constantSpeed:true,lengths:[30]});
 ir.skeleton.slots[0]!.setupAttachmentId='track';
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'track',attachmentId:'track'});
 ir.skeleton.constraints.push({id:'follow',kind:'path',order:0,boneIds:['one'],
  targetBoneId:null,targetSlotId:'slot0',
  parameters:{positionMode:'percent',position:.25,spacingMode:'fixed',spacing,
   rotateMode:mode,mixRotate:.75,mixX:1,mixY:1,offsetRotation:0}});
 ir.capabilities.push('path','path_constraint');
 validateIR(ir);
 const instance=new SkeletonInstance(ir).evaluate();
 const matrix=(m:Affine)=>[m.a,m.c,m.b,m.d,m.x,m.y];
 const first=matrix(instance.world.get('one')!);
 assert.ok(first.every(Number.isFinite),`nonfinite world affine ${first}`);
 instance.evaluate();
 assert.deepEqual(matrix(instance.world.get('one')!),first,'repeated seek must not drift');
 return first;
}

for(const closed of [false,true])
 for(const reflected of [false,true])
  for(const mode of ['chain','chainScale'] as const)
   for(const reverse of [false,true])
    test(`near-coincident Path ${closed?'closed':'open'} ${reflected?'mirrored':'normal'} ${mode} ${reverse?'reverse':'forward'}`,()=>{
     const sign=reverse?-1:1;
     const below=evaluate(closed,reflected,mode,sign*2e-9);
     const above=evaluate(closed,reflected,mode,sign*3e-8);
     const atZero=evaluate(closed,reflected,mode,0);
     // A physically continuous nonzero chord should not flip by 180 degrees
     // simply because its magnitude crossed the fallback boundary.
     const maxBasisDiff=Math.max(...below.slice(0,4).map((v,i)=>Math.abs(v-above[i]!)));
     assert.ok(maxBasisDiff<.08,
      `near 1e-8 threshold produced discontinuity ${maxBasisDiff}; below=${below}, above=${above}`);
     assert.ok(atZero.every(Number.isFinite));
    });
