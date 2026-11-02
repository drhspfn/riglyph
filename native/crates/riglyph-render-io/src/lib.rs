//! Dependency-free, lossless RGBA PNG output for native C/Rust clients.
//! Uses valid DEFLATE stored blocks (no compression); prefer JS zlib for
//! production PNG sequence compression and optional FFmpeg video output.
use std::{fs,io,path::Path};
fn crc32(bytes:&[u8])->u32{
 let mut crc=0xffff_ffffu32;
 for &b in bytes{crc^=b as u32;for _ in 0..8{crc=(crc>>1)^if crc&1==1{0xedb8_8320}else{0};}}
 !crc
}
fn adler32(bytes:&[u8])->u32{
 let(mut a,mut b)=(1u32,0u32);for &v in bytes{a=(a+v as u32)%65521;b=(b+a)%65521;}(b<<16)|a
}
fn chunk(out:&mut Vec<u8>,tag:&[u8;4],data:&[u8]){
 out.extend_from_slice(&(data.len() as u32).to_be_bytes());
 let start=out.len();out.extend_from_slice(tag);out.extend_from_slice(data);
 out.extend_from_slice(&crc32(&out[start..]).to_be_bytes());
}
pub fn png_rgba(w:u32,h:u32,rgba:&[u8])->Result<Vec<u8>,String>{
 let expected=(w as usize).checked_mul(h as usize).and_then(|x|x.checked_mul(4)).ok_or("PNG dimensions overflow")?;
 if expected==0||expected>64*1024*1024||rgba.len()!=expected{return Err("invalid RGBA PNG input".into());}
 let mut scanlines=Vec::with_capacity(expected+h as usize);
 for row in rgba.chunks_exact(w as usize*4){scanlines.push(0);scanlines.extend_from_slice(row);}
 let mut z=vec![0x78,0x01];
 for (i,part) in scanlines.chunks(65535).enumerate(){
  let last=if (i+1)*65535>=scanlines.len(){1u8}else{0};
  let n=part.len() as u16;
  z.push(last);z.extend_from_slice(&n.to_le_bytes());z.extend_from_slice(&(!n).to_le_bytes());z.extend_from_slice(part);
 }
 z.extend_from_slice(&adler32(&scanlines).to_be_bytes());
 let mut out=vec![137,80,78,71,13,10,26,10];let mut ihdr=Vec::with_capacity(13);
 ihdr.extend_from_slice(&w.to_be_bytes());ihdr.extend_from_slice(&h.to_be_bytes());ihdr.extend_from_slice(&[8,6,0,0,0]);
 chunk(&mut out,b"IHDR",&ihdr);chunk(&mut out,b"IDAT",&z);chunk(&mut out,b"IEND",&[]);
 Ok(out)
}
pub fn write_png(path:&Path,w:u32,h:u32,rgba:&[u8])->io::Result<()>{
 let png=png_rgba(w,h,rgba).map_err(io::Error::other)?;fs::write(path,png)
}
#[cfg(test)]mod tests{use super::*;#[test]fn png_signature(){let png=png_rgba(1,1,&[1,2,3,4]).unwrap();assert_eq!(&png[..8],&[137,80,78,71,13,10,26,10]);assert!(png.windows(4).any(|w|w==b"IDAT"));}}
