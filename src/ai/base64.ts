/**
 * Pure-TypeScript base64 decoding.
 *
 * React Native (Hermes) has no global `Buffer`, and `globalThis.atob` is
 * not guaranteed to exist either — the previous detection pipeline relied
 * on both and threw on real devices. This decoder has zero runtime
 * dependencies and is unit-tested.
 */

const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP: Int16Array = (() => {
  const arr = new Int16Array(128).fill(-1);
  for (let i = 0; i < TABLE.length; i++) arr[TABLE.charCodeAt(i)] = i;
  return arr;
})();

/** Decode a base64 string (padding optional, whitespace tolerated) to bytes. */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[\s\r\n]/g, '');
  if (clean.length === 0) return new Uint8Array(0);

  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;

  const outLength = Math.floor((clean.length * 3) / 4) - padding;
  if (outLength < 0) throw new Error('Invalid base64 input');
  const out = new Uint8Array(outLength);

  let outIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = valueAt(clean, i);
    const c1 = valueAt(clean, i + 1);
    const c2 = clean[i + 2] === '=' || i + 2 >= clean.length ? 0 : valueAt(clean, i + 2);
    const c3 = clean[i + 3] === '=' || i + 3 >= clean.length ? 0 : valueAt(clean, i + 3);
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIdx < outLength) out[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < outLength) out[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < outLength) out[outIdx++] = triple & 0xff;
  }
  return out;
}

function valueAt(s: string, idx: number): number {
  if (idx >= s.length) return 0;
  const code = s.charCodeAt(idx);
  const v = code < 128 ? LOOKUP[code] : -1;
  if (v < 0) throw new Error(`Invalid base64 character at index ${idx}`);
  return v;
}
