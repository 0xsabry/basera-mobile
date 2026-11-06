# BASERA — بصيرة

BASERA is an Arabic/English accessibility assistant for blind and visually impaired users. The mobile app helps users understand selected images, read text, hear spoken descriptions, use supported voice commands, save places, and access consent-based Family/Guardian features.

The mobile application is the current product. Smart glasses are future hardware: this repository contains an image-source interface placeholder, not working glasses, a wireless protocol, or a continuous camera feed.

## Current stack

- Expo SDK 58, React Native 0.88, TypeScript, and expo-router.
- Object detection: YOLO11n TensorFlow Lite, executed through react-native-fast-tflite.
- Arabic OCR: PP-OCRv3 detection and Arabic recognition TensorFlow Lite models.
- Latin OCR: Google ML Kit Text Recognition with the Latin script.
- Text-to-speech: expo-speech using voices available on the device.
- Microphone recognition: expo-speech-recognition using the platform recognition service.
- Local persistence: AsyncStorage, app-private files, and SecureStore.
- Backend: Supabase Auth, PostgreSQL, Row Level Security, Realtime, and deployed Guardian Edge Functions.
- Guardian companion: static installable PWA using Leaflet/OpenStreetMap.
- OTA updates: expo-updates and EAS channels.

For full details, start with:
- docs/PROJECT_OVERVIEW.md
- docs/ARCHITECTURE.md
- docs/FEATURE_STATUS.md
- docs/PROJECT_FILE_MAP.md — every important module, its exports, and its tests
- docs/FEATURE_IMPLEMENTATION_MAP.md — every feature, UI to backend
- docs/IMPLEMENTATION_AND_DEPLOYMENT_STATUS.md — what is in source vs tested vs in production vs device-verified
- docs/AI_INSPECTION_GUIDE.md
- docs/TEAM_PRESENTATION_GUIDE.md
- docs/TEAM_AI_HANDOFF.md — how the team prepares with an AI assistant
- team/ — the 10 numbered presentation section packs
- docs/README.md

## Repository setup

Clone the repository and use the checked-in lockfile:

~~~bash
git clone https://github.com/0xsabry/basera-mobile.git
cd basera-mobile
npm ci
~~~

## Local development and verification

~~~bash
# Start Metro
npm start

# TypeScript
npm run typecheck

# Lint
npm run lint

# Unit tests
npm test -- --runInBand

# Guardian PWA checks
npm run test:pwa

# Android JavaScript bundle and asset export
npm run export:android

# Web UI export (native AI modules are not available in a browser)
npm run export:web
~~~

Some model-verification scripts require additional Python packages and upstream model artifacts. Read docs/MODELS.md and TESTING.md before running them.

## Native Android build

YOLO, ML Kit OCR, microphone recognition, and other native modules require a compatible Android development or standalone build. Expo Go is not the complete BASERA runtime.

Typical local Android workflow after configuring the Android SDK and Java toolchain:

~~~bash
npx expo prebuild --platform android
npx expo run:android
~~~

An EAS development or internal build may also be used. Check docs/RELEASE.md and run the appropriate release guard before any authorized release operation. A successful Expo export is not proof that a native feature works on a physical device.

## Main folders

| Path | Purpose |
|---|---|
| src/app | Mobile screens and expo-router navigation |
| src/ai | Object detection, OCR, speech, descriptions, image processing |
| src/input | Image input interfaces and implementations |
| src/guardian | Supabase client, pairing, consent, and location services |
| src/hazards | Scan-based risk engine, alert orchestration, local alert history |
| src/places | Smart Place Memory and optional sync code |
| src/telemetry | Installation and OTA telemetry client |
| src/update | Update service and release notes |
| guardian-pwa | Companion web application for guardians |
| telemetry-dashboard | Owner telemetry dashboard source |
| supabase | Backend contracts, migration files, and Edge Function source |
| assets/models | Shipped TFLite models |
| assets/samples | Bundled test/demo images |
| docs | Project, model, backend, release, and presentation documentation |
| scripts and tests | Verification scripts, automated tests, and fixtures |

## Current model facts

- Object detection is YOLO11n, not YOLOv8n.
- Arabic OCR is handled by PP-OCR; ML Kit is used for Latin OCR only.
- The Arabic and object-detection TFLite model files are packaged under assets/models.
- See docs/MODELS.md for provenance, hashes, licences, input/output shapes, and known limitations.

## Important capability boundaries

- Image inference is designed to run on-device; Guardian account and remote-sharing features require network access.
- The app does not perform continuous camera monitoring.
- Proximity categories are heuristics, not measured obstacle distances.
- Hazard checks run on user-captured frames. Camera hazard events are local under the deployed backend contract.
- SOS remote recording is consent-gated; database acceptance is not proof of push delivery.
- The deployed Guardian backend exposes the latest location only, not a 24-hour location history.
- Browser push is not connected to the deployed backend.
- Smart glasses are not working hardware in this release.
- KemeTone is not integrated into BASERA; current TTS is expo-speech and the device's installed voices.

## Testing and evidence

TESTING.md is a dated engineering record. Its results must be read with their date, branch, commit, and environment; do not assume an old test count describes the current HEAD.

Before presenting a feature as working, classify its evidence as code implemented, unit-tested, host-verified, export/build-verified, device-tested, backend-verified, published, or applied on device. See docs/AI_INSPECTION_GUIDE.md.

## Safety and production rules

Read supabase/README.md before any backend or migration work. The baseline migration documents an already-deployed schema and must not be replayed. Archived local-design migrations/functions are not production setup instructions. Production database changes, Edge Function deployments, APK builds, and OTA publishes require the owner's explicit approval.