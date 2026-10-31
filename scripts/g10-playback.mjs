/** G10 candidate-only playback schedule recorder.
 * Uses the same AnimationPlayer as the WebPlayer; no reference runtime, no automatic parity claim.
 * Raw matrices, vertices, event traces, and frame-locked PNG remain in a PRIVATE directory.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deserializeIR} from '@riglyph/core';
import {SkeletonInstance,AnimationPlayer,inspectEvaluability} from '@riglyph/runtime';
import {prepareDrawPackets} from '@riglyph/renderer-webgl2';
import {rasterize} from '@riglyph/renderer-cpu';
import {encodePNG} from '@riglyph/cli';
import {preflightPNG,checkAggregateTextures,loadPNGBounded} from './g8-png.mjs';
import {checkSourceIdentity,validateSourceDeclaration} from './g8-source.mjs';
import {ConformanceError,canonical,digest} from './g6-conformance.mjs';
const ensure=(condition,code,message)=>{if(!condition)throw new ConformanceError(code,message);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const ident=s=>typeof s==='string'&&/^[a-zA-Z0-9][\w.:-]{0,95}$/.test(s);
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const sha=b=>createHash('sha256').update(b).digest('hex');
const exact=(value,allowed,name)=>{ensure(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_SCENARIO',`${name} must be an object`);for(const k of Object.keys(value))ensure(allowed.includes(k),'INVALID_SCENARIO',`Unexpected ${name}.${k}`);};
const bounded=(path,max)=>{const st=statSync(path);ensure(st.isFile()&&st.size<=max,'LIMIT_EXCEEDED','G10 input file over limit');return readFileSync(path);};
const pth=(base,p)=>{ensure(typeof p==='string'&&p.length>0&&p.length<2048&&!p.includes('\0'),'INVALID_SCENARIO','Invalid local path');return resolve(base,p);};
const duration=n=>finite(n)&&n>=0&&n<=1_000_000;
const positiveIndex=n=>Number.isSafeInteger(n)&&n>=0&&n<=31;
export function validatePlaybackManifest(m){
 exact(m,['format','scenario','assets','schedule','samples','render'],'manifest');
 ensure(m.format==='riglyph-g10-playback-schedule-v1','INVALID_SCENARIO','Wrong G10 format');
 exact(m.scenario,['id','targetCompatibilityVersion','referenceViewerVersion','referenceStatus','referenceKind','referenceAvailable','fixtureOrigin','sourceFamily','adapterId','observedSourceVersion','originalSourceSha256','irArtifactSha256','sourceVersion','sourceArtifactSha256','sampleLayoutSha256','notes'],'scenario');
 const s=m.scenario;
 ensure(ident(s.id)&&s.targetCompatibilityVersion==='4.1.23','INVALID_SCENARIO','G10 supports only 4.1.23 source compatibility target');
 ensure(s.referenceViewerVersion===undefined||s.referenceViewerVersion==='4.1.24','INVALID_SCENARIO','Reference Viewer version must be specified independently');
 ensure(s.referenceStatus==='UNVERIFIED_NO_REFERENCE','UNREVIEWED_PROVENANCE','G10 candidate cannot certify official parity');
 ensure(s.referenceKind===undefined||['none','manual-screenshot','numeric-capture','rgba-capture'].includes(s.referenceKind),'INVALID_SCENARIO','Invalid reference kind');
 ensure(s.referenceAvailable===false||s.referenceAvailable===undefined,'UNREVIEWED_PROVENANCE','Use the independent G6 attestation flow for real reference captures');
 ensure(['DERIVED_ONLY','PRIVATE_SOURCE'].includes(s.fixtureOrigin),'INVALID_SCENARIO','Invalid fixture origin');
 validateSourceDeclaration({...s,sourceVersion:s.sourceVersion??s.targetCompatibilityVersion});
 exact(m.assets,['ir','originalSource','textures'],'assets');
 ensure(typeof m.assets.ir==='string','INVALID_SCENARIO','IR input is required');
 ensure(m.assets.originalSource===undefined||typeof m.assets.originalSource==='string','INVALID_SCENARIO','Invalid original source');
 ensure(Array.isArray(m.assets.textures)&&m.assets.textures.length<=8,'LIMIT_EXCEEDED','Texture page list invalid');
 const texIds=new Set();for(const t of m.assets.textures){exact(t,['pageId','path','sha256'],'texture');ensure(ident(t.pageId)&&typeof t.path==='string'&&!texIds.has(t.pageId),'INVALID_SCENARIO','Invalid texture');ensure(t.sha256===undefined||hex(t.sha256),'INVALID_SCENARIO','Texture hash invalid');texIds.add(t.pageId);}
 ensure(Array.isArray(m.schedule)&&m.schedule.length>0&&m.schedule.length<=4096,'LIMIT_EXCEEDED','Schedule must contain 1..4096 actions');
 const operation={set:['op','track','clipId','loop'],transition:['op','track','clipId','loop','mixDurationSec'],queue:['op','track','clipId','loop','mixDurationSec'],clearTrack:['op','track'],clearQueue:['op','track'],speed:['op','value'],pause:['op'],resume:['op'],seek:['op','track','timeSec'],advance:['op','wallDeltaSec'],sample:['op','id']};
 for(const a of m.schedule){exact(a,operation[a?.op]??[],'schedule action');ensure(operation[a.op],'INVALID_SCENARIO','Unknown schedule operation');
  if(['set','transition','queue','clearTrack','clearQueue','seek'].includes(a.op))ensure(positiveIndex(a.track),'INVALID_SCENARIO','Track index must be explicit');
  if(['set','transition','queue'].includes(a.op))ensure(ident(a.clipId)&&typeof a.loop==='boolean','INVALID_SCENARIO','Explicit clip and loop required');
  if(['transition','queue'].includes(a.op))ensure(duration(a.mixDurationSec),'INVALID_SCENARIO','Invalid mix duration');
  if(a.op==='speed')ensure(duration(a.value)&&a.value<=100,'INVALID_SCENARIO','Speed must be 0..100');
  if(a.op==='advance')ensure(duration(a.wallDeltaSec)&&a.wallDeltaSec<=60,'INVALID_SCENARIO','Wall time step must be <=60 s');
  if(a.op==='seek')ensure(duration(a.timeSec),'INVALID_SCENARIO','Seek time invalid');
  if(a.op==='sample')ensure(ident(a.id),'INVALID_SCENARIO','Sample ID invalid');
 }
 ensure(m.schedule.some(s=>s.op==='sample'),'INVALID_SCENARIO','Schedule requires sample operations');
 const ids=m.schedule.filter(s=>s.op==='sample').map(s=>s.id);ensure(new Set(ids).size===ids.length,'INVALID_SCENARIO','Duplicate sample IDs');
 exact(m.samples,['bones','vertices'],'samples');
 ensure(Array.isArray(m.samples.bones)&&m.samples.bones.length<=512&&m.samples.bones.every(ident)&&new Set(m.samples.bones).size===m.samples.bones.length,'INVALID_SCENARIO','Invalid bone selectors');
 ensure(Array.isArray(m.samples.vertices)&&m.samples.vertices.length<=128,'INVALID_SCENARIO','Invalid vertex selectors');
 for(const v of m.samples.vertices){exact(v,['attachmentId','ownerBoneId','deformOwnerId'],'vertex');ensure(ident(v.attachmentId)&&ident(v.ownerBoneId)&&(v.deformOwnerId===undefined||ident(v.deformOwnerId)),'INVALID_SCENARIO','Bad vertex selector');}
 if(m.render!==undefined){exact(m.render,['viewport','width','height','sampling','clearRGBA'],'render');const r=m.render;exact(r.viewport,['left','bottom','width','height'],'viewport');ensure([r.viewport.left,r.viewport.bottom,r.viewport.width,r.viewport.height].every(finite)&&r.viewport.width>0&&r.viewport.height>0,'INVALID_SCENARIO','Invalid viewport');ensure(Number.isSafeInteger(r.width)&&Number.isSafeInteger(r.height)&&r.width>0&&r.height>0&&r.width*r.height<=1_048_576,'LIMIT_EXCEEDED','Invalid frame size');ensure(['nearest','linear'].includes(r.sampling)&&Array.isArray(r.clearRGBA)&&r.clearRGBA.length===4&&r.clearRGBA.every(x=>Number.isInteger(x)&&x>=0&&x<=255),'INVALID_SCENARIO','Invalid RGBA/sampling');}
 return m;
}
function matrixAndVertices(instance,m){
 const matrices=[],vertices=[];
 for(const id of m.samples.bones){const mat=instance.world.get(id);ensure(mat,'INVALID_SCENARIO',`Unknown world bone ${id}`);matrices.push({id,affine:[mat.a,mat.b,mat.c,mat.d,mat.x,mat.y]});}
 for(const v of m.samples.vertices){let mesh=instance.assets.get(v.attachmentId),seen=new Set();ensure(mesh,'INVALID_SCENARIO','Attachment not found');
  while(mesh.kind==='linked_mesh'){ensure(!seen.has(mesh.id),'INVALID_SCENARIO','Linked mesh cycle');seen.add(mesh.id);mesh=instance.assets.get(mesh.parentMeshId);ensure(mesh,'INVALID_SCENARIO','Missing mesh parent');}
  ensure('vertices'in mesh&&instance.world.has(v.ownerBoneId),'INVALID_SCENARIO','Invalid attachment vertices or owner');
  const xy=instance.vertices(mesh.vertices,v.ownerBoneId,instance.deforms.get(v.deformOwnerId??v.attachmentId));ensure(xy.length<=100000,'LIMIT_EXCEEDED','Too many vertex values');vertices.push({...v,xy:[...xy]});
 }
 return {matrices,vertices};
}
export async function executeSchedule(m,{baseDir='.'}={}){
 validatePlaybackManifest(m);const root=resolve(baseDir);const irBytes=bounded(pth(root,m.assets.ir),32*1024*1024);const ir=deserializeIR(irBytes.toString('utf8'));
 // IR/source identity must be verified before any candidate results are accepted.
 const identity=await checkSourceIdentity(m.scenario,ir,irBytes,m.assets,root);
 const clipIds=m.schedule.filter(a=>['set','transition','queue'].includes(a.op)).map(a=>a.clipId);
 const cap=inspectEvaluability(ir,{clipIds});ensure(cap.fullyEvaluable,'UNSUPPORTED_SEMANTIC_FEATURE','Active constraint unsupported');
 const instance=new SkeletonInstance(ir),player=new AnimationPlayer(instance);
 const tex=new Map();let textureHashes=[];
 if(m.render){ensure(ir.atlases.pages.length===m.assets.textures.length,'MISSING_TEXTURE_PAGE','All atlas pages required');
  const specs=ir.atlases.pages.map(page=>{const t=m.assets.textures.find(t=>t.pageId===page.id);ensure(t,'MISSING_TEXTURE_PAGE',`Missing page ${page.id}`);const path=pth(root,t.path),header=preflightPNG(path);ensure(header.width===page.width&&header.height===page.height,'INVALID_ATLAS','Texture dimensions mismatch');return {page,t,path,header};});
  checkAggregateTextures(specs.map(s=>s.header));
  for(const {page,t,path,header} of specs){const decoded=await loadPNGBounded(path,header);ensure(!t.sha256||t.sha256===decoded.sha256,'SOURCE_DIGEST_MISMATCH','Texture hash differs');
   tex.set(page.id,{width:decoded.width,height:decoded.height,rgba:decoded.rgba,premultiplied:page.pma,wrapU:page.wrapU??'clamp',wrapV:page.wrapV??'clamp'});textureHashes.push({pageId:page.id,sha256:decoded.sha256});}
 }
 let playing=true,wallSec=0,actionIndex=0;const samples=[],events=[];const privateFiles=[];
 for(const a of m.schedule){actionIndex++;
  switch(a.op){
   case 'set':player.set(a.track,a.clipId,a.loop,0);break;
   case 'transition':player.set(a.track,a.clipId,a.loop,a.mixDurationSec);break;
   case 'queue':player.queue(a.track,a.clipId,a.loop,a.mixDurationSec);break;
   case 'clearTrack':player.clear(a.track);break;
   case 'clearQueue':player.clearQueue(a.track);break;
   case 'speed':player.timeScale=a.value;break;
   case 'pause':playing=false;break;
   case 'resume':playing=true;break;
   case 'seek':player.seek(a.track,a.timeSec);break;
   case 'advance':{
    wallSec+=a.wallDeltaSec;
    if(playing){player.advance(a.wallDeltaSec);for(const notice of player.notices)events.push({actionIndex,wallSec,notice});}
    break;
   }
   case 'sample':{
    player.samplePose();const diag=player.diagnostics();const geometry=matrixAndVertices(instance,m),packets=prepareDrawPackets(instance);
    ensure(geometry.matrices.every(v=>v.affine.every(finite))&&geometry.vertices.every(v=>v.xy.every(finite)),'INVALID_CANDIDATE_OUTPUT','Nonfinite G2 samples');
    const sample={id:a.id,actionIndex,wallSec,playing,speed:player.timeScale,tracks:diag,drawPackets:packets.length,
     triangles:packets.reduce((sum,p)=>sum+p.indices.length/3,0),...geometry};
    const bytes=Buffer.from(canonical(sample),'utf8');const name=`sample-${String(samples.length).padStart(3,'0')}-${a.id}.json`;
    privateFiles.push({name,bytes});
    const record={id:a.id,actionIndex,wallSec,speed:player.timeScale,tracks:diag.map(t=>({track:t.track,clipId:t.clipId,elapsedTimelineSec:t.elapsedTimelineSec,sampledClipTimeSec:t.sampledClipTimeSec,loopCount:t.loopCount,mix:t.mix,queueLength:t.queue.length})),drawPackets:packets.length,triangles:sample.triangles,
     g2Sha256:sha(bytes),matrixCount:geometry.matrices.length,vertexSamples:geometry.vertices.length};
    if(m.render){const r=m.render,rgba=Buffer.from(rasterize(packets,tex,r.viewport,r.width,r.height,r.clearRGBA.map(x=>x/255),{sampling:r.sampling}));
     const png=encodePNG(r.width,r.height,rgba);const frameName=`frame-${String(samples.length).padStart(3,'0')}-${a.id}.png`;
     privateFiles.push({name:frameName,bytes:png});record.g3RgbaSha256=sha(rgba);record.g3PngSha256=sha(png);record.g3RgbaBytes=rgba.length;record.viewport=r.viewport;
    }
    samples.push(record);break;
   }
  }
 }
 const eventRaw=Buffer.from(canonical(events),'utf8');privateFiles.push({name:'events.json',bytes:eventRaw});
 const metadata={format:'riglyph-g10-candidate-summary-v1',scenarioId:m.scenario.id,sourceTargetVersion:identity.targetCompatibilityVersion,
  observedSourceVersion:identity.observedSourceVersion,referenceViewerVersion:m.scenario.referenceViewerVersion??null,
  referenceStatus:'UNVERIFIED_NO_REFERENCE',referenceVerified:false,manualScreenshotIsNumericOracle:false,
  fixtureOrigin:m.scenario.fixtureOrigin,sourceIdentityStatus:identity.sourceIdentityStatus,sourceArtifactSha256:sha(irBytes),
  originalSourceSha256:identity.originalSourceSha256,texturePages:textureHashes,scenarioSha256:digest(canonical(m)),
  scheduleSha256:digest(canonical(m.schedule)),eventsSha256:sha(eventRaw),eventCount:events.length,samples,generatedBy:'candidate-animation-player-no-reference-runtime'};
 return {summary:metadata,privateFiles};
}
export async function runSchedule({manifestPath,privateDir,summaryPath,dryRun=false}){
 const path=resolve(manifestPath),source=bounded(path,512*1024);let manifest;try{manifest=JSON.parse(source.toString('utf8'));}catch{throw new ConformanceError('INVALID_SCENARIO','Manifest must be JSON');}
 const result=await executeSchedule(manifest,{baseDir:dirname(path)});
 if(dryRun)return {...result.summary,generatedFiles:false};
 const privateAbs=resolve(privateDir),summaryAbs=resolve(summaryPath),relativeToPrivate=relative(privateAbs,summaryAbs);
 ensure(privateAbs!==summaryAbs&&(relativeToPrivate==='..'||relativeToPrivate.startsWith('../')||isAbsolute(relativeToPrivate)),'INVALID_SCENARIO','Summary must be outside private captures');
 ensure(!existsSync(privateAbs)&&!existsSync(summaryAbs),'OUTPUT_ALREADY_EXISTS','Refuse to overwrite evidence');
 mkdirSync(privateAbs,{recursive:false,mode:0o700});
 try{for(const f of result.privateFiles)writeFileSync(join(privateAbs,f.name),f.bytes,{flag:'wx',mode:0o600});
  writeFileSync(summaryAbs,JSON.stringify(result.summary,null,2)+'\n',{flag:'wx'});
 }catch(error){rmSync(privateAbs,{recursive:true,force:true});throw error;}
 return {...result.summary,generatedFiles:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [cmd,manifest,privateDir,summaryPath]=process.argv.slice(2);
  ensure(['run','dry-run'].includes(cmd)&&manifest&&privateDir&&summaryPath,'INVALID_ARGUMENT','Usage: node scripts/g10-playback.mjs run|dry-run manifest.json PRIVATE_DIR summary.json');
  const result=await runSchedule({manifestPath:manifest,privateDir,summaryPath,dryRun:cmd==='dry-run'});
  console.log(JSON.stringify({status:'CANDIDATE_GENERATED_ONLY',scenarioId:result.scenarioId,samples:result.samples.length,referenceVerified:false}));
 }catch(error){console.error(JSON.stringify({code:error?.code??'G10_FAILED',message:error?.message??String(error),referenceVerified:false}));process.exitCode=1;}
}
