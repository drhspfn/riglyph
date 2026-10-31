export type ErrorCode =
 'INVALID_HEADER'|'UNRECOGNIZED_FORMAT'|'AMBIGUOUS_IMPORTER'|'IMPORTER_PROBE_FAILED'|'UNSUPPORTED_IR_SCHEMA'|'UNSUPPORTED_VERSION'|'TRUNCATED_INPUT'|'INVALID_VARINT'|'INVALID_UTF8'|'INVALID_FLOAT'|'LIMIT_EXCEEDED'|
 'INVALID_REFERENCE'|'INVALID_PARENT_GRAPH'|'INVALID_SKIN'|'INVALID_ATTACHMENT'|'INVALID_TIMELINE'|'INVALID_TOPOLOGY'|'INVALID_ATLAS'|'MISSING_TEXTURE_PAGE'|
 'OUTPUT_EXISTS'|'OUTPUT_COMMIT_FAILED'|'OUTPUT_ROLLBACK_FAILED'|
 'UNSUPPORTED_ATTACHMENT_TYPE'|'UNSUPPORTED_CONSTRAINT_TYPE'|'UNSUPPORTED_TIMELINE_TYPE'|'UNSUPPORTED_SEMANTIC_FEATURE'|'ANIMATION_NOT_FOUND'|'INVALID_IR';
export interface Diagnostic {code:ErrorCode;severity:'error'|'warning';message:string;source?:string;offset?:number;path?:string;owner?:string;remediation?:string}
export class EngineError extends Error {
 constructor(public readonly code:ErrorCode,message:string,public readonly details:Omit<Diagnostic,'code'|'severity'|'message'>={}) { super(message);this.name='EngineError'; }
 toDiagnostic():Diagnostic {return {code:this.code,severity:'error',message:this.message,...this.details};}
}
export function requireCondition(condition:unknown,code:ErrorCode,message:string,details:EngineError['details']={}):asserts condition{
 if(!condition)throw new EngineError(code,message,details);
}
