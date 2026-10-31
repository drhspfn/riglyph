/** Independently authored synthetic-test 2.0 importer. NOT Spine support. */
import {validateIR} from '@riglyph/core';
import {sha256} from '@riglyph/importer-sdk';
export const importerPlugin={
 id:'synthetic-family-v2',family:'synthetic-test',acceptedVersions:['2.0.0'],adapterVersion:'0.10.0',
 manifest:{id:'synthetic-family-v2',packageVersion:'0.10.0',formatFamilies:['synthetic-test'],supportedSourceVersions:['2.0.0'],producedIrSchemaVersions:['1.0.0'],capabilities:['authored-test-only'],license:'MIT'},
 probe(bytes){try{const obj=JSON.parse(new TextDecoder().decode(bytes));return obj.kind==='clean-room-synthetic'&&obj.version==='2.0.0'?{family:'synthetic-test',version:'2.0.0'}:null;}catch{return null;}},
 import(input){const obj=JSON.parse(new TextDecoder().decode(input.bytes));validateIR(obj.ir);
  const ir=structuredClone(obj.ir),digest=sha256(input.bytes);
  ir.source={family:'synthetic-test',version:'2.0.0',sha256:digest,adapter:'synthetic-family-v2',adapterVersion:'0.10.0'};
  return {ir,report:{status:'verified-synthetic',sourceFormat:'synthetic-test',sourceVersion:'2.0.0',adapterVersion:'0.10.0',irSchema:ir.schemaVersion,sourceSha256:digest,featureCoverage:[...ir.capabilities],warnings:[],losses:[],unsupported:[],bytesConsumed:input.bytes.length}};
 }
};
