import test from 'node:test';import assert from 'node:assert/strict';
import {BinaryReader} from '../src/adapters/binary-reader.js';
import {inspectSpine41Header,probeSpineBinary,spine41Adapter} from '../src/adapters/spine41.js';
import {AdapterRegistry,syntheticAdapter} from '../src/adapters/registry.js';
import {EngineError} from '../src/errors.js';import {fixture} from './helpers.js';
function varint(x:number){const result:number[]=[];do{let v=x%128;x=Math.floor(x/128);if(x)v|=128;result.push(v);}while(x);return result;}
function str(s:string|null){if(s===null)return [0];const bytes=new TextEncoder().encode(s);return [...varint(bytes.length+1),...bytes];}
function float(v:number){const a=new Uint8Array(4);new DataView(a.buffer).setFloat32(0,v);return [...a];}
function binary(version='4.1.23',nonessential=false,tail:number[]=[]){return Uint8Array.from([1,2,3,4,5,6,7,8,...str(version),...float(0),...float(10),...float(20),...float(30),nonessential?1:0,...(nonessential?[...float(24),...str(null),...str(null)]:[]),...varint(2),...str('arm'),...str('head'),...varint(3),...tail]);}
test('unsigned varint, signed ZigZag, UTF-8/null/empty and float32',()=>{
 const raw=Uint8Array.from([...varint(300),...varint(9),...str(null),...str(''),...str('Привет'),...float(3.5)]);
 const r=new BinaryReader(raw);assert.equal(r.uvarint(),300);assert.equal(r.svarint(),-5);assert.equal(r.utf8(),null);assert.equal(r.utf8(),'');assert.equal(r.utf8(),'Привет');assert.equal(r.f32(),3.5);assert.equal(r.offset,raw.length);
});
test('header reads confirmed prefix without claiming complete body decode',()=>{
 const bytes=binary();const p=probeSpineBinary(bytes);assert.deepEqual(p,{family:'spine-binary',version:'4.1.23'});
 const h=inspectSpine41Header(bytes);assert.equal(h.boneCount,3);assert.equal(h.stringTable.length,2);assert.deepEqual(h.bounds,[0,10,20,30]);assert.equal(h.bodyOffset,h.inputLength);
});
test('incomplete 4.1 binary returns typed truncation; never a partial skeleton',()=>{
 const bytes=binary('4.1.23',false,[0,0]);
 assert.throws(()=>spine41Adapter.import({bytes,source:'self-authored.skel'}),e=>e instanceof EngineError&&['TRUNCATED_INPUT','INVALID_HEADER'].includes(e.code)&&e.details.offset!==undefined);
});
test('unsupported patches are not remapped; nonessential header is parsed',()=>{
 const reg=new AdapterRegistry();reg.register(spine41Adapter);
 assert.throws(()=>reg.import({bytes:binary('4.1.24'),source:'a'}),e=>e instanceof EngineError&&e.code==='UNSUPPORTED_VERSION');
 const metadata=inspectSpine41Header(binary('4.1.23',true));assert.equal(metadata.nonessential,true);assert.equal(metadata.fps,24);
});
test('malformed/corrupt varints, UTF8, overflow, short input and invalid bool rejected',()=>{
 assert.throws(()=>new BinaryReader(Uint8Array.from([128,128,128,128,128])).uvarint(),EngineError);
 assert.throws(()=>new BinaryReader(Uint8Array.from([255,255,255,255,16])).uvarint(),EngineError);
 assert.throws(()=>new BinaryReader(Uint8Array.from([3,0xff,0xff])).utf8(),EngineError);
 assert.throws(()=>new BinaryReader(Uint8Array.from([3,65])).utf8(),EngineError);
 const b=binary();assert.throws(()=>inspectSpine41Header(b.slice(0,-1)),EngineError);
 assert.equal(probeSpineBinary(Uint8Array.from([1,2,3,4,5])),null);
 const wrong=b.slice();const r=new BinaryReader(wrong);r.bytes(8);r.utf8();r.bytes(16);wrong[r.offset]=3;
 assert.throws(()=>inspectSpine41Header(wrong),EngineError);
});
test('synthetic adapter plugs into same registry and preserves complete normalized IR',()=>{
 const reg=new AdapterRegistry();reg.register(spine41Adapter);reg.register(syntheticAdapter);
 const data=Uint8Array.from(new TextEncoder().encode(JSON.stringify({kind:'clean-room-synthetic',version:'1.0.0',ir:fixture()})));
 const {ir,report}=reg.import({bytes:data,source:'fixture.cleanroom'});
 assert.equal(report.bytesConsumed,data.length);assert.equal(report.status,'verified-synthetic');assert.equal(ir.skeleton.bones[0]!.id,'root');
 const other=new AdapterRegistry();other.register(syntheticAdapter);
 const twin=other.import({bytes:data,source:'fixture.cleanroom'});
 assert.deepEqual(ir,twin.ir);
});
