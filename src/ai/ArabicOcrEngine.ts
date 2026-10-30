/**
 * Arabic OCR engine — PP-OCR (PaddleOCR) running fully on-device via
 * react-native-fast-tflite. Google ML Kit has NO Arabic text model, so
 * Arabic script goes through this engine instead:
 *
 *   1. Detection: PP-OCRv3 det TFLite, fixed input NHWC [1,960,960,3].
 *      The photo is fit inside 960x960 (dims rounded to multiples of 32)
 *      and pasted top-left on a canvas filled with normalized 0
 *      (ImageNet mean). Output: text probability map.
 *   2. Box extraction (pure TS, unit-tested against a recorded real
 *      prob map): threshold 0.3 -> connected components -> boxes,
 *      expanded (Arabic ascenders/dots sit outside the prob-map core —
 *      tight boxes wreck recognition) and merged into lines.
 *   3. Recognition per line: PP-OCR Arabic rec TFLite, fixed input
 *      NHWC [1,48,640,3]; the line crop is resized to height 48 keeping
 *      ratio (squashed to 640 if wider) and pasted left on a 0-filled
 *      canvas. Output [160,163] logits -> CTC greedy decode with the
 *      official PaddleOCR arabic_dict (0=blank, 1..161=dict, 162=space).
 *
 * Model provenance + SHA256: docs/MODELS.md. Host verification
 * (scripts + results): TESTING.md — the converted TFLite models recover
 * the bundled Arabic sample's text with 0.73 character overlap. The
 * recognizer is a small mobile model: it does confuse some dotted
 * letters on some fonts. It NEVER invents text — empty result means
 * empty.
 *
 * Delegate note: do NOT enable XNNPACK for these models (fast-tflite's
 * default is plain CPU, which is what the host gate mirrors — the
 * XNNPACK delegate fails to prepare this graph).
 */
import type { CapturedImage } from '../input/ImageSource';
import { decodeBase64 } from './base64';
import { ARABIC_OCR_CHARS } from './arabicDict';
import { OcrUnavailableError, type TextRecognizer } from './TextRecognizer';
import type { OcrResult } from './types';

export const DET_CANVAS = 960;
export const REC_H = 48;
export const REC_W = 640;
export const REC_CLASSES = 163;
const DET_THRESHOLD = 0.3;
const MIN_COMPONENT_PIXELS = 100;

export interface TextBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Scale factors for the det canvas fit, shared by engine + tests. */
export function detFit(origW: number, origH: number): { rw: number; rh: number } {
  const scale = Math.min(1, DET_CANVAS / Math.max(origW, origH));
  return {
    rw: Math.max(32, Math.floor((origW * scale) / 32) * 32),
    rh: Math.max(32, Math.floor((origH * scale) / 32) * 32),
  };
}

/**
 * Pure: probability map region (rw x rh, row-major) -> line boxes in
 * original-image coordinates. Mirrors the host gate exactly.
 */
export function extractTextBoxes(
  prob: ArrayLike<number>,
  rw: number,
  rh: number,
  origW: number,
  origH: number,
): TextBox[] {
  const labels = new Int32Array(rw * rh).fill(-1);
  const boxes: TextBox[] = [];
  const stack: number[] = [];
  let component = 0;

  for (let start = 0; start < rw * rh; start++) {
    if (prob[start] <= DET_THRESHOLD || labels[start] !== -1) continue;
    // Flood fill one component.
    let minX = rw;
    let minY = rh;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    labels[start] = component;
    stack.length = 0;
    stack.push(start);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % rw;
      const y = (idx / rw) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < rw - 1 ? idx + 1 : -1,
        y > 0 ? idx - rw : -1,
        y < rh - 1 ? idx + rw : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && labels[n] === -1 && prob[n] > DET_THRESHOLD) {
          labels[n] = component;
          stack.push(n);
        }
      }
    }
    component++;
    if (count < MIN_COMPONENT_PIXELS || maxX < 0) continue;
    const sx = origW / rw;
    const sy = origH / rh;
    const X0 = minX * sx;
    const Y0 = minY * sy;
    const X1 = (maxX + 1) * sx;
    const Y1 = (maxY + 1) * sy;
    const vpad = 0.6 * (Y1 - Y0);
    const hpad = 0.05 * (X1 - X0);
    boxes.push({
      x0: Math.max(0, Math.floor(X0 - hpad)),
      y0: Math.max(0, Math.floor(Y0 - vpad)),
      x1: Math.min(origW, Math.floor(X1 + hpad)),
      y1: Math.min(origH, Math.floor(Y1 + vpad)),
    });
  }

  // Reading order: top-to-bottom (line-internal order handled by the rec
  // model, which reads the whole line crop at once).
  boxes.sort((a, b) => a.y0 - b.y0 || b.x0 - a.x0);
  const merged: TextBox[] = [];
  for (const b of boxes) {
    const p = merged[merged.length - 1];
    if (
      p &&
      Math.min(b.y1, p.y1) - Math.max(b.y0, p.y0) >
        0.5 * Math.min(b.y1 - b.y0, p.y1 - p.y0)
    ) {
      p.x0 = Math.min(p.x0, b.x0);
      p.y0 = Math.min(p.y0, b.y0);
      p.x1 = Math.max(p.x1, b.x1);
      p.y1 = Math.max(p.y1, b.y1);
    } else {
      merged.push({ ...b });
    }
  }
  return merged;
}

