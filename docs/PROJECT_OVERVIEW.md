# BASERA — بصيرة: project overview

Last documentation review: 2026-11-06  
Repository branch reviewed: v1.1  
Reviewed commit: 9ba1d78995d2c20ef2e1b5928b36435c105e736e

## 1. What BASERA does

BASERA is an Android-first accessibility assistant intended to help blind and visually impaired people understand selected visual surroundings and access information through speech. The mobile application supports Arabic and English, including Arabic right-to-left presentation.

The current phone app can accept an image, run supported on-device vision pipelines, describe detections or recognized text, and speak the result. It also includes voice-command parsing, a local history, saved-place features, scan-based hazard alerts, emergency SOS, and a Family/Guardian experience connected to a Supabase backend.

The mobile application is the current product. BASERA smart glasses are a future hardware project. The repository contains an interface placeholder for a future glasses image source; it does not contain working glasses hardware, a Bluetooth/Wi-Fi protocol, or a glasses camera feed.

## 2. Technology stack

| Area | Technology | Role |
|---|---|---|
| Mobile framework | Expo SDK 58 | React Native app tooling, native project configuration, development and release workflows |
| Mobile UI | React Native 0.88 | Native Android user interface |
| Language | TypeScript | Application services, interfaces, data models, and business logic |
| Navigation | expo-router | File-based screens and tab/stack navigation |
| Object detection | YOLO11n converted to TensorFlow Lite | Detects supported COCO objects from a selected image |
| Model runtime | react-native-fast-tflite + Nitro | Runs the shipped TFLite models in a native app build |
| Arabic OCR | PP-OCRv3 detection + Arabic recognition TFLite models | Reads Arabic text from images on-device |
| Latin OCR | Google ML Kit Text Recognition | Reads Latin-script text on-device |
| Text-to-speech | expo-speech | Speaks app-generated descriptions and recognized text using voices available on the device |
| Voice recognition | expo-speech-recognition | Receives microphone speech through the platform recognition service |
| Local persistence | AsyncStorage, app-private files, SecureStore | Stores preferences, history, places, session data, and protected telemetry identity as appropriate |
| Backend | Supabase | Authentication, database access under RLS, Realtime, and deployed Edge Functions |
| Guardian client | Static installable PWA, Leaflet, OpenStreetMap | Lets signed-in guardians view permitted latest-location and SOS information |
| OTA | expo-updates + EAS channels | Delivers compatible JavaScript updates to eligible installed builds |

This is not a single cloud AI service. Core image-model inference is designed to run locally on the phone. Guardian account, pairing, location sharing, and remote data access require network access and the configured Supabase service. Microphone recognition depends on the Android recognition service and its available language support.

## 3. Main mobile application areas

The five primary tabs are:

- Home — status and shortcuts into assistance features.
- Assistance — the main assistive actions.
- History — locally stored previous results.
- Family — account, guardian pairing, sharing consent, location sharing, and SOS-related controls.
- Settings — language, appearance, speech, accessibility, privacy, permissions, places, updates, and app information.

Additional stack screens include image detection, text reading, voice commands, saved places, alerts, updates, guardian authentication, onboarding, and voice settings.

## 4. Main application flows

### A. Image understanding

1. An image enters through the image-source interface. Available sources include gallery selection, bundled sample images, and a phone-camera test input.
2. Image normalization and preprocessing prepare the input for the selected engine.
3. Object detection uses the YOLO11n TFLite model. The TypeScript post-processing layer decodes boxes, applies confidence filtering, and performs class-aware non-maximum suppression.
4. The description builder converts the returned detections into short Arabic or English descriptions.
5. The speech service can read the description aloud.

The app must report unavailable native engines honestly. It must never invent detections or pretend that an unavailable model ran.

### B. Text reading

- Arabic script is routed to the PP-OCRv3 TFLite detection and Arabic recognition pipeline.
- Latin script is handled by Google ML Kit Text Recognition.
- Recognized text is returned as text and can be read aloud.
- OCR accuracy is not perfect. The Arabic mobile model can confuse visually similar dotted letters. The application must not fabricate text when recognition is empty or uncertain.

### C. Speech and voice commands

- Text-to-speech uses expo-speech and voices installed in the operating system. Arabic requests prefer an exact ar-EG voice when one is available; actual voice quality and availability depend on the device.
- Microphone recognition uses expo-speech-recognition with the platform recognition service.
- The command parser is TypeScript logic that maps recognized Arabic or English phrases to supported intents.
- Parsing tests do not prove that microphone recognition works on every physical phone.

KemeTone is an external research/probe effort and is NOT integrated into this repository or the BASERA app as of the reviewed commit. Do not describe it as the current BASERA voice engine.

### D. Hazard awareness and SOS

- The risk engine evaluates detections from a user-captured image in the Detect flow.
- It uses object class, confidence, bounding-box position/proximity categories, persistence, and cooldown rules to decide whether to present an alert.
- This is scan-based assistance, not continuous monitoring or guaranteed protection.
- The proximity label is a heuristic category. It is not a measured physical distance.
- Camera hazard events are stored locally. The deployed Supabase contract does not expose a hazard-events table or a notify-guardian function for these camera events.
- SOS can be stored locally. A remote SOS row is sent only when the user is signed in and the wearer's own SOS-sharing consent allows it. A successful database insert is not proof that a guardian's phone received a push notification.

### E. Family and Guardian flow

The deployed backend contract is documented in SUPABASE_INTEGRATION.md. In summary:

