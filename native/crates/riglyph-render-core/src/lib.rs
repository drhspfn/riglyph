//! Riglyph native packet protocol v1 (RGP1), little-endian, length-framed.
//! Protocol versions are independent of Riglyph package/release versions.
//! Maximum request length: 256 MiB; every count, float and texture is validated.
use std::collections::HashMap;
pub const MAGIC: &[u8; 4] = b"RGP1";
pub const ABI_VERSION: u32 = 1;
pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_MESSAGE: usize = 256 * 1024 * 1024;
// Framebuffer and atlas pages have separate budgets. A 4096x4096 atlas
// requires 64 MiB of RGBA8 storage and must not be treated as a render surface.
pub const MAX_PIXELS: usize = 8_388_608;
pub const MAX_TEXTURE_SIDE: usize = 8_192;
pub const MAX_TEXTURE_PIXELS: usize = 32 * 1024 * 1024;
pub const MAX_TEXTURE_CACHE_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_VERTICES: usize = 6_000_000;

#[derive(Debug, Clone)]
pub struct Texture {
 pub width: usize, pub height: usize, pub rgba: Vec<u8>,
 pub pma: bool, pub wrap_u: u8, pub wrap_v: u8,
}
#[derive(Debug, Clone, Copy)]
pub struct Vertex { pub x:f64, pub y:f64, pub u:f64, pub v:f64 }
#[derive(Debug, Clone)]
pub struct Packet {
 pub texture_id:u32, pub blend:u8, pub pma:bool,
 pub light:[f64;4], pub dark:[f64;3], pub vertices:Vec<Vertex>,
}
#[derive(Debug)]
pub struct FrameInput {
 pub width:usize, pub height:usize, pub view:[f64;4],
 pub clear:[f64;4], pub sampling:u8, pub packets:Vec<Packet>,
}
pub enum Request { Load(u32,Texture), Render(FrameInput), Reset, Ping }

