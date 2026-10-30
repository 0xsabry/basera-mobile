/**
 * Pure YOLOv8/YOLO11 post-processing: decode + confidence filter + NMS.
 *
 * Model output tensor shape: [1, 84, 8400] (84 = 4 box coords + 80 COCO classes),
 * stored channel-major: element (channel c, anchor a) lives at output[c * 8400 + a].
 * Box coords are center-x, center-y, width, height in 640x640 letterbox pixels.
 * This module is unit-tested against a REAL recorded model output
 * (tests/fixtures via src/ai/__tests__), produced by scripts/verify_model.py.
 */
import type { Detection } from './types';
import { COCO_LABELS_AR, COCO_LABELS_EN } from './cocoLabels';

export const MODEL_INPUT_SIZE = 640;
export const NUM_ANCHORS = 8400;
export const NUM_CLASSES = 80;
const NUM_CHANNELS = 4 + NUM_CLASSES; // 84

export interface LetterboxInfo {
  scale: number;
  padX: number;
  padY: number;
  origWidth: number;
  origHeight: number;
}

/** Compute letterbox transform: fit image into 640x640 keeping aspect ratio. */
export function computeLetterbox(origWidth: number, origHeight: number): LetterboxInfo {
  const scale = Math.min(MODEL_INPUT_SIZE / origWidth, MODEL_INPUT_SIZE / origHeight);
  const newW = origWidth * scale;
  const newH = origHeight * scale;
  return {
    scale,
    padX: (MODEL_INPUT_SIZE - newW) / 2,
    padY: (MODEL_INPUT_SIZE - newH) / 2,
    origWidth,
    origHeight,
  };
}

function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

export interface DecodeOptions {
  confidenceThreshold?: number;
  iouThreshold?: number;
  maxDetections?: number;
}

/**
 * Decode a raw YOLO output tensor (Float32Array of length 84*8400) into
 * detections with boxes normalized to 0..1 in original-image coordinates.
 */
export function decodeYoloOutput(
  output: ArrayLike<number>,
  letterbox: LetterboxInfo,
  options: DecodeOptions = {},
): Detection[] {
  const confThreshold = options.confidenceThreshold ?? 0.35;
  const iouThreshold = options.iouThreshold ?? 0.45;
  const maxDetections = options.maxDetections ?? 30;

  if (output.length < NUM_CHANNELS * NUM_ANCHORS) {
    throw new Error(
      `YOLO output too small: got ${output.length}, expected at least ${NUM_CHANNELS * NUM_ANCHORS}`,
    );
  }

  interface Candidate {
    classId: number;
    confidence: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const candidates: Candidate[] = [];

  for (let a = 0; a < NUM_ANCHORS; a++) {
    // Find best class for this anchor.
    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < NUM_CLASSES; c++) {
      const score = output[(4 + c) * NUM_ANCHORS + a];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestClass < 0 || bestScore < confThreshold) continue;

    const cx = output[0 * NUM_ANCHORS + a];
    const cy = output[1 * NUM_ANCHORS + a];
    const w = output[2 * NUM_ANCHORS + a];
    const h = output[3 * NUM_ANCHORS + a];

    // Letterbox pixels -> original image pixels -> normalized.
    const x1 = (cx - w / 2 - letterbox.padX) / letterbox.scale;
    const y1 = (cy - h / 2 - letterbox.padY) / letterbox.scale;
    const x2 = (cx + w / 2 - letterbox.padX) / letterbox.scale;
    const y2 = (cy + h / 2 - letterbox.padY) / letterbox.scale;

    const nx = Math.max(0, x1 / letterbox.origWidth);
    const ny = Math.max(0, y1 / letterbox.origHeight);
    const nx2 = Math.min(1, x2 / letterbox.origWidth);
    const ny2 = Math.min(1, y2 / letterbox.origHeight);
    if (nx2 <= nx || ny2 <= ny) continue;

    candidates.push({
      classId: bestClass,
      confidence: bestScore,
      x: nx,
      y: ny,
      w: nx2 - nx,
      h: ny2 - ny,
    });
  }

  // Class-aware NMS, highest confidence first.
  candidates.sort((p, q) => q.confidence - p.confidence);
  const kept: Candidate[] = [];
  const suppressed = new Array<boolean>(candidates.length).fill(false);
  for (let i = 0; i < candidates.length && kept.length < maxDetections; i++) {
    if (suppressed[i]) continue;
    const cand = candidates[i];
    kept.push(cand);
    for (let j = i + 1; j < candidates.length; j++) {
      if (suppressed[j]) continue;
      if (candidates[j].classId !== cand.classId) continue;
      if (iou(cand, candidates[j]) > iouThreshold) suppressed[j] = true;
    }
  }

  return kept.map((k) => ({
    classId: k.classId,
    confidence: k.confidence,
    labelEn: COCO_LABELS_EN[k.classId] ?? 'unknown object',
    labelAr: COCO_LABELS_AR[k.classId] ?? 'شيء غير معروف',
    box: { x: k.x, y: k.y, width: k.w, height: k.h },
  }));
}
