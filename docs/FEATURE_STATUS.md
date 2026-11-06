# BASERA feature status

Last consolidated from source review: 2026-11-06  
Branch reviewed: v1.1  
Commit reviewed: 9ba1d78995d2c20ef2e1b5928b36435c105e736e

## Status vocabulary

- **Implemented** — implementation is present in the inspected source.
- **Automated-tested** — relevant logic is covered by a recorded automated test run.
- **Host-verified** — executed on a development computer using a model/runtime harness.
- **Device verification pending** — native feature still requires a recorded physical Android test.
- **Backend verified** — exact deployed behaviour was checked against the live Supabase project on the date stated by the evidence.
- **Planned / unavailable** — interface or plan exists, but working capability is not present.

These labels are intentionally separate. A unit test is not a device test, and a code path is not proof of a deployed backend feature.

## Mobile app

| Feature | Implementation | Evidence / current caveat |
|---|---|---|
| App startup and navigation | Expo Router; five tabs plus feature routes | TypeScript/Jest/export results exist in dated TESTING.md snapshots; re-run against current HEAD before quoting counts |
| Arabic and English UI | Full string tables and language setting | Language logic has automated coverage; full visual RTL review requires device validation |
| Accessibility controls | Large targets, accessibility labels/hints, speech gate, text scaling, themes, contrast and haptics settings | Relevant state and component logic has automated coverage; TalkBack walkthrough should be separately recorded |
| Gallery input | expo-image-picker integration | Implemented; end-to-end picker flow needs device verification |
| Bundled sample input | SampleImageSource and four sample assets | Model/logic host verification documented; do not treat as a live camera test |
| Phone camera test input | PhoneCameraTestSource | Explicitly a test input; device end-to-end verification required |
| Smart glasses camera | SmartGlassesCameraSource typed placeholder | Planned/unavailable; no working glasses, Bluetooth, Wi-Fi, or camera feed |
| Object detection | YOLO11n TFLite through react-native-fast-tflite; TypeScript preprocessing and post-processing | Model provenance and host evidence in MODELS.md and TESTING.md; native inference requires physical-device confirmation |
| Bounding boxes and descriptions | Detection overlay and Arabic/English DescriptionBuilder | Pure logic tests exist; visual overlay requires device review |
| Arabic OCR | PP-OCRv3 detection TFLite + Arabic recognition TFLite + CTC decoding | Host-verified against bundled sample in MODELS.md; imperfect character accuracy; on-device latency/quality needs device test |
| Latin OCR | Google ML Kit explicit Latin script | Native implementation exists; real device run required |
| Text-to-speech | expo-speech, rate/repeat/stop and voice preference handling | Unit tests cover service logic; audible voice quality depends on installed device voices and requires phone testing |
| Egyptian voice selection | Automatic exact ar-EG preference where installed; no false claim that ar-SA/ar-XA is Egyptian | Selection logic exists; actual voice depends on device voice catalog |
| KemeTone Egyptian voice | Not integrated into the BASERA repository/app | External probe/research only; do not list it as a current app feature |
| Microphone speech recognition | expo-speech-recognition platform adapter | Parser/adapter logic has automated coverage; microphone availability and ar-EG recognition need phone test |
| Arabic/English command parsing | VoiceCommandService parses supported intents | Unit-tested parser; command parsing tests do not prove microphone recognition |
| Local history | AsyncStorage history with list/reopen/delete/clear behaviour | Automated storage tests documented |
| Smart Place Memory | Local places, categories, notes, favorites, visited markers, voice-transcribed text notes, proximity helpers | Local logic has automated tests; distance phrasing depends on GPS accuracy; optional cloud sync references saved_places, which is not confirmed in the deployed backend contract |
| Settings | Language, theme, text scale, voice, haptics, privacy, permissions, places, updates, About | Source and unit tests exist; device permission and TalkBack behaviour need device verification |

## Safety and assistance

| Feature | Implementation | Evidence / current caveat |
|---|---|---|
| Hazard risk engine | Scan-based thresholds, direction/proximity categories, persistence and cooldown rules | Pure engine tests documented; not a continuous safety system |
| Hazard event history | Local on-device alert store | Implemented; camera hazard events have no deployed server table under the current Supabase contract |
| Hazard notifications to guardians | No deployed remote destination for camera hazard events | Do not claim camera hazard events are sent to guardians |
| SOS | Local SOS record/message; remote sos_alerts insert when signed in and wearer SOS consent allows | Deployed contract and code describe the consent gate; successful row acceptance is not proof of push delivery |
| Obstacle proximity | Heuristic categories based on image boxes | Never describe as a measured distance or depth estimation |
| Continuous monitoring | Not implemented | No repeated/continuous camera stream; scan is based on user-captured frames |
| Blind spots | App explains hazards that its current camera/model cannot reliably detect | Do not imply that no alert means the path is safe |

