import * as ImagePicker from 'expo-image-picker';
import type { CapturedImage, ImageSource } from './ImageSource';

/**
 * TEMPORARY TEST INPUT ONLY.
 *
 * The phone camera exists in BASERA solely so the team can test the AI
 * pipeline before the smart-glasses hardware exists. It is NOT the product's
 * camera architecture, and the UI labels it as a test input everywhere.
 * When the glasses arrive, SmartGlassesCameraSource replaces this source.
 */
export class PhoneCameraTestSource implements ImageSource {
  readonly id = 'phone-camera-test';
  readonly kind = 'phone-camera-test' as const;

  async getImage(): Promise<CapturedImage | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new Error('PERMISSION_DENIED:camera');
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      sourceKind: 'phone-camera-test',
    };
  }
}
