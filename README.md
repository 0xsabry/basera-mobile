# BASERA — بصيرة

AI assistance app for blind and visually impaired users: object detection,
scene description, OCR text reading, text-to-speech, and voice commands —
in Arabic (RTL) and English. The mobile app is built **first and
independently**; the BASERA smart glasses are still in development and will
later plug in as one more image-input source (see
`docs/GLASSES_INTEGRATION.md`). There are **no fake detections, no fake
connections, and no simulated results** anywhere in this app.

## Stack

- Expo SDK 58 · React Native 0.88 · TypeScript · expo-router
- Object detection: YOLOv8n TFLite on-device (`react-native-fast-tflite`)
- OCR: Google ML Kit Text Recognition (Arabic + Latin, on-device)
- TTS: expo-speech · Voice input: @react-native-voice/voice
- Storage: AsyncStorage + app-private files (history never leaves the device)
- Package: `me.auramarketing.basera`

## Run it

```bash
cd ~/workspace/basera
npm install

# Pure-logic + pipeline verification (no device needed):
npx tsc --noEmit
npm test                       # jest — incl. YOLO decode vs real model output
npx expo export --platform android

# Host-side model verification (exports the shipped TFLite + reference runs):
~/workspace/.scratch-basera/venv/bin/python scripts/verify_model.py

# Develop:
npx expo start                 # Metro; UI works in Expo Go / web
```

**Native modules note:** YOLO (TFLite), ML Kit OCR, and voice recognition
are native modules. They run in a **development build**, not Expo Go:

```bash
npx expo prebuild
# with JAVA_HOME=~/workspace/tools/jdk17 and
# ANDROID_HOME=~/workspace/tools/android-sdk :
npx expo run:android
```

In Expo Go / web the app still opens and navigates, and the AI screens show
an honest "needs the full app build" error instead of fake results.

## Project layout

See `docs/ARCHITECTURE.md`. Status of every feature: `docs/FEATURE_STATUS.md`.
What was actually tested: `TESTING.md`. Models & provenance: `docs/MODELS.md`.

## Accessibility

Large (≥60dp) touch targets, high-contrast palettes, big type, TalkBack
labels/hints on every interactive element, spoken announcements, full
Arabic RTL mirroring, light/dark/system themes, adjustable speech rate.
