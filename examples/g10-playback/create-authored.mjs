/** Generate a demonstrably self-authored G10 manifest with exact IR digest. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));const root=resolve(here,'../..');
const ir=readFileSync(join(root,'fixtures/minimal.json'));
copyFileSync(join(root,'fixtures/minimal.json'),join(here,'self-authored.ir.json'));
copyFileSync(join(root,'fixtures/synthetic-example.png'),join(here,'self-authored.png'));
const sha=createHash('sha256').update(ir).digest('hex');
const manifest={format:'riglyph-g10-playback-schedule-v1',
 scenario:{id:'g10-authored-playback',targetCompatibilityVersion:'4.1.23',referenceViewerVersion:'4.1.24',referenceStatus:'UNVERIFIED_NO_REFERENCE',referenceKind:'none',referenceAvailable:false,fixtureOrigin:'DERIVED_ONLY',irArtifactSha256:sha},
 assets:{ir:'self-authored.ir.json',textures:[{pageId:'page0',path:'self-authored.png'}]},
 schedule:[
  {op:'set',track:0,clipId:'rotate90',loop:true},{op:'speed',value:.29},{op:'advance',wallDeltaSec:1},{op:'sample',id:'slow'},
  {op:'pause'},{op:'advance',wallDeltaSec:1},{op:'sample',id:'paused'},{op:'resume'},
  {op:'speed',value:1},{op:'seek',track:0,timeSec:.5},{op:'sample',id:'seek'},
  {op:'transition',track:0,clipId:'rotate90',loop:true,mixDurationSec:.3},{op:'advance',wallDeltaSec:.15},{op:'sample',id:'half-mix'},
  {op:'advance',wallDeltaSec:.15},{op:'sample',id:'mix-end'},
  {op:'queue',track:0,clipId:'rotate90',loop:false,mixDurationSec:0},{op:'sample',id:'queued'}],
 samples:{bones:['root'],vertices:[]},render:{viewport:{left:-2,bottom:-2,width:4,height:4},width:64,height:64,sampling:'nearest',clearRGBA:[0,0,0,0]}};
writeFileSync(join(here,'self-authored.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Wrote self-authored G10 example; referenceVerified=false');
