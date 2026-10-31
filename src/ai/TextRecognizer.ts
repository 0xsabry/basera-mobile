/**
 * OCR service — Google ML Kit Text Recognition (on-device).
 *
 * Engine: @react-native-ml-kit/text-recognition, which wraps ML Kit's
 * bundled text recognition models. HONEST SCOPE: ML Kit text recognition
 * has NO Arabic model — the library's TextRecognitionScript enum covers
 * Latin, Chinese, Devanagari, Japanese and Korean only. This recognizer
 * therefore calls the Latin script EXPLICITLY and handles Latin-script
 * text (English, French, numbers, …). Arabic text is handled by a
 * separate engine (see docs/FEATURE_STATUS.md); this class never pretends
 * to read Arabic. All processing is on-device and offline.
 *
 * If the native module is missing (Expo Go / web), recognize() throws a
 * typed error — it NEVER returns invented text.
 */
import type { CapturedImage } from '../input/ImageSource';
import { normalizeImage } from './normalizeImage';
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

interface MlKitModule {
  default: {
    recognize: (
      uri: string,
      script: string,
    ) => Promise<{ text: string; blocks?: { text: string }[] }>;
  };
  TextRecognitionScript: { LATIN: string };
}

export class MlKitTextRecognizer implements TextRecognizer {
  readonly id = 'mlkit-text-recognition-latin';

  async recognize(image: CapturedImage): Promise<OcrResult> {
    let mod: MlKitModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('@react-native-ml-kit/text-recognition') as MlKitModule;
    } catch (e) {
      throw new OcrUnavailableError(
        'ML Kit OCR is unavailable in this build. Text recognition needs the BASERA development build (native ML Kit module); it does not run in Expo Go or web. ' +
          `(${e instanceof Error ? e.message : String(e)})`,
      );
    }
    // Normalize first: ML Kit gets a local JPEG (long edge ≤1280), not
    // the raw picker URI (content://, HEIC/WebP, or a huge original it
    // may fail to resolve or load). Format failures surface typed.
    const normalized = await normalizeImage(image);
    // Explicit Latin script — never rely on library defaults, and never
    // claim Arabic support ML Kit does not have.
    const result = await mod.default.recognize(normalized.uri, mod.TextRecognitionScript.LATIN);
    const text = (result?.text ?? '').trim();
    return {
      text,
      language: detectTextLanguage(text),
      blocks: (result?.blocks ?? []).map((b) => ({ text: b.text })),
    };
  }
}

/**
 * Routes OCR by the user's language: Arabic -> PP-OCR engine first,
 * Latin -> ML Kit first. If the primary engine returns no text, the
 * other engine gets a chance (an Arabic sign photographed while the UI
 * is in English still reads, and vice versa). Engine *unavailability*
 * (native module missing) falls through to the other engine; if Arabic
 * was preferred and its engine is unavailable and nothing was found,
 * the result carries engineNote='arabic-unsupported' so the UI can be
 * honest about it.
 */
export class RoutingTextRecognizer implements TextRecognizer {
  readonly id = 'routing-ocr';
  private readonly latin: TextRecognizer;
  private readonly arabic: TextRecognizer;
  /**
   * True only for the real (default) engines. Injected engines are an
   * explicit seam (tests / custom engines): they receive the caller's
   * image untouched and own their input handling. The default pipeline
   * normalizes once here so BOTH real engines — including the Arabic
   * PP-OCR engine, which has no normalization of its own — run on the
   * same local JPEG instead of the raw picker URI.
   */
  private readonly usesDefaultEngines: boolean;

  constructor(
    private readonly preferred: 'ar' | 'en',
    engines?: { latin: TextRecognizer; arabic: TextRecognizer },
  ) {
    // Lazy require to avoid a module cycle (ArabicOcrEngine imports
    // OcrUnavailableError from this file).
    if (engines) {
      this.latin = engines.latin;
      this.arabic = engines.arabic;
      this.usesDefaultEngines = false;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ArabicOcrEngine } = require('./ArabicOcrEngine');
      this.latin = new MlKitTextRecognizer();
      this.arabic = new ArabicOcrEngine();
      this.usesDefaultEngines = true;
    }
  }

  async recognize(image: CapturedImage): Promise<OcrResult> {
    // Normalize before routing (default engines only — see above).
    // A normalization failure is an image error, not engine
    // unavailability, so it propagates typed instead of falling through.
    const img = this.usesDefaultEngines ? await normalizeImage(image) : image;
    const order =
      this.preferred === 'ar'
        ? ([['arabic', this.arabic], ['latin', this.latin]] as const)
        : ([['latin', this.latin], ['arabic', this.arabic]] as const);
    const unavailable = { arabic: false, latin: false };
    let firstUnavailableError: OcrUnavailableError | null = null;
    for (const [kind, engine] of order) {
      try {
        const r = await engine.recognize(img);
        if (r.text) return r;
      } catch (e) {
        if (e instanceof OcrUnavailableError) {
          unavailable[kind] = true;
          if (!firstUnavailableError) firstUnavailableError = e;
        } else {
          throw e;
        }
      }
    }
    // No text found. If NO engine could run at all, surface the honest
    // unavailability error instead of a misleading empty result.
    if (unavailable.arabic && unavailable.latin && firstUnavailableError) {
      throw firstUnavailableError;
    }
    // Arabic preferred but its engine could not run (Latin ran, found
    // nothing): tell the UI so it can say Arabic is unsupported here.
    if (this.preferred === 'ar' && unavailable.arabic) {
      return { text: '', language: 'unknown', blocks: [], engineNote: 'arabic-unsupported' };
    }
    return { text: '', language: 'unknown', blocks: [] };
  }
}
