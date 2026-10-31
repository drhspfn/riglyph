import {EngineError, requireCondition} from '@riglyph/core';
import {apply,localMatrix} from '@riglyph/core';
import type {AtlasRegion,Attachment,MeshAttachment,LinkedMeshAttachment,Vertex,Vec4,Vec3,Blend,IRDocument} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
export type DrawPacket={slotId:string;attachmentId:string;pageId:string;positions:Float32Array;uvs:Float32Array;indices:Uint32Array;light:Vec4;dark:Vec3|null;blend:Blend;pma:boolean};
type P={x:number;y:number;u:number;v:number};
type Triangle=[P,P,P];
const cross=(a:P,b:P,c:P)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function polygonArea(points:readonly P[]):number{let area=0;for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!;area+=a.x*b.y-b.x*a.y;}return area/2;}
const interpolate=(a:P,b:P,t:number):P=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t});
/** Ear removal triangulator for a simple polygon. Collinear ears are filtered. */
export function triangulatePolygon(polygon:readonly P[]):Triangle[]{
 requireCondition(polygon.length>=3,'INVALID_TOPOLOGY','Clipping polygon needs at least three points');
 requireCondition(polygon.length<=4_096,'LIMIT_EXCEEDED','Clipping polygon too complex for verified O(n^2) triangulation');
 requireCondition(polygon.every(p=>Object.values(p).every(Number.isFinite)),'INVALID_TOPOLOGY','Non-finite clipping polygon');
 const same=(a:P,b:P)=>Math.hypot(a.x-b.x,a.y-b.y)<=1e-8;
 for(let i=0;i<polygon.length;i++)requireCondition(!same(polygon[i]!,polygon[(i+1)%polygon.length]!),
  'INVALID_TOPOLOGY',`Clipping polygon contains zero-length edge ${i}`);
 const signedArea=polygonArea(polygon);
 requireCondition(Number.isFinite(signedArea)&&Math.abs(signedArea)>1e-10,'INVALID_TOPOLOGY','Degenerate clipping polygon area');
 // Independently reject non-adjacent intersecting edges: ear removal alone may
 // otherwise silently produce nonzero triangles for self-crossing input.
 for(let i=0;i<polygon.length;i++)for(let j=i+2;j<polygon.length;j++){
  if(i===0&&j===polygon.length-1)continue;
  const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,c=polygon[j]!,d=polygon[(j+1)%polygon.length]!;
  const s1=cross(a,b,c),s2=cross(a,b,d),t1=cross(c,d,a),t2=cross(c,d,b),eps=1e-9;
  if((s1>eps&&s2<-eps||s1<-eps&&s2>eps)&&(t1>eps&&t2<-eps||t1<-eps&&t2>eps))
   throw new EngineError('INVALID_TOPOLOGY',`Clipping polygon self-intersection at edges ${i}/${j}`);
  if(same(a,c)||same(a,d)||same(b,c)||same(b,d))
   throw new EngineError('INVALID_TOPOLOGY','Clipping polygon has self-touching vertices');
 }
 const order=signedArea>=0?[...polygon.keys()]:[...polygon.keys()].reverse();
 const result:Triangle[]=[];let guard=0;
 while(order.length>3){
  requireCondition(guard++<polygon.length*polygon.length,'INVALID_TOPOLOGY','Polygon self-intersection or invalid winding');
  let removed=false;
  for(let j=0;j<order.length;j++){
   const a=polygon[order[(j-1+order.length)%order.length]!]!,b=polygon[order[j]!]!,c=polygon[order[(j+1)%order.length]!]!;
   if(cross(a,b,c)<=1e-9)continue;
   if(order.some((index,k)=>{if(k===j||k===(j-1+order.length)%order.length||k===(j+1)%order.length)return false;
    const p=polygon[index]!;return cross(a,b,p)>=-1e-10&&cross(b,c,p)>=-1e-10&&cross(c,a,p)>=-1e-10;}))continue;
   result.push([a,b,c]);order.splice(j,1);removed=true;break;
  }
  if(!removed)throw new EngineError('INVALID_TOPOLOGY','Cannot triangulate clipping polygon');
 }
 const [ia,ib,ic]=order;if(ia!==undefined&&ib!==undefined&&ic!==undefined){const a=polygon[ia]!,b=polygon[ib]!,c=polygon[ic]!;if(cross(a,b,c)>1e-9)result.push([a,b,c]);}
 return result;
}
/** Convex clipping with interpolated UVs; clip triangle has a counter-clockwise winding. */
export function clipAgainstTriangle(input:Triangle,clip:Triangle):Triangle[]{
 let polygon:P[]=[...input];
 for(let edge=0;edge<3;edge++){
  const a=clip[edge]!,b=clip[(edge+1)%3]!,result:P[]=[];
  for(let i=0;i<polygon.length;i++){
   const prev=polygon[(i+polygon.length-1)%polygon.length]!,cur=polygon[i]!;
   const sidePrev=cross(a,b,prev),sideCur=cross(a,b,cur);
   const insidePrev=sidePrev>=-1e-7,insideCur=sideCur>=-1e-7;
   if(insidePrev!==insideCur){const denom=sidePrev-sideCur;if(Math.abs(denom)>1e-15)result.push(interpolate(prev,cur,sidePrev/denom));}
   if(insideCur)result.push(cur);
  }
  polygon=result;if(polygon.length<3)return [];
 }
 const tris:Triangle[]=[];for(let i=1;i+1<polygon.length;i++){
  const a=polygon[0]!,b=polygon[i]!,c=polygon[i+1]!;if(Math.abs(cross(a,b,c))>1e-8)tris.push([a,b,c]);
 }
 return tris;
}
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
export function prepareDrawPackets(instance:SkeletonInstance):DrawPacket[]{
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
   requireCondition(activeClips.length===0,'UNSUPPORTED_SEMANTIC_FEATURE',
    `Overlapping clipping scopes are not supported: ${slotId}`);
   activeClips.push({endSlotId:selected.endSlotId,startDrawIndex:drawIndex,triangles:triangulatePolygon(poly)});
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
    if(Math.abs(cross(a,b,c))>1e-9)chunks.push([a,b,c]);
   }
   for(const clip of activeClips){
    chunks=chunks.flatMap(tri=>clip.triangles.flatMap(c=>clipAgainstTriangle(tri,c)));
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
