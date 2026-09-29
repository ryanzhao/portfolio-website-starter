import test from 'node:test';
import assert from 'node:assert/strict';
import {calibratedCadAsset,cadMaterialColour} from '../src/lib/cad-appearance.ts';
test('assembly palette is scoped, stable and retains alpha',()=>{
 assert.equal(cadMaterialColour('another-asset','FF1F2120',1),null);
 assert.equal(cadMaterialColour(calibratedCadAsset,'unknown',1),null);
 const black=cadMaterialColour(calibratedCadAsset,'FF1F2120',0.6);
 assert.ok(black[0]<0.02);assert.equal(black[3],0.6);
 assert.deepEqual(cadMaterialColour(calibratedCadAsset,'FF1F2120',0.6),black);
 const red=cadMaterialColour(calibratedCadAsset,'FF0000FF',1);
 assert.deepEqual(red,[1,0,0,1]);
 const chamber=cadMaterialColour(calibratedCadAsset,'FFAEC6D3',1);
 assert.ok(chamber[0]>chamber[1]&&chamber[1]>chamber[2]);
});
