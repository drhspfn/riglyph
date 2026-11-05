import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {encodePNG,decodePNG} from '@riglyph/cli';
import {dynamicClipFixture} from './geometry-fixture.js';

test('CLI strict failure retains reproduction and cleans output; explicit compatible exports real frames',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'riglyph-geometry-'));
 try{
  const ir=dynamicClipFixture(),file=join(dir,'ir.json'),out=join(dir,'frames'),debug=join(dir,'geometry.jsonl');
  await writeFile(file,JSON.stringify(ir));await writeFile(join(dir,ir.atlases.pages[0]!.path),encodePNG(2,2,new Uint8Array(16).fill(255)));
  const args=[resolve('packages/cli/dist/cli/main.js'),'render',file,'--clip','dynamic','--end','1','--fps','12',
   '--width','48','--height','48','--out-dir',out,'--progress','none'];
  const strict=spawnSync(process.execPath,[...args,'--debug-geometry',debug],{encoding:'utf8'});
  assert.notEqual(strict.status,0);assert.match(strict.stderr,/INVALID_TOPOLOGY/);
  assert.ok(!(await readdir(dir)).some(n=>n==='frames'||n.startsWith('.riglyph-render-')));
  const diagnostics=(await readFile(debug,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
  const error=diagnostics.at(-1);assert.equal(error.severity,'error');assert.equal(error.attachmentId,'mask');
  assert.equal(error.clipId,'dynamic');assert.equal(error.frameIndex,4);assert.ok(error.boneMatrices.mask);
  const compatible=spawnSync(process.execPath,[...args,'--clipping-policy','compatible'],{encoding:'utf8'});
  assert.equal(compatible.status,0,compatible.stderr);assert.match(compatible.stderr,/geometry-warning/);
  const frames=(await readdir(out)).filter(n=>n.endsWith('.png'));assert.equal(frames.length,12);
  for(const name of frames){const png=decodePNG(await readFile(join(out,name)));assert.ok(png.rgba.some((v,i)=>i%4===3&&v>0));}
  const manifest=JSON.parse(await readFile(join(out,'render-manifest.json'),'utf8'));assert.equal(manifest.clippingPolicy,'compatible');
 }finally{await rm(dir,{recursive:true,force:true});}
});
