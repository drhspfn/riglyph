/** Portable npm launcher. Prefer the npm JS CLI when npm provides its path;
 * Windows .cmd shims need a shell on current Node releases. */
import {spawnSync} from 'node:child_process';
import {accessSync,constants} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

function readable(path){try{accessSync(path,constants.R_OK);return true;}catch{return false;}}
export function npmCommand({platform=process.platform,env=process.env,node=process.execPath}={}){
 const configured=env.npm_execpath;
 if(configured&&/\.(?:m?js|cjs)$/i.test(configured)&&readable(configured))return {command:node,prefix:[configured],shell:false};
 const folder=dirname(node);
 const candidates=[join(folder,'node_modules/npm/bin/npm-cli.js'),join(folder,'../lib/node_modules/npm/bin/npm-cli.js')];
 const script=candidates.find(readable);
 if(script)return {command:node,prefix:[resolve(script)],shell:false};
 return platform==='win32'?{command:'npm.cmd',prefix:[],shell:true}:{command:'npm',prefix:[],shell:false};
}
/** Reject spawn failures, signal termination and nonzero status independently. */
export function runNpm(args,options={}){
 const {spawn=spawnSync,platform=process.platform,env=process.env,node=process.execPath,...spawnOptions}=options;
 const launcher=npmCommand({platform,env,node});
 const invocation=[...launcher.prefix,...args];
 let result;
 try{result=spawn(launcher.command,invocation,{encoding:'utf8',windowsHide:true,env,...spawnOptions,shell:launcher.shell});}
 catch(error){throw new Error(`npm ${args.join(' ')}: unable to start: ${error instanceof Error?error.message:String(error)}`,{cause:error});}
 if(result.error)throw new Error(`npm ${args.join(' ')}: unable to start: ${result.error.message}`,{cause:result.error});
 if(result.status!==0){
  const reason=result.signal?`terminated by signal ${result.signal}`:`exit status ${String(result.status)}`;
  throw new Error(`npm ${args.join(' ')}: ${reason}\n${String(result.stderr??'').trim()}\n${String(result.stdout??'').trim()}`.trim());
 }
 return result;
}
