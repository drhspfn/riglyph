import schema from './schema.json' with {type:'json'};
import {EngineError} from '../errors.js';
import type {IRDocument,Attachment,MeshAttachment,Timeline,Vertex} from './types.js';

interface Schema { $ref?:string;oneOf?:Schema[];type?:string;const?:unknown;enum?:unknown[];pattern?:string;properties?:Record<string,Schema>;required?:string[];additionalProperties?:boolean|Schema;items?:Schema;minLength?:number;minItems?:number;maxItems?:number;minimum?:number;maximum?:number;exclusiveMinimum?:number;uniqueItems?:boolean }
const rootSchema = schema as Schema & {$defs:Record<string,Schema>};
export type ValidationIssue = {path:string;reason:string};

/** Standalone strict evaluator for the supported draft-2020-12 schema keywords. Unknown keywords are rejected. */
export function validateStructure(input:unknown):ValidationIssue[]{
 const issues:ValidationIssue[]=[];
 function walk(value:unknown, rule:Schema,path:string,depth:number):boolean{
  if(issues.length>=100)return false;
  if(depth>90){issues.push({path,reason:'Nesting exceeds limit'});return false;}
  if(rule.$ref){const name=rule.$ref.split('/').at(-1)!;const ref=rootSchema.$defs[name];if(!ref){issues.push({path,reason:'Unresolved schema reference'});return false;}return walk(value,ref,path,depth+1);}
  if(rule.oneOf){let matches=0;for(const candidate of rule.oneOf){const checkpoint=issues.length;if(walk(value,candidate,path,depth+1))matches++;issues.length=checkpoint;}if(matches!==1){issues.push({path,reason:`Expected one matching schema, got ${matches}`});return false;}return true;}
  let valid=true;const problem=(reason:string)=>{issues.push({path,reason});valid=false;};
  if(rule.const!==undefined && value!==rule.const)problem('Constant mismatch');
  if(rule.enum && !rule.enum.includes(value))problem('Unexpected enum value');
  if(rule.type){
   const correct= rule.type==='null' ? value===null : rule.type==='array'?Array.isArray(value) :rule.type==='integer'?typeof value==='number'&&Number.isSafeInteger(value) :rule.type==='number'?typeof value==='number'&&Number.isFinite(value):rule.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value) :typeof value===rule.type;
   if(!correct){problem(`Expected ${rule.type}`);return false;}
  }
  if(typeof value==='number'){
   if(!Number.isFinite(value))problem('Non-finite number');
   if(rule.minimum!==undefined&&value<rule.minimum)problem('Below minimum');
   if(rule.maximum!==undefined&&value>rule.maximum)problem('Above maximum');
   if(rule.exclusiveMinimum!==undefined&&value<=rule.exclusiveMinimum)problem('Below exclusive minimum');
  }
  if(typeof value==='string'){
   if(rule.minLength!==undefined&&value.length<rule.minLength)problem('String too short');
   if(rule.pattern&&!new RegExp(rule.pattern).test(value))problem('Pattern mismatch');
  }
  if(Array.isArray(value)){
   if(rule.minItems!==undefined&&value.length<rule.minItems)problem('Array too short');
   if(rule.maxItems!==undefined&&value.length>rule.maxItems)problem('Array too long');
   if(value.length>1_000_000){problem('Array exceeds safety limit');return false;}
   if(rule.uniqueItems&&new Set(value.map(item=>JSON.stringify(item))).size!==value.length)problem('Array must contain unique items');
   if(rule.items)for(let i=0;i<value.length;i++)if(!walk(value[i],rule.items,`${path}/${i}`,depth+1))valid=false;
  }
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
   const record=value as Record<string,unknown>;
   if(Object.keys(record).length>100_000){problem('Too many object properties');return false;}
   for(const key of rule.required??[])if(!Object.hasOwn(record,key))problem(`Missing property ${key}`);
   for(const [key,field] of Object.entries(record)){
    if(rule.properties?.[key]){if(!walk(field,rule.properties[key],`${path}/${key}`,depth+1))valid=false;}
    else if(rule.additionalProperties===false){problem(`Unexpected property ${key}`);}
    else if(rule.additionalProperties&&typeof rule.additionalProperties==='object'&&!walk(field,rule.additionalProperties,`${path}/${key}`,depth+1))valid=false;
   }
  }
  return valid;
 }
 walk(input,rootSchema,'$',0);return issues;
}

