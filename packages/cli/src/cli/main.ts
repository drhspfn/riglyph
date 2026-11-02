#!/usr/bin/env node
import {readFile,writeFile,stat,rename,unlink,copyFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EngineError,requireCondition} from '@riglyph/core';
import {AdapterRegistry,syntheticAdapter} from '@riglyph/importer-sdk';
import {parseAtlas,checkAtlasImages,pngDimensions as pngHeader} from '@riglyph/core';
import {deserializeIR,serializeIR,inspectIR} from '@riglyph/core';
import {SkeletonInstance,inspectEvaluability} from '@riglyph/runtime';
import {prepareDrawPackets,drawBounds} from '@riglyph/renderer-webgl2';
import {rasterize} from '@riglyph/renderer-cpu';
import {encodePNG,decodePNG} from './png.js';
import {commitConvertedDirectory} from './transaction.js';
import {runRenderCli,renderHelp} from './render.js';
const packageVersion=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8')) as {version:string};
/** Explicit plugin list only: installed packages are trusted code, never loaded from a source header. */
async function configuredRegistry():Promise<AdapterRegistry>{
 const registry=new AdapterRegistry();registry.register(syntheticAdapter);
 let names=['@riglyph/importer-spine-4.1'];
 const config=getArg('--plugins-config');
 if(config){const data=JSON.parse(await readText(config,64*1024)) as {plugins:unknown};
  requireCondition(Array.isArray(data.plugins)&&data.plugins.every(x=>typeof x==='string'&&x.length<256),'INVALID_HEADER','Plugin config must contain string array');
  names=[...data.plugins];
 }
 for(let i=0;i<process.argv.length;i++)if(process.argv[i]==='--plugin'){
  const name=process.argv[i+1];requireCondition(name,'INVALID_HEADER','Missing --plugin specifier');names.push(name);
 }
 for(const name of [...new Set(names)]){
  // An explicit configured module may execute arbitrary trusted code. Never auto-discover from disk.
  const module=await import(name) as Record<string,unknown>;
  registry.registerModule(module);
 }
 return registry;
}
const help=`Universal Skeleton Engine ${packageVersion.version} (Spine Binary 4.1.23 source-specific plugin; this build requires independent G1 regression; official G2/G3 UNVERIFIED)
  probe <file>                       Inspect source version / confirmed binary header
  wire <file>                       Plugin-provided wire diagnostics + section offsets
  import <file> --atlas file.atlas --out <ir.json>
                                     Transactional import; atlas required for textured skeletons
  convert <file> --atlas file.atlas --images dir --out-dir directory [--overwrite]
                                     Static validated IR + manifest + copied PNG textures; --overwrite replaces existing directory safely
  validate <ir.json>                Structural + semantic validation
  stats <ir.json>                   Print entity and feature counts
  capabilities <ir.json> [--skin id] [--clip id]   Report local support and unsupported active behaviors (exit 3 if blocked)
  atlas <file.atlas> [--images dir] Parse atlas; optionally check declared PNG headers
  snapshot <ir.json> --images dir --out frame.png [--clip id] [--time sec] [--width 800] [--height 600]
                                     Rasterize real frame to PNG without GPU
  render <ir.json> [--images dir] --clip id --out-dir dir [--format png-sequence|mp4|webm]\n                                     Browser-free CPU animation sequence/video export; render --help lists options\n  frame <ir.json> [--clip id] [--time seconds] [--skin id]
                                     Evaluate CPU world packets and report bounds
  --plugin <installed-package>      Explicitly register a module exporting importerPlugin and optional detector(s)
  --plugins-config <json>          Explicit plugin list (no auto-discovery)
  --version                          Show engine CLI package version
  help                               Show this text`;
