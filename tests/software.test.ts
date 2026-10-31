import test from 'node:test';import assert from 'node:assert/strict';
import {encodePNG,decodePNG} from '../src/cli/png.js';
import {rasterize} from '../src/render/software.js';
import type {DrawPacket} from '../src/render/packets.js';
import {EngineError} from '../src/errors.js';
const area=new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]);
const uv=new Float32Array([.5,.5,.5,.5,.5,.5,.5,.5,.5,.5,.5,.5]);
function packet(pageId:string,blend:DrawPacket['blend']='normal',pma=false):DrawPacket{return {slotId:'slot',attachmentId:'a',pageId,blend,pma,positions:area,uvs:uv,indices:new Uint32Array([0,1,2,3,4,5]),light:[1,1,1,1],dark:null};}
const view={left:-1,bottom:-1,width:2,height:2};
function color(data:Uint8ClampedArray):number[]{return [...data.subarray(0,4)];}
test('PNG RGBA roundtrip is lossless and noninterlaced',()=>{
 const src=Uint8Array.from([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
 const encoded=encodePNG(2,2,src);const decoded=decodePNG(encoded);
 assert.deepEqual(decoded,{width:2,height:2,rgba:src});
 const bad=Buffer.from(encoded);bad[35]=(bad[35]??0)^0x02;assert.throws(()=>decodePNG(bad),EngineError);
});
test('CPU rasterizer computes straight-alpha Porter-Duff with two overlay pages',()=>{
 const textures=new Map([['red',{width:1,height:1,rgba:Uint8Array.from([255,0,0,128]),premultiplied:false}],['blue',{width:1,height:1,rgba:Uint8Array.from([0,0,255,255]),premultiplied:false}]]);
 const result=rasterize([packet('blue'),packet('red')],textures,view,1,1);
 const [r,g,b,a]=[result[0]!,result[1]!,result[2]!,result[3]!];assert.ok(r>=127&&r<=129);assert.equal(g,0);assert.ok(b>=126&&b<=128);assert.equal(a,255);
});
test('premultiplied vs straight alpha produce same observable color',()=>{
 const textures=new Map([['premul',{width:1,height:1,rgba:Uint8Array.from([128,0,0,128]),premultiplied:true}],['straight',{width:1,height:1,rgba:Uint8Array.from([255,0,0,128]),premultiplied:false}]]);
 const a=rasterize([packet('premul','normal',true)],textures,view,1,1);
 const b=rasterize([packet('straight')],textures,view,1,1);
 assert.ok(Math.abs(a[0]!-b[0]!)<=1);assert.equal(a[3],b[3]);
});
test('normal/additive/multiply/screen obey local pixel equations',()=>{
 const textures=new Map([['src',{width:1,height:1,rgba:Uint8Array.from([128,128,0,255]),premultiplied:false}],['dst',{width:1,height:1,rgba:Uint8Array.from([128,128,255,255]),premultiplied:false}]]);
 const sample=(blend:DrawPacket['blend'])=>color(rasterize([packet('dst'),packet('src',blend)],textures,view,1,1));
 const normal=sample('normal'),add=sample('additive'),mul=sample('multiply'),screen=sample('screen');
 assert.deepEqual(normal,[128,128,0,255]);assert.deepEqual(add,[255,255,255,255]);
 assert.deepEqual(mul,[64,64,0,255]);assert.deepEqual(screen,[192,192,255,255]);
});
test('software rasterizer refuses missing pages and impossible texture buffers',()=>{
 assert.throws(()=>rasterize([packet('missing')],new Map(),view,1,1),e=>e instanceof EngineError&&e.code==='MISSING_TEXTURE_PAGE');
 assert.throws(()=>rasterize([packet('bad')],new Map([['bad',{width:1,height:1,rgba:new Uint8Array(1),premultiplied:false}]]),view,1,1),EngineError);
});
