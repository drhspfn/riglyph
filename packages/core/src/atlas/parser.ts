import {EngineError,requireCondition} from '../errors.js';
import type {AtlasPage,AtlasRegion,Vec2,Vec4} from '../ir/types.js';

function numbers(input:string,count:number,label:string):number[]{
 const parts=input.split(',').map(x=>Number(x.trim()));
 requireCondition(parts.length===count&&parts.every(Number.isFinite),'INVALID_ATLAS',`Invalid ${label}: ${input}`);return parts;
}
function safeRelativePath(input:string):void{
 requireCondition(input.length>0&&input.length<512&&!input.startsWith('/')&&!input.includes('\\')&&!input.split('/').includes('..')&&!/^[a-zA-Z]:/.test(input),'INVALID_ATLAS',`Unsafe atlas path: ${input}`);
}
const pick=(source:Record<string,string>,...names:string[]):string|undefined=>names.map(n=>source[n]).find(x=>x!==undefined);
const vec=(v:string|undefined,n:number,label:string,defaults:number[]):number[]=>v===undefined?defaults:numbers(v,n,label);
function flags(v:string|undefined):boolean {if(v===undefined)return false;if(v==='true')return true;if(v==='false')return false;throw new EngineError('INVALID_ATLAS',`Invalid boolean: ${v}`);}
function degrees(value:string|undefined):0|90|180|270{
 if(value==='true')return 90;if(value==='false'||value===undefined)return 0;
 const n=Number(value);requireCondition([0,90,180,270].includes(n),'INVALID_ATLAS',`Invalid packing angle ${value}`);return n as 0|90|180|270;
}
/** Parses legacy and comma-packed atlas metadata without silently fabricating missing region dimensions. */
export function parseAtlas(text:string):{pages:AtlasPage[];regions:AtlasRegion[]}{
 requireCondition(text.length<=16_000_000,'LIMIT_EXCEEDED','Atlas text too large');
 const pages:AtlasPage[]=[],regions:AtlasRegion[]=[];
 type RecordEntry={name:string;data:Record<string,string>};
 let page:RecordEntry|null=null,region:RecordEntry|null=null,sectionHasBlank=true;
 const commitRegion=()=>{
  if(!region)return;
  requireCondition(page!==null,'INVALID_ATLAS',`Region without page: ${region.name}`);
  const r=region;region=null;
  const bounds=pick(r.data,'bounds')?vec(r.data['bounds'],4,'bounds',[0,0,0,0]):[
   ...vec(pick(r.data,'xy'),2,'xy',[0,0]),...vec(pick(r.data,'size'),2,'size',[0,0])];
  requireCondition(bounds[2]!>0&&bounds[3]!>0,'INVALID_ATLAS',`Region ${r.name}: missing valid size`);
  const offsets=pick(r.data,'offsets');
  const [ox,oy,ow,oh]=offsets?numbers(offsets,4,'offsets'):[...vec(pick(r.data,'offset'),2,'offset',[0,0]),...vec(pick(r.data,'orig'),2,'orig',[bounds[2]!,bounds[3]!])];
  const sequenceIndex=pick(r.data,'index');
  const id=`region${regions.length}`;
  regions.push({id,name:r.name,pageId:`page${pages.length}`,bounds:bounds as Vec4,originalSize:[ow!,oh!] as Vec2,offset:[ox!,oy!] as Vec2,rotationDeg:degrees(r.data['rotate']),...(sequenceIndex===undefined?{}:{sequenceIndex:Number(sequenceIndex)})});
 };
 const commitPage=()=>{
  if(!page)return;commitRegion();
  const p=page;page=null;const size=vec(pick(p.data,'size'),2,'page size',[-1,-1]);
  requireCondition(size[0]!>0&&size[1]!>0&&size.every(Number.isSafeInteger),'INVALID_ATLAS',`Page ${p.name}: dimensions absent or invalid`);
  safeRelativePath(p.name);
  const scale=Number(pick(p.data,'scale')??'1');requireCondition(scale>0&&Number.isFinite(scale),'INVALID_ATLAS','Invalid page scale');
  const filters=(pick(p.data,'filter')??'Linear,Linear').split(',').map(s=>s.trim());
  const repeat=pick(p.data,'repeat')??'none';
  pages.push({id:`page${pages.length}`,path:p.name,width:size[0]!,height:size[1]!,pma:flags(p.data['pma']),scale,minFilter:filters[0]??'Linear',magFilter:filters[1]??filters[0]??'Linear',wrapU:repeat==='x'||repeat==='xy'?'repeat':'clamp',wrapV:repeat==='y'||repeat==='xy'?'repeat':'clamp'});
 };
 for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=raw.trim();if(!line){sectionHasBlank=true;continue;}
  const colon=line.indexOf(':');
  if(colon>0&&/^[a-zA-Z]+$/.test(line.slice(0,colon))){
   const key=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim();
   requireCondition(page!==null,'INVALID_ATLAS',`Metadata before first page: ${line}`);
   (region?.data??page.data)[key]=value;
   sectionHasBlank=false;continue;
  }
  // An empty line after a region precedes the next page; otherwise a bare line opens a new region.
  if(page===null||sectionHasBlank&&region!==null||sectionHasBlank&&page!==null&&!region){commitPage();page={name:line,data:{}};}
  else {commitRegion();region={name:line,data:{}};}
  sectionHasBlank=false;
 }
 commitPage();
 // Page IDs were assigned using pages.length *before* each page was committed.
 // Correct the page ownership after parsing in case a page had many regions.
 // region pageId already points at the forthcoming page index at commit time.
 for(const r of regions){const p=pages.find(p=>p.id===r.pageId);requireCondition(p,'INVALID_ATLAS','Region refers to unknown page');
  const [x,y,w,h]=r.bounds,tw=r.rotationDeg%180===0?w:h,th=r.rotationDeg%180===0?h:w;
  requireCondition(x>=0&&y>=0&&x+tw<=p.width+.01&&y+th<=p.height+.01,'INVALID_ATLAS',`Region outside page: ${r.name}`);
  requireCondition(r.originalSize[0]>0&&r.originalSize[1]>0,'INVALID_ATLAS',`Region original size invalid: ${r.name}`);
 }
 return {pages,regions};
}
/** Safe header-only image check; never executes an image decoder. */
export function pngDimensions(bytes:Uint8Array):Vec2{
 const signature=[137,80,78,71,13,10,26,10];
 requireCondition(bytes.length>=24&&signature.every((b,i)=>bytes[i]===b),'INVALID_ATLAS','Expected PNG IHDR');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 requireCondition(view.getUint32(8)===13&&bytes[12]===73&&bytes[13]===72&&bytes[14]===68&&bytes[15]===82,'INVALID_ATLAS','Invalid PNG IHDR');
 const w=view.getUint32(16),h=view.getUint32(20);
 requireCondition(w>0&&h>0&&w<=16384&&h<=16384,'LIMIT_EXCEEDED','PNG dimensions out of range');return [w,h];
}
export function checkAtlasImages(atlas:ReturnType<typeof parseAtlas>,files:Record<string,Uint8Array>):void{
 for(const p of atlas.pages){const bytes=files[p.path];requireCondition(bytes,'MISSING_TEXTURE_PAGE',`Missing texture ${p.path}`);const [w,h]=pngDimensions(bytes);
  requireCondition(w===p.width&&h===p.height,'INVALID_ATLAS',`PNG ${p.path}: ${w}x${h} but atlas declares ${p.width}x${p.height}`);}
}
