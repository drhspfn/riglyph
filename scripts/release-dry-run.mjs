import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const cmd=(command,args)=>{const r=spawnSync(command,args,{encoding:'utf8',stdio:'inherit'});if(r.status!==0)throw Error(`${command} ${args.join(' ')} failed: ${r.status}`);};
cmd('node',['scripts/release-verify.mjs']);
const dir=resolve('release-artifacts');mkdirSync(dir,{recursive:true});
const root=JSON.parse(readFileSync('package.json','utf8'));
const names=['core','importer-sdk','runtime','renderer-webgl2','renderer-cpu','renderer-native','importer-spine-4.1','player-web','cli'];
const versions=names.map(n=>{const j=JSON.parse(readFileSync(`packages/${n}/package.json`));return {name:j.name,version:j.version,dependencies:j.dependencies??{},license:j.license,repository:j.repository?.url};});
const sbom={bomFormat:'CycloneDX',specVersion:'1.5',version:1,metadata:{component:{type:'application',name:'riglyph',version:root.version}},components:versions.map(p=>({type:'library',name:p.name,version:p.version,licenses:[{license:{id:'MIT'}}]}))};
const compatibility={version:root.version,IRSchema:'1.0.0',supportedSourceVersions:['spine-binary:4.1.23'],G1_currentVersion:'NOT_RECHECKED',G2:'UNVERIFIED_NO_REFERENCE',G3_official:'UNVERIFIED_NO_REFERENCE',publishPermission:'NOT_GRANTED'};
writeFileSync(join(dir,'SBOM.cdx.json'),JSON.stringify(sbom,null,2)+'\n');
writeFileSync(join(dir,'compatibility.json'),JSON.stringify(compatibility,null,2)+'\n');
writeFileSync(join(dir,'RELEASE-NOTES.md'),`# Riglyph ${root.version} — preview candidate (UNPUBLISHED)\n\nNine scoped packages, exact Spine Binary 4.1.23 importer and portable Web Player; automatic version dispatch. G9/G10 mixing retained. G1 on this release must be independently rerun; official G2/G3 remain UNVERIFIED_NO_REFERENCE. Legal, owner, npm scope and CI gates BLOCK publication.\n`);
const pack=JSON.parse(readFileSync('release-packages/manifest.json','utf8'));
const lines=[];
for(const f of readdirSync('release-packages').filter(s=>s.endsWith('.tgz')).sort()){
 const bytes=readFileSync(join('release-packages',f));lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${f}`);
}
writeFileSync(join(dir,'SHA256SUMS'),lines.join('\n')+'\n');
writeFileSync(join(dir,'publish-plan.json'),JSON.stringify({version:root.version,mode:'DRY_RUN_ONLY',publishOrder:names.map(n=>`@riglyph/${n}`),requires:['npm-owner-scope','verified-CI','signed-legal-review','G1-new-build','interactive-owner-approval','OIDC-configured-exact-workflow'],tarballs:pack.packages},null,2)+'\n');
// A source archive is ONLY made from an explicitly curated clean public repo marker.
if(existsSync('PUBLIC_SOURCE_REVIEWED.json')){
 const zip=join(dir,`riglyph-v${root.version}-source.zip`),tar=join(dir,`riglyph-v${root.version}-source.tar`);
 for(const [format,path] of [['zip',zip],['tar',tar]]){
  const r=spawnSync('git',['archive',`--format=${format}`,`--prefix=riglyph-v${root.version}/`,'HEAD','-o',path],{stdio:'inherit'});
  if(r.status!==0)throw Error('Cannot archive clean public Git commit; STOP');
 }
 writeFileSync(tar+'.gz',gzipSync(readFileSync(tar),{level:9}));
 const names=[`riglyph-v${root.version}-source.zip`,`riglyph-v${root.version}-source.tar.gz`];
 for(const name of names){const b=readFileSync(join(dir,name));lines.push(`${createHash('sha256').update(b).digest('hex')}  ${name}`);}
 writeFileSync(join(dir,'SHA256SUMS'),lines.join('\n')+'\n');
}
console.log(JSON.stringify({status:'ARTIFACTS_PREPARED_NOT_PUBLISHED',output:dir,packageCount:lines.length},null,2));
