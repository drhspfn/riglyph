/** G8 synthetic candidate performance evidence. Export only aggregates; never raw/private paths. */
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {resourceUsage} from 'node:process';
import {captureCandidate} from './g7-candidate.mjs';
const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw Error('Usage: node scripts/g8-benchmark.mjs <synthetic-manifest.json> <sanitized-output.json>');
try{
 const manifest=JSON.parse(readFileSync(input,'utf8'));
 if(manifest.scenario.fixtureOrigin!=='DERIVED_ONLY')throw Error('Benchmark only permits derived self-authored fixtures');
 const start=performance.now();const a=await captureCandidate(manifest,{baseDir:dirname(resolve(input))});
 const elapsed=performance.now()-start;
 const evidence={format:'g8-synthetic-performance-v1',status:'CANDIDATE_GENERATED_ONLY',referenceVerified:false,
  pageCount:manifest.assets.textures.length,framePixels:a.summary.pixelCount??null,
  wallMs:Math.round(elapsed*1000)/1000,peakRssMiB:Math.round(resourceUsage().maxRSS/1024*100)/100,
  candidateArtifactSha256:a.summary.candidateArtifactSha256,irArtifactSha256:a.summary.irArtifactSha256,
  sourceIdentityStatus:a.summary.sourceIdentityStatus};
 writeFileSync(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 process.stdout.write(JSON.stringify(evidence)+'\n');
}catch(e){process.stderr.write(JSON.stringify({code:e?.code??'G8_BENCHMARK_FAILED',referenceVerified:false})+'\n');process.exitCode=1;}
