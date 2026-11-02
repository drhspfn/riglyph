/** Browser-free deterministic animation rendering using Riglyph's existing
 * Universal IR runtime, draw-packet generator and CPU rasterizer.
 * No I/O, process, CLI argument, DOM, WebGL or FFmpeg dependency.
 */
import {EngineError,requireCondition} from '@riglyph/core';
import type {IRDocument} from '@riglyph/core';
import {SkeletonInstance,AnimationPlayer} from '@riglyph/runtime';
import {prepareDrawPackets,drawBounds} from '@riglyph/renderer-webgl2';
import type {DrawPacket,Viewport} from '@riglyph/renderer-webgl2';
import {rasterize} from './software.js';
import type {RawTexture,TextureSampling} from './software.js';

export type RenderBounds=[number,number,number,number];
export type CameraSettings={
 mode?:'fit-scene'|'fit-selection'|'fixed'|'follow';
 fit?:'start'|'frame'|'animation';
 targetBoneId?:string;
 targetSlotId?:string;
 padding?:number;scale?:number;offsetX?:number;offsetY?:number;
 x?:number;y?:number;worldWidth?:number;
};
export type RenderQuality={sampling?:TextureSampling;supersampling?:1|2|4;pngCompression?:number};
export type RenderBackground={mode:'transparent'|'solid';color?:string};
export type TimelineAction={atSec:number;track:number;clipId:string;loop?:boolean;mixDurationSec?:number};
/** Pluggable raster accelerator. Geometry, skins and camera remain in TS. */
export type RasterBackend={render:(input:{packets:readonly DrawPacket[];textures:ReadonlyMap<string,RawTexture>;
 viewport:Viewport;width:number;height:number;clear:[number,number,number,number];
 sampling:TextureSampling;signal?:AbortSignal})=>Promise<Uint8Array>};
export type HeadlessOptions={
 ir:IRDocument;textures:ReadonlyMap<string,RawTexture>;
 width:number;height:number;fps?:number;
 camera?:CameraSettings;background?:RenderBackground;quality?:RenderQuality;
 maxFrames?:number;maxBytes?:number;rasterBackend?:RasterBackend;
};
export type FrameRequest={timeSec:number;clipId?:string;skinId?:string|null;loop?:boolean;signal?:AbortSignal;
 playbackSpeed?:number;timeline?:readonly TimelineAction[];cameraViewport?:Viewport};
export type RenderFrame={timeSec:number;width:number;height:number;rgba:Uint8Array;
 viewport:Viewport;bounds:RenderBounds|null;packetCount:number};
