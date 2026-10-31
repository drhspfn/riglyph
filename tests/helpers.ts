import sample from '../fixtures/minimal.json' with {type:'json'};
import type {IRDocument,MeshAttachment,Vec4,Vertex,Attachment,Slot} from '../src/ir/types.js';
export function fixture():IRDocument{return structuredClone(sample) as unknown as IRDocument;}
export const identity=()=>({x:0,y:0,rotationDeg:0,scaleX:1,scaleY:1,shearXDeg:0,shearYDeg:0,length:0});
export const white:Vec4=[1,1,1,1];
export function addBone(ir:IRDocument,id:string,parentId:string|null='root'){
 ir.skeleton.bones.push({id,parentId,setup:identity(),inheritance:'normal',skinRequired:false});return ir.skeleton.bones.at(-1)!;
}
export function addSlot(ir:IRDocument,id:string,boneId='root',attachId:string|null=null){
 const s:Slot={id,boneId,drawIndex:ir.skeleton.slots.length,light:[1,1,1,1],dark:null,setupAttachmentId:attachId,blend:'normal'};
 ir.skeleton.slots.push(s);return s;
}
export function addMesh(ir:IRDocument,id:string,vertices:Vertex[],triangles:number[],uvs?:number[]):MeshAttachment{
 const m:MeshAttachment={id,kind:'mesh',name:id,color:[1,1,1,1],regionId:'reg0',vertices,triangles,uvs:uvs??vertices.flatMap((_,i)=>i===0?[0,0]:i===1?[1,0]:[0,1]),hullVertexCount:vertices.length,sequence:null};
 ir.skeleton.attachments.push(m);if(!ir.capabilities.includes('mesh'))ir.capabilities.push('mesh');if(vertices.some(v=>v.position===null)&&!ir.capabilities.includes('weighted_mesh'))ir.capabilities.push('weighted_mesh');return m;
}
export function addAttachment(ir:IRDocument,a:Attachment,slotId:string,key:string){
 ir.skeleton.attachments.push(a);if(!ir.capabilities.includes(a.kind))ir.capabilities.push(a.kind);
 ir.skeleton.skins[0]!.attachments.push({slotId,key,attachmentId:a.id});
}
