/**
 * Clean-room G6 offline comparison/attestation protocol. Does not read proprietary runtime code.
 * An attestation is NOT automatically trusted: assessment needs an independently provisioned,
 * explicitly reviewed public-key trust policy. Raw reference/candidate values never leave capture.
 */
import {createHash,createPrivateKey,createPublicKey,sign as edSign,verify as edVerify} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export class ConformanceError extends Error {
 constructor(code,message){super(message);this.name='ConformanceError';this.code=code;}
}
const check=(ok,code,message)=>{if(!ok)throw new ConformanceError(code,message);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const unsigned=n=>finite(n)&&n>=0;
const pos=n=>finite(n)&&n>0;
const id=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(s);
const hex=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sorted(v)])):x;
export const canonical=x=>JSON.stringify(sorted(x));
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=o=>JSON.parse(JSON.stringify(o));
const assertKeys=(o,allowed,where)=>{check(o&&typeof o==='object'&&!Array.isArray(o),'INVALID_EVIDENCE',`${where} must be an object`);for(const k of Object.keys(o))check(allowed.includes(k),'INVALID_EVIDENCE',`${where}.${k} is not allowed`);};
export const FEATURE_GROUPS={
 G2:['G2-BONE','G2-WEIGHT','G2-CONSTR','G2-MIX','G2-COVERAGE'],
 G3:['G3-UV','G3-TINT','G3-BLEND','G3-CLIP','G3-WEIGHT','G3-PANORAMA']
};
const needed=(o,k,type)=>check(typeof o[k]===type,'INVALID_SCENARIO',`Missing/invalid ${k}`);
export const validateScenario=sc=>{
 assertKeys(sc,['format','id','gate','feature','sourceVersion','targetCompatibilityVersion','observedSourceVersion','sourceFamily','adapterId','adapterVersion','originalSourceSha256','irArtifactSha256','sampleLayoutSha256','fixtureOrigin','referenceBuild','conditions','comparison','sourceArtifactSha256'],'scenario');
 check(sc.format==='universal-skeleton-conformance-scenario-v1','INVALID_SCENARIO','Bad scenario format');
 check(id(sc.id)&&['G2','G3'].includes(sc.gate)&&FEATURE_GROUPS[sc.gate].includes(sc.feature),'INVALID_SCENARIO','Invalid id/gate/feature');
 check((sc.targetCompatibilityVersion??sc.sourceVersion)==='4.1.23','INVALID_SCENARIO','Target compatibility version must be exactly 4.1.23');
 for(const field of ['originalSourceSha256','irArtifactSha256','sampleLayoutSha256'])if(sc[field]!==undefined)check(hex(sc[field]),'INVALID_SCENARIO',`Invalid ${field}`);
 for(const field of ['observedSourceVersion','sourceFamily','adapterId','adapterVersion'])if(sc[field]!==undefined)check(id(sc[field]),'INVALID_SCENARIO',`Invalid ${field}`);
 check(['AUTHORIZED_SYNTHETIC','AUTHORIZED_PRIVATE','DERIVED_ONLY'].includes(sc.fixtureOrigin),'INVALID_SCENARIO','Fixture origin not identified');
 check(sc.referenceBuild&&id(sc.referenceBuild.id)&&hex(sc.referenceBuild.sha256),'INVALID_SCENARIO','Reference build fingerprint required');
 check(hex(sc.sourceArtifactSha256??sc.irArtifactSha256),'INVALID_SCENARIO','IR artifact SHA-256 required');
 const c=sc.conditions;
 assertKeys(c,['clipId','skinId','timeSec','trackOrder','updateOrder','coordinates','viewport','rendering'],'conditions');
 needed(c,'clipId','string');needed(c,'skinId','string');check(finite(c.timeSec),'INVALID_SCENARIO','Finite timeSec required');
 check(Array.isArray(c.trackOrder)&&c.trackOrder.every(x=>Number.isSafeInteger(x)&&x>=0),'INVALID_SCENARIO','Track order required');
 check(Array.isArray(c.updateOrder)&&c.updateOrder.every(x=>typeof x==='object'&&id(x.method)&&finite(x.timeSec)),'INVALID_SCENARIO','Update order required');
 check(c.coordinates&&['a,b,c,d,x,y'].includes(c.coordinates.matrixOrder)&&['up','down'].includes(c.coordinates.yAxis)&&['degrees','radians'].includes(c.coordinates.rotationUnits)&&id(c.coordinates.globalTransformPolicy),'INVALID_SCENARIO','Explicit coordinates required');
 const q=sc.comparison;
 assertKeys(q,['mode','absTolerance','relTolerance','maxMismatchPixels','minAlphaIoU','alphaThreshold'],'comparison');
 check(unsigned(q.absTolerance)&&unsigned(q.relTolerance),'INVALID_SCENARIO','Tolerances must be predeclared nonnegative finite');
 if(sc.gate==='G2')check(q.mode==='scalar-vector','INVALID_SCENARIO','G2 expects scalar-vector');
 else{
  check(q.mode==='rgba8','INVALID_SCENARIO','G3 expects rgba8');
  const v=c.viewport,r=c.rendering;
  check(v&&[v.left,v.bottom,v.width,v.height].every(finite)&&pos(v.width)&&pos(v.height),'INVALID_SCENARIO','Fixed world viewport required');
  check(r&&Number.isSafeInteger(r.width)&&r.width>0&&r.width<=8192&&Number.isSafeInteger(r.height)&&r.height>0&&r.height<=8192&&r.width*r.height<=1_048_576,'INVALID_SCENARIO','Bounded render dimensions required');
  check(r.dpr===1&&r.autoFit===false&&['nearest','linear'].includes(r.sampling)&&['pma','straight'].includes(r.alphaMode)&&id(r.colorSpace)&&r.colorSpace==='srgb-rgba8-no-conversion','INVALID_SCENARIO','Reproducible sampling/alpha/color settings required');
  check(r.msaa===false&&Array.isArray(r.clearRGBA)&&r.clearRGBA.length===4&&r.clearRGBA.every(x=>Number.isInteger(x)&&x>=0&&x<=255),'INVALID_SCENARIO','MSAA and clear color required');
  check(Number.isInteger(q.alphaThreshold)&&q.alphaThreshold>=0&&q.alphaThreshold<=255&&Number.isSafeInteger(q.maxMismatchPixels)&&q.maxMismatchPixels>=0&&finite(q.minAlphaIoU)&&q.minAlphaIoU>=0&&q.minAlphaIoU<=1,'INVALID_SCENARIO','G3 thresholds must be agreed in advance');
 }
 return sc;
};
const percentile=(arr,p)=>{if(!arr.length)return 0;const a=arr.slice().sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.ceil(arr.length*p)-1)];};
const stats=a=>{let max=0,sum=0;for(const n of a){max=Math.max(max,n);sum+=n;}return {maxAbsDelta:max,meanAbsDelta:sum/(a.length||1),p95AbsDelta:percentile(a,.95),p99AbsDelta:percentile(a,.99)};};
const parseArray=bytes=>{let v;try{v=JSON.parse(bytes.toString('utf8'));}catch{throw new ConformanceError('INVALID_REFERENCE_INPUT','Expected JSON numeric arrays');}check(Array.isArray(v)&&v.length>0&&v.length<=5_000_000&&v.every(finite),'INVALID_REFERENCE_INPUT','Nonempty finite numeric array required');return v;};
export function compareInputs(sc,reference,candidate,{referenceLayout,candidateLayout}={}){
 if(sc.sampleLayoutSha256){
  check(referenceLayout!==undefined&&candidateLayout!==undefined,'SAMPLE_LAYOUT_UNVERIFIED','Reference and candidate sample layouts required');
  const layoutDigest=x=>digest(canonical(x?.layout??x));
  check(layoutDigest(referenceLayout)===sc.sampleLayoutSha256&&layoutDigest(candidateLayout)===sc.sampleLayoutSha256,'SAMPLE_LAYOUT_MISMATCH','Layout identity/order/type mismatch');
 }
 validateScenario(sc);
 if(sc.gate==='G2'){
  const a=parseArray(reference),b=parseArray(candidate);
  check(a.length===b.length,'SAMPLE_LENGTH_MISMATCH','G2 vector dimensions do not match');
  const errors=a.map((r,i)=>Math.abs(r-b[i]));
  const failures=errors.filter((e,i)=>e>sc.comparison.absTolerance+sc.comparison.relTolerance*Math.abs(a[i])).length;
  return {sampleCount:a.length,failures, ...stats(errors),matchesTolerance:failures===0};
 }
 const width=sc.conditions.rendering.width,height=sc.conditions.rendering.height;
 check(reference.length===width*height*4&&candidate.length===reference.length,'SAMPLE_LENGTH_MISMATCH','G3 requires matching RGBA8 dimensions');
 const errors=[],alphaErrors=[];let mismatchPixels=0,both=0,either=0,coverageMismatch=0;
 const t=sc.comparison.alphaThreshold;
 for(let i=0;i<reference.length;i+=4){
  let different=false;
  for(let k=0;k<4;k++){const e=Math.abs(reference[i+k]-candidate[i+k]);errors.push(e);if(e>sc.comparison.absTolerance+sc.comparison.relTolerance*reference[i+k])different=true;}
  if(different)mismatchPixels++;
  const ra=reference[i+3]>=t,ca=candidate[i+3]>=t;
  if(ra||ca)either++;if(ra&&ca)both++;if(ra!==ca)coverageMismatch++;
  alphaErrors.push(Math.abs(reference[i+3]-candidate[i+3]));
 }
 const alphaIoU=either?both/either:1;
 return {sampleCount:width*height*4,pixelCount:width*height,failures:mismatchPixels,mismatchPixels,coverageMismatchPixels:coverageMismatch,alphaIoU,
  ...stats(errors),alphaStats:stats(alphaErrors),
  matchesTolerance:mismatchPixels<=sc.comparison.maxMismatchPixels&&alphaIoU>=sc.comparison.minAlphaIoU};
}
export function capture(sc,reference,candidate,{unsupportedCode,referenceLayout,candidateLayout}={}){
 validateScenario(sc);
 check(!unsupportedCode||unsupportedCode==='UNSUPPORTED_SEMANTIC_FEATURE','INVALID_EVIDENCE','Unsupported must be a typed semantic error');
 if(unsupportedCode){check(!reference&&!candidate,'INVALID_EVIDENCE','Unsupported scenario cannot carry comparison samples');}
 else check(Buffer.isBuffer(reference)&&Buffer.isBuffer(candidate),'INVALID_EVIDENCE','Missing local input buffers');
 const measurements=unsupportedCode?null:compareInputs(sc,reference,candidate,{referenceLayout,candidateLayout});
 return {format:'riglyph-reference-capture-v2',scenarioId:sc.id,gate:sc.gate,feature:sc.feature,
  sourceVersion:sc.observedSourceVersion??sc.sourceVersion??sc.targetCompatibilityVersion,targetCompatibilityVersion:sc.targetCompatibilityVersion??sc.sourceVersion,observedSourceVersion:sc.observedSourceVersion??null,originalSourceSha256:sc.originalSourceSha256??null,irArtifactSha256:sc.irArtifactSha256??sc.sourceArtifactSha256,sampleLayoutSha256:sc.sampleLayoutSha256??null,fixtureOrigin:sc.fixtureOrigin,referenceBuild:clone(sc.referenceBuild),
  sourceArtifactSha256:sc.sourceArtifactSha256??sc.irArtifactSha256,conditionsSha256:digest(canonical(sc.conditions)),comparisonSha256:digest(canonical(sc.comparison)),
  referenceArtifactSha256:reference?digest(reference):null,candidateArtifactSha256:candidate?digest(candidate):null,
  measurement:measurements,unsupportedCode:unsupportedCode||null};
}
export const captureHash=c=>digest(canonical(c));
export function attest(c,review,keyId,privatePem){
 check(c?.format==='riglyph-reference-capture-v2','INVALID_EVIDENCE','Capture format invalid');
 assertKeys(review,['authorizationReviewed','independentVerifier','referenceRunReviewed','reviewId','evidenceIndexDigest'],'review');
 check(id(review.reviewId)&&hex(review.evidenceIndexDigest)&&[review.authorizationReviewed,review.independentVerifier,review.referenceRunReviewed].every(x=>x===true),'UNREVIEWED_PROVENANCE','Attestation must be explicitly approved by verifier');
 check(id(keyId),'INVALID_EVIDENCE','keyId required');
 const payload={domain:'riglyph-g6-reference-attestation-v1',captureSha256:captureHash(c),keyId,review};
 const k=createPrivateKey(privatePem);check(k.asymmetricKeyType==='ed25519','INVALID_EVIDENCE','Ed25519 only');
 const signature=edSign(null,Buffer.from(canonical(payload),'utf8'),k).toString('base64');
 return {format:'riglyph-attested-capture-v2',capture:c,attestation:{...payload,signature}};
}
export function verifyAttestation(obj,trust){
 if(!obj?.attestation)return false;
 if(!trust||trust.format!=='riglyph-reference-trust-v1'||!Array.isArray(trust.keys))return false;
 const a=obj.attestation,c=obj.capture;
 if(!a||a.domain!=='riglyph-g6-reference-attestation-v1'||a.captureSha256!==captureHash(c)||!id(a.keyId)||!a.review||!id(a.review.reviewId)||!hex(a.review.evidenceIndexDigest)||!a.review.authorizationReviewed||!a.review.independentVerifier||!a.review.referenceRunReviewed)return false;
 const key=trust.keys.find(k=>k.keyId===a.keyId&&k.humanApproved===true&&Array.isArray(k.allowedGates)&&k.allowedGates.includes(c.gate));
 if(!key?.publicKeyPem)return false;
 try{
  const k=createPublicKey(key.publicKeyPem);
  if(k.asymmetricKeyType!=='ed25519')return false;
  const {signature,...payload}=a;
  return edVerify(null,Buffer.from(canonical(payload),'utf8'),k,Buffer.from(signature,'base64'));
 }catch{return false;}
}
export function assessBundle(bundle,trust){
 check(bundle&&bundle.format==='riglyph-reference-bundle-v2'&&Array.isArray(bundle.captures)&&bundle.captures.length<=10_000,'INVALID_EVIDENCE','Wrong evidence bundle format');
 check(bundle.requiredFeatures&&typeof bundle.requiredFeatures==='object','INVALID_EVIDENCE','Missing required feature plan');
 for(const obj of bundle.captures){const c=obj?.capture;check(c&&['G2','G3'].includes(c.gate)&&FEATURE_GROUPS[c.gate].includes(c.feature)&&bundle.requiredFeatures[c.gate]?.includes(c.feature),'INVALID_EVIDENCE','Undeclared or malformed evidence feature');}
 const reports={};
 for(const gate of ['G2','G3']){
  const required=bundle.requiredFeatures[gate];
  check(Array.isArray(required)&&required.length>0&&new Set(required).size===required.length&&required.every(f=>FEATURE_GROUPS[gate].includes(f)),'INVALID_EVIDENCE',`${gate}: required feature plan missing/invalid`);
  const family=[];
  for(const feature of required){
   const items=bundle.captures.filter(a=>a?.capture?.gate===gate&&a.capture.feature===feature);
   let status='UNVERIFIED_NO_REFERENCE';let verifiedProvenance=false,matchesTolerance=null,wellFormedEvidence=false;
   if(items.length){
    check(items.length===1,'DUPLICATE_FEATURE',`Duplicate ${feature} capture`);
    const obj=items[0],c=obj.capture;
    check(c.format==='riglyph-reference-capture-v2'&&c.sourceVersion==='4.1.23'&&id(c.scenarioId)&&hex(c.conditionsSha256)&&hex(c.comparisonSha256)&&hex(c.sourceArtifactSha256)&&hex(c.referenceBuild?.sha256),'INVALID_EVIDENCE',`Malformed ${feature} capture`);
    check(c.measurement===null&&c.unsupportedCode==='UNSUPPORTED_SEMANTIC_FEATURE'||c.measurement!==null&&c.unsupportedCode===null,'INVALID_EVIDENCE','Incoherent unsupported/measurement state');
    if(c.measurement){const m=c.measurement;check(Number.isSafeInteger(m.sampleCount)&&m.sampleCount>0&&Number.isSafeInteger(m.failures)&&m.failures>=0&&unsigned(m.maxAbsDelta)&&unsigned(m.p95AbsDelta)&&typeof m.matchesTolerance==='boolean','INVALID_EVIDENCE','Invalid aggregate metrics');}
    wellFormedEvidence=true;
    if(c.unsupportedCode)status='UNSUPPORTED_SEMANTIC_FEATURE';
    else if(c.fixtureOrigin==='DERIVED_ONLY')status='DERIVED_ONLY';
    else{
     verifiedProvenance=verifyAttestation(obj,trust)&&!(c.observedSourceVersion&&!c.sampleLayoutSha256&&c.gate==='G2');
     status=verifiedProvenance?(c.measurement.matchesTolerance?'REFERENCE_VERIFIED_MATCH':'REFERENCE_VERIFIED_MISMATCH'):'REFERENCE_CAPTURED_UNREVIEWED';
     matchesTolerance=verifiedProvenance?c.measurement.matchesTolerance:null;
    }
   }
   family.push({id:feature,status,wellFormedEvidence,verifiedProvenance,matchesTolerance,sampleCount:items[0]?.capture?.measurement?.sampleCount??0});
  }
  const statuses=family.map(f=>f.status);
  const gateStatus=statuses.includes('REFERENCE_VERIFIED_MISMATCH')?'REFERENCE_VERIFIED_MISMATCH':
   required.length===FEATURE_GROUPS[gate].length&&statuses.every(s=>s==='REFERENCE_VERIFIED_MATCH')?'REFERENCE_VERIFIED_MATCH':
   statuses.includes('UNSUPPORTED_SEMANTIC_FEATURE')?'UNSUPPORTED_SEMANTIC_FEATURE':
   statuses.includes('REFERENCE_CAPTURED_UNREVIEWED')?'REFERENCE_CAPTURED_UNREVIEWED':'UNVERIFIED_NO_REFERENCE';
  reports[gate]={status:gateStatus,requiredFeatures:required.length,verifiedFeatures:family.filter(f=>f.verifiedProvenance).length,features:family};
 }
 return {format:'riglyph-reference-assessment-v2',gates:reports,policy:'NO_AUTOMATIC_REFERENCE_TRUST',referenceVerified:reports.G2.status==='REFERENCE_VERIFIED_MATCH'&&reports.G3.status==='REFERENCE_VERIFIED_MATCH'};
}
function usage(){throw new ConformanceError('INVALID_ARGUMENT','Usage: g6-conformance.mjs capture <scenario.json> <reference.{json,rgba}> <candidate.{json,rgba}> <out.json> | unsupported <scenario.json> <out.json> | attest <capture.json> <review.json> <keyId> <private.pem> <out.json> | assess <bundle.json> <out.json> [external-trust.json]');}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
 try{
  const [cmd,...args]=process.argv.slice(2);
  if(cmd==='capture'&&args.length===4){writeFileSync(args[3],JSON.stringify(capture(JSON.parse(readFileSync(args[0],'utf8')),readFileSync(args[1]),readFileSync(args[2])),null,2)+'\n');}
  else if(cmd==='unsupported'&&args.length===2){writeFileSync(args[1],JSON.stringify(capture(JSON.parse(readFileSync(args[0],'utf8')),null,null,{unsupportedCode:'UNSUPPORTED_SEMANTIC_FEATURE'}),null,2)+'\n');}
  else if(cmd==='attest'&&args.length===5){writeFileSync(args[4],JSON.stringify(attest(JSON.parse(readFileSync(args[0],'utf8')),JSON.parse(readFileSync(args[1],'utf8')),args[2],readFileSync(args[3],'utf8')),null,2)+'\n');}
  else if(cmd==='assess'&&(args.length===2||args.length===3)){
   const report=assessBundle(JSON.parse(readFileSync(args[0],'utf8')),args[2]?JSON.parse(readFileSync(args[2],'utf8')):undefined);
   writeFileSync(args[1],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({gates:{G2:report.gates.G2.status,G3:report.gates.G3.status},referenceVerified:report.referenceVerified}));
  }else usage();
 }catch(e){process.stderr.write(JSON.stringify({code:e.code||'UNEXPECTED_ERROR',message:e.message||String(e)})+'\n');process.exitCode=1;}
}
