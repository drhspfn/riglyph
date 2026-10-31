import {EngineError, requireCondition} from '@riglyph/core';

export class BinaryReader {
 private cursor=0;
 private readonly view:DataView;
 constructor(readonly input:Uint8Array,readonly source='memory',readonly maxStringBytes=1_048_576){
  this.view=new DataView(input.buffer,input.byteOffset,input.byteLength);
  requireCondition(input.length<=64*1024*1024,'LIMIT_EXCEEDED','Binary exceeds 64 MiB',this.at());
 }
 get offset():number{return this.cursor;}
 get length():number{return this.input.length;}
 at():{source:string;offset:number}{return {source:this.source,offset:this.cursor};}
 private need(bytes:number):void{requireCondition(bytes>=0&&bytes<=this.length-this.cursor,'TRUNCATED_INPUT',`Need ${bytes} bytes at ${this.cursor}`,this.at());}
 byte():number{this.need(1);return this.input[this.cursor++]!;}
 bool():boolean{const v=this.byte();requireCondition(v<=1,'INVALID_HEADER',`Boolean out of range (${v})`,this.at());return v===1;}
 u16():number{this.need(2);const v=this.view.getUint16(this.cursor);this.cursor+=2;return v;}
 i16():number{this.need(2);const v=this.view.getInt16(this.cursor);this.cursor+=2;return v;}
 s8():number{const v=this.byte();return v>127?v-256:v;}
 u32():number{this.need(4);const v=this.view.getUint32(this.cursor);this.cursor+=4;return v;}
 i32():number{this.need(4);const v=this.view.getInt32(this.cursor);this.cursor+=4;return v;}
 f32():number{this.need(4);const v=this.view.getFloat32(this.cursor);this.cursor+=4;requireCondition(Number.isFinite(v),'INVALID_FLOAT','Nonfinite float',this.at());return v;}
 bytes(count:number):Uint8Array{this.need(count);const b=this.input.subarray(this.cursor,this.cursor+count);this.cursor+=count;return b;}
 uvarint():number{
  let result=0;for(let i=0;i<5;i++){
   const b=this.byte();if(i===4&&b>15)throw new EngineError('INVALID_VARINT','Varint overflow',this.at());
   result+=(b&127)*2**(7*i);
   if(!(b&128))return result;
  }
  throw new EngineError('INVALID_VARINT','Varint exceeds five bytes',this.at());
 }
 svarint():number{const raw=this.uvarint();return raw%2===0?raw/2:-(raw+1)/2;}
 utf8():string|null{
  const stored=this.uvarint();if(stored===0)return null;if(stored===1)return '';
  const n=stored-1;requireCondition(n<=this.maxStringBytes,'LIMIT_EXCEEDED','String too large',this.at());
  const bytes=this.bytes(n);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new EngineError('INVALID_UTF8','Invalid UTF-8',this.at());}
 }
 requiredString():string{const s=this.utf8();requireCondition(s!==null,'INVALID_HEADER','Unexpected null string',this.at());return s;}
 stringRef(table:readonly string[]):string|null{
  const idx=this.uvarint();if(idx===0)return null;
  requireCondition(idx-1<table.length,'INVALID_REFERENCE',`String table reference ${idx} out of range`,this.at());return table[idx-1]!;
 }
}
