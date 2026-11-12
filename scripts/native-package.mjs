/** Reproducible A22 native artifact layout, hashes, and release-ready archives.
 * No npm publishing or GitHub Releases are performed by this script.
 */
import {readFile,writeFile,mkdir,copyFile,chmod,stat} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const [platform,exe,lib]=process.argv.slice(2);
if(!['linux-x64','windows-x64','macos-arm64'].includes(platform)||!exe||!lib)
 throw new Error('Usage: native-package.mjs linux-x64|windows-x64|macos-arm64 executable dynamic-library');
const srcFiles=[
 [exe,basename(exe)],[lib,basename(lib)],
 ['native/include/riglyph_native.h','riglyph_native.h'],
 ['LICENSE','LICENSE'],['docs/native-renderer.md','README.md'],
];
const output=resolve('native/dist',platform);
await mkdir(output,{recursive:true});
const hashes=[];
for(const [file,name] of srcFiles){
 const contents=await readFile(file);
 await writeFile(join(output,name),contents);
 if(name===basename(exe)&&platform!=='windows-x64')await chmod(join(output,name),0o755);
 hashes.push(`${createHash('sha256').update(contents).digest('hex')}  ${name}`);
}
const version={nativeVersion:'0.1.0',targetRelease:'v0.16.3',abiVersion:1,protocolVersion:1,
 platform,createdFrom:process.env['GITHUB_SHA']??'local',published:false};
await writeFile(join(output,'version.json'),JSON.stringify(version,null,2)+'\n');
const meta=await readFile(join(output,'version.json'));
hashes.push(`${createHash('sha256').update(meta).digest('hex')}  version.json`);
await writeFile(join(output,'SHA256SUMS'),hashes.join('\n')+'\n');
const stem=`riglyph-native-v0.16.3-${platform}`;
const parent=resolve('native/dist');
let archive;
if(platform==='windows-x64'){
 archive=join(parent,stem+'.zip');
 const p=spawnSync('powershell',['-NoProfile','-NonInteractive','-Command',
  `Compress-Archive -Path 'native/dist/${platform}/*' -DestinationPath 'native/dist/${stem}.zip' -Force`],{stdio:'inherit'});
 if(p.status!==0)throw new Error('Could not create native zip');
}else{
 archive=join(parent,stem+'.tar.gz');
 const p=spawnSync('tar',['-czf',archive,'-C',output,'.'],{stdio:'inherit'});
 if(p.status!==0)throw new Error('Could not create native tarball');
}
const bytes=await readFile(archive);
await writeFile(archive+'.sha256',`${createHash('sha256').update(bytes).digest('hex')}  ${basename(archive)}\n`);
console.log(JSON.stringify({platform,archive,bytes:bytes.length,hash:createHash('sha256').update(bytes).digest('hex')}));
