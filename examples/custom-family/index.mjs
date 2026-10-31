/** Independently authored XYZ/2.0.0 test format; not a Spine decoder. */
import {validateIR} from '@riglyph/core';
import {sha256} from '@riglyph/importer-sdk';
const encoder=new TextEncoder();
const marker=encoder.encode('XYZ/');
export const detector={
 id:'xyz-standalone-detector',maxProbeBytes:32,
 inspect(bytes,source){
  if(bytes.length<marker.length||!marker.every((b,i)=>bytes[i]===b))return null;
  const ascii=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(4));
  const match=/^(\d+\.\d+\.\d+)(?:\s|$)/.exec(ascii);
  if(!match)return null;
  return {family:'xyz-independent',version:match[1],confidence:'confirmed',detectorId:this.id};
 }
};
export const importerPlugin={
 id:'xyz-independent-2',family:'xyz-independent',acceptedVersions:['2.0.0'],adapterVersion:'0.10.0',
 manifest:{id:'xyz-independent-2',packageVersion:'0.10.0',formatFamilies:['xyz-independent'],supportedSourceVersions:['2.0.0'],producedIrSchemaVersions:['1.0.0'],capabilities:['synthetic-json-body'],license:'MIT'},
 probe(bytes,source){const value=detector.inspect(bytes,source);return value&&{family:value.family,version:value.version};},
 import({bytes}){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!text.startsWith('XYZ/2.0.0 '))throw Error('Invalid XYZ source version');
  const decoded=JSON.parse(text.slice('XYZ/2.0.0 '.length));
  validateIR(decoded);const ir=structuredClone(decoded),hash=sha256(bytes);
  ir.source={family:'xyz-independent',version:'2.0.0',sha256:hash,adapter:'xyz-independent-2',adapterVersion:'0.10.0'};
  return {ir,report:{status:'verified-synthetic',sourceFormat:'xyz-independent',sourceVersion:'2.0.0',adapterVersion:'0.10.0',irSchema:ir.schemaVersion,sourceSha256:hash,featureCoverage:[...ir.capabilities],warnings:[],losses:[],unsupported:[],bytesConsumed:bytes.length}};
 }
};
