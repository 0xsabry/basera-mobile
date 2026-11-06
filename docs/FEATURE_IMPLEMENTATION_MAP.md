# BASERA — Feature Implementation Map

Per feature: what the user sees, how it works, where it lives, what it
depends on, how it fails, and its honest status. File-level detail is in
[PROJECT_FILE_MAP.md](PROJECT_FILE_MAP.md); deployment truth is in
[IMPLEMENTATION_AND_DEPLOYMENT_STATUS.md](IMPLEMENTATION_AND_DEPLOYMENT_STATUS.md).

Status vocabulary: **Implemented** (in source) · **Partial** (works with
named gaps) · **Future** (placeholder only). Deployment and device states
are stated separately and never implied by "implemented".

---

## 1. Authentication and user profiles

- **User sees:** email/password sign-up and sign-in (Guardian area), a
  "signed in as" card, sign-out, and a delete-my-data action.
- **Internals:** Supabase Auth (email provider, confirmation enforced).
  The app ensures a `profiles` row client-side after sign-in. Sessions are
  managed by the Supabase client; guardian screens gate on session state.
- **UI entry:** `src/app/guardian-auth.tsx`; account card in
  `src/app/(tabs)/family.tsx`.
- **Files:** `src/guardian/supabaseClient.ts`, `GuardianService.ts`,
  `supabaseGateway.ts`.
- **Backend:** Auth + `profiles` table (RLS).
- **Errors/permissions:** weak password (422), invalid email, duplicate
  signup (obfuscated by Supabase), `email_not_confirmed`, and
  `over_email_send_rate_limit` are mapped to dedicated AR/EN messages.
- **Tests:** gateway/service Jest suites; live API verification 2026-11-06.
- **Status:** Implemented. **Limits:** no custom SMTP (default sender,
  tight send quota); confirmation-link landing page not fully verified;
  no auth deep-link handling in the app (links land on the Supabase site
  URL; the flow is "confirm, return, sign in").

## 2. Onboarding and permissions

- **User sees:** a first-run explanation of what the app does and why each
  permission is needed, before system prompts.
- **Internals:** onboarding screen + in-context permission requests at the
  moment of use (location only when sharing turns on, camera inside the
  test-camera flow, microphone in voice commands).
- **UI entry:** `src/app/onboarding.tsx`.
- **Errors:** denial paths are spoken, typed states — never dead ends.
- **Status:** Implemented.

## 3. Camera and object detection

- **User sees:** pick an image (gallery or labelled phone-camera test),
  hear what is in it with positions.
- **Internals:** `ImageSource` → `normalizeImage` → letterbox 640×640 →
  YOLO11n TFLite → `decodeYoloOutput` (conf 0.35, NMS IoU 0.45) →
  `Detection[]` → narration (feature 5/6) and risk layer (feature 7 in
  [team/07](../team/07-risk-detection/)).
- **Files:** `src/input/*`, `src/ai/ObjectDetector.ts`,
  `yoloPostprocess.ts`, `src/app/detect.tsx`.
- **Permissions:** photo library / camera (test source only — labelled).
- **Errors:** `DetectorUnavailableError` → honest "detection unavailable";
  no fabricated results, ever.
- **Tests:** `yolo.test.ts` with a real recorded model-output fixture.
- **Status:** Implemented. **Limits:** COCO classes only; on-device
  inference timing varies by phone; camera is a still-image test input,
  not a live video pipeline.

## 4. OCR and text recognition

- **User sees:** point at text, hear it read verbatim.
- **Internals:** `RoutingTextRecognizer` normalizes once, then tries the
  UI-language engine first (Arabic → PP-OCRv3 det+rec with CTC decode;
  English → ML Kit), with cross-fallback.
- **Files:** `src/ai/TextRecognizer.ts`, `ArabicOcrEngine.ts`,
  `arabicDict.ts`, `src/app/read.tsx`.
