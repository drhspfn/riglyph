import {spawnSync,spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,copyFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createServer} from 'node:http';
const base=resolve('release-packages'),root=resolve();const dir=mkdtempSync(join(tmpdir(),'riglyph-packed-'));
const run=(cmd,args,cwd)=>spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:120000});
let server;
try{
 const releaseVersion=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
 const tarballs=['core','runtime','renderer-webgl2','renderer-cpu','importer-sdk','importer-spine-4.1','player-web','cli'].map(name=>join(base,`riglyph-${name}-${releaseVersion}.tgz`));
 writeFileSync(join(dir,'package.json'),JSON.stringify({name:'packed-skeleton-smoke',private:true,type:'module',version:'1.0.0'})+'\n');
 const install=run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',...tarballs],dir);
 if(install.status!==0)throw Error(`External tarball install failed: ${install.stderr}`);
 writeFileSync(join(dir,'smoke.mjs'),`import {createPlayer} from '@riglyph/player-web';\nimport {AdapterRegistry,sha256} from '@riglyph/importer-sdk';\nimport {importerPlugin} from '@riglyph/importer-spine-4.1';\nimport {deserializeIR} from '@riglyph/core';\nif(typeof createPlayer!=='function'||typeof AdapterRegistry!=='function')throw Error('ESM exports missing');\nif(sha256(new TextEncoder().encode('abc'))!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')throw Error('Portable SHA mismatch');\nconst r=new AdapterRegistry();r.register(importerPlugin);if(r.list().length!==1)throw Error('Plugin not registered');\nconsole.log('PACKED_ESM_PASS');\n`);
 const esm=run('node',['smoke.mjs'],dir);if(esm.status!==0||!esm.stdout.includes('PACKED_ESM_PASS'))throw Error(esm.stderr||esm.stdout);
 writeFileSync(join(dir,'consumer.ts'),`import {createPlayer} from '@riglyph/player-web';
import {AdapterRegistry} from '@riglyph/importer-sdk';
import type {IRDocument} from '@riglyph/core';
declare const canvas:HTMLCanvasElement;
const registry:AdapterRegistry=new AdapterRegistry();
function accept(ir:IRDocument){return ir.schemaVersion;}
const created:Promise<import('@riglyph/player-web').WebPlayer>=createPlayer({canvas});
void registry;void accept;
void created.then(player=>{
 player.setSpeed(.29);
 player.setDefaultMix(.3);
 player.setAnimation('rotate90');
 player.transitionTo('rotate90',{track:0,mixDurationSec:.3,loop:true});
 player.enqueue('rotate90',{track:1,loop:false});
 player.clearQueue(1);
 const tracks:readonly import('@riglyph/runtime').TrackDiagnostics[]=player.diagnostics().tracks;
 const off=player.on('transition',evt=>{void evt.clipId;});off();
 void tracks;
});
`);
 writeFileSync(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',lib:['DOM','ES2022'],types:[],strict:true,skipLibCheck:true},include:['consumer.ts']})+'\n');
 const types=run('node',[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','-p',join(dir,'tsconfig.json')],dir);
 if(types.status!==0)throw Error('Tarball TypeScript declarations failed: '+types.stderr+types.stdout);
 const cli=join(dir,'node_modules/.bin/riglyph');
 const version=run(cli,['--version'],dir);if(version.status!==0||version.stdout.trim()!==JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version)throw Error(`CLI package version failure: ${version.stderr}`);
 // Pure Agent B header exercise: do not package third-party A2 wire vectors.
 const header=run(cli,['probe',join(root,'fixtures/synthetic-header-only.bin')],dir);
 if(header.status!==0||JSON.parse(header.stdout).identity.version!=='4.1.23')throw Error('Installed Spine header detector failed: '+header.stderr);
 // Full body and G1 corpus validation remain in private licensed verifier, not this smoke.
 // A separately authored source family must work from the INSTALLED CLI, not a workspace symlink.
 const pluginFile=join(dir,'external-xyz.mjs');
 writeFileSync(pluginFile,readFileSync(join(root,'examples/custom-family/index.mjs')));
 const xyz=join(dir,'sample.xyz'), xyzResult=join(dir,'xyz-ir.json');
 writeFileSync(xyz,'XYZ/2.0.0 '+readFileSync(join(root,'fixtures/minimal.json'),'utf8'));
 const xyzPlugin='file://'+pluginFile;
 const recognized=run(cli,['probe',xyz,'--plugin',xyzPlugin],dir);
 if(recognized.status!==0)throw Error('Packed third-party family probe failed: '+recognized.stderr);
 const probed=JSON.parse(recognized.stdout);
 if(probed.identity.family!=='xyz-independent'||probed.identity.version!=='2.0.0'||probed.compatiblePlugin!=='xyz-independent-2')throw Error('Incorrect installed detector identity');
 const xyzImport=run(cli,['import',xyz,'--out',xyzResult,'--plugin',xyzPlugin],dir);
 if(xyzImport.status!==0||JSON.parse(readFileSync(xyzResult,'utf8')).source.family!=='xyz-independent')throw Error('Packed third-party family import failed: '+xyzImport.stderr);
 const convertedDir=join(dir,'converted');
 const converted=run(cli,['convert',xyz,'--images',join(root,'fixtures'),'--out-dir',convertedDir,'--plugin',xyzPlugin],dir);
 if(converted.status!==0)throw Error('Packed XYZ convert failed: '+converted.stderr);
 const manifest=JSON.parse(readFileSync(join(convertedDir,'manifest.json'),'utf8'));
 if(manifest.assetFormat!=='universal-skeleton-asset'||manifest.pages.length!==1)throw Error('Packed XYZ asset manifest invalid');
 const xFuture=join(dir,'future.xyz');writeFileSync(xFuture,'XYZ/3.1.0 '+readFileSync(join(root,'fixtures/minimal.json'),'utf8'));
 const futureProbe=run(cli,['probe',xFuture,'--plugin',xyzPlugin],dir);
 if(futureProbe.status!==0||JSON.parse(futureProbe.stdout).availability!=='UNSUPPORTED_VERSION')throw Error('Missing plugin must not erase detected identity');
 const futureImport=run(cli,['import',xFuture,'--out',xyzResult,'--plugin',xyzPlugin],dir);
 if(futureImport.status===0||JSON.parse(futureImport.stderr).code!=='UNSUPPORTED_VERSION')throw Error('Unsupported custom version accepted');
 const result=run('xvfb-run',['-a','python','scripts/browser-packed.py',dir],root);
 if(result.status!==0)throw Error(`Packed Chromium smoke failed: ${result.stderr}\n${result.stdout}`);
 const hardening=run('xvfb-run',['-a','python','scripts/browser-g5.py',dir],root);
 if(hardening.status!==0)throw Error(`Packed G5 browser hardening failed: ${hardening.stderr}\n${hardening.stdout}`);
 const hardened=JSON.parse(hardening.stdout);
 console.log(JSON.stringify({status:'PASS',esm:esm.stdout.trim(),types:'PASS',cliVersion:version.stdout.trim(),spineDetectorVersion:JSON.parse(header.stdout).identity.version,unsupportedVersion:'UNSUPPORTED_VERSION',manifestPages:manifest.pages.length,customFamily:{detected:probed.identity.family,imported:true,unavailable:'UNSUPPORTED_VERSION'},browser:JSON.parse(result.stdout),browserHardening:hardened},null,2));
}finally{await new Promise(ok=>server?server.close(ok):ok());if(process.env['KEEP_PACKED_SMOKE']!=='1')rmSync(dir,{recursive:true,force:true});else console.log('Consumer kept at',dir);}
