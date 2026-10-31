import {lstat,rename,rm} from 'node:fs/promises';
import type {Stats} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EngineError} from '@riglyph/core';

type Ops={lstat:(path:string)=>Promise<Stats>;rename:(from:string,to:string)=>Promise<void>;rm:(path:string,options:{recursive:boolean;force:boolean})=>Promise<void>};
const nativeOps:Ops={lstat,rename,rm};
function message(error:unknown){return error instanceof Error?error.message:String(error);}
async function existing(path:string,ops:Ops){
 try{return await ops.lstat(path);}catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;
  throw error;
 }
}
/** Commit a fully prepared directory. All renames take place in one parent
 * directory, so Windows does not have to rename onto an existing destination.
 * On commit failure the previous directory is restored; a failed restoration
 * deliberately leaves the backup intact for manual recovery. */
export async function commitConvertedDirectory(stage:string,destination:string,overwrite:boolean,ops:Ops=nativeOps):Promise<void>{
 const prior=await existing(destination,ops);
 if(prior&&(!overwrite||!prior.isDirectory()||prior.isSymbolicLink())){
  throw new EngineError('OUTPUT_EXISTS',`Output already exists: ${destination}. Use --overwrite to replace an existing directory.`,{path:destination});
 }
 if(!prior){
  try{await ops.rename(stage,destination);return;}
  catch(error){
   if(await existing(destination,ops))throw new EngineError('OUTPUT_EXISTS',`Output appeared during conversion: ${destination}`,{path:destination});
   throw new EngineError('OUTPUT_COMMIT_FAILED',`Could not commit converted directory: ${message(error)}`,{path:destination});
  }
 }
 const backup=join(dirname(destination),`.riglyph-backup-${basename(destination)}-${randomUUID()}`);
 try{await ops.rename(destination,backup);}
 catch(error){throw new EngineError('OUTPUT_COMMIT_FAILED',`Could not back up existing output: ${message(error)}`,{path:destination});}
 try{await ops.rename(stage,destination);}
 catch(error){
  try{await ops.rename(backup,destination);}
  catch(restoreError){
   throw new EngineError('OUTPUT_ROLLBACK_FAILED',`Commit failed (${message(error)}); automatic restore failed (${message(restoreError)}). Previous output retained at ${backup}`,{
    path:backup,remediation:`Restore the backup to ${destination} manually. Do not delete ${backup}.`
   });
  }
  throw new EngineError('OUTPUT_COMMIT_FAILED',`Could not commit replacement; previous output restored: ${message(error)}`,{path:destination});
 }
 try{await ops.rm(backup,{recursive:true,force:false});}
 catch(error){
  // Replacement is complete and valid. Do not roll it back if only backup
  // cleanup fails: preserve the old copy and explicitly report its location.
  process.stderr.write(`WARNING: converted output committed; old backup at ${backup} could not be removed: ${message(error)}\n`);
 }
}
