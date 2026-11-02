/* End-to-end A21 animation export through Rust native backend. Always verify
 * decoded output, not merely process exit. Invoked after native build in CI. */
import {spawnSync} from 'node:child_process';
import {readFile,mkdir,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {decodePNG} from '@riglyph/cli';
const root=resolve('test-output/native');
await mkdir(root,{recursive:true});
const run=(options)=>{
 const res=spawnSync(process.execPath,['packages/cli/dist/cli/main.js','render',
  'fixtures/minimal.json','--images','fixtures','--clip','rotate90','--backend','native-cpu',
  '--native-threads','2','--fps','4','--width','64','--height','64','--start','0','--end','1',
  '--progress','none',...options],
  {encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
 if(res.status!==0)throw Error(`native CLI failure (${res.status}): ${res.stderr}`);
 return JSON.parse(res.stdout);
};
try{
 const folder=join(root,'png with spaces');
 const output=run(['--out-dir',folder]);
 if(output.frameCount!==4)throw Error('PNG native frame count mismatch');
 const names=await readdir(folder);
 if(names.filter(x=>x.endsWith('.png')).length!==4)throw Error('PNG native frame files missing');
 const first=decodePNG(await readFile(join(folder,'frame_000000.png')));
 if(first.width!==64||first.height!==64||!first.rgba.some(x=>x>0))throw Error('Native PNG not decoded');
 const mp4=join(root,'opaque with spaces.mp4'),webm=join(root,'alpha with spaces.webm');
 const video=run(['--format','mp4','--background','#00FF00','--out',mp4]);
 if(video.probe?.codec!=='h264'||video.probe.frames!==4)throw Error('Native MP4 validation failed');
 const transparent=run(['--format','webm','--alpha','--out',webm]);
 if(transparent.probe?.codec!=='vp9'||!transparent.probe.alpha||!transparent.probe.decodedAlphaVerified)
  throw Error('Native WebM decoded transparency failed');
 for(const file of [mp4,webm])if((await stat(file)).size<200)throw Error('Encoded video is empty');
 console.log(JSON.stringify({status:'pass',pngFrames:4,codecMp4:'h264',codecWebM:'vp9',
  rgbaAlpha:transparent.probe.decodedAlphaVerified,platform:process.platform}));
}finally{/* CI retains PNG/MP4/WebM as downloadable evidence. */}
