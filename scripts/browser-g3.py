#!/usr/bin/env python3
"""Actual WebGL2/CPU framebuffer parity test for independently authored PNGs.

Optional Python dependency: playwright. On headless Linux use e.g.:
    xvfb-run -a python scripts/browser-g3.py
Requires compiled dist/ and an installed Chromium browser. Does not open external URLs.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import sys


def data_module(source: str) -> str:
    return 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('google-chrome'))
    parser.add_argument('--dist', default='dist/src')
    parser.add_argument('--out', default='examples/g3-webgl-synthetic.png')
    parser.add_argument('--report', default='examples/g3-browser-report.json')
    args = parser.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise SystemExit('UNVERIFIED: install optional Python playwright dependency to run actual browser test') from e
    root = Path(__file__).resolve().parent.parent
    dist = (root / args.dist).resolve()
    from browser_importmap import map_modules
    modules=map_modules(root,['core','runtime','renderer-webgl2','renderer-cpu'])
    render_url,software_url='universal/renderer-webgl2/index.js','universal/renderer-cpu/index.js'
    if not args.chromium:
        raise SystemExit('UNVERIFIED: Chromium is not installed; use --chromium /path/to/chrome')
    # Four different opaque corner quadrants, 4x4 RGBA, independent of game assets.
    pixels = []
    colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]]
    for y in range(4):
        for x in range(4):
            pixels.extend(colors[(y // 2) * 2 + (x // 2)])
    from subprocess import run
    # Use the repository's self-authored PNG encoder, not a third-party codec.
    script = 'import{encodePNG}from "./dist/src/cli/png.js";process.stdout.write(encodePNG(4,4,new Uint8Array(JSON.parse(process.argv[1]))).toString("base64"));'
    proc = run(['node', '--input-type=module', '-e', script, json.dumps(pixels)], cwd=root,
               check=True, capture_output=True, text=True)
    png64 = proc.stdout.strip()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium, headless=False,
                                    args=['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
                                          '--use-gl=angle', '--use-angle=swiftshader'])
        try:
            page = browser.new_page(viewport={'width': 900, 'height': 750})
            page.set_content('<!doctype html><html><head><script type="importmap">'+json.dumps({'imports':modules})+'</script></head><body><h1>G3 synthetic WebGL2 parity</h1></body></html>')
            result = page.evaluate('''async ({rendererUrl,softwareUrl,png64,pixels})=>{
              const {WebGL2Renderer}=await import(rendererUrl);
              const {rasterize}=await import(softwareUrl);
              const bytes=Uint8Array.from(atob(png64),s=>s.charCodeAt(0));
              const file=new File([bytes],'authored-four-corners.png',{type:'image/png'});
              const bitmap=await createImageBitmap(file,{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
              const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
              canvas.style.cssText='width:400px;height:400px;image-rendering:pixelated';
              document.body.append(canvas);
              const renderer=new WebGL2Renderer(canvas);
              const gl=canvas.getContext('webgl2');
              if(!gl)throw new Error('WebGL2 unavailable');
              const page={id:'p',path:'authored-four-corners.png',width:4,height:4,scale:1,pma:false,minFilter:'nearest',magFilter:'nearest'};
              renderer.setPage(page,bitmap);bitmap.close();
              const positions=new Float32Array([0,0,4,0,4,4,0,0,4,4,0,4]);
              const uvs=new Float32Array([0,1,1,1,1,0,0,1,1,0,0,0]);
              const packet={slotId:'s',attachmentId:'a',pageId:'p',positions,uvs,
                indices:new Uint32Array([0,1,2,3,4,5]),blend:'normal',pma:false,light:[1,1,1,1],dark:null};
              const view={left:0,bottom:0,width:4,height:4};
              renderer.render([packet],view);
              const glErr=gl.getError(),raw=new Uint8Array(4*4*4);
              gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,raw);
              const glReadError=gl.getError();
              const gpu=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++){
                const i=((3-y)*4+x)*4;gpu.push(...raw.slice(i,i+4));
              }
              const cpu=[...rasterize([packet],new Map([['p',{width:4,height:4,rgba:new Uint8Array(pixels),premultiplied:false}]]),view,4,4)];
              const mismatches=[];let maxAbsoluteDelta=0;
              for(let i=0;i<gpu.length;i++){const d=Math.abs(gpu[i]-cpu[i]);if(d)mismatches.push({channel:i,CPU:cpu[i],GPU:gpu[i]});maxAbsoluteDelta=Math.max(maxAbsoluteDelta,d);}
              const corner=(arr,x,y)=>arr.slice((y*4+x)*4,(y*4+x)*4+4);
              renderer.dispose();
              const info=gl.getExtension('WEBGL_debug_renderer_info');
              return {backend:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:gl.getParameter(gl.VENDOR),
                imageBitmapSize:[4,4],webglError:glErr,readPixelsError:glReadError,
                CPUCorners:[corner(cpu,0,0),corner(cpu,3,0),corner(cpu,0,3),corner(cpu,3,3)],
                GPUCorners:[corner(gpu,0,0),corner(gpu,3,0),corner(gpu,0,3),corner(gpu,3,3)],
                mismatchingChannels:mismatches.length,maxAbsoluteDelta,
                cpu,gpu};
            }''', {'rendererUrl': render_url,'softwareUrl': software_url,'png64': png64,'pixels':pixels})
        finally:
            browser.close()
    from PIL import Image
    img = Image.frombytes('RGBA', (4,4), bytes(result.pop('gpu')))
    result.pop('cpu')
    dest = root / args.out
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.resize((400,400),Image.Resampling.NEAREST).save(dest)
    report = root / args.report
    report.parent.mkdir(parents=True, exist_ok=True)
    result.update({'source':'self-authored synthetic PNG; actual Chromium WebGL2 readPixels',
                   'referenceVerified':False,'screenshot':str(Path(args.out))})
    report.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
    if result['mismatchingChannels'] or result['webglError'] or result['readPixelsError']:
        return 2
    return 0


if __name__=='__main__':
    sys.exit(main())
