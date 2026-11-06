# 01 — Source Map: Introduction & Overview

Top-level map of the whole system. Detail lives in each section's own map.

## Entry points

| Path | Role |
|---|---|
| `src/app/_layout.tsx` | Root layout: settings/i18n bootstrap, telemetry wiring, update service, startup latency warm-ups (`startLatencyWarmUps()`), navigation stack |
| `src/app/(tabs)/_layout.tsx` | The five main tabs: Home, Smart Assistant, History, Family, Settings |
| `src/app/(tabs)/index.tsx` | Home tab |
| `src/app/(tabs)/assistance.tsx` | Smart Assistant tab (detection, reading, voice entry points) |
| `src/app/(tabs)/family.tsx` | Family / Guardian tab |
| `src/app/(tabs)/history.tsx` | History tab |
| `src/app/(tabs)/settings.tsx` | Settings tab |

## Subsystems (one line each — see the section maps for detail)

| Subsystem | Key path | Section |
|---|---|---|
| Design system & screens | `src/components/ui.tsx`, `src/theme/` | 02 |
| Expo / React Native shell | `app.json`, `eas.json`, `android/` | 03 |
| Object detection (YOLO11n TFLite) | `src/ai/ObjectDetector.ts`, `assets/models/yolo11n.tflite` | 04 |
| OCR (PP-OCR Arabic + ML Kit) | `src/ai/ArabicOcrEngine.ts`, `src/ai/TextRecognizer.ts` | 05 |
| Speech out / voice commands | `src/ai/SpeechService.ts`, `src/ai/VoiceCommandService.ts` | 06 |
| Risk / hazard alerts | `src/hazards/RiskEngine.ts`, `src/hazards/HazardService.ts` | 07 |
| Places & GPS | `src/places/`, `src/guardian/LocationSharingService.ts` | 08 |
| History & settings storage | `src/data/HistoryStore.ts`, `src/state/SettingsContext.tsx` | 09 |
| Guardian backend (Supabase) | `src/guardian/`, `supabase/`, `guardian-pwa/` | 10 |
| OTA updates | `src/update/UpdateService.ts`, `src/update/releaseNotes.ts` | 03 |
| Anonymous update telemetry | `src/telemetry/` | 03 |
| Replaceable image input | `src/input/ImageSource.ts` (+ gallery / phone-camera-test / smart-glasses placeholder) | 03, 04 |

## Data stores

- On-device only: settings, history (AsyncStorage), saved places, offline
  location queue, identity secrets (SecureStore).
- Backend (Supabase): guardian profiles, links/consent, latest location, SOS
  alerts, push tokens, anonymous telemetry — see section 10.

## Tests

46 Jest suites (671 tests) across `src/**/__tests__/`, Deno tests under
`supabase/tests/`, PWA freshness tests at `guardian-pwa/test-freshness.js`.
