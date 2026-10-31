import test from 'node:test';import assert from 'node:assert/strict';
import {parseAtlas,pngDimensions,checkAtlasImages} from '../src/atlas/parser.js';
import {atlasUV} from '../src/render/packets.js';
import {EngineError} from '../src/errors.js';
const sample=`demo.png
size: 8, 16
format: RGBA8888
filter: Linear, Nearest
repeat: none
pma: false
scale: 0.92
first
rotate: 90
xy: 1, 2
size: 3, 2
orig: 8, 6
offset: 1, 3
index: -1
second
rotate: 180
bounds: 0, 8, 2, 3
offsets: 0, 1, 4, 5

page-two.png
size: 4,4
filter: Nearest,Nearest
third
rotate: 270
bounds: 0, 0, 2, 3
orig: 2,3
`;
test('atlas parses pages, 3 rotations, trimming, explicit scale, PMA',()=>{
 const a=parseAtlas(sample);assert.equal(a.pages.length,2);assert.equal(a.regions.length,3);
 assert.equal(a.pages[0]!.scale,.92);assert.equal(a.pages[0]!.magFilter,'Nearest');
 assert.equal(a.regions[0]!.rotationDeg,90);assert.deepEqual(a.regions[0]!.offset,[1,3]);
 assert.deepEqual(a.regions[1]!.originalSize,[4,5]);assert.equal(a.regions[2]!.pageId,'page1');
});
test('atlas UV 0, 90, 180, 270 unit transforms independently',()=>{
 const a=parseAtlas(sample);const r=a.regions[0]!,p=a.pages[0]!;
 assert.deepEqual(atlasUV({...r,rotationDeg:0},p,0,0),[1/8,2/16]);
 assert.deepEqual(atlasUV(r,p,0,0),[1/8,(2+3)/16]);
 assert.deepEqual(atlasUV({...r,rotationDeg:180},p,0,0),[(1+3)/8,(2+2)/16]);
 assert.deepEqual(atlasUV({...r,rotationDeg:270},p,0,0),[(1+2)/8,2/16]);
});
test('atlas rejects malformed page path, regions out of bounds and invalid rotations',()=>{
 assert.throws(()=>parseAtlas(sample.replace('demo.png','../bad.png')),EngineError);
 assert.throws(()=>parseAtlas(sample.replace('xy: 1, 2','xy: 7, 14')),EngineError);
 assert.throws(()=>parseAtlas(sample.replace('rotate: 90','rotate: 15')),EngineError);
});
test('PNG dimensions and declared page resource checks',()=>{
 const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
 const dv=new DataView(png.buffer);dv.setUint32(16,8);dv.setUint32(20,16);
 assert.deepEqual(pngDimensions(png),[8,16]);
 const atlas=parseAtlas(sample);assert.throws(()=>checkAtlasImages(atlas,{'demo.png':png}),e=>e instanceof EngineError&&e.code==='MISSING_TEXTURE_PAGE');
 const png2=png.slice();new DataView(png2.buffer).setUint32(16,4);new DataView(png2.buffer).setUint32(20,4);
 checkAtlasImages(atlas,{'demo.png':png,'page-two.png':png2});
});
