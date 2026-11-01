/** Candidate-side evaluation capability audit. This is *not* evidence of reference parity.
 * A constraint can be inactive in a particular skin or when a mix is zero; callers must
 * repeat this audit after changing skin/clip. A conservative animation scan catches any
 * authored key that can activate a currently unsupported branch.
 */
import type {IRDocument,Constraint,Animation,Attachment} from '@riglyph/core';
import {EngineError} from '@riglyph/core';

export type CapabilityStatus='supported'|'unsupported'|'unverified';
export type FeatureCapability={feature:string;status:CapabilityStatus;referenceStatus:'UNVERIFIED_NO_REFERENCE';evidence:'SELF_AUTHORED_TESTS'|'RUNTIME_GUARD'|'NOT_REFERENCE_TESTED';active:boolean;reason:string;constraintId?:string};
export type EvaluabilityReport={format:'riglyph-capability-report-v1';source:{family:string;version:string;adapter:string};skinId:string|null;clipIds:string[];fullyEvaluable:boolean;sourceParity:'UNVERIFIED_NO_REFERENCE';features:FeatureCapability[];unsupported:FeatureCapability[]};
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
  features.push({feature,status,active,reason,referenceStatus:'UNVERIFIED_NO_REFERENCE',evidence:status==='unsupported'?'RUNTIME_GUARD':status==='unverified'?'NOT_REFERENCE_TESTED':'SELF_AUTHORED_TESTS',...(constraintId?{constraintId}:{})});
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
   const advanced=mayMix&&(flags(c,clips,['softness','compress','stretch'])||c.boneIds.length===2);
   add('constraint.ik',invalid?'unsupported':advanced?'unverified':'supported',true,
    invalid?'IK longer than two bones is outside the supported profile':
    advanced?'Independent IK solver covers this configuration; numerical source parity is not yet established':
    'Parent-space single-bone local solver and synthetic numeric cases',c.id);
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
   const rotateMode=(p['rotateMode']??'tangent');const spacing=(p['spacingMode']??'fixed');
   const advanced=(rotateMode!=='tangent'&&enabled(p['mixRotate']))||spacing==='length'||spacing==='proportional';
   // The A20 independent reference matrix includes a known, unresolved numerical
   // mismatch for negative fixed spacing along a reflected closed path. Do not
   // advertise a full 'supported' evaluation for that profile. Animated
   // sign changes are conservatively included even if setup is positive.
   const mirroredSetup=ir.skeleton.bones.some(b=>b.setup.scaleX*b.setup.scaleY<0);
   const animatedReflection=clips.some(clip=>clip.timelines.some(t=>t.targetKind==='bone'&&
    (t.property==='scale'||t.property==='scaleX'||t.property==='scaleY')&&
    t.keys.some(k=>typeof k.value==='number'?k.value<0:
     Array.isArray(k.value)&&k.value.some(v=>typeof v==='number'&&v<0))));
   const negativeSpacing=typeof p['spacing']==='number'&&p['spacing']<0||
    valueAtAnyKey(c,clips,'spacing',v=>typeof v==='number'&&v<0);
   const reflectedNegative=rotateMode==='tangent'&&spacing==='fixed'&&negativeSpacing&&(mirroredSetup||animatedReflection);
   const missing=chosen!==undefined&&chosen.kind!=='path';
   const uncertain=switches||chosen===undefined;
   add('constraint.path',weighted||nonConstant||advanced||uncertain||reflectedNegative?'unverified':'supported',true,
    reflectedNegative?'Independent A20-PATH-06 reference mismatch: reflected hierarchy with negative fixed spacing is not numerically verified':
    weighted?'Weighted path world vertices are evaluated; numerical parity not established':
    nonConstant?'Authored curve lengths are evaluated; numerical parity not established':
    advanced?'Chain orientation/spacing are implemented but source numerical parity is not established':
    uncertain?'Active attachment can change with animation or skin; audit is conservative':
    missing?'Non-path attachment produces a defined no-op':
    'World-space cubic sampler with independent XY/rotation mixing, local synthetic tests',c.id);
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
 return {format:'riglyph-capability-report-v1',source:{family:ir.source.family,version:ir.source.version,adapter:ir.source.adapter},skinId,clipIds:[...clipIds],fullyEvaluable:features.every(f=>!f.active||f.status==='supported'),sourceParity:'UNVERIFIED_NO_REFERENCE',features,unsupported:features.filter(f=>f.active&&f.status!=='supported')};
}