## Family / Guardian backend

| Feature | Implementation | Evidence / current caveat |
|---|---|---|
| Supabase authentication | Supabase Auth with persistent session through SecureStore adapter | Re-verified live 2026-11-06: login/refresh/logout-invalidation, weak-password (422) and invalid-email (400) rejection, duplicate-signup obfuscation, tampered-token rejection all behave correctly. **Auth email sending is rate-limited (429 `over_email_send_rate_limit` on signup/recover after a few test emails — custom SMTP not configured; see docs/SUPABASE_INTEGRATION.md).** Confirmation-email delivery proven in the owner's reconnected mailbox 2026-11-06 (default Supabase sender — no custom SMTP); unverified login refused (`email_not_confirmed`); recovery still 429 by quota |
| Invite creation and acceptance | create-guardian-invite and accept-guardian-invite | Re-verified live 2026-11-06: create (~15 min dashed-hex code), accept, used/tampered/self-accept rejection all correct. Codes are single-use (re-accept fails) and **bearer <redacted> — an unrelated account holding a fresh code paired successfully (cleaned up after). The email-bound hardened replacement is IMPLEMENTED and unit-tested on branch `fix/guardian-reliability` (Deno 10/10; deploy package docs/INVITE_HARDENING_DEPLOY.md) and the app on that branch collects the recipient email — production still runs the bearer functions until the owner authorizes deployment. No invitation email exists — codes are shared out-of-band |
| Consent revocation | wearer toggles per-link flags; RLS enforces reads | Verified end-to-end live 2026-11-06: guardian location rows 0 (off) → 1 (on) → 0 (after revoke); SOS rows 0 → ≥1 → 0 (after revoke) |
| Owner approval step | Not part of deployed contract | Do not describe the link as pending owner approval |
| Per-link consent | location_sharing_enabled and sos_sharing_enabled on guardian_links; both start false; wearer controls them | Described in live verified integration contract |
| Foreground location sharing | expo-location phone GPS watcher with consent and persisted deletion retry logic | Implemented in code; device/GPS/background behaviour needs physical-device verification |
| Background location sharing | Separate explained opt-in using expo-location and expo-task-manager | Implemented in code and manifest-referenced in prior evidence; physical-device execution still needs verification |
| Remote location data | guardian_locations latest row per wearer | Deployed contract is latest-only, not a location history table |
| SOS data | sos_alerts, read under per-link SOS consent | Deployed contract documented; push delivery is not guaranteed |
| Push token registration | Expo token registration in user_push_tokens | Registration code exists; delivery has not been proven |
| Guardian PWA | Sign-in, invite acceptance, latest location, SOS view, map | Current code uses deployed tables; verify deployment/host before saying public site is available |
| Guardian PWA 24-hour history | Not implemented against deployed contract | No server history track; PWA code explicitly treats location as latest-only |
| Browser Web Push | Not connected to deployed backend | UI indicates browser notifications are not wired to server delivery |

## Telemetry and updates

| Feature | Implementation | Evidence / current caveat |
|---|---|---|
| Telemetry client | Per-installation identity, queued events, update-applied detection, verdict-aware ingest logic | Source and detailed historical tests in docs/TELEMETRY.md |
| telemetry-ingest | Edge Function source in repository | Latest owner-reported state says production function is active with JWT verification; reconfirm before depending on it |
| Telemetry schema | Proposal migration in repository | Latest owner-reported state says migration 20261101000000 was applied via SQL Editor; migration-history repair was not confirmed complete. Do not rerun or push it |
| Telemetry dashboard source | Static dashboard HTML and tests | Source exists; dashboard owner registration and hosting are not complete in the latest recorded state. Do not claim the owner dashboard is ready |
| OTA framework | expo-updates, runtime 1.1.0, preview/production channels separated | See RELEASE.md. Published is not the same as received/applied |
| Production OTA | Owner-controlled only | No automatic publish. Never publish production without explicit owner request |

## Current native/app release metadata

- Android package: me.auramarketing.basera
- Android Gradle versionName: 1.1.8
- Android Gradle versionCode: 10
- Runtime version: 1.1.0
- EAS project ID is configured in app.json.

A metadata discrepancy exists: app.json android.versionCode is 9 while android/app/build.gradle reports 10. It was left untouched during docs-only cleanup. Resolve it deliberately before the next prebuild/native APK operation; the release guard must pass.

## Testing evidence

TESTING.md is a chronological engineering log. Its historical full test snapshot on 2026-10-30 reported 21 suites / 233 tests passing, but that number is not a verified count for the reviewed 2026-11-01 HEAD or any later checkout. Re-run the current commands and record new output before claiming current pass counts.

For model provenance and accuracy caveats see MODELS.md. For live Guardian database behaviour see SUPABASE_INTEGRATION.md. For production safety rules see supabase/README.md.