# BASERA — Project File Map

Every important module: exact path, responsibility, key exports, who uses it,
what it depends on, and its tests. The source code is the authority; this map
exists so any reader (human or AI) can answer "which exact files implement
this feature?" in seconds. Feature-level flows are in
[FEATURE_IMPLEMENTATION_MAP.md](FEATURE_IMPLEMENTATION_MAP.md); presentation
packs per topic are under [`team/`](../team/).

## App shell and screens — `src/app/`

| Path | Responsibility | Key exports / notes | Used by | Tests |
|---|---|---|---|---|
| `src/app/_layout.tsx` | Root layout: providers (settings, i18n), telemetry sink wiring, update service, startup warm-ups | calls `startLatencyWarmUps()` on mount | Expo Router root | `src/app/__tests__/noEntrySpeech.test.ts` |
| `src/app/(tabs)/_layout.tsx` | Tab bar: Home, Smart Assistant, History, Family, Settings | — | Router | — |
| `src/app/(tabs)/index.tsx` | Home tab | default screen component | Tabs | — |
| `src/app/(tabs)/assistance.tsx` | Smart Assistant hub (detect / read / voice entry) | default screen | Tabs | — |
| `src/app/(tabs)/history.tsx` | History tab over `HistoryStore` | default screen | Tabs | — |
| `src/app/(tabs)/family.tsx` | Wearer Guardian UI: status, sharing/SOS toggles, per-guardian consent, pairing, privacy/deletion, background tracking | default screen; local helpers `sharingError()`, `toggleSharing`, `toggleSos`, `setLinkLocation`, `setLinkSos` | Tabs; uses `GuardianService`, `LocationSharingService`, `BackgroundLocationService` | guardian suites below |
| `src/app/(tabs)/settings.tsx` | Settings tab | default screen | Tabs | — |
| `src/app/detect.tsx` | Detection flow screen | uses `YoloDetector`, `DescriptionBuilder`, `HazardService` | Assistance | — |
| `src/app/read.tsx` | OCR flow screen | uses `RoutingTextRecognizer` | Assistance | — |
| `src/app/voice.tsx` | Voice commands screen | uses `VoiceCommandService` | Assistance | — |
| `src/app/alerts.tsx` | Hazard alerts list + blind-spots list | uses `AlertHistoryStore`, `NOT_DETECTABLE` | Assistance | — |
| `src/app/places.tsx` | Saved places screen | uses `PlacesStore`, `PlacesAssistant`, `syncPlaces` | Home/Assistance | — |
| `src/app/updates.tsx` | In-app updates screen | uses `updateService`, `RELEASE_NOTES` | Settings | update suites |
| `src/app/onboarding.tsx` | First-run explanation + permission priming | — | Root flow | — |
| `src/app/guardian-auth.tsx` | Guardian sign-in/sign-up; maps auth errors to dedicated strings (rate limit, email-not-confirmed) | uses `GuardianService` | Family tab gate | — |
| `src/app/settings-voice.tsx` | Voice preference picker (Automatic/System/custom) | uses `voiceCatalog`, `SpeechService` | Settings | — |

## AI — `src/ai/`

