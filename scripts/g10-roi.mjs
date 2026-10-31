/** Pure, deterministic ROI/diff instrumentation. Two buffers are NOT proof of official reference provenance. */
import {createHash} from 'node:crypto';
import {ConformanceError} from './g6-conformance.mjs';
const requireValue=(ok,message)=>{if(!ok)throw new ConformanceError('INVALID_SCENARIO',message);};
export function compareRgbaRoi(reference,candidate,{width,height,roi={x:0,y:0,width,height},alphaThreshold=0,absTolerance=0}={}){
 requireValue(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width*height<=1048576,'Invalid ROI frame dimension');
 requireValue(reference instanceof Uint8Array&&candidate instanceof Uint8Array&&reference.length===width*height*4&&candidate.length===reference.length,'RGBA buffers must have exactly width*height*4 bytes');
 requireValue(['x','y','width','height'].every(k=>Number.isSafeInteger(roi[k]))&&roi.x>=0&&roi.y>=0&&roi.width>0&&roi.height>0&&roi.x+roi.width<=width&&roi.y+roi.height<=height,'ROI is out of frame bounds');
 requireValue(Number.isSafeInteger(alphaThreshold)&&alphaThreshold>=0&&alphaThreshold<=255&&Number.isSafeInteger(absTolerance)&&absTolerance>=0&&absTolerance<=255,'Invalid ROI comparison threshold');
 let maxAbsDelta=0,mismatchedChannels=0,mismatchedPixels=0,alphaIntersection=0,alphaUnion=0,refVisible=0,candidateVisible=0;
 let left=width,top=height,right=-1,bottom=-1;
 for(let y=roi.y;y<roi.y+roi.height;y++)for(let x=roi.x;x<roi.x+roi.width;x++){
  const offset=(y*width+x)*4;let differs=false;
  for(let c=0;c<4;c++){const d=Math.abs(reference[offset+c]-candidate[offset+c]);maxAbsDelta=Math.max(maxAbsDelta,d);if(d>absTolerance){mismatchedChannels++;differs=true;}}
  if(differs)mismatchedPixels++;
  const r=reference[offset+3]>alphaThreshold,k=candidate[offset+3]>alphaThreshold;
  if(r)refVisible++;if(k)candidateVisible++;
  if(r&&k)alphaIntersection++;if(r||k)alphaUnion++;
  if(k){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
 }
 const sha=b=>createHash('sha256').update(b).digest('hex');
 return {format:'riglyph-g10-untrusted-roi-measurement-v1',referenceStatus:'UNVERIFIED_NO_REFERENCE',referenceVerified:false,
  roi,alphaThreshold,absTolerance,pixels:roi.width*roi.height,mismatchedPixels,mismatchedChannels,maxAbsDelta,
  referenceAlphaPixels:refVisible,candidateAlphaPixels:candidateVisible,alphaIoU:alphaUnion?alphaIntersection/alphaUnion:1,
  candidateAlphaBounds:right<left?null:{left,top,right,bottom},referenceArtifactSha256:sha(reference),candidateArtifactSha256:sha(candidate)};
}
