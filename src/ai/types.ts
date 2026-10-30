/** Shared AI types for BASERA. */

export interface BoundingBox {
  /** All coordinates are normalized to 0..1 relative to the original image. */
  x: number; // left
  y: number; // top
  width: number;
  height: number;
}

export interface Detection {
  labelEn: string;
  labelAr: string;
  classId: number;
  confidence: number; // 0..1
  box: BoundingBox;
}

export type AppLanguage = 'ar' | 'en';

export interface OcrResult {
  text: string;
  /** Best-effort detected language: 'ar' | 'en' | 'mixed' | 'unknown' */
  language: 'ar' | 'en' | 'mixed' | 'unknown';
  blocks: { text: string }[];
  /**
   * Set when Arabic was requested but the Arabic engine is unavailable
   * in this build, so the UI can say so honestly instead of showing a
   * generic "no text found".
   */
  engineNote?: 'arabic-unsupported';
}
