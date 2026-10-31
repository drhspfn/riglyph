/** G8 bounded, row-streamed PNG RGBA8 decoder for candidate capture only.
 * Independently implemented; does not change the packaged renderer or importer.
 * Preflight validates dimensions before allocating RGBA, inflate is bounded to exact rows.
 */
import {openSync,readSync,closeSync,readFileSync,statSync} from 'node:fs';
import {Readable} from 'node:stream';
import {createInflate} from 'node:zlib';
import {ConformanceError} from './g6-conformance.mjs';
const limit=(value,code,message)=>{if(!value)throw new ConformanceError(code,message);};
const SIGN=Buffer.from([137,80,78,71,13,10,26,10]);
const MIB=1024*1024;
export const G8_TEXTURE_LIMITS=Object.freeze({
 maxWidth:8192,maxHeight:8192,maxPixelsPerPage:16_777_216,
 maxCompressedBytesPerPage:96*MIB,maxDecodedBytesTotal:320*MIB,
 maxPages:8,maxFramePixels:1_048_576,maxPeakWorkingBytes:512*MIB
});
const TABLE=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function crc32(buffer,start,end){let n=0xffffffff;for(let i=start;i<end;i++)n=TABLE[(n^buffer[i])&255]^(n>>>8);return (n^0xffffffff)>>>0;}
const pngHeader=bytes=>{
 limit(bytes.length>=33&&bytes.subarray(0,8).equals(SIGN),'INVALID_ATLAS','Invalid PNG signature/header');
 limit(bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR','INVALID_ATLAS','IHDR must be the first 13-byte PNG chunk');
 limit(crc32(bytes,12,29)===bytes.readUInt32BE(29),'INVALID_ATLAS','IHDR CRC mismatch');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 limit(width>0&&height>0&&width<=G8_TEXTURE_LIMITS.maxWidth&&height<=G8_TEXTURE_LIMITS.maxHeight&&width*height<=G8_TEXTURE_LIMITS.maxPixelsPerPage,'LIMIT_EXCEEDED','PNG pixel dimensions exceed candidate page budget');
 limit(bytes[24]===8&&bytes[25]===6&&bytes[26]===0&&bytes[27]===0&&bytes[28]===0,'UNSUPPORTED_SEMANTIC_FEATURE','Candidate supports only noninterlaced PNG RGBA8');
 return {width,height,decodedBytes:width*height*4,scanlineBytes:height*(width*4+1)};
};
export function preflightPNG(path){
 let stat;try{stat=statSync(path);}catch{throw new ConformanceError('MISSING_TEXTURE_PAGE','PNG input not accessible');}
 limit(stat.isFile()&&stat.size>=45,'INVALID_ATLAS','Missing or truncated PNG');
 limit(stat.size<=G8_TEXTURE_LIMITS.maxCompressedBytesPerPage,'LIMIT_EXCEEDED','Compressed PNG exceeds per-page budget');
 const fd=openSync(path,'r'),head=Buffer.alloc(33);
 try{limit(readSync(fd,head,0,33,0)===33,'INVALID_ATLAS','Truncated PNG header');}
 finally{closeSync(fd);}
 return {...pngHeader(head),compressedBytes:stat.size};
}
export function checkAggregateTextures(pageHeaders){
 limit(pageHeaders.length<=G8_TEXTURE_LIMITS.maxPages,'LIMIT_EXCEEDED','Too many texture pages');
 const total=pageHeaders.reduce((s,x)=>s+x.decodedBytes,0);
 limit(Number.isSafeInteger(total)&&total<=G8_TEXTURE_LIMITS.maxDecodedBytesTotal,'LIMIT_EXCEEDED','Aggregate decoded texture memory budget exceeded');
 const peak=total+Math.max(0,...pageHeaders.map(x=>x.compressedBytes))+MIB;
 limit(peak<=G8_TEXTURE_LIMITS.maxPeakWorkingBytes,'LIMIT_EXCEEDED','Texture working memory budget exceeded');
 return {decodedBytesTotal:total,peakWorkingBytesBudget:peak};
}
const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
function parseChunks(bytes,header){
 let offset=8,ihdr=0,iend=0,seenIDAT=false,chunks=0;const idats=[];
 while(offset+12<=bytes.length){
  limit(++chunks<=65536,'LIMIT_EXCEEDED','Too many PNG chunks');
  const n=bytes.readUInt32BE(offset),end=offset+12+n;
  limit(n<=G8_TEXTURE_LIMITS.maxCompressedBytesPerPage&&end<=bytes.length,'INVALID_ATLAS','PNG chunk exceeds input bounds');
  const type=bytes.toString('ascii',offset+4,offset+8),body=bytes.subarray(offset+8,offset+8+n);
  limit(crc32(bytes,offset+4,offset+8+n)===bytes.readUInt32BE(offset+8+n),'INVALID_ATLAS','PNG chunk CRC mismatch');
  if(type==='IHDR'){
   limit(ihdr===0&&offset===8&&n===13,'INVALID_ATLAS','Invalid IHDR position');ihdr++;pngHeader(bytes.subarray(0,33));
  }else if(type==='IDAT'){
   limit(ihdr===1&&!iend,'INVALID_ATLAS','IDAT in invalid position');seenIDAT=true;idats.push(body);
  }else if(type==='IEND'){
   limit(n===0&&ihdr===1&&seenIDAT&&!iend,'INVALID_ATLAS','Malformed PNG IEND');iend++;
   offset=end;break;
  }else{
   limit(ihdr===1&&!iend,'INVALID_ATLAS','PNG chunk before IHDR');
   // Reject unknown *critical* chunks and palette/transparency variants that this pipeline does not interpret.
   limit((bytes[offset+4]&0x20)!==0,'UNSUPPORTED_SEMANTIC_FEATURE','Unsupported critical PNG chunk');
  }
  offset=end;
 }
 limit(ihdr===1&&iend===1&&seenIDAT&&offset===bytes.length,'INVALID_ATLAS','Incomplete PNG or trailing data');
 limit(header.width===bytes.readUInt32BE(16)&&header.height===bytes.readUInt32BE(20),'INVALID_ATLAS','PNG dimensions changed after preflight');
 return idats;
}
export async function decodePNGStreaming(bytes,header){
 limit(bytes.length<=G8_TEXTURE_LIMITS.maxCompressedBytesPerPage,'LIMIT_EXCEEDED','Compressed PNG exceeds per-page budget');
 const idats=parseChunks(bytes,header),stride=header.width*4,rowLen=stride+1;
 const expected=header.scanlineBytes;
 let rgba,row;
 try{rgba=Buffer.allocUnsafe(header.decodedBytes);row=Buffer.allocUnsafe(rowLen);}
 catch{throw new ConformanceError('LIMIT_EXCEEDED','Insufficient memory for approved decoded texture size');}
 let written=0,rows=0,rowFill=0;
 const inflater=createInflate({chunkSize:65536});
 Readable.from(idats,{objectMode:false}).pipe(inflater);
 try{
  for await(const chunk of inflater){
   let ptr=0;
   while(ptr<chunk.length){
    limit(written<expected,'INVALID_ATLAS','PNG inflate emitted excessive scanlines');
    const count=Math.min(rowLen-rowFill,chunk.length-ptr);
    chunk.copy(row,rowFill,ptr,ptr+count);rowFill+=count;ptr+=count;written+=count;
    if(rowFill===rowLen){
     const filter=row[0],dest=rows*stride;
     limit(filter<=4,'INVALID_ATLAS','Invalid PNG row filter');
     if(filter===0){row.copy(rgba,dest,1);}
     else for(let x=0;x<stride;x++){
      const left=x>=4?rgba[dest+x-4]:0,up=rows>0?rgba[dest-stride+x]:0,upperLeft=x>=4&&rows>0?rgba[dest-stride+x-4]:0;
      const predictor=filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);
      rgba[dest+x]=(row[x+1]+predictor)&255;
     }
     rows++;rowFill=0;
    }
   }
  }
 }catch(err){
  inflater.destroy();
  if(err instanceof ConformanceError)throw err;
  throw new ConformanceError('INVALID_ATLAS','PNG inflate failure');
 }
 limit(rows===header.height&&written===expected&&rowFill===0,'INVALID_ATLAS','PNG inflated length mismatch');
 return {width:header.width,height:header.height,rgba};
}
export async function loadPNGBounded(path,header){
 const stat=statSync(path);limit(stat.size===header.compressedBytes,'SOURCE_DIGEST_MISMATCH','PNG changed after preflight');
 const compressed=readFileSync(path);
 limit(compressed.length===header.compressedBytes,'SOURCE_DIGEST_MISMATCH','PNG changed while reading');
 const decoded=await decodePNGStreaming(compressed,header);
 // Digest of the exact decoded input bytes, not any replacement, reduced, or downsampled image.
 const {createHash}=await import('node:crypto');
 return {...decoded,sha256:createHash('sha256').update(compressed).digest('hex')};
}
