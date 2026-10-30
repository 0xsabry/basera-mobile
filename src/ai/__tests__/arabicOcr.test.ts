/**
 * PP-OCR Arabic post-processing proof against RECORDED REAL model outputs.
 *
 * Fixtures were produced host-side by the exact TFLite models the app
 * ships (scripts in TESTING.md): ppocr_det_probmap.bin is the real det
 * probability map for assets/samples/text-arabic.png (960x640 region),
 * ppocr_rec_line1.bin is the real rec logits [160,163] for line 1.
 * The TS implementations must reproduce the Python gate's results:
 * 3 boxes and line 1 text 'مكتبهرصيرق' (the model's real output,
 * including its ة->ق confusion — documented, not hidden).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ctcGreedyDecode, detFit, extractTextBoxes } from '../ArabicOcrEngine';
import { OcrUnavailableError, RoutingTextRecognizer, type TextRecognizer } from '../TextRecognizer';
import type { OcrResult } from '../types';

const fixturesDir = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures');
const meta = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'ppocr_fixture_meta.json'), 'utf8'));

function loadFloats(file: string): Float32Array {
  const bin = fs.readFileSync(path.join(fixturesDir, file));
  return new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
}

describe('extractTextBoxes vs recorded PP-OCR det output (text-arabic.png)', () => {
  const prob = loadFloats('ppocr_det_probmap.bin');
  const boxes = extractTextBoxes(prob, meta.probW, meta.probH, meta.origW, meta.origH);

  it('finds the same 3 line boxes as the Python gate', () => {
    expect(boxes.length).toBe(meta.expectedBoxes.length);
    boxes.forEach((b, i) => {
      const [ex0, ey0, ex1, ey1] = meta.expectedBoxes[i];
      // Small tolerance: TS uses pixel-count area vs cv2 contourArea.
      expect(Math.abs(b.x0 - ex0)).toBeLessThanOrEqual(6);
      expect(Math.abs(b.y0 - ey0)).toBeLessThanOrEqual(6);
      expect(Math.abs(b.x1 - ex1)).toBeLessThanOrEqual(6);
      expect(Math.abs(b.y1 - ey1)).toBeLessThanOrEqual(6);
    });
  });

  it('detFit matches the gate preprocessing (1200x800 -> 960x640)', () => {
    expect(detFit(1200, 800)).toEqual({ rw: 960, rh: 640 });
  });

  it('empty prob map -> no boxes', () => {
    expect(extractTextBoxes(new Float32Array(100 * 100), 100, 100, 100, 100)).toEqual([]);
  });
});

describe('ctcGreedyDecode vs recorded PP-OCR rec output (line 1)', () => {
  const logits = loadFloats('ppocr_rec_line1.bin');
  it('decodes to the same text as the Python gate', () => {
    const timesteps = Math.floor(logits.length / 163);
    expect(ctcGreedyDecode(logits, timesteps)).toBe(meta.recLine1Text);
    expect(meta.recLine1Text.length).toBeGreaterThan(0);
  });

  it('collapses repeats and drops blanks', () => {
    // T=4: blank, then ب (dict line 88 1-based -> 0-based 87 -> CTC class 88)
    const classes = 163;
    const arr = new Float32Array(4 * classes).fill(-10);
    const set = (t: number, c: number) => {
      arr[t * classes + c] = 10;
    };
    set(0, 0); // blank
    set(1, 88); // ب
    set(2, 88); // repeat -> collapsed
    set(3, 162); // space
    expect(ctcGreedyDecode(arr, 4)).toBe('ب ');
  });
});

describe('RoutingTextRecognizer', () => {
  const img = { uri: 'file:///x.jpg', width: 100, height: 100, sourceKind: 'gallery' as const };
  const fake = (r: Partial<OcrResult> | Error): TextRecognizer => ({
    id: 'fake',
    recognize: async () => {
      if (r instanceof Error) throw r;
      return { text: '', language: 'unknown', blocks: [], ...r } as OcrResult;
    },
  });

  it('Arabic preferred: PP-OCR result wins', async () => {
    const routing = new RoutingTextRecognizer('ar', {
      arabic: fake({ text: 'مكتبة بصيرة', language: 'ar' }),
      latin: fake({ text: 'BASERA Library', language: 'en' }),
    });
    expect((await routing.recognize(img)).text).toBe('مكتبة بصيرة');
  });

  it('Arabic preferred, PP-OCR empty -> falls back to Latin', async () => {
    const routing = new RoutingTextRecognizer('ar', {
      arabic: fake({ text: '' }),
      latin: fake({ text: 'BASERA Library', language: 'en' }),
    });
    expect((await routing.recognize(img)).text).toBe('BASERA Library');
  });

  it('English preferred, Latin empty -> falls back to Arabic engine', async () => {
    const routing = new RoutingTextRecognizer('en', {
      latin: fake({ text: '' }),
      arabic: fake({ text: 'مواعيد العمل', language: 'ar' }),
    });
    expect((await routing.recognize(img)).text).toBe('مواعيد العمل');
  });

  it('Arabic preferred + Arabic engine unavailable + Latin empty -> engineNote', async () => {
    const routing = new RoutingTextRecognizer('ar', {
      arabic: fake(new OcrUnavailableError('no native module')),
      latin: fake({ text: '' }),
    });
    const r = await routing.recognize(img);
    expect(r.text).toBe('');
    expect(r.engineNote).toBe('arabic-unsupported');
  });

  it('both engines unavailable -> throws OcrUnavailableError', async () => {
    const routing = new RoutingTextRecognizer('en', {
      latin: fake(new OcrUnavailableError('no mlkit')),
      arabic: fake(new OcrUnavailableError('no tflite')),
    });
    await expect(routing.recognize(img)).rejects.toBeInstanceOf(OcrUnavailableError);
  });
});
