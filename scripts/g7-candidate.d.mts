export function validateCandidateManifest(manifest:any):Promise<any>;
export function captureCandidate(manifest:any,options?:{baseDir?:string}):Promise<{raw:Buffer;layout:unknown[];summary:any}>;
export function runCandidate(options:{manifestPath:string;privateDir:string;summaryPath:string;dryRun?:boolean}):Promise<any>;
