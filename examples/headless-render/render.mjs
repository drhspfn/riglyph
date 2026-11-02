/** Run at repository root after npm run build; synthetic, rights-safe asset. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {deserializeIR} from '@riglyph/core';
import {HeadlessRenderEngine} from '@riglyph/renderer-cpu';
import {decodePNG,encodePNG} from '@riglyph/cli';

const ir=deserializeIR(await readFile('fixtures/minimal.json','utf8'));
const textures=new Map();
for(const page of ir.atlases.pages){
 const decoded=decodePNG(await readFile(resolve('fixtures',page.path)));
 textures.set(page.id,{...decoded,premultiplied:page.pma});
}
const out=resolve('test-output/headless-example');
await mkdir(out,{recursive:true});
const engine=new HeadlessRenderEngine({
 ir,textures,width:128,height:128,fps:12,
 camera:{mode:'fit-scene',fit:'animation',padding:1.1},
 background:{mode:'transparent'},
 quality:{sampling:'linear',supersampling:1}
});
const result=await engine.renderSequence({
 clipId:'rotate90',startSec:0,endSec:1,fps:12,
 onFrame:async ({rgba},i)=>writeFile(join(out,`frame_${String(i).padStart(6,'0')}.png`),
  encodePNG(128,128,rgba)),
 onProgress:({phase,frame,totalFrames})=>{if(phase==='completed')console.log(`Rendered ${frame}/${totalFrames}`);}
});
console.log(JSON.stringify({output:out,...result}));