- **Errors:** `OcrUnavailableError`; recognized text is never rewritten.
- **Tests:** `arabicOcr.test.ts`, `normalizeImage.test.ts`.
- **Status:** Implemented. **Limits:** Arabic dotted-letter confusion;
  handwriting/decorative fonts weak; ML Kit model is not a repo asset
  (provided by the library/Play services).

## 5. Text-to-speech and speech recognition

- **User sees:** spoken descriptions, announcements, voice settings
  (Automatic/System/custom), and push-to-talk voice commands.
- **Internals:** `SpeechService` (expo-speech) with `voiceCatalog`
  selection (exact `ar-EG` for Automatic), bounded 300 ms discovery
  race, startup warm-up, interruption for hazards. Commands:
  `VoiceCommandService` fixed registry parsed from recognizer output.
- **Files:** `src/ai/SpeechService.ts`, `voiceCatalog.ts`, `warmUp.ts`,
  `VoiceCommandService.ts`, `src/app/settings-voice.tsx`, `voice.tsx`.
- **Errors:** recognizer unavailability is a typed error; TTS falls back
  to the language tag when no Egyptian voice exists.
- **Tests:** speech/voice suites incl. `speechLatency.test.ts`.
- **Status:** Implemented. **Limits:** voice quality = device voices;
  whether a given phone has an `ar-EG` voice is device-dependent; the
  neural Egyptian voice (KemeTone) is an external prototype, **not
  integrated**.

## 6. Navigation and accessibility

- **User sees:** five tabs + pushed flows; everything labelled; RTL in
  Arabic; themes incl. high contrast.
- **Internals:** expo-router; one design system (`src/components/ui.tsx`);
  `SettingsContext` resolves theme/language; live regions announce
  results; ≥48dp targets; 600dp content cap.
- **Files:** `src/app/**`, `src/components/*`, `src/theme/*`,
  `src/state/*`, `src/i18n/strings.ts`.
- **Guards:** `copy.test.ts` (MSA-only UI Arabic, length budgets, key
  parity), `hardcodedStrings.test.ts`, `noEntrySpeech.test.ts`,
  `contrast.test.ts`.
- **Status:** Implemented. **Limits:** full TalkBack-flow verification on
  hardware is partial — stated, not hidden.

## 7. Guardian and family management

- **User sees:** sign in, create an invite code for a family member's
  email, see linked guardians, remove a guardian, accept an invite as a
  guardian.
- **Internals:** pairing only via Edge Functions; codes are dashed-hex,
  ~15 min, single-use; all accept failures share one error. The app
  sends `invited_email`; the **deployed** function ignores it (bearer
  behavior), the **candidate** functions in `supabase/functions/` bind
  the code to the verified email with hash-only storage.
- **Files:** `src/app/(tabs)/family.tsx`, `src/guardian/GuardianService.ts`,
  `supabaseGateway.ts`, `pairing.ts`, `supabase/functions/*guardian-invite/`.
- **Backend:** `guardian_links`, `private` invite storage, RLS.
- **Tests:** Jest guardian suites; Deno 10/10 (candidate); live API
  pairing tests 2026-11-06.
- **Status:** Implemented (deployed bearer pairing) + hardening candidate.
  **Limits:** codes are bearer in production until the hardening deploy
  is separately authorized; create rate limit ≈ per-wearer hourly.

## 8. Location sharing and consent

- **User sees:** a master sharing switch, per-guardian location toggles,
  a live sharing-state label, and a privacy card stating local + server
  truth.
- **Internals:** consent lives per link (`guardian_links` flags, default
  false). ON: foreground watch uploads the latest fix (offline FIFO
  queue when disconnected); background collection is a separate opt-in.
  OFF: collection stops and the stored latest location is **deleted**
  (PendingDeletion confirms server purge before claiming deletion).
- **Files:** `LocationSharingService.ts`, `OfflineLocationQueue.ts`,
  `PendingDeletion.ts`, `BackgroundLocationService.ts`,
  `sharingState.ts`, `family.tsx`.
