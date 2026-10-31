/** True framework builds from installed .tgz files. Requires registry access for React/Next/Vite.
 * Never marks missing framework dependencies as a successful verification. */
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const results=[];
const sanitize=s=>(s??'').replace(/\/home\/[^\s]+\/_logs\/[^\s]+/g,'[local npm debug log]');
const run=(args,cwd)=>spawnSync('npm',args,{cwd,encoding:'utf8',timeout:240000});
for(const name of ['react','nextjs']){
 const cwd=`examples/${name}`;
 const install=run(['install',...(process.env['FW_ALLOW_NETWORK']==='1'?[]:['--offline']),'--no-audit','--no-fund','--ignore-scripts'],cwd);
 if(install.status!==0){
  results.push({name,status:'BLOCKED_DEPENDENCIES',stage:'npm install',message:sanitize((install.stderr||install.stdout).slice(-700))});
  continue;
 }
 const check=run(['run','typecheck'],cwd);
 if(check.status!==0){results.push({name,status:'FAIL',stage:'typecheck',message:sanitize((check.stderr||check.stdout).slice(-1000))});continue;}
 const build=run(['run','build'],cwd);
 results.push({name,status:build.status===0?'PASS':'FAIL',stage:'production build',message:build.status===0?sanitize(build.stdout.slice(-650)):sanitize((build.stderr||build.stdout).slice(-1000))});
}
writeFileSync('framework-build-results.json',JSON.stringify({format:'g6-framework-verification-v1',results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
