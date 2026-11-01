/** Independent constraint solver using ordinary forward kinematics and a
 * damped two-variable numerical solve. Never consumes source-format records.
 */
import {inheritTransform,apply,shortestAngleDelta} from '@riglyph/core';
import type {Affine,Transform,Inheritance} from '@riglyph/core';
const RAD=Math.PI/180;
const identity:Affine={a:1,b:0,c:0,d:1,x:0,y:0};
const wrap=(x:number)=>((x+540)%360+360)%360-180;
export type TwoLinkInput={parentBasis:Affine|null;first:Transform;second:Transform;firstInheritance:Inheritance;secondInheritance:Inheritance;target:[number,number];bend:1|-1;mix:number;softness?:number;stretch?:boolean;uniform?:boolean};
export function solveTwoLink(input:TwoLinkInput):{first:Transform;second:Transform;residual:number}{
 const {parentBasis,first,second,target,bend,mix}=input;
 const parent=parentBasis??identity;
 const firstWorld=inheritTransform(parent,first,input.firstInheritance);
 const childWorld=inheritTransform(firstWorld,second,input.secondInheritance);
 const firstReach=Math.hypot(childWorld.x-firstWorld.x,childWorld.y-firstWorld.y);
 const secondReach=Math.abs(second.length)*Math.hypot(childWorld.a,childWorld.b);
 const reach=firstReach+secondReach;
 const targetDx=target[0]-firstWorld.x,targetDy=target[1]-firstWorld.y;
 const distance=Math.hypot(targetDx,targetDy);
 const softness=Math.max(0,input.softness??0);
 const scaleX=Math.hypot(parent.a,parent.b),scaleY=Math.hypot(parent.c,parent.d);
 const canStretch=!!input.stretch&&softness===0&&Math.abs(scaleX-scaleY)<1e-6;
 const stretchFactor=canStretch&&reach>1e-8&&distance>reach?distance/reach:1;
 const workingFirst:Transform={...first,scaleX:first.scaleX*stretchFactor,
  scaleY:first.scaleY*(input.uniform?stretchFactor:1)};
 let targetGoal:readonly [number,number]=target;
 if(softness>0&&firstReach>0){
  // The maximum extension uses the straight (aligned) child axis rather
  // than its current setup rotation. Apply a smooth reach reduction only
  // in the outer softness interval, measured in world units.
  const alignedReach=firstReach+Math.abs(second.length)*Math.hypot(firstWorld.a,firstWorld.b);
  const worldSoft=softness*Math.hypot(parent.a,parent.b);
  const excess=distance-alignedReach+worldSoft;
  if(worldSoft>1e-9&&excess>0){
   const reduction=excess<worldSoft?excess*excess/(2*worldSoft+excess/3):
    Math.min(distance,excess-worldSoft/2);
   const amount=Math.max(0,distance-reduction)/Math.max(distance,1e-9);
   targetGoal=[firstWorld.x+targetDx*amount,firstWorld.y+targetDy*amount];
  }
 }
 const evalTip=(r1:number,r2:number)=>{
  const p=inheritTransform(parent,{...workingFirst,rotationDeg:r1},input.firstInheritance);
  const c=inheritTransform(p,{...second,rotationDeg:r2},input.secondInheritance);
  return apply(c,second.length,0);
 };
 // The zero-pivot branch is genuinely singular only when both components
 // of the child's offset vanish. A nonzero local Y still provides a first
 // IK lever and must use the full two-variable solve (including shear).
 if(second.x===0&&second.y===0){
  const inv=(()=>{const det=parent.a*parent.d-parent.b*parent.c;if(Math.abs(det)<1e-10)return null;
   const dx=target[0]-parent.x,dy=target[1]-parent.y;
   return [(parent.d*dx-parent.c*dy)/det-first.x,(-parent.b*dx+parent.a*dy)/det-first.y] as const;})();
  const direction=inv?Math.atan2(inv[1],inv[0])/RAD:first.rotationDeg;
  const one={...first,rotationDeg:first.rotationDeg+shortestAngleDelta(first.rotationDeg+first.shearXDeg,direction)*mix};
  const aligned={...second,rotationDeg:second.rotationDeg+shortestAngleDelta(second.rotationDeg,0)*mix};
  const tip=evalTip(one.rotationDeg,aligned.rotationDeg);
  return{first:one,second:aligned,residual:Math.hypot(tip[0]-target[0],tip[1]-target[1])};
 }
 // An unreachable chain points both segments at the target. Without a
 // usable stretch mode, Newton iterations against the impossible target
 // produce a spurious elbow angle instead of the finite straight chain.
 // The 4.1 reference keeps a straight-chain fallback when the original
 // target exceeds reach, even if softness has an internal reachable goal.
 if(distance>reach+1e-8&&!canStretch){
  const aligned=solveOneLink({parentBasis:parent,world:firstWorld,local:first,
   inheritance:input.firstInheritance,target,mix,
   compress:false,stretch:false,uniform:false});
  const follower={...second,rotationDeg:second.rotationDeg+
   shortestAngleDelta(second.rotationDeg,0)*mix};
  const tip=evalTip(aligned.rotationDeg,follower.rotationDeg);
  return {first:aligned,second:follower,
   residual:Math.hypot(tip[0]-target[0],tip[1]-target[1])};
 }
 const initial=first.rotationDeg;
 const candidates:{r1:number;r2:number;err:number;score:number}[]=[];
 for(const elbow of [30,75,125,170])for(const shift of [-150,-60,0,60,150]){
  let r1=initial+shift,r2=second.rotationDeg+bend*elbow;
  for(let j=0;j<45;j++){
   const [x,y]=evalTip(r1,r2),ex=x-targetGoal[0],ey=y-targetGoal[1];
   if(ex*ex+ey*ey<1e-14)break;
   const h=.0005;
   const [x1,y1]=evalTip(r1+h,r2),[x2,y2]=evalTip(r1,r2+h);
   const a=(x1-x)/h,b=(x2-x)/h,c=(y1-y)/h,d=(y2-y)/h,det=a*d-b*c;
   if(Math.abs(det)<1e-13){const lambda=.05;r1-=lambda*(a*ex+c*ey);r2-=lambda*(b*ex+d*ey);continue;}
   const dr1=Math.max(-40,Math.min(40,(d*ex-b*ey)/det));
   const dr2=Math.max(-40,Math.min(40,(-c*ex+a*ey)/det));
   r1-=dr1;r2-=dr2;
  }
  // Newton iterations solve the softened target. Ranking against the
  // original unsoftened target would select a worse IK pose when softness
  // moves the goal substantially (particularly with multiple elbows).
  const [x,y]=evalTip(r1,r2),err=Math.hypot(x-targetGoal[0],y-targetGoal[1]);
  const elbowAngle=wrap(r2+second.shearXDeg);
  const valid=Math.sin(elbowAngle*RAD)*bend>=-1e-6;
  const deviation=Math.abs(shortestAngleDelta(initial,r1))+.03*Math.abs(shortestAngleDelta(second.rotationDeg,r2));
  candidates.push({r1,r2,err,score:err*1000+deviation+(valid?0:10000)});
 }
 candidates.sort((a,b)=>a.score-b.score);
 const best=candidates[0]!;
 return{first:{...workingFirst,scaleX:first.scaleX+(workingFirst.scaleX-first.scaleX)*mix,scaleY:first.scaleY+(workingFirst.scaleY-first.scaleY)*mix,rotationDeg:first.rotationDeg+shortestAngleDelta(first.rotationDeg,best.r1)*mix},
  second:{...second,rotationDeg:second.rotationDeg+shortestAngleDelta(second.rotationDeg,best.r2)*mix},residual:best.err};
}


