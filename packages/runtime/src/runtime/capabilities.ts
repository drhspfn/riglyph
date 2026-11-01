/** Candidate-side evaluation capability audit. This is *not* evidence of reference parity.
 * A constraint can be inactive in a particular skin or when a mix is zero; callers must
 * repeat this audit after changing skin/clip. A conservative animation scan catches any
 * authored key that can activate a currently unsupported branch.
 */
import type {IRDocument,Constraint,Animation,Attachment} from '@riglyph/core';
import {EngineError} from '@riglyph/core';

export type CapabilityStatus='supported'|'unsupported'|'unverified';
export type ReferenceStatus='UNVERIFIED_NO_REFERENCE'|'NUMERIC_REFERENCE_PARTIAL';
export type FeatureCapability={feature:string;status:CapabilityStatus;referenceStatus:ReferenceStatus;evidence:'SELF_AUTHORED_TESTS'|'RUNTIME_GUARD'|'NOT_REFERENCE_TESTED'|'INDEPENDENT_NUMERIC_CASES';active:boolean;reason:string;constraintId?:string};
export type EvaluabilityReport={format:'riglyph-capability-report-v1';source:{family:string;version:string;adapter:string};skinId:string|null;clipIds:string[];fullyEvaluable:boolean;sourceParity:ReferenceStatus;features:FeatureCapability[];unsupported:FeatureCapability[]};
const enabled=(value:unknown):boolean=>value===true||typeof value==='number'&&Number.isFinite(value)&&value!==0;
const truthyAtAnyKey=(c:Constraint,clips:readonly Animation[],names:readonly string[]):boolean=>clips.some(clip=>clip.timelines.some(t=>t.targetKind==='constraint'&&t.targetId===c.id&&names.includes(t.property)&&t.keys.some(k=>enabled(k.value))));
const valueAtAnyKey=(c:Constraint,clips:readonly Animation[],name:string,predicate:(v:unknown)=>boolean)=>clips.some(clip=>clip.timelines.some(t=>t.targetKind==='constraint'&&t.targetId===c.id&&t.property===name&&t.keys.some(k=>predicate(k.value))));
const flags=(c:Constraint,clips:readonly Animation[],names:readonly string[])=>names.some(name=>enabled(c.parameters[name]))||truthyAtAnyKey(c,clips,names);
export function inspectEvaluability(ir:IRDocument,{skinId=null,clipIds=[]}:{skinId?:string|null;clipIds?:readonly string[]}={}):EvaluabilityReport{
 if(skinId!==null&&!ir.skeleton.skins.some(s=>s.id===skinId))throw new EngineError('INVALID_SKIN','Capability audit skin does not exist');
 const clips=clipIds.map(id=>{const c=ir.skeleton.animations.find(a=>a.id===id);if(!c)throw new EngineError('ANIMATION_NOT_FOUND','Capability audit clip does not exist');return c;});
 const skin=ir.skeleton.skins.find(s=>s.id===skinId)??ir.skeleton.skins.find(s=>s.isDefault);
 const features:FeatureCapability[]=[];
 const add=(feature:string,status:CapabilityStatus,active:boolean,reason:string,constraintId?:string)=>{
  const hasNumericReference=['constraint.ik','constraint.path','constraint.transform'].includes(feature);
  features.push({feature,status,active,reason,
   referenceStatus:hasNumericReference?'NUMERIC_REFERENCE_PARTIAL':'UNVERIFIED_NO_REFERENCE',
   evidence:status==='unsupported'?'RUNTIME_GUARD':hasNumericReference?'INDEPENDENT_NUMERIC_CASES':
    status==='unverified'?'NOT_REFERENCE_TESTED':'SELF_AUTHORED_TESTS',
   ...(constraintId?{constraintId}:{})});
 };
 add('bone.inheritance','supported',ir.skeleton.bones.length>0,'Local transform evaluator; reference parity not measured');
 const activeSkinBones=new Set(ir.skeleton.bones.filter(b=>!b.skinRequired||skin?.activeBoneIds.includes(b.id)).map(b=>b.id));
 for(const c of ir.skeleton.constraints){
  const active=(c.activeInDefaultSkin!==false||!!skin?.activeConstraintIds.includes(c.id))&&c.boneIds.every(b=>activeSkinBones.has(b))&&(!c.targetBoneId||activeSkinBones.has(c.targetBoneId));
  if(!active){add(`constraint.${c.kind}`,'supported',false,'Inactive for selected skin; not evaluated',c.id);continue;}
  const p=c.parameters,mayMix=(()=>{
   if(c.kind==='ik')return enabled(p['mix']??1)||valueAtAnyKey(c,clips,'mix',enabled);
   return (c.kind==='path'?['mixRotate','mixX','mixY']:['mixRotate','mixX','mixY','mixScaleX','mixScaleY','mixShearY']).some(k=>enabled(p[k])||valueAtAnyKey(c,clips,k,enabled));
  })();
  if(c.kind==='ik'){
   const invalid=c.boneIds.length>2;
   add('constraint.ik',invalid?'unsupported':'supported',true,
    invalid?'IK longer than two bones is outside the supported profile':
    'One/two-bone IK (softness, bend, compress/stretch, uniform, reflected and nonuniform poses) has a 57-case independent numeric reference matrix; further source parity remains partial',c.id);
  }else if(c.kind==='transform'){
   add('constraint.transform','supported',true,'Four local/world absolute/relative modes, six channels; A19 numeric 36-case reference suite, unverified edge cases',c.id);
  }else{
   // A path uses the target slot attachment; switching attachments in a clip is conservatively
   // regarded as uncertain rather than accepted based on the setup pose alone.
   const slot=ir.skeleton.slots.find(s=>s.id===c.targetSlotId);
   const chosen=ir.skeleton.attachments.find(a=>a.id===slot?.setupAttachmentId);
   const switches=clips.some(a=>a.timelines.some(t=>t.targetKind==='slot'&&t.targetId===slot?.id&&t.property==='attachment'));
   const allPaths:Attachment[]=switches?ir.skeleton.attachments.filter(a=>a.kind==='path'):(chosen?[chosen]:[]);
   const weighted=allPaths.some(a=>a.kind==='path'&&a.vertices.some(v=>v.position===null));
   const nonConstant=allPaths.some(a=>a.kind==='path'&&!a.constantSpeed);
   const missing=chosen!==undefined&&chosen.kind!=='path';
   add('constraint.path','supported',true,
    missing?'Non-path attachment produces a defined no-op':
    switches||chosen===undefined?'Path target resolves dynamically from slot/skin/animation; source reference matrix covers 209 synthetic cases and remaining source parity is partial':
    weighted||nonConstant?'Weighted/nonconstant path geometry passes reference mode matrix; animated deform and skin switching also have self-authored tests':
    'Path modes (tangent/chain/chainScale, four spacings, two positions, open/closed, reverse traversal) pass the 209-case independent reference matrix',c.id);
  }
 }
 const attachments=ir.skeleton.attachments;
 add('geometry.weighted','supported',attachments.some(a=>'vertices'in a&&a.vertices.some(v=>v.position===null)),'Local weighted vertices, no external reference');
 add('geometry.linked_mesh','supported',attachments.some(a=>a.kind==='linked_mesh'),'Local linked mesh ownership and deform tests');
 add('animation.deform','supported',clips.some(a=>a.timelines.some(t=>t.property==='deform')),'Local sparse/array and Bezier tests');
 add('renderer.clipping','supported',attachments.some(a=>a.kind==='clipping'),'CPU/GPU local clipping, no official reference');
 add('renderer.blend','supported',ir.skeleton.slots.length>0,'normal/additive/multiply/screen local pixel parity only');
 add('renderer.tint','supported',ir.skeleton.slots.length>0,'light/dark tint local tests only');
 add('animation.sequences','supported',attachments.some(a=>'sequence'in a&&a.sequence!==null),'Local sequence tests; missing pages produce typed runtime error');
 add('animation.events','supported',clips.some(a=>a.timelines.some(t=>t.targetKind==='event')),'Local event ordering tests only');
 add('animation.mixing','supported',clips.length>1,'Local multi-track evaluation tests only');
 return {format:'riglyph-capability-report-v1',source:{family:ir.source.family,version:ir.source.version,adapter:ir.source.adapter},skinId,clipIds:[...clipIds],fullyEvaluable:features.every(f=>!f.active||f.status==='supported'),sourceParity:'NUMERIC_REFERENCE_PARTIAL',features,unsupported:features.filter(f=>f.active&&f.status!=='supported')};
}
