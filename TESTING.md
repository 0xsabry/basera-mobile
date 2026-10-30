# BASERA — Testing & Verification Report

Environment: Node 24.22.1, npm 10.9.4, Python 3.12 venv at
`~/workspace/.scratch-basera/venv` (onnxruntime 1.31.1, tensorflow-cpu
2.21.0, onnx2tf 2.6.9, opencv-headless). No Android emulator or physical
device was available in this environment.

## Quality gates — actual results

| Gate | Result |
|---|---|
| `npm install` | ✅ succeeds (package-lock.json present) |
| `npx tsc --noEmit` | ✅ clean, 0 errors |
| `npx expo lint` | ✅ 0 errors (warnings cleaned to 0 in final pass) |
| `npx jest` | ✅ **6 suites, 44 tests, all pass** |
| `npx expo export --platform android` | ✅ succeeds — bundle 2.7 MB, dist 14 MB incl. the 10.6 MB TFLite asset |
| `npx expo export --platform web` | ✅ succeeds (dist-web/) — UI/navigation only; native AI modules report unavailable there, by design |
| Python model verification | ✅ see below |
| Android debug APK (gradle) | ❌ blocked — see "Build attempt" |
| Screenshots | ❌ not feasible — no headless browser/emulator exists in this sandbox (checked: no chromium/firefox/playwright). Not fabricated. |

## Python model verification (scripts/verify_model.py) — real outputs

Official model downloaded and hash-checked on every run:
`yolo11n.onnx` SHA256 `634279b40c07c6391472c51ad45b81ebc48706a9a1fe72dd3396322acd0c053b`
(script aborts on mismatch).

Detections on the bundled samples (onnxruntime, conf ≥ 0.35):

- `street-bus.jpg` (810×1080): **5 detections** — bus 0.939, person 0.902,
  person 0.849, person 0.833, person 0.399
- `people.jpg` (1280×720): **3 detections** — person 0.858, person 0.788,
  tie 0.484

Fixtures saved: `tests/fixtures/bus_raw_output.bin` (raw [84,8400] float32
tensor), `bus_reference.json`, `zidane_reference.json`,
`model_provenance.json`.

## Jest proof of the app pipeline

The `yolo.test.ts` suite feeds the recorded REAL raw tensor through the
app's own TypeScript `decodeYoloOutput` (decode + confidence filter +
class-aware NMS) and asserts label-by-label, confidence (±1e-4) and box
(±1e-3) equality with the Python reference — it passes. Other suites cover:
description builder (AR+EN), obstacle position/proximity, OCR language
detection, input-tensor letterboxing, voice command parser (AR+EN,
implemented vs planned vs unknown), history store (add/list/remove/clear,
50-item cap, corrupt-storage recovery), settings persistence + theme
resolution, and `SmartGlassesCameraSource` returning the typed
NotAvailable error.

## Shipped TFLite verified directly (scripts/convert_tflite.py)

The converted `assets/models/yolo11n.tflite`
(SHA256 `19bfdc3cf16231b1d6d5604d245e934a5eeef5300fb3d04595b2dc92b69b5997`,
10,656,588 bytes, input [1,3,640,640] float32, output [1,84,8400] float32)
was run with the TFLite interpreter on `street-bus.jpg`: top detection
**class 5 (bus), confidence 0.939** — identical to the ONNX reference.
Note: onnx2tf's optimizer rewrites its input file in place, so the script
converts a throwaway copy and the pristine download stays hash-verified.

## Build attempt (Android debug APK)

