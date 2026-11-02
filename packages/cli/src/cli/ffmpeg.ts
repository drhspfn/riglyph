/** Optional FFmpeg adapter for raw RGBA -> H.264/VP9. No shell interpolation. */
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {dirname,join,parse,resolve} from 'node:path';
import {rename,rm,lstat,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {EngineError,requireCondition} from '@riglyph/core';

export type VideoFormat='mp4'|'webm';
export type EncoderSettings={format:VideoFormat;width:number;height:number;fps:number;alpha?:boolean;
 background?:string;crf?:number;preset?:string;bitrate?:string;ffmpegPath?:string;ffprobePath?:string;
 output:string;overwrite?:boolean;signal?:AbortSignal;timeoutMs?:number;};
const bad=(msg:string)=>new EngineError('UNSUPPORTED_SEMANTIC_FEATURE',msg);
const run=(command:string,args:string[],timeout=20000)=>{
 const p=spawnSync(command,args,{encoding:'utf8',timeout,maxBuffer:2*1024*1024,windowsHide:true});
 if(p.error||p.status!==0)throw bad(`${command} ${args[0]??''} failed: ${p.error?.message??p.stderr?.slice(-1200)??p.status}`);
 return p.stdout;
};
export function probeFFmpeg(path='ffmpeg',format?:VideoFormat):string{
 const encoders=run(path,['-hide_banner','-encoders']);
 if(!format||format==='mp4')requireCondition(/\blibx264\b/.test(encoders),'UNSUPPORTED_SEMANTIC_FEATURE','FFmpeg lacks libx264 H.264 encoder');
 if(!format||format==='webm')requireCondition(/\blibvpx-vp9\b/.test(encoders),'UNSUPPORTED_SEMANTIC_FEATURE','FFmpeg lacks libvpx-vp9 encoder');
 return run(path,['-version']).split('\n')[0]??'ffmpeg';
}
function ffprobeFor(ffmpeg:string,explicit?:string):string{
 if(explicit)return explicit;
 const name=parse(ffmpeg).base.toLowerCase();
 if(ffmpeg==='ffmpeg'||ffmpeg==='ffmpeg.exe')return process.platform==='win32'?'ffprobe.exe':'ffprobe';
 return name==='ffmpeg.exe'?join(dirname(ffmpeg),'ffprobe.exe'):name==='ffmpeg'?join(dirname(ffmpeg),'ffprobe'):'ffprobe';
}
export function validateEncoder(options:EncoderSettings):void{
 const {width,height,fps,format}=options;
 requireCondition(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&Number.isFinite(fps)&&fps>0&&fps<=1000,
  'INVALID_HEADER','Invalid video dimensions or FPS');
 requireCondition(width%2===0&&height%2===0,'INVALID_HEADER','MP4/WebM yuv420 requires even width and height');
 requireCondition(format==='mp4'||format==='webm','INVALID_HEADER','Unknown video format');
 requireCondition(!options.alpha||format==='webm','INVALID_HEADER','Alpha is only available for WebM VP9');
 requireCondition(options.crf===undefined||Number.isInteger(options.crf)&&options.crf>=0&&options.crf<=51,'INVALID_HEADER','CRF must be 0..51');
 requireCondition(!options.preset||/^(ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow|realtime|good|best)$/.test(options.preset),'INVALID_HEADER','Invalid encoder preset');
 requireCondition(!options.bitrate||/^\d+[kKmM]?$/.test(options.bitrate),'INVALID_HEADER','Invalid bitrate');
 requireCondition(!!options.output,'INVALID_HEADER','Output file required');
 requireCondition(options.timeoutMs===undefined||Number.isSafeInteger(options.timeoutMs)&&options.timeoutMs>0,
  'INVALID_HEADER','Invalid FFmpeg timeout');
}
function videoArgs(o:EncoderSettings,out:string):string[]{
 const base=['-hide_banner','-loglevel','warning','-nostdin','-y','-f','rawvideo','-pixel_format','rgba',
  '-video_size',`${o.width}x${o.height}`,'-framerate',String(o.fps),'-i','pipe:0','-an'];
 if(o.format==='mp4')return [...base,'-c:v','libx264','-pix_fmt','yuv420p','-crf',String(o.crf??18),
  '-preset',o.preset??'medium',...(o.bitrate?['-b:v',o.bitrate]:[]),'-movflags','+faststart','-f','mp4',out];
 return [...base,'-c:v','libvpx-vp9','-pix_fmt',o.alpha?'yuva420p':'yuv420p',
  '-crf',String(o.crf??28),'-b:v',o.bitrate??'0','-deadline',o.preset??'good',
  ...(o.alpha?['-auto-alt-ref','0','-metadata:s:v:0','alpha_mode=1']:[]),'-f','webm',out];
}
export type VideoProbe={codec:string;width:number;height:number;fps:number;frames:number|null;duration:number|null;alpha:boolean;decodedAlphaVerified:boolean};
function probeVideo(file:string,o:EncoderSettings,frameCount:number,alphaPixel:number|null):VideoProbe{
 const cmd=ffprobeFor(o.ffmpegPath??'ffmpeg',o.ffprobePath);
 const j=JSON.parse(run(cmd,['-v','error','-count_frames','-select_streams','v:0','-show_entries',
  'stream=codec_name,width,height,avg_frame_rate,nb_read_frames,duration:stream_tags=alpha_mode:format=duration','-of','json',file],30000)) as {
  streams?:{codec_name?:string;width?:number;height?:number;avg_frame_rate?:string;nb_read_frames?:string;duration?:string;tags?:{alpha_mode?:string}}[];
  format?:{duration?:string}};
 const stream=j.streams?.[0];requireCondition(stream,'UNSUPPORTED_SEMANTIC_FEATURE','No video stream in FFmpeg output');
 const rate=stream.avg_frame_rate?.split('/').map(Number)??[],fps=(rate[0]??0)/(rate[1]??1);
 const frames=stream.nb_read_frames&&stream.nb_read_frames!=='N/A'?Number(stream.nb_read_frames):null;
 const duration=Number(j.format?.duration??stream.duration??NaN);
 const alpha=Object.entries(stream.tags??{}).some(([key,value])=>key.toLowerCase()==='alpha_mode'&&value==='1');
 requireCondition(stream.codec_name===(o.format==='mp4'?'h264':'vp9'),'UNSUPPORTED_SEMANTIC_FEATURE','Unexpected output codec');
 requireCondition(stream.width===o.width&&stream.height===o.height,'UNSUPPORTED_SEMANTIC_FEATURE','Encoded resolution mismatch');
 requireCondition(Math.abs(fps-o.fps)<=1e-4,'UNSUPPORTED_SEMANTIC_FEATURE',`Encoded FPS mismatch ${fps} != ${o.fps}`);
 requireCondition(frames===frameCount,'UNSUPPORTED_SEMANTIC_FEATURE',`Encoded frame count mismatch ${frames} != ${frameCount}`);
 requireCondition(Number.isFinite(duration)&&Math.abs(duration-frameCount/o.fps)<Math.max(.04,1/o.fps),
  'UNSUPPORTED_SEMANTIC_FEATURE',`Encoded duration mismatch ${duration}`);
 if(o.alpha)requireCondition(alpha,'UNSUPPORTED_SEMANTIC_FEATURE','WebM VP9 has no alpha_mode metadata');
 let decodedAlphaVerified=false;
 if(o.alpha){
  const args=['-v','error','-c:v','libvpx-vp9','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1'];
  const result=spawnSync(o.ffmpegPath??'ffmpeg',args,{timeout:30000,maxBuffer:o.width*o.height*4+65536,windowsHide:true});
  requireCondition(result.status===0&&result.stdout.length===o.width*o.height*4,'UNSUPPORTED_SEMANTIC_FEATURE',
   'Cannot decode VP9 alpha with libvpx-vp9');
  if(alphaPixel!==null)requireCondition(result.stdout[alphaPixel*4+3]!<192,'UNSUPPORTED_SEMANTIC_FEATURE',
   'VP9 alpha metadata exists but transparent pixel failed decode check');
  decodedAlphaVerified=alphaPixel!==null;
 }
 return {codec:stream.codec_name!,width:o.width,height:o.height,fps,frames,duration,alpha,decodedAlphaVerified};
}
export async function encodeVideoFrames(o:EncoderSettings,render:(consume:(frame:Uint8Array)=>Promise<void>)=>Promise<number>):Promise<VideoProbe>{
 validateEncoder(o);
 const exe=o.ffmpegPath??process.env['RIGLYPH_FFMPEG']??'ffmpeg';
 const settings={...o,ffmpegPath:exe};
 probeFFmpeg(exe,o.format);
 const destination=resolve(o.output);await mkdir(dirname(destination),{recursive:true});
 requireCondition(destination.endsWith(o.format==='mp4'?'.mp4':'.webm'),'INVALID_HEADER','Video output extension does not match format');
 let previous=false;
 try{const info=await lstat(destination);requireCondition(info.isFile()&&!info.isSymbolicLink(),'OUTPUT_EXISTS','Output is not a regular file');previous=true;}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 requireCondition(!previous||!!o.overwrite,'OUTPUT_EXISTS',`Video already exists: ${destination}`);
 const info=parse(destination);
 const staged=join(info.dir,`.${info.name}-${randomUUID()}${info.ext}`);
 const child=spawn(exe,videoArgs(settings,staged),{stdio:['pipe','ignore','pipe'],windowsHide:true});
 let stderr='',fatal:Error|null=null;
 child.once('error',e=>{fatal=e;});
 child.stderr?.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-16384);});
 const exit=new Promise<number>((yes,no)=>{child.once('error',no);child.once('exit',(code)=>yes(code??-1));});
 child.stdin.on('error',e=>{fatal=e;});
 const cancel=()=>{child.stdin?.destroy();child.kill('SIGKILL');};
 let timedOut=false;
 const timeout=setTimeout(()=>{timedOut=true;cancel();},o.timeoutMs??3600000);
 o.signal?.addEventListener('abort',cancel,{once:true});
 let frames=0,alphaPixel:number|null=null;
 try{
  const count=await render(async frame=>{
   requireCondition(!o.signal?.aborted,'OUTPUT_COMMIT_FAILED','Video rendering cancelled');
   requireCondition(frame.byteLength===o.width*o.height*4,'INVALID_ATLAS','Incorrect raw video frame dimensions');
   if(frames===0&&o.alpha)for(let p=0;p<o.width*o.height;p++)if(frame[p*4+3]!<32){alphaPixel=p;break;}
   if(fatal)throw fatal;
   if(!child.stdin.write(frame))await Promise.race([once(child.stdin,'drain'),exit.then(code=>{throw bad(`FFmpeg exited before stdin drained: ${code}; ${stderr.slice(-1000)}`);})]);
   frames++;
  });
  requireCondition(count===frames&&frames>0,'INVALID_TIMELINE','Encoded frame count disagrees with render scheduler');
  child.stdin.end();
  const code=await exit;
  requireCondition(!timedOut,'OUTPUT_COMMIT_FAILED','FFmpeg encoding exceeded the timeout');
  requireCondition(code===0,'UNSUPPORTED_SEMANTIC_FEATURE',`FFmpeg exited ${code}: ${stderr.slice(-4000)}`);
  const probe=probeVideo(staged,settings,count,alphaPixel);
  if(!previous){await rename(staged,destination);return probe;}
  const backup=join(info.dir,`.riglyph-video-backup-${randomUUID()}${info.ext}`);
  try{await rename(destination,backup);}catch(e){throw new EngineError('OUTPUT_COMMIT_FAILED',`Could not back up existing video: ${String(e)}`);}
  try{await rename(staged,destination);}catch(e){
   try{await rename(backup,destination);}catch(restore){throw new EngineError('OUTPUT_ROLLBACK_FAILED',
    `Video commit failed (${String(e)}); previous video preserved at ${backup}; restore error: ${String(restore)}`);}
   throw new EngineError('OUTPUT_COMMIT_FAILED',`Video commit failed and previous output restored: ${String(e)}`);
  }
  await rm(backup,{force:true}).catch(e=>process.stderr.write(`WARNING: video committed; old backup retained at ${backup}: ${String(e)}\\n`));
  return probe;
 }catch(e){cancel();await exit.catch(()=>{});throw e;}
 finally{clearTimeout(timeout);o.signal?.removeEventListener('abort',cancel);await rm(staged,{force:true}).catch(()=>{});}
}
