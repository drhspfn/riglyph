import {EngineError,requireCondition} from '@riglyph/core';
import type {Animation,Timeline} from '@riglyph/core';
import {SkeletonInstance} from './state.js';
import type {Layer,EvaluatedEvent} from './state.js';

type QueueItem={id:string;loop:boolean;mixDuration:number};
type Playback={id:string;time:number;previous?:{id:string;time:number};mixDuration:number;mixTime:number;loop:boolean;queue:QueueItem[]};
export type RuntimePlaybackNotice={type:'start'|'transition'|'complete'|'loop'|'event';track:number;clipId:string;localTimeSec:number;cycle:number;previousClipId?:string;eventId?:string;value?:unknown};
/** Read-only track timeline diagnostics; no inferred reference playback parity. */
export type TrackDiagnostics={
 track:number;clipId:string;nominalDurationSec:number;elapsedTimelineSec:number;
 sampledClipTimeSec:number;loop:boolean;loopCount:number;timeScale:number;
 mix:{active:boolean;previousClipId:string|null;previousElapsedSec:number|null;durationSec:number;elapsedSec:number;alpha:number};
 queue:readonly {clipId:string;loop:boolean;mixDurationSec:number}[];
};
/** Playback is mutable. Definition is read-only and may be shared across many independent instances. */
export class AnimationPlayer{
 private readonly tracks=new Map<number,Playback>();
 private playbackRate=1;
 get timeScale(){return this.playbackRate;}
 set timeScale(value:number){requireCondition(Number.isFinite(value)&&value>=0,'INVALID_TIMELINE','timeScale must be finite and nonnegative');this.playbackRate=value;}
 readonly events:EvaluatedEvent[]=[];
 readonly notices:RuntimePlaybackNotice[]=[];
 constructor(readonly instance:SkeletonInstance){}
 set(track:number,clipId:string,loop=true,mixDuration=0):void{
  requireCondition(Number.isSafeInteger(track)&&track>=0,'INVALID_TIMELINE','Invalid track index');
  requireCondition(this.instance.clips.has(clipId),'ANIMATION_NOT_FOUND',`No animation ${clipId}`);
  requireCondition(mixDuration>=0&&Number.isFinite(mixDuration),'INVALID_TIMELINE','Invalid mix duration');
  const old=this.tracks.get(track);
  this.tracks.set(track,{id:clipId,time:0,...(old&&mixDuration>0?{previous:{id:old.id,time:old.time}}:{}),mixDuration,mixTime:0,loop,queue:[]});
  this.sample();
 }
 queue(track:number,clipId:string,loop=false,mixDuration=0):void{
  requireCondition(Number.isSafeInteger(track)&&track>=0,'INVALID_TIMELINE','Invalid track index');
  requireCondition(Number.isFinite(mixDuration)&&mixDuration>=0,'INVALID_TIMELINE','Invalid mix duration');
  requireCondition(this.instance.clips.has(clipId),'ANIMATION_NOT_FOUND',`No animation ${clipId}`);
  const state=this.tracks.get(track);if(!state){this.set(track,clipId,loop,mixDuration);return;}
  state.queue.push({id:clipId,loop,mixDuration});
 }
 clear(track?:number):void{if(track===undefined)this.tracks.clear();else this.tracks.delete(track);this.sample();}
 clearQueue(track=0):void{requireCondition(Number.isSafeInteger(track)&&track>=0,'INVALID_TIMELINE','Invalid track index');const t=this.tracks.get(track);if(t)t.queue=[];}
 setLoop(track:number,loop:boolean):void{const t=this.tracks.get(track);requireCondition(t,'ANIMATION_NOT_FOUND',`Track ${track} has no animation`);t.loop=loop;this.sample();}
 /** Recalculate the existing tracks without advancing time or dispatching events. */
 samplePose():SkeletonInstance{return this.sample();}
 seek(track:number,seconds:number,emitEvents=false):void{
  const state=this.tracks.get(track);requireCondition(state,'ANIMATION_NOT_FOUND',`Track ${track} has no animation`);
  requireCondition(Number.isFinite(seconds),'INVALID_TIMELINE','Invalid seek time');
  const previous=state.time;state.time=Math.max(0,seconds);
  if(emitEvents)this.dispatch(this.instance.clips.get(state.id)!,previous,state.time,state.loop,track);
  this.sample();
 }
 advance(deltaSec:number):void{
  requireCondition(Number.isFinite(deltaSec)&&deltaSec>=0,'INVALID_TIMELINE','Invalid delta time');
  const dt=deltaSec*this.timeScale;
  requireCondition(Number.isFinite(dt),'INVALID_TIMELINE','Scaled delta must be finite');
  this.events.length=0;this.notices.length=0;
  if(dt===0){this.sample();return;}
  for(const [index,track] of this.tracks){
   let current=track;let remaining=dt;let transitions=0;
   while(true){
    const clip=this.instance.clips.get(current.id)!;
    const previous=current.time;
    const finiteEnd=!current.loop&&current.queue.length>0;
    const step=finiteEnd?Math.min(remaining,Math.max(0,clip.durationSec-current.time)):remaining;
    current.time+=step;
    current.mixTime+=step;
    if(current.previous)current.previous.time+=step;
    if(step>0)this.dispatch(clip,previous,current.time,current.loop,index);
    if(clip.durationSec>0){
     const before=current.loop?Math.floor(previous/clip.durationSec):Math.min(1,Math.floor(previous/clip.durationSec));
     const after=current.loop?Math.floor(current.time/clip.durationSec):Math.min(1,Math.floor(current.time/clip.durationSec));
     const loops=after-before;
     requireCondition(loops<=1000,'LIMIT_EXCEEDED','Loop callback sweep too large');
     for(let n=0;n<loops;n++)this.notices.push({type:current.loop?'loop':'complete',track:index,clipId:clip.id,localTimeSec:clip.durationSec,cycle:before+n+1});
    }
    if(current.previous&&current.mixTime>=current.mixDuration)delete current.previous;
    remaining-=step;
    if(finiteEnd&&current.time>=clip.durationSec&&current.queue.length){
     requireCondition(++transitions<=1000,'LIMIT_EXCEEDED','Too many queued transitions in one advance');
     const next=current.queue.shift()!;
     const rest=current.queue;
     const oldId=current.id;
     this.set(index,next.id,next.loop,next.mixDuration);
     current=this.tracks.get(index)!;current.queue=rest;
     this.notices.push({type:'transition',track:index,clipId:next.id,previousClipId:oldId,localTimeSec:0,cycle:0});
     if(remaining===0&&this.instance.clips.get(next.id)!.durationSec>0)break;
     continue;
    }
    break;
   }
  }
  this.sample();
 }
 private dispatch(clip:Animation,from:number,to:number,loop:boolean,track:number):void{
  const duration=clip.durationSec;
  if(to<from)return;
  if(duration===0){if(from===0&&to>0)for(const t of clip.timelines)if(t.targetKind==='event')for(const k of t.keys)if(k.timeSec===0){this.events.push({eventId:t.targetId!,timeSec:0,value:k.value});this.notices.push({type:'event',track,clipId:clip.id,eventId:t.targetId!,localTimeSec:0,cycle:0,value:k.value});}return;}
  const firstLoop=loop?Math.floor(from/duration):0,lastLoop=loop?Math.floor(to/duration):0;
  requireCondition(lastLoop-firstLoop<=1000,'LIMIT_EXCEEDED','Event loop sweep is too large');
  const results:{event:EvaluatedEvent;absolute:number;seq:number}[]=[];let seq=0;
  for(let iteration=firstLoop;iteration<=lastLoop;iteration++){
   for(const t of clip.timelines){if(t.targetKind!=='event')continue;
    for(const key of t.keys){const absolute=iteration*duration+key.timeSec;
     if((absolute>from||(absolute===0&&from===0&&to>0))&&absolute<=to&&(!loop?absolute<=duration:true))results.push({event:{eventId:t.targetId!,timeSec:absolute,value:key.value},absolute,seq:seq++});
    }
   }
  }
  results.sort((a,b)=>a.absolute-b.absolute||a.seq-b.seq);
  for(const result of results){
   this.events.push(result.event);
   this.notices.push({type:'event',track,clipId:clip.id,eventId:result.event.eventId,localTimeSec:duration?result.absolute%duration:0,cycle:duration?Math.floor(result.absolute/duration):0,value:result.event.value});
  }
 }
 sample():SkeletonInstance{
  const layers:Layer[]=[];
  for(const [index,track] of [...this.tracks].sort((a,b)=>a[0]-b[0])){
   const progress=track.previous?Math.min(1,track.mixTime/Math.max(track.mixDuration,Number.EPSILON)):1;
   if(track.previous)layers.push({clipId:track.previous.id,timeSec:track.previous.time,loop:track.loop,alpha:1-progress});
   layers.push({clipId:track.id,timeSec:track.time,loop:track.loop,alpha:progress});
  }
  return this.instance.evaluate(layers);
 }
 /** Snapshot of all actual track queues and mix transitions for synchronized G2 tests.
  * This does not assert compatibility with an independent reference runtime. */
 diagnostics():TrackDiagnostics[]{
  return [...this.tracks].sort((a,b)=>a[0]-b[0]).map(([index,state])=>{
   const duration=this.instance.clips.get(state.id)!.durationSec;
   const elapsed=state.time;
   const progress=state.previous?Math.min(1,state.mixTime/Math.max(state.mixDuration,Number.EPSILON)):1;
   return {track:index,clipId:state.id,nominalDurationSec:duration,elapsedTimelineSec:elapsed,
    sampledClipTimeSec:duration===0?0:state.loop?elapsed%duration:Math.min(duration,elapsed),
    loop:state.loop,loopCount:state.loop&&duration>0?Math.floor(elapsed/duration):0,timeScale:this.timeScale,
    mix:{active:!!state.previous,previousClipId:state.previous?.id??null,
     previousElapsedSec:state.previous?.time??null,durationSec:state.mixDuration,elapsedSec:state.mixTime,alpha:progress},
    queue:state.queue.map(e=>({clipId:e.id,loop:e.loop,mixDurationSec:e.mixDuration}))};
  });
 }
 current(track=0):{clipId:string;timeSec:number;loop:boolean}|null{
  const s=this.tracks.get(track);return s?{clipId:s.id,timeSec:s.time,loop:s.loop}:null;
 }
}