const getArg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const json=(data:unknown)=>process.stdout.write(JSON.stringify(data,null,2)+'\n');
async function read(path:string,limit=64*1024*1024):Promise<Buffer>{
 const info=await stat(path);
 requireCondition(info.isFile()&&info.size<=limit,'LIMIT_EXCEEDED',`Input must be a regular file no larger than ${limit} bytes`);
 return readFile(path);
}
async function readText(path:string,limit?:number){return (await read(path,limit)).toString('utf8');}
async function loadIR(file:string){return deserializeIR(await readText(file));}
/** Write only after a complete import and validated serialization, then atomically commit. */
async function writeAtomic(path:string,data:string):Promise<void>{
 const temporary=join(dirname(resolve(path)),`.agent-b-${randomUUID()}.tmp`);
 try{await writeFile(temporary,data,{flag:'wx'});await rename(temporary,path);}
 catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
async function main():Promise<void>{
 const cmd=process.argv[2]??'help',file=process.argv[3];
 if(cmd==='--version'||cmd==='version'){process.stdout.write(packageVersion.version+'\n');return;}
 const registry=await configuredRegistry();
 if(cmd==='help'||cmd==='--help'||cmd==='-h'){process.stdout.write(help+'\n');return;}
 if(cmd==='render'&&(file==='--help'||file==='-h')){process.stdout.write(renderHelp);return;}
 if(cmd==='render'){requireCondition(!!file,'INVALID_HEADER','render requires IR path');await runRenderCli(file,process.argv.slice(4));return;}
 requireCondition(!!file,'INVALID_HEADER','Expected file path');
 if(cmd==='probe'){
  const bytes=await read(file);const identity=registry.detect(bytes,file);
  const adapter=registry.compatible(identity);
  json({identity,availability:adapter?'AVAILABLE':'UNSUPPORTED_VERSION',compatiblePlugin:adapter?.id??null,status:identity.family==='synthetic-test'?'verified-synthetic':'unverified',plugin:adapter?.id??null,packageVersion:adapter?.adapterVersion??null,...(adapter?.inspectHeader?{header:adapter.inspectHeader(bytes,file)}:{})});
 }else if(cmd==='wire'){
  const bytes=await read(file);json(registry.wire(bytes,file));
 }else if(cmd==='import'){
  const target=getArg('--out');requireCondition(target,'INVALID_HEADER','Expected --out destination');
  const bytes=await read(file);const atlasFile=getArg('--atlas');const atlas=atlasFile?parseAtlas(await readText(atlasFile,16*1024*1024)):undefined;
  const result=registry.import({bytes,source:basename(file),...(atlas?{atlas}:{})});
  // Only commit after full import, validation and byte-consumption checks.
  await writeAtomic(target,serializeIR(result.ir));json({output:target,report:result.report});
 }else if(cmd==='convert'){
  const outDir=getArg('--out-dir'),atlasFile=getArg('--atlas');
  requireCondition(outDir,'INVALID_HEADER','convert requires --out-dir');
  const bytes=await read(file),atlas=atlasFile?parseAtlas(await readText(atlasFile,16*1024*1024)):undefined;
  const {ir,report}=registry.import({bytes,source:basename(file),...(atlas?{atlas}:{})});
  const destination=resolve(outDir),parent=dirname(destination);
  await mkdir(parent,{recursive:true});const stage=await mkdtemp(join(parent,'.skeleton-convert-'));
  try{
   await writeFile(join(stage,'skeleton.ir.json'),serializeIR(ir));
   const pages=[];
   const base=resolve(getArg('--images')??(atlasFile?dirname(atlasFile):dirname(file)));
   for(const page of ir.atlases.pages){
    const rel=page.path.replaceAll('\\','/');
    requireCondition(!rel.startsWith('/')&&!rel.split('/').some(s=>s==='..'||s==='.'||s==='')&&!isAbsolute(rel),'INVALID_ATLAS','Unsafe texture path');
    const source=resolve(base,rel),safe=relative(base,source);
    requireCondition(!safe.startsWith('..')&&!isAbsolute(safe),'INVALID_ATLAS','Unsafe page path');
    const data=await read(source);
    // Reuse atlas PNG signature and dimensions, not an unverified image decoder.
    const texture=pngHeader(data);requireCondition(texture[0]===page.width&&texture[1]===page.height,'INVALID_ATLAS',`Texture dimension mismatch ${page.id}`);
    const target=join(stage,'textures',rel);await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
    pages.push({pageId:page.id,url:'textures/'+rel});
   }
   const asset={assetFormat:'universal-skeleton-asset',assetVersion:'1.0.0',ir:'skeleton.ir.json',pages,...(ir.skeleton.animations[0]?{defaultAnimation:ir.skeleton.animations[0].id}:{})};
   await writeFile(join(stage,'manifest.json'),JSON.stringify(asset,null,2)+'\n');
   await commitConvertedDirectory(stage,destination,process.argv.includes('--overwrite'));
   json({outputDir:destination,manifest:join(destination,'manifest.json'),report});
  }catch(error){await rm(stage,{recursive:true,force:true});throw error;}
 }else if(cmd==='validate'){
  const parsed:unknown=JSON.parse(await readText(file));
  const issues=inspectIR(parsed);json({valid:issues.length===0,issues});if(issues.length)process.exitCode=2;
 }else if(cmd==='capabilities'){
  const ir=await loadIR(file);const skinId=getArg('--skin'),clipId=getArg('--clip');const report=inspectEvaluability(ir,{...(skinId!==undefined?{skinId}:{}),...(clipId!==undefined?{clipIds:[clipId]}:{})});
  json(report);if(!report.fullyEvaluable)process.exitCode=3;
 }else if(cmd==='stats'){
  const ir=await loadIR(file),s=ir.skeleton;
  json({format:ir.format,source:ir.source,capabilities:ir.capabilities,counts:{bones:s.bones.length,slots:s.slots.length,skins:s.skins.length,attachments:s.attachments.length,meshes:s.attachments.filter(a=>a.kind==='mesh').length,linkedMeshes:s.attachments.filter(a=>a.kind==='linked_mesh').length,weightedVertices:s.attachments.filter(a=>'vertices'in a).flatMap(a=>a.vertices).filter(v=>v.position===null).length,constraints:s.constraints.length,events:s.events.length,animations:s.animations.length,timelines:s.animations.reduce((n,a)=>n+a.timelines.length,0),keyframes:s.animations.reduce((n,a)=>n+a.timelines.reduce((m,t)=>m+t.keys.length,0),0),pages:ir.atlases.pages.length,regions:ir.atlases.regions.length}});
 }else if(cmd==='atlas'){
  const atlas=parseAtlas(await readText(file,16*1024*1024));
  if(getArg('--images')){
   const root=resolve(getArg('--images')!);const images:Record<string,Uint8Array>={};
   for(const page of atlas.pages){
    const full=resolve(root,page.path);requireCondition(!relative(root,full).startsWith('..')&&!isAbsolute(relative(root,full)),'INVALID_ATLAS','Atlas path traversal');
    images[page.path]=await read(full);
   }
   checkAtlasImages(atlas,images);
  }
  json({status:'parsed',pages:atlas.pages,regions:atlas.regions,imagesVerified:!!getArg('--images')});
 }else if(cmd==='snapshot'){
  const ir=await loadIR(file);const root=getArg('--images'),out=getArg('--out');
  requireCondition(root&&out,'INVALID_HEADER','Snapshot requires --images dir and --out image.png');
  const width=Number(getArg('--width')??800),height=Number(getArg('--height')??600),time=Number(getArg('--time')??0);
  requireCondition(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&Number.isFinite(time),'INVALID_HEADER','Invalid snapshot dimensions or time');
  const instance=new SkeletonInstance(ir);const skin=getArg('--skin');if(skin)instance.setSkin(skin);
  const clip=getArg('--clip');instance.evaluate(clip?[{clipId:clip,timeSec:time}]:[]);
  const packets=prepareDrawPackets(instance);const bounds=drawBounds(packets)??[-1,-1,2,2];
  const scale=Math.max(Math.max(bounds[2],.001)/width,Math.max(bounds[3],.001)/height)*1.15;
  const vw=width*scale,vh=height*scale,view={left:bounds[0]+(bounds[2]-vw)/2,bottom:bounds[1]+(bounds[3]-vh)/2,width:vw,height:vh};
  const base=resolve(root);const pages=new Map();
  for(const page of ir.atlases.pages){const filename=resolve(base,page.path);
   requireCondition(!relative(base,filename).startsWith('..')&&!isAbsolute(relative(base,filename)),'INVALID_ATLAS','Unsafe page path');
   const {width:pw,height:ph,rgba}=decodePNG(await read(filename));
   requireCondition(pw===page.width&&ph===page.height,'INVALID_ATLAS',`Page size mismatch: ${page.path}`);
   pages.set(page.id,{width:pw,height:ph,rgba,premultiplied:page.pma});
  }
  const pixels=rasterize(packets,pages,view,width,height);await writeFile(out,encodePNG(width,height,new Uint8Array(pixels)));
  json({output:out,clip:clip??null,timeSec:time,viewport:view,width,height,packets:packets.length});
 }else if(cmd==='frame'){
  const ir=await loadIR(file);const instance=new SkeletonInstance(ir);
  const skin=getArg('--skin');if(skin)instance.setSkin(skin);
  const clip=getArg('--clip'),time=Number(getArg('--time')??'0');requireCondition(Number.isFinite(time),'INVALID_TIMELINE','Expected finite time');
  instance.evaluate(clip?[{clipId:clip,timeSec:time}]:[]);
  const packets=prepareDrawPackets(instance);
  json({source:ir.source,clip:clip??null,timeSec:time,bounds:drawBounds(packets),drawPackets:packets.map(p=>({slotId:p.slotId,attachmentId:p.attachmentId,pageId:p.pageId,blend:p.blend,vertices:p.positions.length/2,triangles:p.indices.length/3})),bones:Object.fromEntries(instance.world)});
 }else{throw new EngineError('INVALID_HEADER',`Unknown command: ${cmd}`);}
}
main().catch(error=>{
 const diag=error instanceof EngineError?error.toDiagnostic():{code:'UNEXPECTED_ERROR',severity:'error',message:error instanceof Error?error.message:String(error)};
 process.stderr.write(JSON.stringify(diag,null,2)+'\n');process.exitCode=1;
});
