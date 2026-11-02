//! Rust C ABI. Opaque, non-concurrently mutable handle; all native memory
//! stays owned by the renderer; callers supply appropriately sized copy buffers.
//! Every entrypoint catches panics; pointers are checked for null before use.
use std::panic::{catch_unwind,AssertUnwindSafe};
use riglyph_render_core::{ABI_VERSION,PROTOCOL_VERSION,parse_request,Request,Texture};
use riglyph_render_cpu::Renderer;
pub struct RiglyphRenderer{inner:Renderer,frame:Vec<u8>,error:String}
fn guard(f:impl FnOnce()->i32)->i32{catch_unwind(AssertUnwindSafe(f)).unwrap_or(-99)}
fn err(h:&mut RiglyphRenderer,result:Result<(),String>)->i32{match result{
 Ok(())=>{h.error.clear();0},Err(e)=>{h.error=e;-1}
}}
#[no_mangle]pub extern "C" fn rg_renderer_abi_version()->u32{ABI_VERSION}
#[no_mangle]pub extern "C" fn rg_renderer_protocol_version()->u32{PROTOCOL_VERSION}
#[no_mangle]pub extern "C" fn rg_renderer_create(threads:u32)->*mut RiglyphRenderer{
 catch_unwind(||{
  if !(1..=16).contains(&threads){return std::ptr::null_mut();}
  Box::into_raw(Box::new(RiglyphRenderer{inner:Renderer::new(threads as usize),frame:Vec::new(),error:String::new()}))
 }).unwrap_or(std::ptr::null_mut())
}
#[no_mangle]pub unsafe extern "C" fn rg_renderer_load_texture(ptr:*mut RiglyphRenderer,id:u32,w:u32,h:u32,
 pixels:*const u8,len:usize,pma:u8,wrap_u:u8,wrap_v:u8)->i32{
 guard(||{
  // SAFETY: caller owns handle and texture allocation for this call; no
  // buffer outlives it because the pixels are immediately copied.
  let Some(renderer)=(unsafe{ptr.as_mut()}) else{return -2};
  if pixels.is_null()||len>512*1024*1024||wrap_u>1||wrap_v>1||pma>1{return -2;}
  let Some(expected)=(w as usize).checked_mul(h as usize).and_then(|v|v.checked_mul(4))else{return -2};
  if expected!=len||len==0{return -2;}
  let bytes=unsafe{std::slice::from_raw_parts(pixels,len)}.to_vec();
  err(renderer,renderer.inner.textures.load(id,Texture{
   width:w as usize,height:h as usize,rgba:bytes,pma:pma==1,wrap_u,wrap_v,
  }))
 })
}
#[no_mangle]pub unsafe extern "C" fn rg_renderer_render(ptr:*mut RiglyphRenderer,packet:*const u8,len:usize)->i32{
 guard(||{
  // SAFETY: input is copied into Rust-owned parsed data during this call.
  let Some(renderer)=(unsafe{ptr.as_mut()})else{return -2};
  if packet.is_null()||len>riglyph_render_core::MAX_MESSAGE{return -2;}
  let bytes=unsafe{std::slice::from_raw_parts(packet,len)};
  let result=(||{
   match parse_request(bytes)?{
    Request::Render(frame)=>{renderer.frame=renderer.inner.render(&frame)?;Ok(())},
    Request::Load(id,tex)=>renderer.inner.textures.load(id,tex),
    Request::Reset=>{renderer.inner.reset();renderer.frame.clear();Ok(())},
    Request::Ping=>Ok(()),
   }
  })();
  err(renderer,result)
 })
}
#[no_mangle]pub unsafe extern "C" fn rg_renderer_frame_size(ptr:*const RiglyphRenderer)->usize{
 catch_unwind(AssertUnwindSafe(||unsafe{ptr.as_ref()}.map_or(0,|h|h.frame.len()))).unwrap_or(0)
}
#[no_mangle]pub unsafe extern "C" fn rg_renderer_get_frame(ptr:*const RiglyphRenderer,to:*mut u8,capacity:usize)->usize{
 catch_unwind(AssertUnwindSafe(||{
  let Some(renderer)=(unsafe{ptr.as_ref()})else{return 0};
  if to.is_null()||capacity<renderer.frame.len(){return 0;}
  // SAFETY: caller guarantees capacity and exclusive ownership of destination;
  // native buffer remains owned by the handle.
  unsafe{std::ptr::copy_nonoverlapping(renderer.frame.as_ptr(),to,renderer.frame.len())};
  renderer.frame.len()
 })).unwrap_or(0)
}
#[no_mangle]pub unsafe extern "C" fn rg_renderer_last_error(ptr:*const RiglyphRenderer,to:*mut i8,capacity:usize)->usize{
 catch_unwind(AssertUnwindSafe(||{
  let Some(renderer)=(unsafe{ptr.as_ref()})else{return 0};
  let bytes=renderer.error.as_bytes();let needed=bytes.len()+1;
  if to.is_null()||capacity<needed{return needed;}
  unsafe{std::ptr::copy_nonoverlapping(bytes.as_ptr(),to.cast::<u8>(),bytes.len());*to.add(bytes.len())=0;}
  needed
 })).unwrap_or(0)
}
#[no_mangle]pub unsafe extern "C" fn rg_renderer_reset(ptr:*mut RiglyphRenderer)->i32{
 guard(||{let Some(renderer)=(unsafe{ptr.as_mut()})else{return -2};
  renderer.inner.reset();renderer.frame.clear();renderer.error.clear();0
 })
}
#[no_mangle]pub unsafe extern "C" fn rg_renderer_destroy(ptr:*mut RiglyphRenderer){
 if ptr.is_null(){return;}
 let _=catch_unwind(AssertUnwindSafe(||{unsafe{drop(Box::from_raw(ptr))};}));
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn version_and_null_ptr_safety(){
  assert_eq!(rg_renderer_abi_version(),1);assert_eq!(rg_renderer_protocol_version(),1);
  unsafe{assert_eq!(rg_renderer_render(std::ptr::null_mut(),std::ptr::null(),0),-2);
   assert_eq!(rg_renderer_get_frame(std::ptr::null(),std::ptr::null_mut(),0),0);}
 }
 #[test]fn load_texture_via_abi(){
  unsafe{let h=rg_renderer_create(2);assert!(!h.is_null());
   let rgba=[255,0,0,255];assert_eq!(rg_renderer_load_texture(h,1,1,1,rgba.as_ptr(),4,0,0,0),0);
   assert_eq!(rg_renderer_frame_size(h),0);rg_renderer_destroy(h);}
 }
}
