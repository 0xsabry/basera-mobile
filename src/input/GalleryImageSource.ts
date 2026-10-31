import * as ImagePicker from 'expo-image-picker';
import { ImagePipelineError } from '../ai/normalizeImage';
import type { CapturedImage, ImageSource } from './ImageSource';

/** Pick an existing photo from the phone's gallery. */
export class GalleryImageSource implements ImageSource {
  readonly id = 'gallery';
  readonly kind = 'gallery' as const;

  async getImage(): Promise<CapturedImage | null> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      // Typed error (message prefix kept for any legacy prefix mapper).
      throw new ImagePipelineError('permission-denied', 'PERMISSION_DENIED:gallery');
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      sourceKind: 'gallery',
    };
  }
}
