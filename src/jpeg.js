// Browsers usually export a JFIF density of 1 with no unit. Add a real print
// density without recompressing the image, so printing tools can use mm sizes.
export function withJpegDensity(bytes, dpi = 150) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPGを書き出せませんでした。');
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 65535) throw new RangeError('Invalid DPI.');
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes[offset + 2] * 256 + bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 0xe0 && length >= 16 && bytes[offset + 4] === 0x4a && bytes[offset + 5] === 0x46 && bytes[offset + 6] === 0x49 && bytes[offset + 7] === 0x46 && bytes[offset + 8] === 0) {
      const result = bytes.slice();
      result[offset + 11] = 1;
      result[offset + 12] = dpi >> 8; result[offset + 13] = dpi & 255;
      result[offset + 14] = dpi >> 8; result[offset + 15] = dpi & 255;
      return result;
    }
    offset += 2 + length;
  }
  const header = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
  const result = new Uint8Array(bytes.length + header.length);
  result.set(bytes.subarray(0, 2)); result.set(header, 2); result.set(bytes.subarray(2), 2 + header.length);
  return result;
}
