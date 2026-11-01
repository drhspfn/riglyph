import {EngineError,requireCondition} from '@riglyph/core';
import {apply,inheritTransform,invert,mixAngle,shortestAngleDelta} from '@riglyph/core';
import type {Affine} from '@riglyph/core';
import {copyTransform} from '@riglyph/core';
import type {IRDocument,Transform,Vec3,Vec4,Attachment,Timeline,Constraint,Animation,Vertex} from '@riglyph/core';
import {timelineValue} from './curves.js';
import {sequenceFrame} from './sequence.js';
import type {SequencePlayback} from './sequence.js';
import {evaluateTransformBone} from './transform-constraint.js';

export type SlotState={attachmentId:string|null;light:Vec4;dark:Vec3|null;sequenceIndex:number};
export type EvaluatedEvent={eventId:string;timeSec:number;value:unknown};
export type Layer={clipId:string;timeSec:number;loop?:boolean;alpha?:number;mode?:'replace'|'add'};
const clone=(value:unknown):any=>structuredClone(value);
export class SkeletonInstance {
 readonly bones=new Map<string,Transform>();readonly world=new Map<string,Affine>();readonly applied=new Map<string,Transform>();
 readonly slots=new Map<string,SlotState>();readonly activeBones=new Set<string>();readonly deforms=new Map<string,Float32Array>();
 readonly parameters=new Map<string,Record<string,number|boolean|string>>();
 readonly assets:Map<string,Attachment>;readonly clips:Map<string,Animation>;
 drawOrder:string[]=[];skinId:string|null=null;
 constructor(readonly ir:IRDocument){
  this.assets=new Map(ir.skeleton.attachments.map(a=>[a.id,a]));this.clips=new Map(ir.skeleton.animations.map(a=>[a.id,a]));
  this.reset();
 }
 private attachmentByKey(slotId:string,key:string):string|null{
  const active=this.ir.skeleton.skins.find(s=>s.id===this.skinId);
  const fallback=this.ir.skeleton.skins.find(s=>s.isDefault);
  return active?.attachments.find(a=>a.slotId===slotId&&a.key===key)?.attachmentId??fallback?.attachments.find(a=>a.slotId===slotId&&a.key===key)?.attachmentId??null;
 }
 setSkin(id:string|null):void{
  requireCondition(id===null||this.ir.skeleton.skins.some(s=>s.id===id),'INVALID_SKIN',`Skin not found: ${id}`);
  this.skinId=id;this.reset();
 }
 reset():void{
  this.bones.clear();this.world.clear();this.applied.clear();this.slots.clear();this.activeBones.clear();this.deforms.clear();this.parameters.clear();
  const activeSkin=this.ir.skeleton.skins.find(s=>s.id===this.skinId)??this.ir.skeleton.skins.find(s=>s.isDefault);
  for(const b of this.ir.skeleton.bones){this.bones.set(b.id,copyTransform(b.setup));this.applied.set(b.id,copyTransform(b.setup));
   if(!b.skinRequired||activeSkin?.activeBoneIds.includes(b.id))this.activeBones.add(b.id);}
  for(const s of this.ir.skeleton.slots){
   // A setup attachment from the default skin is identified by ID; when changing skin
   // resolve its authoring key against the selected skin before falling back.
   let attachmentId=s.setupAttachmentId;
   if(attachmentId&&this.skinId){const defaultSkin=this.ir.skeleton.skins.find(s=>s.isDefault);
    const key=defaultSkin?.attachments.find(a=>a.slotId===s.id&&a.attachmentId===attachmentId)?.key;
    if(key!==undefined)attachmentId=this.attachmentByKey(s.id,key);
   }
   const selected=attachmentId?this.assets.get(attachmentId):null;
   const sequenceIndex=selected&&'sequence' in selected&&selected.sequence?selected.sequence.setupIndex:0;
   this.slots.set(s.id,{attachmentId,light:[...s.light],dark:s.dark?[...s.dark]:null,sequenceIndex});
  }
  for(const c of this.ir.skeleton.constraints)this.parameters.set(c.id,{...c.parameters});
  this.drawOrder=this.ir.skeleton.slots.slice().sort((a,b)=>a.drawIndex-b.drawIndex).map(s=>s.id);
  this.updateWorld();
 }
 updateWorld():void{
  this.world.clear();
  for(const b of this.ir.skeleton.bones){
   const local=this.bones.get(b.id)!;
   const m=b.parentId?inheritTransform(this.world.get(b.parentId)!,local,b.inheritance):inheritTransform({a:1,b:0,c:0,d:1,x:0,y:0},local,'normal');
   this.world.set(b.id,m);this.applied.set(b.id,copyTransform(local));
  }
 }
 private changeNumeric(previous:number,proposed:number,alpha:number,mode:'replace'|'add',angle=false):number{
  if(mode==='add')return previous+proposed*alpha;
  return angle?mixAngle(previous,proposed,alpha):previous+(proposed-previous)*alpha;
 }
 private applyTimeline(t:Timeline,value:unknown,alpha:number,mode:'replace'|'add'):void{
  if(value===undefined)return;
  const kind=t.targetKind,property=t.property;
  if(kind==='bone'){
   const local=this.bones.get(t.targetId!)!;
   const scalar= (field:keyof Transform,val:unknown,angle=false)=>{
    requireCondition(typeof val==='number'&&Number.isFinite(val),'INVALID_TIMELINE',`Expected numeric bone ${field}`);
    const target=mode==='add'?(val-(this.ir.skeleton.bones.find(b=>b.id===t.targetId)!.setup[field])):val;
    local[field]=this.changeNumeric(local[field],target,alpha,mode,angle);
   };
   if(property==='translate'||property==='scale'||property==='shear'){
    requireCondition(Array.isArray(value)&&value.length===2,'INVALID_TIMELINE',`Expected 2-component ${property}`);
    const names: [keyof Transform,keyof Transform]=property==='translate'?['x','y']:property==='scale'?['scaleX','scaleY']:['shearXDeg','shearYDeg'];
    scalar(names[0],value[0]);scalar(names[1],value[1]);
   }else if(['x','y','rotationDeg','scaleX','scaleY','shearXDeg','shearYDeg'].includes(property))scalar(property as keyof Transform,value,property==='rotationDeg');
   else throw new EngineError('UNSUPPORTED_TIMELINE_TYPE',`Unsupported bone property ${property}`);
  }else if(kind==='slot'){
   const s=this.slots.get(t.targetId!)!;
   if(property==='attachment'){
    if(alpha<0.5)return;
    requireCondition(value===null||typeof value==='string','INVALID_TIMELINE','Attachment must be ID or null');
    if(value!==null&&!this.assets.has(value)){
     // A keyed attachment name can be looked up explicitly within the current/default skin.
     const resolved=this.attachmentByKey(t.targetId!,value);
     requireCondition(resolved,'INVALID_REFERENCE',`Unknown attachment ${value}`);s.attachmentId=resolved;
    }else s.attachmentId=value;
   }else if(property==='light'||property==='dark'){
    requireCondition(Array.isArray(value)&&value.length===(property==='light'?4:3)&&value.every(x=>typeof x==='number'),'INVALID_TIMELINE',`Invalid ${property} tint`);
    const from=property==='light'?s.light:(s.dark??[0,0,0]);const next=value.map((v,i)=>this.changeNumeric(from[i]!,v,alpha,mode));
    if(property==='light')s.light=next as Vec4;else s.dark=next as Vec3;
   }else if(property==='lightRGB'||property==='twoColor'||property==='twoColorRGB'||property==='alpha'){
    if(property==='alpha'){
     requireCondition(typeof value==='number'&&Number.isFinite(value),'INVALID_TIMELINE','Slot alpha must be scalar');
     s.light[3]=this.changeNumeric(s.light[3],value,alpha,mode);
    }else{
     requireCondition(Array.isArray(value)&&value.length===(property==='lightRGB'?3:property==='twoColor'?7:6)&&value.every(Number.isFinite),'INVALID_TIMELINE','Invalid multi-channel slot tint');
     for(let i=0;i<(property==='twoColor'?4:3);i++)s.light[i]=this.changeNumeric(s.light[i]!,value[i],alpha,mode);
     if(property==='twoColor'||property==='twoColorRGB'){
      const from=property==='twoColor'?4:3;s.dark??=[0,0,0];
      for(let i=0;i<3;i++)s.dark[i]=this.changeNumeric(s.dark[i]!,value[i+from],alpha,mode);
     }
    }
   }else if(property==='sequencePlayback'){
    // Sequence index is resolved from key time by evaluate() and is attachment-local.
    if(alpha<0.5)return;
    const playback=value as SequencePlayback&{computedIndex?:number};
    requireCondition(playback&&typeof playback.attachmentId==='string'&&Number.isInteger(playback.computedIndex),'INVALID_TIMELINE','Sequence playback has no evaluated frame');
    if(s.attachmentId===playback.attachmentId)s.sequenceIndex=playback.computedIndex!;
   }else if(property==='sequenceIndex'){
    if(alpha>=0.5){requireCondition(Number.isInteger(value),'INVALID_TIMELINE','Sequence index must be integer');s.sequenceIndex=value as number;}
   }else throw new EngineError('UNSUPPORTED_TIMELINE_TYPE',`Unsupported slot property ${property}`);
  }else if(kind==='skeleton'){
   if(property!=='drawOrder')throw new EngineError('UNSUPPORTED_TIMELINE_TYPE',`Unsupported skeleton property ${property}`);
   if(alpha<0.5)return;
   const setup=this.ir.skeleton.slots.slice().sort((a,b)=>a.drawIndex-b.drawIndex).map(s=>s.id);
   const draw=value===null?setup:value;
   requireCondition(Array.isArray(draw)&&draw.length===setup.length&&new Set(draw).size===setup.length&&draw.every(id=>setup.includes(id as string)),'INVALID_TIMELINE','Invalid draw-order permutation');this.drawOrder=[...draw] as string[];
  }else if(kind==='attachment'){
   if(property!=='deform')throw new EngineError('UNSUPPORTED_TIMELINE_TYPE',`Unsupported attachment property ${property}`);
   const owner=t.targetId!;const a=this.assets.get(owner);const mesh=a?.kind==='linked_mesh'?this.assets.get(a.parentMeshId):a;
   requireCondition(mesh?.kind==='mesh','INVALID_TIMELINE','Deform requires mesh');
   const expected=mesh.vertices.reduce((n,v)=>n+(v.position?2:v.influences.length*2),0);
   let array:Float32Array;
   if(Array.isArray(value)){requireCondition(value.length===expected&&value.every(v=>typeof v==='number'),'INVALID_TIMELINE','Incorrect deform length');array=new Float32Array(value);}
   else if(value&&typeof value==='object'&&'offset' in value&&'values' in value){
    const sparse=value as {offset:number;values:number[]};requireCondition(Number.isSafeInteger(sparse.offset)&&sparse.offset>=0&&Array.isArray(sparse.values)&&sparse.offset+sparse.values.length<=expected&&sparse.values.every(Number.isFinite),'INVALID_TIMELINE','Invalid sparse deform');array=new Float32Array(expected);array.set(sparse.values,sparse.offset);
   }else throw new EngineError('INVALID_TIMELINE','Invalid deform data');
   const prev=this.deforms.get(owner)??new Float32Array(expected);for(let i=0;i<expected;i++)prev[i]=this.changeNumeric(prev[i]!,array[i]!,alpha,mode);
   this.deforms.set(owner,prev);
  }else if(kind==='constraint'){
   const params=this.parameters.get(t.targetId!)!;const v=params[property];
   if(typeof value==='number')params[property]=this.changeNumeric(typeof v==='number'?v:0,value,alpha,mode);
   else if(alpha>=0.5&&(typeof value==='boolean'||typeof value==='string'))params[property]=value;
   else if(typeof value!=='boolean'&&typeof value!=='string')throw new EngineError('INVALID_TIMELINE','Invalid constraint parameter');
  }else if(kind==='event'){
   // Event emission happens only when playback advances; sampling is pure.
  }else throw new EngineError('UNSUPPORTED_TIMELINE_TYPE',`Unsupported timeline target ${kind}`);
 }
 /** Evaluate independently at an explicit timestamp; reset avoids accumulating drift on seek. */
 evaluate(layers:readonly Layer[]=[]):this{
  this.reset();
  for(const layer of layers){
   requireCondition(Number.isFinite(layer.timeSec)&&Number.isFinite(layer.alpha??1),'INVALID_TIMELINE','Layer time and alpha must be finite');
   const clip=this.clips.get(layer.clipId);if(!clip)throw new EngineError('ANIMATION_NOT_FOUND',`Unknown clip ID ${layer.clipId}`);
   const duration=clip.durationSec;const time=layer.loop&&duration>0?((layer.timeSec%duration)+duration)%duration:Math.max(0,Math.min(duration,layer.timeSec));
   const alpha=Math.max(0,Math.min(1,layer.alpha??1)),mode=layer.mode??'replace';
   for(const timeline of clip.timelines){
    let v:unknown;
    if(timeline.targetKind==='attachment'&&timeline.property==='deform'){
     const owner=this.assets.get(timeline.targetId!);
     const mesh=owner?.kind==='linked_mesh'?this.assets.get(owner.parentMeshId):owner;
     requireCondition(mesh?.kind==='mesh','INVALID_TIMELINE','Deform timeline requires a resolved mesh');
     const floatCount=mesh.vertices.reduce((n,vertex)=>n+(vertex.position?2:vertex.influences.length*2),0);
     v=timelineValue(timeline.keys,time,floatCount);
    }else v=timelineValue(timeline.keys,time);
    if(timeline.targetKind==='slot'&&timeline.property==='sequencePlayback'&&v!==undefined){
     const frames=timeline.keys.filter(k=>k.timeSec<=time),active=frames.at(-1);
     if(active){const playback=v as SequencePlayback;const asset=this.assets.get(playback.attachmentId);
      requireCondition(asset&&'sequence' in asset&&asset.sequence,'INVALID_TIMELINE','Sequence animation target is not a sequence attachment');
      v={...playback,computedIndex:sequenceFrame(asset.sequence.count,playback.mode,playback.index,time-active.timeSec,playback.delay)};
     }
    }
    this.applyTimeline(timeline,v,alpha,mode);
   }
  }
  this.updateWorld();this.evaluateConstraints();return this;
 }
 /** Rebuild descendants only; a previously constrained world matrix is never
  * discarded by a global reset. The parent must already have its final basis.
  */
 private updateDescendants(changed:ReadonlySet<string>):void{
  const dirty=new Set(changed);
  for(const bone of this.ir.skeleton.bones){
   if(!bone.parentId||!dirty.has(bone.parentId)||dirty.has(bone.id))continue;
   const parent=this.world.get(bone.parentId)!;
   const t=this.applied.get(bone.id)!;
   this.world.set(bone.id,inheritTransform(parent,t,bone.inheritance));
   dirty.add(bone.id);
  }
 }
 private refreshLocalConstraint(ids:readonly string[]):void{
  for(const id of ids){
   const b=this.ir.skeleton.bones.find(b=>b.id===id)!;
   const parent=b.parentId?this.world.get(b.parentId)!:{a:1,b:0,c:0,d:1,x:0,y:0};
   const local=this.bones.get(id)!;
   this.world.set(id,inheritTransform(parent,local,b.inheritance));
   this.applied.set(id,copyTransform(local));
   this.updateDescendants(new Set([id]));
  }
 }
 private evaluateConstraints():void{
  const sorted=[...this.ir.skeleton.constraints].sort((a,b)=>a.order-b.order);
  const skin=this.ir.skeleton.skins.find(s=>s.id===this.skinId)??this.ir.skeleton.skins.find(s=>s.isDefault);
  for(const c of sorted){
   if(c.activeInDefaultSkin===false&&!skin?.activeConstraintIds.includes(c.id))continue;
   if(c.boneIds.some(id=>!this.activeBones.has(id))||(c.targetBoneId&&!this.activeBones.has(c.targetBoneId)))continue;
   if(c.kind==='ik'){this.ik(c);this.refreshLocalConstraint(c.boneIds);}
   else if(c.kind==='transform')this.transformConstraint(c);
   else{this.pathConstraint(c);this.refreshLocalConstraint(c.boneIds);}
  }
 }
 private ik(c:Constraint):void{
  const params=this.parameters.get(c.id)!;const mix=typeof params['mix']==='number'?params['mix']:1;
  if(mix===0||!c.boneIds.length)return;
  // Never silently drop numerical properties that alter constrained pose.
  // Reference-compatible soft IK/stretch has not been specified or tested.
  requireCondition(Number(params['softness']??0)===0&&!params['compress']&&!params['stretch'],
   'UNSUPPORTED_SEMANTIC_FEATURE',`IK ${c.id}: softness/compress/stretch requires a reference-tested solver`);
  requireCondition(c.boneIds.length<=2,'UNSUPPORTED_SEMANTIC_FEATURE','IK solver supports one or two bones');
  const target=this.world.get(c.targetBoneId!)!;
  const first=c.boneIds[0]!;const b=this.bones.get(first)!,w=this.world.get(first)!;
  if(c.boneIds.length===1){
   const sourceAngle=Math.atan2(w.b,w.a)*180/Math.PI;
   const intended=Math.atan2(target.y-w.y,target.x-w.x)*180/Math.PI;
   b.rotationDeg+=shortestAngleDelta(sourceAngle,intended)*mix;return;
  }
  const childId=c.boneIds[1]!,child=this.bones.get(childId)!,w2=this.world.get(childId)!;
  const len1=Math.hypot(w2.x-w.x,w2.y-w.y),len2=Math.abs(child.length*child.scaleX);
  requireCondition(len1>1e-8&&len2>1e-8,'UNSUPPORTED_SEMANTIC_FEATURE','Two-bone IK needs nonzero segment lengths');
  // General 2-link inverse kinematics in world XY. Preserve authored bend sign.
  const dx=target.x-w.x,dy=target.y-w.y,dist=Math.hypot(dx,dy),d=Math.min(len1+len2,Math.max(Math.abs(len1-len2),dist));
  const bend=params['bendDirection']===-1?-1:1;
  const angle2=bend*Math.acos(Math.max(-1,Math.min(1,(d*d-len1*len1-len2*len2)/(2*len1*len2))));
  const angle1=Math.atan2(dy,dx)-Math.atan2(len2*Math.sin(angle2),len1+len2*Math.cos(angle2));
  const desiredFirst=angle1*180/Math.PI;
  const delta=shortestAngleDelta(Math.atan2(w2.y-w.y,w2.x-w.x)*180/Math.PI,desiredFirst);
  b.rotationDeg+=delta*mix;
  child.rotationDeg+=shortestAngleDelta(child.rotationDeg,angle2*180/Math.PI)*mix;
 }
 private transformConstraint(c:Constraint):void{
  const p=this.parameters.get(c.id)!;
  for(const id of c.boneIds){
   const bone=this.ir.skeleton.bones.find(b=>b.id===id)!;
   const parent=bone.parentId?this.world.get(bone.parentId)!:null;
   const targetWorld=this.world.get(c.targetBoneId!)!;
   const targetApplied=this.applied.get(c.targetBoneId!)!;
   const res=evaluateTransformBone(this.world.get(id)!,targetWorld,this.applied.get(id)!,targetApplied,parent,bone.inheritance,p);
   this.world.set(id,res.world);this.applied.set(id,res.applied);
   this.updateDescendants(new Set([id]));
  }
 }
 /** Self-authored cubic path sampler; source-compatibility with 4.1 distance modes is unverified. */
 private pathConstraint(c:Constraint):void{
  const target=this.slots.get(c.targetSlotId!);if(!target?.attachmentId)return;
  const attachment=this.assets.get(target.attachmentId);
  requireCondition(attachment?.kind==='path','UNSUPPORTED_SEMANTIC_FEATURE','Active path constraint requires path attachment');
  requireCondition(attachment.vertices.every(v=>v.position!==null),'UNSUPPORTED_SEMANTIC_FEATURE','Weighted constraint paths not supported');
  const points=attachment.vertices.map(v=>v.position!) as [number,number][];
  requireCondition(points.length>=4,'INVALID_ATTACHMENT','Path must have cubic control vertices');
  const p=this.parameters.get(c.id)!;
  requireCondition((p['rotateMode']??'tangent')==='tangent'||Number(p['mixRotate']??0)===0,
   'UNSUPPORTED_SEMANTIC_FEATURE',`Path constraint ${c.id}: rotateMode ${String(p['rotateMode'])} not implemented`);
  requireCondition((p['spacingMode']??'fixed')!=='length'&&(p['spacingMode']??'fixed')!=='proportional'||c.boneIds.length<2,
   'UNSUPPORTED_SEMANTIC_FEATURE',`Path constraint ${c.id}: spacingMode ${String(p['spacingMode'])} needs length-aware sampling`);
  requireCondition(attachment.constantSpeed,
   'UNSUPPORTED_SEMANTIC_FEATURE',`Path constraint ${c.id}: non-constant-speed parameterization not implemented`);
  const owner=this.ir.skeleton.slots.find(s=>s.id===c.targetSlotId)!;
  const world=this.world.get(owner.boneId)!;
  const segments:{start:[number,number];a:[number,number];b:[number,number];end:[number,number]}[]=[];
  for(let i=0;i+3<points.length;i+=3)segments.push({start:points[i]!,a:points[i+1]!,b:points[i+2]!,end:points[i+3]!});
  const sample=(s:typeof segments[number],t:number):[number,number]=>{const u=1-t;return [0,1].map(i=>u*u*u*s.start[i]!+3*u*u*t*s.a[i]!+3*u*t*t*s.b[i]!+t*t*t*s.end[i]!) as [number,number];};
  const poly:[number,number][]=[];for(const s of segments){for(let i=0;i<=40;i++)poly.push(sample(s,i/40));}
  const lens=[0];for(let i=1;i<poly.length;i++)lens.push(lens[i-1]!+Math.hypot(poly[i]![0]-poly[i-1]![0],poly[i]![1]-poly[i-1]![1]));
  const total=lens.at(-1)!;if(total<=1e-8)return;
  const offset=Number(p['position']??0),spacing=Number(p['spacing']??0);
  for(let i=0;i<c.boneIds.length;i++){
   const boneId=c.boneIds[i]!,bone=this.bones.get(boneId)!;
   const raw=(p['positionMode']==='percent'?offset*total:offset)+(p['spacingMode']==='percent'?spacing*total:spacing)*i;
   const dist=attachment.closed?((raw%total)+total)%total:Math.max(0,Math.min(total,raw));
   let j=1;while(j<lens.length-1&&lens[j]!<dist)j++;
   const f=(dist-lens[j-1]!)/Math.max(1e-8,lens[j]!-lens[j-1]!);
   const pt:[number,number]=[poly[j-1]![0]+(poly[j]![0]-poly[j-1]![0])*f,poly[j-1]![1]+(poly[j]![1]-poly[j-1]![1])*f];
   const pos=apply(world,...pt);const parentId=this.ir.skeleton.bones.find(b=>b.id===boneId)!.parentId;
   const desired=parentId?apply(invert(this.world.get(parentId)!),...pos):pos;
   const mx=Number(p['mixX']??1),my=Number(p['mixY']??1);
   bone.x+=(desired[0]-bone.x)*mx;bone.y+=(desired[1]-bone.y)*my;
   const tangent=Math.atan2(poly[j]![1]-poly[j-1]![1],poly[j]![0]-poly[j-1]![0])*180/Math.PI;
   const ownerAngle=Math.atan2(world.b,world.a)*180/Math.PI;
   const current=this.world.get(boneId)!;
   bone.rotationDeg+=shortestAngleDelta(Math.atan2(current.b,current.a)*180/Math.PI,tangent+ownerAngle+Number(p['offsetRotation']??0))*Number(p['mixRotate']??0);
  }
 }
 /** Non-mutating snapshot of local vertices, including influence-local deformation. */
 vertices(vertices:readonly Vertex[],ownerBoneId:string,deform?:Float32Array):Float32Array{
  const out=new Float32Array(vertices.length*2);let cursor=0;
  for(let i=0;i<vertices.length;i++){const v=vertices[i]!;let x=0,y=0;
   if(v.position){const world=this.world.get(ownerBoneId)!;[x,y]=apply(world,v.position[0]+(deform?.[cursor]??0),v.position[1]+(deform?.[cursor+1]??0));cursor+=2;}
   else for(const inf of v.influences){const world=this.world.get(inf.boneId)!;const [ix,iy]=apply(world,inf.x+(deform?.[cursor]??0),inf.y+(deform?.[cursor+1]??0));x+=ix*inf.weight;y+=iy*inf.weight;cursor+=2;}
   out[i*2]=x;out[i*2+1]=y;
  }
  return out;
 }
}
