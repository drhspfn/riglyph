import {requireCondition} from '@riglyph/core';
import {BinaryReader} from './binary-reader.js';
import {decodeSpine41} from './spine41-wire.js';
import {normalizeSpine41} from './spine41-normalize.js';
import {sha256} from '@riglyph/importer-sdk';
import type {ImportAdapter,Probe} from '@riglyph/importer-sdk';

export type Spine41Header={hash:string;version:string;bounds:[number,number,number,number];nonessential:boolean;fps?:number;imagesPath?:string|null;audioPath?:string|null;stringTable:string[];boneCount:number;bodyOffset:number;inputLength:number};
function prefix(bytes:Uint8Array,source:string):{reader:BinaryReader;hash:string;version:string}{
 const r=new BinaryReader(bytes,source),hash=Array.from(r.bytes(8),b=>b.toString(16).padStart(2,'0')).join('');
 const version=r.utf8();requireCondition(version!==null&&/^\d+\.\d+\.\d+$/.test(version),'INVALID_HEADER','Invalid binary Spine version',r.at());return {reader:r,version,hash};
}
export function probeSpineBinary(bytes:Uint8Array,source='input'):Probe|null{
 if(bytes.length<14)return null;
 try{const {version}=prefix(bytes,source);return {family:'spine-binary',version};}catch{return null;}
}
/** This function requires a complete header and string table, but not necessarily a complete body. */
export function inspectSpine41Header(bytes:Uint8Array,source='input'):Spine41Header {
 const {version,hash,reader:r}=prefix(bytes,source);
 requireCondition(version==='4.1.23','UNSUPPORTED_VERSION',`Expected 4.1.23; got ${version}`,r.at());
 const bounds:[number,number,number,number]=[r.f32(),r.f32(),r.f32(),r.f32()];
 const nonessential=r.bool(),extras=nonessential?{fps:r.f32(),imagesPath:r.utf8(),audioPath:r.utf8()}:{};
 const count=r.uvarint();requireCondition(count<=100_000,'LIMIT_EXCEEDED','String table too large',r.at());
 const stringTable:string[]=[];for(let i=0;i<count;i++){const item=r.requiredString();requireCondition(!!item,'INVALID_REFERENCE','Empty dictionary string',r.at());stringTable.push(item);}
 const boneCount=r.uvarint();requireCondition(boneCount>0&&boneCount<=100_000,'LIMIT_EXCEEDED','Invalid bone count',r.at());
 return {hash,version,bounds,nonessential,...extras,stringTable,boneCount,bodyOffset:r.offset,inputLength:r.length};
}
export const spine41Adapter:ImportAdapter={
 id:'spine-binary-4.1',family:'spine-binary',acceptedVersions:['4.1.23'],adapterVersion:'0.12.0',
 manifest:{id:'spine-binary-4.1',packageVersion:'0.12.0',formatFamilies:['spine-binary'],supportedSourceVersions:['4.1.23'],producedIrSchemaVersions:['1.0.0'],capabilities:['binary-decode','ir-normalization','wire-diagnostics'],license:'MIT'},
 wire(bytes,source){const parsed=decodeSpine41(bytes,source);return {status:'unverified',sourceVersion:parsed.version,bytesConsumed:parsed.bytesConsumed,inputLength:bytes.length,nonessential:parsed.nonessential,sections:parsed.sections,counts:{bones:parsed.bones.length,slots:parsed.slots.length,constraints:parsed.constraints.length,skins:parsed.skins.length,attachments:parsed.skins.reduce((n,s)=>n+s.entries.length,0),events:parsed.events.length,animations:parsed.animations.length,timelines:parsed.animations.reduce((n,a)=>n+a.timelines.length,0)},clips:parsed.animations.map(a=>({name:a.name,durationSec:a.duration,timelines:a.timelines.length,declared:a.declaredTimelines}))};},
 inspectHeader(bytes,source){return inspectSpine41Header(bytes,source);},
 probe(bytes,source){return probeSpineBinary(bytes,source);},
 import(input){
  const parsed=decodeSpine41(input.bytes,input.source);
  const ir=normalizeSpine41(parsed,sha256(input.bytes),input.atlas??{pages:[],regions:[]});
  return {ir,report:{status:'unverified',sourceFormat:'spine-binary',sourceVersion:parsed.version,adapterVersion:'0.12.0',irSchema:ir.schemaVersion,sourceSha256:sha256(input.bytes),
   featureCoverage:[...ir.capabilities],warnings:['G1 source-structural compatibility is build-specific; this release requires its own independent five-scene verification.','G2 numerical and G3 official visual parity remain UNVERIFIED_NO_REFERENCE.'],
   losses:[],unsupported:[],bytesConsumed:parsed.bytesConsumed}};
 }
};
