import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const browser=['core','runtime','renderer-webgl2','renderer-cpu','importer-sdk','player-web'];
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?walk(join(dir,f.name)):[join(dir,f.name)]);}
for(const pkg of browser){
 for(const path of walk(resolve('packages',pkg,'dist')).filter(f=>f.endsWith('.js'))){
  const code=readFileSync(path,'utf8');
  if(/(?:\bfrom\s*|\bimport\s*\()\s*['"]node:/.test(code)||/(?:\bfrom\s*|\bimport\s*\()\s*['"]@universal-skeleton\/(?:importer-spine-4\.1|cli)/.test(code))throw Error(`Node/browser package boundary violation ${path}`);
 }
}
for(const name of ['core','runtime','renderer-webgl2','renderer-cpu','importer-sdk','importer-spine-4.1','player-web','cli']){
 const d=JSON.parse(readFileSync(`packages/${name}/package.json`,'utf8'));
 if(d.private||!d.files?.includes('dist')||!d.exports?.['.']||!d.types||d.license!=='MIT')throw Error('Invalid package metadata: '+name);
}
console.log(JSON.stringify({browserSafePackages:browser.length,publish:false,provenanceStatus:'REVIEW_REQUIRED',result:'PASS'}));
