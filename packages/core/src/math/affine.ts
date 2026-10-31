import {EngineError} from '../errors.js';
import type {Inheritance,Transform,Vec2} from '../ir/types.js';
export type Affine={a:number;b:number;c:number;d:number;x:number;y:number};
export const IDENTITY:Affine={a:1,b:0,c:0,d:1,x:0,y:0};
const rad=(deg:number)=>deg*Math.PI/180;
export function localMatrix(t:Transform):Affine{
 const angleX=rad(t.rotationDeg+t.shearXDeg),angleY=rad(t.rotationDeg+90+t.shearYDeg);
 return {a:Math.cos(angleX)*t.scaleX,b:Math.sin(angleX)*t.scaleX,c:Math.cos(angleY)*t.scaleY,d:Math.sin(angleY)*t.scaleY,x:t.x,y:t.y};
}
export function multiply(p:Affine,l:Affine):Affine{
 return {a:p.a*l.a+p.c*l.b,b:p.b*l.a+p.d*l.b,c:p.a*l.c+p.c*l.d,d:p.b*l.c+p.d*l.d,x:p.a*l.x+p.c*l.y+p.x,y:p.b*l.x+p.d*l.y+p.y};
}
export function apply(m:Affine,x:number,y:number):Vec2{return [m.a*x+m.c*y+m.x,m.b*x+m.d*y+m.y];}
export function invert(m:Affine):Affine{
 const det=m.a*m.d-m.b*m.c;
 if(Math.abs(det)<1e-10)throw new EngineError('INVALID_TOPOLOGY','Singular bone transform cannot be inverted');
 const a=m.d/det,b=-m.b/det,c=-m.c/det,d=m.a/det;
 return {a,b,c,d,x:-(a*m.x+c*m.y),y:-(b*m.x+d*m.y)};
}
const determinant=(m:Affine)=>m.a*m.d-m.b*m.c;
/** Generic 2x2 polar decomposition P=Q*S with positive-semidefinite stretch S. */
export function polarDecompose(p:Affine):{rotation:Affine;stretch:Affine}{
 const u=p.a*p.a+p.b*p.b,v=p.a*p.c+p.b*p.d,w=p.c*p.c+p.d*p.d;
 const root=Math.sqrt(Math.max(0,u*w-v*v)),denom=Math.sqrt(u+w+2*root);
 if(denom<1e-10)throw new EngineError('INVALID_TOPOLOGY','Zero parent basis cannot decompose');
 const stretch:Affine={a:(u+root)/denom,b:v/denom,c:v/denom,d:(w+root)/denom,x:0,y:0};
 const inv=invert(stretch);const rotation=multiply({...p,x:0,y:0},inv);return {rotation,stretch};
}
/** Normalized transform semantics, independent of source version. Alternative modes require differential verification. */
export function inheritTransform(parent:Affine,local:Transform,mode:Inheritance):Affine{
 const l=localMatrix(local);
 if(mode==='normal')return multiply(parent,l);
 const translation=apply(parent,l.x,l.y);
 let basis:Affine;
 switch(mode){
  case 'only_translation':basis=IDENTITY;break;
  case 'no_rotation_or_reflection':basis=polarDecompose(parent).stretch;break;
  case 'no_scale':basis=polarDecompose(parent).rotation;break;
  case 'no_scale_or_reflection':{
   const polar=polarDecompose(parent).rotation;
   const angle=determinant(polar)<0?Math.atan2(polar.b,polar.a):Math.atan2(polar.b-polar.c,polar.a+polar.d);
   basis={a:Math.cos(angle),b:Math.sin(angle),c:-Math.sin(angle),d:Math.cos(angle),x:0,y:0};break;
  }
 }
 const world=multiply(basis,l);world.x=translation[0];world.y=translation[1];return world;
}
export function shortestAngleDelta(a:number,b:number):number{return ((b-a+540)%360+360)%360-180;}
export function mixAngle(a:number,b:number,alpha:number):number{return a+shortestAngleDelta(a,b)*alpha;}
