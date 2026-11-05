import {EngineError, requireCondition} from '@riglyph/core';
import {apply,localMatrix} from '@riglyph/core';
import type {AtlasRegion,Attachment,MeshAttachment,LinkedMeshAttachment,Vertex,Vec4,Vec3,Blend,IRDocument} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
export type DrawPacket={slotId:string;attachmentId:string;pageId:string;positions:Float32Array;uvs:Float32Array;indices:Uint32Array;light:Vec4;dark:Vec3|null;blend:Blend;pma:boolean};
import {triangulatePolygon,clipAgainstTriangle,orientation,inspectPolygon} from './polygon.js';
import type {GeometryPoint as P,GeometryTriangle as Triangle,ClippingPolicy,PolygonReport} from './polygon.js';
export {triangulatePolygon,clipAgainstTriangle,inspectPolygon} from './polygon.js';
export type {ClippingPolicy,PolygonReport} from './polygon.js';
export type GeometryDiagnostic={
 format:'riglyph-geometry-v1';severity:'info'|'warning'|'error';message:string;
 sourceVersion:string;irSchemaVersion:string;clipId:string|null;skinId:string|null;
 timeSec:number|null;frameIndex:number|null;slotId:string;attachmentId:string;endSlotId:string;
 polygon:PolygonReport|null;localVertices:readonly Vertex[];worldVertices:number[];
 deform:{basis:string;values:number[];expectedLength:number;state:'absent'|'present'};
 boneMatrices:Record<string,unknown>;drawOrder:readonly string[];
};
export type PacketOptions={clippingPolicy?:ClippingPolicy;clipId?:string;timeSec?:number;frameIndex?:number;
 onGeometryDiagnostic?:(diagnostic:GeometryDiagnostic)=>void;
 onGeometryWarning?:(warning:GeometryDiagnostic)=>void};
/** Atlas UVs in canonical top-left normalized image coordinates. Rotation
 * denotes physical pack orientation; source-space UVs remain unrotated.
 * Numeric quarter-turn behavior independently verified for Spine Binary 4.1.x. */
export function atlasUV(region:AtlasRegion,page:{width:number;height:number},u:number,v:number):[number,number]{
 let a=u,b=v;
 switch(region.rotationDeg){
  case 90:a=v;b=1-u;break;
  case 180:a=1-u;b=1-v;break;
  case 270:a=1-v;b=u;break;
 }
 const [x,y,w,h]=region.bounds;
 const occupiedW=region.rotationDeg%180===0?w:h,occupiedH=region.rotationDeg%180===0?h:w;
 return [(x+a*occupiedW)/page.width,(y+b*occupiedH)/page.height];
}
/** Source mesh UVs address the original (untrimmed) image. Convert exactly
 * once to top-left, trimmed-local UVs before atlas packing/rotation.
 * Region quads already carry trimmed-local UVs and must bypass this function.
 * Coordinates outside [0,1] are preserved for sampler wrap / diagnostics.
 */
