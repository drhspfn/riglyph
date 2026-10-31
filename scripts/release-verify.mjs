import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const names=['core','runtime','renderer-webgl2','renderer-cpu','importer-sdk','importer-spine-4.1','player-web','cli'];
const root=JSON.parse(readFileSync('package.json','utf8'));
const problems=[];
if(root.version!=='0.15.1'||!root.private)problems.push('Root version or private flag incorrect');
for(const name of names){
 const j=JSON.parse(readFileSync(`packages/${name}/package.json`,'utf8'));
 if(j.name!==`@riglyph/${name}`||j.version!==root.version)problems.push(`${name}: name/version`);
 if(!j.exports?.['.']?.types||!j.exports?.['.']?.import||!j.types||!j.files?.includes('dist'))problems.push(`${name}: exports/types/files`);
 if(j.publishConfig?.access!=='public'||!j.repository?.url||j.private)problems.push(`${name}: distribution metadata`);
 for(const [dep,version] of Object.entries(j.dependencies??{}))if(!dep.startsWith('@riglyph/')||version!==root.version)problems.push(`${name}: dependency mismatch: ${dep}@${version}`);
 const dist=resolve('packages',name,'dist');if(!existsSync(dist)||!existsSync(resolve(dist,'index.js'))||!existsSync(resolve(dist,'index.d.ts')))problems.push(`${name}: no compiled JS/types`);
}
const cli=JSON.parse(readFileSync('packages/cli/package.json','utf8'));
if(cli.bin?.riglyph!=='./dist/cli/main.js')problems.push('Missing riglyph bin');
const packDir=resolve('release-packages');
let artifacts=[];if(existsSync(packDir)){artifacts=readdirSync(packDir).filter(s=>s.endsWith('.tgz'));for(const name of names)if(!artifacts.includes(`riglyph-${name}-${root.version}.tgz`))problems.push(`Missing packed ${name}`);if(artifacts.length!==8)problems.push(`Expected exactly 8 tarballs, found ${artifacts.length}`);}else problems.push('Missing release-packages');
const report={format:'riglyph-release-preflight-v1',version:root.version,packageCount:names.length,tarballs:artifacts,technicalStatus:problems.length?'FAIL':'PASS',publishAuthorization:'NOT_GRANTED',ownerRepositoryConfigured:!JSON.stringify(root.repository).includes('/OWNER/'),legalApproval:'PENDING',G1_currentVersion:'INDEPENDENT_RECHECK_REQUIRED',G2:'UNVERIFIED_NO_REFERENCE',G3_official:'UNVERIFIED_NO_REFERENCE',problems};
console.log(JSON.stringify(report,null,2));if(problems.length)process.exitCode=1;
