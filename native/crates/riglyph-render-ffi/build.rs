use std::{env,fs,path::Path};
fn main(){
 let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../include/riglyph_native.h");
 let text=fs::read_to_string(root).expect("missing C ABI header");
 let out=Path::new(&env::var("OUT_DIR").unwrap()).join("riglyph_native.h");
 fs::write(out,text).expect("generate header");
 println!("cargo:rerun-if-changed=../../include/riglyph_native.h");
}
