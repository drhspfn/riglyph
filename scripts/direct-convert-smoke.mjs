import {spawnSync} from 'node:child_process';import {readFileSync,mkdtempSync,writeFileSync,copyFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {authoredMinimalWire} from './g7-authored-wire.mjs';
const root=resolve(),dir=mkdtempSync(join(tmpdir(),'riglyph-binary-'));
try{
 const skel=join(dir,'self.skel');writeFileSync(skel,authoredMinimalWire());copyFileSync('fixtures/atlas-demo.atlas',join(dir,'self.atlas'));copyFileSync('fixtures/synthetic-example.png',join(dir,'synthetic-example.png'));
 const output=join(dir,'output');const run=(args)=>{const p=spawnSync('node',['packages/cli/dist/cli/main.js',...args],{cwd:root,encoding:'utf8'});if(p.status!==0)throw Error(p.stderr||p.stdout);return JSON.parse(p.stdout);};
 const probed=run(['probe',skel]);if(probed.identity.version!=='4.1.23')throw Error('Wrong version');
 run(['convert',skel,'--atlas',join(dir,'self.atlas'),'--images',dir,'--out-dir',output]);
 const valid=run(['validate',join(output,'skeleton.ir.json')]);if(!valid.valid)throw Error('Unvalidated converted IR');
 if(!existsSync(join(output,'textures','synthetic-example.png')))throw Error('No portable PNG');
 console.log('PASS: authored 4.1.23 binary + atlas + PNG -> valid IR/portable manifest');
}finally{rmSync(dir,{recursive:true,force:true});}
