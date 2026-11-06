# BASERA architecture

## High-level system map

~~~text
                         ANDROID MOBILE APP
┌────────────────────────────────────────────────────────────────┐
│ UI / Navigation — src/app (expo-router)                         │
│ Home · Assistance · History · Family · Settings                 │
│ Detect · Read · Voice · Places · Alerts · Updates · Onboarding  │
└───────────────────────────────┬────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────┐
│ Application services                                            │
│ DescriptionBuilder · SpeechService · VoiceCommandService        │
│ GuardianService · LocationSharingService · HazardService       │
│ PlacesAssistant · HistoryStore · UpdateService · Telemetry      │
└──────────────┬────────────────────────┬────────────────────────┘
               │                        │
┌──────────────▼─────────────┐  ┌───────▼────────────────────────┐
│ Local AI engines           │  │ Local state and persistence    │
│ YOLO11n TFLite              │  │ AsyncStorage / app files        │
│ Arabic PP-OCR TFLite        │  │ SecureStore                     │
│ Latin Google ML Kit         │  │ Settings / history / places     │
│ Image preprocessing         │  │ Telemetry queue and identity    │
│ Speech via device services  │  └────────────────────────────────┘
└──────────────▲─────────────┘
               │ CapturedImage
┌──────────────┴─────────────────────────────────────────────────┐
│ Image inputs — src/input                                        │
│ Gallery · Bundled samples · Phone camera (test input)           │
│ SmartGlassesCameraSource (future placeholder; unavailable)      │
└─────────────────────────────────────────────────────────────────┘

                 REMOTE GUARDIAN SERVICES
┌────────────────────────────────────────────────────────────────┐
│ Mobile app / Guardian PWA                                       │
└───────────────────────────────┬────────────────────────────────┘
                                │ HTTPS + authenticated user JWT
┌───────────────────────────────▼────────────────────────────────┐
│ Supabase                                                        │
│ Auth · PostgreSQL · Row Level Security · Realtime                │
│ create-guardian-invite · accept-guardian-invite                  │
│ telemetry-ingest is a separate telemetry function               │
└────────────────────────────────────────────────────────────────┘
~~~

## Application layers

### 1. User interface

- src/app contains the expo-router screens and navigation.
- src/components contains reusable accessible UI controls and layouts.
- src/i18n contains Arabic and English strings.
- src/state and src/theme manage user preferences, accessibility state, and visual tokens.

The five primary tabs are Home, Assistance, History, Family, and Settings. Other routes provide detection, reading, voice commands, saved places, alerts, updates, onboarding, and guardian authentication.

### 2. Input boundary

src/input defines the CapturedImage contract and image-source implementations. The AI pipeline consumes a captured image without needing to know whether it came from the gallery, samples, or the phone-camera test source.

SmartGlassesCameraSource is a typed unavailable placeholder. No Bluetooth/Wi-Fi transport or glasses camera implementation exists in this release.

### 3. AI and speech services

| Module | Responsibility |
|---|---|
| ObjectDetector.ts | Object detector interface and YOLO11n TFLite runtime adapter |
| imagePreprocess.ts / normalizeImage.ts | Input image and tensor preparation |
| yoloPostprocess.ts | Decode detections, confidence filtering, and class-aware NMS |
| ArabicOcrEngine.ts | PP-OCRv3 Arabic detection, crop extraction, recognition, and CTC decoding |
| TextRecognizer.ts | OCR contract and Latin ML Kit adapter/routing |
| DescriptionBuilder.ts | Convert detections into concise Arabic/English spoken descriptions |
| ObstacleAwareness.ts | Direction and heuristic proximity categorization; not physical distance |
| SpeechService.ts | TTS wrapper using expo-speech and available OS voices |
| VoiceCommandService.ts | Speech-recognition adapter plus Arabic/English command parsing |

The core model pipelines are designed for on-device inference. Native modules are not available in a generic web export or Expo Go-only session.

### 4. Local data

