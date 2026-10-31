import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import type {SpawnSyncReturns} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync,mkdirSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {commitConvertedDirectory} from '../packages/cli/src/cli/transaction.js';
import {EngineError} from '@riglyph/core';
import {npmCommand,runNpm} from '../scripts/npm-process.mjs';
import {authoredMinimalWire} from '../scripts/g7-authored-wire.mjs';

const root=resolve(process.cwd());
const cli=join(root,'packages/cli/dist/cli/main.js');
const invoke=(args:string[])=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:30000});
const fixture=(dir:string)=>{
 const file=join(dir,'self.skel'),atlas=join(dir,'self.atlas');
 writeFileSync(file,authoredMinimalWire());
 copyFileSync(join(root,'fixtures/atlas-demo.atlas'),atlas);
 copyFileSync(join(root,'fixtures/synthetic-example.png'),join(dir,'synthetic-example.png'));
 return {file,atlas,out:join(dir,'converted')};
};
const convertArgs=(f:ReturnType<typeof fixture>,extra:string[]=[])=>
 ['convert',f.file,'--atlas',f.atlas,'--images',resolve(f.file,'..'),'--out-dir',f.out,...extra];

test('Windows npm.cmd fallback, npm JS CLI preference and spawn/error/status reporting',()=>{
 const win={platform:'win32',env:{},node:'Z:/does-not-exist/node.exe'};
 assert.deepEqual(npmCommand(win),{command:'npm.cmd',prefix:[],shell:true});
 let called:{command?:string;args?:string[];shell?:unknown}={};
 const fake= (command:string,args:string[],opts:Record<string,unknown>)=>{
  called={command,args,shell:opts.shell};return {status:0,signal:null,stdout:'[]',stderr:'',error:undefined,pid:1,output:[]} as unknown as SpawnSyncReturns<string>;
 };
 assert.equal(runNpm(['pack','--dry-run'],{...win,spawn:fake}).status,0);
 assert.deepEqual(called,{command:'npm.cmd',args:['pack','--dry-run'],shell:true});
 const failed=(error?:Error,status:number|null=null)=>()=>(
  {status,signal:null,stdout:'',stderr:'permission denied',error,pid:0,output:[]} as unknown as SpawnSyncReturns<string>
 );
 assert.throws(()=>runNpm(['pack'],{...win,spawn:failed(Object.assign(new Error('spawn EINVAL'),{code:'EINVAL'}))}),/unable to start: spawn EINVAL/);
 assert.throws(()=>runNpm(['pack'],{...win,spawn:failed(undefined,7)}),/exit status 7[\s\S]*permission denied/);
 assert.throws(()=>runNpm(['pack'],{...win,spawn:()=>{throw new Error('ENOENT');}}),/unable to start: ENOENT/);
 assert.equal(npmCommand({platform:'linux',env:{npm_execpath:join(root,'scripts/npm-process.mjs')},node:process.execPath}).command,process.execPath);
});

