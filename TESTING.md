> **Historical evidence warning — read before quoting results.** This file is a chronological test log from several repository snapshots. The opening environment/table and later dated sections describe different historical runs; the final 2026-10-30 full snapshot recorded 21 suites / 233 tests. That count is **not certified for the current HEAD** (reviewed documentation branch is based on v1.1 commit 9ba1d789, dated 2026-11-01). Re-run the current scripts and capture fresh output before reporting a current pass count. Supabase deployment status in older sections is also historical; the current Guardian contract is in docs/SUPABASE_INTEGRATION.md, and telemetry status is summarized at the top of docs/TELEMETRY.md. Host/model tests are not Android device tests.

# BASERA — Testing & Verification Report

Environment: Node 24.22.1, npm 10.9.4, Python 3.12 venv at
`~/workspace/.scratch-basera/venv` (onnxruntime 1.31.1, tensorflow-cpu
2.21.0, onnx2tf 2.6.9, opencv-headless). No Android emulator or physical
device was available in this environment.

## Guardian/Auth live reliability run (2026-11-06, branch fix/guardian-reliability)

Live production checks through the public API only (owner test
accounts; no production schema/config changes). Auth API behaviour:
12 checks — duplicate-signup obfuscation, weak-password 422,
invalid-email 400, invalid-credentials 400, tampered-token rejection,
session refresh, logout invalidating the refresh token all PASS.
**Email sending FAILED by quota: signup and recover returned
`429 over_email_send_rate_limit` after a few test emails (built-in
provider, no custom SMTP).** Mailbox delivery itself NOT TESTED —
the agent's Gmail connection was disconnected; one created account
shows confirmed_at 15 s after signup (not clicked by the harness).
Guardian: 18 checks — invite create/accept, consent defaults
(false/false), used/tampered/self-accept rejection, location and SOS
visibility gated per consent flag, guardian cannot change consent,
unrelated-account negatives all PASS; **bearer acceptance by an
unrelated account holding a fresh code FAILED the identity
requirement (expected — codes are bearer by design; test link
deleted)**. Codes proved single-use: re-accept returns
invalid_or_expired_invite (docs corrected). Test data created by the
run (link, location row) was deleted afterwards; one SOS row remains
by design (append-only), labelled "E2E TEST 2026-11-06".
Repo gates on this branch: Jest 665/665 (45 suites — includes the
repaired rlsStatic suite, which now reads the archived-design
migrations from supabase/archive-local-design/), tsc clean, lint
0 errors, Guardian PWA freshness tests 13/13.

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
3. ~~ML Kit Arabic OCR~~ — CORRECTED 2026-10-30: ML Kit has no Arabic
   text model at all (see the stabilization section below). Arabic OCR
   is PP-OCR on-device; Latin OCR is ML Kit with the explicit Latin
   script.
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

## MVP stabilization (2026-10-30) — root-cause fixes + gates

Root causes fixed (each verified in code before fixing):

1. **Detection failed on device** — `ObjectDetector` used `globalThis.atob`
   + `Buffer.from`; Hermes/RN provides neither reliably (Node-based jest
   masked it). Fixed: pure-TS base64 decoder (`src/ai/base64.ts`), the
   `Uint8Array` passed directly to jpeg-js (`useTArray: true` avoids its
   Buffer path — verified in the jpeg-js source). Regression test deletes
   `globalThis.Buffer`/`atob` and builds the real [1,3,640,640] tensor
   from a real JPEG: passes.
