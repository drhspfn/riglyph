export function validatePlaybackManifest(m:unknown):any;
export function executeSchedule(m:any,options?:{baseDir?:string}):Promise<{summary:any;privateFiles:{name:string;bytes:Buffer}[]}>;
export function runSchedule(options:{manifestPath:string;privateDir:string;summaryPath:string;dryRun?:boolean}):Promise<any>;
