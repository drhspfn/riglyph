import {EngineError,requireCondition} from '@riglyph/core';
import type {AtlasPage} from '@riglyph/core';
import type {DrawPacket} from './packets.js';

export type Viewport={left:number;bottom:number;width:number;height:number};
const vertexShader=`#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform vec4 u_viewport;
out vec2 v_uv;
void main(){vec2 xy=((a_position-u_viewport.xy)/u_viewport.zw)*2.0-1.0;gl_Position=vec4(xy,0.0,1.0);v_uv=a_uv;}`;
const fragmentShader=`#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec4 u_light;
uniform vec3 u_dark;
uniform bool u_hasDark;
uniform bool u_pma;
uniform bool u_screen;
out vec4 fragColor;
void main(){
  // IR and CPU use top-left normalized UVs. With an unflipped ImageBitmap upload,
  // WebGL2 samples those top-left coordinates directly; do not invert V again.
  vec4 tex=texture(u_texture,v_uv);
  vec3 tinted=tex.rgb*u_light.rgb;
  if(u_hasDark)tinted+=u_dark*(tex.a-tex.rgb);
  // Screen blending requires a premultiplied source so that GL can compute
  // Cs + Cd - Cs*Cd using ONE_MINUS_DST_COLOR / ONE.
  if(u_pma)tinted*=u_light.a;
  else if(u_screen)tinted*=tex.a*u_light.a;
  fragColor=vec4(tinted,tex.a*u_light.a);
}`;
function compile(gl:WebGL2RenderingContext,type:number,source:string):WebGLShader{
 const shader=gl.createShader(type);if(!shader)throw new EngineError('UNSUPPORTED_SEMANTIC_FEATURE','Failed to create WebGL2 shader');
 gl.shaderSource(shader,source);gl.compileShader(shader);
 if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new EngineError('UNSUPPORTED_SEMANTIC_FEATURE',gl.getShaderInfoLog(shader)??'Shader compile failed');return shader;
}
/** Draws ordered packets directly, intentionally never sorting across transparent pages. */
export class WebGL2Renderer{
 private readonly gl:WebGL2RenderingContext;
 private readonly program:WebGLProgram;
 private readonly positions:WebGLBuffer;
 private readonly uvs:WebGLBuffer;
 private readonly textures=new Map<string,WebGLTexture>();
 private readonly pages=new Map<string,AtlasPage>();
 private samplingOverride:'atlas'|'nearest'|'linear'='atlas';
 /** Diagnostic override for matched CPU/WebGL sampling, without changing page IR. */
 setSamplingMode(mode:'atlas'|'nearest'|'linear'):void{
  requireCondition(['atlas','nearest','linear'].includes(mode),'INVALID_ATLAS','Invalid WebGL sampling mode');
  this.samplingOverride=mode;
  for(const [id,texture] of this.textures){
   const page=this.pages.get(id)!;
   this.gl.bindTexture(this.gl.TEXTURE_2D,texture);
   this.configureFilter(page);
  }
  this.checkGL('setSamplingMode');
 }
 private configureFilter(page:AtlasPage):void{
  const gl=this.gl;
  const filter=(value:string|undefined)=>value?.toLowerCase().includes('nearest')?gl.NEAREST:gl.LINEAR;
  const min=this.samplingOverride==='atlas'?filter(page.minFilter):this.samplingOverride==='nearest'?gl.NEAREST:gl.LINEAR;
  const mag=this.samplingOverride==='atlas'?filter(page.magFilter):this.samplingOverride==='nearest'?gl.NEAREST:gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,min);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,mag);
 }
 private checkGL(operation:string):void{
  const gl=this.gl;const codes:number[]=[];for(let i=0;i<16;i++){const error=gl.getError();if(error===gl.NO_ERROR)break;codes.push(error);}
  if(codes.length)throw new EngineError('UNSUPPORTED_SEMANTIC_FEATURE',`WebGL2 ${operation} failed (${codes.map(n=>`0x${n.toString(16)}`).join(', ')})`);
 }
 constructor(canvas:HTMLCanvasElement){
  const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,antialias:true});
  if(!gl)throw new EngineError('UNSUPPORTED_SEMANTIC_FEATURE','This browser does not offer WebGL2');this.gl=gl;
  const program=gl.createProgram(),pos=gl.createBuffer(),uvs=gl.createBuffer();
  if(!program||!pos||!uvs)throw new EngineError('UNSUPPORTED_SEMANTIC_FEATURE','WebGL resource allocation failed');
  this.program=program;this.positions=pos;this.uvs=uvs;
  const vs=compile(gl,gl.VERTEX_SHADER,vertexShader),fs=compile(gl,gl.FRAGMENT_SHADER,fragmentShader);
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new EngineError('UNSUPPORTED_SEMANTIC_FEATURE',gl.getProgramInfoLog(program)??'Link failed');
  gl.deleteShader(vs);gl.deleteShader(fs);
  gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'u_texture'),0);
  gl.enable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
 }
 setPage(page:AtlasPage,image:TexImageSource):void{
  const gl=this.gl;
  const old=this.textures.get(page.id);
  const tex=gl.createTexture();if(!tex)throw new EngineError('MISSING_TEXTURE_PAGE','Cannot allocate texture');
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
  this.configureFilter(page);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,page.wrapU==='repeat'?gl.REPEAT:gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,page.wrapV==='repeat'?gl.REPEAT:gl.CLAMP_TO_EDGE);
  try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);this.checkGL(`upload ${page.id}`);}
  catch(error){gl.deleteTexture(tex);throw error;}
  if(old)gl.deleteTexture(old);
  this.pages.set(page.id,page);this.textures.set(page.id,tex);
 }
 render(packets:readonly DrawPacket[],viewport:Viewport,clear:[number,number,number,number]=[0,0,0,0]):void{
  const gl=this.gl;const canvas=gl.canvas as HTMLCanvasElement;
  requireCondition(viewport.width>0&&viewport.height>0,'INVALID_TOPOLOGY','Viewport must be positive');
  gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(...clear);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(this.program);gl.uniform4f(gl.getUniformLocation(this.program,'u_viewport'),viewport.left,viewport.bottom,viewport.width,viewport.height);
  const posIndex=gl.getAttribLocation(this.program,'a_position'),uvIndex=gl.getAttribLocation(this.program,'a_uv');
  for(const packet of packets){
   const tex=this.textures.get(packet.pageId);requireCondition(tex,'MISSING_TEXTURE_PAGE',`Texture not loaded: ${packet.pageId}`);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
   gl.uniform4fv(gl.getUniformLocation(this.program,'u_light'),packet.light);
   gl.uniform3fv(gl.getUniformLocation(this.program,'u_dark'),packet.dark??[0,0,0]);
   gl.uniform1i(gl.getUniformLocation(this.program,'u_hasDark'),packet.dark?1:0);
   gl.uniform1i(gl.getUniformLocation(this.program,'u_pma'),packet.pma?1:0);
   gl.uniform1i(gl.getUniformLocation(this.program,'u_screen'),packet.blend==='screen'?1:0);
   const source=packet.pma?gl.ONE:gl.SRC_ALPHA;
   switch(packet.blend){
    case 'normal':gl.blendFuncSeparate(source,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);break;
    case 'additive':gl.blendFuncSeparate(source,gl.ONE,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);break;
    case 'multiply':gl.blendFuncSeparate(gl.DST_COLOR,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);break;
    case 'screen':gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR,gl.ONE,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);break;
   }
   gl.bindBuffer(gl.ARRAY_BUFFER,this.positions);gl.bufferData(gl.ARRAY_BUFFER,packet.positions,gl.DYNAMIC_DRAW);
   gl.enableVertexAttribArray(posIndex);gl.vertexAttribPointer(posIndex,2,gl.FLOAT,false,0,0);
   gl.bindBuffer(gl.ARRAY_BUFFER,this.uvs);gl.bufferData(gl.ARRAY_BUFFER,packet.uvs,gl.DYNAMIC_DRAW);
   gl.enableVertexAttribArray(uvIndex);gl.vertexAttribPointer(uvIndex,2,gl.FLOAT,false,0,0);
   // The CPU packet emitter produces packed triangles in draw order.
   gl.drawArrays(gl.TRIANGLES,0,packet.positions.length/2);
  }
  this.checkGL('render');
 }
 dispose():void{
  const gl=this.gl;for(const texture of this.textures.values())gl.deleteTexture(texture);
  this.textures.clear();gl.deleteBuffer(this.positions);gl.deleteBuffer(this.uvs);gl.deleteProgram(this.program);
 }
}
