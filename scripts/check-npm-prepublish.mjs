// Network preflight for approved workflow. Does NOT publish.
import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
const names=['core','importer-sdk','runtime','renderer-webgl2','renderer-cpu','importer-spine-4.1','player-web','cli'];
const version=JSON.parse(readFileSync('package.json','utf8')).version;
if(process.env['RIGLYPH_RELEASE_APPROVED']!==`PUBLISH v${version}`)throw Error('Missing explicit approved release confirmation');
let blocked=false;
for(const name of names){const spec=`@riglyph/${name}@${version}`;const r=spawnSync('npm',['view',spec,'version','--json','--fetch-retries=0'],{encoding:'utf8',timeout:20000});
 const response=(r.stdout||'').trim();if(r.status===0){console.error('Already published: '+spec);blocked=true;}
 else if(!/E404|404 Not Found|404 Not found/i.test(r.stderr||'')){console.error('Registry status not proven absent: '+spec+' '+(r.stderr||'').slice(-300));blocked=true;}
 else console.log('ABSENT: '+spec);
}
if(blocked)process.exit(1);
console.log('All eight candidate versions absent; this does not establish scope ownership or OIDC setup.');
