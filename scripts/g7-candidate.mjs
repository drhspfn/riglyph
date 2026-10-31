/** G7 candidate-only headless numeric/RGBA capture. No reference software, no trust decisions.
 * PRIVATE output files are for the authorized verifier's machine; only a sanitized hash/count
 * report should be shared with Agent B. Inputs are validated IR and independently authored cases.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,statSync,mkdirSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deserializeIR} from '@riglyph/core';
import {SkeletonInstance,inspectEvaluability,AnimationPlayer} from '@riglyph/runtime';
import {prepareDrawPackets} from '@riglyph/renderer-webgl2';
import {rasterize} from '@riglyph/renderer-cpu';
import {preflightPNG,checkAggregateTextures,loadPNGBounded,G8_TEXTURE_LIMITS} from './g8-png.mjs';
import {checkSourceIdentity,validateSourceDeclaration} from './g8-source.mjs';
import {ConformanceError,validateScenario,canonical,digest} from './g6-conformance.mjs';
const ok=(condition,code,reason)=>{if(!condition)throw new ConformanceError(code,reason);};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const ident=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(x);
const keys=(obj,allowed,name)=>{ok(obj&&typeof obj==='object'&&!Array.isArray(obj),'INVALID_SCENARIO',`${name} object required`);for(const k of Object.keys(obj))ok(allowed.includes(k),'INVALID_SCENARIO',`Unexpected ${name} property`);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const LIMIT_JSON=32*1024*1024;
function boundedFile(p,limit){const st=statSync(p);ok(st.isFile()&&st.size<=limit,'LIMIT_EXCEEDED','Candidate input exceeds declared limit');return readFileSync(p);}
function parseJson(bytes){let obj;try{obj=JSON.parse(bytes.toString('utf8'));}catch{throw new ConformanceError('INVALID_SCENARIO','Invalid JSON input');}return obj;}
function privatePath(base,p){ok(typeof p==='string'&&p.length>0&&p.length<2048&&p.indexOf('\0')<0,'INVALID_SCENARIO','Invalid local asset path');return resolve(base,p);}
export function validateCandidateManifest(m){
 keys(m,['format','scenario','assets','evaluation','samples'],'manifest');
 ok(m.format==='universal-skeleton-candidate-manifest-v1','INVALID_SCENARIO','Unsupported candidate manifest version');
 validateScenario(m.scenario);
 keys(m.assets,['ir','textures','originalSource'],'assets');
 validateSourceDeclaration(m.scenario);
 if(m.assets.originalSource!==undefined)ok(typeof m.assets.originalSource==='string'&&m.assets.originalSource.length>0,'INVALID_SCENARIO','Invalid original source path');
 ok(typeof m.assets.ir==='string'&&m.assets.ir.length>0,'INVALID_SCENARIO','IR source required');
 ok(Array.isArray(m.assets.textures)&&m.assets.textures.length<=G8_TEXTURE_LIMITS.maxPages,'LIMIT_EXCEEDED','Too many texture pages');
 const set=new Set();for(const t of m.assets.textures){keys(t,['pageId','path','sha256'],'texture');ok(ident(t.pageId)&&typeof t.path==='string','INVALID_SCENARIO','Texture page needs ID and PNG path');ok(t.sha256===undefined||typeof t.sha256==='string'&&/^[0-9a-f]{64}$/.test(t.sha256),'INVALID_SCENARIO','Invalid texture SHA-256');ok(!set.has(t.pageId),'INVALID_SCENARIO','Duplicate page ID');set.add(t.pageId);}
 keys(m.evaluation,['skinId','layers'],'evaluation');
 ok(m.evaluation.skinId===null||ident(m.evaluation.skinId),'INVALID_SCENARIO','Invalid skin');
 ok(Array.isArray(m.evaluation.layers)&&m.evaluation.layers.length<=16,'LIMIT_EXCEEDED','Too many animation layers');
 const layers=m.evaluation.layers;for(const l of layers){
  keys(l,['clipId','timeSec','loop','alpha','mode'],'layer');ok(ident(l.clipId)&&finite(l.timeSec)&&Math.abs(l.timeSec)<=1_000_000,'INVALID_SCENARIO','Invalid layer clip/time');
  ok(l.loop===undefined||typeof l.loop==='boolean','INVALID_SCENARIO','Invalid loop');
  ok(l.alpha===undefined||finite(l.alpha)&&l.alpha>=0&&l.alpha<=1,'INVALID_SCENARIO','Invalid alpha');
  ok(l.mode===undefined||['replace','add'].includes(l.mode),'INVALID_SCENARIO','Invalid layer mode');
 }
 // The comparison scenario is the same experiment; refuse accidental cross-time/track capture.
 const c=m.scenario.conditions;
 ok(c.trackOrder.length===layers.length&&c.trackOrder.every((id,i)=>id===i),'INVALID_SCENARIO','Capture layer order must match comparison trackOrder');
 ok(layers.length===0?c.clipId==='':layers[0].clipId===c.clipId,'INVALID_SCENARIO','Clip mismatch');
 ok(layers.length===0?c.timeSec===0:layers[0].timeSec===c.timeSec,'INVALID_SCENARIO','Time mismatch');
 ok(c.updateOrder.length===1&&c.updateOrder[0].method==='evaluate'&&c.updateOrder[0].timeSec===c.timeSec,'UNSUPPORTED_SEMANTIC_FEATURE','Candidate supports only a deterministic single evaluate step');
 ok(c.coordinates.matrixOrder==='a,b,c,d,x,y'&&c.coordinates.yAxis==='up'&&c.coordinates.rotationUnits==='degrees'&&c.coordinates.globalTransformPolicy==='identity','UNSUPPORTED_SEMANTIC_FEATURE','Nonidentity global transform capture not yet defined');
 ok(c.skinId===(m.evaluation.skinId??''),'INVALID_SCENARIO','Skin mismatch');
 keys(m.samples,['bones','vertices','constraints','events'],'samples');
 ok(Array.isArray(m.samples.bones)&&m.samples.bones.length<=2048&&m.samples.bones.every(ident)&&new Set(m.samples.bones).size===m.samples.bones.length,'INVALID_SCENARIO','Invalid bone sampling list');
 ok(Array.isArray(m.samples.vertices)&&m.samples.vertices.length<=256,'LIMIT_EXCEEDED','Too many mesh samplers');
 for(const v of m.samples.vertices){keys(v,['attachmentId','ownerBoneId','deformOwnerId'],'vertex sampler');ok(ident(v.attachmentId)&&ident(v.ownerBoneId)&&(!('deformOwnerId'in v)||ident(v.deformOwnerId)),'INVALID_SCENARIO','Invalid vertex sampler');}
 ok(m.samples.constraints===undefined||Array.isArray(m.samples.constraints)&&m.samples.constraints.length<=256,'INVALID_SCENARIO','Invalid constraint samplers');
 for(const c of m.samples.constraints??[]){keys(c,['id','parameters'],'constraint sampler');ok(ident(c.id)&&Array.isArray(c.parameters)&&c.parameters.length<=64&&c.parameters.every(ident)&&new Set(c.parameters).size===c.parameters.length,'INVALID_SCENARIO','Invalid constraint sampler fields');}
 ok(m.samples.events===undefined||m.samples.events===false,'UNSUPPORTED_SEMANTIC_FEATURE','Event dispatch requires advance/seek observations; not silently captured by evaluate()');
 if(m.scenario.gate==='G2')ok(m.samples.bones.length+m.samples.vertices.length+(m.samples.constraints?.length??0)>0,'INVALID_SCENARIO','G2 capture needs selected numeric samples');
 return m;
}
export async function captureCandidate(manifest,{baseDir='.'}={}){
 const m=validateCandidateManifest(manifest),base=resolve(baseDir),bytes=boundedFile(privatePath(base,m.assets.ir),LIMIT_JSON);
 const ir=deserializeIR(bytes.toString('utf8'));
 const identity=await checkSourceIdentity(m.scenario,ir,bytes,m.assets,base);
 const cap=inspectEvaluability(ir,{skinId:m.evaluation.skinId,clipIds:m.evaluation.layers.map(l=>l.clipId)});
 ok(cap.fullyEvaluable,'UNSUPPORTED_SEMANTIC_FEATURE','Active runtime constraint not covered by local implementation');
 const instance=new SkeletonInstance(ir);if(m.evaluation.skinId!==null)instance.setSkin(m.evaluation.skinId);
 instance.evaluate(m.evaluation.layers);
 let raw,layout=[],texDigests=[];
 if(m.scenario.gate==='G2'){
  const values=[];
  for(const id of m.samples.bones){const mat=instance.world.get(id);ok(mat,'INVALID_SCENARIO','Requested world matrix missing');const offset=values.length;
   values.push(mat.a,mat.b,mat.c,mat.d,mat.x,mat.y);layout.push({type:'world-affine',id,offset,length:6});}
  for(const sampler of m.samples.vertices){const a=instance.assets.get(sampler.attachmentId);ok(a,'INVALID_SCENARIO','Vertex attachment missing');
   let mesh=a;const seen=new Set();while(mesh.kind==='linked_mesh'){
    ok(!seen.has(mesh.id),'INVALID_SCENARIO','Linked mesh cycle');seen.add(mesh.id);mesh=instance.assets.get(mesh.parentMeshId);ok(mesh,'INVALID_SCENARIO','Unresolved mesh parent');
   }
   ok('vertices'in mesh,'INVALID_SCENARIO','Requested attachment has no vertex data');
   ok(instance.world.has(sampler.ownerBoneId),'INVALID_SCENARIO','Unknown mesh owner bone');
   const d=instance.deforms.get(sampler.deformOwnerId??sampler.attachmentId);
   const xy=instance.vertices(mesh.vertices,sampler.ownerBoneId,d);
   ok(values.length+xy.length<=2_000_000,'LIMIT_EXCEEDED','Too many numeric samples');const offset=values.length;
   for(const n of xy)values.push(n);layout.push({type:'vertices-xy',id:sampler.attachmentId,ownerBoneId:sampler.ownerBoneId,deformOwnerId:sampler.deformOwnerId??sampler.attachmentId,offset,length:xy.length});
  }
  for(const c of m.samples.constraints??[]){
   const constraint=ir.skeleton.constraints.find(x=>x.id===c.id),actual=instance.parameters.get(c.id);
   ok(constraint&&actual,'INVALID_SCENARIO','Selected constraint unavailable');
   const offset=values.length;values.push(constraint.order);
   for(const name of c.parameters){const v=actual[name];ok(typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean','UNSUPPORTED_SEMANTIC_FEATURE','Only numeric/boolean constraint parameters can be captured');
    values.push(typeof v==='boolean'?(v?1:0):v);
   }
   layout.push({type:'constraint-parameters',id:c.id,parameterNames:['order',...c.parameters],offset,length:values.length-offset});
  }
  ok(values.length>0&&values.every(finite),'INVALID_CANDIDATE_OUTPUT','Nonfinite or empty candidate numeric samples');
  raw=Buffer.from(JSON.stringify(values),'utf8');
 }else{
  const render=m.scenario.conditions.rendering,viewport=m.scenario.conditions.viewport;const built=prepareDrawPackets(instance);
  const pages=new Map();ok(m.assets.textures.length===ir.atlases.pages.length,'MISSING_TEXTURE_PAGE','Candidate must declare every atlas page');
  // Preflight EVERY page before allocating any decoded textures. Total budget includes all pages.
  const entries=ir.atlases.pages.map(p=>{
   const t=m.assets.textures.find(x=>x.pageId===p.id);ok(t,'MISSING_TEXTURE_PAGE','Undeclared texture page');
   const path=privatePath(base,t.path),header=preflightPNG(path);
   ok(header.width===p.width&&header.height===p.height,'INVALID_ATLAS','Atlas page dimensions mismatch PNG');
   ok(p.pma===(render.alphaMode==='pma'),'INVALID_SCENARIO','Mixed source alpha mode or scenario mismatch');
   ok([undefined,'repeat','clamp'].includes(p.wrapU)&&[undefined,'repeat','clamp'].includes(p.wrapV),'UNSUPPORTED_SEMANTIC_FEATURE','Unsupported CPU texture wrap variant');
   return {p,path,header};
  });
  checkAggregateTextures(entries.map(e=>e.header));
  for(const {p,path,header} of entries){
   const decoded=await loadPNGBounded(path,header);
   const t=m.assets.textures.find(x=>x.pageId===p.id);
   ok((m.scenario.fixtureOrigin==='DERIVED_ONLY'||t.sha256!==undefined)&&(!t.sha256||t.sha256===decoded.sha256),'SOURCE_DIGEST_MISMATCH','Declared texture hash mismatch or missing');
   texDigests.push({pageId:p.id,sha256:decoded.sha256});
   pages.set(p.id,{width:decoded.width,height:decoded.height,rgba:decoded.rgba,premultiplied:p.pma,wrapU:p.wrapU??'clamp',wrapV:p.wrapV??'clamp'});
  }
  const pixels=rasterize(built,pages,viewport,render.width,render.height,render.clearRGBA.map(x=>x/255),{sampling:render.sampling});
  raw=Buffer.from(pixels);layout=[{type:'rgba8-top-left-straight',offset:0,length:raw.length}];
 }
 const layoutSha256=digest(canonical(layout));
 if(m.scenario.sampleLayoutSha256)ok(layoutSha256===m.scenario.sampleLayoutSha256,'SAMPLE_LAYOUT_MISMATCH','Sample layout schema, order or type changed');
 const projectRoot=new URL('../',import.meta.url);
 const buildFiles=[];
 for(const pkg of ['core','runtime','renderer-webgl2','renderer-cpu','cli']){
  const collect=(subdir,rel='')=>{
   for(const item of readdirSync(subdir,{withFileTypes:true})){
    const name=rel?rel+'/'+item.name:item.name;
    if(item.isDirectory())collect(new URL(item.name+'/',subdir),name);
    else if(item.isFile()&&name.endsWith('.js'))buildFiles.push([pkg+'/'+name,hash(boundedFile(new URL(item.name,subdir),LIMIT_JSON))]);
   }
  };
  collect(new URL('packages/'+pkg+'/dist/',projectRoot));
 }
 buildFiles.push(['g7-candidate.mjs',hash(boundedFile(new URL('scripts/g7-candidate.mjs',projectRoot),LIMIT_JSON))]);
 for(const f of ['g6-conformance.mjs','g8-png.mjs','g8-source.mjs'])buildFiles.push([f,hash(boundedFile(new URL('scripts/'+f,projectRoot),LIMIT_JSON))]);
 const buildSha256=digest(canonical(buildFiles.sort(([a],[b])=>a.localeCompare(b))));
 const summary={format:'universal-skeleton-candidate-summary-v1',scenarioId:m.scenario.id,gate:m.scenario.gate,feature:m.scenario.feature,
  candidateGenerated:true,referenceVerified:false,referenceStatus:'UNVERIFIED_NO_REFERENCE',
  targetCompatibilityVersion:identity.targetCompatibilityVersion,observedSourceVersion:identity.observedSourceVersion,
  originalSourceSha256:identity.originalSourceSha256,irArtifactSha256:identity.irArtifactSha256,sourceIdentityStatus:identity.sourceIdentityStatus,
  fixtureOrigin:m.scenario.fixtureOrigin,candidateBuildSha256:buildSha256,scenarioSha256:digest(canonical(m)),
  sourceArtifactSha256:hash(bytes),sampleLayoutSha256:layoutSha256,contentSha256:digest(canonical(texDigests)),conditionsSha256:digest(canonical(m.scenario.conditions)),
  candidateArtifactSha256:hash(raw),sampleCount:m.scenario.gate==='G2'?JSON.parse(raw.toString('utf8')).length:raw.length,
  ...(m.scenario.gate==='G3'?{pixelCount:m.scenario.conditions.rendering.width*m.scenario.conditions.rendering.height}:{}),
  capabilityStatus:cap.fullyEvaluable?'LOCALLY_EVALUABLE':'UNSUPPORTED_SEMANTIC_FEATURE',
  outputType:m.scenario.gate==='G2'?'json-scalar-vector':'raw-rgba8',sanitized:true};
 return {raw,layout,summary};
}
function secureWrite(path,bytes){ok(!existsSync(path),'OUTPUT_ALREADY_EXISTS','Refusing to overwrite verification evidence');writeFileSync(path,bytes,{flag:'wx',mode:0o600});}
export async function runCandidate({manifestPath,privateDir,summaryPath,dryRun=false}){
 const manifest=parseJson(boundedFile(manifestPath,512*1024));const {raw,layout,summary}=await captureCandidate(manifest,{baseDir:dirname(resolve(manifestPath))});
 if(dryRun)return {...summary,generatedFiles:false};
 const privateRoot=resolve(privateDir),summaryAbs=resolve(summaryPath);const inside=relative(privateRoot,summaryAbs);
 ok(inside==='..'||inside.startsWith('../')||isAbsolute(inside),'INVALID_ARGUMENT','Sanitized output must be outside private capture directory');
 ok(resolve(dirname(summaryAbs))!==privateRoot,'INVALID_ARGUMENT','Private and public report destinations must differ');
 ok(!existsSync(privateRoot),'OUTPUT_ALREADY_EXISTS','Private capture directory must not exist');
 mkdirSync(privateRoot,{recursive:false,mode:0o700});
 try{
  const extension=manifest.scenario.gate==='G2'?'json':'rgba';
  secureWrite(join(privateRoot,'candidate.'+extension),raw);
  secureWrite(join(privateRoot,'sample-layout.json'),Buffer.from(JSON.stringify({format:'riglyph-local-layout-v1',sha256:summary.sampleLayoutSha256,layout})+'\n','utf8'));
  secureWrite(join(privateRoot,'scenario.local.json'),Buffer.from(JSON.stringify(manifest.scenario,null,2)+'\n','utf8'));
  secureWrite(summaryPath,JSON.stringify(summary,null,2)+'\n');
 }catch(e){rmSync(privateRoot,{recursive:true,force:true});throw e;}
 return summary;
}
const entry=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(entry){try{
 const [command,manifest,privateDir,summaryPath]=process.argv.slice(2);
 if(command!=='run'&&command!=='dry-run'||!manifest||!privateDir||!summaryPath)throw new ConformanceError('INVALID_ARGUMENT','Usage: g7-candidate.mjs run|dry-run <manifest.json> <private-output-directory> <sanitized-summary.json>');
 const report=await runCandidate({manifestPath:manifest,privateDir,summaryPath,dryRun:command==='dry-run'});
 process.stdout.write(JSON.stringify({status:'CANDIDATE_GENERATED_ONLY',scenarioId:report.scenarioId,candidateArtifactSha256:report.candidateArtifactSha256,referenceVerified:false})+'\n');
 }catch(e){const code=e instanceof ConformanceError?e.code:typeof e?.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'INVALID_CANDIDATE_INPUT';
  process.stderr.write(JSON.stringify({code,status:'CANDIDATE_FAILED',referenceVerified:false})+'\n');process.exitCode=1;}}
