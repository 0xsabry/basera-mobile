/**
 * base64 decoder vectors + the device regression test for ROOT CAUSE 1:
 * detection used Buffer/atob, which React Native/Hermes does not provide.
 * The tensor-building path must work with both globals ABSENT.
 */
import { decodeBase64 } from '../base64';
import { buildTensorFromJpegBase64 } from '../ObjectDetector';
import { computeLetterbox, MODEL_INPUT_SIZE } from '../yoloPostprocess';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jpeg = require('jpeg-js');

describe('decodeBase64', () => {
  it('decodes unpadded and padded inputs', () => {
    expect(Array.from(decodeBase64('TWFu'))).toEqual([0x4d, 0x61, 0x6e]); // "Man"
    expect(Array.from(decodeBase64('TWE='))).toEqual([0x4d, 0x61]); // "Ma"
    expect(Array.from(decodeBase64('TQ=='))).toEqual([0x4d]); // "M"
    expect(Array.from(decodeBase64(''))).toEqual([]);
  });

  it('round-trips arbitrary bytes (fixture built with Node Buffer, decode is ours)', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const b64 = Buffer.from(bytes).toString('base64');
    expect(decodeBase64(b64)).toEqual(bytes);
  });

  it('tolerates whitespace/newlines', () => {
    expect(Array.from(decodeBase64('TW\nFu '))).toEqual([0x4d, 0x61, 0x6e]);
  });

  it('throws on invalid characters instead of returning garbage', () => {
    expect(() => decodeBase64('T!Fu')).toThrow();
  });
});

describe('buildTensorFromJpegBase64 without Buffer/atob (Hermes simulation)', () => {
  const g = globalThis as Record<string, unknown>;
  let savedBuffer: unknown;
  let savedAtob: unknown;
  let redJpegBase64: string;

  beforeAll(() => {
    // Fixture: a solid-red 2x2 RGBA image encoded as JPEG. Buffer is used
    // ONLY to construct the fixture in the Node test env — never by the
    // code under test below.
    const data = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      data[i * 4] = 255; // R
      data[i * 4 + 1] = 0; // G
      data[i * 4 + 2] = 0; // B
      data[i * 4 + 3] = 255; // A
    }
    const encoded = jpeg.encode({ data, width: 2, height: 2 }, 100);
    redJpegBase64 = Buffer.from(encoded.data).toString('base64');
  });

  beforeEach(() => {
    savedBuffer = g.Buffer;
    savedAtob = g.atob;
    g.Buffer = undefined;
    g.atob = undefined;
    expect((globalThis as Record<string, unknown>).Buffer).toBeUndefined();
    expect((globalThis as Record<string, unknown>).atob).toBeUndefined();
  });

  afterEach(() => {
    g.Buffer = savedBuffer;
    g.atob = savedAtob;
  });

  it('builds a [1,3,640,640] tensor from JPEG base64 with no Buffer/atob present', () => {
    const letterbox = computeLetterbox(2, 2);
    const tensor = buildTensorFromJpegBase64(redJpegBase64, letterbox);
    expect(tensor.length).toBe(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
    const plane = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
    let rSum = 0;
    let gSum = 0;
    for (let i = 0; i < plane; i++) {
      rSum += tensor[i];
      gSum += tensor[plane + i];
    }
    // Solid red source: R channel ~1 everywhere, G channel ~0 (JPEG slack).
    expect(rSum / plane).toBeGreaterThan(0.9);
    expect(gSum / plane).toBeLessThan(0.15);
  });
});
