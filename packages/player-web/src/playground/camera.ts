import {requireCondition} from '@riglyph/core';
import type {Viewport} from '@riglyph/renderer-webgl2';
export type CameraMode='fit-scene'|'fit-selection'|'fixed';
export type Bounds=[number,number,number,number];
/** Camera-space only: never changes skeleton world matrices or draw packets. */
export function fitBounds(bounds:Bounds,width:number,height:number,pad=1.25):Viewport{
 requireCondition(width>0&&height>0&&Number.isFinite(width*height)&&Number.isFinite(pad)&&pad>0&&bounds.every(Number.isFinite),
  'INVALID_TOPOLOGY','Invalid fit camera dimensions');
 const w=Math.max(bounds[2],.25),h=Math.max(bounds[3],.25);
 requireCondition(w>0&&h>0,'INVALID_TOPOLOGY','Invalid bounds for camera fit');
 const unitsPerPixel=Math.max(w/width,h/height)*pad;
 const viewW=width*unitsPerPixel,viewH=height*unitsPerPixel;
 return {left:bounds[0]+(w-viewW)/2,bottom:bounds[1]+(h-viewH)/2,width:viewW,height:viewH};
}
export function screenToWorld(view:Viewport,pixelX:number,pixelY:number,width:number,height:number):[number,number]{
 requireCondition(width>0&&height>0,'INVALID_TOPOLOGY','Invalid camera screen dimensions');
 return [view.left+pixelX/width*view.width,view.bottom+(1-pixelY/height)*view.height];
}
export function panPixels(view:Viewport,dx:number,dy:number,width:number,height:number):Viewport{
 requireCondition(width>0&&height>0&&Number.isFinite(dx)&&Number.isFinite(dy),'INVALID_TOPOLOGY','Invalid camera pan');
 return {...view,left:view.left-dx/width*view.width,bottom:view.bottom+dy/height*view.height};
}
export function zoomAt(view:Viewport,factor:number,pixelX:number,pixelY:number,width:number,height:number):Viewport{
 requireCondition(Number.isFinite(factor)&&factor>0&&width>0&&height>0,'INVALID_TOPOLOGY','Invalid camera zoom');
 const [anchorX,anchorY]=screenToWorld(view,pixelX,pixelY,width,height);
 const unitsPerPixel=Math.max(1e-5,Math.min(1e8,view.width/width*factor));
 const nextW=width*unitsPerPixel,nextH=height*unitsPerPixel;
 return {left:anchorX-pixelX/width*nextW,bottom:anchorY-(1-pixelY/height)*nextH,width:nextW,height:nextH};
}
