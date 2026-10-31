export class ConformanceError extends Error { readonly code:string; constructor(code:string,message:string); }
export const FEATURE_GROUPS:Record<'G2'|'G3',readonly string[]>;
export function canonical(value:unknown):string;
export function digest(input:Buffer|string):string;
export function validateScenario(scenario:any):any;
export function compareInputs(scenario:any,reference:Buffer,candidate:Buffer,opts?:{referenceLayout?:unknown;candidateLayout?:unknown}):any;
export function capture(scenario:any,reference:Buffer|null,candidate:Buffer|null,opts?:{unsupportedCode?:string;referenceLayout?:unknown;candidateLayout?:unknown}):any;
export function captureHash(capture:any):string;
export function attest(capture:any,review:any,keyId:string,privatePem:string):any;
export function verifyAttestation(obj:any,trust:unknown):boolean;
export function assessBundle(bundle:any,trust?:unknown):any;
