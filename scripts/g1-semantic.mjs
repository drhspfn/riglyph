/**
 * Independent G1 source-to-semantic inventory checks. No proprietary bytes,
 * names, times, or controls are returned in the sanitized report. This is
 * structural/semantic-preservation evidence, NOT runtime/editor parity.
 * Independent from the Spine 4.1 normalizer and from IR validation.
 */
const boneChannels={rotationDeg:['rotationDeg'],translate:['x','y'],x:['x'],y:['y'],scale:['scaleX','scaleY'],scaleX:['scaleX'],scaleY:['scaleY'],shear:['shearXDeg','shearYDeg'],shearXDeg:['shearXDeg'],shearYDeg:['shearYDeg']};
const slotProps=new Set(['attachment','light','lightRGB','twoColor','twoColorRGB','alpha']);
const numericSlots=new Set(['light','lightRGB','twoColor','twoColorRGB','alpha']);
const delta=4e-5;
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=delta*Math.max(1,Math.abs(a),Math.abs(b));
function ensure(value,reason){if(!value)throw Object.assign(new Error(reason),{code:'AGGREGATE_MISMATCH'});return value;}

function expectedForClip(wire,ir,clip){
 const records=[];
 function add(kind,target,property,raw,channelIndices=[],getRaw=(value,channel)=>Array.isArray(value)?value[channel]:value,curveMode='numeric'){
  records.push({kind,target,property,raw,channelIndices,getRaw,curveMode,times:raw.frames.map(f=>f.time)});
 }
 for(const t of clip.timelines){
  if(t.kind==='bone'){
   const names=ensure(boneChannels[t.property],`Unsupported source bone timeline kind`);
   const target=ensure(wire.bones[t.target]?.name,'Unknown source bone owner');
   names.forEach((prop,i)=>add('bone',target,prop,t,[i]));
  }else if(t.kind==='slot'){
   ensure(slotProps.has(t.property),'Unsupported source slot timeline');
   const target=ensure(wire.slots[t.target]?.name,'Unknown source slot owner');
   const channels=t.property==='light'?4:t.property==='lightRGB'?3:t.property==='twoColor'?7:t.property==='twoColorRGB'?6:1;
   add('slot',target,t.property,t,numericSlots.has(t.property)?Array.from({length:channels},(_,i)=>i):[]);
  }else if(t.kind==='constraint'){
   const owner=ensure(wire.constraints.find(c=>c.name===t.target),'Unknown constraint owner');
   if(t.property==='ik'){
    ['mix','softness'].forEach((prop,i)=>add('constraint',owner.name,prop,t,[i],v=>v[prop]));
    for(const prop of ['bendDirection','compress','stretch'])add('constraint',owner.name,prop,t,[],v=>v[prop],'discrete');
   }else if(t.property==='transform'){
    ['mixRotate','mixX','mixY','mixScaleX','mixScaleY','mixShearY'].forEach((prop,i)=>add('constraint',owner.name,prop,t,[i]));
   }else if(t.property==='mix'){
    ['mixRotate','mixX','mixY'].forEach((prop,i)=>add('constraint',owner.name,prop,t,[i]));
   }else if(['position','spacing'].includes(t.property))add('constraint',owner.name,t.property,t,[0]);
   else ensure(false,'Unsupported source constraint timeline');
  }else if(t.kind==='attachment'){
   const skin=ensure(wire.skins[t.skinIndex],'Missing source skin');
   const owner=ensure(ir.skeleton.skins.find(s=>s.id===skin.name),'Missing semantic skin');
   const slot=ensure(wire.slots[t.slotIndex]?.name,'Unknown attachment slot');
   const record=ensure(owner.attachments.find(a=>a.slotId===slot&&a.key===t.attachmentKey),'Missing semantic skin attachment');
   if(t.property==='deform')add('attachment',record.attachmentId,'deform',t,[0],()=>null,'deform');
   else if(t.property==='sequence')add('slot',slot,'sequencePlayback',t,[],()=>null,'discrete');
   else ensure(false,'Unsupported source attachment timeline');
  }else if(t.kind==='skeleton'){
   ensure(t.property==='drawOrder','Unexpected skeleton timeline');
   add('skeleton',null,'drawOrder',t,[],()=>null,'discrete');
  }else if(t.kind==='event'){
   ensure(t.property==='fire','Unexpected event timeline');
   const byId=new Map();
   for(const f of t.frames){const def=ensure(wire.events[f.value?.definitionIndex],'Missing event definition');
    if(!byId.has(def.name))byId.set(def.name,[]);byId.get(def.name).push(f);}
   for(const [id,frames] of byId)add('event',id,'fire',{frames},[],()=>null,'discrete');
  }else ensure(false,'Unsupported source timeline kind');
 }
 return records;
}
const signature=(kind,target,property,times)=>JSON.stringify([kind,target,property,times]);
function checkCurves(expected,actual){
 const {raw,channelIndices,curveMode,getRaw}=expected;
 if(actual.keys.length!==raw.frames.length)return false;
 for(let k=0;k<raw.frames.length;k++){
  const f=raw.frames[k],a=actual.keys[k],next=raw.frames[k+1];
  if(!near(a.timeSec,f.time))return false;
  if(curveMode==='discrete'){
   if(a.interpolation.kind==='cubic_bezier')return false;
   continue;
  }
  const source=f.toNext?.kind??'linear';
  if(a.interpolation.kind!==source)return false;
  if(source!=='cubic_bezier'){
   if(a.interpolation.bezierByChannel||a.interpolation.sampling)return false;
   continue;
  }
  if(!next||!(next.time>f.time)||a.interpolation.sampling!=='polyline10')return false;
  if(a.interpolation.bezierByChannel?.length!==channelIndices.length)return false;
  for(let i=0;i<channelIndices.length;i++){
   const channel=channelIndices[i],control=f.toNext.bezierByChannel?.[channel],observed=a.interpolation.bezierByChannel[i];
   if(!control||!observed||observed.length!==4)return false;
   const dt=next.time-f.time;
   const from=getRaw(f.value,channel),to=getRaw(next.value,channel);
   const y1=curveMode==='deform'?control[1]:from===to?0:(control[1]-from)/(to-from);
   const y2=curveMode==='deform'?control[3]:from===to?1:(control[3]-from)/(to-from);
   const required=[(control[0]-f.time)/dt,y1,(control[2]-f.time)/dt,y2];
   if(required.some((v,j)=>!near(v,observed[j])))return false;
  }
 }
 return true;
}

