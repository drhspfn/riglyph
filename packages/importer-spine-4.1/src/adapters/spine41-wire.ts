/** Independent 4.1.23 wire-format reader using only the Agent A2 behavioral handoff.
 * Source-specific parsing belongs here, never in the version-neutral animation runtime.
 * A2 handoff supplied four non-editor synthetic wire fixtures; rights review required before redistribution.
 */
import {BinaryReader} from './binary-reader.js';
import {requireCondition} from '@riglyph/core';
import type {Vertex,Sequence,Interpolation} from '@riglyph/core';

export type WireSection={name:string;start:number;end:number;count:number};
export type WireBone={name:string;parentIndex:number|null;rotation:number;x:number;y:number;scaleX:number;scaleY:number;shearX:number;shearY:number;length:number;inheritMode:number;skinRequired:boolean;authoringColor?:number};
export type WireSlot={name:string;boneIndex:number;light:number;dark:number|null;attachmentKey:string|null;blend:number};
export type WireConstraint={kind:'ik'|'transform'|'path';name:string;order:number;skinRequired:boolean;bones:number[];target:number;parameters:Record<string,number|boolean|string>};
export type WireAttachment={name:string;key:string;kind:'region'|'bounding_box'|'mesh'|'linked_mesh'|'path'|'point'|'clipping';path?:string|null;color?:number;rotation?:number;x?:number;y?:number;scaleX?:number;scaleY?:number;width?:number;height?:number;vertices?:Vertex[];uvs?:number[];triangles?:number[];hullVertexCount?:number;sequence?:Sequence|null;parentSkin?:string|null;parentKey?:string|null;inheritDeform?:boolean;closed?:boolean;constantSpeed?:boolean;lengths?:number[];endSlotIndex?:number;edges?:number[];authoringColor?:number};
export type WireSkin={name:string;isDefault:boolean;boneIndices:number[];constraintNames:string[];entries:{slotIndex:number;key:string;attachment:WireAttachment}[]};
export type WireEvent={name:string;int:number;float:number;string:string|null;audio:string|null;volume?:number;balance?:number};
export type WireFrame={time:number;value:unknown;toNext?:Interpolation};
export type WireTimeline={kind:'bone'|'slot'|'constraint'|'attachment'|'skeleton'|'event';target:number|string|null;property:string;skinIndex?:number;slotIndex?:number;attachmentKey?:string;frames:WireFrame[];bezierBudget?:number};
export type WireAnimation={name:string;declaredTimelines:number;timelines:WireTimeline[];duration:number};
export type Spine41Wire={version:string;hash:string;bounds:[number,number,number,number];nonessential:boolean;fps?:number;imagesPath?:string|null;audioPath?:string|null;strings:string[];bones:WireBone[];slots:WireSlot[];constraints:WireConstraint[];skins:WireSkin[];events:WireEvent[];animations:WireAnimation[];sections:WireSection[];bytesConsumed:number;inputLength:number};

const MAX_ITEMS=100_000, MAX_FLOATS=2_000_000;
const inheritModes=['normal','onlyTranslation','noRotationOrReflection','noScale','noScaleOrReflection'];
const sequenceNames=['hold','once','loop','pingpong','onceReverse','loopReverse','pingpongReverse'];
const boneProperties=['rotationDeg','translate','x','y','scale','scaleX','scaleY','shear','shearXDeg','shearYDeg'];
const slotProperties=['attachment','light','lightRGB','twoColor','twoColorRGB','alpha'];
const pathProperties=['position','spacing','mix'];