/** Pure: CTC greedy decode of [T,163] logits (or probs) to text. */
export function ctcGreedyDecode(logits: ArrayLike<number>, timesteps: number): string {
  let out = '';
  let prev = -1;
  for (let t = 0; t < timesteps; t++) {
    let best = 0;
    let bestVal = -Infinity;
    const base = t * REC_CLASSES;
    for (let c = 0; c < REC_CLASSES; c++) {
      const v = logits[base + c];
      if (v > bestVal) {
        bestVal = v;
        best = c;
      }
    }
    if (best !== prev && best !== 0) {
      if (best === REC_CLASSES - 1) out += ' ';
      else if (best - 1 < ARABIC_OCR_CHARS.length) out += ARABIC_OCR_CHARS[best - 1];
    }
    prev = best;
  }
  return out;
}

// Bundled model assets (Metro resolves .tflite via metro.config.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DET_ASSET: number = require('../../assets/models/ppocr_det.tflite');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const REC_ASSET: number = require('../../assets/models/ppocr_arabic_rec.tflite');

interface DecodedPixels {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

export class ArabicOcrEngine implements TextRecognizer {
  readonly id = 'ppocr-arabic-tflite';
  private modelsPromise: Promise<{ det: any; rec: any }> | null = null;

  private async loadModels(): Promise<{ det: any; rec: any }> {
    if (!this.modelsPromise) {
      this.modelsPromise = (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const tflite = require('react-native-fast-tflite');
          const det = await tflite.loadTensorflowModel(DET_ASSET);
          const rec = await tflite.loadTensorflowModel(REC_ASSET);
          return { det, rec };
        } catch (e) {
          this.modelsPromise = null;
          throw new OcrUnavailableError(
            'Arabic OCR (PP-OCR) is unavailable in this build. It needs the BASERA app build with the native TFLite module; it does not run in Expo Go or web. ' +
              `(${e instanceof Error ? e.message : String(e)})`,
          );
        }
      })();
    }
    return this.modelsPromise;
  }

  /** Decode an image file to RGBA pixels via JPEG (same path as detection). */
  private async decodeJpeg(uri: string): Promise<DecodedPixels> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jpeg = require('jpeg-js');
    const base64: string = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const decoded = jpeg.decode(decodeBase64(base64), { useTArray: true });
    if (!decoded?.data) {
      throw new OcrUnavailableError('Could not decode the selected image for OCR.');
    }
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }

  async recognize(image: CapturedImage): Promise<OcrResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
    const { det, rec } = await this.loadModels();
    const { rw, rh } = detFit(image.width, image.height);

    // --- Detection pass -------------------------------------------------
    const detResized = await manipulateAsync(
      image.uri,
      [{ resize: { width: rw, height: rh } }],
      { format: SaveFormat.JPEG, compress: 1 },
    );
    const detPixels = await this.decodeJpeg(detResized.uri);
    const detTensor = new Float32Array(DET_CANVAS * DET_CANVAS * 3); // 0-filled canvas
    const MEAN = [0.485, 0.456, 0.406];
    const STD = [0.229, 0.224, 0.225];
    for (let y = 0; y < detPixels.height; y++) {
      for (let x = 0; x < detPixels.width; x++) {
        const si = (y * detPixels.width + x) * 4;
        const di = (y * DET_CANVAS + x) * 3;
        for (let c = 0; c < 3; c++) {
          detTensor[di + c] = (detPixels.data[si + c] / 255 - MEAN[c]) / STD[c];
        }
      }
    }
    const detOutputs = await det.run([detTensor]);
    const probFull: ArrayLike<number> = detOutputs[0];
    // Slice the valid region out of the 960x960 map, using the ACTUAL
    // decoded pixel dims (the platform resizer may round by a pixel).
    const pw = detPixels.width;
    const ph = detPixels.height;
    const probRegion = new Float32Array(pw * ph);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        probRegion[y * pw + x] = probFull[y * DET_CANVAS + x];
      }
    }
    const boxes = extractTextBoxes(probRegion, pw, ph, image.width, image.height);
    if (boxes.length === 0) {
      return { text: '', language: 'unknown', blocks: [] };
    }

    // --- Recognition pass (one line at a time) --------------------------
    const lines: string[] = [];
    for (const box of boxes) {
      const boxW = Math.max(1, box.x1 - box.x0);
      const boxH = Math.max(1, box.y1 - box.y0);
      const ratioW = Math.round((REC_H * boxW) / boxH);
      const targetW = Math.min(REC_W, Math.max(1, ratioW));
      const lineImg = await manipulateAsync(
        image.uri,
        [
          { crop: { originX: box.x0, originY: box.y0, width: boxW, height: boxH } },
          { resize: { width: targetW, height: REC_H } },
        ],
        { format: SaveFormat.JPEG, compress: 1 },
      );
      const px = await this.decodeJpeg(lineImg.uri);
      const recTensor = new Float32Array(REC_H * REC_W * 3); // 0-filled (normalized space)
      const copyW = Math.min(px.width, REC_W);
      for (let y = 0; y < px.height && y < REC_H; y++) {
        for (let x = 0; x < copyW; x++) {
          const si = (y * px.width + x) * 4;
          const di = (y * REC_W + x) * 3;
          for (let c = 0; c < 3; c++) {
            recTensor[di + c] = (px.data[si + c] / 255 - 0.5) / 0.5;
          }
        }
      }
      const recOutputs = await rec.run([recTensor]);
      const logits: ArrayLike<number> = recOutputs[0];
      const timesteps = Math.floor(logits.length / REC_CLASSES);
      const line = ctcGreedyDecode(logits, timesteps).trim();
      if (line) lines.push(line);
    }

    return {
      text: lines.join('\n'),
      language: lines.length > 0 ? 'ar' : 'unknown',
      blocks: lines.map((text) => ({ text })),
    };
  }
}
