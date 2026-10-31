import test from 'node:test';import assert from 'node:assert/strict';
import {BinaryReader} from '../src/adapters/binary-reader.js';
import {probeSpineBinary} from '../src/adapters/spine41.js';
import {EngineError} from '../src/errors.js';
import {fixture} from './helpers.js';
import {validateIR} from '../src/ir/validate.js';
test('reproducible truncated/mutated untrusted byte corpus never crashes header probing',()=>{
 let seed=0x9123abc;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed&255;};
 for(let i=0;i<1500;i++){
  const bytes=Uint8Array.from({length:i%63},next);const p=probeSpineBinary(bytes);
  assert.equal(p,null);
  const reader=new BinaryReader(bytes);try{reader.uvarint();}catch(e){assert.ok(e instanceof EngineError);}
 }
});
test('runtime rejects oversized arrays and source path traversal',()=>{
 const doc=fixture();doc.atlases.pages[0]!.path='C:/Windows/system.dll';assert.throws(()=>validateIR(doc),EngineError);
 doc.atlases.pages[0]!.path='textures/square.png';validateIR(doc);
 doc.capabilities.push('physics_9');assert.throws(()=>validateIR(doc),EngineError);
});
