/**
 * OCR service — Google ML Kit Text Recognition (on-device).
 *
 * Engine: @react-native-ml-kit/text-recognition, which wraps ML Kit's
 * bundled text recognition models. ML Kit ships script-specific models;
 * the library's default recognizer covers Latin + Arabic script in recent
 * ML Kit versions. All processing is on-device and offline.
 *
 * If the native module is missing (Expo Go / web), recognize() throws a
 * typed error — it NEVER returns invented text.
 */
import type { CapturedImage } from '../input/ImageSource';
import type { OcrResult } from './types';

export interface TextRecognizer {
  readonly id: string;
  recognize(image: CapturedImage): Promise<OcrResult>;
}

export class OcrUnavailableError extends Error {
  readonly code = 'OCR_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}

/** Pure helper: guess the written language of extracted text. Unit-tested. */
export function detectTextLanguage(text: string): OcrResult['language'] {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return 'unknown';
  if (arabic > 0 && latin > 0) return 'mixed';
  return arabic > 0 ? 'ar' : 'en';
}

export class MlKitTextRecognizer implements TextRecognizer {
  readonly id = 'mlkit-text-recognition';

  async recognize(image: CapturedImage): Promise<OcrResult> {
    let TextRecognition: { recognize: (uri: string) => Promise<{ text: string; blocks?: { text: string }[] }> };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      TextRecognition = require('@react-native-ml-kit/text-recognition').default;
    } catch (e) {
      throw new OcrUnavailableError(
        'ML Kit OCR is unavailable in this build. Text recognition needs the BASERA development build (native ML Kit module); it does not run in Expo Go or web. ' +
          `(${e instanceof Error ? e.message : String(e)})`,
      );
    }
    const result = await TextRecognition.recognize(image.uri);
    const text = (result?.text ?? '').trim();
    return {
      text,
      language: detectTextLanguage(text),
      blocks: (result?.blocks ?? []).map((b) => ({ text: b.text })),
    };
  }
}
