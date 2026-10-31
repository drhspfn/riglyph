/** G8.1 read-only timing / mix diagnostics, not official reference parity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.js';
import {SkeletonInstance} from '../src/runtime/state.js';
import {AnimationPlayer} from '../src/runtime/player.js';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);
test('G8.1 per-track diagnostics expose actual mix, speed and pending queue without mutation',()=>{
 const ir=fixture();ir.skeleton.animations.push({...ir.skeleton.animations[0]!,id:'next',name:'next'});
 const player=new AnimationPlayer(new SkeletonInstance(ir));
 player.timeScale=1.25;player.set(0,'rotate90',true);player.advance(.4);
 player.set(0,'next',true,.6);player.queue(0,'rotate90',false,.2);
 player.advance(.24); // .3 timeline sec at 1.25x, half of .6 mix
 const before=player.current(0)!;const [info]=player.diagnostics();
 assert.equal(info!.track,0);assert.equal(info!.clipId,'next');
 near(info!.elapsedTimelineSec,.3);near(info!.sampledClipTimeSec,.3);
 near(info!.timeScale,1.25);near(info!.mix.alpha,.5);
 assert.deepEqual(info!.mix,{active:true,previousClipId:'rotate90',previousElapsedSec:.8,durationSec:.6,elapsedSec:.3,alpha:.5});
 assert.deepEqual(info!.queue,[{clipId:'rotate90',loop:false,mixDurationSec:.2}]);
 assert.deepEqual(player.current(0),before,'diagnostics must be read-only');
});
test('G8.1 loop counter is derived from unwrapped timeline seconds, no assumed 2x speed',()=>{
 const ir=fixture();const player=new AnimationPlayer(new SkeletonInstance(ir));
 player.set(0,'rotate90',true);player.advance(2.5);
 const [entry]=player.diagnostics();near(entry!.nominalDurationSec,1);near(entry!.sampledClipTimeSec,.5);
 assert.equal(entry!.loopCount,2);assert.equal(entry!.timeScale,1);
 player.clear();assert.deepEqual(player.diagnostics(),[]);
});