| Path | Responsibility | Key exports | Depends on | Tests |
|---|---|---|---|---|
| `src/ai/types.ts` | Shared AI types | `Detection`, `OcrResult` | — | — |
| `src/ai/ObjectDetector.ts` | YOLO11n TFLite detection | `ObjectDetector`, `YoloDetector`, `DetectorUnavailableError`, `buildTensorFromJpegBase64()`, `prewarmYoloModel()`; module-scope shared model promise | `react-native-fast-tflite`, `assets/models/yolo11n.tflite`, `normalizeImage`, `yoloPostprocess` | `yolo.test.ts` |
| `src/ai/yoloPostprocess.ts` | Letterbox + output decoding + NMS | `MODEL_INPUT_SIZE=640`, `NUM_ANCHORS=8400`, `NUM_CLASSES=80`, `computeLetterbox()`, `decodeYoloOutput()` (conf 0.35, IoU 0.45, max 30) | — | `yolo.test.ts` (+ `tests/fixtures/bus_raw_output.bin`) |
| `src/ai/imagePreprocess.ts`, `src/ai/normalizeImage.ts` | Tensor prep; any image → local JPEG (long edge ≤1280) | `normalizeImage()` | expo-image-manipulator, expo-file-system | `normalizeImage.test.ts` |
| `src/ai/cocoLabels.ts` | COCO 80 label table (EN/AR) | label maps | — | `logic.test.ts` |
| `src/ai/TextRecognizer.ts` | OCR contract + routing | `TextRecognizer`, `MlKitTextRecognizer`, `RoutingTextRecognizer`, `OcrUnavailableError`, `detectTextLanguage()` | ML Kit, `ArabicOcrEngine`, `normalizeImage` | `arabicOcr.test.ts` |
| `src/ai/ArabicOcrEngine.ts` | PP-OCRv3 Arabic pipeline | `ArabicOcrEngine`, `DET_CANVAS=960`, `REC_H=48`, `REC_W=640`, `REC_CLASSES=163`, `detFit()`, `extractTextBoxes()`, `ctcGreedyDecode()` | `ppocr_det.tflite`, `ppocr_arabic_rec.tflite`, `arabicDict` | `arabicOcr.test.ts` |
| `src/ai/arabicDict.ts` | PP-OCR Arabic CTC dictionary (161 chars, verbatim) | `ARABIC_OCR_CHARS` | — | `arabicOcr.test.ts` |
| `src/ai/SpeechService.ts` | All TTS via expo-speech | `SpeechService`, `ExpoSpeechService`, `speechService`; `setVoicePreference()`, `warmUp()`; 300 ms bounded discovery race; active-speech tracker | expo-speech, `voiceCatalog` | `speechService.test.ts`, `speechServiceVoice.test.ts`, `speechLatency.test.ts` |
| `src/ai/voiceCatalog.ts` | Device-voice discovery + Egyptian selection | `VoicePreference`, `selectEgyptianVoice()` (exact `ar-EG` only), `resolveVoiceIdentifier()`, `normalizeVoiceLanguage()` | — | `voiceCatalog.test.ts`, `voiceAdapter.test.ts` |
| `src/ai/voiceSingleton.ts` | Single shared speech instance wiring | — | `SpeechService` | — |
| `src/ai/DescriptionBuilder.ts` | Detections → spoken narration | `buildDescription()`, `describeDetection()` | `ObstacleAwareness`, `cocoLabels` | `logic.test.ts` |
| `src/ai/ObstacleAwareness.ts` | Position + proximity category per detection | `horizontalPosition()`, `proximityCategory()`, `analyzeObstacles()`, `PRIORITY_CLASSES` | `types` | `logic.test.ts` |
| `src/ai/VoiceCommandService.ts` | Speech → fixed command set | `COMMAND_REGISTRY`, `parseVoiceCommand()`, `CommandAction`, `VoiceUnavailableError`, `VoiceRecognitionError` | expo-speech-recognition | `voiceCommands.test.ts` |
| `src/ai/warmUp.ts` | Silent startup warm-ups | `startLatencyWarmUps()` | `SpeechService`, `ObjectDetector` | `speechLatency.test.ts`, `noEntrySpeech.test.ts` |
| `src/ai/base64.ts` | Base64 helpers for tensor building | — | — | `base64.test.ts` |

## Hazards — `src/hazards/`

| Path | Responsibility | Key exports | Tests |
|---|---|---|---|
| `src/hazards/RiskEngine.ts` | Deterministic risk rules over detections | `HAZARD_RULES`, `NOT_DETECTABLE`, `baseRisk()`, `extractCandidates()`, `RiskLevel`, `HazardCategory` | `riskEngine.test.ts` |
| `src/hazards/HazardService.ts` | Alert runtime: speak (interrupt), store, notify seam | `HazardNotifier`, `supabaseHazardNotifier` (returns `unavailable` — no production hazard table), `configureHazardRuntime()`, `hazardAlertText()` | `hazardService.test.ts` |
| `src/hazards/AlertHistoryStore.ts` | On-device alert history | store class | `hazardService.test.ts` |
| `src/hazards/HazardEventSource.ts` | Detection → hazard pipeline entry seam | — | `hazardService.test.ts` |

## Guardian client — `src/guardian/`

