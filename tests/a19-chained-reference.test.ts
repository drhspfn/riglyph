import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SkeletonInstance} from '@riglyph/runtime';
import type {IRDocument,Transform,Constraint} from '@riglyph/core';
import {fixture} from './helpers.js';
const data=JSON.parse(readFileSync(new URL('../../tests/fixtures/a19-chained-complete.json',import.meta.url),'utf8'));
const affine=(m:{a:number;b:number;c:number;d:number;x:number;y:number})=>[m.a,m.c,m.b,m.d,m.x,m.y];
const delta=(a:number,b:number)=>((a-b+180)%360+360)%360-180;
for(const [variant,record] of Object.entries(data.variants) as [string,any][]){
 test(`A19 independent chained reference: ${variant} constraints`,()=>{
  const ir:IRDocument=fixture();
  ir.skeleton.bones=data.setup.bonesInOrder.map((b:any)=>({id:b.id,parentId:b.parentId,inheritance:'normal',skinRequired:false,setup:{x:b.x,y:b.y,rotationDeg:b.rotationDeg,scaleX:b.scaleX,scaleY:b.scaleY,shearXDeg:0,shearYDeg:0,length:0}}));
  ir.skeleton.constraints=data.transformConstraintsOrdered.filter((c:any)=>record.enabledConstraintIds.includes(c.id)).map((c:any)=>({id:c.id,kind:'transform',order:c.order,boneIds:c.boneIds,targetBoneId:c.targetBoneId,targetSlotId:null,activeInDefaultSkin:true,parameters:{...c}} as Constraint));
  const result=new SkeletonInstance(ir).evaluate();
  for(const id of ['target','driven','child']){
   const expected=record.expected[id];const got=affine(result.world.get(id)!);
   expected.worldAffine.forEach((v:number,i:number)=>assert.ok(Math.abs(got[i]!-v)<=1e-4,`${variant} ${id} world[${i}]: ${got[i]} vs ${v}`));
   const applied=result.applied.get(id)!;
   for(const k of data.appliedOrder as (keyof Transform)[]){
    const v=expected.reconstructedApplied[k],a=applied[k];
    if(typeof v==='number'&&typeof a==='number')assert.ok(Math.abs(k.toLowerCase().includes('deg')?delta(a,v):a-v)<=1e-4,`${variant} ${id} applied.${k}: ${a} vs ${v}`);
   }
  }
 });
}
