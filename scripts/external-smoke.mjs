import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,mkdirSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
import {authoredMinimalWire} from './g7-authored-wire.mjs';
import {runNpm} from './npm-process.mjs';
const root=resolve();const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;const temp=mkdtempSync(join(tmpdir(),'riglyph-external-'));
const exe=(command,args,cwd=temp)=>{const x=spawnSync(command,args,{cwd,encoding:'utf8',timeout:60000});if(x.status!==0)throw Error(`${command} ${args.join(' ')} status=${x.status} ${x.stderr||x.stdout}`);return x.stdout;};
try{
 const names=['core','runtime','renderer-webgl2','renderer-cpu','renderer-native','importer-sdk','importer-spine-4.1','player-web','cli'];
 const tarballs=names.map(n=>join(root,'release-packages',`riglyph-${n}-${version}.tgz`));
 if(!tarballs.every(existsSync))throw Error('Missing packed tarballs');
 writeFileSync(join(temp,'package.json'),JSON.stringify({name:'riglyph-external-consumer',version:'0.0.0',type:'module',private:true}));
 runNpm(['install','--offline','--ignore-scripts','--no-audit','--no-fund',...tarballs],{cwd:temp,timeout:60000});
 writeFileSync(join(temp,'verify.mjs'),`import {createPlayer} from '@riglyph/player-web';import {AdapterRegistry} from '@riglyph/importer-sdk';import {deserializeIR} from '@riglyph/core';import {AnimationPlayer} from '@riglyph/runtime'; if(typeof createPlayer!=='function'||typeof AdapterRegistry!=='function'||typeof AnimationPlayer!=='function'||typeof deserializeIR!=='function')throw Error('Missing exports');console.log('RIGLYPH_PACKED_ESM_PASS');`);
 if(!exe('node',['verify.mjs']).includes('RIGLYPH_PACKED_ESM_PASS'))throw Error('Missing ESM confirmation');
 writeFileSync(join(temp,'consumer.ts'),`import type {IRDocument} from '@riglyph/core';import {createPlayer} from '@riglyph/player-web';import {AdapterRegistry} from '@riglyph/importer-sdk';const reg:AdapterRegistry=new AdapterRegistry();declare const canvas:HTMLCanvasElement;const p=createPlayer({canvas});void reg;void p;declare const ir:IRDocument;void ir;`);
 writeFileSync(join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',lib:['ES2022','DOM'],strict:true,types:[],skipLibCheck:true},include:['consumer.ts']}));
 exe('node',[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','-p','tsconfig.json']);
 const cli=join(temp,'node_modules/@riglyph/cli/dist/cli/main.js'),binary=join(temp,'character.skel'),atlas=join(temp,'character.atlas'),png=join(temp,'synthetic-example.png');
 writeFileSync(binary,authoredMinimalWire());copyFileSync(join(root,'fixtures/atlas-demo.atlas'),atlas);copyFileSync(join(root,'fixtures/synthetic-example.png'),png);
 if(exe(process.execPath,[cli,'--version']).trim()!==version)throw Error('CLI version incorrect');
 const probe=JSON.parse(exe(process.execPath,[cli,'probe',binary]));if(probe.identity.version!=='4.1.23')throw Error('Wrong probe');
 const output=join(temp,'converted');exe(process.execPath,[cli,'convert',binary,'--atlas',atlas,'--images',temp,'--out-dir',output]);
 const manifest=JSON.parse(readFileSync(join(output,'manifest.json')));
 if(manifest.assetFormat!=='universal-skeleton-asset'||manifest.pages.length!==1)throw Error('Invalid portable asset manifest');
 const valid=JSON.parse(exe(process.execPath,[cli,'validate',join(output,'skeleton.ir.json')]));if(!valid.valid)throw Error('IR validation failed');
 if(!existsSync(join(output,'textures','synthetic-example.png')))throw Error('Missing copied texture');
 console.log(JSON.stringify({status:'PASS',installedTarballs:9,esm:true,types:true,cli:'riglyph',sourceVersion:probe.identity.version,manifest:true,validation:true,externalDirectory:true},null,2));
}finally{rmSync(temp,{recursive:true,force:true});}
