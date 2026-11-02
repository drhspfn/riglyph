/** Riglyph optional native Rust rasterizer — persistent RGP1 process backend.
 * Draw geometry and animation remain authoritative in TypeScript.
 */
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {EngineError,requireCondition} from '@riglyph/core';
import type {Viewport,DrawPacket} from '@riglyph/renderer-webgl2';
import type {RawTexture,TextureSampling} from '@riglyph/renderer-cpu';

export type NativeRenderInput={
 packets:readonly DrawPacket[];textures:ReadonlyMap<string,RawTexture>;viewport:Viewport;
 width:number;height:number;clear:[number,number,number,number];sampling?:TextureSampling;signal?:AbortSignal;
};
export type NativeRendererOptions={binaryPath?:string;threads?:number;maxFrameBytes?:number;};
const MAGIC=Buffer.from([82,71,80,49,1,0]);
const encode=(command:number,body:Buffer)=>{
 const out=Buffer.allocUnsafe(8+body.length);MAGIC.copy(out,0);out[6]=command;out[7]=0;body.copy(out,8);return out;
};
const err=(message:string)=>new EngineError('UNSUPPORTED_SEMANTIC_FEATURE',message);
export function nativeBinaryPath(explicit?:string):string{
 if(explicit)return resolve(explicit);
 if(process.env['RIGLYPH_NATIVE_BIN'])return resolve(process.env['RIGLYPH_NATIVE_BIN']);
 const target=process.platform==='win32'?'windows-x64':process.platform==='darwin'?'macos-arm64':'linux-x64';
 const exe=process.platform==='win32'?'riglyph-native.exe':'riglyph-native';
 const candidates=[
  join(process.cwd(),'native','dist',target,exe),
  join(process.cwd(),'native','target','release',exe),
  join(process.cwd(),'native','target','debug',exe),
 ];
 const hit=candidates.find(p=>existsSync(p));
 if(hit)return hit;
 throw err(`Riglyph native binary unavailable for ${process.platform}/${process.arch}. Set RIGLYPH_NATIVE_BIN or pass binaryPath; use --backend js to avoid native dependency.`);
}
function textureMessage(id:number,t:RawTexture):Buffer{
 requireCondition(t.width>0&&t.height>0&&t.rgba.length===t.width*t.height*4,'INVALID_ATLAS','Native texture mismatch');
 const b=Buffer.allocUnsafe(4+4+4+4+4+t.rgba.length);let i=0;
 b.writeUInt32LE(id,i);i+=4;b.writeUInt32LE(t.width,i);i+=4;b.writeUInt32LE(t.height,i);i+=4;
 b[i++]=t.premultiplied?1:0;b[i++]=t.wrapU==='repeat'?1:0;b[i++]=t.wrapV==='repeat'?1:0;b[i++]=0;
 b.writeUInt32LE(t.rgba.length,i);i+=4;Buffer.from(t.rgba.buffer,t.rgba.byteOffset,t.rgba.byteLength).copy(b,i);
 return encode(1,b);
}
function frameMessage(input:NativeRenderInput,ids:Map<string,number>):Buffer{
 const {width,height,viewport:vp,packets,clear}=input;
 requireCondition(width>0&&height>0&&Number.isSafeInteger(width)&&Number.isSafeInteger(height),'INVALID_HEADER','Invalid native frame size');
 let size=4+4+32+32+4+4;for(const p of packets){
  requireCondition(p.positions.length===p.uvs.length&&p.positions.length%6===0,'INVALID_TOPOLOGY','Invalid native triangle packet');
  size+=4+4+56+4+p.positions.length/2*16;
 }
 requireCondition(size<=256*1024*1024,'LIMIT_EXCEEDED','Native protocol frame size exceeded');
 const b=Buffer.allocUnsafe(size);let k=0;
 b.writeUInt32LE(width,k);k+=4;b.writeUInt32LE(height,k);k+=4;
 for(const v of [vp.left,vp.bottom,vp.width,vp.height,...clear]){b.writeDoubleLE(v,k);k+=8;}
 b[k++]=input.sampling==='linear'?1:0;b.fill(0,k,k+3);k+=3;
 b.writeUInt32LE(packets.length,k);k+=4;
 for(const p of packets){
  const id=ids.get(p.pageId);requireCondition(id!==undefined,'MISSING_TEXTURE_PAGE',`Missing page ${p.pageId}`);
  b.writeUInt32LE(id,k);k+=4;
  b[k++]=p.blend==='normal'?0:p.blend==='additive'?1:p.blend==='multiply'?2:3;
  b[k++]=p.pma?1:0;b.writeUInt16LE(0,k);k+=2;
  for(const color of [...p.light,...(p.dark??[0,0,0])]){b.writeDoubleLE(color,k);k+=8;}
  const vertices=p.positions.length/2;b.writeUInt32LE(vertices,k);k+=4;
  for(let i=0;i<p.positions.length;i+=2){
   b.writeFloatLE(p.positions[i]!,k);k+=4;b.writeFloatLE(p.positions[i+1]!,k);k+=4;
   b.writeFloatLE(p.uvs[i]!,k);k+=4;b.writeFloatLE(p.uvs[i+1]!,k);k+=4;
  }
 }
 requireCondition(k===size,'INVALID_TOPOLOGY','Native protocol frame size bug');
 return encode(2,b);
}
type Pending={resolve:(data:Uint8Array)=>void;reject:(error:Error)=>void};
export class NativeRenderer {
 private readonly process:ReturnType<typeof spawn>;
 private readonly queue:Pending[]=[];
 private response=Buffer.alloc(0);private closed=false;
 private nextId=1;private readonly loaded=new Map<string,{id:number;texture:RawTexture}>();
 private serial:Promise<unknown>=Promise.resolve();
 private constructor(options:NativeRendererOptions={}){
  const threads=options.threads??1;
  requireCondition(Number.isSafeInteger(threads)&&threads>=1&&threads<=16,'INVALID_HEADER','Native threads must be 1..16');
  this.process=spawn(nativeBinaryPath(options.binaryPath),['--threads',String(threads)],
   {stdio:['pipe','pipe','pipe'],windowsHide:true});
  this.process.stdout!.on('data',(chunk:Buffer)=>this.handleData(chunk));
  this.process.on('error',(e)=>this.fail(err(`Native process error: ${e.message}`)));
  this.process.on('exit',(code)=>this.fail(err(`Native process exited: ${code}`)));
  this.process.stdin!.on('error',(e)=>this.fail(err(`Native stdin error: ${e.message}`)));
  this.process.stderr!.on('data',(chunk:Buffer)=>{this.stderr=(this.stderr+chunk.toString()).slice(-8192);});
 }
 private stderr='';
 static async create(options:NativeRendererOptions={}):Promise<NativeRenderer>{
  const r=new NativeRenderer(options);
  try{const pong=await r.request(encode(4,Buffer.alloc(0)));
   requireCondition(Buffer.from(pong).toString()==='riglyph-native/1','UNSUPPORTED_VERSION','Native protocol handshake failed');
   return r;
  }catch(e){await r.dispose();throw e;}
 }
 private fail(e:Error){
  if(this.closed)return;
  this.closed=true;
  for(const pending of this.queue.splice(0))pending.reject(e);
 }
 private handleData(bytes:Buffer){
  this.response=Buffer.concat([this.response,bytes]);
  while(this.response.length>=4){
   const n=this.response.readUInt32LE(0);
   if(n<1||n>256*1024*1024){this.fail(err('Invalid native response length'));this.process.kill();return;}
   if(this.response.length<n+4)break;
   const payload=this.response.subarray(4,n+4);
   this.response=this.response.subarray(n+4);
   const p=this.queue.shift();
   if(!p){this.fail(err('Native process returned unsolicited response'));return;}
   if(payload[0]===0)p.resolve(Uint8Array.from(payload.subarray(1)));
   else p.reject(err(`Native render failed: ${payload.subarray(1).toString()}`));
  }
 }
 private request(bytes:Buffer):Promise<Uint8Array>{
  const send=()=>new Promise<Uint8Array>((resolve,reject)=>{
   if(this.closed)return reject(err('Native process is already closed'));
   this.queue.push({resolve,reject});
   const framed=Buffer.allocUnsafe(bytes.length+4);framed.writeUInt32LE(bytes.length,0);bytes.copy(framed,4);
   this.process.stdin!.write(framed);
  });
  const result=this.serial.then(send,send);
  this.serial=result.catch(()=>{});
  return result;
 }
 async render(input:NativeRenderInput):Promise<Uint8Array>{
  if(input.signal?.aborted)throw err('Native rendering cancelled');
  for(const [page,texture] of input.textures){
   const found=this.loaded.get(page);
   if(found?.texture===texture)continue;
   const id=found?.id??this.nextId++;
   await this.request(textureMessage(id,texture));
   this.loaded.set(page,{id,texture});
  }
  const ids=new Map([...this.loaded].map(([id,v])=>[id,v.id]));
  const data=await this.request(frameMessage(input,ids));
  requireCondition(data.length===input.width*input.height*4,'INVALID_TOPOLOGY','Native returned unexpected RGBA frame size');
  if(input.signal?.aborted)throw err('Native rendering cancelled');
  return data;
 }
 async dispose():Promise<void>{
  this.closed=true;
  this.process.stdin!.destroy();this.process.kill();
  for(const p of this.queue.splice(0))p.reject(err('Native renderer disposed'));
 }
}
export async function createNativeRenderer(options:NativeRendererOptions={}):Promise<NativeRenderer>{
 return NativeRenderer.create(options);
}