export type SequenceOptions=Omit<FrameRequest,'timeSec'|'cameraViewport'> & {
 startSec:number;endSec:number;fps?:number;includeEnd?:boolean;
 loopCount?:number;signal?:AbortSignal;
 onFrame:(frame:RenderFrame,index:number,total:number)=>void|Promise<void>;
 onProgress?:(progress:{phase:'prepass'|'rendering'|'completed';frame:number;totalFrames:number;timeSec:number})=>void;
};
const budget=(condition:unknown,message:string):void=>{if(!condition)throw new EngineError('LIMIT_EXCEEDED',message);};
const finite=(v:number,name:string)=>requireCondition(Number.isFinite(v),'INVALID_TIMELINE',`Invalid ${name}`);
const parseRGB=(hex:string):[number,number,number,number]=>{
 requireCondition(/^#[0-9a-fA-F]{6}$/.test(hex),'INVALID_HEADER','Background must be #RRGGBB');
 return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).concat(1) as [number,number,number,number];
};
export function countScheduledFrames(startSec:number,endSec:number,fps:number,includeEnd=false,maxFrames=200000):number{
 finite(startSec,'startSec');finite(endSec,'endSec');finite(fps,'fps');
 requireCondition(startSec>=0&&endSec>=startSec&&fps>0&&fps<=1000,'INVALID_TIMELINE','Invalid frame interval or FPS');
 const value=(endSec-startSec)*fps;
 budget(Number.isFinite(value)&&value<Number.MAX_SAFE_INTEGER,'Frame count overflow');
 // Half-open by default: samples at start+i/fps strictly before end.
 const baseCount=Math.ceil(value-1e-9);
 const count=includeEnd?baseCount+1:baseCount;
 budget(Number.isSafeInteger(count)&&count>0&&count<=maxFrames,'Frame budget exceeded or empty interval');
 return count;
}
const joinBounds=(a:RenderBounds|null,b:RenderBounds|null):RenderBounds|null=>{
 if(!a)return b;if(!b)return a;
 const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]);
 return [x,y,Math.max(a[0]+a[2],b[0]+b[2])-x,Math.max(a[1]+a[3],b[1]+b[3])-y];
};
export function fitRenderBounds(b:RenderBounds|null,width:number,height:number,camera:CameraSettings={}):Viewport{
 const bounds=b??[-.5,-.5,1,1],padding=camera.padding??1.1,zoom=camera.scale??1;
 finite(padding,'camera.padding');finite(zoom,'camera.scale');
 requireCondition(padding>0&&zoom>0,'INVALID_HEADER','Camera padding/scale must be positive');
 const vw=Math.max(bounds[2],.25),vh=Math.max(bounds[3],.25);
 const unit=Math.max(vw/width,vh/height)*padding/zoom;
 const w=unit*width,h=unit*height,cx=bounds[0]+bounds[2]/2+(camera.offsetX??0),cy=bounds[1]+bounds[3]/2+(camera.offsetY??0);
 return {left:cx-w/2,bottom:cy-h/2,width:w,height:h};
}
function downsample(input:Uint8Array|Uint8ClampedArray,w:number,h:number,ss:number):Uint8Array{
 if(ss===1)return Uint8Array.from(input);
 const out=new Uint8Array((w/ss)*(h/ss)*4),targetW=w/ss;
 for(let y=0;y<h/ss;y++)for(let x=0;x<targetW;x++){
  let a=0,r=0,g=0,b=0;
  for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++){
   const k=((y*ss+sy)*w+x*ss+sx)*4,alpha=input[k+3]!/255;
   a+=alpha;r+=input[k]!*alpha;g+=input[k+1]!*alpha;b+=input[k+2]!*alpha;
  }
  const k=(y*targetW+x)*4,n=ss*ss;
  out[k]=a?Math.round(r/a):0;out[k+1]=a?Math.round(g/a):0;out[k+2]=a?Math.round(b/a):0;
  out[k+3]=Math.round(a/n*255);
 }
 return out;
}
export class HeadlessRenderEngine{
 readonly width:number;readonly height:number;readonly fps:number;
 private readonly camera:CameraSettings;private readonly background:RenderBackground;
 private readonly quality:RenderQuality;private readonly maxFrames:number;
 constructor(private readonly options:HeadlessOptions){
  const {width,height}=options;this.width=width;this.height=height;this.fps=options.fps??30;
  this.maxFrames=options.maxFrames??200000;
  requireCondition(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&this.fps>0&&Number.isFinite(this.fps),'INVALID_HEADER','Invalid render dimensions or fps');
  const ss=options.quality?.supersampling??1;
  requireCondition(ss===1||ss===2||ss===4,'INVALID_HEADER','Supersampling must be 1, 2 or 4');
  requireCondition(['nearest','linear'].includes(options.quality?.sampling??'nearest'),'INVALID_HEADER','Invalid sampling mode');
  requireCondition(options.quality?.pngCompression===undefined||Number.isInteger(options.quality.pngCompression)&&
   options.quality.pngCompression>=0&&options.quality.pngCompression<=9,'INVALID_HEADER','Invalid PNG compression');
  budget(width*height*ss*ss<=8_388_608,'CPU renderer surface exceeds 8,388,608 pixels after supersampling');
  budget(width*height*ss*ss*24<=(options.maxBytes??256*1024*1024),'Render memory budget exceeded');
  budget(Number.isSafeInteger(this.maxFrames)&&this.maxFrames>0,'Invalid frame budget');
  this.camera=options.camera??{mode:'fit-scene',fit:'animation'};
  this.background=options.background??{mode:'transparent'};
  this.quality=options.quality??{};
  if(this.background.mode==='solid')parseRGB(this.background.color??'#000000');
  for(const page of options.ir.atlases.pages){
   const tex=options.textures.get(page.id);
   requireCondition(tex&&tex.width===page.width&&tex.height===page.height,'MISSING_TEXTURE_PAGE',`Missing or mismatched image for page ${page.id}`);
  }
 }
 private pose(request:FrameRequest):{instance:SkeletonInstance;packets:DrawPacket[]}{
  finite(request.timeSec,'frame time');requireCondition(request.timeSec>=0,'INVALID_TIMELINE','Negative frame time');
  const instance=new SkeletonInstance(this.options.ir);
  if(request.skinId!==undefined&&request.skinId!==null)instance.setSkin(request.skinId);
  const speed=request.playbackSpeed??1;finite(speed,'playbackSpeed');
  requireCondition(speed>0,'INVALID_TIMELINE','playbackSpeed must be positive');
  const actions=request.timeline??[];
  // Validate every serialized event, including events after this particular
  // frame; otherwise bad future actions would be silently accepted.
  for(const action of actions){
   requireCondition(Number.isFinite(action.atSec)&&action.atSec>=0&&Number.isSafeInteger(action.track)&&action.track>=0,
    'INVALID_TIMELINE','Invalid render timeline event timestamp/track');
   requireCondition(instance.clips.has(action.clipId),'ANIMATION_NOT_FOUND',`Unknown render timeline clip ${action.clipId}`);
   requireCondition(action.mixDurationSec===undefined||Number.isFinite(action.mixDurationSec)&&action.mixDurationSec>=0,
    'INVALID_TIMELINE','Invalid render transition duration');
  }
  if(actions.length){
   const player=new AnimationPlayer(instance);player.timeScale=speed;
   const ordered=[...actions].sort((a,b)=>a.atSec-b.atSec||a.track-b.track);
   let time=0;
   for(const a of ordered){
    finite(a.atSec,'timeline start');requireCondition(a.atSec>=0&&Number.isSafeInteger(a.track)&&a.track>=0,'INVALID_TIMELINE','Invalid timeline action');
    if(a.atSec>request.timeSec)break;
    if(a.atSec>time)player.advance(a.atSec-time);
    player.set(a.track,a.clipId,a.loop??true,a.mixDurationSec??0);
    time=a.atSec;
   }
   if(request.timeSec>time)player.advance(request.timeSec-time);else player.samplePose();
  }else if(request.clipId){
   instance.evaluate([{clipId:request.clipId,timeSec:request.timeSec*speed,loop:request.loop??false}]);
  }else instance.evaluate();
  return {instance,packets:prepareDrawPackets(instance)};
 }
 private bounds(packets:readonly DrawPacket[]):RenderBounds|null{
  if(this.camera.mode==='fit-selection'){
   requireCondition(!!this.camera.targetSlotId,'INVALID_HEADER','fit-selection requires targetSlotId');
   const selected=packets.filter(p=>p.slotId===this.camera.targetSlotId);
   requireCondition(selected.length>0,'INVALID_REFERENCE','Selected slot has no rendered attachment');
   return drawBounds(selected);
  }
  return drawBounds(packets);
 }
 private viewport(instance:SkeletonInstance,packets:readonly DrawPacket[],stable?:Viewport):Viewport{
  if(stable)return stable;
  const mode=this.camera.mode??'fit-scene';
  if(mode==='fixed'||mode==='follow'){
   const zoom=this.camera.scale??1,worldWidth=this.camera.worldWidth??50;
   requireCondition(zoom>0&&worldWidth>0&&Number.isFinite(zoom*worldWidth),'INVALID_HEADER','Invalid fixed/follow camera zoom or worldWidth');
   const w=worldWidth/zoom,h=w*this.height/this.width;
   let x=this.camera.x??0,y=this.camera.y??0;
   if(mode==='follow'){
    const id=this.camera.targetBoneId;
    requireCondition(id&&instance.activeBones.has(id)&&instance.world.has(id),'INVALID_REFERENCE','Follow camera target is missing/inactive');
    x=instance.world.get(id)!.x;y=instance.world.get(id)!.y;
   }
   x+=this.camera.offsetX??0;y+=this.camera.offsetY??0;
   return {left:x-w/2,bottom:y-h/2,width:w,height:h};
  }
  return fitRenderBounds(this.bounds(packets),this.width,this.height,this.camera);
 }
 async renderFrame(request:FrameRequest):Promise<RenderFrame>{
  const {instance,packets}=this.pose(request);
  const view=this.viewport(instance,packets,request.cameraViewport);
  const ss=this.quality.supersampling??1;
  const clear=this.background.mode==='solid'?parseRGB(this.background.color??'#000000'):[0,0,0,0] as [number,number,number,number];
  const sampling=this.quality.sampling??'nearest';
  const pixels=this.options.rasterBackend?
   await this.options.rasterBackend.render({
    packets,textures:this.options.textures,viewport:view,width:this.width*ss,height:this.height*ss,clear,sampling,
    ...(request.signal?{signal:request.signal}:{})
   }):rasterize(packets,this.options.textures,view,this.width*ss,this.height*ss,clear,{sampling});
  return {timeSec:request.timeSec,width:this.width,height:this.height,rgba:downsample(pixels,this.width*ss,this.height*ss,ss),viewport:view,bounds:this.bounds(packets),packetCount:packets.length};
 }
 async renderSequence(args:SequenceOptions):Promise<{frameCount:number;startSec:number;endSec:number}>{
  const fps=args.fps??this.fps,clip=this.options.ir.skeleton.animations.find(a=>a.id===args.clipId);
  let end=args.endSec;
  if(args.loopCount!==undefined){
   requireCondition(!!clip&&Number.isSafeInteger(args.loopCount)&&args.loopCount>0,'INVALID_TIMELINE','loopCount requires clip and positive integer');
   end=args.startSec+clip.durationSec*args.loopCount/(args.playbackSpeed??1);
  }
  const count=countScheduledFrames(args.startSec,end,fps,args.includeEnd??false,this.maxFrames);
  const check=()=>{if(args.signal?.aborted)throw new EngineError('OUTPUT_COMMIT_FAILED','Rendering cancelled');};
  const timestamp=(index:number)=>args.includeEnd&&index===count-1?end:args.startSec+index/fps;
  let stable:Viewport|undefined;
  const fit=this.camera.fit??'animation';
  if((this.camera.mode??'fit-scene').startsWith('fit-')&&fit!=='frame'){
   let envelope:RenderBounds|null=null;
   const n=fit==='start'?1:count;
   for(let i=0;i<n;i++){
    check();const pose=this.pose({...args,timeSec:timestamp(i)});
    envelope=joinBounds(envelope,this.bounds(pose.packets));
    args.onProgress?.({phase:'prepass',frame:i+1,totalFrames:n,timeSec:timestamp(i)});
   }
   stable=fitRenderBounds(envelope,this.width,this.height,this.camera);
  }
  for(let i=0;i<count;i++){
   check();const timeSec=timestamp(i);
   const frame=await this.renderFrame({...args,timeSec,...(stable?{cameraViewport:stable}:{})});
   check();await args.onFrame(frame,i,count);
   args.onProgress?.({phase:'rendering',frame:i+1,totalFrames:count,timeSec});
  }
  args.onProgress?.({phase:'completed',frame:count,totalFrames:count,timeSec:end});
  return {frameCount:count,startSec:args.startSec,endSec:end};
 }
}
