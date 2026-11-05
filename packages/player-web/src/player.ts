import {EngineError,requireCondition,validateIR,deserializeIR} from '@riglyph/core';
import type {IRDocument,AtlasPage} from '@riglyph/core';
import {SkeletonInstance,AnimationPlayer} from '@riglyph/runtime';
import type {TrackDiagnostics,RuntimePlaybackNotice} from '@riglyph/runtime';
import {WebGL2Renderer,prepareDrawPackets,drawBounds} from '@riglyph/renderer-webgl2';
import type {Viewport,DrawPacket,PacketOptions} from '@riglyph/renderer-webgl2';
export type {ClippingPolicy,GeometryDiagnostic,PacketOptions} from '@riglyph/renderer-webgl2';
import {fitBounds,panPixels,zoomAt} from './playground/camera.js';
import type {CameraMode} from './playground/camera.js';
export type CameraSettings={mode:CameraMode;viewport?:Viewport;slotId?:string;padding?:number};
export type AssetManifest={assetFormat:'universal-skeleton-asset';assetVersion:'1.0.0';ir:string;pages:{pageId:string;url:string}[];defaultAnimation?:string};
export type PlayerOptions={canvas:HTMLCanvasElement;assetUrl?:string;dpr?:number;autoResize?:boolean;enableControls?:boolean;allowCrossOrigin?:boolean;fetcher?:typeof fetch;onError?:(error:EngineError)=>void;geometry?:PacketOptions};
export type PlayerStatus={playing:boolean;animation:string|null;timeSec:number;loop:boolean;speed:number;camera:CameraSettings};
export type PlayerEventType='start'|'transition'|'complete'|'loop'|'event'|'error';
export type WebPlayerEvent=RuntimePlaybackNotice|{type:'error';track:-1;clipId:'';localTimeSec:0;cycle:0;error:EngineError};
export type PlayerListener=(event:WebPlayerEvent)=>void;
export type TransitionOptions={mixDurationSec?:number;loop?:boolean;track?:number};
/** Diagnostics are derived from the actual shared AnimationPlayer state. */
export type WebPlaybackDiagnostics={
 playbackModel:'animation-player-mixer';clipId:string|null;nominalDurationSec:number;
 sampledClipTimeSec:number;elapsedTimelineSec:number;elapsedWallClockSec:number;
 playbackSpeed:number;loop:boolean;loopCount:number;playing:boolean;
 tracks:readonly (TrackDiagnostics&{index:number})[];
 mix:TrackDiagnostics['mix'];queue:TrackDiagnostics['queue'];defaultMixDurationSec:number;droppedWallClockSec:number;
 camera:CameraSettings;viewport:Viewport;
};
export type FixedFrameCapture={
 format:'universal-skeleton-fixed-frame-v1';width:number;height:number;
 rgba:Uint8Array;pixelOrigin:'top-left';viewport:Viewport;playback:WebPlaybackDiagnostics;
 drawPackets:number;triangles:number;capturedAtISO?:string;
};
export type FixedFrameOptions={timeSec:number;clipId?:string;viewport:Viewport;capturedAtISO?:string};
export type PageSource=Blob|ImageBitmap|HTMLImageElement|HTMLCanvasElement;
export type SceneInput={ir:IRDocument;pages:ReadonlyMap<string,PageSource>|Readonly<Record<string,PageSource>>};
const validPath=(value:string)=>{
 let decoded:string;try{decoded=decodeURIComponent(value);}catch{throw new EngineError('INVALID_ATLAS','Invalid percent encoding in asset URL');}
 for(const candidate of [value,decoded]){
  requireCondition(candidate.length>0&&candidate.length<4096&&!candidate.includes('\\')&&!candidate.startsWith('/')&&!/^[a-z][a-z\d+.-]*:/i.test(candidate)&&!candidate.split('/').some(p=>!p||p==='.'||p==='..')&&!candidate.includes('?')&&!candidate.includes('#'),
   'INVALID_ATLAS',`Unsafe asset URL ${value}`);
 }
 return value;
};
function strictManifest(input:unknown):AssetManifest{
 requireCondition(!!input&&typeof input==='object'&&!Array.isArray(input),'INVALID_IR','Asset manifest must be an object');
 const v=input as Record<string,unknown>;
 requireCondition(v['assetFormat']==='universal-skeleton-asset'&&v['assetVersion']==='1.0.0','UNSUPPORTED_IR_SCHEMA','Unsupported asset manifest version');
 requireCondition(typeof v['ir']==='string'&&Array.isArray(v['pages'])&&v['pages'].length<=256,'INVALID_IR','Invalid asset manifest fields');
 validPath(v['ir']);
 const ids=new Set<string>();for(const p of v['pages'] as unknown[]){
  requireCondition(!!p&&typeof p==='object','INVALID_IR','Invalid page mapping');const page=p as Record<string,unknown>;
  requireCondition(typeof page['pageId']==='string'&&typeof page['url']==='string','INVALID_IR','Invalid page ID or URL');
  validPath(page['url']);requireCondition(!ids.has(page['pageId']),'INVALID_REFERENCE','Duplicate manifest page');ids.add(page['pageId']);
 }
 if(v['defaultAnimation']!==undefined)requireCondition(typeof v['defaultAnimation']==='string','INVALID_IR','Invalid default animation');
 return input as AssetManifest;
}
const pageSources=(input:SceneInput['pages'])=>input instanceof Map?input:new Map(Object.entries(input));
/** Browser player: version-neutral IR only; no binary format parser or Node imports. */
export class WebPlayer {
 readonly canvas:HTMLCanvasElement;
 private renderer:WebGL2Renderer;
 private ir:IRDocument|null=null;
 private skeleton:SkeletonInstance|null=null;
 private mixer:AnimationPlayer|null=null;
 private defaultMix=0;
 private droppedWallClockSec=0;
 private readonly listeners=new Map<PlayerEventType,Set<PlayerListener>>();
 private textureSources=new Map<string,Blob|ImageBitmap>();
 private animation:string|null=null;
 private time=0;
 private loopCount=0;
 private elapsedTimelineSec=0;
 private elapsedWallClockSec=0;
 private loop=true;
 private speed=1;
 private playing=false;
 private lastFrame=0;
 private raf:number|null=null;
 private camera:CameraSettings={mode:'fit-scene'};
 private viewport:Viewport={left:-1,bottom:-1,width:2,height:2};
 private disposed=false;
 private contextLost=false;
 private abort:AbortController|null=null;
 private resizeObserver:ResizeObserver|null=null;
 private operation=0;
 private mouse:{id:number;x:number;y:number}|null=null;
 private readonly opts:PlayerOptions;
 private readonly onLost=(event:Event)=>{event.preventDefault();this.contextLost=true;this.pause();this.notify(new EngineError('UNSUPPORTED_SEMANTIC_FEATURE','WebGL2 context lost; playback paused until restoration'));};
 private readonly onRestored=()=>{void this.restoreContext().catch(e=>this.notify(e));};
 private readonly onWheel=(event:WheelEvent)=>{
  if(!this.skeleton)return;event.preventDefault();const rect=this.canvas.getBoundingClientRect();
  this.zoom(Math.exp(Math.max(-800,Math.min(800,event.deltaY))*.0015),event.clientX-rect.left,event.clientY-rect.top);
 };
 private readonly onDown=(event:PointerEvent)=>{if(event.button===0&&this.skeleton){this.mouse={id:event.pointerId,x:event.clientX,y:event.clientY};this.canvas.setPointerCapture(event.pointerId);}};
 private readonly onMove=(event:PointerEvent)=>{if(this.mouse?.id!==event.pointerId)return;const rect=this.canvas.getBoundingClientRect();
  this.pan(event.clientX-this.mouse.x,event.clientY-this.mouse.y,rect.width,rect.height);this.mouse={id:event.pointerId,x:event.clientX,y:event.clientY};};
 private readonly onUp=()=>{this.mouse=null;};
 private readonly onWindowResize=()=>{if(!this.disposed)this.resize();};
 constructor(options:PlayerOptions){
  this.opts=options;this.canvas=options.canvas;
  requireCondition(options.canvas instanceof HTMLCanvasElement,'INVALID_IR','Player requires a canvas element');
  this.renderer=new WebGL2Renderer(this.canvas);
  this.canvas.addEventListener('webglcontextlost',this.onLost);
  this.canvas.addEventListener('webglcontextrestored',this.onRestored);
  if(options.autoResize!==false){
   if(typeof ResizeObserver!=='undefined'){this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.canvas);}
   else window.addEventListener('resize',this.onWindowResize);
  }
  if(options.enableControls){this.canvas.addEventListener('wheel',this.onWheel,{passive:false});this.canvas.addEventListener('pointerdown',this.onDown);
   this.canvas.addEventListener('pointermove',this.onMove);this.canvas.addEventListener('pointerup',this.onUp);this.canvas.addEventListener('pointercancel',this.onUp);}
  this.resize();
 }
 private assertAlive(){requireCondition(!this.disposed,'INVALID_REFERENCE','Player is disposed');}
 private notify(value:unknown){const error=value instanceof EngineError?value:new EngineError('INVALID_IR',value instanceof Error?value.message:String(value));this.opts.onError?.(error);this.emit({type:'error',track:-1,clipId:'',localTimeSec:0,cycle:0,error});}
 on(type:PlayerEventType,listener:PlayerListener):()=>void{this.assertAlive();const group=this.listeners.get(type)??new Set<PlayerListener>();group.add(listener);this.listeners.set(type,group);return ()=>{group.delete(listener);};}
 private emit(event:WebPlayerEvent):void{for(const listener of this.listeners.get(event.type)??[])try{listener(event);}catch(error){this.opts.onError?.(new EngineError('INVALID_TIMELINE',`Playback listener error: ${String(error)}`));}}
 private syncTrack0():void{const t=this.mixer?.diagnostics().find(t=>t.track===0);this.animation=t?.clipId??null;this.time=t?.elapsedTimelineSec??0;this.loop=t?.loop??this.loop;this.loopCount=t?.loopCount??0;this.elapsedTimelineSec=t?.elapsedTimelineSec??0;}
 /** Advances wall seconds exactly once through the shared runtime AnimationPlayer. */
 advance(wallDeltaSec:number):void{this.assertAlive();requireCondition(Number.isFinite(wallDeltaSec)&&wallDeltaSec>=0,'INVALID_TIMELINE','Invalid wall delta');if(!this.mixer||!this.playing)return;
  this.mixer.advance(wallDeltaSec);this.elapsedWallClockSec+=wallDeltaSec;this.syncTrack0();
  for(const notice of this.mixer.notices)this.emit(notice);
  const tracks=this.mixer.diagnostics();
  if(tracks.length>0&&tracks.every(t=>!t.loop&&t.nominalDurationSec<=t.elapsedTimelineSec&&t.queue.length===0))this.pause();
  this.render();
 }
 get document():IRDocument|null{return this.ir;}
 get instance():SkeletonInstance|null{return this.skeleton;}
 get view():Viewport{return {...this.viewport};}
 get status():PlayerStatus{return {playing:this.playing,animation:this.animation,timeSec:this.time,loop:this.loop,speed:this.speed,camera:{...this.camera}};}
 /** Actual mixer state. Rendering and diagnostics never advance or dispatch events. */
 diagnostics():WebPlaybackDiagnostics{
  const tracks=this.mixer?.diagnostics().map(t=>({...t,index:t.track}))??[];
  const primary=tracks.find(t=>t.track===0);
  const mix=primary?.mix??{active:false,previousClipId:null,previousElapsedSec:null,durationSec:0,elapsedSec:0,alpha:1};
  return {playbackModel:'animation-player-mixer',clipId:primary?.clipId??null,nominalDurationSec:primary?.nominalDurationSec??0,
   sampledClipTimeSec:primary?.sampledClipTimeSec??0,elapsedTimelineSec:primary?.elapsedTimelineSec??0,elapsedWallClockSec:this.elapsedWallClockSec,
   playbackSpeed:this.speed,loop:primary?.loop??this.loop,loopCount:primary?.loopCount??0,playing:this.playing,
   tracks,mix,queue:primary?.queue??[],defaultMixDurationSec:this.defaultMix,droppedWallClockSec:this.droppedWallClockSec,
   camera:{...this.camera},viewport:{...this.viewport}};
 }
 animations(){return this.ir?.skeleton.animations.map(({id,name,durationSec})=>({id,name,durationSec}))??[];}
 skins(){return this.ir?.skeleton.skins.map(s=>({id:s.id,isDefault:s.isDefault}))??[];}
 /** Public direct load. An invalid replacement never modifies the current scene.
  * New loads invalidate earlier in-flight loads (last initiated wins). */
 async load(input:SceneInput):Promise<void>{
  this.assertAlive();this.abort?.abort();this.abort=null;
  const generation=++this.operation;
  await this.installScene(input,generation);
 }
 private clearTextureSources(sources:Map<string,Blob|ImageBitmap>):void{
  for(const value of sources.values())if(value instanceof ImageBitmap)value.close();
  sources.clear();
 }
 /** Prepare every CPU/GPU resource before committing any player-visible state. */
 private async installScene(input:SceneInput,generation:number,defaultAnimation?:string):Promise<void>{
  this.assertAlive();requireCondition(!this.contextLost,'UNSUPPORTED_SEMANTIC_FEATURE','Cannot load while WebGL context is lost');
  validateIR(input.ir);
  const images=pageSources(input.pages),pageIds=new Set(input.ir.atlases.pages.map(p=>p.id));
  requireCondition(images.size===pageIds.size&&[...images.keys()].every(id=>pageIds.has(id)),'MISSING_TEXTURE_PAGE','Texture page mapping does not match IR');
  const newSkeleton=new SkeletonInstance(input.ir);
  const newMixer=new AnimationPlayer(newSkeleton);newMixer.timeScale=this.speed;
  const selected=defaultAnimation===undefined?null:(input.ir.skeleton.animations.find(c=>c.id===defaultAnimation||c.name===defaultAnimation)?.id??null);
  requireCondition(defaultAnimation===undefined||selected!==null,'ANIMATION_NOT_FOUND',`Unknown default animation: ${defaultAnimation}`);
  if(selected)newMixer.set(0,selected,this.loop);
  const prepared:{page:AtlasPage;bitmap:ImageBitmap;blob:boolean}[]=[];
  const nextSources=new Map<string,Blob|ImageBitmap>();
  let staged:WebGL2Renderer|null=null;
  let committed=false;
  try{
   let totalPixels=0;
   for(const page of input.ir.atlases.pages){
    const source=images.get(page.id);requireCondition(source,'MISSING_TEXTURE_PAGE',`Missing texture ${page.id}`);
    requireCondition(page.width>0&&page.height>0&&page.width<=8192&&page.height<=8192,'LIMIT_EXCEEDED',`Unsupported texture dimensions: ${page.id}`);
    totalPixels+=page.width*page.height;
    requireCondition(totalPixels<=64*1024*1024,'LIMIT_EXCEEDED','Scene textures exceed 256 MiB of decoded RGBA data');
    let bitmap:ImageBitmap;
    try{bitmap=source instanceof Blob?await createImageBitmap(source,{imageOrientation:'none',premultiplyAlpha:page.pma?'premultiply':'none',colorSpaceConversion:'none'}):await createImageBitmap(source);}
    catch(e){throw new EngineError('INVALID_ATLAS',`Texture decoding failed: ${page.id}: ${e instanceof Error?e.message:String(e)}`);}
    if(bitmap.width!==page.width||bitmap.height!==page.height){bitmap.close();throw new EngineError('INVALID_ATLAS',`Texture size mismatch: ${page.id}`);}
    prepared.push({page,bitmap,blob:source instanceof Blob});
    nextSources.set(page.id,source instanceof Blob?source:bitmap);
    requireCondition(!this.disposed&&generation===this.operation,'INVALID_REFERENCE','Scene load superseded or player disposed');
   }
   staged=new WebGL2Renderer(this.canvas);
   for(const entry of prepared)staged.setPage(entry.page,entry.bitmap);
   this.assertAlive();requireCondition(generation===this.operation,'INVALID_REFERENCE','Scene load superseded by a newer request');
   const old={renderer:this.renderer,ir:this.ir,skeleton:this.skeleton,mixer:this.mixer,animation:this.animation,time:this.time,
    loopCount:this.loopCount,elapsedTimelineSec:this.elapsedTimelineSec,elapsedWallClockSec:this.elapsedWallClockSec,
    camera:this.camera,viewport:this.viewport,sources:this.textureSources};
   // Switch briefly to verify drawing the complete replacement. On failure,
   // rollback both scene and renderer before exposing an error to the caller.
   this.renderer=staged;this.ir=input.ir;this.skeleton=newSkeleton;this.mixer=newMixer;
   this.animation=selected;this.time=0;this.loopCount=0;this.elapsedTimelineSec=0;this.elapsedWallClockSec=0;this.camera={mode:'fit-scene'};
   this.textureSources=nextSources;this.droppedWallClockSec=0;
   try{this.render();}
   catch(error){this.renderer=old.renderer;this.ir=old.ir;this.skeleton=old.skeleton;this.mixer=old.mixer;this.animation=old.animation;
    this.time=old.time;this.loopCount=old.loopCount;this.elapsedTimelineSec=old.elapsedTimelineSec;this.elapsedWallClockSec=old.elapsedWallClockSec;this.camera=old.camera;this.viewport=old.viewport;this.textureSources=old.sources;throw error;}
   committed=true;this.pause();old.renderer.dispose();this.clearTextureSources(old.sources);
  }finally{
   for(const entry of prepared)if(entry.blob)entry.bitmap.close();
   if(!committed){staged?.dispose();this.clearTextureSources(nextSources);}
  }
 }
 /** Static HTTP manifest -> validated IR -> all pages -> atomic scene commit.
  * Error policy: keep previously committed scene and playback; reject promise.
  * A newer load/loadUrl aborts and invalidates all earlier loads. */
 async loadUrl(assetUrl:string):Promise<void>{
  this.assertAlive();this.abort?.abort();const controller=new AbortController();this.abort=controller;
  const sequence=++this.operation;
  const base=new URL(assetUrl,document.baseURI);
  requireCondition(['http:','https:'].includes(base.protocol),'INVALID_ATLAS','Only HTTP(S) asset manifests are allowed');
  const fetcher=this.opts.fetcher??fetch;
  const ensureActive=()=>requireCondition(!controller.signal.aborted&&!this.disposed&&sequence===this.operation,'INVALID_REFERENCE','Player asset loading superseded, disposed or aborted');
  const fetchAsset=async(url:URL,max:number)=>{
   ensureActive();
   if(!this.opts.allowCrossOrigin)requireCondition(url.origin===base.origin,'INVALID_ATLAS','Cross-origin URL requires allowCrossOrigin=true');
   let response:Response;
   try{response=await fetcher(url.href,{signal:controller.signal,mode:'cors',credentials:'same-origin'});}
   catch(e){ensureActive();throw new EngineError('MISSING_TEXTURE_PAGE',`Asset request failed: ${e instanceof Error?e.message:String(e)}`);}
   ensureActive();requireCondition(response.ok,'MISSING_TEXTURE_PAGE',`Asset request failed with HTTP ${response.status}`);
   const size=Number(response.headers.get('content-length'));
   if(Number.isFinite(size)&&size>0)requireCondition(size<=max,'LIMIT_EXCEEDED',`Asset exceeds ${max} bytes`);
   // Bounded streaming: don't allocate a malicious unbounded response before checking its length.
   if(response.body){
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    try{
     while(true){ensureActive();const part=await reader.read();if(part.done)break;
      length+=part.value.byteLength;requireCondition(length<=max,'LIMIT_EXCEEDED',`Asset exceeds ${max} bytes`);
      chunks.push(part.value);
     }
    }finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    return bytes;
   }
   const bytes=new Uint8Array(await response.arrayBuffer());ensureActive();
   requireCondition(bytes.length<=max,'LIMIT_EXCEEDED',`Asset exceeds ${max} bytes`);
   return bytes;
  };
  const text=(bytes:Uint8Array)=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new EngineError('INVALID_UTF8','Invalid asset UTF-8');}};
  try{
   let raw:unknown;try{raw=JSON.parse(text(await fetchAsset(base,1024*1024)));}catch(e){if(e instanceof EngineError)throw e;throw new EngineError('INVALID_IR','Malformed asset manifest JSON');}
   const manifest=strictManifest(raw);
   const ir=deserializeIR(text(await fetchAsset(new URL(manifest.ir,base),64*1024*1024)));
   requireCondition(manifest.pages.length===ir.atlases.pages.length,'MISSING_TEXTURE_PAGE','Manifest pages differ from IR');
   const blobs=new Map<string,Blob>(),expected=new Set(ir.atlases.pages.map(p=>p.id));
   for(const p of manifest.pages){requireCondition(expected.has(p.pageId)&&!blobs.has(p.pageId),'MISSING_TEXTURE_PAGE',`Unknown or duplicate page ${p.pageId}`);
    blobs.set(p.pageId,new Blob([new Uint8Array(await fetchAsset(new URL(p.url,base),64*1024*1024))],{type:'image/png'}));
   }
   ensureActive();
   await this.installScene({ir,pages:blobs},sequence,manifest.defaultAnimation);
  }catch(e){
   if(controller.signal.aborted||sequence!==this.operation)throw new EngineError('INVALID_REFERENCE','Player asset loading aborted or superseded');
   throw e;
  }finally{if(this.abort===controller)this.abort=null;}
 }
 private resolveAnimation(name:string):string{const clip=this.ir?.skeleton.animations.find(c=>c.id===name||c.name===name);if(!clip)throw new EngineError('ANIMATION_NOT_FOUND',`Unknown animation: ${name}`);return clip.id;}
 play(name?:string,options:{loop?:boolean}={}):void{
  this.assertAlive();requireCondition(this.mixer,'INVALID_IR','No IR loaded');
  const id=name===undefined?this.animation:this.resolveAnimation(name);
  requireCondition(id,'ANIMATION_NOT_FOUND','Select an animation to play');
  const loop=options.loop??this.loop;
  if(!this.mixer.current(0)||this.mixer.current(0)!.clipId!==id){this.mixer.set(0,id,loop);this.elapsedWallClockSec=0;this.emit({type:'start',track:0,clipId:id,localTimeSec:0,cycle:0});}
  else this.mixer.setLoop(0,loop);
  this.syncTrack0();this.playing=true;this.lastFrame=0;this.startLoop();
 }
 pause():void{this.playing=false;if(this.raf!==null)cancelAnimationFrame(this.raf);this.raf=null;this.lastFrame=0;}
 seek(timeSec:number):void{this.assertAlive();requireCondition(Number.isFinite(timeSec)&&timeSec>=0,'INVALID_TIMELINE','Invalid seek time');
  if(!this.mixer?.current(0)){this.time=timeSec;this.render();return;}this.mixer.seek(0,timeSec);this.syncTrack0();this.elapsedWallClockSec=0;this.render();}
 setLoop(loop:boolean){this.assertAlive();this.loop=loop;if(this.mixer?.current(0))this.mixer.setLoop(0,loop);this.syncTrack0();}
 setSpeed(speed:number){this.assertAlive();requireCondition(Number.isFinite(speed)&&speed>=0&&speed<=100,'INVALID_TIMELINE','Playback speed must be 0..100');this.speed=speed;if(this.mixer)this.mixer.timeScale=speed;}
 setDefaultMix(durationSec:number):void{this.assertAlive();requireCondition(Number.isFinite(durationSec)&&durationSec>=0,'INVALID_TIMELINE','Invalid default mix duration');this.defaultMix=durationSec;}
 transitionTo(name:string,options:TransitionOptions={}):void{this.assertAlive();requireCondition(this.mixer,'INVALID_IR','No IR loaded');
  const id=this.resolveAnimation(name),track=options.track??0,duration=options.mixDurationSec??this.defaultMix;
  requireCondition(Number.isSafeInteger(track)&&track>=0,'INVALID_TIMELINE','Invalid track');
  requireCondition(Number.isFinite(duration)&&duration>=0,'INVALID_TIMELINE','Invalid mix duration');
  const previous=this.mixer.current(track);this.mixer.set(track,id,options.loop??this.loop,duration);
  this.syncTrack0();this.emit({type:previous?'transition':'start',track,clipId:id,...(previous?{previousClipId:previous.clipId}:{}),localTimeSec:0,cycle:0});this.render();
 }
 enqueue(name:string,options:TransitionOptions={}):void{this.assertAlive();requireCondition(this.mixer,'INVALID_IR','No IR loaded');
  const id=this.resolveAnimation(name),track=options.track??0,duration=options.mixDurationSec??this.defaultMix;
  requireCondition(Number.isSafeInteger(track)&&track>=0&&Number.isFinite(duration)&&duration>=0,'INVALID_TIMELINE','Invalid queue options');
  const current=this.mixer.current(track);this.mixer.queue(track,id,options.loop??false,duration);
  if(!current)this.emit({type:'start',track,clipId:id,localTimeSec:0,cycle:0});this.syncTrack0();this.render();
 }
 clearQueue(track=0):void{this.assertAlive();this.mixer?.clearQueue(track);}
 clearTrack(track=0):void{this.assertAlive();this.mixer?.clear(track);this.syncTrack0();this.render();}
 setSkin(id:string|null):void{this.assertAlive();requireCondition(this.skeleton,'INVALID_IR','No skeleton loaded');this.skeleton.setSkin(id);this.mixer?.samplePose();this.render();}
 setAnimation(name:string|null):void{this.assertAlive();if(name===null){this.mixer?.clear(0);this.pause();}else{
  requireCondition(this.mixer,'INVALID_IR','No scene loaded');const id=this.resolveAnimation(name);this.mixer.set(0,id,this.loop);this.elapsedWallClockSec=0;
 }this.syncTrack0();this.render();}
 setCamera(settings:CameraSettings):void{this.assertAlive();requireCondition(['fit-scene','fit-selection','fixed'].includes(settings.mode),'INVALID_TOPOLOGY','Unknown camera mode');
  if(settings.padding!==undefined)requireCondition(Number.isFinite(settings.padding)&&settings.padding>0,'INVALID_TOPOLOGY','Invalid camera padding');
  if(settings.mode==='fixed'&&settings.viewport){const v=settings.viewport;requireCondition([v.left,v.bottom,v.width,v.height].every(Number.isFinite)&&v.width>0&&v.height>0,'INVALID_TOPOLOGY','Invalid viewport');this.viewport={...v};}
  this.camera={...settings};this.render();
 }
 pan(dx:number,dy:number,width=this.canvas.clientWidth,height=this.canvas.clientHeight){this.assertAlive();requireCondition(width>0&&height>0,'INVALID_TOPOLOGY','Invalid pan size');
  this.viewport=panPixels(this.viewport,dx,dy,width,height);this.camera={mode:'fixed'};this.render();}
 zoom(factor:number,x=this.canvas.clientWidth/2,y=this.canvas.clientHeight/2){this.assertAlive();
  this.viewport=zoomAt(this.viewport,factor,x,y,this.canvas.clientWidth||this.canvas.width,this.canvas.clientHeight||this.canvas.height);this.camera={mode:'fixed'};this.render();}
 resize():void{this.assertAlive();const dpr=this.opts.dpr??(window.devicePixelRatio||1);requireCondition(Number.isFinite(dpr)&&dpr>0&&dpr<=8,'INVALID_TOPOLOGY','Invalid DPR');
  const width=this.canvas.clientWidth||this.canvas.width||1,height=this.canvas.clientHeight||this.canvas.height||1;
  const w=Math.min(8192,Math.max(1,Math.round(width*dpr))),h=Math.min(8192,Math.max(1,Math.round(height*dpr)));
  if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
  this.render();
 }
 packets():DrawPacket[]{if(!this.skeleton)return [];return prepareDrawPackets(this.skeleton,{...this.opts.geometry,
  ...(this.animation?{clipId:this.animation}:{}),timeSec:this.status.timeSec});}
 render():void{if(this.disposed||this.contextLost||!this.skeleton)return;
  const packets=this.packets();if(this.camera.mode!=='fixed'){
   const active=this.camera.mode==='fit-selection'?packets.filter(p=>p.slotId===this.camera.slotId):packets;
   const bounds=drawBounds(active);if(bounds)this.viewport=fitBounds(bounds,this.canvas.width,this.canvas.height,this.camera.mode==='fit-scene'?this.camera.padding:undefined);
  }
  this.renderer.render(packets,this.viewport);
 }
 /** Render a frame at an explicit timeline time and fixed camera, then read RGBA8
  * in top-left order. Previous playback state/camera are restored even on error.
  * capturedAtISO is supplied by the verifier, never automatically inferred. */
 captureFixedFrame(options:FixedFrameOptions):FixedFrameCapture{
  this.assertAlive();requireCondition(this.skeleton&&this.ir,'INVALID_IR','No scene loaded');
  requireCondition(!this.contextLost,'UNSUPPORTED_SEMANTIC_FEATURE','WebGL context unavailable');
  requireCondition(Number.isFinite(options.timeSec)&&options.timeSec>=0,'INVALID_TIMELINE','Invalid capture time');
  const viewport=options.viewport;
  requireCondition([viewport.left,viewport.bottom,viewport.width,viewport.height].every(Number.isFinite)&&
   viewport.width>0&&viewport.height>0,'INVALID_TOPOLOGY','Invalid fixed capture viewport');
  if(options.capturedAtISO!==undefined)requireCondition(!Number.isNaN(Date.parse(options.capturedAtISO)),
   'INVALID_TIMELINE','Invalid capture wall-clock stamp');
  // Evaluate on a disposable independent instance. Live tracks, callbacks, queues,
  // transitions, speed, scene pose and camera are never modified by capture.
  const isolated=new SkeletonInstance(this.ir);
  isolated.setSkin(this.skeleton.skinId);
  const isolatedMixer=new AnimationPlayer(isolated);
  const clip=options.clipId===undefined?this.animation:this.resolveAnimation(options.clipId);
  if(clip){isolatedMixer.set(0,clip,this.loop);isolatedMixer.seek(0,options.timeSec);}
  const packets=prepareDrawPackets(isolated,{...this.opts.geometry,...(clip?{clipId:clip}:{}),timeSec:options.timeSec});
  try{
   this.renderer.render(packets,viewport);
   const gl=this.canvas.getContext('webgl2');requireCondition(gl,'UNSUPPORTED_SEMANTIC_FEATURE','WebGL2 unavailable for capture');
   const width=this.canvas.width,height=this.canvas.height;
   requireCondition(width>0&&height>0&&width*height<=8_388_608,'LIMIT_EXCEEDED','Capture dimensions exceeded');
   const bottomLeft=new Uint8Array(width*height*4),rgba=new Uint8Array(bottomLeft.length);
   gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bottomLeft);
   requireCondition(gl.getError()===gl.NO_ERROR,'UNSUPPORTED_SEMANTIC_FEATURE','WebGL readPixels failed');
   for(let y=0;y<height;y++)rgba.set(bottomLeft.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
   const diagnostics=this.diagnostics(),state=isolatedMixer.diagnostics()[0];
   const capturePlayback:WebPlaybackDiagnostics={...diagnostics,
    clipId:state?.clipId??null,nominalDurationSec:state?.nominalDurationSec??0,
    sampledClipTimeSec:state?.sampledClipTimeSec??0,elapsedTimelineSec:options.timeSec,
    loopCount:state?.loopCount??0,tracks:state?[{...state,index:0}]:[],
    mix:state?.mix??{active:false,previousClipId:null,previousElapsedSec:null,durationSec:0,elapsedSec:0,alpha:1},queue:[],
    camera:{mode:'fixed',viewport:{...viewport}},viewport:{...viewport},playing:false};
   return {format:'universal-skeleton-fixed-frame-v1',width,height,rgba,pixelOrigin:'top-left',viewport:{...viewport},
    playback:capturePlayback,drawPackets:packets.length,triangles:packets.reduce((n,p)=>n+p.indices.length/3,0),
    ...(options.capturedAtISO?{capturedAtISO:options.capturedAtISO}:{})};
  }finally{this.render();}
 }
 private startLoop(){if(this.raf!==null||!this.playing)return;
  this.raf=requestAnimationFrame(timestamp=>{this.raf=null;if(this.disposed||!this.playing)return;
   try{
    const raw=this.lastFrame?Math.max(0,(timestamp-this.lastFrame)/1000):0;this.lastFrame=timestamp;
    // Background tabs and very long frames freeze. Never silently cap to 0.2 s.
    if(document.hidden||raw>0.25)this.droppedWallClockSec+=raw;
    else this.advance(raw);
    this.startLoop();
   }catch(error){this.pause();this.notify(error);}
  });
 }
 private async restoreContext():Promise<void>{
  if(this.disposed)return;
  this.contextLost=false;
  let staged:WebGL2Renderer|null=null;
  try{
   staged=new WebGL2Renderer(this.canvas);
   if(this.ir){for(const page of this.ir.atlases.pages){
    const source=this.textureSources.get(page.id);
    requireCondition(source,'MISSING_TEXTURE_PAGE',`Context restored but texture not cached: ${page.id}`);
    let image:ImageBitmap;
    try{image=source instanceof Blob?await createImageBitmap(source,{imageOrientation:'none',premultiplyAlpha:page.pma?'premultiply':'none',colorSpaceConversion:'none'}):await createImageBitmap(source);}
    catch(e){throw new EngineError('INVALID_ATLAS',`Context restoration texture failed: ${page.id}: ${e instanceof Error?e.message:String(e)}`);}
    try{staged.setPage(page,image);}finally{image.close();}
   }}
   if(this.disposed){staged.dispose();return;}
   const old=this.renderer;this.renderer=staged;staged=null;old.dispose();this.render();
  }catch(e){staged?.dispose();this.contextLost=true;throw e;}
 }
 dispose():void{
  if(this.disposed)return;this.pause();this.disposed=true;this.abort?.abort();this.abort=null;this.resizeObserver?.disconnect();window.removeEventListener('resize',this.onWindowResize);
  this.canvas.removeEventListener('webglcontextlost',this.onLost);this.canvas.removeEventListener('webglcontextrestored',this.onRestored);
  this.canvas.removeEventListener('wheel',this.onWheel);this.canvas.removeEventListener('pointerdown',this.onDown);this.canvas.removeEventListener('pointermove',this.onMove);this.canvas.removeEventListener('pointerup',this.onUp);this.canvas.removeEventListener('pointercancel',this.onUp);
  this.renderer.dispose();this.ir=null;this.skeleton=null;this.mixer=null;this.listeners.clear();this.clearTextureSources(this.textureSources);
 }
}
export async function createPlayer(options:PlayerOptions):Promise<WebPlayer>{
 const player=new WebPlayer(options);
 try{if(options.assetUrl)await player.loadUrl(options.assetUrl);return player;}
 catch(error){player.dispose();throw error;}
}
