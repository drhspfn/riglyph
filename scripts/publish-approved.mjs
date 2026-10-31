// ONLY called by a manually approved GitHub environment, never by release:dry-run.
import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
if(process.env['GITHUB_ACTIONS']!=='true'||process.env['RIGLYPH_RELEASE_APPROVED']!==`PUBLISH v${version}`)throw Error('Only GitHub approved release context may publish');
const names=['core','importer-sdk','runtime','renderer-webgl2','renderer-cpu','importer-spine-4.1','player-web','cli'];
for(const name of names){
 console.log('Publishing @riglyph/'+name+'@'+version);
 const r=spawnSync('npm',['publish','--workspace',`packages/${name}`,'--access','public'],{stdio:'inherit'});
 if(r.status!==0)throw Error('Partial publish possible: STOP after '+name+'; recover manually; NEVER overwrite an immutable version');
}