| Path | Responsibility | Key exports | Depends on | Tests |
|---|---|---|---|---|
| `src/guardian/supabaseClient.ts` | Supabase client from app config (URL + publishable key) | client factory | @supabase/supabase-js | — |
| `src/guardian/supabaseGateway.ts` | Deployed-contract data access: profiles, links, locations, SOS, tokens; invite create/accept calls | `createInvite(client, invitedEmail)`, `parseInvitePayload()`, `classifyInviteErrorMessage()`, `InviteErrorKind`, consent read/write helpers | Supabase REST + Edge Functions | `supabaseGateway.test.ts`, `rlsStatic.test.ts` |
| `src/guardian/GuardianService.ts` | Guardian business logic | `GuardianService`, `GuardianInviteError` (typed kinds incl. `rate-limited`, `invalid-invited-email`), `setSharingEnabled()`, `setSosSharingEnabled()`, `getConsent()`, `setLinkConsent()`, `createPairingCode()`, `triggerSos()` | gateway | `guardianService.test.ts` |
| `src/guardian/LocationSharingService.ts` | Foreground collection → latest-location upload; batching | `LocationBatcher`, `LocationAdapter` types, deletion status re-exports | expo-location, gateway, `OfflineLocationQueue`, `PendingDeletion` | `locationSharing.test.ts` |
| `src/guardian/OfflineLocationQueue.ts` | FIFO offline point queue (cap 500) | `OfflineLocationQueue`, `offlineLocationQueue`, `OFFLINE_QUEUE_KEY` | AsyncStorage | `locationSharing.test.ts` |
| `src/guardian/PendingDeletion.ts` | Opt-out purge tracking (pending → confirmed only on server success) | `DeletionStatus`, `PendingDeletionReason` (`sharing-disabled` / `last-guardian-revoked`) | storage | `pendingDeletion.test.ts` |
| `src/guardian/BackgroundLocationService.ts` | Background collection adapter + options | `BACKGROUND_LOCATION_TASK`, `ExpoBackgroundLocationAdapter`, `buildBackgroundOptions()` | expo-location, expo-task-manager | `backgroundLocation.test.ts` |
| `src/guardian/backgroundTask.ts`, `backgroundTaskHandler.ts` | TaskManager task definition + handler | — | — | `backgroundLocation.test.ts` |
| `src/guardian/sharingState.ts` | Sharing state machine | `SharingState`, `SharingSignals`, `deriveSharingState()` | — | guardian suites |
| `src/guardian/locationStatus.ts` | Fix freshness/accuracy classification (shared logic with PWA) | `classifyFixAge()` (`FRESH_FIX_MAX_AGE_MS=180_000`), `accuracyQuality()` | — | `locationStatus.test.ts` |
| `src/guardian/pairing.ts` | Invite-code input hygiene | `normalizePairingCodeInput()`, `isPairingCodeFormat()`, `formatPairingCode()` | — | `pairing.test.ts` |
| `src/guardian/PushTokenService.ts` | Expo push token registration → `user_push_tokens` | `PushTokenService`, `getPushTokenService()`, `PushRegistrationStatus` | expo-notifications, gateway | `pushTokenService.test.ts` |
| `src/guardian/mapConfig.ts`, `tileMath.ts`, `uploadMeta.ts` | Map tile config/math, upload metadata | — | OpenStreetMap tiles | `tileMath.test.ts` |

## Places — `src/places/`

| Path | Responsibility | Key exports | Tests |
|---|---|---|---|
| `src/places/PlacesStore.ts` | Saved places CRUD (device storage, max 200) | `PlacesStore`, `placesStore`, `Place`, `PLACE_CATEGORIES`, `MAX_PLACES` | `places.test.ts` |
| `src/places/PlacesAssistant.ts` | Spoken place descriptions/answers | `PlacesAssistant`, `describePlace()`, `categoryLabel()` | `places.test.ts` |
| `src/places/placesText.ts` | Name normalization/matching, GPS distance | `normalizePlaceName()`, `placeNameMatches()`, `haversineMeters()`, `distanceStatement()` | `places.test.ts` |
| `src/places/currentFix.ts` | One-shot GPS fix with typed errors | `getCurrentFix()`, `getFixIfPermitted()`, `GeoFix`, `FixError` | `places.test.ts` |
| `src/places/geocode.ts` | Reverse geocoding chain (Nominatim → device → coordinates) | `formatAddress()`, `formatDeviceAddress()`, `ResolvedAddress` | `geocode.test.ts` |
| `src/places/proximityCore.ts` | Pure proximity decision + pending events | `checkProximity()`, `PROXIMITY_COOLDOWN_MS` (30 min), `recordPendingProximityEvent()`, `drainPendingProximityEvents()` | `places.test.ts` |
| `src/places/proximity.ts` | Proximity runtime wiring | — | `places.test.ts` |
| `src/places/placesSync.ts` | Opt-in sync with the wearer's own account | `syncPlaces()`, `PlacesSyncOutcome` | `places.test.ts` |