2. **OCR** — (a) ML Kit now called explicitly with
   `TextRecognitionScript.LATIN`. (b) Arabic: ML Kit has NO Arabic model
   (proven in the installed library). Real on-device Arabic OCR added
   via PP-OCR + react-native-fast-tflite (details in docs/MODELS.md).
   Conversion notes: PP-OCRv4 Arabic Paddle→ONNX produced a graph
   onnxruntime cannot load (Concat rank error) and PP-OCR det Paddle
   models hit a paddle2onnx PIR parser bug, so ONNX conversions of the
   official weights were used (det = PP-OCRv3, rec =
   arabic_PP-OCRv3_mobile_rec; dictionary byte-identical to official).
   fast-tflite cannot resize input tensors (verified in its native
   source), so the TFLite shapes were pinned by flatbuffer editing to
   det [1,960,960,3] / rec [1,48,640,3].
   **Host gate (mandatory, PASSED):** the shipped TFLite files, TF Lite
   interpreter, `BUILTIN_WITHOUT_DEFAULT_DELEGATES` (no XNNPACK — it
   fails to prepare the rec graph), NO `resize_tensor_input`:
   sample `text-arabic.png` → 3 line boxes → recognized text with
   **0.730 character overlap** vs the known text (gate ≥ 0.70).
   Full dynamic-shape pipeline scored 0.712; fixed-640 rec width beat
   fixed-320 (0.684 — squashing wide lines hurts). Jest reproduces the
   recorded det prob map → TS boxes and rec logits → TS CTC text
   exactly (`tests/fixtures/ppocr_*`).
3. **Repeat replayed the welcome** — `speak()` recorded every utterance.
   Fixed: `speakAnnouncement()` for greetings/status (does not touch the
   repeat target); `repeatLast()` with no repeatable response speaks a
   localized "nothing to repeat yet" via the announcement path.
   Unit-tested: welcome→repeat = nothing-to-repeat; description→welcome
   →repeat = description; language preserved.
4. **Voice fragility** — adapter now: typed error kinds
   (`VoiceRecognitionError.kind`, `VoiceUnavailableError.kind`),
   native-code mapping, `end`/`nomatch` session completion (exactly
   once), `aborted` ends silently, stop-listening button on the voice
   screen, stop on unmount/blur. Screens render localized strings via
   `voiceErrorMessageKey` — raw native English never reaches Arabic UI.
   Adapter tests extended (end/nomatch/mapping/aborted/stop-cleanup).
5. **Arabic audit (bounded)** — voice/detect/read error surfaces
   localized (incl. new `featureUnavailableInBuild` key); brand spelling
   بصيرة kept; no other string defects found. Picker errors were
   already localized (permission + glasses).
6. **Perf/stability (bounded)** — `ImageSourcePicker` gained a
   `disabled` prop wired to the screens' busy state + a `busyRef`
   re-entry guard in detect/read `handleImage` (no duplicate runs).

Gates — actual results (2026-10-30):

