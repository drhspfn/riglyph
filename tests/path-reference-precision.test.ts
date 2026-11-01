import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathReferenceTolerance} from './path-reference-precision.js';

test('large-reference rounding allowance applies only to world translations',()=>{
 assert.equal(pathReferenceTolerance(1200,0),1e-4);
 assert.equal(pathReferenceTolerance(255.99,4),1e-4);
 assert.equal(pathReferenceTolerance(-200,5),1e-4);
 assert.equal(pathReferenceTolerance(800,4),6*2**(-14));
 assert.equal(pathReferenceTolerance(-450,5),6*2**(-15));
});
