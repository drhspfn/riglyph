import type {Spine41Wire} from '../src/adapters/spine41-wire.js';
import type {IRDocument} from '../src/ir/types.js';
export type SemanticCoverage={
 expectedTimelines:number;actualTimelines:number;expectedKeys:number;actualKeys:number;
 perClip:{index:number;expectedTimelines:number;actualTimelines:number;expectedKeys:number;actualKeys:number;recordMatches:number;curveMatches:number;matched:boolean}[];
 issues:{code:string;clipIndex:number}[];
};
export function assessSemanticCoverage(wire:Spine41Wire,ir:IRDocument):SemanticCoverage;
