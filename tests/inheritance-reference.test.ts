import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inheritTransform,IDENTITY} from '@riglyph/core';
import type {Affine,Inheritance} from '@riglyph/core';
import {identity} from './helpers.js';

const reference=JSON.parse(readFileSync('tests/fixtures/inheritance-reference.json','utf8'));
const modes:Record<string,Inheritance>={normal:'normal',onlyTranslation:'only_translation',
 noRotationOrReflection:'no_rotation_or_reflection',noScale:'no_scale',noScaleOrReflection:'no_scale_or_reflection'};
test('independent selective inheritance: rotation, shear, reflection and collapsed parent axis',()=>{
 const world=new Map<string,Affine>();
 for(const bone of reference.bones){
  const m=inheritTransform(world.get(bone.parent)??IDENTITY,{...identity(),x:bone.x??0,y:bone.y??0,
   rotationDeg:bone.rotation??0,scaleX:bone.scaleX??1,scaleY:bone.scaleY??1,
   shearXDeg:bone.shearX??0,shearYDeg:bone.shearY??0},modes[bone.transform??'normal']!);
  world.set(bone.name,m);
  [m.a,m.c,m.b,m.d,m.x,m.y].forEach((v,i)=>assert.ok(Math.abs(v-reference.expected[bone.name][i])<1e-5,
   `${bone.name}[${i}]: ${v} vs ${reference.expected[bone.name][i]}`));
 }
});
