import {EngineError,requireCondition} from '@riglyph/core';
/** Independent frame-selection policy. Source-reference equivalence is not yet established. */
export type SequenceMode='hold'|'once'|'loop'|'pingpong'|'onceReverse'|'loopReverse'|'pingpongReverse';
export type SequencePlayback={mode:SequenceMode;index:number;delay:number;attachmentId:string};
const positiveMod=(v:number,n:number)=>(v%n+n)%n;
export function sequenceFrame(count:number,mode:SequenceMode,startIndex:number,elapsed:number,delay:number):number {
 requireCondition(Number.isInteger(count)&&count>0&&Number.isInteger(startIndex)&&Number.isFinite(elapsed)&&Number.isFinite(delay)&&delay>0,'INVALID_TIMELINE','Invalid sequence playback parameters');
 const step=Math.max(0,Math.floor(Math.max(0,elapsed)/delay));
 const ping=(n:number):number=>{const period=Math.max(1,2*(count-1)),v=positiveMod(n,period);return v<count?v:period-v;};
 switch(mode){
  case 'hold':return Math.min(count-1,Math.max(0,startIndex));
  case 'once':return Math.min(count-1,Math.max(0,startIndex+step));
  case 'loop':return positiveMod(startIndex+step,count);
  case 'pingpong':return ping(startIndex+step);
  case 'onceReverse':return Math.max(0,Math.min(count-1,count-1-startIndex-step));
  case 'loopReverse':return positiveMod(count-1-startIndex-step,count);
  case 'pingpongReverse':return ping(count-1-startIndex-step);
  default:throw new EngineError('UNSUPPORTED_SEMANTIC_FEATURE',`Sequence mode ${mode} has no evaluator`);
 }
}
