/** Numeric acceptance budget for independent Java float32 world-affine oracles.
 * Default absolute budget: 1e-4 on EVERY basis component and ordinary position.
 * Only large world-space translations (>= 256) use six float32 ULPs, to bound
 * accumulated single-precision rounding in extrapolation/matrix mixing.
 * Goldens are immutable; maximum observed deviation is reported unchanged.
 */
export function pathReferenceTolerance(expected:number,index:number):number{
 if(index!==4&&index!==5||!Number.isFinite(expected)||Math.abs(expected)<256)return 1e-4;
 const ulp=2**(Math.floor(Math.log2(Math.abs(expected)))-23);
 return Math.max(1e-4,6*ulp);
}
