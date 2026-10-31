/** Spine 4.1 wire -> version-neutral semantic IR. No binary offsets enter the runtime. */
import {EngineError,requireCondition} from '@riglyph/core';
import type {IRDocument,Attachment,AtlasPage,AtlasRegion,Animation,Blend,Bone,Constraint,EventDefinition,Interpolation,Keyframe,Sequence,Skin,Slot,Timeline,Vec3,Vec4,Vertex,MeshAttachment} from '@riglyph/core';
import type {Spine41Wire,WireAttachment,WireAnimation,WireFrame,WireSkin,WireTimeline} from './spine41-wire.js';

const inherits:Bone['inheritance'][]=['normal','only_translation','no_rotation_or_reflection','no_scale','no_scale_or_reflection'];
const blends:Blend[]=['normal','additive','multiply','screen'];
function color(packed:number):Vec4{return [(packed>>>24)/255,((packed>>>16)&255)/255,((packed>>>8)&255)/255,(packed&255)/255];}
function dark(packed:number|null):Vec3|null{return packed===null?null:[((packed>>>16)&255)/255,((packed>>>8)&255)/255,(packed&255)/255];}
const noCurve:Interpolation={kind:'linear'};
const issue=(message:string):never=>{throw new EngineError('UNSUPPORTED_SEMANTIC_FEATURE',message,{remediation:'Supply matching atlas, or ask independent verifier for a precise source-behavior oracle'});};
const assert=(condition:unknown,message:string)=>requireCondition(condition,'INVALID_REFERENCE',message);

/** Normalize absolute Bezier controls into canonical per-segment time/value fractions. */
function interpBetween(raw:Interpolation|undefined,from:number,to:number,a:number,b:number,channel:number):Interpolation{
 if(!raw||raw.kind!=='cubic_bezier')return raw??noCurve;
 const point=raw.bezierByChannel?.[channel];assert(point,`Missing Bezier channel ${channel}`);
 const span=to-from;requireCondition(span>0,'INVALID_TIMELINE','Bezier segment has zero time width');
 const dy=b-a;
 const [x1,y1,x2,y2]=point!;
 // A constant-valued channel does not depend on its Bezier Y controls.
 const v1=dy!==0?(y1-a)/dy:0,v2=dy!==0?(y2-a)/dy:1;
 // Keep the out-of-interval time handles. The source's scalar progression uses
 // ten parameter-ordered line segments, NOT analytic root selection.
 const controls:[number,number,number,number]=[(x1-from)/span,v1,(x2-from)/span,v2];
 requireCondition(controls.every(Number.isFinite),'INVALID_TIMELINE','Bezier normalization overflowed the numeric domain');
 return {kind:'cubic_bezier',sampling:'polyline10',bezierByChannel:[controls]};
}
function keyFrames(frames:WireFrame[],value:(v:unknown)=>unknown,channel=0):Keyframe[]{
 return frames.map((f,i)=>{
  const current=value(f.value),next=frames[i+1];let interpolation:Interpolation=f.toNext??noCurve;
  if(interpolation.kind==='cubic_bezier'&&next){
   if(typeof f.value==='number'&&typeof next.value==='number')interpolation=interpBetween(interpolation,f.time,next.time,f.value,next.value,channel);
   else if(Array.isArray(f.value)&&Array.isArray(next.value)){
    const a=f.value as number[],b=next.value as number[];
    interpolation={kind:'cubic_bezier',sampling:'polyline10',bezierByChannel:a.map((v,ch)=>interpBetween(interpolation,f.time,next.time,v,b[ch]!,ch).bezierByChannel![0]!)};
   }else issue('Cannot normalize Bezier controls of a nonnumeric semantic value');
  }
  return {timeSec:f.time,value:current,interpolation};
 });
}
function numericChannel(frames:WireFrame[],index:number):Keyframe[]{
 const mapped=frames.map(f=>({...f,value:Array.isArray(f.value)?f.value[index]:f.value,...(f.toNext?{toNext:f.toNext.kind==='cubic_bezier'?{kind:'cubic_bezier',bezierByChannel:[f.toNext.bezierByChannel![index]!]} as Interpolation:f.toNext}:{})}));
 return keyFrames(mapped,v=>v);
}
function cloneVertices(v:readonly Vertex[],bones:readonly Bone[]):Vertex[]{return v.map(vertex=>vertex.position?{position:[...vertex.position],influences:[]}:{position:null,influences:vertex.influences.map(inf=>({boneId:bones[Number(inf.boneId.slice('bone:'.length))]!.id,x:inf.x,y:inf.y,weight:inf.weight}))});}
function drawOrder(changes:{slot:number;offset:number}[],slots:Slot[]):string[]{
 const n=slots.length;if(!changes.length)return slots.map(s=>s.id);
 const ordered=new Array<string|null>(n).fill(null);const edited=new Set<number>();
 for(const {slot,offset} of changes){const target=slot+offset;
  requireCondition(target>=0&&target<n,'INVALID_TIMELINE',`Draw-order displacement ${offset} outside slots`);
  requireCondition(ordered[target]===null&&!edited.has(slot),'INVALID_TIMELINE','Draw-order collision');
  edited.add(slot);ordered[target]=slots[slot]!.id;
 }
 const others=slots.filter((_,i)=>!edited.has(i)).map(s=>s.id);let pos=0;
 for(let i=0;i<n;i++)if(ordered[i]===null)ordered[i]=others[pos++]!;
 return ordered as string[];
}

