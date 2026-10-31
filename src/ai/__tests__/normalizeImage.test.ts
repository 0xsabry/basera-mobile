/**
 * Bug 3 — image selection/processing errors.
 *
 * Host-verified here: error classification, normalize resize math +
 * manipulator options (native module mocked), and the REAL host JPEG
 * pipeline (jpeg-js via buildTensorFromJpegBase64) on real fixture
 * bytes: PNG/corrupt bytes must fail as decode-failed, a real JPEG
 * must produce the full YOLO tensor.
 *
 * Native-only (NOT verified here): expo-image-manipulator itself and
 * ML Kit running on a device.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  classifyImageError,
  ImagePipelineError,
  normalizeImage,
  normalizedSize,
} from '../normalizeImage';
import { buildTensorFromJpegBase64, DetectorUnavailableError } from '../ObjectDetector';
import { OcrUnavailableError } from '../TextRecognizer';
import { computeLetterbox, MODEL_INPUT_SIZE } from '../yoloPostprocess';
import type { CapturedImage } from '../../input/ImageSource';

jest.mock('expo-image-manipulator', () => {
  const manipulateAsync = jest.fn();
  return {
    manipulateAsync,
    SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
    __manipulateAsync: manipulateAsync,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const manipulator = require('expo-image-manipulator') as {
  __manipulateAsync: jest.Mock;
};
const mockManipulate = manipulator.__manipulateAsync;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jpeg = require('jpeg-js');

const img = (width: number, height: number): CapturedImage => ({
  uri: 'content://media/external/images/123',
  width,
  height,
  sourceKind: 'gallery',
});

beforeEach(() => {
  mockManipulate.mockReset();
});

describe('classifyImageError', () => {
  it('maps the PERMISSION_DENIED prefix to permission-denied', () => {
    expect(classifyImageError(new Error('PERMISSION_DENIED:gallery')).kind).toBe('permission-denied');
    expect(classifyImageError(new Error('PERMISSION_DENIED:camera')).kind).toBe('permission-denied');
    expect(classifyImageError('PERMISSION_DENIED:gallery').kind).toBe('permission-denied');
  });

  it('passes ImagePipelineError through unchanged', () => {
    const e = new ImagePipelineError('decode-failed', 'x');
    expect(classifyImageError(e)).toBe(e);
  });

  it('maps DetectorUnavailableError decode vs interpreter-unavailable distinctly', () => {
    expect(
      classifyImageError(
        new DetectorUnavailableError('Could not decode the selected image for detection.'),
      ).kind,
    ).toBe('decode-failed');
    expect(
      classifyImageError(
        new DetectorUnavailableError(
          'On-device YOLO interpreter is unavailable in this build. Object detection needs the BASERA development build.',
        ),
      ).kind,
    ).toBe('model-failed');
  });

  it('maps OcrUnavailableError decode vs unavailable distinctly', () => {
    expect(
      classifyImageError(new OcrUnavailableError('Could not decode the selected image for OCR.')).kind,
    ).toBe('decode-failed');
    expect(
      classifyImageError(new OcrUnavailableError('ML Kit OCR is unavailable in this build.')).kind,
    ).toBe('model-failed');
  });

  it('maps format/manipulator failures to unsupported-format', () => {
    expect(classifyImageError(new Error('Unsupported image format')).kind).toBe('unsupported-format');
    expect(classifyImageError(new Error('Failed to manipulate image: HEIC not supported')).kind).toBe(
      'unsupported-format',
    );
  });

  it('maps raw jpeg-js decode failures to decode-failed', () => {
    expect(classifyImageError(new Error('SOI not found')).kind).toBe('decode-failed');
    expect(classifyImageError(new Error('Invalid JPEG: corrupt data')).kind).toBe('decode-failed');
  });

  it('maps anything else to processing-failed', () => {
    expect(classifyImageError(new Error('something unexpected happened')).kind).toBe(
      'processing-failed',
    );
    expect(classifyImageError(42).kind).toBe('processing-failed');
  });
});

describe('normalizedSize (pure resize math)', () => {
  it('4000x3000 -> 1280x960 (long edge capped, aspect preserved)', () => {
    expect(normalizedSize(4000, 3000)).toEqual({ width: 1280, height: 960, resized: true });
  });
  it('portrait 3000x4000 -> 960x1280', () => {
    expect(normalizedSize(3000, 4000)).toEqual({ width: 960, height: 1280, resized: true });
  });
  it('800x600 is left alone', () => {
    expect(normalizedSize(800, 600)).toEqual({ width: 800, height: 600, resized: false });
  });
  it('exactly 1280 on the long edge is left alone', () => {
    expect(normalizedSize(1280, 720).resized).toBe(false);
  });
});

describe('normalizeImage (manipulator mocked)', () => {
  it('resizes 4000x3000 to 1280x960 and asks for JPEG q0.85, no base64', async () => {
    mockManipulate.mockResolvedValue({ uri: 'file:///cache/normalized.jpg', width: 1280, height: 960 });
    const out = await normalizeImage(img(4000, 3000));
    expect(out).toEqual({
      uri: 'file:///cache/normalized.jpg',
      width: 1280,
      height: 960,
      sourceKind: 'gallery',
    });
    expect(mockManipulate).toHaveBeenCalledTimes(1);
    const [uri, actions, options] = mockManipulate.mock.calls[0];
    expect(uri).toBe('content://media/external/images/123');
    expect(actions).toEqual([{ resize: { width: 1280, height: 960 } }]);
    expect(options).toEqual({ format: 'jpeg', compress: 0.85, base64: false });
  });

  it('sends NO resize action for an 800x600 image but still re-encodes to JPEG', async () => {
    mockManipulate.mockResolvedValue({ uri: 'file:///cache/normalized.jpg', width: 800, height: 600 });
    const out = await normalizeImage(img(800, 600));
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    const [, actions, options] = mockManipulate.mock.calls[0];
    expect(actions).toEqual([]);
    expect(options.format).toBe('jpeg');
    expect(options.compress).toBe(0.85);
    expect(options.base64).toBe(false);
  });

  it('preserves sourceKind', async () => {
    mockManipulate.mockResolvedValue({ uri: 'file:///cache/n.jpg', width: 100, height: 100 });
    const out = await normalizeImage({ ...img(100, 100), sourceKind: 'phone-camera-test' });
    expect(out.sourceKind).toBe('phone-camera-test');
  });

  it('manipulator throwing -> ImagePipelineError kind unsupported-format', async () => {
    mockManipulate.mockRejectedValue(new Error('cannot resolve content URI / unsupported HEIC'));
    const caught: unknown = await normalizeImage(img(4000, 3000)).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ImagePipelineError);
    expect((caught as ImagePipelineError).kind).toBe('unsupported-format');
    expect(classifyImageError(caught).kind).toBe('unsupported-format');
  });

  it('manipulator returning no uri -> unsupported-format', async () => {
    mockManipulate.mockResolvedValue({});
    const caught: unknown = await normalizeImage(img(100, 100)).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ImagePipelineError);
    expect((caught as ImagePipelineError).kind).toBe('unsupported-format');
  });
});

describe('host JPEG pipeline: buildTensorFromJpegBase64 on real bytes', () => {
  const fixturesSamples = path.join(__dirname, '..', '..', '..', 'assets', 'samples');
  // Minimal valid 1x1 PNG (embedded fixture).
  const PNG_1X1_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  /** Run fn, return the thrown error (failing the test if none). */
  function thrown(fn: () => unknown): unknown {
    try {
      fn();
    } catch (e) {
      return e;
    }
    throw new Error('expected the call to throw');
  }

  it('PNG bytes (1x1 fixture) -> decode-failed, NOT a raw jpeg-js error', () => {
    // Sanity: these really are PNG bytes, which jpeg-js cannot decode —
    // exactly why normalization to JPEG must happen first on device.
    expect(Buffer.from(PNG_1X1_BASE64, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const e = thrown(() => buildTensorFromJpegBase64(PNG_1X1_BASE64, computeLetterbox(1, 1)));
    expect(e).toBeInstanceOf(ImagePipelineError);
    expect(classifyImageError(e).kind).toBe('decode-failed');
  });

  it('the real bundled PNG sample -> decode-failed', () => {
    const pngB64 = fs.readFileSync(path.join(fixturesSamples, 'text-english.png')).toString('base64');
    const e = thrown(() => buildTensorFromJpegBase64(pngB64, computeLetterbox(1200, 800)));
    expect(classifyImageError(e).kind).toBe('decode-failed');
  });

  it('corrupt bytes ("not-an-image") -> decode-failed', () => {
    const corruptB64 = Buffer.from('not-an-image').toString('base64');
    const e = thrown(() => buildTensorFromJpegBase64(corruptB64, computeLetterbox(10, 10)));
    expect(e).toBeInstanceOf(ImagePipelineError);
    expect(classifyImageError(e).kind).toBe('decode-failed');
  });

  it('a real JPEG (tiny, built with jpeg-js like the repo fixture) -> full tensor', () => {
    const data = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      data[i * 4] = 255;
      data[i * 4 + 3] = 255;
    }
    const encoded = jpeg.encode({ data, width: 2, height: 2 }, 100);
    const b64 = Buffer.from(encoded.data).toString('base64');
    const tensor = buildTensorFromJpegBase64(b64, computeLetterbox(2, 2));
    expect(tensor).toBeInstanceOf(Float32Array);
    expect(tensor.length).toBe(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
    expect(tensor.length).toBe(3 * 640 * 640);
  });

  it('the real bundled JPEG sample (street-bus.jpg) -> full tensor', () => {
    const jpgB64 = fs.readFileSync(path.join(fixturesSamples, 'street-bus.jpg')).toString('base64');
    const tensor = buildTensorFromJpegBase64(jpgB64, computeLetterbox(810, 1080));
    expect(tensor).toBeInstanceOf(Float32Array);
    expect(tensor.length).toBe(3 * 640 * 640);
  });
});
