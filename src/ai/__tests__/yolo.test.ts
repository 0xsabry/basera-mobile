/**
 * End-to-end post-processing proof: feeds the REAL recorded YOLOv8n output
 * tensor for assets/samples/street-bus.jpg (produced by
 * scripts/verify_model.py with onnxruntime) through the TypeScript
 * decode+NMS and asserts it reproduces the Python reference detections.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeLetterbox, decodeYoloOutput } from '../yoloPostprocess';

const fixturesDir = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures');

interface RefDetection {
  classId: number;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}

function loadReference(): { origWidth: number; origHeight: number; detections: RefDetection[] } {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, 'bus_reference.json'), 'utf8'));
}

describe('YOLO decode + NMS vs real Python reference (street-bus.jpg)', () => {
  const ref = loadReference();
  const bin = fs.readFileSync(path.join(fixturesDir, 'bus_raw_output.bin'));
  const raw = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const letterbox = computeLetterbox(ref.origWidth, ref.origHeight);
  const tsDetections = decodeYoloOutput(raw, letterbox, { confidenceThreshold: 0.35 });

  it('raw tensor has the expected [84, 8400] size', () => {
    expect(raw.length).toBe(84 * 8400);
  });

  it('finds the same number of detections as the Python reference', () => {
    expect(ref.detections.length).toBeGreaterThan(0);
    expect(tsDetections.length).toBe(ref.detections.length);
  });

  it('matches reference labels, confidences and boxes', () => {
    const sorted = [...tsDetections].sort((a, b) => b.confidence - a.confidence);
    ref.detections.forEach((expected, i) => {
      const got = sorted[i];
      expect(got.classId).toBe(expected.classId);
      expect(got.confidence).toBeCloseTo(expected.confidence, 4);
      expect(got.box.x).toBeCloseTo(expected.box.x, 3);
      expect(got.box.y).toBeCloseTo(expected.box.y, 3);
      expect(got.box.width).toBeCloseTo(expected.box.width, 3);
      expect(got.box.height).toBeCloseTo(expected.box.height, 3);
    });
  });

  it('detects the bus and at least one person in the street scene', () => {
    const labels = tsDetections.map((d) => d.labelEn);
    expect(labels).toContain('bus');
    expect(labels).toContain('person');
  });

  it('rejects an undersized output tensor', () => {
    expect(() => decodeYoloOutput(new Float32Array(10), letterbox)).toThrow();
  });

  it('confidence threshold filters weak detections', () => {
    const strict = decodeYoloOutput(raw, letterbox, { confidenceThreshold: 0.9 });
    expect(strict.length).toBeLessThanOrEqual(tsDetections.length);
    strict.forEach((d) => expect(d.confidence).toBeGreaterThanOrEqual(0.9));
  });
});

describe('computeLetterbox', () => {
  it('pads a portrait image on the sides', () => {
    const lb = computeLetterbox(810, 1080);
    expect(lb.padX).toBeGreaterThan(0);
    expect(lb.padY).toBeCloseTo(0, 5);
  });
  it('pads a landscape image top/bottom', () => {
    const lb = computeLetterbox(1280, 720);
    expect(lb.padY).toBeGreaterThan(0);
    expect(lb.padX).toBeCloseTo(0, 5);
  });
});