| Gate | Result |
|---|---|
| `npm ci` | ✅ succeeds |
| `npx tsc --noEmit` | ✅ clean, 0 errors |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm test -- --runInBand` | ✅ **10 suites, 79 tests, all pass** (was 7/52) |
| `npx expo export --platform android` | ✅ succeeds — dist contains all 3 model assets, each SHA256-identical to source (YOLO 19bfdc3c…, det 04e8e0b6…, rec 1fc31af5…) |
| Python host verification (shipped OCR TFLite) | ✅ both allocate with exact fixed shapes, no resize; full Arabic gate 0.730 on byte-identical files |
| `sha256sum assets/models/yolo11n.tflite` | ✅ `19bfdc3cf16231b1d6d5604d245e934a5eeef5300fb3d04595b2dc92b69b5997` — unchanged |

**Device tests: NONE executed by the agent.** The following remain
team-verification-pending on a real Android device: open the app;
voice assistant + microphone; Arabic and English voice commands;
camera photo; real scene description; OCR of visible Latin and Arabic
text; Repeat repeating the latest meaningful response (not the
welcome); navigating all screens without freezing; Arabic/English
switch incl. RTL/LTR layout; microphone-permission denial + recovery;
offline/API-unavailable behavior showing an honest understandable
error.

## Standalone MVP build (2026-10-30)
- EAS preview profile (internal, apk, standalone) build 9b80e739-576f-4b33-8d86-9e223e01d275: FINISHED.
- APK artifact verified after download: 203,247,112 bytes, SHA256 c344142c31b2e375e2ef8973260cc8e8dac61d6fc2c991542ea8cbe904d60e63; package me.auramarketing.basera, versionName 1.0.0, versionCode 1.
- ALL THREE models embedded and hash-identical to source: res/bs.tflite = YOLO11n (19bfdc3c…), res/Y0.tflite = PP-OCR arabic rec (1fc31af5…), res/iZ.tflite = PP-OCR det (04e8e0b6…). libNitroTflite.so present for all ABIs. No Metro/dev server needed — opens the app directly.
- Submission required repeated retries: sandbox egress resets Expo API/upload connections intermittently on both proxy and direct routes (same behavior as the dev build); build creation succeeded on grind attempt 11 (direct route).
- Device verification by the team is still pending for: app launch, mic + AR/EN voice commands, camera capture, scene description, Latin OCR, Arabic OCR, Repeat behavior, navigation fluidity, language/RTL switch, permission-denial recovery, offline behavior.

## V1.1 Phase 0 + Phase 1 (2026-10-30, branch v1.1 only — master/MVP untouched)

Implemented per the owner's approved decisions + corrections (see
docs/V1.1_PLAN.md amendments and docs/GUARDIAN_SETUP.md).

**Phase 0 — OTA foundation**
- `expo-updates` ~58.0.19 installed; app.json: version 1.1.0,
  `android.versionCode` 2, `runtimeVersion {policy: appVersion}`,
  `updates {url: https://u.expo.dev/f402737d-…, checkAutomatically: ON_LOAD,
  fallbackToCacheTimeout: 0}`; eas.json: preview → channel "preview", new
  production profile → channel "production" (not built), development untouched.
- `UpdateService`: check + download NEVER reload; the only reload path is
  `restartToApply()`, refused while the accessibility-busy guard is active
  (speech via SpeechService callbacks, processing in detect/read,
  recognition in voice) or when nothing was downloaded. Release notes come
  from in-bundle `src/update/releaseNotes.ts` (owner correction — the
  `eas update --message` text is NOT app-visible). Promotion/rollback
  commands corrected in docs: `eas update:republish --destination-channel
  production`, `eas update:rollback`. Code signing NOT configured (not a
  default; eligibility unverified — documented, not claimed).
- Prebuild ran WITHOUT --clean; native diff reviewed file-by-file and is
  fully attributable: build.gradle versionCode 2 / versionName 1.1.0;
  AndroidManifest +location/background-location/foreground-service/
  POST_NOTIFICATIONS/RECEIVE_BOOT_COMPLETED permissions, updates ENABLED
  +URL+runtime string, secure-store backup-rule attributes (the referenced
  XML ships inside the expo-secure-store library), notification color;
  colors.xml + strings.xml additions. Nothing else changed; android/ not
  deleted.

**Native modules added to the single 1.1.0 APK — why each (all SDK 58
builds, selected by `expo install`, versions verified in node_modules):**
- expo-updates ~58.0.19 — the OTA foundation itself (Phase 0).
- expo-location ~58.0.20 — Phase 1 foreground GPS + Phase 2 background
  (plugin pre-adds background/foreground-service manifest entries so
  Phase 2 needs no new APK; the Phase 1 app NEVER requests background
  permission).
- expo-task-manager ~58.0.12 — required by expo-location background tasks
  in Phase 2; no Phase 1 code registers tasks.
- expo-notifications ~58.1.7 — Phase 3 guardian alerts + local alerts;
  Phase 1 adds only the permission/manifest foundation.
- expo-secure-store ~58.0.2 — Supabase session storage (chunked adapter).
- JS-only: @supabase/supabase-js 2.118.0, qrcode 1.5.4 (QR rendered as a
  View grid — deliberately no native SVG module).

**Phase 1 — Supabase guardian (foreground only)**
- Migrations `supabase/migrations/0001..0003`: profiles, device_settings,
  guardian_links, pairing_codes (SHA-256 hash only, 15-min, single-use),
  pairing_attempts throttle, location_points, latest_locations (trigger-
  maintained), hazard_events (Phase 3 table), push_endpoints (platform
  'android-expo' vs 'web-fcm' — separate registrations per owner
  correction). RLS on every table; anon gets NO grants; guardian reads
  require an ACTIVE link inside the policy; links change only via
  security-definer RPCs (create_pairing_code / redeem → PENDING only /
  approve_link owner-only / revoke_link either party / set_sharing_enabled
  with server-side purge on false; owner revoking the LAST active guardian
  also purges). cleanup_locations() (service-role only) deletes points
  older than **24 hours**.
- App: guardian hub + auth screens (honest not-configured state until the
  owner creates the project), foreground LocationSharingService (Balanced,
  ~30 s/~25 m, batch ≥3 points or 60 s, stops on background, toggle-off =
  stop + server purge), pairing code + QR, approve/deny, revoke.
- PWA `guardian-pwa/`: installable, AR/EN + RTL, Supabase sign-in, code
  redeem, Leaflet/OSM map + freshness + 24 h history, revoke-my-access,
  FCM Web Push registration into push_endpoints (web-fcm); works fully
  minus push when Firebase is unconfigured.
- Edge Functions `supabase/functions/`: notify-guardian (caller must be
  the owner; FCM HTTP v1 via service-account JWT + Expo Push; payloads
  carry NO location; only 'test' wired in Phase 1) and cleanup-locations
  (CRON_SECRET-gated). All privileged keys are Edge secrets only.

Gates — actual results (2026-10-30, branch v1.1):

| Gate | Result |
|---|---|
| `npm ci` | ✅ succeeds |
| `npx tsc --noEmit` | ✅ clean, 0 errors |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm test -- --runInBand` | ✅ **15 suites, 150 tests, all pass** (79 pre-existing + 71 new: UpdateService 10, pairing 3, GuardianService 8, location sharing 6, static RLS contract 44) |
| `npx expo export --platform android` | ✅ succeeds — all 3 models in dist, SHA256-identical (YOLO 19bfdc3c…, det 04e8e0b6…, rec 1fc31af5…) |
| PWA static checks | ✅ `node --check` passes for app.js/config.js/both service workers; manifest parses as JSON |
| `sha256sum assets/models/yolo11n.tflite` | ✅ 19bfdc3c… — unchanged |

