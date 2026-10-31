/** Independently created IR/PNG only; never use analyst-provided A2 binary fixtures here. */
import {spawnSync} from 'node:child_process';
import {rmSync,mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const stage=mkdtempSync(resolve(tmpdir(),'skeleton-public-assets-'));
try{
 const input=resolve(stage,'self-authored.xyz');
 writeFileSync(input,'XYZ/2.0.0 '+(await import('node:fs')).readFileSync('fixtures/minimal.json','utf8'));
 const plugin=pathToFileURL(resolve('examples/custom-family/index.mjs')).href;
 for(const name of ['react','nextjs','vanilla-web']){
  const folder=resolve('examples',name,name==='vanilla-web'?'assets/scene':'public/assets/scene');
  rmSync(folder,{recursive:true,force:true});mkdirSync(resolve(folder,'..'),{recursive:true});
  const args=['packages/cli/dist/cli/main.js','convert',input,'--plugin',plugin,'--images','fixtures','--out-dir',folder];
  const result=spawnSync('node',args,{encoding:'utf8'});
  if(result.status!==0)throw Error(`${name} self-authored XYZ conversion failed: ${result.stderr}`);
  console.log(`${name}: independently authored IR/PNG assets prepared`);
 }
}finally{rmSync(stage,{recursive:true,force:true});}
