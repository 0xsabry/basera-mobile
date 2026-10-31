/**
 * Bug 3 — source-level permission errors are TYPED.
 *
 * Gallery/camera sources used to throw a raw `Error('PERMISSION_DENIED:x')`
 * that screens pattern-matched by string prefix. They now throw
 * ImagePipelineError(kind='permission-denied') (message prefix retained).
 * The native picker is mocked with permission denied.
 */
import { classifyImageError, ImagePipelineError } from '../../ai/normalizeImage';
import { GalleryImageSource } from '../GalleryImageSource';
import { PhoneCameraTestSource } from '../PhoneCameraTestSource';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: false }),
  requestCameraPermissionsAsync: async () => ({ granted: false }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  launchCameraAsync: async () => ({ canceled: true, assets: [] }),
}));

describe('image sources with permission denied (picker mocked)', () => {
  it('gallery throws ImagePipelineError kind permission-denied, prefix kept', async () => {
    const caught: unknown = await new GalleryImageSource().getImage().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ImagePipelineError);
    expect((caught as ImagePipelineError).kind).toBe('permission-denied');
    expect((caught as Error).message).toBe('PERMISSION_DENIED:gallery');
    expect(classifyImageError(caught).kind).toBe('permission-denied');
  });

  it('camera throws ImagePipelineError kind permission-denied, prefix kept', async () => {
    const caught: unknown = await new PhoneCameraTestSource().getImage().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ImagePipelineError);
    expect((caught as ImagePipelineError).kind).toBe('permission-denied');
    expect((caught as Error).message).toBe('PERMISSION_DENIED:camera');
    expect(classifyImageError(caught).kind).toBe('permission-denied');
  });
});
