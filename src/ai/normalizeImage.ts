/**
 * Image pipeline normalization — the single choke point every picked /
 * captured image passes through before any AI engine touches it.
 *
 * Why: gallery/camera sources hand back the RAW picker asset URI
 * (content:// or file://, PNG/JPEG/WebP/HEIC, any size). Downstream
 * engines disagree about what they accept: jpeg-js decodes JPEG only,
 * ML Kit resolves some content URIs and not others, and a 48 MP photo
 * can OOM the letterbox step. Normalizing once — resize the long edge
 * to at most 1280 px, re-encode as JPEG q0.85 — gives every engine the
 * same predictable local JPEG file.
 *
 * Failures are typed (ImagePipelineError) so screens can show a specific
 * localized message instead of collapsing everything into one generic
 * error or surfacing a raw English/native message.
 */
import type { CapturedImage } from '../input/ImageSource';

export const MAX_LONG_EDGE = 1280;

export type ImageErrorKind =
  | 'permission-denied'
  | 'unsupported-format'
  | 'decode-failed'
  | 'model-failed'
  | 'processing-failed';

export class ImagePipelineError extends Error {
  readonly code = 'IMAGE_PIPELINE_ERROR';
  constructor(
    readonly kind: ImageErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ImagePipelineError';
  }
}

const DECODE_MESSAGE = /could not decode|failed to decode|cannot decode|decode.*fail|soi not found|invalid jpeg|not a jpeg|corrupt|damaged/i;
const UNSUPPORTED_MESSAGE =
  /unsupported|not supported|invalid format|unknown format|format.*fail|manipulat|heic|heif|webp/i;
const MODEL_MESSAGE =
  /interpreter|tflite|tensorflow|ml kit|ocr is unavailable|detector.*unavailable|unavailable in this build|native module/i;

/**
 * Map any error thrown anywhere in the image pipeline to a typed
 * ImagePipelineError. Already-typed errors pass through unchanged.
 * DetectorUnavailableError / OcrUnavailableError are recognized by
 * their stable `.code` (duck-typed, so this module never imports the
 * detector/OCR modules and there is no import cycle): their decode
 * message means the IMAGE was unreadable, every other such error means
 * the MODEL/native engine is unavailable in this build.
 */
export function classifyImageError(e: unknown): ImagePipelineError {
  if (e instanceof ImagePipelineError) return e;

  const err = e instanceof Error ? e : new Error(String(e));
  const msg = err.message ?? '';
  const code = (err as { code?: unknown }).code;

  if (msg.includes('PERMISSION_DENIED')) {
    return new ImagePipelineError('permission-denied', msg);
  }
  if (code === 'DETECTOR_UNAVAILABLE' || code === 'OCR_UNAVAILABLE') {
    if (DECODE_MESSAGE.test(msg)) {
      return new ImagePipelineError('decode-failed', msg);
    }
    return new ImagePipelineError('model-failed', msg);
  }
  if (DECODE_MESSAGE.test(msg)) {
    return new ImagePipelineError('decode-failed', msg);
  }
  if (UNSUPPORTED_MESSAGE.test(msg)) {
    return new ImagePipelineError('unsupported-format', msg);
  }
  if (MODEL_MESSAGE.test(msg)) {
    return new ImagePipelineError('model-failed', msg);
  }
  return new ImagePipelineError('processing-failed', msg);
}

/** Pure resize math: fit (w,h) so the long edge is at most maxEdge. */
export function normalizedSize(
  width: number,
  height: number,
  maxEdge: number = MAX_LONG_EDGE,
): { width: number; height: number; resized: boolean } {
  const longEdge = Math.max(width, height);
  if (!Number.isFinite(longEdge) || longEdge <= maxEdge || longEdge <= 0) {
    return { width, height, resized: false };
  }
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

/**
 * Normalize a captured image to a local JPEG (long edge ≤1280).
 * Native-only on device (expo-image-manipulator); any manipulator
 * failure is an unsupported-format error — the source image is in a
 * format/URI the native side could not convert.
 */
export async function normalizeImage(image: CapturedImage): Promise<CapturedImage> {
  // Lazy require so jest/web never load the native module at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');

  const target = normalizedSize(image.width, image.height);
  const actions = target.resized
    ? [{ resize: { width: target.width, height: target.height } }]
    : [];

  let out: { uri?: string; width?: number; height?: number };
  try {
    out = await manipulateAsync(image.uri, actions, {
      format: SaveFormat.JPEG,
      compress: 0.85,
      base64: false,
    });
  } catch (e) {
    if (e instanceof ImagePipelineError) throw e;
    const detail = e instanceof Error ? e.message : String(e);
    throw new ImagePipelineError(
      'unsupported-format',
      `This image format is not supported. It could not be converted to JPEG. (${detail})`,
    );
  }
  if (!out?.uri) {
    throw new ImagePipelineError(
      'unsupported-format',
      'This image format is not supported. It could not be converted to JPEG.',
    );
  }
  return {
    uri: out.uri,
    width: out.width ?? target.width,
    height: out.height ?? target.height,
    sourceKind: image.sourceKind,
  };
}