- **Backend:** `guardian_locations` (latest-only), RLS flag-gated reads.
- **Evidence:** live revocation sequence location rows 0→1→0.
- **Status:** Implemented; API-verified. **Limits:** background mode
  needs the system background-location permission; device-UI verification
  of the full flow is pending.

## 9. SOS / emergency alerts

- **User sees:** an SOS action; with SOS sharing on for a guardian, the
  alert reaches the guardian's web app list.
- **Internals:** insert into `sos_alerts` (append-only) with the current
  fix when available. Visibility is flag-gated per link. Camera hazards
  do **not** create SOS rows (separate, on-device only).
- **Files:** `GuardianService.sendSosAlert(fix)`, `supabaseGateway.ts`,
  `family.tsx` SOS section, `guardian-pwa/app.js`.
- **Evidence:** live sequence SOS rows 0→≥1→0 across consent on/off.
- **Status:** Implemented. **Limits:** a stored row ≠ a delivered push;
  push delivery untested; browser push not established.

## 10. Supabase integration

- **Shape:** Auth + PostgreSQL + RLS + Edge Functions + Realtime (PWA).
  The app ships only the publishable key (public by design); anon has
  zero direct table grants; service-role exists only inside Edge
  Functions.
- **Files:** `src/guardian/supabaseClient.ts`, `supabaseGateway.ts`,
  `supabase/` (migrations, functions, tests), `docs/SUPABASE_INTEGRATION.md`.
- **Status:** Guardian backend deployed (3 guardian migrations);
  telemetry backend deployed 2026-11-01; invite-hardening migration
  **not applied**.

## 11. Guardian web / PWA interface

- **User (guardian) sees:** sign-in, their wearers, latest location with
  freshness state and map, SOS list.
- **Internals:** static PWA over the same Supabase project (same RLS);
  `freshness.js` mirrors the app's fix-age classifier; realtime wiring
  refreshes views.
- **Files:** `guardian-pwa/*`.
- **Tests:** `guardian-pwa/test-freshness.js` (freshness + realtime/config).
- **Status:** Implemented in code. **Limits:** public hosting of the PWA
  is an owner setup item; icons predate the official logo; web push not
  established.

## 12. Settings and preferences

- **User sees:** language, theme, high contrast, announcements, voice
  preference, sharing flags.
- **Internals:** one typed `Settings` model in `SettingsContext`,
  AsyncStorage persistence, `parseSettings()` corruption fallback,
  legacy migrations (voice preference). History: `HistoryStore`
  (max 50, image copies in app-private storage).
- **Files:** `src/state/SettingsContext.tsx`, `src/app/(tabs)/settings.tsx`,
  `src/data/HistoryStore.ts`.
- **Status:** Implemented.

## 13. AI / model integration

- **Models:** YOLO11n TFLite (detection), PP-OCR det+rec TFLite (Arabic
  OCR); ML Kit (Latin OCR, library-provided); device TTS voices (no
  bundled voice model). All inference on-device; replaceable seams:
  `ObjectDetector`, `TextRecognizer`, `ImageSource` interfaces.
- **Files:** `assets/models/*`, `docs/MODELS.md`, `src/ai/*`.
- **Status:** Implemented. **Limits:** licenses — YOLO11n is AGPL-3.0;
  KemeTone (Apache-2.0) is a separate prototype, not in this app.

## 14. Expo and Android app lifecycle

- **Shape:** Expo SDK 58 / RN 0.88 bare workflow; package
  `me.auramarketing.basera`; versions from `android/app/build.gradle`
  (1.1.8 / code 10); manual runtime "1.1.0"; EAS profiles development /
  preview / production / telemetry-smoke; OTA via the Expo Updates
  protocol with an in-bundle release-notes source of truth and a
  pre-publish release guard.
- **Files:** `app.json`, `eas.json`, `android/`, `.eas/workflows/`,
  `src/update/*`, `scripts/release-guard.mjs`, `docs/RELEASE.md`.
- **Status:** Implemented; preview channel is the working ceiling;
  production channel configured but unused. **Limits:** native changes
  always need a new APK; OTA applies only within the same runtime.
