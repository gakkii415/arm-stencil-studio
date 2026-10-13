import test from 'node:test';
import assert from 'node:assert/strict';
import { withJpegDensity } from '../src/jpeg.js';

test('sets JFIF print density while preserving compressed image bytes', () => {
  const jpeg = new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,255,218,0,2,12,34,56,255,217]);
  const result = withJpegDensity(jpeg, 150);
  assert.equal(result[13], 1); // unit: dots per inch
  assert.equal(result[14] * 256 + result[15], 150);
  assert.equal(result[16] * 256 + result[17], 150);
  assert.deepEqual(result.subarray(20), jpeg.subarray(20));
  assert.equal(jpeg[13], 0); // original is immutable
});

test('inserts standards-compliant JFIF metadata if the browser omits it', () => {
  const jpeg = new Uint8Array([255,216,255,219,0,4,7,8,255,218,0,2,9,10,255,217]);
  const result = withJpegDensity(jpeg, 150);
  assert.deepEqual(Array.from(result.subarray(6,11)), [74,70,73,70,0]);
  assert.equal(result[13], 1);
  assert.deepEqual(result.subarray(20), jpeg.subarray(2));
  assert.throws(() => withJpegDensity(new Uint8Array([0,1])), /JPG/);
});
