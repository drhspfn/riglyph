import {readFileSync,readdirSync,statSync} from 'node:fs';import {join} from 'node:path';
const bad=[];const traverse=d=>{for(const ent of readdirSync(d,{withFileTypes:true})){
 if(['node_modules','.git','dist','release-packages','release-artifacts','vendor'].includes(ent.name))continue;
 const p=join(d,ent.name);
 if(ent.isDirectory())traverse(p);
 else if(/\.(ts|tsx|js|mjs|mts|json)$/.test(ent.name)&&!p.startsWith('fixtures/g8-a11-private')&&!p.startsWith('fixtures/wire41')){
 const s=readFileSync(p,'utf8');if(s.includes('@universal-skeleton/'))bad.push('Legacy package import: '+p);
 }
}};for(const d of ['packages','src'])traverse(d);
if(bad.length){console.error(bad.join('\n'));process.exit(1)}console.log('AUDIT_RELEASE_SOURCE_PASS: no legacy scoped imports in published source');