## Input, state, data, components, theme, i18n

| Path | Responsibility | Key exports | Tests |
|---|---|---|---|
| `src/input/ImageSource.ts` | Replaceable image-input contract | `ImageSource`, `CapturedImage`, `ImageSourceKind`, `ImageSourceNotAvailableError` | `imageSourcesPermission.test.ts`, `glasses.test.ts` |
| `src/input/GalleryImageSource.ts` | Gallery source | `GalleryImageSource` | 〃 |
| `src/input/PhoneCameraTestSource.ts` | Phone camera — explicitly a TEST source | `PhoneCameraTestSource` | 〃 |
| `src/input/SmartGlassesCameraSource.ts` | Glasses placeholder — typed NotAvailable, **not a feature** | `SmartGlassesCameraSource` | `glasses.test.ts` |
| `src/state/SettingsContext.tsx` | Settings model + provider + theme/RTL resolution | `Settings`, `DEFAULT_SETTINGS`, `parseSettings()`, `migrateVoicePreference()`, `SettingsProvider`, `useSettings()`, `colorsFor()`, `applyLayoutDirection()` | `settings.test.ts` |
| `src/state/accessibilityBusy.ts` | Busy announcements for AT | — | `accessibilityBusy.test.ts` |
| `src/state/haptics.ts` | Haptics wrapper | — | `haptics.test.ts` |
| `src/state/languageRestart.ts` | Safe language switching | — | `languageRestart.test.ts` |
| `src/state/navGuard.ts` | Navigation guards | — | — |
| `src/data/HistoryStore.ts` | Result history (max 50) + image persistence | `HistoryStore`, `historyStore`, `MAX_HISTORY_ITEMS`, `persistImageCopy()` | `history.test.ts` |
| `src/components/ui.tsx` | Design system | `Screen` (`SCREEN_MAX_WIDTH=600`), `Card`, `Banner`, `StatusPill`, `ListRow`, `SectionHeader`, `EmptyState`, `QuietGroup`, `FeatureTile`, `Icon` | `ui.smoke.test.tsx`, `screenLayout.test.ts`, `iconography.test.ts` |
| `src/components/AccessibleButton.tsx` | The one button component | — | `ui.smoke.test.tsx` |
| `src/components/ThemedStatusBar.tsx` | Theme-aware status bar | — | `themedStatusBar.test.tsx` |
| `src/components/ImageSourcePicker.tsx` | Source picker UI | — | — |
| `src/components/MyLocationCard.tsx`, `LocationMapPreview.tsx` | Location card + OSM tile preview | — | `locationStatus.test.ts` |
| `src/components/QrCodeView.tsx` | Pairing QR rendering | — | — |
| `src/theme/tokens.ts` | Spacing/radius/elevation/type tokens | — | `contrast.test.ts` |
| `src/theme/glyphs.ts` | Icon glyph set | `GLYPHS` | `iconography.test.ts` |
| `src/i18n/strings.ts` | AR/EN string tables | `STRINGS`, `StringKey` (parity enforced) | `copy.test.ts`, `hardcodedStrings.test.ts` |

## Updates and telemetry

