/** Fair A22 benchmark, same Universal IR and pixels for both backends.
 * Reports JS raster alone, native raster + binary transfer, complete evaluation
 * + draw-packet prep + raster, PNG and optional FFmpeg video pipelines.
 * Warmup and repeats; never compare a partial stage to end-to-end totals.
 */
import {performance} from 'node:perf_hooks';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {deserializeIR} from '@riglyph/core';
import {SkeletonInstance} from '@riglyph/runtime';
import {prepareDrawPackets,drawBounds} from '@riglyph/renderer-webgl2';
import {rasterize,HeadlessRenderEngine} from '@riglyph/renderer-cpu';
import {createNativeRenderer} from '@riglyph/renderer-native';
import {decodePNG,encodePNG,encodeVideoFrames} from '@riglyph/cli';

const ir=deserializeIR(await readFile('fixtures/minimal.json','utf8'));
const rgba=decodePNG(await readFile('fixtures/synthetic-example.png'));
const page=ir.atlases.pages[0];
const textures=new Map([[page.id,{...rgba,premultiplied:page.pma}]]);
const WIDTH=Number(process.env['BENCH_WIDTH']??800),HEIGHT=Number(process.env['BENCH_HEIGHT']??600);
const FPS=Number(process.env['BENCH_FPS']??30);
const REPS=Number(process.env['BENCH_REPS']??12),WARM=Number(process.env['BENCH_WARM']??5);
const view={left:-2,bottom:-2,width:4,height:4};
const clear=[0,0,0,0];
const rss=()=>process.memoryUsage().rss;
function stats(values){
 const s=[...values].sort((a,b)=>a-b),mid=Math.floor(s.length/2);
 return {medianMs:s.length%2?s[mid]:(s[mid-1]+s[mid])/2,p95Ms:s[Math.min(s.length-1,Math.ceil(s.length*.95)-1)]};
}
const timed=async(fn)=>{
 const t=performance.now();const result=await fn();return {duration:performance.now()-t,result};
};
const bin=process.env['RIGLYPH_NATIVE_BIN'];
if(!bin)throw Error('RIGLYPH_NATIVE_BIN required for measured Rust benchmark');
const native1=await createNativeRenderer({binaryPath:bin,threads:1});
const native4=await createNativeRenderer({binaryPath:bin,threads:4});
let maxRss=rss();
const timedSamples={evaluation:[],drawPackets:[],jsRaster:[],native1RasterTransfer:[],native4RasterTransfer:[],jsEndToEnd:[],nativeEndToEnd:[],pngCompression:[]};
try{
 const frame=async(t)=>{
  const inst=new SkeletonInstance(ir),a=await timed(()=>inst.evaluate([{clipId:'rotate90',timeSec:t}]));
  const b=await timed(()=>prepareDrawPackets(inst));maxRss=Math.max(maxRss,rss());
  return {packets:b.result,evalMs:a.duration,packetMs:b.duration};
 };
 const n=REPS+WARM;
 for(let i=0;i<n;i++){
  const t=(i%FPS)/FPS,pose=await frame(t);
  const input={packets:pose.packets,textures,viewport:view,width:WIDTH,height:HEIGHT,clear,sampling:'nearest'};
  const jr=await timed(()=>rasterize(pose.packets,textures,view,WIDTH,HEIGHT,clear,{sampling:'nearest'}));
  const r1=await timed(()=>native1.render(input));
  const r4=await timed(()=>native4.render(input));
  const worst=jr.result.reduce((m,x,k)=>Math.max(m,Math.abs(x-r4.result[k])),0);
  if(worst>1)throw Error(`Native vs JS pixel mismatch: ${worst}`);
  const png=await timed(()=>encodePNG(WIDTH,HEIGHT,new Uint8Array(r4.result),1));
  maxRss=Math.max(maxRss,rss());
  if(i>=WARM){
   timedSamples.evaluation.push(pose.evalMs);
   timedSamples.drawPackets.push(pose.packetMs);
   timedSamples.jsRaster.push(jr.duration);
   timedSamples.native1RasterTransfer.push(r1.duration);
   timedSamples.native4RasterTransfer.push(r4.duration);
   timedSamples.jsEndToEnd.push(pose.evalMs+pose.packetMs+jr.duration);
   timedSamples.nativeEndToEnd.push(pose.evalMs+pose.packetMs+r4.duration);
   timedSamples.pngCompression.push(png.duration);
  }
 }
 const measurements=Object.fromEntries(Object.entries(timedSamples).map(([name,data])=>[name,stats(data)]));
 // Full output comparisons use identical frame schedules and include
 // animation evaluation, camera prepass, native transfer, PNG/FFmpeg encoding.
 const outputBase=resolve('test-output/native-benchmark');
 await mkdir(join(outputBase,'js-png'),{recursive:true});
 await mkdir(join(outputBase,'rust-png'),{recursive:true});
 const engineSettings={ir,textures,width:WIDTH,height:HEIGHT,fps:10,
  camera:{mode:'fit-scene',fit:'animation'},background:{mode:'solid',color:'#000000'},
  quality:{sampling:'nearest',supersampling:1}};
 const engineJs=new HeadlessRenderEngine(engineSettings);
 const engineRust=new HeadlessRenderEngine({...engineSettings,rasterBackend:native4});
 const capturePng=async(engine,label)=>{
  const times=[];
  const t0=performance.now();
  await engine.renderSequence({clipId:'rotate90',startSec:0,endSec:.5,fps:10,
   onFrame:async(frame,index)=>{
    const x=performance.now();
    await writeFile(join(outputBase,label+'-png',String(index).padStart(6,'0')+'.png'),
     encodePNG(WIDTH,HEIGHT,frame.rgba,1));
    times.push(performance.now()-x);
   }});
  return {totalMs:performance.now()-t0,encode:stats(times),frameCount:5};
 };
 const jsPng=await capturePng(engineJs,'js');
 const rustPng=await capturePng(engineRust,'rust');
 const captureVideo=async(engine,label)=>{
  const t0=performance.now();
  const file=join(outputBase,label+'.mp4');
  const result=await encodeVideoFrames({format:'mp4',width:WIDTH,height:HEIGHT,fps:10,output:file,
   crf:23,preset:'veryfast',overwrite:true},async consume=>{
   const summary=await engine.renderSequence({clipId:'rotate90',startSec:0,endSec:.5,fps:10,
    onFrame:async(frame)=>consume(frame.rgba)});
   return summary.frameCount;
  });
  return {totalMs:performance.now()-t0,codec:result.codec,frames:result.frames};
 };
 const jsVideo=await captureVideo(engineJs,'js');
 const rustVideo=await captureVideo(engineRust,'rust');
 const report={
  engine:'Riglyph 0.16.x',nativeVersion:'0.1.0',abiVersion:1,protocolVersion:1,
  platform:process.platform,arch:process.arch,node:process.version,
  resolution:[WIDTH,HEIGHT],fps:FPS,framesMeasured:REPS,warmupFrames:WARM,
  texturePages:1,scene:'self-authored minimal Universal IR',sampling:'nearest',
  perFrame:measurements,
  pngSequence:{js:jsPng,rust:rustPng,speedup:jsPng.totalMs/rustPng.totalMs},
  videoSequence:{js:jsVideo,rust:rustVideo,speedup:jsVideo.totalMs/rustVideo.totalMs},
  speedupEndToEnd:measurements.jsEndToEnd.medianMs/measurements.nativeEndToEnd.medianMs,
  peakRssBytes:maxRss,
  allocations:'heapUsed and RSS only; native allocator event counts not instrumented',
  caveats:['Native rasterization time includes Node binary serialization, IPC and RGBA copy',
   'JS and Rust run the same pose and draw packets; there is no GPU acceleration.',
   'This synthetic scene is small and does not predict complex high-triangle assets.',
   'These are CI-runner timings, not Ryzen 5 3600 timings.']
 };
 const out=resolve(process.env['BENCH_OUTPUT']??'native/dist/native-benchmarks.json');
 await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
 console.log('A22_BENCHMARK '+JSON.stringify(report));
}finally{await native1.dispose();await native4.dispose();}
