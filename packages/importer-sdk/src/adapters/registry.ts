import {EngineError,requireCondition,validateIR} from '@riglyph/core';
import type {IRDocument,AtlasPage,AtlasRegion} from '@riglyph/core';
import {sha256} from '../sha256.js';
export type Probe={family:string;version:string};
export type DetectedIdentity=Probe & {confidence:'confirmed'|'tentative';detectorId:string};
export type FormatDetector={id:string;maxProbeBytes?:number;inspect(bytes:Uint8Array,source:string):DetectedIdentity|null};
export type ImportInput={bytes:Uint8Array;source:string;atlas?:{pages:AtlasPage[];regions:AtlasRegion[]}};
export type ImportReport={status:'verified-synthetic'|'unverified';sourceFormat:string;sourceVersion:string;adapterVersion:string;irSchema:string;sourceSha256:string;featureCoverage:string[];warnings:string[];losses:string[];unsupported:string[];bytesConsumed:number};
export type ImportResult={ir:IRDocument;report:ImportReport};
export type WireDiagnostics={sourceVersion:string;bytesConsumed:number;inputLength:number;[key:string]:unknown};
export type ImporterManifest={id:string;packageVersion:string;formatFamilies:readonly string[];supportedSourceVersions:readonly string[];producedIrSchemaVersions:readonly string[];capabilities:readonly string[];license:string};
/** Legacy shape remains supported so existing format plugins keep working. */
export type ImportAdapter={id:string;family:string;acceptedVersions:readonly string[];adapterVersion:string;probe(bytes:Uint8Array,source:string):Probe|null;import(input:ImportInput):ImportResult;manifest?:ImporterManifest;wire?(bytes:Uint8Array,source:string):WireDiagnostics;inspectHeader?(bytes:Uint8Array,source:string):unknown};

/** A hash prefix has no verified magic signature. We classify an incomplete
 * header as truncated only if its visible version prefix is convincing; a
 * random 9th byte alone is not evidence of a Spine-family file. */
