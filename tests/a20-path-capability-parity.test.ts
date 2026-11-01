import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import type {IRDocument,Vertex} from '@riglyph/core';
import {validateIR} from '@riglyph/core';
import {inspectEvaluability} from '@riglyph/runtime';

function pathScene(reflected:boolean,spacing:number):IRDocument{
 const ir=fixture();
 ir.skeleton.bones[0]!.setup.scaleX=reflected?-1.2:1.2;
 addBone(ir,'follower');
 const vertices:Vertex[]=([[0,0],[10,0],[20,0],[30,0]] as [number,number][])
  .map(([x,y]):Vertex=>({position:[x,y],influences:[]}));
 ir.skeleton.attachments.push({id:'path',name:'path',kind:'path',closed:true,
  constantSpeed:true,color:[1,1,1,1],lengths:[30],vertices});
 ir.skeleton.slots[0]!.setupAttachmentId='path';
 ir.skeleton.skins[0]!.attachments.push({slotId:'slot0',key:'path',attachmentId:'path'});
 ir.skeleton.constraints.push({id:'follow',kind:'path',order:0,
  boneIds:['follower'],targetBoneId:null,targetSlotId:'slot0',
  parameters:{rotateMode:'tangent',spacingMode:'fixed',positionMode:'fixed',
   position:-14,spacing,mixRotate:.7,mixX:.8,mixY:.5,offsetRotation:15}});
 ir.capabilities.push('path','path_constraint');
 validateIR(ir);
 return ir;
}

test('capability audit does not certify known reflected-negative fixed Path numerical gap',()=>{
 const report=inspectEvaluability(pathScene(true,-8));
 const path=report.features.find(f=>f.feature==='constraint.path');
 assert.equal(path?.status,'unverified');
 assert.match(path?.reason??'',/A20-PATH-06/);
 assert.equal(report.fullyEvaluable,false);
});

test('capability audit retains supported status for ordinary tangent fixed positive spacing',()=>{
 const report=inspectEvaluability(pathScene(false,8));
 const path=report.features.find(f=>f.feature==='constraint.path');
 assert.equal(path?.status,'supported');
});
