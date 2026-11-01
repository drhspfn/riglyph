import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.js';
import {validateIR} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
import type {Vertex} from '@riglyph/core';

for(const weighted of [false,true])test(`A20 path vertex deform ${weighted?'weighted':'unweighted'}`,()=>{
 const ir=fixture(),vertices:Vertex[]=Array.from({length:4},(_,i)=>weighted?
  {position:null,influences:[{boneId:'root',x:i*5,y:0,weight:.5},{boneId:'root',x:i*5,y:0,weight:.5}]}:
  {position:[i*5,0],influences:[]});
 ir.skeleton.attachments.push({id:'deform-path',name:'deform-path',kind:'path',color:[1,1,1,1],closed:false,constantSpeed:true,lengths:[15],vertices});
 ir.skeleton.slots[0]!.setupAttachmentId='deform-path';
 ir.skeleton.skins[0]!.attachments[0]!.attachmentId='deform-path';
 ir.capabilities.push('path','deform');
 const count=weighted?16:8;
 const zero=Array(count).fill(0),full=Array.from({length:count},(_,i)=>i%2===0?2:-4);
 ir.skeleton.animations=[{id:'bend',name:'bend',durationSec:1,timelines:[{
  targetKind:'attachment',targetId:'deform-path',property:'deform',
  deformBasis:weighted?'influence_delta':'vertex_delta',keys:[
   {timeSec:0,value:zero,interpolation:{kind:'linear'}},
   {timeSec:1,value:full,interpolation:{kind:'linear'}}]
 }]}];
 assert.doesNotThrow(()=>validateIR(ir));
 const s=new SkeletonInstance(ir).evaluate([{clipId:'bend',timeSec:0.5}]);
 const coords=s.vertices(vertices,'root',s.deforms.get('deform-path'));
 assert.ok(Math.abs(coords[0]!-1)<1e-5);
 assert.ok(Math.abs(coords[1]!+2)<1e-5);
 s.evaluate([{clipId:'bend',timeSec:0}]);
 assert.equal(s.vertices(vertices,'root',s.deforms.get('deform-path'))[0],0);
});
