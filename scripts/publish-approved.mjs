// Release-only npm Trusted Publishing / OIDC. No persistent npm tokens.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
if(process.env.GITHUB_ACTIONS!=='true'||
   process.env.GITHUB_EVENT_NAME!=='release'||
   process.env.GITHUB_REF!==`refs/tags/v${version}`||
   process.env.GITHUB_REPOSITORY!=='drhspfn/riglyph')
 throw Error('Publishing is only allowed from the matching GitHub Release in drhspfn/riglyph');

const names=['core','importer-sdk','runtime','renderer-webgl2','renderer-cpu','importer-spine-4.1','player-web','cli'];
for(const name of names){
 console.log('Publishing @riglyph/'+name+'@'+version);
 const r=spawnSync('npm',['publish','--workspace',`packages/${name}`,'--access','public','--provenance'],{stdio:'inherit'});
 if(r.status!==0)throw Error('Partial publish possible: STOP after '+name+'; recover manually; NEVER overwrite an immutable version');
}
