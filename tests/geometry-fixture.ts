import {validateIR} from '@riglyph/core';
import {fixture,addSlot,addAttachment,addBone} from './helpers.js';
export function dynamicClipFixture(){
 const ir=fixture();addBone(ir,'mask');
 const region=ir.skeleton.attachments[0]!;if(region.kind==='region'){region.width=20;region.height=20;}
 ir.skeleton.slots[0]!.drawIndex=1;
 const slot=addSlot(ir,'clip','root','mask');slot.drawIndex=0;
 addAttachment(ir,{id:'mask',name:'mask',kind:'clipping',color:[1,1,1,1],endSlotId:ir.skeleton.slots[0]!.id,
  vertices:[[-8,-8],[8,-8],[8,8],[-8,8]].map(([x,y])=>({position:null,influences:[{boneId:'mask',x:x!,y:y!,weight:1}]}))},'clip','mask');
 ir.skeleton.animations=[{id:'dynamic',name:'dynamic',durationSec:1,timelines:[{targetKind:'attachment',targetId:'mask',property:'deform',deformBasis:'influence_delta',keys:[
  {timeSec:0,value:[0,0,0,0,0,0,0,0],interpolation:{kind:'linear'}},
  {timeSec:.47,value:[0,0,0,16,-16,0,16,-16],interpolation:{kind:'linear'}},
  {timeSec:1,value:[0,0,0,0,0,0,0,0],interpolation:{kind:'linear'}}]}]}];
 validateIR(ir);return ir;
}