export const spineBinaryDetector:FormatDetector={id:'spine-binary-header-v1',maxProbeBytes:4096,inspect(bytes,source){
 if(bytes.length<10)return null;
 let pos=8,shift=0,length=0,ended=false;
 for(let i=0;i<5;i++){
  if(pos>=bytes.length)return null;
  const b=bytes[pos++]!;length+=(b&127)*2**shift;
  if((b&128)===0){ended=true;break;}shift+=7;
 }
 if(!ended||length<4||length>65)return null;
 const available=bytes.subarray(pos,Math.min(bytes.length,pos+length-1));
 let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(available);}catch{return null;}
 const version=raw.startsWith('\0')?raw.slice(1):raw;
 // A partial version which already contains a digit-dot-digit prefix is
 // sufficiently distinctive to report truncation, unlike random bytes.
 if(pos+length-1>bytes.length){
  if(/^\d{1,3}\.\d{1,3}(?:\.\d{0,3})?$/.test(version))
   throw new EngineError('TRUNCATED_INPUT','Recognized Spine-family version string is truncated',{source,offset:bytes.length});
  return null;
 }
 if(!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version))return null;
 return {family:'spine-binary',version,confidence:version==='4.1.23'?'confirmed':'tentative',detectorId:this.id};
}};
export const syntheticDetector:FormatDetector={id:'synthetic-json-v1',maxProbeBytes:8*1024*1024,inspect(bytes){
 if(bytes.length<2||bytes[0]!==123)return null;
 try{const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Record<string,unknown>;
  if(data.kind!=='clean-room-synthetic'||typeof data.version!=='string')return null;
  return {family:'synthetic-test',version:data.version,confidence:'confirmed',detectorId:this.id};
 }catch{return null;}
}};
/** ESM plugin module contract. Only explicitly trusted modules may be loaded. */
export type ImporterPluginModule={importerPlugin:ImportAdapter;detector?:FormatDetector;detectors?:readonly FormatDetector[]};
const maxDetectorBytes=8*1024*1024;
function assertDetector(detector:FormatDetector):void{
 requireCondition(!!detector&&typeof detector==='object'&&typeof detector.id==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(detector.id)&&typeof detector.inspect==='function','INVALID_HEADER','Invalid plugin detector');
 requireCondition(detector.maxProbeBytes===undefined||(Number.isSafeInteger(detector.maxProbeBytes)&&detector.maxProbeBytes>=1&&detector.maxProbeBytes<=maxDetectorBytes),'LIMIT_EXCEEDED','Detector probe size must be 1..8388608 bytes');
}
function assertAdapter(adapter:ImportAdapter):void{
 requireCondition(!!adapter&&typeof adapter==='object'&&typeof adapter.id==='string'&&adapter.id.length>0&&typeof adapter.family==='string'&&adapter.family.length>0&&typeof adapter.adapterVersion==='string'&&typeof adapter.probe==='function'&&typeof adapter.import==='function'&&Array.isArray(adapter.acceptedVersions),'INVALID_HEADER','Invalid importerPlugin export');
 requireCondition(adapter.acceptedVersions.length>0&&adapter.acceptedVersions.every(v=>typeof v==='string'&&v.length>0)&&new Set(adapter.acceptedVersions).size===adapter.acceptedVersions.length,'UNSUPPORTED_VERSION',`Adapter must declare a unique version allowlist: ${adapter.id}`);
 if(adapter.manifest)requireCondition(adapter.manifest.id===adapter.id&&Array.isArray(adapter.manifest.formatFamilies)&&adapter.manifest.formatFamilies.includes(adapter.family)&&Array.isArray(adapter.manifest.supportedSourceVersions)&&adapter.acceptedVersions.every(v=>adapter.manifest!.supportedSourceVersions.includes(v))&&Array.isArray(adapter.manifest.producedIrSchemaVersions)&&adapter.manifest.producedIrSchemaVersions.includes('1.0.0'),'INVALID_HEADER','Adapter manifest is inconsistent');
}
export class AdapterRegistry{
 private readonly adapters=new Map<string,ImportAdapter>();
 private readonly detectors=new Map<string,FormatDetector>();
 constructor(detectors:FormatDetector[]=[spineBinaryDetector,syntheticDetector]){for(const d of detectors)this.registerDetector(d);}
 registerDetector(detector:FormatDetector):void{assertDetector(detector);requireCondition(!this.detectors.has(detector.id),'INVALID_REFERENCE',`Duplicate detector ${detector.id}`);this.detectors.set(detector.id,detector);}
 register(adapter:ImportAdapter):void{assertAdapter(adapter);requireCondition(!this.adapters.has(adapter.id),'INVALID_REFERENCE',`Adapter already registered: ${adapter.id}`);this.adapters.set(adapter.id,adapter);}
 /** Atomic registration: malformed detector exports must not leave an adapter installed. */
 registerModule(module:unknown):void{
  requireCondition(!!module&&typeof module==='object','INVALID_HEADER','Plugin module must export importerPlugin');
  const record=module as Record<string,unknown>,adapter=record['importerPlugin'] as ImportAdapter;
  assertAdapter(adapter);
  const detectors:FormatDetector[]=[];
  if(record['detector']!==undefined)detectors.push(record['detector'] as FormatDetector);
  if(record['detectors']!==undefined){requireCondition(Array.isArray(record['detectors']),'INVALID_HEADER','detectors export must be an array');detectors.push(...record['detectors'] as FormatDetector[]);}
  for(const detector of detectors)assertDetector(detector);
  requireCondition(new Set(detectors.map(d=>d.id)).size===detectors.length&&detectors.every(d=>!this.detectors.has(d.id)),'INVALID_REFERENCE','Conflicting plugin detector IDs');
  requireCondition(!this.adapters.has(adapter.id),'INVALID_REFERENCE',`Adapter already registered: ${adapter.id}`);
  // Every advertised custom family must have a detector, either built-in or explicitly supplied.
  // Preserve legacy plugins for a built-in family without requiring detector duplication.
  for(const detector of detectors)this.registerDetector(detector);
  this.register(adapter);
 }
 unregister(id:string):boolean{return this.adapters.delete(id);}
 list():readonly ImporterManifest[]{return [...this.adapters.values()].map(a=>a.manifest??{id:a.id,packageVersion:a.adapterVersion,formatFamilies:[a.family],supportedSourceVersions:a.acceptedVersions,producedIrSchemaVersions:['1.0.0'],capabilities:[],license:'UNDECLARED'}).sort((a,b)=>a.id.localeCompare(b.id));}
 detect(bytes:Uint8Array,source='input'):DetectedIdentity{
  requireCondition(bytes.byteLength<=64*1024*1024,'LIMIT_EXCEEDED','Adapter input exceeds 64 MiB',{source});
  const matches:DetectedIdentity[]=[];const errors:EngineError[]=[];
  for(const detector of [...this.detectors.values()].sort((a,b)=>a.id.localeCompare(b.id))){
   try{
    const identity=detector.inspect(bytes.subarray(0,Math.min(bytes.length,detector.maxProbeBytes??4096)),source);
    if(identity){requireCondition(identity.detectorId===detector.id&&typeof identity.family==='string'&&identity.family.length>0&&typeof identity.version==='string'&&identity.version.length>0&&['confirmed','tentative'].includes(identity.confidence),'IMPORTER_PROBE_FAILED',`Detector ${detector.id} returned invalid identity`,{source});matches.push(identity);}
   }catch(e){if(e instanceof EngineError)errors.push(e);else throw new EngineError('IMPORTER_PROBE_FAILED',`Detector ${detector.id} failed`,{source});}
  }
  const signatures=[...new Set(matches.map(p=>`${p.family}@${p.version}`))].sort();
  if(signatures.length>1)throw new EngineError('AMBIGUOUS_IMPORTER',`Conflicting format detectors: ${signatures.join(', ')}`,{source});
  if(matches.length)return [...matches].sort((a,b)=>(a.confidence==='confirmed'?-1:1)-(b.confidence==='confirmed'?-1:1)||a.detectorId.localeCompare(b.detectorId))[0]!;
  if(errors.length)throw errors.sort((a,b)=>a.code.localeCompare(b.code)||a.message.localeCompare(b.message))[0]!;
  throw new EngineError('UNRECOGNIZED_FORMAT','No recognized family/version header',{source});
 }
 probe(bytes:Uint8Array,source='input'):Probe{const {family,version}=this.detect(bytes,source);return {family,version};}
 /** Read-only availability check; detection does not imply support. */
 compatible(identity:Probe):ImportAdapter|null{
  const matches=[...this.adapters.values()].filter(a=>a.family===identity.family&&a.acceptedVersions.includes(identity.version)).sort((a,b)=>a.id.localeCompare(b.id));
  if(matches.length>1)throw new EngineError('AMBIGUOUS_IMPORTER',`More than one compatible plugin for ${identity.family} ${identity.version}: ${matches.map(a=>a.id).join(', ')}`);
  return matches[0]??null;
 }
 resolve(identity:Probe):ImportAdapter{
  const adapter=this.compatible(identity);
  if(!adapter)throw new EngineError('UNSUPPORTED_VERSION',`No certified plugin for ${identity.family} ${identity.version}; available: ${this.list().map(x=>`${x.id}(${x.supportedSourceVersions.join(',')})`).join(', ')||'none'}`);
  return adapter;
 }
 import(input:ImportInput):ImportResult{
  const identity=this.probe(input.bytes,input.source);const adapter=this.resolve(identity);
  let result:ImportResult;
  try{result=adapter.import(input);}catch(e){if(e instanceof EngineError)throw e;throw new EngineError('IMPORTER_PROBE_FAILED',`Importer ${adapter.id} failed: ${String(e)}`,{source:input.source});}
  validateIR(result.ir);
  requireCondition(result.report.losses.length===0&&result.report.unsupported.length===0,'UNSUPPORTED_SEMANTIC_FEATURE','Importer returned losses',{source:input.source});
  requireCondition(result.report.bytesConsumed===input.bytes.length,'INVALID_HEADER','Decoder did not consume entire input',{source:input.source,offset:result.report.bytesConsumed});
  requireCondition(result.report.sourceVersion===identity.version,'INVALID_HEADER','Plugin source version mismatch',{source:input.source});
  requireCondition(result.report.sourceSha256===sha256(input.bytes),'INVALID_HEADER','Incorrect imported source digest',{source:input.source});
  return result;
 }
 wire(input:Uint8Array,source='input'):WireDiagnostics{
  const adapter=this.resolve(this.probe(input,source));
  requireCondition(adapter.wire,'UNSUPPORTED_SEMANTIC_FEATURE',`Plugin ${adapter.id} does not support wire diagnostics`);
  return adapter.wire(input,source);
 }
 header(input:Uint8Array,source='input'):unknown{
  const adapter=this.resolve(this.probe(input,source));
  requireCondition(adapter.inspectHeader,'UNSUPPORTED_SEMANTIC_FEATURE',`Plugin ${adapter.id} does not support header inspection`);
  return adapter.inspectHeader(input,source);
 }
}
export const ImporterRegistry=AdapterRegistry;
export const syntheticAdapter:ImportAdapter={
 id:'synthetic-fixture',family:'synthetic-test',acceptedVersions:['1.0.0'],adapterVersion:'0.8.0',
 manifest:{id:'synthetic-fixture',packageVersion:'0.8.0',formatFamilies:['synthetic-test'],supportedSourceVersions:['1.0.0'],producedIrSchemaVersions:['1.0.0'],capabilities:['independent-test-format'],license:'MIT'},
 probe(bytes){return syntheticDetector.inspect(bytes,'input');},
 import(input){
  let data:{ir:unknown};try{data=JSON.parse(new TextDecoder().decode(input.bytes)) as {ir:unknown};}catch{throw new EngineError('INVALID_HEADER','Invalid synthetic JSON');}
  validateIR(data.ir);const ir=structuredClone(data.ir);
  ir.source={family:'synthetic-test',version:'1.0.0',sha256:sha256(input.bytes),adapter:'synthetic-fixture',adapterVersion:'0.8.0'};
  return {ir,report:{status:'verified-synthetic',sourceFormat:'synthetic-test',sourceVersion:'1.0.0',adapterVersion:'0.8.0',irSchema:ir.schemaVersion,sourceSha256:sha256(input.bytes),featureCoverage:[...ir.capabilities],warnings:[],losses:[],unsupported:[],bytesConsumed:input.bytes.length}};
 }
};
