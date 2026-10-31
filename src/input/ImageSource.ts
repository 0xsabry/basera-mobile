/**
 * Image input abstraction — the heart of BASERA's future-proofing.
 *
 * Every way of obtaining an image implements `ImageSource`. Today:
 * gallery and the phone camera (TEST ONLY). Tomorrow the smart
 * glasses will be added as one more implementation of this exact
 * interface — no screen or AI code changes. See docs/GLASSES_INTEGRATION.md.
 * (The bundled sample photos were removed by owner order 2026-10-31.)
 */

// 'sample' has no producer anymore (removed 2026-10-31); it stays in
// the union ONLY so history rows stored by older versions — which
// record the source kind — remain valid data.
export type ImageSourceKind = 'gallery' | 'sample' | 'phone-camera-test' | 'smart-glasses';

export interface CapturedImage {
  uri: string;
  width: number;
  height: number;
  sourceKind: ImageSourceKind;
}

export interface ImageSource {
  readonly id: string;
  readonly kind: ImageSourceKind;
  /** Returns null when the user cancels (where cancellation is possible). */
  getImage(): Promise<CapturedImage | null>;
}

/** Typed error for sources whose hardware does not exist / is not connected. */
export class ImageSourceNotAvailableError extends Error {
  readonly code = 'IMAGE_SOURCE_NOT_AVAILABLE';
  constructor(
    message: string,
    readonly sourceKind: ImageSourceKind,
  ) {
    super(message);
    this.name = 'ImageSourceNotAvailableError';
  }
}
