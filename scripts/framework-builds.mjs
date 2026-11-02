/** True framework builds from installed .tgz files. Requires registry access for React/Next/Vite.
 * Never marks missing framework dependencies as a successful verification. */
import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
function syncLocalTarballPaths(cwd){
 const file=resolve(cwd,'package.json');
 const pkg=JSON.parse(readFileSync(file,'utf8'));
 let changed=false;
 for(const [name,path] of Object.entries(pkg.dependencies??{})){
  if(!name.startsWith('@riglyph/'))continue;
  const expected=`file:../../release-packages/riglyph-${name.slice('@riglyph/'.length)}-${version}.tgz`;
  if(path!==expected){pkg.dependencies[name]=expected;changed=true;}
 }
 if(changed)writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
}

const results=[];
const sanitize=s=>(s??'').replace(/\/home\/[^\s]+\/_logs\/[^\s]+/g,'[local npm debug log]');
const run=(args,cwd)=>spawnSync('npm',args,{cwd,encoding:'utf8',timeout:240000});
for(const name of ['react','nextjs','vanilla-web']){
 const cwd=`examples/${name}`;
 syncLocalTarballPaths(cwd);
 const install=run(['install',...(process.env['FW_ALLOW_NETWORK']==='1'?[]:['--offline']),'--no-audit','--no-fund','--ignore-scripts'],cwd);
 if(install.status!==0){
  results.push({name,status:'BLOCKED_DEPENDENCIES',stage:'npm install',message:sanitize((install.stderr||install.stdout).slice(-700))});
  continue;
 }
 if(name==='vanilla-web'){results.push({name,status:'PASS',stage:'npm install'});continue;}
 const check=run(['run','typecheck'],cwd);
 if(check.status!==0){results.push({name,status:'FAIL',stage:'typecheck',message:sanitize((check.stderr||check.stdout).slice(-1000))});continue;}
 const build=run(['run','build'],cwd);
 results.push({name,status:build.status===0?'PASS':'FAIL',stage:'production build',message:build.status===0?sanitize(build.stdout.slice(-650)):sanitize((build.stderr||build.stdout).slice(-1000))});
}
writeFileSync('framework-build-results.json',JSON.stringify({format:'g6-framework-verification-v1',results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