**NOT done / NOT verified (honest list):**
- Live RLS execution: no Docker/Postgres exists in this environment and
  the owner has not created the Supabase project. `supabase/tests/
  rls_tests.sql` covers the full denial matrix and must be run by the
  owner (docs/GUARDIAN_SETUP.md §3) — until then RLS is verified
  statically (44-assertion jest contract) + by client-contract tests only.
- No 1.1.0 APK built yet (parent runs EAS next); no OTA smoke publish yet;
  the 1.0.0-cannot-receive-OTA confirmation is by artifact inspection
  (no expo-updates in the 1.0.0 APK) until the smoke test runs.
- No device tests of Phase 0/1 (location permission flow, sharing,
  updates screen) — pending the 1.1.0 build and the owner's Supabase setup.
- Background tracking (Phase 2) and live hazard alerts (Phase 3) are NOT
  implemented and must not be claimed.

## V1.1 build + OTA smoke test (2026-10-30, parent-verified)
- EAS preview build 422c78b1-c5ca-4971-84f1-9c9438eb4c97: FINISHED. APK
  https://expo.dev/artifacts/eas/dlg3b43qcODwHH-z8ObF7em3z7b9KGjsKT_L16Kdlns.apk
  (206,294,287 B, sha256 40b5dd1e27124308327b5670004821d7fd64d5702fd93268e932d2df54d914f6)
  verified locally: package me.auramarketing.basera, versionName 1.1.0,
  versionCode 2; libexpo-updates.so present (4 ABIs); all 3 models embedded
  hash-identical (YOLO 19bfdc3c…, PP-OCR rec 1fc31af5…, det 04e8e0b6…);
  manifest (aapt2) has FINE/COARSE/BACKGROUND location, FOREGROUND_SERVICE
  (+_LOCATION), POST_NOTIFICATIONS.
- Submit lesson: bare workflow rejects runtimeVersion POLICIES — first
  submits failed AFTER upload with a deterministic EAS error; runtimeVersion
  is now the manual string "1.1.0" (bump together with version).
- OTA smoke test: JS-only update published to channel preview — update
  group 2f29ef5b-72b4-4154-9005-046e2740741c, branch preview, runtimeVersion
  "1.1.0" (server-verified via eas update:list). The update adds one release
  note entry (src/update/releaseNotes.ts) — visible proof on a 1.1.0 device
  after download + safe restart. eas update on this CLI requires
  --environment preview in non-interactive mode.
- 1.0.0 exclusion reconfirmed: the 1.0.0 APK contains zero expo-updates
  native libraries — it cannot receive OTA updates at all.
- On-device pickup of the update (install 1.1.0 → relaunch → note appears)
  remains a TEAM device check; server-side targeting is proven.

