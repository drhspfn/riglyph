import {EngineError,requireCondition} from '@riglyph/core';

export type GeometryPoint={x:number;y:number;u:number;v:number};
export type GeometryTriangle=[GeometryPoint,GeometryPoint,GeometryPoint];
export type ClippingPolicy='strict'|'compatible';
export type PolygonIssue={classification:'edge-crossing'|'zero-length-edge'|'repeated-vertex'|'edge-touch'|'collinear-overlap'|'zero-area';edges:number[];intersection?:[number,number]};
export type PolygonReport={vertexCount:number;signedArea:number;winding:'cw'|'ccw'|'degenerate';issues:PolygonIssue[]};
type P=GeometryPoint;type Triangle=GeometryTriangle;
export const cross=(a:P,b:P,c:P)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const interpolate=(a:P,b:P,t:number):P=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t});
const same=(a:P,b:P)=>a.x===b.x&&a.y===b.y;
// Exact dyadic fallback for cancellation in the orientation predicate. This
// treats the supplied doubles exactly, without a coordinate-dependent epsilon.
const bits=new DataView(new ArrayBuffer(8));
function dyadic(n:number):[bigint,number]{
 bits.setFloat64(0,n);const hi=bits.getUint32(0),lo=bits.getUint32(4),e=(hi>>>20)&2047;
 const mantissa=(BigInt(hi&0xfffff)<<32n)|BigInt(lo);
 return [(hi>>>31?-1n:1n)*(e?mantissa+(1n<<52n):mantissa),e?e-1075:-1074];
}
function difference(a:[bigint,number],b:[bigint,number]):[bigint,number]{
 const e=Math.min(a[1],b[1]);return [(a[0]<<BigInt(a[1]-e))-(b[0]<<BigInt(b[1]-e)),e];
}
function product(a:[bigint,number],b:[bigint,number]):[bigint,number]{return [a[0]*b[0],a[1]+b[1]];}
export function orientation(a:P,b:P,c:P):number{
 const l=(b.x-a.x)*(c.y-a.y),r=(b.y-a.y)*(c.x-a.x),det=l-r;
 if(Math.abs(det)>8*Number.EPSILON*(Math.abs(l)+Math.abs(r)))return Math.sign(det);
 const ax=dyadic(a.x),ay=dyadic(a.y),bx=difference(dyadic(b.x),ax),by=difference(dyadic(b.y),ay);
 const cx=difference(dyadic(c.x),ax),cy=difference(dyadic(c.y),ay);
 const exact=difference(product(bx,cy),product(by,cx))[0];return exact<0n?-1:exact>0n?1:0;
}
export function polygonArea(points:readonly P[]):number{
 let area=0;for(let i=1;i+1<points.length;i++)area+=cross(points[0]!,points[i]!,points[i+1]!);return area/2;
}
const onSegment=(a:P,b:P,p:P)=>orientation(a,b,p)===0&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y);
export function inspectPolygon(polygon:readonly P[]):PolygonReport{
 requireCondition(polygon.length>=3,'INVALID_TOPOLOGY','Clipping polygon needs at least three points');
 requireCondition(polygon.length<=4096,'LIMIT_EXCEEDED','Clipping polygon exceeds 4096 vertices');
 requireCondition(polygon.every(p=>[p.x,p.y,p.u,p.v].every(Number.isFinite)),'INVALID_TOPOLOGY','Non-finite clipping polygon');
 const issues:PolygonIssue[]=[];
 const add=(issue:PolygonIssue)=>{requireCondition(issues.length<4096,'LIMIT_EXCEEDED','Clipping intersection budget exceeded');issues.push(issue);};
 for(let i=0;i<polygon.length;i++)if(same(polygon[i]!,polygon[(i+1)%polygon.length]!))add({classification:'zero-length-edge',edges:[i]});
 for(let i=0;i<polygon.length;i++)for(let j=i+2;j<polygon.length;j++){
  if(i===0&&j===polygon.length-1)continue;
  const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,c=polygon[j]!,d=polygon[(j+1)%polygon.length]!;
  const s1=orientation(a,b,c),s2=orientation(a,b,d),t1=orientation(c,d,a),t2=orientation(c,d,b);
  if(s1*s2<0&&t1*t2<0){
   const dx=b.x-a.x,dy=b.y-a.y,ex=d.x-c.x,ey=d.y-c.y;
   const fraction=((c.x-a.x)*ey-(c.y-a.y)*ex)/(dx*ey-dy*ex);
   add({classification:'edge-crossing',edges:[i,j],intersection:[a.x+dx*fraction,a.y+dy*fraction]});
  }else if(same(a,c)||same(a,d)||same(b,c)||same(b,d))add({classification:'repeated-vertex',edges:[i,j]});
  else if(onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b))
   add({classification:s1===0&&s2===0?'collinear-overlap':'edge-touch',edges:[i,j]});
 }
 const signedArea=polygonArea(polygon);
 requireCondition(Number.isFinite(signedArea),'INVALID_TOPOLOGY','Clipping polygon area exceeds numeric range');
 if(signedArea===0&&!issues.length)add({classification:'zero-area',edges:[]});
 return {vertexCount:polygon.length,signedArea,winding:signedArea>0?'ccw':signedArea<0?'cw':'degenerate',issues};
}
/** Explicit even-odd fill for proper crossings only. Split at every vertex and
 * crossing Y, pair sorted boundary edges within each open horizontal slab.
 * Trapezoids have disjoint interiors; no hull, dropped frame or skipped mask.
 */
