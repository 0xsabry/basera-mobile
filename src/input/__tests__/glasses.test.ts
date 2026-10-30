import { ImageSourceNotAvailableError } from '../ImageSource';
import { SmartGlassesCameraSource } from '../SmartGlassesCameraSource';

describe('SmartGlassesCameraSource (future hardware)', () => {
  it('implements the ImageSource interface', () => {
    const src = new SmartGlassesCameraSource();
    expect(src.id).toBe('smart-glasses');
    expect(src.kind).toBe('smart-glasses');
    expect(typeof src.getImage).toBe('function');
  });

  it('returns a typed NotAvailable error — never fake frames', async () => {
    const src = new SmartGlassesCameraSource();
    await expect(src.getImage()).rejects.toBeInstanceOf(ImageSourceNotAvailableError);
    await expect(src.getImage()).rejects.toMatchObject({
      code: 'IMAGE_SOURCE_NOT_AVAILABLE',
      sourceKind: 'smart-glasses',
    });
  });
});
