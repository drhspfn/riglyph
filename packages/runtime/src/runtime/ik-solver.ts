/** Independent constraint solver using ordinary forward kinematics and a
 * damped two-variable numerical solve. Never consumes source-format records.
 */
import {inheritTransform,apply,shortestAngleDelta} from '@riglyph/core';
import type {Affine,Transform,Inheritance} from '@riglyph/core';
const RAD=Math.PI/180;
const identity:Affine={a:1,b:0,c:0,d:1,x:0,y:0};
const wrap=(x:number)=>((x+540)%360+360)%360-180;
export type TwoLinkInput={parentBasis:Affine|null;first:Transform;second:Transform;firstInheritance:Inheritance;secondInheritance:Inheritance;target:[number,number];bend:1|-1;mix:number};
export function solveTwoLink(input:TwoLinkInput):{first:Transform;second:Transform;residual:number}{
 const {parentBasis,first,second,target,bend,mix}=input;
 const parent=parentBasis??identity;
 const evalTip=(r1:number,r2:number)=>{
  const p=inheritTransform(parent,{...first,rotationDeg:r1},input.firstInheritance);
  const c=inheritTransform(p,{...second,rotationDeg:r2},input.secondInheritance);
  return apply(c,second.length,0);
 };
 if(second.x===0){
  const inv=(()=>{const det=parent.a*parent.d-parent.b*parent.c;if(Math.abs(det)<1e-10)return null;
   const dx=target[0]-parent.x,dy=target[1]-parent.y;
   return [(parent.d*dx-parent.c*dy)/det-first.x,(-parent.b*dx+parent.a*dy)/det-first.y] as const;})();
  const direction=inv?Math.atan2(inv[1],inv[0])/RAD:first.rotationDeg;
  const one={...first,rotationDeg:first.rotationDeg+shortestAngleDelta(first.rotationDeg+first.shearXDeg,direction)*mix};
  const tip=evalTip(one.rotationDeg,second.rotationDeg);
  return{first:one,second:{...second},residual:Math.hypot(tip[0]-target[0],tip[1]-target[1])};
 }
 const initial=first.rotationDeg;
 const candidates:{r1:number;r2:number;err:number;score:number}[]=[];
 for(const elbow of [30,75,125,170])for(const shift of [-150,-60,0,60,150]){
  let r1=initial+shift,r2=second.rotationDeg+bend*elbow;
  for(let j=0;j<45;j++){
   const [x,y]=evalTip(r1,r2),ex=x-target[0],ey=y-target[1];
   if(ex*ex+ey*ey<1e-14)break;
   const h=.0005;
   const [x1,y1]=evalTip(r1+h,r2),[x2,y2]=evalTip(r1,r2+h);
   const a=(x1-x)/h,b=(x2-x)/h,c=(y1-y)/h,d=(y2-y)/h,det=a*d-b*c;
   if(Math.abs(det)<1e-13){const lambda=.05;r1-=lambda*(a*ex+c*ey);r2-=lambda*(b*ex+d*ey);continue;}
   const dr1=Math.max(-40,Math.min(40,(d*ex-b*ey)/det));
   const dr2=Math.max(-40,Math.min(40,(-c*ex+a*ey)/det));
   r1-=dr1;r2-=dr2;
  }
  const [x,y]=evalTip(r1,r2),err=Math.hypot(x-target[0],y-target[1]);
  const elbowAngle=wrap(r2+second.shearXDeg);
  const valid=Math.sin(elbowAngle*RAD)*bend>=-1e-6;
  const deviation=Math.abs(shortestAngleDelta(initial,r1))+.03*Math.abs(shortestAngleDelta(second.rotationDeg,r2));
  candidates.push({r1,r2,err,score:err*1000+deviation+(valid?0:10000)});
 }
 candidates.sort((a,b)=>a.score-b.score);
 const best=candidates[0]!;
 return{first:{...first,rotationDeg:first.rotationDeg+shortestAngleDelta(first.rotationDeg,best.r1)*mix},
  second:{...second,rotationDeg:second.rotationDeg+shortestAngleDelta(second.rotationDeg,best.r2)*mix},residual:best.err};
}