function evenOdd(polygon:readonly P[],report:PolygonReport):Triangle[]{
 const ys=[...new Set([...polygon.map(p=>p.y),...report.issues.map(i=>i.intersection![1])])].sort((a,b)=>a-b);
 const result:Triangle[]=[];
 for(let i=1;i<ys.length;i++){
  const low=ys[i-1]!,high=ys[i]!,mid=low+(high-low)/2;
  if(mid===low||mid===high)throw new EngineError('INVALID_TOPOLOGY','Clipping slab below numeric resolution');
  const edges=polygon.map((a,j)=>({a,b:polygon[(j+1)%polygon.length]!,j})).filter(e=>mid>Math.min(e.a.y,e.b.y)&&mid<Math.max(e.a.y,e.b.y));
  const at=(e:typeof edges[number],y:number):P=>({...interpolate(e.a,e.b,(y-e.a.y)/(e.b.y-e.a.y)),y});
  edges.sort((a,b)=>at(a,mid).x-at(b,mid).x||a.j-b.j);
  requireCondition(edges.length%2===0,'INVALID_TOPOLOGY','Unpaired clipping boundary');
  for(let j=0;j<edges.length;j+=2){
   const a=at(edges[j]!,low),b=at(edges[j+1]!,low),c=at(edges[j+1]!,high),d=at(edges[j]!,high);
   for(const t of [[a,b,c],[a,c,d]] as Triangle[])if(orientation(...t)!==0){if(orientation(...t)<0)t.reverse();result.push(t);}
   requireCondition(result.length<=32768,'LIMIT_EXCEEDED','Clipping decomposition exceeds 32768 triangles');
  }
 }
 return result;
}
export function triangulatePolygon(polygon:readonly P[],policy:ClippingPolicy='strict',onCompatibility?:(report:PolygonReport)=>void):Triangle[]{
 requireCondition(policy==='strict'||policy==='compatible','INVALID_HEADER','Unknown clipping policy');
 const report=inspectPolygon(polygon);
 if(report.issues.length){
  if(policy==='compatible'&&report.issues.every(i=>i.classification==='edge-crossing')){
   const triangles=evenOdd(polygon,report);onCompatibility?.(report);return triangles;
  }
  const issue=report.issues[0]!;
  throw new EngineError('INVALID_TOPOLOGY',issue.classification==='edge-crossing'?`Clipping polygon self-intersection at edges ${issue.edges.join('/')}`:
   `Invalid clipping polygon: ${issue.classification}`,{context:{polygon:report}});
 }
 const order=report.signedArea>=0?[...polygon.keys()]:[...polygon.keys()].reverse(),result:Triangle[]=[];
 // Exactly collinear consecutive vertices add no boundary area. Remove only
 // vertices lying between their neighbours, preserving all concave corners.
 for(let j=order.length-1;j>=0&&order.length>3;j--){
  const a=polygon[order[(j-1+order.length)%order.length]!]!,b=polygon[order[j]!]!,c=polygon[order[(j+1)%order.length]!]!;
  if(onSegment(a,c,b))order.splice(j,1);
 }
 let attempts=0,containmentChecks=0;
 while(order.length>3){
  let removed=false;
  for(let j=0;j<order.length;j++){
   requireCondition(++attempts<=polygon.length*polygon.length,'LIMIT_EXCEEDED','Clipping ear search budget exceeded');
   const before=(j-1+order.length)%order.length,after=(j+1)%order.length;
   const a=polygon[order[before]!]!,b=polygon[order[j]!]!,c=polygon[order[after]!]!;
   if(orientation(a,b,c)<=0)continue;
   if(order.some((index,k)=>{if(k===j||k===before||k===after)return false;
    requireCondition(++containmentChecks<=2_000_000,'LIMIT_EXCEEDED','Clipping containment budget exceeded');const p=polygon[index]!;
    return orientation(a,b,p)>=0&&orientation(b,c,p)>=0&&orientation(c,a,p)>=0;}))continue;
   result.push([a,b,c]);order.splice(j,1);removed=true;break;
  }
  requireCondition(removed,'INVALID_TOPOLOGY','Cannot triangulate clipping polygon');
 }
 const last=order.map(i=>polygon[i]!) as Triangle;if(orientation(...last)>0)result.push(last);return result;
}
/** Convex clipping with interpolated UVs and a counter-clockwise clip triangle. */
export function clipAgainstTriangle(input:Triangle,clip:Triangle):Triangle[]{
 let polygon:P[]=[...input];
 for(let edge=0;edge<3;edge++){
  const a=clip[edge]!,b=clip[(edge+1)%3]!,result:P[]=[];
  for(let i=0;i<polygon.length;i++){
   const prev=polygon[(i+polygon.length-1)%polygon.length]!,cur=polygon[i]!;
   const sidePrev=cross(a,b,prev),sideCur=cross(a,b,cur),insidePrev=orientation(a,b,prev)>=0,insideCur=orientation(a,b,cur)>=0;
   if(insidePrev!==insideCur){const denom=sidePrev-sideCur;if(denom!==0)result.push(interpolate(prev,cur,Math.max(0,Math.min(1,sidePrev/denom))));}
   if(insideCur)result.push(cur);
  }
  polygon=result;if(polygon.length<3)return [];
 }
 const tris:Triangle[]=[];for(let i=1;i+1<polygon.length;i++){
  const t:Triangle=[polygon[0]!,polygon[i]!,polygon[i+1]!];if(orientation(...t)!==0)tris.push(t);
 }
 return tris;
}
