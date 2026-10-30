import {
  ImageSourceNotAvailableError,
  type CapturedImage,
  type ImageSource,
} from './ImageSource';

/**
 * FUTURE INTEGRATION POINT — smart glasses camera.
 *
 * The BASERA smart glasses have NOT been built yet. This class exists so the
 * rest of the app already depends on the final interface. It deliberately
 * returns a typed "not available" error: it produces NO fake frames, NO fake
 * Bluetooth/Wi-Fi connection, and NO simulated camera feed.
 *
 * When hardware exists, the glasses team implements the frame delivery
 * described in docs/GLASSES_INTEGRATION.md behind this class (or a sibling
 * implementation) and the rest of the app needs no changes.
 */
export class SmartGlassesCameraSource implements ImageSource {
  readonly id = 'smart-glasses';
  readonly kind = 'smart-glasses' as const;

  async getImage(): Promise<CapturedImage | null> {
    throw new ImageSourceNotAvailableError(
      'Smart glasses are not connected. The glasses hardware is still in development; use gallery, samples, or the phone camera test input for now.',
      'smart-glasses',
    );
  }
}
