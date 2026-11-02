/** CLI/output adapter for the browser-free headless render engine.
 * All finished outputs are staged; failure and cancellation leave no success
 * manifest. CLI options override the JSON config explicitly.
 */
import {readFile,writeFile,stat,mkdir,mkdtemp,rm,rename} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute,basename} from 'node:path';
import {EngineError,requireCondition,deserializeIR} from '@riglyph/core';
import type {IRDocument} from '@riglyph/core';
import {HeadlessRenderEngine} from '@riglyph/renderer-cpu';
import type {CameraSettings,RenderQuality,TimelineAction,RenderBackground} from '@riglyph/renderer-cpu';
import {decodePNG,encodePNG} from './png.js';
import {commitConvertedDirectory} from './transaction.js';
import {encodeVideoFrames} from './ffmpeg.js';
import type {VideoProbe,VideoFormat} from './ffmpeg.js';

export type RenderCliConfig={
 images?:string;clip?:string;skin?:string;start?:number;end?:number;fps?:number;
 width?:number;height?:number;format?:'png-sequence'|VideoFormat;out?:string;outDir?:string;
 background?:string;alpha?:boolean;sampling?:'nearest'|'linear';supersampling?:1|2|4;
 pngCompression?:number;camera?:CameraSettings;quality?:RenderQuality;
 cameraFit?:'start'|'animation'|'frame';cameraScale?:number;cameraPadding?:number;
 cameraX?:number;cameraY?:number;cameraTarget?:string;cameraSlot?:string;
 crf?:number;preset?:string;bitrate?:string;ffmpegPath?:string;ffprobePath?:string;
 overwrite?:boolean;progress?:'json'|'text'|'none';
 playbackSpeed?:number;loop?:boolean;loopCount?:number;includeEnd?:boolean;
 timeline?:TimelineAction[];maxFrames?:number;maxBytes?:number;prefix?:string;pad?:number;
};
type Key=keyof RenderCliConfig;
const properties:Record<string,Key>={
 '--images':'images','--clip':'clip','--skin':'skin','--start':'start','--end':'end','--fps':'fps',
 '--width':'width','--height':'height','--format':'format','--out':'out','--out-dir':'outDir',
 '--background':'background','--sampling':'sampling','--supersampling':'supersampling',
 '--png-compression':'pngCompression','--camera':'camera','--camera-fit':'cameraFit',
 '--camera-scale':'cameraScale','--camera-padding':'cameraPadding','--camera-x':'cameraX',
 '--camera-y':'cameraY','--camera-target':'cameraTarget','--camera-slot':'cameraSlot',
 '--crf':'crf','--preset':'preset','--bitrate':'bitrate','--ffmpeg-path':'ffmpegPath',
 '--ffprobe-path':'ffprobePath','--progress':'progress','--playback-speed':'playbackSpeed',
 '--loop-count':'loopCount','--max-frames':'maxFrames','--max-bytes':'maxBytes',
 '--prefix':'prefix','--pad':'pad'};
const numeric=new Set<Key>(['start','end','fps','width','height','supersampling','pngCompression','crf',
 'cameraScale','cameraPadding','cameraX','cameraY','playbackSpeed','loopCount','maxFrames','maxBytes','pad']);
