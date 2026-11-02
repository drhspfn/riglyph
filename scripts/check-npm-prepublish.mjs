// Fail-closed registry absence check before any release publication.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
if(process.env.GITHUB_ACTIONS!=='true'||
   process.env.GITHUB_EVENT_NAME!=='release'||
   ![`refs/tags/${version}`,`refs/tags/v${version}`].includes(process.env.GITHUB_REF)||
   process.env.GITHUB_REPOSITORY!=='drhspfn/riglyph')
 throw Error('Publishing is only allowed from the matching GitHub Release in drhspfn/riglyph');

const names=['core','importer-sdk','runtime','renderer-webgl2','renderer-cpu','importer-spine-4.1','player-web','cli'];
let blocked=false;
for(const name of names){
 const spec=`@riglyph/${name}@${version}`;
 const r=spawnSync('npm',['view',spec,'version','--json','--fetch-retries=0'],{encoding:'utf8',timeout:20000});
 if(r.status===0){console.error('Already published: '+spec);blocked=true;}
 else if(!/E404|404 Not Found|404 Not found/i.test(r.stderr||'')){console.error('Registry status not proven absent: '+spec+' '+(r.stderr||'').slice(-300));blocked=true;}
 else console.log('ABSENT: '+spec);
}
if(blocked)process.exit(1);
console.log('All eight candidate versions absent; verify scope ownership and npm OIDC trust before creating a release.');
