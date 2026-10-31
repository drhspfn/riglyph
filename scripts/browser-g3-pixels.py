#!/usr/bin/env python3
"""G3 actual Chromium WebGL2 readPixels against software rasterizer (synthetic only).

No external networking. Optional dev dependencies: Python playwright + Chromium.
Linux: xvfb-run -a python scripts/browser-g3-pixels.py
"""
import base64, json, os, shutil, subprocess, sys
from pathlib import Path

from browser_importmap import map_modules
root=Path(__file__).resolve().parent.parent
modules=map_modules(root,['core','runtime','renderer-webgl2','renderer-cpu'])
gpu='universal/renderer-webgl2/index.js'
cpu='universal/renderer-cpu/index.js'

def png(pixels):
 script='import{encodePNG}from "./dist/src/cli/png.js";process.stdout.write(encodePNG(4,4,Uint8Array.from(JSON.parse(process.argv[1]))).toString("base64"));'
 return subprocess.run(['node','--input-type=module','-e',script,json.dumps(pixels)],cwd=root,text=True,capture_output=True,check=True).stdout

def texture(rgba):return list(rgba)*16
corner=[]
for y in range(4):
 for x in range(4):corner.extend([[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]][(y//2)*2+x//2])
trim=[]
for y in range(4):
 for x in range(4):trim.extend([200,50,10,255] if 1<=x<=2 and 1<=y<=2 else [0,0,0,0])
textures={'corners':corner,'background':texture([0,100,255,255]),'overlay':texture([255,0,0,128]),'trim':trim}
pngs={k:png(v) for k,v in textures.items()}
ir64=base64.b64encode((root/'fixtures/minimal.json').read_bytes()).decode()
try:from playwright.sync_api import sync_playwright
except ImportError:raise SystemExit('UNVERIFIED: optional playwright not installed')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=False,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
 try:
  page=browser.new_page();page.set_content('<html><head><script type="importmap">'+json.dumps({'imports':modules})+'</script></head><body>G3 authored pixel parity</body></html>')
  out=page.evaluate('''async ({gpuModule,cpuModule,textures,pngs,ir64})=>{
   const {WebGL2Renderer,prepareDrawPackets}=await import(gpuModule),{rasterize}=await import(cpuModule);
   const {SkeletonInstance}=await import('universal/runtime/index.js');
   const {validateIR}=await import('universal/core/index.js');
   const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;document.body.appendChild(canvas);
   const rend=new WebGL2Renderer(canvas),gl=canvas.getContext('webgl2');
   const pages={};
   for(const name of Object.keys(textures))for(const pma of [false,true]){
    if(pma&&name!=='overlay')continue;
    const id=name+(pma?'-pma':'');
    const f=new File([Uint8Array.from(atob(pngs[name]),c=>c.charCodeAt(0))],id+'.png',{type:'image/png'});
    const bitmap=await createImageBitmap(f,{imageOrientation:'none',premultiplyAlpha:pma?'premultiply':'none',colorSpaceConversion:'none'});
    rend.setPage({id,path:id+'.png',width:4,height:4,pma,scale:1,minFilter:'nearest',magFilter:'nearest'},bitmap);
    bitmap.close();
    const data=new Uint8Array(textures[name]);
    if(pma){for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=Math.round(data[i+c]*data[i+3]/255);}
    pages[id]={width:4,height:4,rgba:data,premultiplied:pma};
   }
   const position=[0,0,4,0,4,4,0,0,4,4,0,4];
   const uv=[0,1,1,1,1,0,0,1,1,0,0,0];
   const make=(id,blend='normal',light=[1,1,1,1],dark=null,uvs=uv,positions=position)=>({
     slotId:'s',attachmentId:'a',pageId:id,blend,pma:pages[id].premultiplied,positions:new Float32Array(positions),
     uvs:new Float32Array(uvs),indices:new Uint32Array([0,1,2,3,4,5]),light,dark
   });
   const view={left:0,bottom:0,width:4,height:4},texmap=new Map(Object.entries(pages));
   const patterns=[
     {name:'opaque-corners',packets:[make('corners')]},
     {name:'rotation-90-clockwise',packets:[make('corners','normal',[1,1,1,1],null,[0,0,0,1,1,1,0,0,1,1,1,0])]},
     {name:'rotation-180',packets:[make('corners','normal',[1,1,1,1],null,[1,0,0,0,0,1,1,0,0,1,1,1])]},
     {name:'rotation-270',packets:[make('corners','normal',[1,1,1,1],null,[1,1,1,0,0,0,1,1,0,0,0,1])]},
     {name:'trimmed-asymmetric-alpha',packets:[make('trim')]},
     {name:'normal-half-alpha-over-opaque',packets:[make('background'),make('overlay')]},
     {name:'additive-half-alpha-over-opaque',packets:[make('background'),make('overlay','additive')]},
     {name:'multiply-half-alpha-over-opaque',packets:[make('background'),make('overlay','multiply')]},
     {name:'screen-half-alpha-over-opaque',packets:[make('background'),make('overlay','screen')]},
     {name:'PMA-normal-half-alpha-over-opaque',packets:[make('background'),make('overlay-pma')]},
     {name:'two-color-dark-tint',packets:[make('background'),make('overlay','normal',[.9,.7,.6,.9],[.1,.15,.2])]},
     {name:'linear-corners-subtexel',sampling:'linear',packets:[make('corners','normal',[1,1,1,1],null,
       [.125,.875,.875,.875,.875,.125,.125,.875,.875,.125,.125,.125])]},
     {name:'linear-pma-over-background',sampling:'linear',packets:[make('background'),make('overlay-pma','normal',[1,1,1,.75])]},
     {name:'pma-two-color-half-alpha',sampling:'nearest',packets:[make('background'),make('overlay-pma','normal',[.9,.7,.6,.8],[.1,.2,.3])]},
   ];
   // Exercise the REAL version-neutral draw-packet generator in Chromium with a
   // synthetic original-image UV mesh, self-ending clip and 4 packed rotations.
   const trimCases=[];
   for(const rotationDeg of [0,90,180,270]){
    const ir=JSON.parse(atob(ir64));
    ir.atlases.pages[0].id='corners';ir.atlases.pages[0].width=4;ir.atlases.pages[0].height=4;
    const region=ir.atlases.regions[0];region.pageId='corners';region.bounds=[0,0,4,4];
    region.originalSize=[8,8];region.offset=[2,2];region.rotationDeg=rotationDeg;
    ir.capabilities=['mesh','clipping'];
    const vertex=(x,y)=>({position:[x,y],influences:[]});
    ir.skeleton.attachments=[
     {id:'clip',name:'clip',kind:'clipping',color:[1,1,1,1],endSlotId:'slot0',vertices:[vertex(1,1),vertex(3,1),vertex(3,3),vertex(1,3)]},
     {id:'mesh',name:'mesh',kind:'mesh',regionId:region.id,color:[1,1,1,1],sequence:null,hullVertexCount:4,
      uvs:[.25,.25,.75,.25,.75,.75,.25,.75],triangles:[0,1,2,0,2,3],vertices:[vertex(0,0),vertex(4,0),vertex(4,4),vertex(0,4)]}
    ];
    ir.skeleton.slots[0].setupAttachmentId='clip';
    ir.skeleton.slots.push({id:'meshslot',boneId:'root',drawIndex:1,blend:'normal',light:[1,1,1,1],dark:null,setupAttachmentId:'mesh'});
    ir.skeleton.skins[0].attachments=[{slotId:'slot0',key:'clip',attachmentId:'clip'},{slotId:'meshslot',key:'mesh',attachmentId:'mesh'}];
    validateIR(ir);
    const packets=prepareDrawPackets(new SkeletonInstance(ir));
    if(packets.length!==1||packets[0].positions.some(v=>!Number.isFinite(v)))throw Error('G8.1 draw packets invalid');
    trimCases.push({name:'G81-trimmed-mesh-self-end-'+rotationDeg,packets});
   }
   patterns.push(...trimCases);
   // A18: two texture pages and independently rotated original-image UV meshes.
   // This compares real GPU pixels against the software renderer, not against Spine.
   const first90=trimCases.find(c=>c.name.endsWith('-90')).packets[0];
   const second270=trimCases.find(c=>c.name.endsWith('-270')).packets[0];
   patterns.push({name:'A18-multipage-quarterturn-mesh',packets:[first90,{
     ...second270,pageId:'background',
     positions:Float32Array.from(second270.positions,(v,i)=>i%2===0?v+2:v)
   }]});
   const result=[];
   for(const pattern of patterns){
    rend.setSamplingMode(pattern.sampling??'nearest');
    rend.render(pattern.packets,view);const e1=gl.getError();
    const read=new Uint8Array(4*4*4);gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,read);
    const e2=gl.getError(),gpu=[];
    for(let y=0;y<4;y++)for(let x=0;x<4;x++){const i=((3-y)*4+x)*4;gpu.push(...read.slice(i,i+4));}
    const cpu=[...rasterize(pattern.packets,texmap,view,4,4,[0,0,0,0],{sampling:pattern.sampling??'nearest'})];
    let max=0,channels=0,alphaCoverageCPU=0,alphaCoverageGPU=0;
    for(let i=0;i<gpu.length;i++){if(i%4===3){if(cpu[i]>12)alphaCoverageCPU++;if(gpu[i]>12)alphaCoverageGPU++;}
       const delta=Math.abs(cpu[i]-gpu[i]);max=Math.max(delta,max);if(delta>2)channels++;}
    result.push({name:pattern.name,sampling:pattern.sampling??'nearest',maxAbsDelta:max,channelsOver2:channels,alphaCoverageCPU,alphaCoverageGPU,glErrors:[e1,e2],centerRGBA:{CPU:cpu.slice(2*4*4+2*4,2*4*4+2*4+4),GPU:gpu.slice(2*4*4+2*4,2*4*4+2*4+4)}});
   }
   const info=gl.getExtension('WEBGL_debug_renderer_info');
   const conditions={backend:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
    browser:navigator.userAgent,dpr:devicePixelRatio,viewport:[4,4],colorSpaceConversion:'none',
    imageBitmapPremultiplyAlpha:'per-page-pma',format:'RGBA8',antialias:true,sampling:['nearest','linear']};
   rend.dispose();return {cases:result,conditions};
  }''', {'gpuModule':gpu,'cpuModule':cpu,'textures':textures,'pngs':pngs,'ir64':ir64})
 finally:browser.close()
report={'schema':'agent-b-g3-cpu-gpu-synthetic-v1','source':'self-authored PNGs; real Chromium WebGL2 readPixels', 'officialReferenceVerified':False,'cases':out['cases'],'conditions':out['conditions']}
path=root/'examples/g3-pixel-parity.json';path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
# Actual comparison: nonedge samples and fully opaque overlays are exact or +/-2.
# Do not silently claim reference parity from own two renderers.
sys.exit(2 if any(c['channelsOver2'] or any(c['glErrors']) for c in out['cases']) else 0)
