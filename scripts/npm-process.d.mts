import type {SpawnSyncReturns} from 'node:child_process';
export interface NpmLaunchConfig {platform?:string;env?:NodeJS.ProcessEnv;node?:string}
export interface NpmRunOptions extends NpmLaunchConfig {
 spawn?:(command:string,args:string[],options:Record<string,unknown>)=>SpawnSyncReturns<string>;
 cwd?:string;encoding?:string;timeout?:number;
}
export function npmCommand(config?:NpmLaunchConfig):{command:string;prefix:string[];shell:boolean};
export function runNpm(args:string[],options?:NpmRunOptions):SpawnSyncReturns<string>;
