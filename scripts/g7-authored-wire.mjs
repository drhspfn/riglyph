/** Independently constructed minimal 4.1.23 wire vectors for consistency tests.
 * Not exported by Spine Editor. Not evidence of editor interoperability.
 * Contains no A2/A3/A4 bytes or commercial animation data.
 */
export function authoredMinimalWire({nonessential=false,version='4.1.23',slot=true}={}){
 const bytes=[];
 const u8=n=>bytes.push(n&255);
 const varint=n=>{if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)throw Error('bad uint');do{const b=n&127;n=Math.floor(n/128);u8(n?b|128:b);}while(n>0);};
 const f32=n=>{const v=Buffer.allocUnsafe(4);v.writeFloatLE(n);bytes.push(...v);};
 const i32=n=>{const v=Buffer.allocUnsafe(4);v.writeInt32LE(n);bytes.push(...v);};
 const utf8=s=>{if(s===null){varint(0);return;}const b=Buffer.from(s,'utf8');varint(b.length+1);bytes.push(...b);};
 bytes.push(...Array.from({length:8},(_,i)=>i+1));utf8(version);
 for(const n of [-2,-1,6,4])f32(n);
 u8(nonessential?1:0);
 if(nonessential){f32(30);utf8('');utf8('');}
 varint(0); // empty dictionary, no skin/attachment references
 varint(1);utf8('independent-root'); // one root bone
 for(const n of [0,1,2,1,1,0,0,3])f32(n);
 varint(0);u8(0); // normal inheritance, skinRequired=false
 if(nonessential)i32(0x11223344);
 varint(slot?1:0);
 if(slot){utf8('independent-slot');varint(0);i32(-1);i32(-1);varint(0);varint(0);}
 // 3 constraint groups, default skin entries, named skins, events and animations
 for(let i=0;i<7;i++)varint(0);
 return Buffer.from(bytes);
}