| Path | Responsibility | Key exports | Tests |
|---|---|---|---|
| `src/update/UpdateService.ts` | expo-updates client (check/fetch/apply), telemetry sink seam | `updateService`, `UpdateCheckResult`, `UpdateStatus`, `UpdatePhase`, compile-time SDK shape guard | `updateService.test.ts`, `updateContract.test.ts`, `appVersion.test.ts` |
| `src/update/releaseNotes.ts` | In-bundle release notes | `RELEASE_NOTES`, `ReleaseNote` | update suites |
| `src/telemetry/telemetry.ts` | Anonymous update-event client: server-issued identity, sized event-id pool, atomic state envelope | `TelemetryEventType`, `QueuedEvent`, `BootstrapResult`, `FlushVerdict` | `telemetry.test.ts` |
| `src/telemetry/config.ts` | Config resolution | `resolveSupabaseConfig()` | `config.test.ts` |
| `src/telemetry/index.ts` | Wiring seam into `UpdateService` | `setTelemetrySink` wiring | `indexWiring.test.ts` |

## Backend — `supabase/`

| Path | Responsibility | Status |
|---|---|---|
| `supabase/migrations/20261031000000_baseline_deployed_state.sql` | Documents the deployed guardian schema — **never apply** | documentation only |
| `supabase/migrations/20261101000000_telemetry_proposal.sql` | Telemetry backend | **applied** to production 2026-11-01 (dashboard SQL editor) |
| `supabase/migrations/20261107000000_guardian_invites_hardening.sql` | Invite hardening (hash storage, `invited_email`, atomic claim) | **NOT applied — candidate** |
| `supabase/functions/telemetry-ingest/` | Telemetry ingest Edge Function (`index.ts` + `core.ts`) | deployed, verify_jwt on |
| `supabase/functions/create-guardian-invite/`, `accept-guardian-invite/` | Hardened pairing replacements (`index.ts` + `core.ts`) | **candidate — NOT deployed**; production runs the earlier bearer-code functions (source not in repo; see `supabase/functions/README.md`) |
| `supabase/archive-local-design/` | Superseded local design (migrations 0001–0004, functions) | archive only — **never apply/deploy** |
| `supabase/tests/` | Deno core tests (invites, telemetry), SQL RLS tests, PG battery harness | test-only |
| `supabase/config.toml` | Function config (`telemetry-ingest` verify_jwt = true) | — |

## Guardian PWA — `guardian-pwa/`

| Path | Responsibility |
|---|---|
| `guardian-pwa/index.html`, `app.js` | Guardian web app (sign-in, wearers, location, SOS) |
| `guardian-pwa/config.js` | Public config (Supabase URL + publishable key, tile URL) |
| `guardian-pwa/freshness.js` | Freshness classifier (mirrors `locationStatus.ts`) |
| `guardian-pwa/realtime.js` | Realtime update wiring |
| `guardian-pwa/service-worker.js`, `manifest.webmanifest`, `icons/` | PWA shell (icons predate the official logo) |
| `guardian-pwa/firebase-messaging-sw.js` | Web-push scaffold — delivery not established |
| `guardian-pwa/test-freshness.js` | PWA test battery |

## Build, release, scripts

| Path | Responsibility |
|---|---|
| `app.json` | Expo config: scheme `basera`, version 1.1.8, manual `runtimeVersion` "1.1.0", project ID, public Supabase config in `extra` |
| `eas.json` | Profiles: development / preview (APK, channel preview) / production (channel production, unused) / telemetry-smoke |
| `android/app/build.gradle` | Native version source of truth (1.1.8 / code 10), package `me.auramarketing.basera` |
| `.eas/workflows/*.yml` | Manual workflows: preview OTA publish, preview APK, telemetry-smoke build/OTA |
| `scripts/release-guard.mjs` | Pre-publish guard (`ota`/`apk` modes) |
| `scripts/verify_model.py`, `scripts/convert_tflite.py` | Model verification/conversion |
| `scripts/live-rls-test.mjs` | Live RLS test script (owner-run, needs credentials) |
| `scripts/generate-brand-icons.py` | Brand icon generation |

## Assets

| Path | Facts |
|---|---|
| `assets/models/yolo11n.tflite` | 10,656,588 B, SHA-256 `19bfdc3c…`, AGPL-3.0 |
| `assets/models/ppocr_det.tflite` | 2,408,968 B, SHA-256 `04e8e0b6…` |
| `assets/models/ppocr_arabic_rec.tflite` | 8,960,168 B, SHA-256 `1fc31af5…` |
| `assets/brand/basera-logo-official.png` | Official logo — frozen byte-identical |
| `assets/samples/` | 4 bundled sample images for demos/tests |
| `tests/fixtures/` | Recorded model-output fixtures for unit tests |
