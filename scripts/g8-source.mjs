/** G8 source/IR identity policy. Candidate data cannot establish reference truth. */
import {createHash} from 'node:crypto';
import {createReadStream,statSync,readFileSync} from 'node:fs';
import {spine41Adapter} from '@riglyph/importer-spine-4.1';
import {resolve} from 'node:path';
import {ConformanceError,digest} from './g6-conformance.mjs';
const requireIdentity=(test,code)=>{if(!test)throw new ConformanceError(code,'Candidate source identity mismatch or incomplete provenance');};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(x);
export async function hashOriginalFile(path){
 let st;try{st=statSync(path);}catch{throw new ConformanceError('SOURCE_IDENTITY_UNVERIFIED','Original source file not accessible');}requireIdentity(st.isFile()&&st.size>0&&st.size<=32*1024*1024,'LIMIT_EXCEEDED');
 const hash=createHash('sha256');let total=0;
 for await(const chunk of createReadStream(path,{highWaterMark:64*1024})){
  total+=chunk.length;requireIdentity(total<=st.size,'SOURCE_DIGEST_MISMATCH');hash.update(chunk);
 }
 requireIdentity(total===st.size,'SOURCE_DIGEST_MISMATCH');return hash.digest('hex');
}
export function validateSourceDeclaration(scenario){
 const authenticated=scenario.fixtureOrigin!=='DERIVED_ONLY';
 const target=scenario.targetCompatibilityVersion??scenario.sourceVersion;
 requireIdentity(validId(target),'INVALID_SCENARIO');
 if(authenticated){
  requireIdentity(validId(scenario.sourceFamily)&&validId(scenario.adapterId)&&validId(scenario.observedSourceVersion),'SOURCE_IDENTITY_UNVERIFIED');
  requireIdentity(hex(scenario.originalSourceSha256)&&hex(scenario.irArtifactSha256),'SOURCE_IDENTITY_UNVERIFIED');
  requireIdentity(scenario.observedSourceVersion===target,'SOURCE_VERSION_MISMATCH');
  requireIdentity(scenario.sourceVersion===undefined||scenario.sourceVersion===scenario.observedSourceVersion,'SOURCE_VERSION_MISMATCH');
  requireIdentity(scenario.sourceArtifactSha256===undefined||scenario.sourceArtifactSha256===scenario.irArtifactSha256,'SOURCE_DIGEST_MISMATCH');
  requireIdentity(hex(scenario.sampleLayoutSha256)||scenario.gate==='G3','SAMPLE_LAYOUT_UNVERIFIED');
 }else{
  // A derived experiment may target a compatibility version, never observe or verify an original source.
  requireIdentity(!scenario.observedSourceVersion&&!scenario.originalSourceSha256&&!scenario.adapterId,'SOURCE_IDENTITY_UNVERIFIED');
  requireIdentity(!scenario.sourceVersion||!scenario.targetCompatibilityVersion||scenario.sourceVersion===scenario.targetCompatibilityVersion,'SOURCE_VERSION_MISMATCH');
  requireIdentity(!scenario.irArtifactSha256||hex(scenario.irArtifactSha256),'INVALID_SCENARIO');
 }
 return {authenticated,targetCompatibilityVersion:target,irArtifactSha256:scenario.irArtifactSha256??scenario.sourceArtifactSha256};
}
export async function checkSourceIdentity(scenario,ir,irBytes,assets,baseDir){
 const declared=validateSourceDeclaration(scenario),irSha256=digest(irBytes);
 requireIdentity(hex(declared.irArtifactSha256)&&irSha256===declared.irArtifactSha256,'SOURCE_DIGEST_MISMATCH');
 if(declared.authenticated){
  requireIdentity(typeof assets.originalSource==='string'&&assets.originalSource.length>0,'SOURCE_IDENTITY_UNVERIFIED');
  requireIdentity(ir.source?.family===scenario.sourceFamily&&ir.source.version===scenario.observedSourceVersion,'SOURCE_VERSION_MISMATCH');
  requireIdentity(ir.source?.adapter===scenario.adapterId&&(!scenario.adapterVersion||ir.source.adapterVersion===scenario.adapterVersion),'SOURCE_ADAPTER_MISMATCH');
  requireIdentity(ir.source?.sha256===scenario.originalSourceSha256,'SOURCE_DIGEST_MISMATCH');
  const path=resolve(baseDir,assets.originalSource);
  requireIdentity(await hashOriginalFile(path)===scenario.originalSourceSha256,'SOURCE_DIGEST_MISMATCH');
  // A hash claim alone is not enough: an authorized Spine-binary declaration must
  // point to a complete decodable file of the exact declared version.
  requireIdentity(scenario.sourceFamily==='spine-binary'&&scenario.adapterId==='spine-binary-4.1','SOURCE_IDENTITY_UNVERIFIED');
  try {
   const bytes=readFileSync(path),wire=spine41Adapter.wire(bytes,'authorized-source');
   requireIdentity(wire.sourceVersion===scenario.observedSourceVersion&&wire.bytesConsumed===bytes.length,'SOURCE_VERSION_MISMATCH');
  }catch(e){if(e instanceof ConformanceError)throw e;throw new ConformanceError('SOURCE_IDENTITY_UNVERIFIED','Original source is not a complete supported binary');}
 }
 return {targetCompatibilityVersion:declared.targetCompatibilityVersion,observedSourceVersion:declared.authenticated?ir.source.version:null,
  sourceFamily:declared.authenticated?ir.source.family:null,adapterId:declared.authenticated?ir.source.adapter:null,
  originalSourceSha256:declared.authenticated?scenario.originalSourceSha256:null,irArtifactSha256:irSha256,
  sourceIdentityStatus:declared.authenticated?'SOURCE_BINARY_HASH_AND_VERSION_CONSISTENT_NOT_REFERENCE_VERIFIED':'DERIVED_ONLY_TARGET_NOT_OBSERVED'};
}