1. The wearer signs in or creates an account.
2. The wearer creates an invite code using create-guardian-invite.
3. A guardian accepts it using accept-guardian-invite.
4. The link becomes paired immediately. The deployed model has no owner-approval stage.
5. Each new link starts with location and SOS consent disabled.
6. Consent is controlled by the wearer and is stored per guardian link.
7. When allowed by RLS and consent, a guardian may read the latest location and SOS rows.
8. The Guardian PWA is a separate web client, not another native app.

Location shared by the app is the phone's GPS location, not the location of smart glasses. The deployed location table stores the latest fix only; it is not a historical GPS trail. Background location has a separate explained opt-in and still requires real-device verification.

The deployed PWA does not have server-backed browser push registration. Do not claim that it delivers browser push notifications.

### F. Smart Place Memory

The app has a local-first place store with categories, notes, favorites, visit markers, and proximity-related behaviour. Voice notes are stored as text transcripts, not audio.

A cloud-sync code path references a saved_places table. The current deployed Supabase integration contract does not establish that this table exists in production. Treat place cloud sync as unverified until the deployed schema and RLS are explicitly checked.

## 5. Backend and data boundaries

Supabase is used for authenticated Guardian functionality. It is not the vision model runtime and does not replace on-device inference.

Current deployed Guardian tables documented by the live integration contract include:

- profiles
- guardian_links
- guardian_locations
- sos_alerts
- user_push_tokens

The two deployed Guardian Edge Functions are:

- create-guardian-invite
- accept-guardian-invite

The repository also contains a telemetry-ingest function and telemetry SQL work. Telemetry architecture and current deployment caveats are described in TELEMETRY.md. The telemetry dashboard source existing in GitHub does not, by itself, mean a usable owner dashboard is hosted or configured.

Only the public Supabase publishable client key may be shipped in a client. Never put a service-role key, database password, access token, or other server secret in source control, app config, or PWA config.

## 6. AI/model inventory

| Capability | Model / engine | Location |
|---|---|---|
| Object detection | YOLO11n TFLite, COCO-80 | assets/models/yolo11n.tflite |
| Arabic OCR detection | PP-OCRv3 detection TFLite | assets/models/ppocr_det.tflite |
| Arabic OCR recognition | Arabic PP-OCRv3 mobile recognition TFLite | assets/models/ppocr_arabic_rec.tflite |
| Latin OCR | Google ML Kit | Native dependency, not a checked-in model file |
| Text-to-speech | Android/device TTS through expo-speech | Operating-system voice engine |
| Speech recognition | Android/platform service through expo-speech-recognition | Platform recognition service |

See MODELS.md for model provenance, conversion details, tensor shapes, hashes, licences, and known accuracy limitations.

## 7. Accessibility and privacy principles

The project uses large touch targets, TalkBack labels and hints, Arabic RTL support, high-contrast themes, adjustable text size, speech controls, and clear permission explanations.

The design principle is honest capability reporting: if a model, permission, connection, hardware input, or remote action is unavailable, the UI should say so. A local alert is not a guardian notification; a staged OTA is not an applied OTA; a GPS sharing toggle is not proof that a guardian received a fix.

## 8. Important limitations — do not overclaim

- Smart glasses are not implemented as working hardware.
- There is no continuous camera monitoring.
- Obstacle proximity is a heuristic, not a measured distance.
- The camera hazard engine cannot detect every dangerous condition and cannot guarantee safety.
- Arabic OCR is imperfect and requires physical-device evaluation.
- Native inference and microphone recognition need a real app build and device testing.
- TTS voice quality depends on installed device voices.
- KemeTone is not integrated into BASERA.
- Guardian PWA displays latest-location data, not a 24-hour location history.
- Browser push delivery is not wired to the deployed backend.
- Camera hazard events do not have a deployed remote guardian-event destination.
- Smart Place Memory cloud sync is not confirmed against the deployed schema.
- A code test or desktop model test does not count as a physical Android end-to-end test.

## 9. Where to look in the repository

| Path | What it contains |
|---|---|
| src/app | Screens and navigation |
| src/ai | Detection, OCR, TTS, speech recognition, descriptions, and risk-adjacent AI utilities |
| src/input | Gallery, sample, phone-camera test, and future glasses image-source interfaces |
| src/guardian | Supabase client, Guardian services, location sharing, background tasks, and pairing |
| src/hazards | Risk engine, hazard orchestration, and local alert history |
| src/places | Local place store, voice assistant, distance helpers, and optional sync code |
| src/telemetry | Installation/update telemetry client |
| src/update | OTA/update service and release-note content |
| guardian-pwa | Companion Guardian progressive web app |
| telemetry-dashboard | Owner telemetry dashboard source |
| supabase | Configuration, migrations/proposals, function source, and repository safety rules |
| assets/models | TFLite model files |
| assets/samples | Bundled demo images |
| scripts | Model verification/conversion, release guard, and live-backend harnesses |
| tests and src/**/__tests__ | Automated tests and fixtures |

## 10. Current-version note

The reviewed branch is v1.1 at commit 9ba1d78995d2c20ef2e1b5928b36435c105e736e. The native Android Gradle file reports versionName 1.1.8 and versionCode 10, while app.json contains android.versionCode 9. This metadata mismatch is documented for review; it was deliberately not changed during this documentation pass. Resolve it deliberately before a future prebuild or native APK build, and rerun the release guard.

The package.json version field is package metadata and should not be confused with the installed Android app version.