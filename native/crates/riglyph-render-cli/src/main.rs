//! Persistent native renderer process. Strict binary framing; no browser.
use std::io::{self,Read,Write};
use std::env;
use riglyph_render_core::{parse_request,serialize_response,Request,MAX_MESSAGE};
use riglyph_render_cpu::Renderer;
fn main()->Result<(),Box<dyn std::error::Error>>{
 let args:Vec<String>=env::args().collect();
 if args.iter().any(|x|x=="--version"){println!("riglyph-native 0.1.0 abi=1 protocol=1");return Ok(());}
 if args.iter().any(|x|x=="--help"){println!("riglyph-native [--threads N] [--once] [--version] (binary RGP1 stdin/stdout)");return Ok(());}
 let threads=if let Some(idx)=args.iter().position(|x|x=="--threads"){args.get(idx+1).ok_or("missing thread count")?.parse::<usize>()?}else{1};
 if !(1..=16).contains(&threads){return Err("threads must be in 1..=16".into());}
 let once=args.iter().any(|x|x=="--once");
 let mut renderer=Renderer::new(threads);
 let mut reader=io::stdin().lock();let mut writer=io::stdout().lock();
 loop{
  let mut n=[0u8;4];
  match reader.read_exact(&mut n){Ok(())=>(),Err(e) if e.kind()==io::ErrorKind::UnexpectedEof=>break,Err(e)=>return Err(e.into())}
  let len=u32::from_le_bytes(n) as usize;
  if len>MAX_MESSAGE{return Err("message length exceeds 256MiB".into());}
  let mut input=vec![0;len];reader.read_exact(&mut input)?;
  let result=(||->Result<Vec<u8>,String>{
   match parse_request(&input)?{
    Request::Load(id,tex)=>{renderer.textures.load(id,tex)?;Ok(Vec::new())}
    Request::Render(frame)=>renderer.render(&frame),
    Request::Reset=>{renderer.reset();Ok(Vec::new())}
    Request::Ping=>Ok(b"riglyph-native/1".to_vec()),
   }
  })();
  let reply=match result{Ok(bytes)=>serialize_response(Ok(&bytes)),Err(e)=>serialize_response(Err(&e))};
  writer.write_all(&(reply.len() as u32).to_le_bytes())?;
  writer.write_all(&reply)?;writer.flush()?;
  if once{break;}
 }
 Ok(())
}
