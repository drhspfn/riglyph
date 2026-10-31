/** Self-authored DERIVED_ONLY demonstrator of comparison plumbing. Never an external reference. */
import {writeFileSync} from 'node:fs';
import {capture,digest} from './g6-conformance.mjs';
const out=process.argv[2];if(!out)throw Error('Usage: node scripts/g6-fake-provider.mjs /path/to/untrusted-demo.json');
const base={format:'universal-skeleton-conformance-scenario-v1',sourceVersion:'4.1.23',fixtureOrigin:'DERIVED_ONLY',sourceArtifactSha256:digest('self-authored-demo-fixture'),referenceBuild:{id:'DERIVED-ONLY-NOT-SPINE',sha256:digest('invented-math')},conditions:{clipId:'synthetic',skinId:'synthetic',timeSec:0.5,trackOrder:[0],updateOrder:[{method:'evaluate',timeSec:0.5}],coordinates:{matrixOrder:'a,b,c,d,x,y',yAxis:'up',rotationUnits:'degrees',globalTransformPolicy:'none'}}};
const numeric={...base,id:'demo-g2',gate:'G2',feature:'G2-BONE',comparison:{mode:'scalar-vector',absTolerance:1e-3,relTolerance:1e-4}};
const ref=Buffer.from('[1,2,3,4,5,6]'),cand=Buffer.from('[1,2,3,4,5.1,6]');
const sample=capture(numeric,ref,cand);
const bundle={format:'riglyph-reference-bundle-v2',requiredFeatures:{G2:['G2-BONE','G2-WEIGHT'],G3:['G3-UV']},captures:[{capture:sample}]};
writeFileSync(out,JSON.stringify(bundle,null,2)+'\n');
console.log('DERIVED_ONLY demo generated: cannot verify G2/G3 source parity');