test('CLI convert refuses an existing destination without --overwrite, replaces it with --overwrite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'riglyph-win-convert-'));
 try{
  const f=fixture(dir);
  let r=invoke(convertArgs(f));assert.equal(r.status,0,r.stderr);
  const initial=readFileSync(join(f.out,'manifest.json'));
  writeFileSync(join(f.out,'previous-only.txt'),'keep me');
  r=invoke(convertArgs(f));assert.notEqual(r.status,0);
  assert.equal(JSON.parse(r.stderr).code,'OUTPUT_EXISTS');
  assert.deepEqual(readFileSync(join(f.out,'manifest.json')),initial);
  assert.equal(readFileSync(join(f.out,'previous-only.txt'),'utf8'),'keep me');
  r=invoke(convertArgs(f,['--overwrite']));assert.equal(r.status,0,r.stderr);
  assert.deepEqual(readFileSync(join(f.out,'manifest.json')),initial);
  assert.equal(existsSync(join(f.out,'previous-only.txt')),false);
  assert.equal(readdirSync(dir).filter(p=>p.startsWith('.skeleton-convert-')||p.startsWith('.riglyph-backup-')).length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CLI --overwrite preserves previous result on staging failure (missing texture)',()=>{
 const dir=mkdtempSync(join(tmpdir(),'riglyph-win-staging-'));
 try{
  const f=fixture(dir);assert.equal(invoke(convertArgs(f)).status,0);
  writeFileSync(join(f.out,'previous-only.txt'),'previous');
  rmSync(join(dir,'synthetic-example.png'));
  const result=invoke(convertArgs(f,['--overwrite']));assert.notEqual(result.status,0);
  assert.equal(readFileSync(join(f.out,'previous-only.txt'),'utf8'),'previous');
  assert.equal(existsSync(join(f.out,'manifest.json')),true);
  assert.equal(readdirSync(dir).filter(p=>p.startsWith('.skeleton-convert-')||p.startsWith('.riglyph-backup-')).length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('simulated Windows EPERM on second rename restores backup and old manifest',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'riglyph-win-eperm-'));
 try{
  const dest=join(dir,'converted'),stage=join(dir,'.skeleton-convert-stage');
  mkdirSync(dest);mkdirSync(stage);
  writeFileSync(join(dest,'manifest.json'),'old');writeFileSync(join(stage,'manifest.json'),'new');
  const fs=await import('node:fs/promises');
  const ops={lstat:fs.lstat,rm:fs.rm,rename:async(from:string,to:string)=>{
   if(from===stage&&to===dest)throw Object.assign(new Error('Windows EPERM: destination busy'),{code:'EPERM'});
   await fs.rename(from,to);
  }};
  await assert.rejects(commitConvertedDirectory(stage,dest,true,ops),e=>e instanceof EngineError&&e.code==='OUTPUT_COMMIT_FAILED');
  assert.equal(readFileSync(join(dest,'manifest.json'),'utf8'),'old');
  assert.equal(readFileSync(join(stage,'manifest.json'),'utf8'),'new');
  assert.equal(readdirSync(dir).filter(p=>p.startsWith('.riglyph-backup-')).length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('simulated Windows EPERM before backup does not touch old destination',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'riglyph-win-backup-'));
 try{
  const dest=join(dir,'out'),stage=join(dir,'stage');mkdirSync(dest);mkdirSync(stage);
  writeFileSync(join(dest,'manifest.json'),'old');
  const fs=await import('node:fs/promises');
  await assert.rejects(commitConvertedDirectory(stage,dest,true,{lstat:fs.lstat,rm:fs.rm,rename:async(from,to)=>{
   if(from===dest)throw Object.assign(new Error('EPERM: locked'),{code:'EPERM'});
   await fs.rename(from,to);
  }}),e=>e instanceof EngineError&&e.code==='OUTPUT_COMMIT_FAILED');
  assert.equal(readFileSync(join(dest,'manifest.json'),'utf8'),'old');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('if Windows prevents rollback, backup is kept and its location is reported',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'riglyph-win-rollback-'));
 try{
  const dest=join(dir,'out'),stage=join(dir,'stage');mkdirSync(dest);mkdirSync(stage);
  writeFileSync(join(dest,'manifest.json'),'old');
  const fs=await import('node:fs/promises');
  let call=0;
  await assert.rejects(commitConvertedDirectory(stage,dest,true,{lstat:fs.lstat,rm:fs.rm,rename:async(from,to)=>{
   call++;if(call>1)throw Object.assign(new Error('EPERM'),{code:'EPERM'});
   await fs.rename(from,to);
  }}),e=>e instanceof EngineError&&e.code==='OUTPUT_ROLLBACK_FAILED'&&!!e.details.path&&existsSync(join(e.details.path,'manifest.json')));
  assert.equal(existsSync(dest),false);
  assert.equal(readdirSync(dir).filter(p=>p.startsWith('.riglyph-backup-')).length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('repeat npm pack dry-run and real .tgz generation outside release-packages', {timeout:120000},()=>{
 const dir=mkdtempSync(join(tmpdir(),'riglyph-win-pack-'));
 try{
  for(let i=0;i<2;i++){
   const result=spawnSync(process.execPath,['scripts/pack-check.mjs'],{cwd:root,encoding:'utf8',timeout:90000,env:{...process.env,RIGLYPH_PACK_DESTINATION:dir,RIGLYPH_PACK_ONLY:'core'}});
   assert.equal(result.status,0,result.error?.message??result.stderr);
   const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
   assert.equal(manifest.packages.length,1);
   assert.equal(readdirSync(dir).filter(f=>f.endsWith('.tgz')).length,1);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