- History is stored on-device.
- Settings and accessibility preferences are persisted locally.
- Smart Place Memory is local-first; the code contains optional sync logic, but its referenced saved_places table is not confirmed by the deployed Supabase contract.
- Telemetry identity and mutable telemetry state use protected storage according to docs/TELEMETRY.md.

### 5. Guardian and backend boundary

src/guardian owns the app-side Supabase adapter, auth, pairing, consent, push-token registration, foreground/background location services, offline queue, and deletion retry logic.

The deployed contract is documented in docs/SUPABASE_INTEGRATION.md and supabase/README.md. Its principal Guardian tables are profiles, guardian_links, guardian_locations, sos_alerts, and user_push_tokens. The deployed invite functions are create-guardian-invite and accept-guardian-invite.

Important deployed-contract facts:
- Pairing becomes active immediately when accepted; there is no pending owner-approval state.
- Location and SOS consent are per-link and start disabled.
- Consent is wearer-controlled.
- guardian_locations stores the latest fix only.
- Location is the phone's GPS location.
- The browser PWA reads the latest location and SOS records.
- Browser push delivery is not connected to the deployed backend.

### 6. Hazard behaviour

src/hazards contains the RiskEngine, orchestration, and local alert history. The camera pipeline evaluates detections on user-captured frames; there is no continuous scan loop.

Camera hazard events have no deployed server destination under the current Supabase contract. SOS is a separate flow and may create an sos_alerts record only when the signed-in wearer's SOS-sharing consent allows it.

### 7. Guardian PWA

guardian-pwa is a separate static progressive web app for guardians. It authenticates with Supabase and uses the signed-in user's permissions and deployed RLS policies to display permitted people, latest location, and SOS records. It does not display a 24-hour trail and does not have server-backed Web Push delivery.

### 8. Telemetry dashboard

src/telemetry contains installation/update telemetry client logic. supabase/functions/telemetry-ingest contains the ingest endpoint source. telemetry-dashboard contains owner dashboard source. These are separate pieces: dashboard HTML in Git does not prove that an owner account is provisioned or that the dashboard is hosted.

Read docs/TELEMETRY.md for the current owner-reported deployment status and historical verification evidence.

## Main data flows

### Image to spoken description

1. A screen asks an ImageSource for a CapturedImage.
2. Preprocessing prepares the image/tensor for the selected engine.
3. ObjectDetector loads/runs YOLO11n TFLite.
4. yoloPostprocess converts raw tensor output into normalized detections.
5. DescriptionBuilder formats the detections in the current language.
6. SpeechService sends the text to the device TTS engine.

### Image to text reading

1. A captured image is routed to the suitable recognizer.
2. Arabic script uses PP-OCR detection and Arabic recognition.
3. Latin script uses ML Kit Text Recognition.
4. The recognizer returns actual text or an honest empty/error result.
5. SpeechService can read the result aloud.

### Voice command

1. Voice screen requests microphone permission and starts platform speech recognition.
2. Recognition returns text and status/errors.
3. VoiceCommandService parses the recognized text into a supported intent.
4. The relevant service performs the action or asks for missing information/confirmation.
5. Results are displayed/spoken using localized copy.

### Guardian location sharing

1. The wearer opts in and grants OS location permission.
2. Foreground/background location services obtain phone GPS fixes.
3. The app queues/offloads according to its location service logic.
4. The authenticated Supabase client writes under RLS.
5. A guardian reads only the latest row when the deployed per-link consent policy allows it.
6. Turning sharing off stops collection locally and triggers the persisted server-deletion workflow; a server deletion is called confirmed only after success.

## Engineering principles

1. UI screens should call application services, not implement model or backend logic inline.
2. AI engines return typed unavailable/error states instead of fabricated results.
3. Local inference should remain separate from remote Guardian account services.
4. Consent, RLS, and truthful user-facing status are required for Guardian data.
5. User-triggered scan-based hazard assistance must not be described as continuous safety monitoring.
6. Native device claims require real Android evidence.
7. Production backend and release operations require explicit owner approval.