// Single-bone IK is solved in parent space: aiming a world-space angle is
// incorrect when the parent has nonuniform scale or reflection.
export type OneLinkInput={parentBasis:Affine|null;world:Affine;local:Transform;
 inheritance:Inheritance;target:[number,number];mix:number;
 compress:boolean;stretch:boolean;uniform:boolean};
export function solveOneLink(input:OneLinkInput):Transform{
 const {world,local,target,mix}=input;
 if(mix===0)return {...local};
 const parent=input.parentBasis??identity;
 const dx=target[0]-world.x,dy=target[1]-world.y;
 const det=parent.a*parent.d-parent.b*parent.c;
 let x=dx,y=dy;
 if(Math.abs(det)>1e-12&&input.inheritance==='normal'){
  x=(parent.d*dx-parent.c*dy)/det;
  y=(-parent.b*dx+parent.a*dy)/det;
 }
 let desired=Math.atan2(y,x)/RAD;
 if(local.scaleX<0)desired+=180;
 const source=local.rotationDeg+local.shearXDeg;
 const out:Transform={...local,rotationDeg:local.rotationDeg+shortestAngleDelta(source,desired)*mix};
 if((input.compress||input.stretch)&&local.scaleX>0&&Math.abs(local.length)>1e-10){
  // Reach-scale decisions use the fully aimed axis even for a partial mix.
  const aimed={...local,rotationDeg:local.rotationDeg+shortestAngleDelta(source,desired)};
  const updated=inheritTransform(parent,aimed,input.inheritance);
  const currentLength=Math.abs(local.length)*Math.hypot(updated.a,updated.b);
  if(currentLength>1e-10){
   const targetLength=Math.hypot(dx,dy);
   const factor=targetLength/currentLength;
   if(factor<1&&input.compress||factor>1&&input.stretch){
    const adjusted=1+(factor-1)*mix;
    out.scaleX*=adjusted;
    if(input.uniform)out.scaleY*=adjusted;
   }
  }
 }
 return out;
}
