import {EngineError,requireCondition} from '@riglyph/core';
import {apply,inheritTransform,invert,mixAngle,shortestAngleDelta} from '@riglyph/core';
import type {Affine} from '@riglyph/core';
import {copyTransform} from '@riglyph/core';
import type {IRDocument,Transform,Vec3,Vec4,Attachment,Timeline,Constraint,Animation,Vertex} from '@riglyph/core';
import {timelineValue} from './curves.js';
import {sequenceFrame} from './sequence.js';
import type {SequencePlayback} from './sequence.js';
import {evaluateTransformBone} from './transform-constraint.js';
import {CubicWorldPath} from './path-geometry.js';
import {solveOneLink,solveTwoLink} from './ik-solver.js';

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
   requireCondition(mesh&&'vertices' in mesh,'INVALID_TIMELINE','Deform requires a vertex attachment');
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
     requireCondition(mesh&&'vertices' in mesh,'INVALID_TIMELINE','Deform timeline requires a vertex attachment');
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
   else this.pathConstraint(c);
  }
 }
 private ik(c:Constraint):void{
  const p=this.parameters.get(c.id)!;
  const mix=Number(p['mix']??1);
  if(mix===0||!c.boneIds.length)return;
  requireCondition(c.boneIds.length<=2,'INVALID_TOPOLOGY','IK supports one or two constrained bones');
  const first=c.boneIds[0]!,spec=this.ir.skeleton.bones.find(b=>b.id===first)!;
  const parent=spec.parentId?this.world.get(spec.parentId)!:null;
  const target=this.world.get(c.targetBoneId!)!;
  const local=this.applied.get(first)!;
  if(c.boneIds.length===1){
   const next=solveOneLink({parentBasis:parent,world:this.world.get(first)!,local,
    inheritance:spec.inheritance,target:[target.x,target.y],mix,
    compress:p['compress']===true,stretch:p['stretch']===true,uniform:p['uniform']===true});
   this.bones.set(first,next);return;
  }
  const childId=c.boneIds[1]!,childSpec=this.ir.skeleton.bones.find(b=>b.id===childId)!;
  const child=this.applied.get(childId)!;
  const solved=solveTwoLink({parentBasis:parent,first:local,second:child,
   firstInheritance:spec.inheritance,secondInheritance:childSpec.inheritance,
   target:[target.x,target.y],bend:p['bendDirection']===-1?-1:1,mix});
  this.bones.set(first,solved.first);this.bones.set(childId,solved.second);
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
 /** World-space path evaluation. The attachment is resolved from the active
  * target slot at each sample, including skin and attachment timelines.
  * Constrained matrices stay authoritative across mixed constraint chains.
  */
 private pathConstraint(c:Constraint):void{
  const slot=this.slots.get(c.targetSlotId!);
  if(!slot?.attachmentId)return;
  const attachment=this.assets.get(slot.attachmentId);
  if(!attachment||attachment.kind!=='path')return;
  const owner=this.ir.skeleton.slots.find(s=>s.id===c.targetSlotId)!;
  const points=this.vertices(attachment.vertices,owner.boneId,this.deforms.get(attachment.id));
  const geometry=new CubicWorldPath(points,attachment.closed,attachment.constantSpeed,attachment.lengths);
  if(geometry.total<=1e-9)return;
  const p=this.parameters.get(c.id)!;
  const mixRotate=Number(p['mixRotate']??0),mixX=Number(p['mixX']??1),mixY=Number(p['mixY']??1);
  if(mixRotate===0&&mixX===0&&mixY===0)return;
  const spacingMode=String(p['spacingMode']??'fixed'),rotateMode=String(p['rotateMode']??'tangent');
  const position=Number(p['position']??0)*(p['positionMode']==='percent'?geometry.total:1);
  const authoredSpacing=Number(p['spacing']??0);
  const lengths=c.boneIds.map(id=>{
   const m=this.world.get(id)!,bone=this.ir.skeleton.bones.find(b=>b.id===id)!;
   return Math.abs(bone.setup.length)*Math.hypot(m.a,m.b);
  });
  const lengthSum=lengths.reduce((sum,value)=>sum+value,0);
  const distances=[position];
  for(let i=0;i<c.boneIds.length;i++){
   const interval=spacingMode==='percent'?authoredSpacing*geometry.total:
    spacingMode==='length'?lengths[i]!+authoredSpacing:
    spacingMode==='proportional'?lengthSum>1e-9?(lengths[i]!/lengthSum)*geometry.total*authoredSpacing:0:
    authoredSpacing;
   distances.push(distances.at(-1)!+interval);
  }
  const ownerWorld=this.world.get(owner.boneId)!;
  const reflection=ownerWorld.a*ownerWorld.d-ownerWorld.b*ownerWorld.c<0?-1:1;
  for(let i=0;i<c.boneIds.length;i++){
   const boneId=c.boneIds[i]!,previous=this.world.get(boneId)!;
   const current=geometry.sample(distances[i]!);
   const next=rotateMode==='tangent'?null:geometry.sample(distances[i+1]!);
   const angle=next&&Math.hypot(next.x-current.x,next.y-current.y)>1e-8?
    Math.atan2(next.y-current.y,next.x-current.x):current.angle;
   const offset=Number(p['offsetRotation']??0)*Math.PI/180*reflection;
   const wanted=angle+offset;
   const existing=Math.atan2(previous.b,previous.a);
   const delta=Math.atan2(Math.sin(wanted-existing),Math.cos(wanted-existing))*mixRotate;
   const cos=Math.cos(delta),sin=Math.sin(delta);
   const result:Affine={
    a:cos*previous.a-sin*previous.b,b:sin*previous.a+cos*previous.b,
    c:cos*previous.c-sin*previous.d,d:sin*previous.c+cos*previous.d,
    x:previous.x+(current.x-previous.x)*mixX,
    y:previous.y+(current.y-previous.y)*mixY
   };
   if(rotateMode==='chainScale'&&next&&Math.abs(mixRotate)>0){
    const boneLength=this.ir.skeleton.bones.find(b=>b.id===boneId)!.setup.length;
    const oldLength=Math.abs(boneLength)*Math.hypot(previous.a,previous.b);
    if(oldLength>1e-9){
     const desired=Math.hypot(next.x-current.x,next.y-current.y);
     const scale=1+(desired/oldLength-1)*mixRotate;
     result.a*=scale;result.b*=scale;
    }
   }
   this.world.set(boneId,result);
   // Reconstruct an applied pose for subsequent local transform constraints.
   // The world matrix above remains the source of truth for descendants.
   const spec=this.ir.skeleton.bones.find(b=>b.id===boneId)!;
   const parent=spec.parentId?this.world.get(spec.parentId)!:null;
   let local:Affine=result;
   if(parent){
    const det=parent.a*parent.d-parent.b*parent.c;
    if(Math.abs(det)>1e-12){
     const invParent=invert(parent);
     const [x,y]=apply(invParent,result.x,result.y);
     local={a:invParent.a*result.a+invParent.c*result.b,b:invParent.b*result.a+invParent.d*result.b,
      c:invParent.a*result.c+invParent.c*result.d,d:invParent.b*result.c+invParent.d*result.d,x,y};
    }
   }
   const old=this.applied.get(boneId)!;
   const sxSign=old.scaleX<0?-1:1,sySign=old.scaleY<0?-1:1;
   const sx=Math.hypot(local.a,local.b)*sxSign;
   const sy=Math.hypot(local.c,local.d)*sySign;
   const rot=Math.atan2(local.b*sxSign,local.a*sxSign)*180/Math.PI-old.shearXDeg;
   const shearY=Math.atan2(local.d*sySign,local.c*sySign)*180/Math.PI-90-rot;
   const pose:Transform={...old,x:local.x,y:local.y,
    rotationDeg:rot,scaleX:sx,scaleY:sy,shearYDeg:((shearY+540)%360)-180};
   this.applied.set(boneId,pose);this.bones.set(boneId,copyTransform(pose));
   this.updateDescendants(new Set([boneId]));
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
