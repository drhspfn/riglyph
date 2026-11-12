import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineError,validateIR,serializeIR,deserializeIR} from '@riglyph/core';
import {decodeSpine41,spine41Adapter} from '@riglyph/importer-spine-4.1';
import {authoredMinimalWire} from '../scripts/g7-authored-wire.mjs';

const uint=(n:number):number[]=>{const b:number[]=[];do{const v=n&127;n=Math.floor(n/128);b.push(n?v|128:v);}while(n);return b;};

// Self-authored wire data, not an editor export or bytes copied from a game.
function animatedWire(capacity:number){
 const bytes=Array.from(authoredMinimalWire().subarray(0,-1));
 const v=(n:number)=>bytes.push(...uint(n));
 const str=(s:string)=>{const b=Buffer.from(s);v(b.length+1);bytes.push(...b);};
 const f=(n:number)=>{const b=Buffer.alloc(4);b.writeFloatBE(n);bytes.push(...b);};
 v(2);str('color-and-rotation');v(capacity);
 const slotGroupsOffset=bytes.length;v(1);
 const slotIndexOffset=bytes.length;v(0);v(1);
 const typeOffset=bytes.length;bytes.push(1); // RGBA timeline
 v(2);v(0); // two keys, no Bezier curves
 const timeOffset=bytes.length;f(0);bytes.push(255,128,0,255);
 f(1);bytes.push(0,64,255,128,0); // second RGBA key, linear segment
 const rotation=()=>{v(1);v(0);v(1);bytes.push(0);v(1);v(0);f(2);f(30);};
 rotation(); // one bone timeline
 for(let i=0;i<6;i++)v(0); // IK, transform, path, attachment, draw order, event groups
 str('following-animation');v(1);v(0);rotation();
 for(let i=0;i<6;i++)v(0);
 return {bytes:Uint8Array.from(bytes),slotGroupsOffset,slotIndexOffset,typeOffset,timeOffset};
}

for(const capacity of [0,1,2,51,100_000])test(`animation capacity hint ${capacity} does not delimit encoded timelines`,()=>{
 const {bytes}=animatedWire(capacity),wire=decodeSpine41(bytes);
 assert.equal(wire.bytesConsumed,bytes.length);
 assert.equal(wire.animations[0]!.declaredTimelines,capacity);
 assert.deepEqual(wire.animations.map(a=>[a.name,a.timelines.length,a.duration]),[
  ['color-and-rotation',2,2],['following-animation',1,2]
 ]);
 assert.deepEqual(wire.animations[0]!.timelines[0]!.frames.map(f=>f.value),[
  [1,128/255,0,1],[0,64/255,1,128/255]
 ]);
 const {ir,report}=spine41Adapter.import({bytes,source:'authored.skel'});
 const baseline=spine41Adapter.import({bytes:animatedWire(2).bytes,source:'authored.skel'}).ir;
 validateIR(ir);
 assert.equal(report.bytesConsumed,bytes.length);
 assert.deepEqual(ir.skeleton.animations,baseline.skeleton.animations);
 assert.deepEqual(deserializeIR(serializeIR(ir)),ir);
});

const fails=(bytes:Uint8Array,code:string)=>assert.throws(()=>decodeSpine41(bytes),
 error=>error instanceof EngineError&&error.code===code);

test('capacity hints do not relax payload, reference, time or EOF validation',()=>{
 const {bytes,slotIndexOffset,typeOffset,timeOffset}=animatedWire(51);
 fails(bytes.subarray(0,-1),'TRUNCATED_INPUT');
 fails(Uint8Array.from([...bytes,0]),'INVALID_HEADER');
 const reference=bytes.slice();reference[slotIndexOffset]=1;fails(reference,'INVALID_REFERENCE');
 const type=bytes.slice();type[typeOffset]=255;fails(type,'INVALID_TIMELINE');
 const time=bytes.slice();new DataView(time.buffer).setFloat32(timeOffset,-1);fails(time,'INVALID_TIMELINE');
});

test('capacity hints and structural counts retain existing resource limits',()=>{
 fails(animatedWire(100_001).bytes,'LIMIT_EXCEEDED');
 const {bytes,slotGroupsOffset}=animatedWire(0);
 fails(Uint8Array.from([...bytes.subarray(0,slotGroupsOffset),...uint(100_001),...bytes.subarray(slotGroupsOffset+1)]),'LIMIT_EXCEEDED');
});
