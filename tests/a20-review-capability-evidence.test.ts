/** Review follow-up: executability is not source-format or viewer parity. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addBone} from './helpers.js';
import {inspectEvaluability} from '@riglyph/runtime';

test('fullyEvaluable universal IR does not imply verified source compatibility',()=>{
 const ir=fixture(); // self-authored IR, not a Spine binary probe
 const report=inspectEvaluability(ir);
 assert.equal(report.fullyEvaluable,true);
 assert.equal(report.source.family,'self-authored-ir');
 assert.equal(report.sourceParity,'UNVERIFIED_NO_REFERENCE');
 assert.equal(report.fullSourceParityVerified,false);
 assert.equal(report.referenceScope,'BOUNDED_SYNTHETIC_CASES');
 assert.equal(report.features.some(x=>x.referenceStatus==='NUMERIC_REFERENCE_PARTIAL'),false);
});

test('unsupported active IK topology stays excluded from numeric verification',()=>{
 const ir=fixture();
 addBone(ir,'one');
 addBone(ir,'two','one');
 addBone(ir,'three','two');
 addBone(ir,'target');
 ir.skeleton.constraints.push({id:'invalid-ik',kind:'ik',order:0,
  boneIds:['one','two','three'],targetBoneId:'target',targetSlotId:null,
  activeInDefaultSkin:true,
  parameters:{mix:1,bendDirection:1,softness:0,stretch:false,compress:false,uniform:false}});
 const report=inspectEvaluability(ir);
 const ik=report.features.find(x=>x.constraintId==='invalid-ik');
 assert.equal(ik?.status,'unsupported');
 assert.equal(ik?.referenceStatus,'UNVERIFIED_NO_REFERENCE');
 assert.equal(ik?.evidence,'RUNTIME_GUARD');
 assert.equal(report.fullyEvaluable,false);
 assert.equal(report.fullSourceParityVerified,false);
 assert.ok(report.unsupported.includes(ik!));
 assert.equal(report.sourceParity,'UNVERIFIED_NO_REFERENCE');
});

test('inactive unsupported topology is not evaluated or claimed as independently verified',()=>{
 const ir=fixture();
 addBone(ir,'one');
 addBone(ir,'two','one');
 addBone(ir,'three','two');
 addBone(ir,'target');
 ir.skeleton.constraints.push({id:'inactive',kind:'ik',order:0,
  boneIds:['one','two','three'],targetBoneId:'target',targetSlotId:null,
  activeInDefaultSkin:false,parameters:{mix:1,bendDirection:1}});
 const report=inspectEvaluability(ir);
 const item=report.features.find(x=>x.constraintId==='inactive');
 assert.equal(item?.active,false);
 assert.equal(item?.referenceStatus,'UNVERIFIED_NO_REFERENCE');
 assert.equal(report.fullyEvaluable,true);
 assert.equal(report.fullSourceParityVerified,false);
});
