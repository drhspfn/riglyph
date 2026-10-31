export const G8_TEXTURE_LIMITS:Readonly<{maxWidth:number;maxHeight:number;maxPixelsPerPage:number;maxCompressedBytesPerPage:number;maxDecodedBytesTotal:number;maxPages:number;maxFramePixels:number;maxPeakWorkingBytes:number}>;
export type PNGPreflight={width:number;height:number;decodedBytes:number;scanlineBytes:number;compressedBytes:number};
export function preflightPNG(path:string):PNGPreflight;
export function checkAggregateTextures(headers:Array<Pick<PNGPreflight,"decodedBytes"|"compressedBytes">>):{decodedBytesTotal:number;peakWorkingBytesBudget:number};
export function decodePNGStreaming(bytes:Uint8Array,header:PNGPreflight):Promise<{width:number;height:number;rgba:Buffer}>;
export function loadPNGBounded(path:string,header:PNGPreflight):Promise<{width:number;height:number;rgba:Buffer;sha256:string}>;
