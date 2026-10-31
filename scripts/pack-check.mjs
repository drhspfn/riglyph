import {runNpm} from './npm-process.mjs';
import {readFileSync,mkdirSync,writeFileSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const allPackages=['core','runtime','renderer-webgl2','renderer-cpu','importer-sdk','importer-spine-4.1','player-web','cli'];
const packages=process.env.RIGLYPH_PACK_ONLY ? allPackages.filter(name=>name===process.env.RIGLYPH_PACK_ONLY):allPackages;
if(!packages.length)throw new Error('Unknown RIGLYPH_PACK_ONLY package');
const dir=resolve(process.env.RIGLYPH_PACK_DESTINATION??'release-packages');mkdirSync(dir,{recursive:true});for(const file of readdirSync(dir))if(file.endsWith('.tgz'))unlinkSync(join(dir,file));const summary=[];
for(const name of packages){
 const pkg=JSON.parse(readFileSync(`packages/${name}/package.json`,'utf8'));
 if(pkg.private||!pkg.exports?.['.']||!pkg.types||!pkg.files?.includes('dist')||pkg.license!=='MIT')throw Error(`Package ${name} lacks distribution metadata`);
 const dry=runNpm(['pack','--dry-run','--json','-w',`packages/${name}`]);
 const record=JSON.parse(dry.stdout)[0];const files=record.files.map(f=>f.path);
 if(!files.some(f=>f.startsWith('dist/')&&f.endsWith('.js'))||!files.some(f=>f.startsWith('dist/')&&f.endsWith('.d.ts'))||!files.includes('LICENSE'))throw Error(`${name} lacks bundled JS/types/LICENSE`);
 for(const path of files){if(!(/^(dist\/|LICENSE$|README\.md$|package\.json$)/.test(path))||/(analyst|private|fixtures|\.skel|\.git|node_modules|secrets)/i.test(path))throw Error(`Disallowed release file ${name}: ${path}`);}
 const pack=runNpm(['pack','--silent','-w',`packages/${name}`,'--pack-destination',dir]);
 const basename=pack.stdout.trim().split('\n').at(-1);const tgz=join(dir,basename);const bytes=readFileSync(tgz);
 summary.push({name:pkg.name,version:pkg.version,tarball:basename,files:files.length,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
writeFileSync(join(dir,'manifest.json'),JSON.stringify({format:'universal-skeleton-package-bundle-v1',generatedBy:'npm-pack',packages:summary},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',packages:summary},null,2));
