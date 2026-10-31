/** Browser QA controls are a thin consumer of the public player-web package.
 * No independent animation evaluator or WebGL path is maintained here. */
import {deserializeIR} from '@riglyph/core';
import type {IRDocument} from '@riglyph/core';
import {createPlayer} from '@riglyph/player-web';
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const irfile=get<HTMLInputElement>('irfile'),textures=get<HTMLInputElement>('textures');
const animation=get<HTMLSelectElement>('animation'),skin=get<HTMLSelectElement>('skin'),time=get<HTMLInputElement>('time');
const diagnostic=get<HTMLElement>('diagnostic'),stats=get<HTMLElement>('stats');
const canvas=get<HTMLCanvasElement>('canvas'),overlay=get<HTMLCanvasElement>('overlay'),ctx=overlay.getContext('2d')!;
const selectionSlot=get<HTMLSelectElement>('selection-slot'),cameraInfo=get<HTMLElement>('camera-info');
const log=(message:string,error=false)=>{diagnostic.textContent=message;diagnostic.className=error?'error':'status';};
const player=await createPlayer({canvas,enableControls:true,onError:error=>log(`${error.code}: ${error.message}`,true)});
let ir:IRDocument|null=null;
const files=new Map<string,Blob>();
function fillSelect(target:HTMLSelectElement,values:{id:string;name:string}[],placeholder:string){
 target.replaceChildren(new Option(placeholder,''),...values.map(v=>new Option(v.name,v.id)));
}
async function load():Promise<void>{
 if(!ir)return;
 const pages=new Map<string,Blob>();for(const page of ir.atlases.pages){const file=files.get(page.path)||files.get(page.path.split('/').at(-1)!);if(!file){log(`Texture missing: ${page.path}`);return;}pages.set(page.id,file);}
 try{await player.load({ir,pages});
  player.setCamera({mode:'fit-scene'});time.value='0';time.max='1';
  log(`IR valid: ${ir.skeleton.bones.length} bones, ${ir.skeleton.slots.length} slots, ${ir.skeleton.animations.length} clips.\nCapabilities: ${ir.capabilities.join(', ')}`);
  render();
 }catch(error){log(`Render: ${String(error)}`,true);}
}
function setIR(value:IRDocument){ir=value;
 fillSelect(animation,value.skeleton.animations.map(a=>({id:a.id,name:`${a.name} (${a.durationSec.toFixed(3)}s)`})),'Setup pose');
 fillSelect(skin,value.skeleton.skins.map(s=>({id:s.id,name:s.id})),'Default');
 selectionSlot.replaceChildren(...value.skeleton.slots.map(s=>new Option(s.id,s.id)));
 void load();
}
irfile.addEventListener('change',async()=>{try{const file=irfile.files?.[0];if(file)setIR(deserializeIR(await file.text()));}catch(e){log(`Validation: ${String(e)}`,true);}});
textures.addEventListener('change',async()=>{for(const file of Array.from(textures.files??[]))files.set(file.name,file);await load();});
get<HTMLButtonElement>('demo').onclick=async()=>{try{
 const response=await fetch('/fixture/minimal.json');const value=deserializeIR(await response.text());
 const image=await fetch('/fixture/synthetic-example.png');files.set('synthetic-example.png',await image.blob());setIR(value);
}catch(error){log(String(error),true);}};
animation.onchange=()=>{try{player.pause();player.setAnimation(animation.value||null);time.value='0';time.max=String(Math.max(.001,player.animations().find(a=>a.id===animation.value)?.durationSec??1));render();}catch(e){log(String(e),true);}};
skin.onchange=()=>{try{player.setSkin(skin.value||null);render();}catch(e){log(String(e),true);}};
time.oninput=()=>{try{player.seek(Number(time.value));render();}catch(e){log(String(e),true);}};
get<HTMLButtonElement>('play').onclick=()=>{try{player.play(animation.value,{loop:get<HTMLInputElement>('loop').checked});render();}catch(e){log(String(e),true);}};
get<HTMLButtonElement>('pause').onclick=()=>player.pause();
get<HTMLButtonElement>('restart').onclick=()=>{player.seek(0);render();};
const speedSlider=get<HTMLInputElement>('speed'),speedNumber=get<HTMLInputElement>('speed-number');
const setSpeed=(rate:number)=>{try{player.setSpeed(rate);speedSlider.value=String(Math.min(3,rate));speedNumber.value=String(rate);get<HTMLElement>('speed-label').textContent=`${rate.toFixed(2)}×${rate===0?' (frozen)':''}`;render();}catch(e){log(String(e),true);}};
speedSlider.oninput=()=>setSpeed(Number(speedSlider.value));speedNumber.onchange=()=>setSpeed(Number(speedNumber.value));
for(const button of Array.from(get<HTMLElement>('speed-presets').querySelectorAll<HTMLButtonElement>('button[data-speed]')))button.onclick=()=>setSpeed(Number(button.dataset['speed']));
const mixInput=get<HTMLInputElement>('mix-duration'),trackInput=get<HTMLInputElement>('track-index');
const readTrack=()=>Number(trackInput.value);
const setMix=()=>{player.setDefaultMix(Number(mixInput.value));};
mixInput.onchange=()=>{try{setMix();render();}catch(e){log(String(e),true);}};
get<HTMLButtonElement>('mix-reset').onclick=()=>{mixInput.value='0';setMix();render();};
get<HTMLButtonElement>('crossfade').onclick=()=>{try{setMix();if(!animation.value)throw Error('Select an animation');player.transitionTo(animation.value,{track:readTrack(),loop:get<HTMLInputElement>('loop').checked});render();}catch(e){log(String(e),true);}};
get<HTMLButtonElement>('enqueue').onclick=()=>{try{setMix();if(!animation.value)throw Error('Select an animation');player.enqueue(animation.value,{track:readTrack(),loop:get<HTMLInputElement>('loop').checked});render();}catch(e){log(String(e),true);}};
get<HTMLButtonElement>('clear-queue').onclick=()=>{try{player.clearQueue(readTrack());render();}catch(e){log(String(e),true);}};
get<HTMLInputElement>('loop').onchange=()=>player.setLoop(get<HTMLInputElement>('loop').checked);
get<HTMLInputElement>('bones').onchange=()=>render();get<HTMLInputElement>('wire').onchange=()=>render();
get<HTMLButtonElement>('fit-scene').onclick=()=>{player.setCamera({mode:'fit-scene'});render();};
get<HTMLButtonElement>('fit-selection').onclick=()=>{player.setCamera({mode:'fit-selection',slotId:selectionSlot.value});render();};
get<HTMLButtonElement>('fixed-camera').onclick=()=>{player.setCamera({mode:'fixed'});render();};
selectionSlot.onchange=()=>{if(player.status.camera.mode==='fit-selection')player.setCamera({mode:'fit-selection',slotId:selectionSlot.value});render();};
get<HTMLButtonElement>('zoom-in').onclick=()=>{player.zoom(.8);render();};
get<HTMLButtonElement>('zoom-out').onclick=()=>{player.zoom(1.25);render();};
function xy(x:number,y:number):[number,number]{const view=player.view;return [(x-view.left)/view.width*overlay.width,overlay.height-(y-view.bottom)/view.height*overlay.height];}
function render():void{if(!player.instance||!player.document)return;
 const packets=player.packets(),view=player.view;
 overlay.width=canvas.width;overlay.height=canvas.height;ctx.clearRect(0,0,overlay.width,overlay.height);
 if(get<HTMLInputElement>('wire').checked){ctx.strokeStyle='#69e5fb';ctx.lineWidth=.7;
 for(const p of packets)for(let i=0;i<p.positions.length;i+=6){const a=xy(p.positions[i]!,p.positions[i+1]!),b=xy(p.positions[i+2]!,p.positions[i+3]!),c=xy(p.positions[i+4]!,p.positions[i+5]!);
  ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineTo(...c);ctx.closePath();ctx.stroke();}
 }
 if(get<HTMLInputElement>('bones').checked){ctx.strokeStyle='#ffcf62';ctx.lineWidth=2;
 for(const bone of player.document.skeleton.bones){const w=player.instance.world.get(bone.id);if(!w)continue;
  const start=xy(w.x,w.y),end=xy(w.x+w.a*bone.setup.length,w.y+w.b*bone.setup.length);
  ctx.beginPath();ctx.moveTo(...start);ctx.lineTo(...end);ctx.stroke();}
 }
 const status=player.status;
 get<HTMLElement>('timeval').textContent=`${status.timeSec.toFixed(3)} s`;
 const playback=player.diagnostics();
 stats.textContent=`${packets.length} draw packet(s) · ${packets.reduce((n,p)=>n+p.indices.length/3,0)} triangles · ${player.instance.world.size} bone matrices · ${player.document.atlases.pages.length} page(s) · clip ${playback.clipId??'setup'} · duration ${playback.nominalDurationSec.toFixed(3)}s · playback ${playback.playbackSpeed.toFixed(2)}x · loops ${playback.loopCount} · mix ${playback.mix.active?'active':'none'} · queued ${playback.queue.length}`;
 get<HTMLElement>('playback-inspector').textContent=`${playback.playbackModel} | ${playback.playbackSpeed.toFixed(2)}× | mix default ${playback.defaultMixDurationSec.toFixed(2)}s\n`+
  `nominal ${playback.nominalDurationSec.toFixed(3)} s | expected wall ${playback.playbackSpeed===0?'∞':(playback.nominalDurationSec/playback.playbackSpeed).toFixed(3)+' s'}\n`+
  `wall ${playback.elapsedWallClockSec.toFixed(3)} | timeline ${playback.elapsedTimelineSec.toFixed(3)} | loops ${playback.loopCount} | skipped wall ${playback.droppedWallClockSec.toFixed(3)}\n`+
  playback.tracks.map(t=>`track ${t.track}: ${t.clipId} @${t.sampledClipTimeSec.toFixed(3)}s [${t.loop?'loop':'once'}]\n`+
   `  mix: ${t.mix.previousClipId??'none'} → ${t.clipId} | alpha ${t.mix.alpha.toFixed(3)}, progress ${t.mix.elapsedSec.toFixed(3)}/${t.mix.durationSec.toFixed(3)}\n`+
   `  queue: ${t.queue.map(q=>q.clipId).join(', ')||'empty'}`).join('\n');
 cameraInfo.textContent=`${status.camera.mode} · center (${(view.left+view.width/2).toFixed(1)}, ${(view.bottom+view.height/2).toFixed(1)}) · ${Number(view.width/canvas.width).toPrecision(4)} world units/px`;
}
let lastStatus='';function update(){
 const status=player.status;
 if(player.instance){const key=[status.timeSec,status.camera.mode,player.view.left,player.view.bottom,canvas.width,canvas.height,player.diagnostics().tracks.map(t=>t.mix.elapsedSec).join(',')].join('|');
  if(key!==lastStatus){lastStatus=key;time.value=String(status.timeSec);render();}}
 requestAnimationFrame(update);
}
requestAnimationFrame(update);
