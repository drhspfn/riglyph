import {EngineError} from '@riglyph/core';
import type {Interpolation,Keyframe} from '@riglyph/core';
function cubic(a:number,b:number,t:number):number{
 const s=1-t;return 3*s*s*t*a+3*s*t*t*b+t*t*t;
}
function derivative(a:number,b:number,t:number):number{
 const s=1-t;return 3*s*s*a+6*s*t*(b-a)+3*t*t*(1-b);
}
/** Solve x(parameter)=time; y(parameter) is the interpolated value fraction. */
export function bezierFraction(time:number,control:[number,number,number,number]):number{
 if(!Number.isFinite(time)||!control.every(Number.isFinite))
  throw new EngineError('INVALID_TIMELINE','Bezier input must contain finite values');
 const [x1,y1,x2,y2]=control;const x=Math.max(0,Math.min(1,time));
 let t=x;
 for(let i=0;i<8;i++){
  const fx=cubic(x1,x2,t)-x,dx=derivative(x1,x2,t);
  if(Math.abs(fx)<1e-8)return cubic(y1,y2,t);
  if(Math.abs(dx)<1e-7)break;
  const next=t-fx/dx;if(next<0||next>1)break;t=next;
 }
 let lo=0,hi=1;for(let i=0;i<38;i++){t=(lo+hi)/2;if(cubic(x1,x2,t)<x)lo=t;else hi=t;}
 return cubic(y1,y2,(lo+hi)/2);
}
/** A piecewise-linear X-axis inversion of a cubic Bezier sampled at u=0,.1,...,1.
 * The Y axis is an unbounded progress value: overshoot is intentionally retained.
 * This explicit canonical sampling policy is version-neutral. */
export function bezierFractionPolyline10(time:number,control:[number,number,number,number]):number{
 if(!Number.isFinite(time)||!control.every(Number.isFinite))
  throw new EngineError('INVALID_TIMELINE','Bezier sample input must contain finite values');
 const [x1,y1,x2,y2]=control;
 const x=Math.max(0,Math.min(1,time));
 if(x<=0)return 0;if(x>=1)return 1;
 let leftX=0,leftY=0;
 for(let i=1;i<=10;i++){
  const u=i/10,rightX=cubic(x1,x2,u),rightY=cubic(y1,y2,u);
  if(!Number.isFinite(rightX)||!Number.isFinite(rightY))
   throw new EngineError('INVALID_TIMELINE','Bezier sampled point is not finite');
  if(x<=rightX||i===10){
   const span=rightX-leftX;
   if(!Number.isFinite(span)||span<=0)
    throw new EngineError('INVALID_TIMELINE','Bezier sampled time axis has an invalid crossing');
   const value=leftY+(rightY-leftY)*(x-leftX)/span;
   if(!Number.isFinite(value))throw new EngineError('INVALID_TIMELINE','Bezier interpolated value is not finite');
   return value;
  }
  leftX=rightX;leftY=rightY;
 }
 throw new EngineError('INVALID_TIMELINE','Bezier sample X out of range');
}
export function factor(interp:Interpolation,normalizedTime:number,channel:number):number{
 if(!Number.isFinite(normalizedTime))throw new EngineError('INVALID_TIMELINE','Non-finite key progress');
 const t=Math.max(0,Math.min(1,normalizedTime));
 if(interp.kind==='stepped')return 0;
 if(interp.kind==='linear')return t;
 const curve=interp.bezierByChannel?.[channel];if(!curve)throw new EngineError('INVALID_TIMELINE',`Missing Bezier control points for channel ${channel}`);
 if(interp.sampling==='polyline10')return bezierFractionPolyline10(t,curve);
 if(interp.sampling!==undefined)throw new EngineError('INVALID_TIMELINE','Unsupported Bezier sampling policy');
 // Legacy synthetic IR without a sampling policy retains analytic inversion.
 // All Spine 4.1.23 importer curves specify polyline10 explicitly.
 return bezierFraction(t,curve);
}
/** Sparse numeric vectors must have an explicit total size; without it interpolating
 * objects as discrete values would silently corrupt a deform timeline. */
function unpackVector(value:unknown,length:number):number[]{
 if(Array.isArray(value)){
  if(value.length!==length||!value.every(v=>typeof v==='number'&&Number.isFinite(v)))throw new EngineError('INVALID_TIMELINE','Invalid dense deform vector');
  return value as number[];
 }
 if(value!==null&&typeof value==='object'&&'offset' in value&&'values' in value){
  const sparse=value as {offset:unknown;values:unknown};
  if(!Number.isSafeInteger(sparse.offset)||Number(sparse.offset)<0||!Array.isArray(sparse.values)||!sparse.values.every(v=>typeof v==='number'&&Number.isFinite(v))||Number(sparse.offset)+sparse.values.length>length)
   throw new EngineError('INVALID_TIMELINE','Invalid sparse deform vector');
  const dense=new Array<number>(length).fill(0);for(let i=0;i<sparse.values.length;i++)dense[Number(sparse.offset)+i]=sparse.values[i]!;
  return dense;
 }
 throw new EngineError('INVALID_TIMELINE','Deform timeline value must be a numeric vector');
}
export function timelineValue(keys:readonly Keyframe[],time:number,vectorLength?:number):unknown|undefined{
 if(!keys.length)return undefined;
 if(time<keys[0]!.timeSec)return undefined;
 let lo=0,hi=keys.length-1;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(keys[mid]!.timeSec<=time)lo=mid;else hi=mid-1;}
 const a=keys[lo]!;const b=keys[lo+1];
 const previous=vectorLength===undefined?a.value:unpackVector(a.value,vectorLength);
 if(!b||a.timeSec===b.timeSec)return previous;
 const upcoming=vectorLength===undefined?b.value:unpackVector(b.value,vectorLength);
 const f=(channel:number)=>factor(a.interpolation,(time-a.timeSec)/(b.timeSec-a.timeSec),channel);
 if(typeof previous==='number'&&typeof upcoming==='number')return previous+(upcoming-previous)*f(0);
 if(Array.isArray(previous)&&Array.isArray(upcoming)&&previous.every(v=>typeof v==='number')&&upcoming.every(v=>typeof v==='number')){
  if(previous.length!==upcoming.length)throw new EngineError('INVALID_TIMELINE','Numeric key arrays have different lengths');
  const next=upcoming as number[];
  return previous.map((v,i)=>v+(next[i]!-v)*factor(a.interpolation,(time-a.timeSec)/(b.timeSec-a.timeSec),a.interpolation.bezierByChannel?.length===1?0:i));
 }
 if(vectorLength===undefined&&previous!==null&&typeof previous==='object'&&'offset' in previous)
  throw new EngineError('INVALID_TIMELINE','Cannot interpolate sparse deform without declared vector length');
 // Discrete channels: changes take effect at exact key time.
 return previous;
}
