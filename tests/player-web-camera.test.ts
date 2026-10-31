import test from 'node:test';
import assert from 'node:assert/strict';
import {WebPlayer,fitBounds} from '@riglyph/player-web';
import type {CameraSettings} from '@riglyph/player-web';
import {SkeletonInstance} from '@riglyph/runtime';
import {prepareDrawPackets} from '@riglyph/renderer-webgl2';
import {fixture} from './helpers.js';

const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('fit padding preserves aspect ratio and contains wide, tall and square bounds',()=>{
 for(const bounds of [[0,0,400,100],[0,0,100,400],[0,0,100,100]] as [number,number,number,number][]){
  const base=fitBounds(bounds,600,400,1);
  near(base.width/base.height,1.5);
  assert.ok(base.width>=bounds[2]&&base.height>=bounds[3]);
  for(const padding of [1.1,1.25]){
   const view=fitBounds(bounds,600,400,padding);
   near(view.width,base.width*padding);near(view.height,base.height*padding);
  }
  near(fitBounds(bounds,600,400).width,base.width*1.25);
 }
 for(const padding of [0,-1,NaN,Infinity])assert.throws(()=>fitBounds([0,0,10,10],600,400,padding));
});
test('public camera settings validate padding, resize fit and preserve manual camera behavior',()=>{
 const packets=prepareDrawPackets(new SkeletonInstance(fixture()));
 const canvas={width:600,height:400,clientWidth:600,clientHeight:400};
 const player=Object.assign(Object.create(WebPlayer.prototype),{
  canvas,opts:{dpr:1},
  skeleton:{},renderer:{render(){}},packets:()=>packets,disposed:false,contextLost:false,
  viewport:{left:0,bottom:0,width:1,height:1},camera:{mode:'fit-scene'}
 }) as WebPlayer;
 const settings:CameraSettings={mode:'fit-scene',padding:1};
 player.setCamera(settings);const tight=player.view;
 player.setCamera({mode:'fit-scene'});near(player.view.width,tight.width*1.25);
 for(const padding of [0,-1,NaN,Infinity])assert.throws(()=>player.setCamera({mode:'fit-scene',padding}));
 player.setCamera(settings);canvas.clientWidth=400;player.resize();near(player.view.width/player.view.height,1);
 player.zoom(.8);assert.equal(player.status.camera.mode,'fixed');const zoomed=player.view;
 player.resize();assert.deepEqual(player.view,zoomed);
 player.setCamera(settings);player.pan(10,10);assert.equal(player.status.camera.mode,'fixed');
});