struct Reader<'a> { data:&'a [u8], pos:usize }
impl<'a> Reader<'a> {
 fn new(data:&'a [u8])->Self{Self{data,pos:0}}
 fn take(&mut self,n:usize)->Result<&'a [u8],String>{
  let end=self.pos.checked_add(n).ok_or("integer overflow")?;
  if end>self.data.len(){return Err("truncated packet".into());}
  let out=&self.data[self.pos..end];self.pos=end;Ok(out)
 }
 fn u8(&mut self)->Result<u8,String>{Ok(self.take(1)?[0])}
 fn u16(&mut self)->Result<u16,String>{Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))}
 fn u32(&mut self)->Result<u32,String>{Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))}
 fn f32(&mut self)->Result<f64,String>{let x=f32::from_le_bytes(self.take(4)?.try_into().unwrap()) as f64;if x.is_finite(){Ok(x)}else{Err("non-finite vertex".into())}}
 fn f64(&mut self)->Result<f64,String>{let x=f64::from_le_bytes(self.take(8)?.try_into().unwrap());if x.is_finite(){Ok(x)}else{Err("non-finite material or viewport".into())}}
 fn done(self)->Result<(),String>{if self.pos==self.data.len(){Ok(())}else{Err("unexpected trailing packet bytes".into())}}
}
fn bounded_surface(w:usize,h:usize)->Result<usize,String>{
 let count=w.checked_mul(h).ok_or("framebuffer dimensions overflow")?;
 if w==0||h==0||count>MAX_PIXELS{return Err("framebuffer surface budget exceeded".into());}
 Ok(count)
}
/// Texture pages are retained in RGBA8 cache across render frames; unlike a
/// framebuffer, one page may be 4096x4096 or larger within its own budget.
pub fn bounded_texture(w:usize,h:usize)->Result<usize,String>{
 let count=w.checked_mul(h).ok_or("texture dimensions overflow")?;
 if w==0||h==0||w>MAX_TEXTURE_SIDE||h>MAX_TEXTURE_SIDE||count>MAX_TEXTURE_PIXELS{
  return Err("texture dimensions exceed native atlas page budget".into());
 }
 count.checked_mul(4).ok_or("texture byte count overflow".into())
}
pub fn parse_request(data:&[u8])->Result<Request,String>{
 if data.len()>MAX_MESSAGE{return Err("packet exceeds maximum length".into());}
 let mut r=Reader::new(data);
 if r.take(4)?!=MAGIC{return Err("incompatible packet magic".into());}
 if r.u16()?!=PROTOCOL_VERSION{return Err("unsupported native packet protocol version".into());}
 let command=r.u8()?;let features=r.u8()?;
 if features!=0{return Err("unknown packet feature flags".into());}
 let req=match command{
  1=>{
   let id=r.u32()?;let w=r.u32()? as usize;let h=r.u32()? as usize;
   let pma=r.u8()?!=0;let wrap_u=r.u8()?;let wrap_v=r.u8()?;let reserved=r.u8()?;
   if wrap_u>1||wrap_v>1||reserved!=0{return Err("invalid texture flags".into());}
   let expected=bounded_texture(w,h)?;
   let n=r.u32()? as usize;if n!=expected{return Err("texture byte count mismatch".into());}
   let pixels=r.take(n)?.to_vec();
   Request::Load(id,Texture{width:w,height:h,rgba:pixels,pma,wrap_u,wrap_v})
  },
  2=>{
   let w=r.u32()? as usize;let h=r.u32()? as usize;bounded_surface(w,h)?;
   let mut view=[0.;4];let mut clear=[0.;4];
   for v in &mut view{*v=r.f64()?;}for v in &mut clear{*v=r.f64()?;}
   if view[2]<=0.||view[3]<=0.||clear.iter().any(|x|*x<0.||*x>1.){
    return Err("invalid viewport or clear color".into());
   }
   let sampling=r.u8()?;if sampling>1{return Err("invalid sampling mode".into());}
   let reserved=r.take(3)?;if reserved!=[0,0,0]{return Err("invalid frame reserved bytes".into());}
   let count=r.u32()? as usize;if count>100_000{return Err("too many draw packets".into());}
   let mut packets=Vec::with_capacity(count);
   let mut vertices_total=0usize;
   for _ in 0..count{
    let texture_id=r.u32()?;let blend=r.u8()?;let pma=r.u8()?!=0;
    if blend>3{return Err("unsupported blending mode".into());}
    if r.u16()?!=0{return Err("unknown material flags".into());}
    let mut light=[0.;4];let mut dark=[0.;3];
    for x in &mut light{*x=r.f64()?;}for x in &mut dark{*x=r.f64()?;}
    if light.iter().any(|x|*x<0.||*x>1.)||dark.iter().any(|x|*x<0.||*x>1.){
     return Err("invalid tint".into());
    }
    let n=r.u32()? as usize;
    if !n.is_multiple_of(3)||n>MAX_VERTICES||vertices_total.checked_add(n).ok_or("vertex overflow")?>MAX_VERTICES{
     return Err("invalid draw packet vertex count".into());
    }
    vertices_total+=n;
    let mut verts=Vec::with_capacity(n);
    for _ in 0..n{verts.push(Vertex{x:r.f32()?,y:r.f32()?,u:r.f32()?,v:r.f32()?});}
    packets.push(Packet{texture_id,blend,pma,light,dark,vertices:verts});
   }
   Request::Render(FrameInput{width:w,height:h,view,clear,sampling,packets})
  },
  3=>Request::Reset,
  4=>Request::Ping,
  _=>return Err("unknown packet command".into()),
 };
 r.done()?;Ok(req)
}
pub fn serialize_response(result:Result<&[u8],&str>)->Vec<u8>{
 let (status,payload)=match result{Ok(data)=>(0u8,data),Err(error)=>(1u8,error.as_bytes())};
 let mut out=Vec::with_capacity(payload.len()+1);
 out.push(status);out.extend_from_slice(payload);out
}
#[derive(Default)]
pub struct TextureStore{ pub textures:HashMap<u32,Texture> }
impl TextureStore{
 pub fn load(&mut self,id:u32,tex:Texture)->Result<(),String>{
  let expected=bounded_texture(tex.width,tex.height)?;
  if tex.rgba.len()!=expected{return Err("texture storage length mismatch".into());}
  if tex.wrap_u>1||tex.wrap_v>1{return Err("invalid texture wrap mode".into());}
  let total=self.textures.values().try_fold(0usize,|sum,t|{
   sum.checked_add(t.rgba.len()).ok_or("texture cache size overflow")
  })?;
  let current=self.textures.get(&id).map_or(0,|t|t.rgba.len());
  let next=total.checked_sub(current).and_then(|v|v.checked_add(expected))
   .ok_or("texture cache size overflow")?;
  if next>MAX_TEXTURE_CACHE_BYTES{return Err("texture cache exceeds 512 MiB".into());}
  self.textures.insert(id,tex);Ok(())
 }
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn version_and_short_packets(){
  assert!(parse_request(b"junk").is_err());
  assert!(parse_request(&[b'R',b'G',b'P',b'1',2,0,4,0]).is_err());
  assert!(matches!(parse_request(&[b'R',b'G',b'P',b'1',1,0,4,0]),Ok(Request::Ping)));
 }
 #[test]fn reject_truncated_frame(){
  assert!(parse_request(&[b'R',b'G',b'P',b'1',1,0,2,0,0]).is_err());
 }
}