export function originalMeshUVToTrimLocal(region:AtlasRegion,sourceU:number,sourceVTopLeft:number):[number,number]{
 const [wholeW,wholeH]=region.originalSize,[trimW,trimH]=[region.bounds[2],region.bounds[3]];
 const [offsetLeft,offsetBottom]=region.offset;
 requireCondition([wholeW,wholeH,trimW,trimH,offsetLeft,offsetBottom,sourceU,sourceVTopLeft].every(Number.isFinite),
  'INVALID_ATLAS','Non-finite original mesh UV or region geometry');
 requireCondition(wholeW>0&&wholeH>0&&trimW>0&&trimH>0,'INVALID_ATLAS','Invalid original or trimmed region dimensions');
 const trimTop=wholeH-offsetBottom-trimH;
 requireCondition(offsetLeft>=0&&offsetBottom>=0&&offsetLeft+trimW<=wholeW+1e-4&&trimTop>=-1e-4,
  'INVALID_ATLAS','Trim region lies outside original image bounds');
 return [(sourceU*wholeW-offsetLeft)/trimW,(sourceVTopLeft*wholeH-trimTop)/trimH];
}
function sourceMesh(attachment:MeshAttachment|LinkedMeshAttachment,assets:Map<string,Attachment>):MeshAttachment{
 let cur:Attachment=attachment;const visited=new Set<string>();
 while(cur.kind==='linked_mesh'){
  requireCondition(!visited.has(cur.id),'INVALID_ATTACHMENT','Linked mesh cycle');visited.add(cur.id);
  const next=assets.get(cur.parentMeshId);requireCondition(next,'INVALID_ATTACHMENT',`Missing mesh parent ${cur.parentMeshId}`);cur=next;
 }
 requireCondition(cur.kind==='mesh','INVALID_ATTACHMENT','Linked geometry parent must be mesh');return cur;
}
function chosenRegion(attachment:Attachment,index:number,ir:IRDocument):AtlasRegion{
 requireCondition('regionId' in attachment,'INVALID_ATTACHMENT','Renderable has no atlas region');
 const base=ir.atlases.regions.find(r=>r.id===attachment.regionId);requireCondition(base,'INVALID_ATLAS',`Unknown region ${attachment.regionId}`);
 if(!('sequence' in attachment)||!attachment.sequence)return base;
 const sequence=attachment.sequence;
 if(index===sequence.setupIndex)return base;
 const expectedName=sequence.basePath===undefined?null:sequence.basePath+String(sequence.start+index).padStart(sequence.digits,'0');
 const seqRegion=ir.atlases.regions.find(r=>expectedName!==null?r.name===expectedName:r.name===base.name&&r.sequenceIndex===index);
 requireCondition(seqRegion,'UNSUPPORTED_SEMANTIC_FEATURE',`Sequence frame ${index} unavailable for ${attachment.id}`);return seqRegion;
}
function colors(slotLight:Vec4,attachLight:Vec4):Vec4{return [slotLight[0]*attachLight[0],slotLight[1]*attachLight[1],slotLight[2]*attachLight[2],slotLight[3]*attachLight[3]];}
/** Pure CPU draw preparation. World geometry and clippers are independent of the GPU backend. */
export function prepareDrawPackets(instance:SkeletonInstance,options:PacketOptions={}):DrawPacket[]{
 const ir=instance.ir,packets:DrawPacket[]=[];
 const slots=new Map(ir.skeleton.slots.map(s=>[s.id,s]));
 const activeClips:{endSlotId:string;startDrawIndex:number;triangles:Triangle[]}[]=[];
 const mapped=(id:string,verts:readonly Vertex[],deform?:Float32Array):P[]=>{
  const transformed=instance.vertices(verts,id,deform);
  return Array.from({length:verts.length},(_,i)=>({x:transformed[i*2]!,y:transformed[i*2+1]!,u:0,v:0}));
 };
 for(let drawIndex=0;drawIndex<instance.drawOrder.length;drawIndex++){
  const slotId=instance.drawOrder[drawIndex]!;
  const slot=slots.get(slotId)!;
  // An inactive bone cannot start/draw a clip, but its slot still occupies
  // a draw-order position: an explicit end slot is processed after that slot.
  const state=instance.activeBones.has(slot.boneId)?instance.slots.get(slotId):undefined;
  const selected=state?.attachmentId?instance.assets.get(state.attachmentId):undefined;
  requireCondition(!state?.attachmentId||selected,'INVALID_ATTACHMENT',`Missing active attachment ${state?.attachmentId}`);
  if(selected?.kind==='clipping'){
   const poly=mapped(slot.boneId,selected.vertices,instance.deforms.get(selected.id));
   let report:PolygonReport|null=null;
   const diagnostic=(severity:GeometryDiagnostic['severity'],message:string):GeometryDiagnostic=>({
    format:'riglyph-geometry-v1',severity,message,sourceVersion:ir.source.version,irSchemaVersion:ir.schemaVersion,
    clipId:options.clipId??null,skinId:instance.skinId??ir.skeleton.skins.find(s=>s.isDefault)?.id??null,
    timeSec:options.timeSec??null,frameIndex:options.frameIndex??null,slotId,attachmentId:selected.id,endSlotId:selected.endSlotId,
    polygon:report,localVertices:selected.vertices,worldVertices:poly.flatMap(p=>[p.x,p.y]),
    deform:{basis:selected.vertices.some(v=>v.influences.length)?'influence_delta':'vertex_delta',
     values:Array.from(instance.deforms.get(selected.id)??[]),
     expectedLength:selected.vertices.reduce((n,v)=>n+(v.position?2:v.influences.length*2),0),
     state:instance.deforms.has(selected.id)?'present':'absent'},
    boneMatrices:Object.fromEntries([...new Set([slot.boneId,...selected.vertices.flatMap(v=>v.influences.map(i=>i.boneId))])].map(id=>[id,instance.world.get(id)])),
    drawOrder:instance.drawOrder});
   try{
    requireCondition(activeClips.length===0,'UNSUPPORTED_SEMANTIC_FEATURE',
     `Overlapping clipping scopes are not supported: ${slotId}`);
    const triangles=triangulatePolygon(poly,options.clippingPolicy,warning=>{
     report=warning;const d=diagnostic('warning','Self-crossing mask uses even-odd fill; official image parity is not guaranteed');
     if(options.onGeometryWarning)options.onGeometryWarning(d);else console.warn(JSON.stringify(d));
    });
    activeClips.push({endSlotId:selected.endSlotId,startDrawIndex:drawIndex,triangles});
    if(options.onGeometryDiagnostic){report??=inspectPolygon(poly);options.onGeometryDiagnostic(diagnostic(report.issues.length?'warning':'info','Clipping geometry sampled'));}
   }catch(error){
    if(error instanceof EngineError){
     report=(error.details.context?.['polygon'] as PolygonReport|undefined)??null;
     const message=`${error.message} (slot ${slotId}, attachment ${selected.id}, time ${options.timeSec??'unknown'})`;
     options.onGeometryDiagnostic?.(diagnostic('error',message));
     throw new EngineError(error.code,message,{...error.details,owner:selected.id,context:{...error.details.context,slotId,attachmentId:selected.id,
      endSlotId:selected.endSlotId,clipId:options.clipId??null,timeSec:options.timeSec??null,frameIndex:options.frameIndex??null}});
    }throw error;
   }
  }else if(selected?.kind==='region'||selected?.kind==='mesh'||selected?.kind==='linked_mesh'){
   const region=chosenRegion(selected,state!.sequenceIndex,ir);const page=ir.atlases.pages.find(p=>p.id===region.pageId);
   requireCondition(page,'MISSING_TEXTURE_PAGE',`Missing page for ${region.id}`);
   let verts:P[],triangles:number[];
   if(selected.kind==='region'){
    // Attachment width/height describe untrimmed bounds; offsets locate visible pixels.
    const originalW=region.originalSize[0],originalH=region.originalSize[1];
    requireCondition(originalW>0&&originalH>0,'INVALID_ATLAS','Invalid original atlas dimensions');
    const l=-selected.width/2+selected.width*region.offset[0]/originalW;
    const b=-selected.height/2+selected.height*region.offset[1]/originalH;
    const r=l+selected.width*region.bounds[2]/originalW;
    const t=b+selected.height*region.bounds[3]/originalH;
    const local=localMatrix(selected.local),world=instance.world.get(slot.boneId)!;
    verts=[[l,b],[r,b],[r,t],[l,t]].map(([x,y])=>{
     const p=apply(local,x!,y!);const q=apply(world,p[0],p[1]);return {x:q[0],y:q[1],u:0,v:0};
    });
    // y-up local geometry, UV top-left origin.
    const uv:[[number,number],[number,number],[number,number],[number,number]]=[[0,1],[1,1],[1,0],[0,0]];
    verts.forEach((v,i)=>{[v.u,v.v]=uv[i]!;});
    triangles=[0,1,2,0,2,3];
   }else{
    const mesh=sourceMesh(selected,instance.assets);
    const deformOwner=selected.kind==='linked_mesh'?selected.deformTimelineOwnerId:selected.id;
    verts=mapped(slot.boneId,mesh.vertices,instance.deforms.get(deformOwner));
    for(let i=0;i<verts.length;i++){
     const sourceU=mesh.uvs[i*2]!,sourceV=mesh.uvs[i*2+1]!;
     const topLeftSourceV=ir.conventions.uvOrigin==='bottom-left'?1-sourceV:sourceV;
     [verts[i]!.u,verts[i]!.v]=originalMeshUVToTrimLocal(region,sourceU,topLeftSourceV);
    }
    triangles=mesh.triangles;
   }
   verts.forEach(v=>{[v.u,v.v]=atlasUV(region,page,v.u,v.v);});
   let chunks:Triangle[]=[];
   for(let i=0;i<triangles.length;i+=3){
    const a=verts[triangles[i]!]!,b=verts[triangles[i+1]!]!,c=verts[triangles[i+2]!]!;
    if(orientation(a,b,c)!==0)chunks.push([a,b,c]);
   }
   for(const clip of activeClips){
    requireCondition(chunks.length*clip.triangles.length<=2_000_000,'LIMIT_EXCEEDED',`Clipping work budget exceeded at slot ${slotId}`);
    const clipped:Triangle[]=[];
    for(const tri of chunks)for(const c of clip.triangles){
     clipped.push(...clipAgainstTriangle(tri,c));
     requireCondition(clipped.length<=250_000,'LIMIT_EXCEEDED',`Clipped triangle budget exceeded at slot ${slotId}`);
    }
    chunks=clipped;
   }
   const xyz=new Float32Array(chunks.length*6),uvs=new Float32Array(chunks.length*6),idx=new Uint32Array(chunks.length*3);
   for(let i=0;i<chunks.length;i++)for(let k=0;k<3;k++){
    const v=chunks[i]![k]!;xyz[i*6+k*2]=v.x;xyz[i*6+k*2+1]=v.y;uvs[i*6+k*2]=v.u;uvs[i*6+k*2+1]=v.v;idx[i*3+k]=i*3+k;
   }
   if(chunks.length)packets.push({slotId,attachmentId:selected.id,pageId:page.id,positions:xyz,uvs,indices:idx,light:colors(state!.light,selected.color),dark:state!.dark,blend:slot.blend,pma:page.pma});
  }
  // The end slot is inclusive. When start==end its slot has already been
  // visited; the scope therefore persists to the end of this traversal.
  for(let i=activeClips.length-1;i>=0;i--)
   if(drawIndex>activeClips[i]!.startDrawIndex&&activeClips[i]!.endSlotId===slotId)activeClips.splice(i,1);
 }
 return packets;
}
export function drawBounds(packets:readonly DrawPacket[]):[number,number,number,number]|null{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const p of packets)for(let i=0;i<p.positions.length;i+=2){const x=p.positions[i]!,y=p.positions[i+1]!;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 return Number.isFinite(minX)?[minX,minY,maxX-minX,maxY-minY]:null;
}
