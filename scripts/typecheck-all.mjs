import {spawnSync} from 'node:child_process';
for(const name of ['core','runtime','renderer-webgl2','renderer-cpu','renderer-native','importer-sdk','importer-spine-4.1','player-web','cli']){
 console.log(`Building ${name}...`);const result=spawnSync('node',['node_modules/typescript/bin/tsc','-p',`packages/${name}/tsconfig.json`,'--noEmit'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
}
const result=spawnSync('node',['node_modules/typescript/bin/tsc','-p','tsconfig.json','--noEmit'],{stdio:'inherit'});process.exit(result.status??1);
