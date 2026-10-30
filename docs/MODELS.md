# Models & AI engines

## Object detection — YOLO11n (TFLite)

- **Model:** YOLO11n (nano), COCO-80 classes, Ultralytics — the current
  nano generation (successor of YOLOv8n, same output format).
- **Upstream artifact (exact):**
  `https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.onnx`
  — an official Ultralytics release asset.
  **SHA256: `634279b40c07c6391472c51ad45b81ebc48706a9a1fe72dd3396322acd0c053b`**
  (verified by `scripts/verify_model.py`, which refuses to run on a
  hash mismatch). Note: the assets release ships `.pt` + `.onnx` for this
  model — no prebuilt `.tflite` exists there (verified via the GitHub API
  and a 404 download attempt), so the TFLite is converted locally.
- **Shipped artifact:** `assets/models/yolo11n.tflite`, converted from the
  official ONNX above with `onnx2tf` (float32, fixed 1×3×640×640 input) by
  `scripts/convert_tflite.py`, which also runs the converted TFLite on a
  sample photo to verify it (top detection: bus, 0.939 — identical to the
  ONNX reference). **SHA256:
  `19bfdc3cf16231b1d6d5604d245e934a5eeef5300fb3d04595b2dc92b69b5997`**
  (10,656,588 bytes; also in `tests/fixtures/model_provenance.json`).
- **License:** Ultralytics models are AGPL-3.0 (fine for a graduation /
  academic project; commercial use needs an Ultralytics enterprise
  licence). Stated honestly for the project report.
- **Input tensor:** float32 `[1, 3, 640, 640]`, RGB, 0..1, letterboxed
  (grey 114 padding).
- **Output tensor:** float32 `[1, 84, 8400]` — 4 box coords (cx, cy, w, h in
  640-space) + 80 class scores. Decoded by `src/ai/yoloPostprocess.ts`
  (confidence ≥ 0.35, class-aware NMS IoU 0.45).
- **Runtime:** `react-native-fast-tflite` v3 (Nitro) — the maintained
  TFLite binding for the New Architecture in RN 0.88 / Expo SDK 58.
  Requires the development build (not Expo Go).
- **Host verification:** `scripts/verify_model.py` runs the official ONNX
  with onnxruntime on the bundled photos (street scene: bus 0.94 + four
  people; people photo: two people + tie). Jest then asserts the
  TypeScript decode+NMS reproduces the Python reference detections from
  the recorded raw tensor — see TESTING.md.

## OCR — Google ML Kit Text Recognition

- **Library:** `@react-native-ml-kit/text-recognition` v2.0.0 (wraps Google
  ML Kit's on-device Text Recognition). Checked on npm: it is the
  maintained RN binding for ML Kit text recognition (peer range covers
  RN 0.88); ML Kit provides Arabic-script + Latin recognizers on-device
  and offline.
- Requires the development build (native module); unavailable builds throw
  a typed `OcrUnavailableError` — OCR output is never faked.

## Speech

- **TTS:** `expo-speech` (device TTS). Arabic requested as `ar-EG`
  (device falls back to its Arabic voice, typically `ar-SA`), English
  `en-US`. Rate adjustable 0.5–2.0.
- **Speech recognition (voice commands):** `@react-native-voice/voice`
  v3.2.4 (platform recognizer, `ar-EG` / `en-US`). Requires the
  development build. Command *parsing* is pure TypeScript and fully
  unit-tested independently of the recognizer.

## Sample images

See `assets/samples/README.md` for provenance of every bundled image.
