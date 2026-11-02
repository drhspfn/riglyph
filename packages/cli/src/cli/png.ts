import {deflateSync,inflateSync} from 'node:zlib';
import {EngineError,requireCondition} from '@riglyph/core';
const SIGN=Uint8Array.from([137,80,78,71,13,10,26,10]);
function crc32(data:Uint8Array):number{
 let crc=0xffffffff;for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return (crc^0xffffffff)>>>0;
}
function chunk(type:string,data:Uint8Array):Buffer{
 const c=Buffer.alloc(12+data.length);c.writeUInt32BE(data.length,0);c.write(type,4,'ascii');Buffer.from(data).copy(c,8);
 c.writeUInt32BE(crc32(c.subarray(4,8+data.length)),8+data.length);return c;
}
export function encodePNG(width:number,height:number,rgba:Uint8Array,compression=6):Buffer{
 requireCondition(Number.isInteger(compression)&&compression>=0&&compression<=9,'INVALID_HEADER','Invalid PNG compression');
 requireCondition(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width*height<=16_777_216,'LIMIT_EXCEEDED','Invalid PNG dimensions');
 requireCondition(rgba.length===width*height*4,'INVALID_ATLAS','RGBA data length mismatch');
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 const rows=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++)Buffer.from(rgba.subarray(y*width*4,(y+1)*width*4)).copy(rows,y*(1+width*4)+1);
 return Buffer.concat([Buffer.from(SIGN),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows,{level:compression})),chunk('IEND',new Uint8Array(0))]);
}
/** PNG decoder for 8-bit RGBA, no interlace, PNG filters 0..4. Unsupported variants fail. */
export function decodePNG(input:Uint8Array):{width:number;height:number;rgba:Uint8Array}{
 requireCondition(input.length>=33&&SIGN.every((v,i)=>input[i]===v),'INVALID_ATLAS','Bad PNG signature');
 const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
 let ptr=8,width=0,height=0,hasIHDR=false,hasIEND=false;const idats:Buffer[]=[];
 while(ptr+12<=bytes.length){
  const n=bytes.readUInt32BE(ptr);requireCondition(n<=64*1024*1024&&ptr+12+n<=bytes.length,'LIMIT_EXCEEDED','Invalid PNG chunk length');
  const type=bytes.toString('ascii',ptr+4,ptr+8),data=bytes.subarray(ptr+8,ptr+8+n),crc=bytes.readUInt32BE(ptr+8+n);
  requireCondition(crc32(bytes.subarray(ptr+4,ptr+8+n))===crc,'INVALID_ATLAS',`PNG CRC failed in ${type}`);
  ptr+=12+n;
  if(type==='IHDR'){
   requireCondition(!hasIHDR&&n===13,'INVALID_ATLAS','Duplicate or malformed IHDR');hasIHDR=true;
   width=data.readUInt32BE(0);height=data.readUInt32BE(4);
   requireCondition(width>0&&height>0&&width*height<=16_777_216,'LIMIT_EXCEEDED','PNG dimensions exceed limits');
   requireCondition(data[8]===8&&data[9]===6&&data[10]===0&&data[11]===0&&data[12]===0,'UNSUPPORTED_SEMANTIC_FEATURE','Only noninterlaced 8-bit RGBA PNG is supported');
  }else if(type==='IDAT')idats.push(data);
  else if(type==='IEND'){hasIEND=true;break;}
 }
 requireCondition(hasIHDR&&hasIEND&&idats.length>0,'INVALID_ATLAS','Incomplete PNG');
 const stride=width*4,expected=height*(stride+1);
 const decompressed=inflateSync(Buffer.concat(idats),{maxOutputLength:expected+1});
 requireCondition(decompressed.length===expected,'INVALID_ATLAS','Wrong PNG decompressed size');
 const rgba=new Uint8Array(width*height*4);
 const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
 for(let y=0;y<height;y++){
  const inputRow=y*(stride+1),outRow=y*stride,filter=decompressed[inputRow]!;
  requireCondition(filter<=4,'INVALID_ATLAS',`Unknown PNG filter ${filter}`);
  for(let x=0;x<stride;x++){
   const left=x>=4?rgba[outRow+x-4]!:0,up=y>0?rgba[outRow-stride+x]!:0,upperLeft=x>=4&&y>0?rgba[outRow-stride+x-4]!:0;
   const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);
   rgba[outRow+x]=(decompressed[inputRow+1+x]!+predictor)&255;
  }
 }
 return {width,height,rgba};
}
