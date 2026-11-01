/** Independent, version-neutral affine transform constraint evaluator.
 * Inputs and outputs are semantic IR matrices, never source-binary records.
 */
import {apply,invert,multiply,inheritTransform,shortestAngleDelta} from '@riglyph/core';
import type {Affine,Transform} from '@riglyph/core';

const RAD=Math.PI/180;
const DEG=180/Math.PI;
const angle=(x:number,y:number)=>Math.atan2(y,x);
const length=(x:number,y:number)=>Math.hypot(x,y);
const mixValue=(p:Record<string,number|boolean|string>,key:string)=>Number(p[key]??0);
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
const rotate=(m:Affine,r:number):void=>{
 const c=Math.cos(r),s=Math.sin(r),a=m.a,b=m.b,cc=m.c,d=m.d;
 m.a=c*a-s*b;m.b=s*a+c*b;m.c=c*cc-s*d;m.d=s*cc+c*d;
};
const replaceLength=(m:Affine,col:'x'|'y',target:number,mix:number):void=>{
 const x=col==='x'?m.a:m.c,y=col==='x'?m.b:m.d,s=length(x,y);
 if(s>1e-12){const scale=(s+(target-s)*mix)/s;if(col==='x'){m.a*=scale;m.b*=scale;}else{m.c*=scale;m.d*=scale;}}
};
const multiplyLength=(m:Affine,col:'x'|'y',ratio:number):void=>{
 if(col==='x'){m.a*=ratio;m.b*=ratio;}else{m.c*=ratio;m.d*=ratio;}
};
/** Applied decomposition of a world basis under a parent. Authored transforms
 * remain immutable; this describes the matrix actually in effect.
 */
export function decomposeApplied(world:Affine,parent:Affine|null,authored:Transform):Transform{
 const m=parent?multiply(invert(parent),world):world;
 const theta=angle(m.a,m.b),sx=length(m.a,m.b),sy=length(m.c,m.d);
 const determinant=m.a*m.d-m.b*m.c;
 const shear=Math.atan2(m.a*m.c+m.b*m.d,determinant)*DEG;
 return {...authored,x:m.x,y:m.y,rotationDeg:theta*DEG-authored.shearXDeg,
   scaleX:sx,scaleY:sx>1e-12?determinant/sx:sy,shearYDeg:shear};
}
/** Apply one constraint bone, preserving its current world basis.
 * The caller updates affected descendants in hierarchy order.
 */
export function evaluateTransformBone(
 currentWorld:Affine,targetWorld:Affine,currentApplied:Transform,targetApplied:Transform,
 parentWorld:Affine|null,inheritance:import('@riglyph/core').Inheritance,
 p:Record<string,number|boolean|string>
):{world:Affine;applied:Transform}{
 const absolute=p['relative']!==true,local=p['local']===true;
 const mr=mixValue(p,'mixRotate'),mx=mixValue(p,'mixX'),my=mixValue(p,'mixY');
 const msx=mixValue(p,'mixScaleX'),msy=mixValue(p,'mixScaleY'),msh=mixValue(p,'mixShearY');
 if(!mr&&!mx&&!my&&!msx&&!msy&&!msh)return {world:{...currentWorld},applied:{...currentApplied}};
 const or=mixValue(p,'offsetRotation'),ox=mixValue(p,'offsetX'),oy=mixValue(p,'offsetY');
 const osx=mixValue(p,'offsetScaleX'),osy=mixValue(p,'offsetScaleY'),osh=mixValue(p,'offsetShearY');
 if(local){
  const a={...currentApplied};
  if(mr)a.rotationDeg+= (absolute?shortestAngleDelta(a.rotationDeg,targetApplied.rotationDeg+or):targetApplied.rotationDeg+or)*mr;
  if(mx)a.x+=(absolute?targetApplied.x+ox-a.x:targetApplied.x+ox)*mx;
  if(my)a.y+=(absolute?targetApplied.y+oy-a.y:targetApplied.y+oy)*my;
  if(msx){if(absolute){const s=a.scaleX;if(s!==0)a.scaleX=(s+(targetApplied.scaleX-s+osx)*msx)/s;}else a.scaleX*=1+(targetApplied.scaleX-1+osx)*msx;}
  if(msy){if(absolute){const s=a.scaleY;if(s!==0)a.scaleY=(s+(targetApplied.scaleY-s+osy)*msy)/s;}else a.scaleY*=1+(targetApplied.scaleY-1+osy)*msy;}
  if(msh)a.shearYDeg+=(absolute?shortestAngleDelta(a.shearYDeg,targetApplied.shearYDeg+osh):targetApplied.shearYDeg+osh)*msh;
  const m=inheritTransform(parentWorld??{a:1,b:0,c:0,d:1,x:0,y:0},a,inheritance);
  return {world:m,applied:a};
 }
 const m={...currentWorld};
 if(mr){const refAngle=angle(targetWorld.a,targetWorld.b),now=angle(m.a,m.b);
  const delta=absolute?wrap(refAngle-now+or*RAD):refAngle+or*RAD;
  rotate(m,delta*mr);
 }
 if(mx||my){const point=apply(targetWorld,ox,oy);
  m.x+= (absolute?point[0]-m.x:point[0])*mx;
  m.y+= (absolute?point[1]-m.y:point[1])*my;
 }
 if(msx){const t=length(targetWorld.a,targetWorld.b)+osx;
  if(absolute)replaceLength(m,'x',t,msx);else multiplyLength(m,'x',1+(t-1)*msx);
 }
 if(msy){const t=length(targetWorld.c,targetWorld.d)+osy;
  if(absolute)replaceLength(m,'y',t,msy);else multiplyLength(m,'y',1+(t-1)*msy);
 }
 if(msh){const tx=angle(targetWorld.a,targetWorld.b),ty=angle(targetWorld.c,targetWorld.d);
  const bx=angle(m.a,m.b),by=angle(m.c,m.d);
  const reference=wrap(ty-tx),present=wrap(by-bx);
  const delta=absolute?wrap(reference-present+osh*RAD):reference-Math.PI/2+osh*RAD;
  const newAngle=by+delta*msh,s=length(m.c,m.d);
  m.c=Math.cos(newAngle)*s;m.d=Math.sin(newAngle)*s;
 }
 return {world:m,applied:decomposeApplied(m,parentWorld,currentApplied)};
}
