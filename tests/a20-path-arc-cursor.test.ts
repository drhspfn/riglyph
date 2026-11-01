import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CubicWorldPath} from '../packages/runtime/src/runtime/path-geometry.js';

const points=new Float32Array([
 -20,0, 0,0, 30,0, 60,20, 90,30, 110,20
]);
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);

test('closed cubic sequential samples use forward-only arc table cursors over multiple wraps',()=>{
 const path=new CubicWorldPath(points,true,true,[75,155]);
 const distances=[12,12+10*path.total*(35/65),12+10*path.total];
 const sequence=path.sampleSequence(distances);
 assert.deepEqual(sequence[0],path.sample(distances[0]!));
 // A second sample advances the arc-table cursor; wrapping to a smaller
 // fractional position in the same Bézier retains that interval.
 assert.ok(distance(sequence[2]!,path.sample(distances[2]!))>0.05);
 assert.deepEqual(path.sampleSequence(distances),sequence);
 // Standalone samples are independent of earlier sequence traversals.
 const randomAccess=path.sample(distances[2]!);
 assert.deepEqual(path.sample(distances[2]!),randomAccess);
});

test('closed cubic negative spacings retain their traversal bracket without accumulated seek drift',()=>{
 const path=new CubicWorldPath(points,true,true,[75,155]);
 const distances=[-14,-22,-30];
 const first=path.sampleSequence(distances);
 assert.deepEqual(first[0],path.sample(-14));
 assert.ok(distance(first[1]!,path.sample(-22))>0.1);
 assert.ok(distance(first[2]!,path.sample(-30))>0.1);
 assert.deepEqual(path.sampleSequence(distances),first);
});

test('open random-access and constant-speed=false path sampling remain deterministic',()=>{
 for(const constantSpeed of [true,false]){
  const path=new CubicWorldPath(points,false,constantSpeed,[75,155]);
  const distances=[12,25,-10,120];
  const sequenced=path.sampleSequence(distances);
  for(const [i,d] of distances.entries()){
   assert.deepEqual(sequenced[i],path.sample(d!));
  }
 }
});