## OTA audit + offline revocation (2026-10-30, branch v1.1)

Release-gate closure items 1 and 2 (see docs/OTA_AUDIT.md):

- OTA single authoritative flow: app.json checkAutomatically is now
  ON_ERROR_RECOVERY; prebuild (no --clean) changed exactly one manifest
  line (EXPO_UPDATES_CHECK_ON_LAUNCH ALWAYS -> ERROR_RECOVERY_ONLY).
  UpdateService: overlapping checkAndDownload() calls share one in-flight
  run (native check invoked exactly once — test-asserted);
  restartToApply() additionally refuses with reason 'in-progress' while
  a check/download runs, and still refuses while accessibility is busy.
  NOTE: checkAutomatically lives in the native manifest, so the config
  change takes effect only in the NEXT APK build; the JS hardening
  ships via OTA. Device receipt/application of the published smoke
  update (group 2f29ef5b, runtime 1.1.0) remains **NOT TESTED** — team
  device steps are in docs/OTA_AUDIT.md §5.
- Offline location revocation: PendingDeletion state machine
  (none -> pending -> confirmed). The pending record is persisted in
  SecureStore before any network attempt; 'confirmed' is assigned in
  exactly one code location (the executor's success branch); retries
  fire on app launch, AppState foreground, guardian-screen mount, and a
  Retry button. Covered by 11 new tests (fake backend + fake storage):
  offline disable stops uploads immediately and stays pending; restart
  persistence; retry success confirms and clears; failures increment
  attempts and never confirm; re-enabling sharing never drops the
  obligation (purge runs before setSharingEnabled(true)).
- Live Supabase (migrations, live RLS denial matrix, two-device
  pairing/GPS/PWA/push): **NOT TESTED** — the owner's Supabase project
  does not exist yet; procedure in docs/GUARDIAN_SETUP.md.
- Gates for this section: npm ci OK; tsc clean; lint clean; jest
  16 suites / 165 tests, all passing (baseline 15/150; +4 update
  tests, +11 pending-deletion tests, +1 suite); expo export OK with
  all 3 models hash-identical to source (yolo11n 19bfdc3c…,
  ppocr_arabic_rec 1fc31af5…, ppocr_det 04e8e0b6…).

## 2026-10-30 (evening) — Premium UX transformation + V1.1 completion (branch v1.1)

Full re-verification after the mission (navigation restructure, Home +
Assistance, Settings rebuild, Smart Place Memory, scan-based hazard
alerts + SOS, background location):

| Gate | Result |
|---|---|
| `npm ci` | ✅ succeeds from package-lock (foreground install, verified on disk) |
| `npx tsc --noEmit` | ✅ clean, 0 errors |
| `npm run lint` (expo lint) | ✅ 0 errors, 0 warnings |
| `npx jest --runInBand` | ✅ **21 suites, 233 tests, all pass** (baseline at mission start: 16 suites / 165 tests) |
| `npx expo export --platform android` | ✅ succeeds; all 3 bundled models hash-identical to source (YOLO11n `19bfdc3c…`, PP-OCR det `04e8e0b6…`, PP-OCR Arabic rec `1fc31af5…`) |

New suites in this pass: theme/haptics gates + speech gate (speech off
suppresses ALL TTS incl. alerts; separate alert repeat target), risk
engine (14 tests: thresholds, 2-of-3 persistence, 20 s cooldown,
escalation, person-never-high), hazard service (alert delivery +
honest SOS outcomes), voice parser (new intents + argument extraction;
ALL pre-existing regression cases unchanged), places (normalization,
haversine, honest distance phrasing, store CRUD, proximity cooldown —
incl. a real epoch-0 cooldown bug the tests caught), background
location (offline queue FIFO/cap, sharing-state derivation, option
building + permission gating, batch handler upload-or-queue honesty),
static RLS assertions for migration 0004 (owner-only saved_places;
guardians NO access).

NOT TESTED (unchanged, owner/team-gated): on-device OTA receipt,
live Supabase migrations + RLS matrix execution, two-device
pairing/GPS/PWA/push flows, background tracking on a real device,
push delivery. Background location is implemented in code and
manifest-verified JS-only on runtime 1.1.0 (see FEATURE_STATUS.md) —
device execution still pending.