export function assessSemanticCoverage(wire,ir){
 const issues=[],perClip=[];
 let expectedTimelines=0,expectedKeys=0,actualTimelines=0,actualKeys=0;
 if(ir.skeleton.animations.length!==wire.animations.length)issues.push({code:'CLIP_COUNT_MISMATCH',clipIndex:-1});
 for(let clipIndex=0;clipIndex<wire.animations.length;clipIndex++){
  const source=wire.animations[clipIndex],target=ir.skeleton.animations[clipIndex];
  const expected=expectedForClip(wire,ir,source);
  const eKeys=expected.reduce((sum,r)=>sum+r.times.length,0);
  const aT=target?.timelines.length??0,aKeys=target?.timelines.reduce((sum,t)=>sum+t.keys.length,0)??0;
  expectedTimelines+=expected.length;expectedKeys+=eKeys;actualTimelines+=aT;actualKeys+=aKeys;
  let recordMatches=0,curveMatches=0;
  if(target&&target.id===source.name&&near(target.durationSec,source.duration)){
   const available=new Map();
   for(const timeline of target.timelines){const id=signature(timeline.targetKind,timeline.targetId,timeline.property,timeline.keys.map(k=>k.timeSec));
    if(!available.has(id))available.set(id,[]);available.get(id).push(timeline);}
   for(const e of expected){
    const id=signature(e.kind,e.target,e.property,e.times),candidates=available.get(id);
    if(!candidates?.length)continue;
    recordMatches++;
    const found=candidates.findIndex(c=>checkCurves(e,c));
    if(found>=0){curveMatches++;candidates.splice(found,1);}else candidates.shift();
   }
  }
  const matched=expected.length===aT&&eKeys===aKeys&&recordMatches===aT&&curveMatches===aT;
  if(!matched)issues.push({code:'SEMANTIC_RECORD_OR_CURVE_MISMATCH',clipIndex});
  perClip.push({index:clipIndex,expectedTimelines:expected.length,actualTimelines:aT,expectedKeys:eKeys,actualKeys:aKeys,recordMatches,curveMatches,matched});
 }
 return {expectedTimelines,actualTimelines,expectedKeys,actualKeys,perClip,issues};
}
