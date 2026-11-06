/**
 * Object detection service.
 *
 * Implementation: YoloDetector runs the bundled YOLO11n TFLite model fully
 * on-device via react-native-fast-tflite (Nitro). No cloud, no fake results:
 * if the native interpreter is unavailable (e.g. Expo Go / web), detect()
 * throws a typed error instead of inventing detections.
 *
 * Model: yolo11n.tflite converted from the official Ultralytics
 * yolo11n.onnx asset — provenance + SHA256 in docs/MODELS.md.
 */
import type { CapturedImage } from '../input/ImageSource';
import { decodeBase64 } from './base64';
import { buildInputTensor } from './imagePreprocess';
import { classifyImageError, ImagePipelineError, normalizeImage } from './normalizeImage';
import type { LetterboxInfo } from './yoloPostprocess';
import type { Detection } from './types';

export interface ObjectDetector {
  readonly id: string;
  detect(image: CapturedImage): Promise<Detection[]>;
}

export class DetectorUnavailableError extends Error {
  readonly code = 'DETECTOR_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'DetectorUnavailableError';
  }
}

/**
 * JPEG bytes (as base64) -> YOLO input tensor.
 *
 * This is the exact decode-input step detect() runs on device. It must
 * never touch `Buffer` or `atob`: React Native/Hermes provides neither
 * reliably, which is why detection previously threw on real devices while
 * passing under Node/jest. Exported for the no-globals regression test.
 */
export function buildTensorFromJpegBase64(base64: string, letterbox: LetterboxInfo): Float32Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jpeg = require('jpeg-js');
  let decoded: { width: number; height: number; data: Uint8Array } | null | undefined;
  try {
    const bytes = decodeBase64(base64);
    decoded = jpeg.decode(bytes, { useTArray: true });
  } catch (e) {
    // jpeg-js throws raw errors ("SOI not found", …) on PNG/corrupt
    // bytes. A decode failure is an IMAGE problem, not a model problem:
    // surface it typed so the UI can say "choose another photo".
    throw new ImagePipelineError(
      'decode-failed',
      `Could not decode the selected image for detection. (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!decoded?.data) {
    throw new ImagePipelineError(
      'decode-failed',
      'Could not decode the selected image for detection.',
    );
  }
  return buildInputTensor(
    { width: decoded.width, height: decoded.height, data: decoded.data, channels: 4 },
    letterbox,
  );
}

// The bundled model asset. Metro resolves .tflite via metro.config.js.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET: number = require('../../assets/models/yolo11n.tflite');

// The loaded model is shared by every detector instance (module
// level), so a startup prewarm benefits the detect screen's own
// instance. A failed load clears the promise so the next detect
// retries, exactly as the previous per-instance behaviour did.
let sharedModelPromise: Promise<any> | null = null;

function loadSharedModel(): Promise<any> {
  if (!sharedModelPromise) {
    sharedModelPromise = (async () => {
      try {
        // Required lazily so jest / web never load the native module.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const tflite = require('react-native-fast-tflite');
        const model = await tflite.loadTensorflowModel(MODEL_ASSET);
        return model;
      } catch (e) {
        sharedModelPromise = null;
        throw new DetectorUnavailableError(
          'On-device YOLO interpreter is unavailable in this build. Object detection needs the BASERA development build (native TFLite module); it does not run in Expo Go or web. ' +
            `(${e instanceof Error ? e.message : String(e)})`,
        );
      }
    })();
  }
  return sharedModelPromise;
}

/** Latency: start loading the YOLO model in the background (app
 *  startup) so the first user-triggered detection does not pay the
 *  full interpreter load. Failures are swallowed here; detect()
 *  surfaces them properly when the user actually detects. */
export function prewarmYoloModel(): void {
  void loadSharedModel().catch(() => undefined);
}

export class YoloDetector implements ObjectDetector {
  readonly id = 'yolo11n-tflite';

  private async loadModel(): Promise<any> {
    return loadSharedModel();
  }

  async detect(image: CapturedImage): Promise<Detection[]> {
    // Lazy native / imaging imports — keep module import side-effect free.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system');
    const { computeLetterbox, decodeYoloOutput, MODEL_INPUT_SIZE } = await import('./yoloPostprocess');

    // Normalize FIRST: any picker format/URI (PNG/WebP/HEIC, content://,
    // huge) becomes a local JPEG with the long edge ≤1280, and format
    // failures surface as typed unsupported-format errors.
    const normalized = await normalizeImage(image);

    // Letterbox is computed from the NORMALIZED dimensions — that is
    // the image the model actually sees.
    const letterbox = computeLetterbox(normalized.width, normalized.height);
    const resizedW = Math.round(normalized.width * letterbox.scale);
    const resizedH = Math.round(normalized.height * letterbox.scale);

    let resized: { uri: string };
    try {
      resized = await manipulateAsync(
        normalized.uri,
        [{ resize: { width: resizedW, height: resizedH } }],
        { format: SaveFormat.JPEG, compress: 1 },
      );
    } catch (e) {
      throw classifyImageError(e);
    }

    const base64: string = await FileSystem.readAsStringAsync(resized.uri, {
      encoding: 'base64',
    });
    // Throws ImagePipelineError('decode-failed') on undecodable bytes;
    // interpreter-load failure below stays DetectorUnavailableError.
    const tensor = buildTensorFromJpegBase64(base64, letterbox);

    const model = await this.loadModel();
    const outputs = await model.run([tensor]);
    const raw: ArrayLike<number> = outputs[0];
    void MODEL_INPUT_SIZE;
    return decodeYoloOutput(raw, letterbox, { confidenceThreshold: 0.35 });
  }
}
