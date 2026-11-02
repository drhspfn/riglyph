import {spawnSync} from 'node:child_process';
for(const name of ['core','runtime','renderer-webgl2','renderer-cpu','renderer-native','importer-sdk','importer-spine-4.1','player-web','cli']){
 console.log(`Building ${name}...`);const result=spawnSync('node',['node_modules/typescript/bin/tsc','-p',`packages/${name}/tsconfig.json`],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
}
const result=spawnSync('node',['node_modules/typescript/bin/tsc','-p','tsconfig.json'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
// Node test artifacts preserve their relative import of the G6 external-conformance module.
import {mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
mkdirSync('dist/scripts',{recursive:true});
for(const file of ['g6-conformance.mjs','g6-fake-provider.mjs','npm-process.mjs'])copyFileSync(`scripts/${file}`,`dist/scripts/${file}`);

writeFileSync('dist/scripts/g7-candidate.mjs',"export * from '../../scripts/g7-candidate.mjs';\n");
writeFileSync('dist/scripts/g7-authored-wire.mjs',"export * from '../../scripts/g7-authored-wire.mjs';\n");

writeFileSync('dist/scripts/g10-roi.mjs',"export * from '../../scripts/g10-roi.mjs';\n");
writeFileSync('dist/scripts/g10-playback.mjs',"export * from '../../scripts/g10-playback.mjs';\n");

for(const file of ['g8-png.mjs','g8-source.mjs'])writeFileSync(`dist/scripts/${file}`,`export * from '../../scripts/${file}';\n`);
