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

## OCR (Latin) — Google ML Kit Text Recognition

- **Library:** `@react-native-ml-kit/text-recognition` v2.0.0 (wraps Google
  ML Kit's on-device Text Recognition). Maintained RN binding for ML Kit
  text recognition (peer range covers RN 0.88).
- **Script scope — corrected 2026-10-30:** ML Kit text recognition has
  **NO Arabic model**. The library's `TextRecognitionScript` enum is
  Latin/Chinese/Devanagari/Japanese/Korean only (verified in the
  installed package's source and Android dependencies — there is no
  Arabic artifact). An earlier version of this document wrongly claimed
  Arabic support; that claim was never real. The app calls the
  recognizer **explicitly** with `TextRecognitionScript.LATIN`.
- Requires the full app build (native module); unavailable builds throw
  a typed `OcrUnavailableError` — OCR output is never faked.

## OCR (Arabic) — PP-OCR on-device (TFLite)

- **Engine:** PaddleOCR PP-OCR models running through
  `react-native-fast-tflite` (same runtime as YOLO), fully on-device.
  Implemented in `src/ai/ArabicOcrEngine.ts`; routing in
  `RoutingTextRecognizer` (Arabic UI → PP-OCR first, English UI → ML Kit
  first; each falls back to the other when the first finds no text).
- **Detection model:** `assets/models/ppocr_det.tflite` — PP-OCRv3
  detection model. 2,408,968 bytes.
  **SHA256: `04e8e0b61e08e400de3bbe78d9207cb6f92274363eac6301d83623792eb98050`**
  Fixed input NHWC `[1,960,960,3]`, output `[1,960,960,1]` probability map.
- **Recognition model:** `assets/models/ppocr_arabic_rec.tflite` —
  `arabic_PP-OCRv3_mobile_rec` (official PaddleOCR Arabic recognition
  weights; the PP-OCRv4 Arabic model's direct Paddle→ONNX conversion
  produced a graph onnxruntime cannot load, so the v3 mobile conversion
  is what ships — stated plainly, not relabelled). 8,960,168 bytes.
  **SHA256: `1fc31af5defdba73054e6c124bedbc06587cd4ee95952eaf33976f28937d531e`**
  Fixed input NHWC `[1,48,640,3]`, output `[1,160,163]` CTC logits.
- **Conversion chain:** official PaddleOCR weights → ONNX conversions
  (`monkt/paddleocr-onnx`, of the same official weights; the Arabic
  dictionary shipped with it is byte-identical to PaddleOCR's official
  `arabic_dict.txt`, 161 entries) → `onnx2tf` float32 TFLite → tensor
  shapes pinned to the fixed sizes above by flatbuffer editing
  (`react-native-fast-tflite` cannot resize input tensors, so dynamic
  shapes cannot be fed from JS).
- **Dictionary / CTC:** class 0 = blank, classes 1–161 = official
  `arabic_dict.txt`, class 162 = space. Greedy decode in TypeScript.
- **Pre/post-processing:** detection preprocessing uses ImageNet
  mean/std normalization on a fit-inside-960 canvas; box extraction is
  pure TS (threshold 0.3 → connected components → boxes expanded
  vertically ×0.6 height / horizontally ×0.05 width — tight boxes clip
  Arabic ascenders and dots — merged into lines, top-to-bottom).
  Recognition crops are resized to height 48 (squashed to width 640 if
  wider) on a zero-filled canvas, normalized `(p/255 − 0.5)/0.5`.
- **Delegate requirement:** plain CPU only — do NOT enable XNNPACK for
  these models (the XNNPACK delegate fails to prepare the recognition
  graph; the host gate mirrors fast-tflite's default CPU path).
- **Host verification (mandatory gate, PASSED):** the shipped TFLite
  files, run through the TF Lite interpreter with no input resizing,
  recover the bundled sample `assets/samples/text-arabic.png` (known
  text: مكتبة بصيرة / مواعيد العمل / من الأحد إلى الخميس) with
  **0.730 character overlap** (gate ≥ 0.70). Jest asserts the TS box
  extraction and CTC decode reproduce the recorded real model outputs
  (`tests/fixtures/ppocr_*`).
- **Honest accuracy note:** this is a small mobile recognition model.
  On the sample it confuses some dotted letters (e.g. ة → ق). It is a
  real Arabic OCR, not a perfect one; empty output is returned as
  empty, never invented.
- **License:** PaddleOCR models are Apache-2.0 (PaddlePaddle).

## Speech

- **TTS:** `expo-speech` (device TTS). Arabic requested as `ar-EG`
  (device falls back to its Arabic voice, typically `ar-SA`), English
  `en-US`. Rate adjustable 0.5–2.0. Repeat semantics (2026-10-30):
  `speak()` marks a repeatable response; `speakAnnouncement()` speaks
  greetings/status without overwriting the repeat target.
- **Speech recognition (voice commands):** `expo-speech-recognition`
  v58.0.1 (platform recognizer, `ar-EG` / `en-US`), migrated 2026-10-30
  from the archived `@react-native-voice/voice` (removed completely —
  it broke Gradle configuration). Requires the full app build. Command
  *parsing* is pure TypeScript and fully unit-tested independently of
  the recognizer. Native errors are mapped to typed kinds and shown
  localized — never as raw English in Arabic mode.

## Sample images

See `assets/samples/README.md` for provenance of every bundled image.