export function normalizeSpine41(w:Spine41Wire,sha256:string,atlas:{pages:AtlasPage[];regions:AtlasRegion[]}):IRDocument {
 const bones:Bone[]=w.bones.map((b,i)=>({id:b.name,parentId:b.parentIndex===null?null:w.bones[b.parentIndex]!.name,
  setup:{x:b.x,y:b.y,rotationDeg:b.rotation,scaleX:b.scaleX,scaleY:b.scaleY,shearXDeg:b.shearX,shearYDeg:b.shearY,length:b.length},inheritance:inherits[b.inheritMode]!,skinRequired:b.skinRequired}));
 const attachments:Attachment[]=[];
 const skinLookup=new Map<string,string>();
 const keyOf=(skin:string,slot:number,key:string)=>JSON.stringify([skin,slot,key]);
 for(const sk of w.skins)for(const e of sk.entries){const id=`att:${attachments.length}`;skinLookup.set(keyOf(sk.name,e.slotIndex,e.key),id);attachments.push(undefined as unknown as Attachment);}
 const byAtlasName=new Map<string,AtlasRegion>();for(const region of atlas.regions){assert(!byAtlasName.has(region.name),`Ambiguous atlas region ${region.name}`);byAtlasName.set(region.name,region);}
 const atlasRegion=(name:string,sequence:Sequence|null|undefined):string=>{
  const needed=sequence?name+String(sequence.start+sequence.setupIndex).padStart(sequence.digits,'0'):name;
  const region=byAtlasName.get(needed);requireCondition(region,'MISSING_TEXTURE_PAGE',`Atlas missing region ${needed}`);
  if(sequence)for(let i=0;i<sequence.count;i++)requireCondition(byAtlasName.has(name+String(sequence.start+i).padStart(sequence.digits,'0')),'MISSING_TEXTURE_PAGE',`Atlas missing sequence frame ${i} of ${name}`);
  return region.id;
 };
 const fallbackColor:Vec4=[1,1,1,1];
 let write=0;
 for(const sk of w.skins)for(const e of sk.entries){
  const a=e.attachment,id=`att:${write++}`,base={id,name:a.name,color:a.color!==undefined?color(a.color):fallbackColor};
  switch(a.kind){
   case 'region':{
    const path=a.path??a.name;const sequence=a.sequence?{...a.sequence,basePath:path}:null;attachments[write-1]={...base,kind:'region',regionId:atlasRegion(path,a.sequence),width:a.width!,height:a.height!,sequence,
     local:{x:a.x!,y:a.y!,rotationDeg:a.rotation!,scaleX:a.scaleX!,scaleY:a.scaleY!,shearXDeg:0,shearYDeg:0,length:0}};break;
   }
   case 'mesh':{const path=a.path??a.name;attachments[write-1]={...base,kind:'mesh',regionId:atlasRegion(path,a.sequence),uvs:a.uvs!,triangles:a.triangles!,vertices:cloneVertices(a.vertices!,bones),hullVertexCount:a.hullVertexCount!,sequence:a.sequence?{...a.sequence,basePath:path}:null};break;}
   case 'linked_mesh':{
    const parentSkin=a.parentSkin??w.skins.find(x=>x.isDefault)?.name;
    assert(parentSkin,`Linked mesh ${a.name} missing default skin`);
    const parentId=skinLookup.get(keyOf(parentSkin!,e.slotIndex,a.parentKey!));assert(parentId,`Linked mesh ${a.name} missing parent ${a.parentKey}`);
    const parent=attachments[Number(parentId!.slice(4))];
    // An earlier declared parent can be used, or a later parent will be resolved in a second pass below.
    const ownPath=a.path??null;
    attachments[write-1]={...base,kind:'linked_mesh',parentMeshId:parentId!,regionId:ownPath?atlasRegion(ownPath,a.sequence):'__pending__',deformTimelineOwnerId:a.inheritDeform?parentId!:id,inheritDeform:a.inheritDeform!,sequence:a.sequence?{...a.sequence,...(ownPath?{basePath:ownPath}:{})}:null};
    void parent;break;
   }
   case 'bounding_box':attachments[write-1]={...base,kind:'bounding_box',vertices:cloneVertices(a.vertices!,bones)};break;
   case 'path':attachments[write-1]={...base,kind:'path',vertices:cloneVertices(a.vertices!,bones),closed:a.closed!,constantSpeed:a.constantSpeed!,lengths:a.lengths!};break;
   case 'point':attachments[write-1]={...base,kind:'point',x:a.x!,y:a.y!,rotationDeg:a.rotation!};break;
   case 'clipping':attachments[write-1]={...base,kind:'clipping',endSlotId:w.slots[a.endSlotIndex!]!.name,vertices:cloneVertices(a.vertices!,bones)};break;
  }
 }
 // Resolve linked geometries (including parents serialized after the child), while validating cycles.
 const byId=new Map(attachments.map(a=>[a.id,a]));
 const resolveLinked=(id:string,seen=new Set<string>()):Attachment=>{
  assert(!seen.has(id),`Linked mesh cycle at ${id}`);seen.add(id);
  const a=byId.get(id);assert(a,`Missing linked attachment ${id}`);
  if(a!.kind!=='linked_mesh')return a!;
  const parent=resolveLinked(a!.parentMeshId,seen);assert(parent.kind==='mesh',`Linked mesh parent does not resolve to mesh: ${id}`);
  if(a!.regionId==='__pending__')a!.regionId=(parent as MeshAttachment).regionId;
  // Deform owner can be an intermediate linked mesh that inherits from a base mesh.
  if(a!.inheritDeform)a!.deformTimelineOwnerId=parent.id;
  return parent;
 };
 for(const a of attachments)if(a.kind==='linked_mesh')resolveLinked(a.id);
 const skins:Skin[]=w.skins.map(s=>({id:s.name,isDefault:s.isDefault,
  attachments:s.entries.map(e=>({slotId:w.slots[e.slotIndex]!.name,key:e.key,attachmentId:skinLookup.get(keyOf(s.name,e.slotIndex,e.key))!})),
  activeBoneIds:s.boneIndices.map(i=>bones[i]!.id),activeConstraintIds:s.constraintNames}));
 const defaultSkin=w.skins.find(s=>s.isDefault);
 const slots:Slot[]=w.slots.map((s,i)=>{
  const setup=s.attachmentKey===null?null:defaultSkin?.entries.find(e=>e.slotIndex===i&&e.key===s.attachmentKey);
  if(s.attachmentKey!==null&&!setup)issue(`Setup slot ${s.name} refers to attachment key ${s.attachmentKey} absent from default skin`);
  return {id:s.name,boneId:bones[s.boneIndex]!.id,drawIndex:i,light:color(s.light),dark:dark(s.dark),setupAttachmentId:setup?skinLookup.get(keyOf(defaultSkin!.name,i,setup.key))!:null,blend:blends[s.blend]!};
 });
 const constraints:Constraint[]=w.constraints.map(c=>({id:c.name,kind:c.kind,order:c.order,activeInDefaultSkin:!w.constraints.some(x=>x.name===c.name&&x.skinRequired),boneIds:c.bones.map(i=>bones[i]!.id),targetBoneId:c.kind==='path'?null:bones[c.target]!.id,targetSlotId:c.kind==='path'?slots[c.target]!.id:null,parameters:{...c.parameters}}));
 const events:EventDefinition[]=w.events.map(e=>({id:e.name,name:e.name,int:e.int,float:e.float,string:e.string,audio:e.audio,...(e.volume===undefined?{}:{volume:e.volume}),...(e.balance===undefined?{}:{balance:e.balance})}));
 const animations:Animation[]=w.animations.map(wa=>normalizeAnimation(wa,w,skinLookup,bones,slots,attachments));
 const capabilities=new Set<string>();
 for(const a of attachments){capabilities.add(a.kind);if('vertices' in a&&a.vertices.some(v=>v.position===null))capabilities.add('weighted_mesh');if(a.kind==='mesh'||a.kind==='linked_mesh'){}if('sequence' in a&&a.sequence)capabilities.add('sequence');}
 for(const b of bones)if(b.inheritance==='no_rotation_or_reflection')capabilities.add('no_rotation_or_reflection');
 for(const s of slots){if(s.dark)capabilities.add('two_color_tint');if(s.blend!=='normal')capabilities.add('blend_modes');}
 for(const c of constraints)capabilities.add(c.kind+'_constraint');
 for(const a of animations)for(const t of a.timelines){if(t.property==='deform')capabilities.add('deform');if(t.property==='drawOrder')capabilities.add('draw_order');if(t.targetKind==='event')capabilities.add('events');if(t.targetKind==='bone'){if(t.property==='rotationDeg')capabilities.add('bone_rotation');if(['x','y','translate'].includes(t.property))capabilities.add('bone_translation');if(['scale','scaleX','scaleY'].includes(t.property))capabilities.add('bone_scale');if(['shear','shearXDeg','shearYDeg'].includes(t.property))capabilities.add('bone_shear');}}
 const metadata=w.nonessential?{fps:w.fps!,imagesPath:w.imagesPath??null,audioPath:w.audioPath??null,boneColors:Object.fromEntries(w.bones.filter(b=>b.authoringColor!==undefined).map(b=>[b.name,b.authoringColor!])),attachmentMetadata:Object.fromEntries(w.skins.flatMap(s=>s.entries).flatMap(e=>{
  const a=e.attachment,id=skinLookup.get(keyOf(w.skins.find(x=>x.entries.includes(e))!.name,e.slotIndex,e.key))!;
  const data={...(a.authoringColor===undefined?{}:{color:a.authoringColor}),...(a.edges===undefined?{}:{edges:a.edges}),...(a.width===undefined?{}:{width:a.width}),...(a.height===undefined?{}:{height:a.height})};
  return Object.keys(data).length?[[id,data]]:[];
 }))}:undefined;
 return {format:'universal-skeleton-ir',schemaVersion:'1.0.0',source:{family:'spine-binary',version:w.version,sha256,adapter:'spine-binary-4.1',adapterVersion:'0.8.0'},
  conventions:{axes:'x-right-y-up',time:'seconds',angles:'degrees',uvOrigin:'top-left',color:'straight-srgba',unitsPerPixel:1},capabilities:[...capabilities],atlases:{pages:atlas.pages,regions:atlas.regions},
  skeleton:{bounds:w.bounds,bones,slots,skins,attachments,constraints,events,animations},...(metadata?{authoringData:metadata}:{})};
}

