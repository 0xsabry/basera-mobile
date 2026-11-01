import { buildDescription } from '../DescriptionBuilder';
import { buildInputTensor } from '../imagePreprocess';
import { analyzeObstacles, horizontalPosition, proximityCategory } from '../ObstacleAwareness';
import { detectTextLanguage } from '../TextRecognizer';
import type { Detection } from '../types';
import { computeLetterbox } from '../yoloPostprocess';

function det(labelEn: string, labelAr: string, classId: number, box: Detection['box'], confidence = 0.9): Detection {
  return { labelEn, labelAr, classId, confidence, box };
}

const personCenter = det('person', 'شخص', 0, { x: 0.35, y: 0.02, width: 0.3, height: 0.95 });
const chairLeft = det('chair', 'كرسي', 56, { x: 0.02, y: 0.5, width: 0.2, height: 0.3 });
const chairRight = det('chair', 'كرسي', 56, { x: 0.8, y: 0.5, width: 0.15, height: 0.3 });
const carFar = det('car', 'سيارة', 2, { x: 0.45, y: 0.4, width: 0.08, height: 0.06 });

describe('DescriptionBuilder', () => {
  it('EN: person in front comes first, counts grouped', () => {
    const s = buildDescription([chairLeft, personCenter, chairRight], 'en');
    expect(s).toContain('person');
    expect(s).toContain('in front of you');
    expect(s).toContain('2 chairs');
    expect(s.indexOf('person')).toBeLessThan(s.indexOf('chairs'));
  });
  it('AR: produces real Arabic with position words', () => {
    const s = buildDescription([personCenter, chairLeft], 'ar');
    expect(s).toContain('شخص');
    expect(s).toContain('قدامك');
    expect(s).toContain('كرسي');
    expect(s).toContain('على شمالك');
  });
  it('empty detections -> honest fallback in both languages', () => {
    expect(buildDescription([], 'en')).toContain('could not recognize');
    expect(buildDescription([], 'ar')).toContain('مش شايف');
  });
});

describe('ObstacleAwareness', () => {
  it('positions from bbox center', () => {
    expect(horizontalPosition(chairLeft)).toBe('left');
    expect(horizontalPosition(personCenter)).toBe('center');
    expect(horizontalPosition(chairRight)).toBe('right');
  });
  it('proximity is a category, never meters', () => {
    expect(proximityCategory(personCenter)).toBe('near'); // area 0.285 of frame
    expect(['near', 'medium', 'far']).toContain(proximityCategory(carFar));
    expect(proximityCategory(carFar)).toBe('far');
  });
  it('analyzeObstacles sorts largest first', () => {
    const out = analyzeObstacles([carFar, chairLeft]);
    expect(out[0].detection.labelEn).toBe('chair');
  });
});

describe('detectTextLanguage', () => {
  it('detects Arabic, English, mixed, unknown', () => {
    expect(detectTextLanguage('مرحبا بالعالم')).toBe('ar');
    expect(detectTextLanguage('Hello world')).toBe('en');
    expect(detectTextLanguage('Hello مرحبا')).toBe('mixed');
    expect(detectTextLanguage('12345')).toBe('unknown');
    expect(detectTextLanguage('')).toBe('unknown');
  });
});

describe('buildInputTensor', () => {
  it('produces 3x640x640 normalized tensor with grey padding', () => {
    const lb = computeLetterbox(100, 100);
    const img = { width: 640, height: 640, data: new Uint8Array(640 * 640 * 4).fill(255), channels: 4 as const };
    const tensor = buildInputTensor(img, lb);
    expect(tensor.length).toBe(3 * 640 * 640);
    expect(tensor[0]).toBeCloseTo(1, 5);
  });
  it('pads letterbox area with 114/255', () => {
    const lb = computeLetterbox(1280, 720); // padY = 140
    const img = { width: 640, height: 360, data: new Uint8Array(640 * 360 * 4).fill(0), channels: 4 as const };
    const tensor = buildInputTensor(img, lb);
    expect(tensor[0]).toBeCloseTo(114 / 255, 4); // top-left is padding
  });
});
