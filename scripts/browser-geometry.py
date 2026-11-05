#!/usr/bin/env python3
"""Full self-authored deform/clipping sequence, actual WebGL2 vs JS pixels."""
import json
import os
from pathlib import Path
import shutil
import subprocess

from playwright.sync_api import sync_playwright
from browser_importmap import map_modules

root = Path(__file__).resolve().parent.parent
artifacts = root / 'test-output' / 'geometry-browser'
artifacts.mkdir(parents=True, exist_ok=True)
ir = json.loads(subprocess.run(
    ['node', '--input-type=module', '-e',
     "import {dynamicClipFixture} from './dist/tests/geometry-fixture.js'; console.log(JSON.stringify(dynamicClipFixture()));"],
    cwd=root, check=True, capture_output=True, text=True).stdout)
modules = map_modules(root, ['core', 'runtime', 'renderer-webgl2', 'renderer-cpu'])
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
        headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    try:
        page.set_content('<script type="importmap">' + json.dumps({'imports': modules}) + '</script><canvas width="48" height="48"></canvas>')
        result = page.evaluate('''async ir=>{
          const {SkeletonInstance}=await import('universal/runtime/index.js');
          const {WebGL2Renderer,prepareDrawPackets}=await import('universal/renderer-webgl2/index.js');
          const {rasterize}=await import('universal/renderer-cpu/index.js');
          const canvas=document.querySelector('canvas');
          const gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false});
          if(!gl)throw Error('WebGL2 unavailable');
          const renderer=new WebGL2Renderer(canvas);
          const texture=document.createElement('canvas');texture.width=texture.height=2;
          const ctx=texture.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,2,2);
          renderer.setPage(ir.atlases.pages[0],texture);
          const textures=new Map([['page0',{width:2,height:2,rgba:new Uint8Array(16).fill(255),premultiplied:false}]]);
          const viewport={left:-12,bottom:-12,width:24,height:24};
          const skeleton=new SkeletonInstance(ir),frames=[],warnings=[];
          for(let frame=0;frame<12;frame++){
            skeleton.evaluate([{clipId:'dynamic',timeSec:frame/12}]);
            const packets=prepareDrawPackets(skeleton,{clippingPolicy:'compatible',onGeometryWarning:w=>warnings.push(w)});
            const cpu=rasterize(packets,textures,viewport,48,48,[0,0,0,0]);
            renderer.render(packets,viewport);
            const gpu=new Uint8Array(48*48*4);gl.readPixels(0,0,48,48,gl.RGBA,gl.UNSIGNED_BYTE,gpu);
            if(gl.getError()!==gl.NO_ERROR)throw Error('GL capture failed');
            let error=0,visible=0;
            for(let y=0;y<48;y++)for(let x=0;x<48;x++){
              const i=(y*48+x)*4,j=((47-y)*48+x)*4;
              if(gpu[j+3])visible++;
              for(let c=0;c<4;c++)error+=Math.abs(cpu[i+c]-gpu[j+c]);
            }
            const mean=error/gpu.length;
            frames.push({frame,visible,mean,packets:packets.length});
            if(!visible||mean>1)throw Error(JSON.stringify(frames));
          }
          renderer.dispose();return {frames,warnings:warnings.length};
        }''', ir)
        if errors:
            raise RuntimeError(errors)
        if len(result['frames']) != 12 or not result['warnings']:
            raise RuntimeError(result)
        (artifacts / 'result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result))
    except Exception as error:
        page.screenshot(path=str(artifacts / 'failure.png'))
        (artifacts / 'failure.json').write_text(json.dumps({'error': str(error), 'console': errors}))
        raise
    finally:
        browser.close()
