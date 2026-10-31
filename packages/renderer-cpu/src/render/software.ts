import {EngineError,requireCondition} from '@riglyph/core';
import type {DrawPacket} from '@riglyph/renderer-webgl2';
import type {Viewport} from '@riglyph/renderer-webgl2';
export type TextureSampling='nearest'|'linear';
export type TextureWrap='clamp'|'repeat';
export type RawTexture={width:number;height:number;rgba:Uint8Array;premultiplied:boolean;wrapU?:TextureWrap;wrapV?:TextureWrap};
export type SoftwareRenderOptions={sampling?:TextureSampling};
/** CPU analogue of WebGL normalized texture coordinates at pixel centers.
 * Data is sampled in its declared storage alpha mode; PMA is undone only after
 * interpolation (doing it per texel first changes colors at transparent edges).
 */
export function sampleTexture(texture:RawTexture,u:number,v:number,sampling:TextureSampling='nearest'):[number,number,number,number]{
 requireCondition(Number.isFinite(u)&&Number.isFinite(v),'INVALID_TOPOLOGY','Non-finite texture coordinates');
 const wrap=(i:number,n:number,mode:TextureWrap)=>mode==='repeat'?((i%n)+n)%n:Math.max(0,Math.min(n-1,i));
 const read=(x:number,y:number):[number,number,number,number]=>{
  const ix=wrap(x,texture.width,texture.wrapU??'clamp'),iy=wrap(y,texture.height,texture.wrapV??'clamp');
  const at=(iy*texture.width+ix)*4;
  return [texture.rgba[at]!/255,texture.rgba[at+1]!/255,texture.rgba[at+2]!/255,texture.rgba[at+3]!/255];
 };
 if(sampling==='nearest')return read(Math.floor(u*texture.width),Math.floor(v*texture.height));
 if(sampling!=='linear')throw new EngineError('INVALID_ATLAS',`Unsupported CPU sampling: ${String(sampling)}`);
 const fx=u*texture.width-.5,fy=v*texture.height-.5;
 const x=Math.floor(fx),y=Math.floor(fy),tx=fx-x,ty=fy-y;
 const p00=read(x,y),p10=read(x+1,y),p01=read(x,y+1),p11=read(x+1,y+1);
 return [0,1,2,3].map(c=>((p00[c]!*(1-tx)+p10[c]!*tx)*(1-ty)+(p01[c]!*(1-tx)+p11[c]!*tx)*ty)) as [number,number,number,number];
}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
/** Optional CPU pixel oracle; consumes the same ordered draw packets as WebGL2. */
export function rasterize(packets:readonly DrawPacket[],textures:ReadonlyMap<string,RawTexture>,view:Viewport,width:number,height:number,clear:[number,number,number,number]=[0,0,0,0],options:SoftwareRenderOptions={}):Uint8ClampedArray{
 requireCondition(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width*height<=8_388_608,'LIMIT_EXCEEDED','Software surface too large');
 requireCondition(view.width>0&&view.height>0,'INVALID_TOPOLOGY','Invalid viewport');
 const image=new Float32Array(width*height*4),output=new Uint8ClampedArray(width*height*4);
 for(let p=0;p<width*height;p++){image[p*4]=clear[0]*clear[3];image[p*4+1]=clear[1]*clear[3];image[p*4+2]=clear[2]*clear[3];image[p*4+3]=clear[3];}
 let ntri=0;
 for(const packet of packets){
  const texture=textures.get(packet.pageId);requireCondition(texture,'MISSING_TEXTURE_PAGE',`Missing CPU page ${packet.pageId}`);
  requireCondition(texture.width>0&&texture.height>0&&texture.rgba.length===texture.width*texture.height*4,'INVALID_ATLAS','Invalid RGBA texture dimensions');
  requireCondition(texture.premultiplied===packet.pma,'INVALID_ATLAS','Texture alpha mode mismatches packet');
  const points=packet.positions,uvs=packet.uvs;
  requireCondition(points.length===uvs.length&&points.length%6===0,'INVALID_TOPOLOGY','Malformed draw packet arrays');
  for(let i=0;i<points.length;i+=6){
   requireCondition(++ntri<=1_000_000,'LIMIT_EXCEEDED','Too many triangles for CPU rasterizer');
   const x0=(points[i]!-view.left)/view.width*width,y0=height-(points[i+1]!-view.bottom)/view.height*height;
   const x1=(points[i+2]!-view.left)/view.width*width,y1=height-(points[i+3]!-view.bottom)/view.height*height;
   const x2=(points[i+4]!-view.left)/view.width*width,y2=height-(points[i+5]!-view.bottom)/view.height*height;
   const det=(x1-x0)*(y2-y0)-(y1-y0)*(x2-x0);if(Math.abs(det)<1e-12)continue;
   const left=Math.max(0,Math.floor(Math.min(x0,x1,x2))),right=Math.min(width-1,Math.ceil(Math.max(x0,x1,x2)));
   const top=Math.max(0,Math.floor(Math.min(y0,y1,y2))),bottom=Math.min(height-1,Math.ceil(Math.max(y0,y1,y2)));
   for(let py=top;py<=bottom;py++)for(let px=left;px<=right;px++){
    const fx=px+.5,fy=py+.5;
    const w1=((fx-x0)*(y2-y0)-(fy-y0)*(x2-x0))/det;
    const w2=((x1-x0)*(fy-y0)-(y1-y0)*(fx-x0))/det;
    const w0=1-w1-w2;if(w0<-1e-8||w1<-1e-8||w2<-1e-8)continue;
    // Top-left raster convention: adjacent triangles may not fill their shared edge twice.
    const winding=det>0?1:-1;
    const includes=(ax:number,ay:number,bx:number,by:number)=>{
     const dx=(bx-ax)*winding,dy=(by-ay)*winding;return dy>0||(Math.abs(dy)<1e-9&&dx<0);
    };
    if(Math.abs(w0)<1e-8&&!includes(x1,y1,x2,y2))continue;
    if(Math.abs(w1)<1e-8&&!includes(x2,y2,x0,y0))continue;
    if(Math.abs(w2)<1e-8&&!includes(x0,y0,x1,y1))continue;
    const u=uvs[i]!*w0+uvs[i+2]!*w1+uvs[i+4]!*w2;
    const v=uvs[i+1]!*w0+uvs[i+3]!*w1+uvs[i+5]!*w2;
    const [tr,tg,tb,alpha]=sampleTexture(texture,u,v,options.sampling??'nearest');
    const texRGB=[tr,tg,tb];
    const sa=alpha*packet.light[3];
    // Match GPU two-color shader in the *texture storage alpha mode*.
    // PMA dark tint must use original premultiplied tex.rgb rather than
    // converting to straight color before applying dark: that conversion
    // overweights dark tint at translucent edges.
    const sourcePM=texRGB.map((raw,c)=>clamp(raw*packet.light[c]!+(packet.dark?.[c]??0)*(alpha-raw))*(texture.premultiplied?packet.light[3]:sa));
    const di=(py*width+px)*4,da=image[di+3]!,dst=[image[di]!,image[di+1]!,image[di+2]!];
    const dstStraight=dst.map(x=>da?x/da:0);
    for(let c=0;c<3;c++){
     const source=sourcePM[c]!,Cs=sa?source/sa:0,Cd=dstStraight[c]!;
     let pm:number;
     switch(packet.blend){
      case 'normal':pm=source+dst[c]!*(1-sa);break;
      case 'additive':pm=source+dst[c]!;break;
      case 'multiply':pm=source*(1-da)+dst[c]!*(1-sa)+sa*da*Cs*Cd;break;
      case 'screen':pm=source*(1-da)+dst[c]!*(1-sa)+sa*da*(Cs+Cd-Cs*Cd);break;
     }
     image[di+c]=clamp(pm);
    }
    image[di+3]=clamp(sa+da*(1-sa));
   }
  }
 }
 for(let p=0;p<width*height;p++){
  const a=image[p*4+3]!;for(let c=0;c<3;c++)output[p*4+c]=Math.round(255*(a?clamp(image[p*4+c]!/a):0));
  output[p*4+3]=Math.round(a*255);
 }
 return output;
}
