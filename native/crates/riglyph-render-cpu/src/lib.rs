//! Deterministic CPU rasterization of canonical Riglyph triangles.
//! Each stripe owns disjoint pixels; triangles/packets preserve original order.
//! Pixel-center / top-left convention and blend semantics track software.ts.
use riglyph_render_core::{FrameInput,Texture,TextureStore,MAX_PIXELS};
use std::time::{Duration,Instant};
#[derive(Debug,Default,Clone,Copy)]
pub struct Counters {pub raster_time:Duration,pub triangles:u64,pub shaded_pixels:u64}
pub struct Renderer {
 pub textures:TextureStore, framebuffer:Vec<f32>,pub threads:usize,pub stats:Counters,
}
impl Default for Renderer {fn default()->Self{Self::new(1)}}
impl Renderer {
 pub fn new(threads:usize)->Self{Self{textures:TextureStore::default(),framebuffer:Vec::new(),threads:threads.clamp(1,16),stats:Counters::default()}}
 pub fn render(&mut self,input:&FrameInput)->Result<Vec<u8>,String>{
  let pixels=input.width.checked_mul(input.height).ok_or("surface overflow")?;
  if pixels==0||pixels>MAX_PIXELS{return Err("framebuffer too large".into());}
  for p in &input.packets{
   let texture=self.textures.textures.get(&p.texture_id).ok_or("missing texture page")?;
   if texture.pma!=p.pma{return Err("packet / texture premultiplied alpha mismatch".into());}
  }
  let start=Instant::now();let width=input.width;
  self.framebuffer.resize(pixels*4,0.);
  let clear=&input.clear;
  for px in self.framebuffer.as_chunks_mut::<4>().0{
   px[0]=(clear[0]*clear[3]) as f32;px[1]=(clear[1]*clear[3]) as f32;
   px[2]=(clear[2]*clear[3]) as f32;px[3]=clear[3] as f32;
  }
  let threads=self.threads.min(input.height);
  let band_height=input.height.div_ceil(threads);
  let stride=band_height*width*4;
  let texture_ref=&self.textures.textures;
  let mut total_tri=0u64;let mut shaded=0u64;
  std::thread::scope(|scope|{
   let mut handles=Vec::new();
   for (band,buffer) in self.framebuffer.chunks_mut(stride).enumerate(){
    let iy=band*band_height;
    handles.push(scope.spawn(move||shade_band(buffer,input,texture_ref,iy)));
   }
   for handle in handles{
    let (tri,pix)=handle.join().expect("raster worker panicked");
    total_tri+=tri;shaded+=pix;
   }
  });
  let mut rgba=vec![0u8;pixels*4];
  for (p,px) in self.framebuffer.as_chunks::<4>().0.iter().enumerate(){
   let a=px[3] as f64;
   for c in 0..3{
    rgba[p*4+c]=round_byte(if a>0.{(px[c] as f64/a).clamp(0.,1.)}else{0.});
   }
   rgba[p*4+3]=round_byte(a);
  }
  self.stats=Counters{raster_time:start.elapsed(),triangles:total_tri,shaded_pixels:shaded};
  Ok(rgba)
 }
 pub fn reset(&mut self){self.textures.textures.clear();self.framebuffer.clear();self.stats=Counters::default();}
}
fn round_byte(x:f64)->u8{(255.*x).round().clamp(0.,255.) as u8}
#[inline]fn ix(coord:i32,n:usize,repeat:u8)->usize{
 if repeat==1{coord.rem_euclid(n as i32) as usize}else{coord.clamp(0,n as i32-1) as usize}
}
#[inline]fn texel(t:&Texture,x:i32,y:i32)->[f64;4]{
 let k=(ix(y,t.height,t.wrap_v)*t.width+ix(x,t.width,t.wrap_u))*4;
 [t.rgba[k] as f64/255.,t.rgba[k+1] as f64/255.,t.rgba[k+2] as f64/255.,t.rgba[k+3] as f64/255.]
}
#[inline]fn sample(t:&Texture,u:f64,v:f64,sampling:u8)->[f64;4]{
 if sampling==0{return texel(t,(u*t.width as f64).floor() as i32,(v*t.height as f64).floor() as i32);}
 let fx=u*t.width as f64-0.5;let fy=v*t.height as f64-0.5;
 let x=fx.floor() as i32;let y=fy.floor() as i32;
 let tx=fx-x as f64;let ty=fy-y as f64;
 let a=texel(t,x,y);let b=texel(t,x+1,y);let c=texel(t,x,y+1);let d=texel(t,x+1,y+1);
 let mut rgba=[0.;4];
 for k in 0..4{rgba[k]=(a[k]*(1.-tx)+b[k]*tx)*(1.-ty)+(c[k]*(1.-tx)+d[k]*tx)*ty;}
 rgba
}
#[inline]fn inside_edge(ax:f64,ay:f64,bx:f64,by:f64,winding:f64)->bool{
 let dx=(bx-ax)*winding;let dy=(by-ay)*winding;
 dy>0.||(dy.abs()<1e-9&&dx<0.)
}
fn shade_band(buffer:&mut [f32],frame:&FrameInput,textures:&std::collections::HashMap<u32,Texture>,y_start:usize)->(u64,u64){
 let mut triangles=0u64;let mut shaded=0u64;
 let width=frame.width;let height=frame.height;
 let band_h=buffer.len()/(width*4);
 let top_of_band=y_start as i32;let bottom_of_band=(y_start+band_h-1) as i32;
 let [left,bottom,vw,vh]=frame.view;
 for packet in &frame.packets{
  let tex=&textures[&packet.texture_id];
  for triangle in packet.vertices.as_chunks::<3>().0{
   triangles+=1;
   let x0=(triangle[0].x-left)/vw*width as f64;
   let y0=height as f64-(triangle[0].y-bottom)/vh*height as f64;
   let x1=(triangle[1].x-left)/vw*width as f64;
   let y1=height as f64-(triangle[1].y-bottom)/vh*height as f64;
   let x2=(triangle[2].x-left)/vw*width as f64;
   let y2=height as f64-(triangle[2].y-bottom)/vh*height as f64;
   let det=(x1-x0)*(y2-y0)-(y1-y0)*(x2-x0);
   if det.abs()<1e-12{continue;}
   let x_lo=(x0.min(x1).min(x2).floor() as i32).max(0);
   let x_hi=(x0.max(x1).max(x2).ceil() as i32).min(width as i32-1);
   let y_lo=(y0.min(y1).min(y2).floor() as i32).max(top_of_band);
   let y_hi=(y0.max(y1).max(y2).ceil() as i32).min(bottom_of_band);
   if x_lo>x_hi||y_lo>y_hi{continue;}
   let winding=if det>0.{1.}else{-1.};
   let inv=1./det;
   let edge0=inside_edge(x1,y1,x2,y2,winding);
   let edge1=inside_edge(x2,y2,x0,y0,winding);
   let edge2=inside_edge(x0,y0,x1,y1,winding);
   let [u0,v0]=[triangle[0].u,triangle[0].v];
   let [u1,v1]=[triangle[1].u,triangle[1].v];
   let [u2,v2]=[triangle[2].u,triangle[2].v];
   for py in y_lo..=y_hi{for px in x_lo..=x_hi{
    let x=px as f64+0.5;let y=py as f64+0.5;
    let w1=((x-x0)*(y2-y0)-(y-y0)*(x2-x0))*inv;
    let w2=((x1-x0)*(y-y0)-(y1-y0)*(x-x0))*inv;
    let w0=1.-w1-w2;
    if w0< -1e-8||w1< -1e-8||w2< -1e-8{continue;}
    if (w0.abs()<1e-8&&!edge0)||(w1.abs()<1e-8&&!edge1)||(w2.abs()<1e-8&&!edge2){continue;}
    let u=u0*w0+u1*w1+u2*w2;
    let v=v0*w0+v1*w1+v2*w2;
    let color=sample(tex,u,v,frame.sampling);
    let alpha=color[3];
    let sa=alpha*packet.light[3];
    let di=((py as usize-y_start)*width+px as usize)*4;
    let da=buffer[di+3] as f64;
    let mut source=[0.;3];let mut next=[0.;3];
    for c in 0..3{
     let raw=color[c];
     source[c]=(raw*packet.light[c]+packet.dark[c]*(alpha-raw)).clamp(0.,1.)*
      (if tex.pma{packet.light[3]}else{sa});
     let dst=buffer[di+c] as f64;
     let cs=if sa>0.{source[c]/sa}else{0.};
     let cd=if da>0.{dst/da}else{0.};
     next[c]=match packet.blend{
      0=>source[c]+dst*(1.-sa),
      1=>source[c]+dst,
      2=>source[c]*(1.-da)+dst*(1.-sa)+sa*da*cs*cd,
      3=>source[c]*(1.-da)+dst*(1.-sa)+sa*da*(cs+cd-cs*cd),
      _=>unreachable!(),
     }.clamp(0.,1.);
    }
    for c in 0..3{buffer[di+c]=next[c] as f32;}
    buffer[di+3]=(sa+da*(1.-sa)).clamp(0.,1.) as f32;
    shaded+=1;
   }}
  }
 }
 (triangles,shaded)
}
#[cfg(test)]
mod tests{
 use super::*;use riglyph_render_core::{Vertex,Packet};
 #[test]fn empty_transparent(){
  let mut r=Renderer::new(1);
  let result=r.render(&FrameInput{width:5,height:4,view:[0.,0.,5.,4.],clear:[0.,0.,0.,0.],sampling:0,packets:vec![]}).unwrap();
  assert_eq!(result,vec![0;80]);
 }
 #[test]fn opaque_triangle_deterministic_parallel(){
  let mut r=Renderer::new(1);
  r.textures.load(1,Texture{width:1,height:1,rgba:vec![250,100,30,255],pma:false,wrap_u:0,wrap_v:0}).unwrap();
  let frame=FrameInput{width:16,height:16,view:[0.,0.,16.,16.],clear:[0.,0.,0.,0.],sampling:0,packets:vec![Packet{
   texture_id:1,blend:0,pma:false,light:[1.;4],dark:[0.;3],
   vertices:vec![Vertex{x:1.,y:1.,u:0.,v:0.},Vertex{x:15.,y:1.,u:1.,v:0.},Vertex{x:1.,y:15.,u:0.,v:1.}],
  }]};
  let a=r.render(&frame).unwrap();assert!(a.chunks(4).any(|p|p==[250,100,30,255]));r.threads=4;
  let b=r.render(&frame).unwrap();assert_eq!(a,b);assert_eq!(b,r.render(&frame).unwrap());
 }
 #[test]fn repeat_and_bilinear(){let t=Texture{width:2,height:1,rgba:vec![255,0,0,255,0,0,255,255],pma:false,wrap_u:1,wrap_v:0};
  assert_eq!(sample(&t,1.25,0.5,0),[1.,0.,0.,1.]);let p=sample(&t,0.5,0.5,1);assert!(p[0]>0.4&&p[2]>0.4);
 }
}
