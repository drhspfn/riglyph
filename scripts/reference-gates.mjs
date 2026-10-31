/** Legacy G5 evidence is NEVER considered authoritative. G6 uses signed per-feature evidence. */
import {readFileSync,writeFileSync} from 'node:fs';
import {assessBundle,ConformanceError} from './g6-conformance.mjs';
export function assessEvidence(data,trust){
 if(data?.format==='riglyph-reference-bundle-v2')return assessBundle(data,trust);
 if(data?.format!=='riglyph-reference-evidence-v1')throw new ConformanceError('INVALID_EVIDENCE','Wrong evidence format');
 const gates={};for(const gate of ['G2','G3']){
  const item=data.gates?.[gate];
  if(item&&item.status!=='UNVERIFIED_NO_REFERENCE'&&item.referenceStatus!=='REFERENCE_VERIFIED')throw new ConformanceError('INVALID_EVIDENCE','Unrecognized legacy reference claim');
  gates[gate]={status:'UNVERIFIED_NO_REFERENCE',samples:0,verifiedProvenance:false,legacyDataIgnored:item?.status!=='UNVERIFIED_NO_REFERENCE'};
 }
 return {format:'riglyph-reference-assessment-v2',gates,referenceVerified:false,policy:'LEGACY_EVIDENCE_CANNOT_CERTIFY'};
}
if(process.argv[1]?.endsWith('/reference-gates.mjs')){
 try{const input=process.argv[2];if(!input)throw new ConformanceError('INVALID_ARGUMENT','Usage: reference-gates.mjs evidence.json [out.json] [external-trust.json]');
  const report=assessEvidence(JSON.parse(readFileSync(input,'utf8')),process.argv[4]?JSON.parse(readFileSync(process.argv[4],'utf8')):undefined);
  if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');else console.log(JSON.stringify(report,null,2));
 }catch(e){process.stderr.write(JSON.stringify({code:e.code||'UNEXPECTED_ERROR',message:e.message||String(e)})+'\n');process.exitCode=1;}
}
