import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addMesh,addBone,addSlot} from './helpers.js';
import {validateIR,inspectIR,serializeIR,deserializeIR} from '../src/ir/validate.js';
import type {IRDocument,Vertex} from '../src/ir/types.js';
function fails(ir:IRDocument,needle:string){const issues=inspectIR(ir);assert.ok(issues.some(i=>i.reason.includes(needle)),JSON.stringify(issues));}
test('handoff minimal synthetic IR validates and roundtrips',()=>{
 const x=fixture();validateIR(x);const json=serializeIR(x);assert.deepEqual(deserializeIR(json),x);
 assert.equal(serializeIR(deserializeIR(json)),json);
});
test('structural validation rejects missing mandatory fields and nonfinite numbers',()=>{
 const x=fixture();delete (x.skeleton.bones[0]!.setup as Partial<typeof x.skeleton.bones[0]['setup']>).x;
 assert.ok(inspectIR(x).length>0);
 const y=fixture();y.skeleton.bones[0]!.setup.x=NaN;assert.ok(inspectIR(y).some(i=>i.reason.includes('Expected number')));
});
test('unique scoped IDs and parent graph checked',()=>{
 const x=fixture();addBone(x,'root');fails(x,'Duplicate ID');
 const y=fixture();addBone(y,'child','root');y.skeleton.bones[0]!.parentId='child';fails(y,'Parent must precede child');
 const z=fixture();addBone(z,'child','unknown');fails(z,'Unknown parent');
});
test('slot references, draw-order permutation and texture path traversal are invalid',()=>{
 const x=fixture();addSlot(x,'slot1');x.skeleton.slots[1]!.drawIndex=0;fails(x,'Invalid draw order');
 const y=fixture();y.skeleton.slots[0]!.boneId='unknown';fails(y,'Unknown owner bone');
 const z=fixture();z.atlases.pages[0]!.path='../escape.png';fails(z,'Unsafe texture');
});
test('mesh topology and UV count validated',()=>{
 const x=fixture();addMesh(x,'m',[{position:[0,0],influences:[]},{position:[2,0],influences:[]},{position:[0,2],influences:[]}],[0,1,3]);
 fails(x,'Triangle outside mesh');
 const y=fixture();addMesh(y,'m',[{position:[0,0],influences:[]},{position:[2,0],influences:[]},{position:[0,2],influences:[]}],[0,1,2],[0,0]);fails(y,'UV count mismatch');
});
test('linked mesh missing target and cycle rejected',()=>{
 const x=fixture();x.capabilities.push('linked_mesh');x.skeleton.attachments.push({id:'link',name:'link',kind:'linked_mesh',color:[1,1,1,1],parentMeshId:'bad',deformTimelineOwnerId:'link',regionId:'reg0',inheritDeform:true,sequence:null});fails(x,'Missing linked parent');
 const y=fixture();y.capabilities.push('linked_mesh');for(const [a,b] of [['a','b'],['b','a']])y.skeleton.attachments.push({id:a!,name:a!,kind:'linked_mesh',color:[1,1,1,1],parentMeshId:b!,deformTimelineOwnerId:a!,regionId:'reg0',inheritDeform:true,sequence:null});fails(y,'Linked mesh cycle');
});
test('weighted influence invalid bone, missing capability and vertex variant',()=>{
 const vertices:Vertex[]=[{position:null,influences:[{boneId:'unknown',x:0,y:0,weight:1}]},{position:[1,0],influences:[]},{position:[0,1],influences:[]}];
 const x=fixture();addMesh(x,'mesh',vertices,[0,1,2]);fails(x,'Unknown influence bone');
 const y=fixture();addMesh(y,'mesh',vertices.map(v=>v.position===null?{position:[1,2],influences:v.influences}:v),[0,1,2]);fails(y,'Exactly one of local position');
});
test('invalid timeline curves and key ordering rejected',()=>{
 const x=fixture();x.skeleton.animations[0]!.timelines[0]!.keys[1]!.timeSec=-1;assert.ok(inspectIR(x).length>0);
 const y=fixture();const curve=y.skeleton.animations[0]!.timelines[0]!.keys[0]!.interpolation;curve.kind='cubic_bezier';curve.bezierByChannel=[[Number.POSITIVE_INFINITY,0,.9,1]];fails(y,'Expected number');
});
test('deform basis and dense vector size validated',()=>{
 const x=fixture();addMesh(x,'m',[{position:[0,0],influences:[]},{position:[1,0],influences:[]},{position:[0,1],influences:[]}],[0,1,2]);
 x.skeleton.animations[0]!.timelines.push({targetKind:'attachment',targetId:'m',property:'deform',deformBasis:'vertex_delta',keys:[{timeSec:0,value:[1,2],interpolation:{kind:'stepped'}}]});fails(x,'Deform length must be 6');
 x.skeleton.animations[0]!.timelines.at(-1)!.deformBasis='influence_delta';fails(x,'Deform basis mismatch');
});
test('semantic validator rejects malformed keyframe payloads before playback',()=>{
 const badBone=fixture();badBone.skeleton.animations[0]!.timelines[0]!.keys[0]!.value='90deg';fails(badBone,'Invalid numeric bone timeline value');
 const badSlot=fixture();badSlot.skeleton.animations[0]!.timelines=[{targetKind:'slot',targetId:'slot0',property:'light',deformBasis:'none',keys:[{timeSec:0,value:[1,2,3],interpolation:{kind:'stepped'}}]}];fails(badSlot,'Invalid tint timeline value');
 const badOrder=fixture();badOrder.skeleton.animations[0]!.timelines=[{targetKind:'skeleton',targetId:null,property:'drawOrder',deformBasis:'none',keys:[{timeSec:0,value:['bogus'],interpolation:{kind:'stepped'}}]}];fails(badOrder,'Invalid draw-order timeline value');
 const malformed=fixture();malformed.skeleton.animations[0]!.timelines[0]!.property='unexpected';fails(malformed,'Unsupported timeline property');
});
test('sparse deform validation rejects nonfinite offsets and dangling values',()=>{
 const ir=fixture();addMesh(ir,'mesh',[{position:[0,0],influences:[]},{position:[1,0],influences:[]},{position:[0,1],influences:[]}],[0,1,2]);
 ir.skeleton.animations[0]!.timelines=[{targetKind:'attachment',targetId:'mesh',property:'deform',deformBasis:'vertex_delta',keys:[{timeSec:0,value:{offset:7,values:[1]},interpolation:{kind:'stepped'}}]}];fails(ir,'Invalid sparse deform value');
 ir.skeleton.animations[0]!.timelines[0]!.keys[0]!.value={offset:2,values:[1,Number.NaN]};fails(ir,'Invalid sparse deform value');
});
test('unknown automatic sequence modes and unimplemented constraint parameters fail closed',()=>{
 const ir=fixture();const region=ir.skeleton.attachments[0]!;assert.equal(region.kind,'region');region.sequence={count:3,start:1,digits:2,setupIndex:0,mode:'loop'};fails(ir,'Unsupported automatic sequence mode');
 const c=fixture();c.skeleton.constraints.push({id:'chain',kind:'ik',order:0,boneIds:['root'],targetBoneId:'root',targetSlotId:null,parameters:{notRealParameter:4}});fails(c,'Unsupported constraint parameter');
});
test('invalid JSON and unsupported color conventions fail with typed diagnostics',()=>{
 assert.throws(()=>deserializeIR('{ no json'),(e:unknown)=>e instanceof Error&&e.message.includes('Malformed IR JSON'));
 const ir=fixture();ir.conventions.color='premultiplied-linear';fails(ir,'Unsupported canonical color convention');
});
