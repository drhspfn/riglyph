/** Offline disclosure and provenance scan. No publication. */
import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const argv=process.argv.slice(2);const modeIndex=argv.indexOf('--mode');
const mode=modeIndex===-1?'pristine':argv[modeIndex+1];
if(modeIndex!==-1)argv.splice(modeIndex,2);
if(!['pristine','working'].includes(mode))throw Error('Usage: node scripts/audit-public.mjs --mode pristine|working <stage-root> [packages-dir]');
if(!argv.length||argv.length>2)throw Error('Specify the explicit stage-root (a generated public staging directory), not the private checkout.');
const root=resolve(argv[0]);
const packages=resolve(argv[1]??'release-packages');
const forbidden=new Set(['29b8a43c82bc7604a4d567c2d8d3cce8685be3838ea64f9aba405fb64356fd52','0206f24a997f1e5016376e65c5811196c20fb0cac08982368723a65b942a3859','006028d74fa5ba079ca23c3ccbb533141d0356b6e031362af6b374cf9c099335','7e904fd98215c138da7cc5bda70cc2275da626e8ffd3a3a7791f73ea81ef6ed7','b756ff97ac24838bc957cb58ae9a95a3fe4f16040ec199825d1a1fcb403b57fa','1eb7a164987d6cb8d0f3d9e2f43401c952dd43b5c33606f4bd85110e1e641c05']);
const records=[];let maps=0,js=0,tarballs=0,ignoredInstallDirs=0,ignoredBuildDirs=0;
function walk(p){for(const f of readdirSync(p,{withFileTypes:true})){
 const full=join(p,f.name),rel=relative(root,full).replaceAll('\\','/');
 if(f.isDirectory()){
  if(f.name==='.git')throw Error('Forbidden public directory '+rel);
  if(f.name==='node_modules'){if(mode==='working'){ignoredInstallDirs++;continue;}throw Error('Forbidden public directory '+rel+'; audit pristine export before npm ci, or use --mode working for NON-RELEASE diagnostics');}
  if(mode==='working'&&['dist','release-packages'].includes(f.name)&&rel===f.name){ignoredBuildDirs++;continue;}
  walk(full);
 }else if(f.isFile()){
  if((/(^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$))|\.(?:skel|atlas|png|pem|key)$/i.test(rel))&&!['docs/assets/riglyph-logo.png','fixtures/synthetic-example.png','fixtures/atlas-demo.atlas','examples/g10-playback/self-authored.png'].includes(rel)&&!rel.endsWith('/textures/synthetic-example.png'))throw Error('Unexpected binary/credential in public stage: '+rel);
  const buf=readFileSync(full),sha=createHash('sha256').update(buf).digest('hex');
  if(forbidden.has(sha))throw Error('Exact analyst-supplied fixture leaked: '+rel);
  if(rel.endsWith('.map')||rel.endsWith('.js')){
   if(rel.endsWith('.map'))maps++;else js++;
   const content=buf.toString('utf8');
   if(/\/(?:mnt\/data|home\/oai\/|Users\/[^/]+\/|home\/runner\/work\/)|[A-Z]:\\(?:Users|Projects)\\|https?:\/\/[^\s'"`]*\/private-game-assets/i.test(content))throw Error('Absolute/local/asset path leaked in compiled artifact: '+rel);
   if(rel.endsWith('.map')){let obj;try{obj=JSON.parse(content);}catch{throw Error('Invalid sourcemap: '+rel);}
    if((obj.sources??[]).some(s=>typeof s==='string'&&(/[\\](?:Users|Projects)[\\]|(?:^|\/)analyst-a\d|\/(?:mnt\/data|home\/)/.test(s))))throw Error('Private source map path '+rel);
   }
  }
  records.push({path:rel,sha256:sha});
 }else throw Error('Unexpected nonregular public entry '+rel);
}}
walk(root);
if(existsSync(packages))for(const f of readdirSync(packages).filter(n=>n.endsWith('.tgz'))){
 const full=join(packages,f),entries=execFileSync('tar',['-tzf',full],{encoding:'utf8'}).trim().split('\n');
 if(entries.some(p=>!p.startsWith('package/')||/\.(?:png|skel|atlas|pem|key)$|(?:^|\/)\.git|(?:^|\/)\.env/i.test(p)))throw Error('Disallowed packed content '+f);
 for(const item of entries.filter(p=>/\.(?:js|js\.map)$/.test(p))){
  const text=execFileSync('tar',['-xOzf',full,item],{encoding:'utf8',maxBuffer:16*1024*1024});
  if(/\/(?:mnt\/data|home\/oai\/|home\/runner\/work\/)|[A-Z]:\\(?:Users|Projects)\\/.test(text))throw Error('Absolute source path in package '+f+' '+item);
 }
 tarballs++;
}
const manifest=resolve(root,'PUBLIC_EXPORT_FILE_MANIFEST.json');
if(!existsSync(manifest))throw Error('PUBLIC_EXPORT_FILE_MANIFEST.json missing: audit only an explicitly generated staging export');
const expected=JSON.parse(readFileSync(manifest,'utf8'));
if(!Array.isArray(expected.files)||expected.status!=='REVIEW_REQUIRED_NOT_PUBLIC')throw Error('Invalid public manifest format or status');
const actual=new Map(records.map(r=>[r.path,r.sha256]));
const seen=new Set();
for(const item of expected.files){
 if(typeof item.path!=='string'||typeof item.sha256!=='string'||seen.has(item.path))throw Error('Invalid/duplicate manifest entry');
 seen.add(item.path);
 if(actual.get(item.path)!==item.sha256)throw Error('Staging SHA256 mismatch '+item.path);
}
const unexpected=records.filter(r=>r.path!=='PUBLIC_EXPORT_FILE_MANIFEST.json'&&!seen.has(r.path));
if(unexpected.length)throw Error('Undeclared public file in stage: '+unexpected[0].path);
if(seen.size!==records.length-1)throw Error('Staging manifest does not cover all exported files');
console.log(JSON.stringify({result:mode==='pristine'?'PASS_TECHNICAL_ONLY':'WORKTREE_CHECK_ONLY_NOT_RELEASE_APPROVAL',mode,review:'BLOCKED_LEGAL_AND_PROVENANCE',files:records.length,manifestEntries:seen.size,js,maps,tarballs,ignoredInstallDirs,ignoredBuildDirs,noAnalystVectorMatches:true},null,2));