`npx expo prebuild --platform android` ✅ succeeded (android/ project
generated). `gradle assembleDebug` ❌ failed twice in this sandbox:
the Gradle daemon starts but the client cannot connect to it
("A new daemon was started but could not be connected to" / with
`--no-daemon`: "The first result from the daemon was empty. The daemon
process may have died"). This is a sandbox environment limitation, not a
project error — the same project exports cleanly and the identical
toolchain built other apps via EAS cloud builds. **No APK is claimed.**
On a normal machine: `npx expo run:android` (or an EAS development build)
produces the installable build.

## Known limitations

1. Native features (YOLO inference, ML Kit OCR, voice recognition) are
   implemented against real native libraries but could only be verified
   host-side/jest-side here — they need the dev build on a real device
   for end-to-end confirmation. Labeled accordingly in
   docs/FEATURE_STATUS.md.
2. Arabic TTS voice quality/availability depends on the device's TTS
   engine (ar-EG requested, device Arabic voice used as fallback).
3. ML Kit Arabic OCR accuracy depends on the Arabic script model shipped
   with the native build / Play services.
4. RTL: `I18nManager.forceRTL` is applied on language change; a full
   native RTL flip requires an app restart (platform behavior).
5. JPEG pixel decoding for the YOLO pipeline (jpeg-js) is pure JS —
   correct but not fast; acceptable for single-photo analysis, not for
   future continuous glasses streaming.
6. Obstacle "proximity" is a heuristic size category, never a distance.

## EAS Development Build preparation (2026-10-30)
- eas.json created: `development` profile = developmentClient:true, distribution:internal, android.buildType:apk.
- expo-dev-client ~58.0.16 present (installed 58.0.17). android.package = me.auramarketing.basera.
- .easignore added: excludes node_modules/.expo/dist/build outputs only — assets/models/yolo11n.tflite always ships.
- Model in bundle PROVEN: fresh `expo export --platform android` contains the model asset at 10,656,588 bytes, SHA256 identical to source (19bfdc3c…).
- app.json schema fixes for SDK 58: removed legacy top-level `newArchEnabled` and `splash` fields (native android/ keeps newArchEnabled=true in gradle.properties and its generated splash resources; EAS uses the existing android/ folder).
- Expo Doctor: 17/20. Remaining 3 are advisories, not blockers: (1) non-CNG note — expected because android/ exists and is used as-is; (2) RN Directory metadata lags for react-native-fast-tflite / ML Kit ("untested on New Arch") and @react-native-voice/voice ("unmaintained"); (3) patch versions RN 0.88.0 vs 0.88.1 + slider — aligning them makes npm resolution fail on a pre-existing @babel/preset-react@8 vs @babel/core@7 peer conflict, so the verified 0.88.0 set was kept.
- No APK was built here; the cloud build is run by the project owner from Windows.

## Voice migration + first successful EAS dev build (2026-10-30)
- Migrated @react-native-voice/voice (archived; jcenter/compileSdk Gradle failure in the user's first build d52c98b0) -> expo-speech-recognition 58.0.1. Zero references to the old package remain (src, app.json, package.json, package-lock.json, android/).
- VoiceCommandService adapter rewritten on ExpoSpeechRecognitionModule: requestPermissionsAsync -> isRecognitionAvailable -> addListener('result'/'error') -> start({lang: ar-EG|en-US}); parser/registry UNCHANGED. Adapter tests added: jest now 7 suites / 52 tests, all pass; tsc clean; lint 0; npm ci passes (project .npmrc sets legacy-peer-deps=true for a pre-existing @babel/preset-react peer conflict).
- Native sync: `expo prebuild --platform android` (no --clean) changed exactly ONE file — AndroidManifest.xml gained the <queries> block (googlequicksearchbox package + RecognitionService intent). RECORD_AUDIO was already present.
- Project linked: @0xsabry/basera, projectId f402737d-1b54-441d-8738-99ce8e9009e9 (the ID in the task message was missing its final character; the correct one was read from the Expo API for the same project).
- EAS build 2bf63ba2-0d92-4ac3-b205-1ee4462fc9bf (development profile): FINISHED. APK artifact verified after download (294,660,016 bytes): package me.auramarketing.basera, versionName 1.0.0 versionCode 1; libNitroTflite.so present for all 4 ABIs; ML Kit OCR models bundled. NOTE: as with all dev-client builds, the JS bundle and the YOLO .tflite asset are served by Metro (`npx expo start --dev-client`), not embedded in the APK; the earlier expo export proved the model embeds correctly (hash-identical) for standalone builds.
- STILL hardware-only pending: launching the app, on-device YOLO inference, OCR run, TTS audibility, microphone recognition (incl. ar-EG service availability on the test device).
