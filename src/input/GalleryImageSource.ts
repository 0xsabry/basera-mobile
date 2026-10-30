import * as ImagePicker from 'expo-image-picker';
import type { CapturedImage, ImageSource } from './ImageSource';

/** Pick an existing photo from the phone's gallery. */
export class GalleryImageSource implements ImageSource {
  readonly id = 'gallery';
  readonly kind = 'gallery' as const;

  async getImage(): Promise<CapturedImage | null> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw new Error('PERMISSION_DENIED:gallery');
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