function normalizeAnimation(wa:WireAnimation,w:Spine41Wire,skinLookup:Map<string,string>,bones:Bone[],slots:Slot[],attachments:Attachment[]):Animation{
 const timelines:Timeline[]=[];
 const put=(kind:Timeline['targetKind'],targetId:string|null,property:string,keys:Keyframe[],deformBasis:Timeline['deformBasis']='none')=>timelines.push({targetKind:kind,targetId,property,keys,deformBasis});
 const span=(frames:WireFrame[],idx:number,transform:(n:number)=>number=(x=>x))=>numericChannel(frames,idx).map(k=>({...k,value:transform(k.value as number)}));
 for(const t of wa.timelines){
  if(t.kind==='bone'){
   const b=bones[t.target as number]!,base=b.setup;
   const properties:Record<string, {names:(keyof typeof base)[];fn:(n:number,i:number)=>number}>={
    rotationDeg:{names:['rotationDeg'],fn:n=>base.rotationDeg+n},
    translate:{names:['x','y'],fn:(n,i)=>n+[base.x,base.y][i]!},
    x:{names:['x'],fn:n=>base.x+n},y:{names:['y'],fn:n=>base.y+n},
    scale:{names:['scaleX','scaleY'],fn:(n,i)=>n*[base.scaleX,base.scaleY][i]!},
    scaleX:{names:['scaleX'],fn:n=>base.scaleX*n},scaleY:{names:['scaleY'],fn:n=>base.scaleY*n},
    shear:{names:['shearXDeg','shearYDeg'],fn:(n,i)=>n+[base.shearXDeg,base.shearYDeg][i]!},
    shearXDeg:{names:['shearXDeg'],fn:n=>base.shearXDeg+n},shearYDeg:{names:['shearYDeg'],fn:n=>base.shearYDeg+n}
   };
   const entry=properties[t.property];assert(entry,`Unknown bone channel ${t.property}`);
   entry!.names.forEach((prop,i)=>put('bone',b.id,prop,span(t.frames,i,n=>entry!.fn(n,i))));
  }else if(t.kind==='slot'){
   const s=slots[t.target as number]!;
   if(t.property==='attachment')put('slot',s.id,'attachment',keyFrames(t.frames,v=>v));
   else if(['light','lightRGB','twoColor','twoColorRGB','alpha'].includes(t.property)){
    const count=t.property==='alpha'?1:t.property==='light'?4:t.property==='lightRGB'?3:t.property==='twoColor'?7:6;
    const keys=keyFrames(t.frames,v=>t.property==='alpha'?(v as number[])[0]:(v as number[]));
    // Slot tracks retain per-channel Bezier, not one shared curve.
    if(count===1&&keys.some(k=>k.interpolation.kind==='cubic_bezier')){
     const numeric=span(t.frames,0);put('slot',s.id,t.property,numeric);
    }else put('slot',s.id,t.property,keys);
   }
  }else if(t.kind==='constraint'){
   if(t.property==='ik'){
    for(let i=0;i<2;i++){
     const prop=i===0?'mix':'softness';
     const f=t.frames.map(v=>({...v,value:(v.value as Record<string,number>)[prop]!,...(v.toNext?{toNext:v.toNext.kind==='cubic_bezier'?{kind:'cubic_bezier',bezierByChannel:[v.toNext.bezierByChannel![i]!]} as Interpolation:v.toNext}:{})}));
     put('constraint',t.target as string,prop,keyFrames(f,x=>x));
    }
    for(const prop of ['bendDirection','compress','stretch'])put('constraint',t.target as string,prop,t.frames.map(f=>({timeSec:f.time,value:(f.value as Record<string,unknown>)[prop],interpolation:{kind:'stepped'}})));
   }else if(t.property==='transform'){
    ['mixRotate','mixX','mixY','mixScaleX','mixScaleY','mixShearY'].forEach((name,i)=>put('constraint',t.target as string,name,span(t.frames,i)));
   }else if(t.property==='mix'){
    ['mixRotate','mixX','mixY'].forEach((name,i)=>put('constraint',t.target as string,name,span(t.frames,i)));
   }else put('constraint',t.target as string,t.property,span(t.frames,0));
  }else if(t.kind==='attachment'){
   const id=skinLookup.get(JSON.stringify([w.skins[t.skinIndex!]!.name,t.slotIndex!,t.attachmentKey!]));assert(id,`Timeline attachment ${t.attachmentKey} missing`);
   const owner=attachments.find(a=>a.id===id)!;
   if(t.property==='deform'){
    const mesh=owner.kind==='linked_mesh'?attachments.find(a=>a.id===owner.parentMeshId):owner;
    assert(mesh?.kind==='mesh',`Deform ${id} does not refer to a mesh`);
    const basis=(mesh as MeshAttachment).vertices.some(v=>v.position===null)?'influence_delta':'vertex_delta';
    const expected=(mesh as MeshAttachment).vertices.reduce((sum,v)=>sum+(v.position!==null?2:v.influences.length*2),0);
    const expanded=t.frames.map((f,index)=>{
     const sparse=f.value as {offset:number;values:number[]};
     requireCondition(Number.isSafeInteger(sparse.offset)&&sparse.offset>=0&&sparse.offset+sparse.values.length<=expected,'INVALID_TIMELINE',`Deform sparse range exceeds ${expected} floats`);
     const values=new Array<number>(expected).fill(0);for(let i=0;i<sparse.values.length;i++)values[sparse.offset+i]!+=sparse.values[i]!;
     let interpolation:Interpolation=f.toNext??noCurve;
     const next=t.frames[index+1];
     if(interpolation.kind==='cubic_bezier'){
      requireCondition(next!==undefined,'INVALID_TIMELINE',`Final deform key has an outgoing Bezier: ${id}`);
      const controls=interpolation.bezierByChannel;
      requireCondition(controls?.length===1,'INVALID_TIMELINE',`Deform Bezier must have exactly one scalar curve: ${id}`);
      const dt=next!.time-f.time;
      requireCondition(dt>0,'INVALID_TIMELINE',`Deform Bezier cannot span coincident key times: ${id}`);
      const [cx1,cy1,cx2,cy2]=controls![0]!;
      // Source wire X controls are absolute times. Y controls already denote
      // the shared 0-to-1 interpolation progress, NOT vertex coordinate values.
      // Normalize the X axis for the canonical runtime, keeping Y overshoot.
      interpolation={kind:'cubic_bezier',sampling:'polyline10',
       bezierByChannel:[[(cx1-f.time)/dt,cy1,(cx2-f.time)/dt,cy2]]};
     }
     return {timeSec:f.time,value:values,interpolation};
    });
    put('attachment',id!,'deform',expanded,basis);
   }else if(t.property==='sequence'){
    if(!('sequence' in owner)||!owner.sequence)issue(`Sequence timeline without a sequence attachment: ${id}`);
    put('slot',slots[t.slotIndex!]!.id,'sequencePlayback',t.frames.map(f=>({timeSec:f.time,value:{...(f.value as object),attachmentId:id},interpolation:{kind:'stepped'}})));
   }
  }else if(t.kind==='skeleton'){
   put('skeleton',null,'drawOrder',t.frames.map(f=>({timeSec:f.time,value:drawOrder(f.value as {slot:number;offset:number}[],slots),interpolation:{kind:'stepped'}})));
  }else if(t.kind==='event'){
   // A binary EventTimeline can contain events from several definitions; split by event ID for the IR.
   const perEvent=new Map<string,Keyframe[]>();
   for(const f of t.frames){const val=f.value as {definitionIndex:number};const id=w.events[val.definitionIndex]!.name;
    if(!perEvent.has(id))perEvent.set(id,[]);perEvent.get(id)!.push({timeSec:f.time,value:f.value,interpolation:{kind:'stepped'}});}
   for(const [id,keys] of perEvent)put('event',id,'fire',keys);
  }
 }
 return {id:wa.name,name:wa.name,durationSec:wa.duration,timelines};
}
