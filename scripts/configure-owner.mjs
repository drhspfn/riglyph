import {readFileSync,writeFileSync} from 'node:fs';
const owner=process.argv[2];if(!owner||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(owner))throw Error('Usage: node scripts/configure-owner.mjs <GitHub-owner>');
for(const p of ['package.json',...['core','runtime','renderer-webgl2','renderer-cpu','importer-sdk','importer-spine-4.1','player-web','cli'].map(x=>`packages/${x}/package.json`)]){
 const j=JSON.parse(readFileSync(p,'utf8'));for(const k of ['repository','bugs'])if(j[k])for(const field of Object.keys(j[k]))j[k][field]=j[k][field].replaceAll('OWNER',owner);
 if(j.homepage)j.homepage=j.homepage.replaceAll('OWNER',owner);
 writeFileSync(p,JSON.stringify(j,null,2)+'\n');
}
console.log(`Configured repo URL github.com/${owner}/riglyph (NOT published). Run npm install --package-lock-only --offline; reverify release.`);
