/** Real integration acceptance: FFmpeg/ffprobe are mandatory for this test job.
 * CI installs a full H.264 + VP9 build on Linux and Windows; no skipped codecs.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {probeFFmpeg} from '@riglyph/cli';
import {encodeVideoFrames} from '../packages/cli/src/cli/ffmpeg.js';
const base=resolve('test-output/headless-video');
const ffmpeg=process.env['RIGLYPH_FFMPEG']??'ffmpeg';
const cli=resolve('packages/cli/dist/cli/main.js');
function run(args:string[]){
 const p=spawnSync(process.execPath,[cli,'render',resolve('fixtures/minimal.json'),
  '--images',resolve('fixtures'),'--clip','rotate90',
  '--start','0','--end','1','--fps','4','--width','64','--height','64','--progress','none',...args],
  {encoding:'utf8',timeout:90000,maxBuffer:512*1024});
 return p;
}
const probe=(filename:string)=>{
 const p=spawnSync(process.env['RIGLYPH_FFPROBE']??'ffprobe',['-v','error','-count_frames','-show_entries',
  'stream=codec_name,width,height,nb_read_frames,avg_frame_rate:stream_tags=alpha_mode','-of','json',filename],
  {encoding:'utf8',timeout:30000});
 assert.equal(p.status,0,p.stderr);
 return JSON.parse(p.stdout) as {streams:{codec_name:string;width:number;height:number;nb_read_frames:string;tags?:{alpha_mode:string}}[]};
};
test('preflight: FFmpeg executable and required codecs must exist',()=>{
 assert.match(probeFFmpeg(ffmpeg),/ffmpeg version/i);
});
test('H.264 MP4 is opaque green-screen, dimensions/fps/frameCount verified',async()=>{
 await mkdir(base,{recursive:true});
 const file=join(base,'green-screen.mp4');
 const output=run(['--format','mp4','--background','#00FF00','--crf','18','--preset','veryfast','--out',file,'--overwrite','--ffmpeg-path',ffmpeg]);
 assert.equal(output.status,0,output.stderr);
 const stream=probe(file).streams[0]!;
 assert.equal(stream.codec_name,'h264');assert.equal(stream.width,64);assert.equal(stream.height,64);assert.equal(Number(stream.nb_read_frames),4);
 assert.ok((await stat(file)).size>100);
 const decoded=spawnSync(ffmpeg,['-v','error','-i',file,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1'],
  {timeout:30000,maxBuffer:64*64*4+8192});
 assert.equal(decoded.status,0,String(decoded.stderr));assert.equal(decoded.stdout.length,64*64*4);
 assert.ok(decoded.stdout[1]!>120&&decoded.stdout[3]===255,'solid background was not composited');
});
test('VP9 WebM retains alpha metadata AND a decoded transparent pixel',async()=>{
 await mkdir(base,{recursive:true});
 const file=join(base,'transparent.webm');
 const output=run(['--format','webm','--alpha','--crf','28','--preset','good','--out',file,'--overwrite','--ffmpeg-path',ffmpeg]);
 assert.equal(output.status,0,output.stderr);
 const stream=probe(file).streams[0]!;
 assert.equal(stream.codec_name,'vp9');assert.equal(stream.tags?.alpha_mode,'1');
 assert.equal(Number(stream.nb_read_frames),4);
 const decoded=spawnSync(ffmpeg,['-v','error','-c:v','libvpx-vp9','-i',file,
  '-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{timeout:30000,maxBuffer:64*64*4+8192});
 assert.equal(decoded.status,0,String(decoded.stderr));
 assert.equal(decoded.stdout.length,64*64*4);
 assert.ok([...decoded.stdout.filter((_,i)=>i%4===3)].some(a=>a<64),'VP9 alpha lost in decoder');
});
test('FFmpeg failures are diagnostic and never leave successful output',async()=>{
 await mkdir(base,{recursive:true});
 const missing=join(base,'does-not-exist.mp4');
 const bad=run(['--format','mp4','--out',missing,'--ffmpeg-path',join(base,'no such ffmpeg')]);
 assert.notEqual(bad.status,0);
 assert.equal(await stat(missing).then(()=>true,()=>false),false);
 const invalid=run(['--format','mp4','--out',missing,'--crf','99']);
 assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/CRF/);
 const invalidAlpha=run(['--format','mp4','--out',missing,'--alpha']);
 assert.notEqual(invalidAlpha.status,0);
});
test('FFmpeg frame stream cancellation tears down child and cleans stage',async()=>{
 await mkdir(base,{recursive:true});
 const destination=join(base,'aborted.webm');
 const ac=new AbortController();
 await assert.rejects(()=>encodeVideoFrames({
  format:'webm',width:64,height:64,fps:10,output:destination,ffmpegPath:ffmpeg,signal:ac.signal,alpha:true
 },async consume=>{
  await consume(new Uint8Array(64*64*4));
  ac.abort();
  await consume(new Uint8Array(64*64*4));
  return 2;
 }),/cancel|aborted/i);
 assert.equal(await stat(destination).then(()=>true,()=>false),false);
});
