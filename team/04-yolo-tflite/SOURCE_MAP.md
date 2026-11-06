# 04 — Source Map: YOLO & TFLite

## Model asset

| Path | Facts |
|---|---|
| `assets/models/yolo11n.tflite` | YOLO11n, 10,656,588 bytes, SHA-256 begins `19bfdc3c…`, AGPL-3.0, COCO 80 classes |
| `scripts/verify_model.py` | Verifies the model file (shape/hash) outside the app |
| `scripts/convert_tflite.py` | The conversion helper used to produce/refresh TFLite assets |

## Pipeline code

| Path | Key exports | Role |
|---|---|---|
| `src/ai/ObjectDetector.ts` | `ObjectDetector` (interface), `YoloDetector` (id `yolo11n-tflite`), `DetectorUnavailableError`, `buildTensorFromJpegBase64()`, `prewarmYoloModel()` | Owns model loading (module-scope shared promise — one interpreter per process, failure clears it for retry) and the `detect()` flow |
| `src/ai/yoloPostprocess.ts` | `MODEL_INPUT_SIZE = 640`, `NUM_ANCHORS = 8400`, `NUM_CLASSES = 80`, `computeLetterbox()`, `decodeYoloOutput()` | Letterbox geometry + output decoding: confidence threshold 0.35, NMS IoU 0.45, max 30 detections |
| `src/ai/normalizeImage.ts` | `normalizeImage()` | Any picker format/URI → local JPEG, long edge ≤ 1280; format failures are typed errors |
| `src/ai/imagePreprocess.ts` | Preprocessing helpers used to build the input tensor | Pixel prep for the 640×640 input |
| `src/ai/cocoLabels.ts` | COCO class label table (EN + AR narration labels) | Maps class IDs to speakable names |
| `src/ai/types.ts` | `Detection`, `OcrResult`, shared AI types | The contract every consumer uses |
| `src/input/ImageSource.ts` | `CapturedImage` | What `detect()` receives — source-agnostic |

## Runtime

- Interpreter: `react-native-fast-tflite` (see `package.json`).
- The model loads lazily on first detection, or at startup via
  `prewarmYoloModel()` from `src/ai/warmUp.ts` (called by
  `src/app/_layout.tsx`).

## Consumers

- `src/app/detect.tsx` — detection screen.
- `src/ai/DescriptionBuilder.ts` — turns detections into spoken narration.
- `src/ai/ObstacleAwareness.ts` — position + proximity category per detection.
- `src/hazards/RiskEngine.ts` — risk candidates from detections (section 07).

## Tests and fixtures

| Path | Covers |
|---|---|
| `src/ai/__tests__/yolo.test.ts` | Post-processing: letterbox math, decoding, thresholds, NMS |
| `tests/fixtures/bus_raw_output.bin` | A real recorded raw model output used as a decode fixture |
| `src/ai/__tests__/logic.test.ts` | Shared AI logic incl. obstacle analysis |