const bools:Record<string,Key>={'--overwrite':'overwrite','--alpha':'alpha','--loop':'loop','--include-end':'includeEnd'};
function setKey(o:Record<string,unknown>,key:Key,value:unknown):void{o[key]=value;}
export async function parseRenderOptions(argv:readonly string[]):Promise<RenderCliConfig>{
 const parsed:Record<string,unknown>={};
 for(let i=0;i<argv.length;i++){
  const name=argv[i]!,key=properties[name];
  if(name==='--config'){requireCondition(!parsed['config'],'INVALID_HEADER','Duplicate --config');parsed['config']=argv[++i];requireCondition(typeof parsed['config']==='string','INVALID_HEADER','--config needs filename');continue;}
  if(name in bools){setKey(parsed,bools[name]!,true);continue;}
  requireCondition(!!key,'INVALID_HEADER',`Unknown render option ${name}`);
  const str=argv[++i];requireCondition(str!==undefined&&!str.startsWith('--'),'INVALID_HEADER',`Missing value for ${name}`);
  setKey(parsed,key,numeric.has(key)?Number(str):str);
 }
 let config:Record<string,unknown>={};
 if(parsed['config']){
  const path=String(parsed['config']);const info=await stat(path);
  requireCondition(info.isFile()&&info.size<=1024*1024,'LIMIT_EXCEEDED','Render config exceeds 1 MB');
  const data:unknown=JSON.parse(await readFile(path,'utf8'));
  requireCondition(data&&typeof data==='object'&&!Array.isArray(data),'INVALID_HEADER','Render config must be an object');
  config=data as Record<string,unknown>;
  for(const key of Object.keys(config))requireCondition(Object.values(properties).includes(key as Key)||Object.values(bools).includes(key as Key)||
   ['quality','timeline'].includes(key),'INVALID_HEADER',`Unknown render config property ${key}`);
 }
 delete parsed['config'];
 return {...config,...parsed} as RenderCliConfig;
}
export const renderHelp=`render <ir.json> [options] — CPU image sequence or FFmpeg video
 --images <dir> --clip <id> --skin <id>
 --start <seconds> --end <seconds> --fps <number> --loop --loop-count <n> --playback-speed <number>
 --width <pixels> --height <pixels> --format png-sequence|mp4|webm
 --out-dir <dir> (PNG) OR --out <file> (video)
 --background "#00FF00" --alpha (WebM) --sampling nearest|linear
 --supersampling 1|2|4 --png-compression 0..9
 --camera fit-scene|fit-selection|fixed|follow --camera-fit start|frame|animation
 --camera-padding <number> --camera-scale <number> --camera-x <number> --camera-y <number>
 --camera-target <bone> --camera-slot <slot> --crf <n> --preset <name> --bitrate <rate>
 --ffmpeg-path <executable> --ffprobe-path <executable>
 --prefix frame_ --pad 6 --max-frames <n> --max-bytes <n> --include-end
 --overwrite --progress json|text|none --config <json>
 All timestamps: start + frameIndex/fps, default half-open [start,end).
 Config is JSON with camelCase option keys (camera and timeline may be nested).
 Explicit CLI options override config. No FFmpeg required for PNG.
`;
const validString=(v:unknown)=>typeof v==='string'&&v.length>0;
const maxFile=128*1024*1024;
const readLimited=async(file:string)=>{
 const s=await stat(file);requireCondition(s.isFile()&&s.size<=maxFile,'LIMIT_EXCEEDED',`Input file too large: ${file}`);
 return readFile(file);
};
async function texturesFor(ir:IRDocument,root:string){
 const {resolve:res}=await import('node:path');const base=res(root);const textures=new Map();
 for(const page of ir.atlases.pages){
  const rel=page.path.replaceAll('\\','/');
  requireCondition(rel.length>0&&!rel.split('/').some(s=>s==='..'||s==='.'||s==='')&&!isAbsolute(rel)&&!rel.startsWith('/'),
   'INVALID_ATLAS',`Unsafe texture path ${rel}`);
  const file=resolve(base,rel),check=relative(base,file);
  requireCondition(!check.startsWith('..')&&!isAbsolute(check),'INVALID_ATLAS','Texture escapes images directory');
  const decoded=decodePNG(await readLimited(file));
  requireCondition(decoded.width===page.width&&decoded.height===page.height,
   'INVALID_ATLAS',`Texture dimensions mismatch for ${page.id}`);
  textures.set(page.id,{...decoded,premultiplied:page.pma,wrapU:page.wrapU,wrapV:page.wrapV});
 }
 return textures;
}
function assertPositive(n:unknown,label:string,integer=false):number{
 requireCondition(typeof n==='number'&&Number.isFinite(n)&&n>0&&(!integer||Number.isSafeInteger(n)),
  'INVALID_HEADER',`Invalid ${label}`);return n;
}
const hasFile=async(path:string)=>stat(path).then(()=>true,err=>{if((err as NodeJS.ErrnoException).code==='ENOENT')return false;throw err;});
export async function runRenderCli(file:string,argv:readonly string[]):Promise<void>{
 const o=await parseRenderOptions(argv);
 const ir=deserializeIR((await readLimited(file)).toString('utf8'));
 const width=assertPositive(o.width??800,'width',true),height=assertPositive(o.height??600,'height',true);
 const fps=assertPositive(o.fps??30,'fps');
 const format=o.format??'png-sequence';
 requireCondition(['png-sequence','mp4','webm'].includes(format),'INVALID_HEADER','Unknown output format');
 const clip=o.clip??(ir.skeleton.animations.length===1?ir.skeleton.animations[0]!.id:undefined);
 requireCondition(!!clip||!!o.timeline,'ANIMATION_NOT_FOUND','Specify --clip or a render timeline');
 if(clip)requireCondition(ir.skeleton.animations.some(a=>a.id===clip),'ANIMATION_NOT_FOUND',`Unknown clip ${clip}`);
 const speed=assertPositive(o.playbackSpeed??1,'playbackSpeed');
 const start=o.start??0;requireCondition(Number.isFinite(start)&&start>=0,'INVALID_TIMELINE','Invalid start');
 const duration=ir.skeleton.animations.find(a=>a.id===clip)?.durationSec??0;
 const end=o.end??start+duration*(o.loopCount??1)/speed;
 requireCondition(Number.isFinite(end)&&end>=start,'INVALID_TIMELINE','Invalid end');
 requireCondition(o.pngCompression===undefined||Number.isInteger(o.pngCompression)&&o.pngCompression>=0&&o.pngCompression<=9,
  'INVALID_HEADER','PNG compression must be 0..9');
 const camValue=o.camera;
 const camera:CameraSettings=typeof camValue==='string'?{mode:camValue as CameraSettings['mode']}:{...(camValue??{})};
 if(o.cameraFit!==undefined)camera.fit=o.cameraFit;
 if(o.cameraScale!==undefined)camera.scale=o.cameraScale;
 if(o.cameraPadding!==undefined)camera.padding=o.cameraPadding;
 if(o.cameraX!==undefined)camera.offsetX=o.cameraX;
 if(o.cameraY!==undefined)camera.offsetY=o.cameraY;
 if(o.cameraTarget!==undefined)camera.targetBoneId=o.cameraTarget;
 if(o.cameraSlot!==undefined)camera.targetSlotId=o.cameraSlot;
 requireCondition(['fit-scene','fit-selection','fixed','follow'].includes(camera.mode??'fit-scene'),
  'INVALID_HEADER','Invalid camera mode');
 requireCondition(['start','frame','animation'].includes(camera.fit??'animation'),'INVALID_HEADER','Invalid camera fit policy');
 const quality:RenderQuality={...o.quality};
 if(o.sampling!==undefined)quality.sampling=o.sampling;
 if(o.supersampling!==undefined)quality.supersampling=o.supersampling;
 const transparent=format==='mp4'?false:o.alpha??(!o.background);
 const background:RenderBackground=transparent?{mode:'transparent'}:{mode:'solid',color:o.background??'#000000'};
 const root=o.images??dirname(file),pages=await texturesFor(ir,root);
 const engine=new HeadlessRenderEngine({ir,textures:pages,width,height,fps,camera,background,quality,
  maxFrames:o.maxFrames??200000,maxBytes:o.maxBytes??256*1024*1024});
 const signal=new AbortController();
 const abort=()=>signal.abort();
 process.once('SIGINT',abort);process.once('SIGTERM',abort);
 const progressMode=o.progress??'text',notify=(event:Record<string,unknown>)=>{
  if(progressMode==='none')return;
  process.stderr.write(progressMode==='json'?JSON.stringify(event)+'\n':
   `[${event['phase']}] ${event['frame']??0}/${event['totalFrames']??0}\r`);
 };
 const sequence={clipId:clip,skinId:o.skin,startSec:start,endSec:end,fps,loop:o.loop??!!o.loopCount,
  loopCount:o.loopCount,playbackSpeed:speed,timeline:o.timeline,includeEnd:o.includeEnd??false,
  signal:signal.signal,onProgress:(p:{phase:string;frame:number;totalFrames:number;timeSec:number})=>notify({event:'render-progress',...p})};
 try{
  notify({event:'render-progress',phase:'initialization',frame:0,totalFrames:0});
  if(format==='png-sequence'){
   requireCondition(validString(o.outDir)&&!o.out,'INVALID_HEADER','PNG requires --out-dir and forbids --out');
   const destination=resolve(o.outDir!);await mkdir(dirname(destination),{recursive:true});
   const stage=await mkdtemp(join(dirname(destination),'.riglyph-render-'));
   try{
    const prefix=o.prefix??'frame_',pad=o.pad??6;
    requireCondition(/^[a-zA-Z0-9_-]+$/.test(prefix)&&Number.isInteger(pad)&&pad>=4&&pad<=12,
     'INVALID_HEADER','Unsafe frame prefix or padding');
    const result=await engine.renderSequence({...sequence,onFrame:async(frame,index)=>{
     const name=prefix+String(index).padStart(pad,'0')+'.png';
     await writeFile(join(stage,name),encodePNG(width,height,frame.rgba,o.pngCompression??6),{flag:'wx'});
    }});
    const manifest={format:'riglyph-render-sequence-v1',formatOutput:'png-sequence',
     fps,width,height,...result,clipId:clip??null,skinId:o.skin??null,alpha:transparent,
     camera,quality,background,source:ir.source,status:'completed',framePrefix:prefix,padding:pad};
    await writeFile(join(stage,'render-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    await commitConvertedDirectory(stage,destination,o.overwrite??false);
    notify({event:'render-progress',phase:'success',frame:result.frameCount,totalFrames:result.frameCount});
    process.stdout.write(JSON.stringify({output:destination,...manifest})+'\n');
   }finally{await rm(stage,{recursive:true,force:true}).catch(()=>{});}
  }else{
   requireCondition(validString(o.out)&&!o.outDir,'INVALID_HEADER','Video requires --out and forbids --out-dir');
   if(format==='mp4')requireCondition(!o.alpha,'INVALID_HEADER','MP4 does not preserve alpha');
   let resultFrameCount=0;
   const output=await encodeVideoFrames({format,width,height,fps,alpha:transparent,background:o.background,
    crf:o.crf,preset:o.preset,bitrate:o.bitrate,ffmpegPath:o.ffmpegPath,ffprobePath:o.ffprobePath,
    output:o.out!,overwrite:o.overwrite,signal:signal.signal},async consume=>{
    const result=await engine.renderSequence({...sequence,onFrame:async(frame,index,total)=>{
     await consume(frame.rgba);resultFrameCount=total;
    }});
    return result.frameCount;
   });
   notify({event:'render-progress',phase:'success',frame:resultFrameCount,totalFrames:resultFrameCount});
   process.stdout.write(JSON.stringify({output:resolve(o.out!),format,frameCount:resultFrameCount,probe:output})+'\n');
  }
 }finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