function semanticIssues(doc:IRDocument):ValidationIssue[]{
 const issues:ValidationIssue[]=[];const fail=(path:string,reason:string)=>issues.push({path,reason});
 const set=(items:{id:string}[],prefix:string)=>{
  const seen=new Set<string>();for(const item of items){if(seen.has(item.id))fail(prefix,`Duplicate ID ${item.id}`);seen.add(item.id);}return seen;
 };
 const sk=doc.skeleton;
 if(doc.schemaVersion!=='1.0.0')fail('schemaVersion','Unsupported IR schema: only 1.0.0 is implemented');
 if(doc.conventions.color!=='straight-srgba')fail('conventions/color','Unsupported canonical color convention (only straight-srgba is implemented)');
 const supported=new Set(['region','mesh','linked_mesh','bounding_box','clipping','path','point','weighted_mesh','deform','bone_rotation','bone_translation','bone_scale','bone_shear','two_color_tint','sequence','no_rotation_or_reflection','path_constraint','ik_constraint','transform_constraint','events','draw_order','blend_modes']);
 for(const capability of doc.capabilities)if(!supported.has(capability))fail('capabilities',`Unimplemented capability ${capability}`);
 const bones=set(sk.bones,'bones'),slots=set(sk.slots,'slots'),attachments=set(sk.attachments,'attachments'),skins=set(sk.skins,'skins'),constraints=set(sk.constraints,'constraints'),events=set(sk.events,'events'),animations=set(sk.animations,'animations'),pages=set(doc.atlases.pages,'pages'),regions=set(doc.atlases.regions,'regions');
 const byAttachment=new Map(sk.attachments.map(a=>[a.id,a]));
 const checkVerts=(vertices:Vertex[],path:string)=>{for(let i=0;i<vertices.length;i++){
  const v=vertices[i]!;
  if((v.position===null)===(v.influences.length===0))fail(`${path}/${i}`,'Exactly one of local position or nonempty bone influences required');
  for(const inf of v.influences){if(!bones.has(inf.boneId))fail(`${path}/${i}`,'Unknown influence bone');if(inf.weight<0)fail(`${path}/${i}`,'Negative influence weight');}
 }};
 for(let i=0;i<sk.bones.length;i++){
  const bone=sk.bones[i]!;
  if(bone.parentId!==null){if(!bones.has(bone.parentId))fail(`bones/${i}`,'Unknown parent');if(sk.bones.findIndex(b=>b.id===bone.parentId)>=i)fail(`bones/${i}`,'Parent must precede child (prevents cycles)');}
  else if(i!==0)fail(`bones/${i}`,'Only first bone can be root');
 }
 if(sk.bones[0]?.parentId!==null)fail('bones/0','Root must have null parent');
 const indices=new Set<number>();
 for(const s of sk.slots){if(!bones.has(s.boneId))fail(`slots/${s.id}`,'Unknown owner bone');if(indices.has(s.drawIndex)||s.drawIndex>=sk.slots.length)fail(`slots/${s.id}`,'Invalid draw order permutation');indices.add(s.drawIndex);
  if(s.setupAttachmentId!==null&&!attachments.has(s.setupAttachmentId))fail(`slots/${s.id}`,'Unknown setup attachment');}
 for(const skin of sk.skins){const pairs=new Set<string>();for(const row of skin.attachments){if(!slots.has(row.slotId)||!attachments.has(row.attachmentId))fail(`skins/${skin.id}`,'Invalid slot or attachment mapping');const pair=JSON.stringify([row.slotId,row.key]);if(pairs.has(pair))fail(`skins/${skin.id}`,'Duplicate slot/key');pairs.add(pair);}for(const id of skin.activeBoneIds)if(!bones.has(id))fail(`skins/${skin.id}`,'Unknown active bone');for(const id of skin.activeConstraintIds)if(!constraints.has(id))fail(`skins/${skin.id}`,'Unknown active constraint');}
 if(sk.skins.filter(s=>s.isDefault).length>1)fail('skins','Multiple default skins');
 for(const page of doc.atlases.pages){if(page.path.startsWith('/')||page.path.includes('..')||page.path.includes('\\')||/^[A-Za-z]:/.test(page.path))fail(`pages/${page.id}`,'Unsafe texture page path');}
 for(const r of doc.atlases.regions){if(!pages.has(r.pageId))fail(`regions/${r.id}`,'Missing page');const p=doc.atlases.pages.find(p=>p.id===r.pageId);if(p){const [x,y,w,h]=r.bounds;const tw=r.rotationDeg%180===0?w:h,th=r.rotationDeg%180===0?h:w;if(x<0||y<0||w<=0||h<=0||x+tw>p.width+.01||y+th>p.height+.01)fail(`regions/${r.id}`,'Out of bounds packed region');}}
 const linked=new Map<string,string>();
 for(const a of sk.attachments){
  if(a.kind==='region'||a.kind==='mesh'||a.kind==='linked_mesh')if(!regions.has(a.regionId))fail(`attachments/${a.id}`,'Unknown atlas region');
  if(a.kind==='mesh'){checkVerts(a.vertices,`attachments/${a.id}/vertices`);if(a.uvs.length!==2*a.vertices.length)fail(`attachments/${a.id}`,'UV count mismatch');if(a.triangles.length%3!==0)fail(`attachments/${a.id}`,'Triangle index count not multiple of 3');for(const idx of a.triangles)if(idx>=a.vertices.length)fail(`attachments/${a.id}`,'Triangle outside mesh');if(a.hullVertexCount>a.vertices.length)fail(`attachments/${a.id}`,'Hull exceeds vertex count');}
  if(a.kind==='linked_mesh'){linked.set(a.id,a.parentMeshId);if(!attachments.has(a.parentMeshId))fail(`attachments/${a.id}`,'Missing linked parent');if(!attachments.has(a.deformTimelineOwnerId))fail(`attachments/${a.id}`,'Missing deform timeline owner');}
  if(a.kind==='bounding_box'||a.kind==='clipping'||a.kind==='path'){checkVerts(a.vertices,`attachments/${a.id}/vertices`);if(a.kind==='clipping'&&!slots.has(a.endSlotId))fail(`attachments/${a.id}`,'Unknown clipping end slot');}
  if(a.kind==='region'&&(a.width<0||a.height<0))fail(`attachments/${a.id}`,'Negative region size');
  if('sequence' in a&&a.sequence){
   if(a.sequence.setupIndex<0||a.sequence.setupIndex>=a.sequence.count)fail(`attachments/${a.id}`,'Invalid setup sequence index');
   // Only explicit frame-index timelines are currently supported. Automatic
   // source sequence modes need a separate observed timing contract.
   if(a.sequence.mode!==undefined)fail(`attachments/${a.id}`,'Unsupported automatic sequence mode');
  }
 }
 for(const [id,parent] of linked){let cur=parent;const seen=new Set([id]);while(linked.has(cur)){if(seen.has(cur)){fail(`attachments/${id}`,'Linked mesh cycle');break;}seen.add(cur);cur=linked.get(cur)!;}if(byAttachment.get(cur)?.kind!=='mesh')fail(`attachments/${id}`,'Linked parent does not resolve to mesh');}
 const numericParams=new Set(['mix','mixX','mixY','mixRotate','mixScaleX','mixScaleY','mixShearY','offsetRotation','offsetX','offsetY','offsetScaleX','offsetScaleY','offsetShearY','position','spacing','softness','bendDirection']);
 const booleanParams=new Set(['local','relative','compress','stretch','uniform']);
 const stringParams=new Set(['positionMode','spacingMode','rotateMode']);
 for(const c of sk.constraints){
  for(const [key,value] of Object.entries(c.parameters)){
   const expected=numericParams.has(key)?'number':booleanParams.has(key)?'boolean':stringParams.has(key)?'string':null;
   if(!expected)fail(`constraints/${c.id}`,`Unsupported constraint parameter ${key}`);
   else if(typeof value!==expected)fail(`constraints/${c.id}`,`Invalid type for constraint parameter ${key}`);
  }
  if(c.boneIds.length===0)fail(`constraints/${c.id}`,'Empty constraint bone list');
  if(c.kind==='ik'&&c.boneIds.length>2)fail(`constraints/${c.id}`,'Unsupported IK chain longer than two bones');
  for(const id of c.boneIds)if(!bones.has(id))fail(`constraints/${c.id}`,'Unknown constrained bone');if(c.kind==='path'){if(!c.targetSlotId||!slots.has(c.targetSlotId))fail(`constraints/${c.id}`,'Missing target slot');}else if(!c.targetBoneId||!bones.has(c.targetBoneId))fail(`constraints/${c.id}`,'Missing target bone');}
 const finiteNumbers=(v:unknown,size:number)=>Array.isArray(v)&&v.length===size&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
 const isFiniteNumber=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
 function validateTimeline(t:Timeline,at:string,duration:number){
  const supportedProps:Record<Timeline['targetKind'],readonly string[]>={
   bone:['x','y','rotationDeg','scaleX','scaleY','shearXDeg','shearYDeg','translate','scale','shear'],
   slot:['attachment','light','lightRGB','twoColor','twoColorRGB','alpha','dark','sequenceIndex','sequencePlayback'],attachment:['deform'],constraint:[],skeleton:['drawOrder'],event:['fire']
  };
  if(t.targetKind!=='constraint'&&!supportedProps[t.targetKind].includes(t.property))fail(at,`Unsupported timeline property ${t.targetKind}.${t.property}`);
  if(t.targetKind==='constraint'&&!numericParams.has(t.property)&&!booleanParams.has(t.property)&&!stringParams.has(t.property))fail(at,`Unsupported constraint timeline property ${t.property}`);
  const targetSets={bone:bones,slot:slots,attachment:attachments,constraint:constraints,skeleton:null,event:events};const target=targetSets[t.targetKind];
  if(target&&(!t.targetId||!target.has(t.targetId)))fail(at,'Unknown timeline target');
  if(t.targetKind==='skeleton'&&t.targetId!==null)fail(at,'Skeleton targetId must be null');
  for(let k=0;k<t.keys.length;k++){
   const frame=t.keys[k]!;if(frame.timeSec>duration+1e-5)fail(at,'Key occurs beyond duration');if(k&&frame.timeSec<t.keys[k-1]!.timeSec)fail(at,'Decreasing key times');
   const curve=frame.interpolation;
   if(curve.kind==='cubic_bezier'){
    const channels=t.property==='deform'?1:Array.isArray(frame.value)?frame.value.length:1;
    if(!curve.bezierByChannel||curve.bezierByChannel.length!==channels)fail(at,`Expected ${channels} Bezier channel(s)`);
    else for(const controls of curve.bezierByChannel){const [x1,y1,x2,y2]=controls;
     if(![x1,y1,x2,y2].every(Number.isFinite))fail(at,'Non-finite Bezier controls');
     // Q19: valid source-authored X handles need not be inside [0, 1].
     // Neither monotonicity nor a global inverse is a required property.
     // All four controls must remain finite, and the next key strictly later.
    }
    if(k===t.keys.length-1)fail(at,'Outgoing Bezier on final key');
    else if(t.keys[k+1]!.timeSec<=frame.timeSec)fail(at,'Bezier segment must have positive time span');
   }else if(curve.sampling||curve.bezierByChannel)fail(at,'Non-Bezier key cannot declare Bezier controls or sampling');
   const v=frame.value;
   if(t.targetKind==='bone'){
    if(['translate','scale','shear'].includes(t.property)?!finiteNumbers(v,2):!isFiniteNumber(v))fail(`${at}/keys/${k}`,'Invalid numeric bone timeline value');
   }else if(t.targetKind==='slot'){
    if(t.property==='light'&&!finiteNumbers(v,4)||t.property==='dark'&&!finiteNumbers(v,3)||t.property==='lightRGB'&&!finiteNumbers(v,3)||t.property==='twoColor'&&!finiteNumbers(v,7)||t.property==='twoColorRGB'&&!finiteNumbers(v,6)||t.property==='alpha'&&!isFiniteNumber(v))fail(`${at}/keys/${k}`,'Invalid tint timeline value');
    if(t.property==='attachment'&&v!==null&&typeof v!=='string')fail(`${at}/keys/${k}`,'Invalid attachment timeline value');
    if(t.property==='sequencePlayback'&&(!v||typeof v!=='object'||!('mode' in v)||!('index' in v)||!('delay' in v)||typeof (v as Record<string,unknown>)['mode']!=='string'||!Number.isSafeInteger((v as Record<string,unknown>)['index'])||!isFiniteNumber((v as Record<string,unknown>)['delay'])||!((v as Record<string,unknown>)['delay'] as number>0)))fail(`${at}/keys/${k}`,'Invalid sequence playback value');
    if(t.property==='sequenceIndex'&&(!Number.isSafeInteger(v)||Number(v)<0))fail(`${at}/keys/${k}`,'Invalid sequence index timeline value');
   }else if(t.targetKind==='skeleton'&&t.property==='drawOrder'){
    if(v!==null&&(!Array.isArray(v)||v.length!==sk.slots.length||new Set(v).size!==sk.slots.length||!v.every(id=>typeof id==='string'&&slots.has(id))))fail(`${at}/keys/${k}`,'Invalid draw-order timeline value');
   }else if(t.targetKind==='constraint'){
    const expected=numericParams.has(t.property)?'number':booleanParams.has(t.property)?'boolean':'string';
    if(typeof v!==expected||(expected==='number'&&!Number.isFinite(v)))fail(`${at}/keys/${k}`,'Invalid constraint timeline value');
   }
  }
  if(t.property==='deform'){
   if(t.targetKind!=='attachment'||!t.targetId)fail(at,'Deform requires attachment target');
   else {const a=byAttachment.get(t.targetId);const mesh=a?.kind==='linked_mesh'?byAttachment.get(a.parentMeshId):a;
    if(!mesh||!('vertices' in mesh))fail(at,'Deform owner must be a vertex attachment');
    else {const n=mesh.vertices.reduce((sum,v)=>sum+(v.position?2:2*v.influences.length),0);const basis=mesh.vertices.some(v=>v.position===null)?'influence_delta':'vertex_delta';if(t.deformBasis!==basis)fail(at,'Deform basis mismatch');for(const key of t.keys){
     const v=key.value;
     if(Array.isArray(v)){if(!finiteNumbers(v,n))fail(at,`Deform length must be ${n} and all values finite`);}
     else if(v&&typeof v==='object'){
      const sparse=v as Record<string,unknown>;
      if(!Number.isSafeInteger(sparse['offset'])||Number(sparse['offset'])<0||!Array.isArray(sparse['values'])||!(sparse['values'] as unknown[]).every(isFiniteNumber)||Number(sparse['offset'])+(sparse['values'] as unknown[]).length>n||Object.keys(sparse).some(k=>k!=='offset'&&k!=='values'))fail(at,'Invalid sparse deform value');
     }else fail(at,'Invalid deform value');
    }}
   }
  } else if(t.deformBasis!=='none')fail(at,'Unexpected deform basis');
 }
 for(const anim of sk.animations){for(let i=0;i<anim.timelines.length;i++)validateTimeline(anim.timelines[i]!,`animations/${anim.id}/timelines/${i}`,anim.durationSec);}
 const required=new Set<string>();for(const a of sk.attachments){required.add(a.kind);if(a.kind==='mesh'&&a.vertices.some(v=>v.position===null))required.add('weighted_mesh');}for(const a of sk.attachments)if(a.kind==='clipping')required.add('clipping');
 for(const capability of required)if(!doc.capabilities.includes(capability))fail('capabilities',`Missing required feature ${capability}`);
 return issues;
}
export function inspectIR(input:unknown):ValidationIssue[]{const structural=validateStructure(input);return structural.length?structural:semanticIssues(input as IRDocument);}
export function validateIR(input:unknown):asserts input is IRDocument{
 const schema=(input as {schemaVersion?:unknown}|null)?.schemaVersion;if(typeof schema==='string'&&schema!=='1.0.0')throw new EngineError('UNSUPPORTED_IR_SCHEMA',`Unsupported IR schema: ${schema}`);
 const issues=inspectIR(input);if(issues.length)throw new EngineError(issues.some(i=>i.reason.startsWith('Unsupported')||i.reason.startsWith('Unimplemented'))?'UNSUPPORTED_SEMANTIC_FEATURE':'INVALID_IR',`${issues.length} IR validation problem(s): ${issues.slice(0,4).map(i=>`${i.path}: ${i.reason}`).join('; ')}`,{path:issues[0]!.path});
}
export function serializeIR(input:unknown):string{validateIR(input);return JSON.stringify(input,null,2)+'\n';}
export function deserializeIR(json:string):IRDocument{
 if(json.length>64*1024*1024)throw new EngineError('LIMIT_EXCEEDED','IR JSON is too large');
 let input:unknown;
 try{input=JSON.parse(json);}catch{throw new EngineError('INVALID_IR','Malformed IR JSON');}
 validateIR(input);return input;
}