export function decodeSpine41(bytes:Uint8Array,source='memory'):Spine41Wire {
 const r=new BinaryReader(bytes,source);
 const at=(message:string)=>({...r.at(),owner:message});
 const check=(condition:unknown,code:'INVALID_HEADER'|'INVALID_REFERENCE'|'INVALID_ATTACHMENT'|'INVALID_TIMELINE'|'LIMIT_EXCEEDED',message:string):void=>requireCondition(condition,code,message,at(message));
 const count=(label:string,limit=MAX_ITEMS):number=>{const n=r.uvarint();check(n<=limit,'LIMIT_EXCEEDED',`${label}: count ${n} exceeds ${limit}`);return n;};
 const idx=(length:number,label:string):number=>{const i=r.uvarint();check(i<length,'INVALID_REFERENCE',`${label}: index ${i} >= ${length}`);return i;};
 const string=(label:string):string=>{const x=r.requiredString();check(x.length>0,'INVALID_HEADER',`${label}: empty name`);return x;};
 const enumId=(length:number,label:string):number=>{const i=r.uvarint();check(i<length,'INVALID_HEADER',`${label}: unknown enum ${i}`);return i;};
 const strRef=(strings:readonly string[],label:string):string|null=>{const v=r.stringRef(strings);if(v!==null)check(v.length>0,'INVALID_REFERENCE',`${label}: empty reference`);return v;};
 const optionalSeq=():Sequence|null=>{
  if(!r.bool())return null;
  const n=count('sequence frame count',MAX_ITEMS),start=r.uvarint(),digits=r.uvarint(),setupIndex=r.uvarint();
  check(n>0&&digits<=16&&setupIndex<n,'INVALID_ATTACHMENT','Invalid sequence metadata');return {count:n,start,digits,setupIndex};
 };
 const vertices=(n:number,bones:WireBone[]):Vertex[]=>{
  check(n<=MAX_ITEMS,'LIMIT_EXCEEDED','Too many logical vertices');
  const weighted=r.bool();const out:Vertex[]=[];
  if(!weighted){check(n*8<=r.length-r.offset,'LIMIT_EXCEEDED','Unweighted vertices exceed available input');for(let i=0;i<n;i++)out.push({position:[r.f32(),r.f32()],influences:[]});}
  else {for(let i=0;i<n;i++){const influenceCount=count('influences per vertex',256);check(influenceCount>0,'INVALID_ATTACHMENT','Weighted vertex has no influences');const influences:Vertex['influences']=[];
   for(let j=0;j<influenceCount;j++){const boneIndex=idx(bones.length,'weighted vertex bone');influences.push({boneId:`bone:${boneIndex}`,x:r.f32(),y:r.f32(),weight:r.f32()});}out.push({position:null,influences});}}
  return out;
 };
 const sections:WireSection[]=[];
 function section<T>(name:string,fn:()=>T):T{
  const start=r.offset,out=fn();const count=Array.isArray(out)?out.length:1;sections.push({name,start,end:r.offset,count});return out;
 }
 const head=section('header',()=>{
  const hash=Array.from(r.bytes(8),b=>b.toString(16).padStart(2,'0')).join('');
  const version=string('version');check(version==='4.1.23','INVALID_HEADER',`Expected 4.1.23; got ${version}`);
  const bounds:[number,number,number,number]=[r.f32(),r.f32(),r.f32(),r.f32()];
  const nonessential=r.bool();
  const extra=nonessential?{fps:r.f32(),imagesPath:r.utf8(),audioPath:r.utf8()}:{};
  return {hash,version,bounds,nonessential,...extra};
 });
 const strings=section('strings',()=>{
  const n=count('string table');const a:string[]=[];for(let i=0;i<n;i++)a.push(string(`string[${i}]`));return a;
 });
 const bones=section('bones',()=>{
  const n=count('bone count');check(n>0,'INVALID_HEADER','Empty bone list');const a:WireBone[]=[];
  for(let i=0;i<n;i++){
   const name=string('bone name');const parentIndex=i>0?idx(i,'bone parent'):null;
   const rotation=r.f32(),x=r.f32(),y=r.f32(),scaleX=r.f32(),scaleY=r.f32(),shearX=r.f32(),shearY=r.f32(),length=r.f32();
   const inheritMode=enumId(inheritModes.length,'inherit mode'),skinRequired=r.bool();
   const meta=head.nonessential?{authoringColor:r.i32()>>>0}:{};
   a.push({name,parentIndex,rotation,x,y,scaleX,scaleY,shearX,shearY,length,inheritMode,skinRequired,...meta});
  }return a;
 });
 const slots=section('slots',()=>{
  const n=count('slot count');const a:WireSlot[]=[];
  for(let i=0;i<n;i++){const name=string('slot name'),boneIndex=idx(bones.length,'slot bone'),light=r.i32()>>>0,rawDark=r.i32(),attachmentKey=strRef(strings,'slot attachment'),blend=enumId(4,'slot blend');
   a.push({name,boneIndex,light,dark:rawDark===-1?null:rawDark>>>0,attachmentKey,blend});}return a;
 });
 function constraintBase(kind:WireConstraint['kind']):{kind:WireConstraint['kind'];name:string;order:number;skinRequired:boolean;bones:number[];target:number}{
  const name=string(`${kind} name`),order=count('constraint order'),skinRequired=r.bool(),n=count('constraint bone count',1000);
  check(n>0,'INVALID_REFERENCE',`${kind}: no constrained bones`);const owners=Array.from({length:n},()=>idx(bones.length,'constraint bone'));
  const target=idx(kind==='path'?slots.length:bones.length,'constraint target');return {kind,name,order,skinRequired,bones:owners,target};
 }
 const ik=section('ik',()=>Array.from({length:count('IK count')},()=>{
  const c=constraintBase('ik'),mix=r.f32(),softness=r.f32(),bendDirection=r.s8(),compress=r.bool(),stretch=r.bool(),uniform=r.bool();
  check(bendDirection===1||bendDirection===-1,'INVALID_REFERENCE','Invalid IK bend direction');return {...c,parameters:{mix,softness,bendDirection,compress,stretch,uniform}};
 }));
 const transform=section('transform',()=>Array.from({length:count('transform count')},()=>{
  const c=constraintBase('transform'),local=r.bool(),relative=r.bool(),parameters:WireConstraint['parameters']={local,relative};
  for(const key of ['offsetRotation','offsetX','offsetY','offsetScaleX','offsetScaleY','offsetShearY','mixRotate','mixX','mixY','mixScaleX','mixScaleY','mixShearY'])parameters[key]=r.f32();
  return {...c,parameters};
 }));
 const paths=section('path',()=>Array.from({length:count('path count')},()=>{
  const c=constraintBase('path'),positionMode=enumId(2,'path position mode'),spacingMode=enumId(4,'path spacing mode'),rotateMode=enumId(3,'path rotate mode');
  const offsetRotation=r.f32(),position=r.f32(),spacing=r.f32(),mixRotate=r.f32(),mixX=r.f32(),mixY=r.f32();
  return {...c,parameters:{positionMode:['fixed','percent'][positionMode]!,spacingMode:['length','fixed','percent','proportional'][spacingMode]!,rotateMode:['tangent','chain','chainScale'][rotateMode]!,offsetRotation,position,spacing,mixRotate,mixX,mixY}};
 }));
 const constraints:WireConstraint[]=[...ik,...transform,...paths];
 function readAttachment(key:string):WireAttachment{
  const override=strRef(strings,'attachment name'),name=override??key,id=r.byte();check(id<=6,'INVALID_ATTACHMENT',`Unknown attachment type ${id}`);
  const kind= (['region','bounding_box','mesh','linked_mesh','path','point','clipping'] as const)[id]!;
  const base={name,key,kind};
  switch(id){
   case 0:{const path=strRef(strings,'region path'),rotation=r.f32(),x=r.f32(),y=r.f32(),scaleX=r.f32(),scaleY=r.f32(),width=r.f32(),height=r.f32(),color=r.i32()>>>0,sequence=optionalSeq();return {...base,path,rotation,x,y,scaleX,scaleY,width,height,color,sequence};}
   case 1:{const n=count('bbox vertices'),v=vertices(n,bones),meta=head.nonessential?{authoringColor:r.i32()>>>0}:{};return {...base,vertices:v,...meta};}
   case 2:{const path=strRef(strings,'mesh path'),color=r.i32()>>>0,n=count('mesh vertices');check(n*8<=MAX_FLOATS,'LIMIT_EXCEEDED','Mesh UV count too large');
    const uvs=Array.from({length:n*2},()=>r.f32());const triangleCount=count('mesh triangles',MAX_FLOATS);check(triangleCount%3===0,'INVALID_ATTACHMENT','Triangles must be multiple of 3');
    const triangles=Array.from({length:triangleCount},()=>r.i16());for(const v of triangles)check(v>=0&&v<n,'INVALID_ATTACHMENT','Triangle index outside logical mesh vertices');
    const v=vertices(n,bones),hullVertexCount=count('hull');check(hullVertexCount<=n,'INVALID_ATTACHMENT','Hull vertex count too large');const sequence=optionalSeq();
    const meta=head.nonessential?(()=>{const edgeCount=count('mesh edges'),edges=Array.from({length:edgeCount},()=>r.i16());return {edges,width:r.f32(),height:r.f32()};})():{};
    return {...base,path,color,uvs,triangles,vertices:v,hullVertexCount,sequence,...meta};}
   case 3:{const path=strRef(strings,'linked path'),color=r.i32()>>>0,parentSkin=strRef(strings,'parent skin'),parentKey=strRef(strings,'parent mesh'),inheritDeform=r.bool(),sequence=optionalSeq();
    check(parentKey,'INVALID_REFERENCE','Missing linked parent mesh key');const meta=head.nonessential?{width:r.f32(),height:r.f32()}:{};
    return {...base,path,color,parentSkin,parentKey,inheritDeform,sequence,...meta};}
   case 4:{const closed=r.bool(),constantSpeed=r.bool(),n=count('path vertex count'),v=vertices(n,bones);check(n%3===0,'INVALID_ATTACHMENT','Path vertex count must be divisible by 3');
    const lengths=Array.from({length:n/3},()=>r.f32()),meta=head.nonessential?{authoringColor:r.i32()>>>0}:{};return {...base,closed,constantSpeed,vertices:v,lengths,...meta};}
   case 5:{const rotation=r.f32(),x=r.f32(),y=r.f32(),meta=head.nonessential?{authoringColor:r.i32()>>>0}:{};return {...base,rotation,x,y,...meta};}
   default:{const endSlotIndex=idx(slots.length,'clipping end slot'),n=count('clipping vertex count'),v=vertices(n,bones),meta=head.nonessential?{authoringColor:r.i32()>>>0}:{};return {...base,endSlotIndex,vertices:v,...meta};}
  }
 }
 function skinEntries():WireSkin['entries']{
  const slotsCount=count('skin slot entries'),entries:WireSkin['entries']=[];
  for(let i=0;i<slotsCount;i++){
   const slotIndex=idx(slots.length,'skin slot'),amount=count('skin attachments');
   for(let j=0;j<amount;j++){const key=strRef(strings,'skin attachment key');check(key,'INVALID_REFERENCE','Null skin attachment key');entries.push({slotIndex,key:key!,attachment:readAttachment(key!)});}
  }return entries;
 }
 const skins=section('skins',()=>{
  const defaultEntries=skinEntries();const arr:WireSkin[]=[];
  if(defaultEntries.length>0)arr.push({name:'default',isDefault:true,boneIndices:[],constraintNames:[],entries:defaultEntries});
  const n=count('named skin count');for(let i=0;i<n;i++){
   const name=strRef(strings,'skin name');check(name,'INVALID_REFERENCE','Null skin name');
   const boneIndices=Array.from({length:count('included bones')},()=>idx(bones.length,'skin bone'));
   const used:WireConstraint[]=[];
   for(const family of [ik,transform,paths]){const amount=count('included constraints');for(let j=0;j<amount;j++)used.push(family[idx(family.length,'included constraint')]!);}
   const entries=skinEntries();arr.push({name:name!,isDefault:false,boneIndices,constraintNames:used.map(c=>c.name),entries});
  }return arr;
 });
 // Resolve all linked mesh references after all skins are present; a parent can be declared later.
 for(const skin of skins)for(const entry of skin.entries){const a=entry.attachment;if(a.kind!=='linked_mesh')continue;
  const parentSkin=a.parentSkin===null?skins.find(x=>x.isDefault):skins.find(x=>x.name===a.parentSkin);
  check(parentSkin,'INVALID_REFERENCE',`Unresolved linked parent skin ${a.parentSkin}`);
  const parent=parentSkin!.entries.find(x=>x.slotIndex===entry.slotIndex&&x.key===a.parentKey)?.attachment;
  check(parent&&(parent.kind==='mesh'||parent.kind==='linked_mesh'),'INVALID_REFERENCE',`Linked parent mesh not found: ${a.parentKey}`);
 }
 const events=section('events',()=>Array.from({length:count('event definition count')},()=>{
  const name=strRef(strings,'event name');check(name,'INVALID_REFERENCE','Null event name');
  const int=r.svarint(),float=r.f32(),str=r.utf8(),audio=r.utf8();
  const extra=audio?{volume:r.f32(),balance:r.f32()}:{};return {name:name!,int,float,string:str,audio,...extra};
 }));
 function curve(channels:number):Interpolation{
  const mode=r.byte();check(mode<=2,'INVALID_TIMELINE',`Unknown curve type ${mode}`);
  if(mode===0)return {kind:'linear'};if(mode===1)return {kind:'stepped'};
  const bezierByChannel:Array<[number,number,number,number]>=[];for(let i=0;i<channels;i++)bezierByChannel.push([r.f32(),r.f32(),r.f32(),r.f32()]);
  return {kind:'cubic_bezier',bezierByChannel};
 }
 function frames(n:number,channels:number,readValue:()=>unknown,withCurve=true):WireFrame[]{
  check(n>0,'INVALID_TIMELINE','Numeric timeline has no frames');const out:WireFrame[]=[];
  for(let i=0;i<n;i++){
   const time=r.f32();check(time>=0,'INVALID_TIMELINE','Negative key time');const value=readValue();
   if(i>0&&withCurve)out[i-1]!.toNext=curve(channels);
   if(i>0)check(time>=out[i-1]!.time,'INVALID_TIMELINE','Nonmonotonic key time');
   out.push({time,value});
  }return out;
 }
 const animations=section('animations',()=>{
  const total=count('animation count'),items:WireAnimation[]=[];
  for(let a=0;a<total;a++){
   // Animation-wide capacity hint, not a payload count. Group counts delimit the timelines.
   // Keep the original value in wire diagnostics and retain the existing resource bound.
   const name=string('animation name'),declaredTimelines=count('timeline capacity hint'),timelines:WireTimeline[]=[];
   const push=(kind:WireTimeline['kind'],target:WireTimeline['target'],property:string,frames:WireFrame[],extra:Partial<WireTimeline>={})=>{
    check(timelines.length<MAX_ITEMS,'LIMIT_EXCEEDED','Too many timelines in animation');timelines.push({kind,target,property,frames,...extra});
   };
   const slotGroups=count('slot timeline groups');for(let i=0;i<slotGroups;i++){
    const slotIndex=idx(slots.length,'slot timeline target'),m=count('slot timelines');
    for(let j=0;j<m;j++){
     const type=r.byte();check(type<slotProperties.length,'INVALID_TIMELINE',`Unknown slot timeline ${type}`);const n=count('slot key count');
     if(type===0)push('slot',slotIndex,'attachment',frames(n,0,()=>strRef(strings,'attachment key'),false));
     else {const bezierBudget=count('slot bezier budget'),channels=[0,4,3,7,6,1][type]!;
      const values=frames(n,channels,()=>Array.from({length:channels},()=>r.byte()/255));
      push('slot',slotIndex,slotProperties[type]!,values,{bezierBudget});}
    }
   }
   const boneGroups=count('bone timeline groups');for(let i=0;i<boneGroups;i++){
    const boneIndex=idx(bones.length,'bone timeline target'),m=count('bone timelines');
    for(let j=0;j<m;j++){const type=r.byte();check(type<boneProperties.length,'INVALID_TIMELINE',`Unknown bone timeline ${type}`);
     const n=count('bone key count'),bezierBudget=count('bone bezier budget'),channels=[1,2,1,1,2,1,1,2,1,1][type]!;
     const values=frames(n,channels,()=>channels===1?r.f32():Array.from({length:channels},()=>r.f32()));
     push('bone',boneIndex,boneProperties[type]!,values,{bezierBudget});
    }
   }
   const ikCount=count('IK timeline count');for(let i=0;i<ikCount;i++){
    const index=idx(ik.length,'IK timeline target'),n=count('IK key count'),bezierBudget=count('IK bezier budget');
    check(n>0,'INVALID_TIMELINE','IK timeline without keys');const f:WireFrame[]=[];
    for(let j=0;j<n;j++){
     const time=r.f32(),mix=r.f32(),softness=r.f32();
     if(j>0)f[j-1]!.toNext=curve(2);
     const bendDirection=r.s8(),compress=r.bool(),stretch=r.bool();check(bendDirection===-1||bendDirection===1,'INVALID_TIMELINE','IK key bend invalid');
     f.push({time,value:{mix,softness,bendDirection,compress,stretch}});
    }
    push('constraint',ik[index]!.name,'ik',f,{bezierBudget});
   }
   const trCount=count('transform timeline count');for(let i=0;i<trCount;i++){
    const index=idx(transform.length,'transform timeline target'),n=count('transform key count'),bezierBudget=count('transform bezier budget');
    push('constraint',transform[index]!.name,'transform',frames(n,6,()=>Array.from({length:6},()=>r.f32())),{bezierBudget});
   }
   const pathGroups=count('path timeline groups');for(let i=0;i<pathGroups;i++){
    const index=idx(paths.length,'path timeline target'),n=count('path timelines');
    for(let j=0;j<n;j++){
     const type=r.byte();check(type<pathProperties.length,'INVALID_TIMELINE',`Unknown path timeline ${type}`);const frameCount=count('path key count'),bezierBudget=count('path bezier budget'),channels=type===2?3:1;
     push('constraint',paths[index]!.name,pathProperties[type]!,frames(frameCount,channels,()=>channels===1?r.f32():[r.f32(),r.f32(),r.f32()]),{bezierBudget});
    }
   }
   const skinGroups=count('skin timeline groups');for(let i=0;i<skinGroups;i++){
    const skinIndex=idx(skins.length,'skin timeline skin'),slotGroupCount=count('skin timeline slot group');
    for(let j=0;j<slotGroupCount;j++){
     const slotIndex=idx(slots.length,'skin timeline slot'),n=count('attachment timelines');
     for(let k=0;k<n;k++){
      const attachmentKey=strRef(strings,'deform/sequence attachment key');check(attachmentKey,'INVALID_REFERENCE','Null attachment timeline key');
      const activeAttachment=skins[skinIndex]!.entries.find(e=>e.slotIndex===slotIndex&&e.key===attachmentKey)?.attachment;
      check(activeAttachment,'INVALID_REFERENCE',`Timeline attachment missing (${skinIndex}/${slotIndex}/${attachmentKey})`);
      const type=r.byte();check(type<=1,'INVALID_TIMELINE',`Unknown attachment timeline ${type}`);const frameCount=count('attachment timeline keys');check(frameCount>0,'INVALID_TIMELINE','Empty attachment timeline');
      if(type===0){
       const bezierBudget=count('deform bezier budget'),f:WireFrame[]=[];let time=r.f32();
       for(let z=0;z<frameCount;z++){
        const sparseCount=count('deform sparse count',MAX_FLOATS),start=sparseCount?count('deform start',MAX_FLOATS):0;
        const values=Array.from({length:sparseCount},()=>r.f32());
        f.push({time,value:{offset:start,values}});
        if(z<frameCount-1){time=r.f32();f[z]!.toNext=curve(1);}
       }
       push('attachment',attachmentKey!,'deform',f,{skinIndex,slotIndex,attachmentKey:attachmentKey!,bezierBudget});
      }else{
       const f=frames(frameCount,0,()=>{const packed=r.i32(),delay=r.f32(),mode=packed&15,index=packed>>4;
        check(mode<sequenceNames.length,'INVALID_TIMELINE','Unsupported sequence mode');check(delay>0,'INVALID_TIMELINE','Nonpositive sequence delay');return {mode:sequenceNames[mode]!,index,delay};},false);
       push('attachment',attachmentKey!,'sequence',f,{skinIndex,slotIndex,attachmentKey:attachmentKey!});
      }
     }
    }
   }
   const drawCount=count('draw order keys');if(drawCount){const f:WireFrame[]=[];
    for(let k=0;k<drawCount;k++){
     const time=r.f32(),offsetCount=count('draw order changed slots');const changes:{slot:number;offset:number}[]=[];
     let prev=-1;for(let x=0;x<offsetCount;x++){const slot=idx(slots.length,'draw order slot'),offset=r.uvarint();check(slot>prev,'INVALID_TIMELINE','Draw-order changes not sorted');prev=slot;changes.push({slot,offset:offset|0});}
     f.push({time,value:changes});
    }push('skeleton',null,'drawOrder',f);
   }
   const eventCount=count('event keys');if(eventCount){const f:WireFrame[]=[];
    for(let k=0;k<eventCount;k++){
     const time=r.f32(),index=idx(events.length,'event key definition'),int=r.svarint(),float=r.f32(),hasString=r.bool(),str=hasString?r.utf8():events[index]!.string;
     const audio=events[index]!.audio,extra=audio?{volume:r.f32(),balance:r.f32()}:{};
     f.push({time,value:{definitionIndex:index,int,float,string:str,...extra}});
    }push('event',null,'fire',f);
   }
   let duration=0;for(const t of timelines)for(const frame of t.frames){check(frame.time>=0&&Number.isFinite(frame.time),'INVALID_TIMELINE','Invalid keyframe time');duration=Math.max(duration,frame.time);}
   items.push({name,declaredTimelines,timelines,duration});
  }return items;
 });
 check(r.offset===r.length,'INVALID_HEADER',`Trailing bytes after animation section (${r.length-r.offset})`);
 const unique=(labels:readonly string[],what:string)=>check(new Set(labels).size===labels.length,'INVALID_REFERENCE',`Duplicate ${what} name`);
 unique(bones.map(b=>b.name),'bone');unique(slots.map(b=>b.name),'slot');unique(skins.map(b=>b.name),'skin');unique(constraints.map(b=>b.name),'constraint');unique(events.map(b=>b.name),'event');unique(animations.map(b=>b.name),'animation');
 return {...head,strings,bones,slots,constraints,skins,events,animations,sections,bytesConsumed:r.offset,inputLength:r.length};
}
