// Release-only npm publishing; explicit OIDC or granular-token mode.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
if(process.env.GITHUB_ACTIONS!=='true'||
   !((process.env.GITHUB_EVENT_NAME==='release' && [`refs/tags/${version}`,`refs/tags/v${version}`].includes(process.env.GITHUB_REF)) ||
     (process.env.GITHUB_EVENT_NAME==='workflow_dispatch' && process.env.GITHUB_REF==='refs/heads/main' && [version,`v${version}`].includes(process.env.RIGLYPH_RELEASE_TAG)))||
   process.env.GITHUB_REPOSITORY!=='drhspfn/riglyph')
 throw Error('Publishing is only allowed from the matching GitHub Release in drhspfn/riglyph');

const mode=process.env.NPM_PUBLISH_MODE;
if(mode!=='oidc'&&mode!=='token')throw Error('NPM_PUBLISH_MODE must be oidc or token');
if(mode==='token'&&!process.env.NODE_AUTH_TOKEN)throw Error('Token mode requires NODE_AUTH_TOKEN');
// Separate subprocess environments prevent npm from auto-selecting OIDC in token mode.
const publishEnv={...process.env};
if(mode==='token'){
 delete publishEnv.ACTIONS_ID_TOKEN_REQUEST_URL;
 delete publishEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
}else{
 delete publishEnv.NODE_AUTH_TOKEN;
}
const names=['core','importer-sdk','runtime','renderer-webgl2','renderer-cpu','importer-spine-4.1','player-web','cli'];
for(const name of names){
 console.log('Publishing @riglyph/'+name+'@'+version);
 const args=['publish','--workspace',`packages/${name}`,'--access','public'];
 if(mode==='oidc')args.push('--provenance');
 const r=spawnSync('npm',args,{stdio:'inherit',env:publishEnv});
 if(r.status!==0)throw Error('Partial publish possible: STOP after '+name+'; recover manually; NEVER overwrite an immutable version');
}
