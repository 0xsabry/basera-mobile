# BASERA Feature Status — honest labels only

Labels: **Implemented and tested** · **Implemented but not fully tested** ·
**Simulated** · **Planned for future hardware**

| Feature | Status | Evidence / note |
|---|---|---|
| App startup + navigation (7 screens, expo-router) | Implemented and tested | tsc clean, jest green, `expo export --platform android` succeeds (see TESTING.md) |
| Onboarding with language pick + glasses honesty note | Implemented and tested | Code + export; first-run redirect logic covered by settings tests |
| Home dashboard (actions, mode/status, last result) | Implemented and tested | Code + export |
| Gallery image input | Implemented but not fully tested | Real expo-image-picker integration; needs a device to verify the picker UX end-to-end |
| Sample image input (4 bundled samples) | Implemented and tested | Samples run through the real model host-side (verify_model.py); on-device path uses the same CapturedImage contract |
| Phone camera input (TEST only, labeled as such) | Implemented but not fully tested | Real expo-image-picker camera integration; device check pending |
| Object detection — YOLO11n on-device (TFLite) | Implemented but not fully tested (needs device/dev build) | Model is REAL (official Ultralytics ONNX → TFLite, hash-verified); post-processing PROVEN against the real model output in jest. 2026-10-30 stabilization: the device failure root cause (Hermes has no global `Buffer`, `atob` unreliable — Node-based jest masked it) is FIXED with a pure-TS base64 decoder + direct Uint8Array JPEG decode, with a regression test that deletes both globals. Native inference itself can only run in the app build on a device — no device was available to the agent |
| Bounding-box overlay | Implemented but not fully tested | Drawn from the same normalized boxes the jest suite verifies; visual check needs a device |
| Description builder (AR + EN, counts, positions, priority ordering) | Implemented and tested | Unit-tested in both languages |
| Obstacle awareness (position + proximity category) | Implemented and tested | Unit-tested. Heuristic category ONLY — never a distance; see ObstacleAwareness.ts docstring |
| OCR — ML Kit Latin (explicit Latin script) | Implemented but not fully tested (needs device/dev build) | Real ML Kit binding; called explicitly with `TextRecognitionScript.LATIN`. ML Kit has NO Arabic model (proven from the installed library, 2026-10-30) — the earlier "Arabic + Latin" label here was wrong and is corrected. Language-detection logic unit-tested; native OCR run needs a device |
| OCR — Arabic via PP-OCR (on-device TFLite) | Implemented, host-verified; device check pending | PP-OCRv3 det + Arabic PP-OCRv3 mobile rec (fixed-shape TFLite). Host gate on the bundled Arabic sample: 0.730 char overlap of the known text (≥0.70 required); jest reproduces recorded model outputs for box extraction + CTC decode. Small mobile model — confuses some dotted letters; never invents text. See docs/MODELS.md |
| Text-to-Speech (AR + EN, rate, repeat, stop) | Implemented but not fully tested | expo-speech integration; audible verification needs a device. Repeat fixed 2026-10-30: announcements (welcome/status) no longer overwrite the repeat target — unit-tested |
| Voice commands — parser (AR + EN, 7 implemented + 1 planned) | Implemented and tested | Unit-tested incl. planned/unknown handling; parser unchanged in the 2026-10-30 stabilization |
| Voice commands — microphone recognition | Implemented but not fully tested (needs device/dev build) | expo-speech-recognition 58.0.1 native module (migrated 2026-10-30 from the archived voice library that broke Gradle); EAS dev build FINISHED + artifact-verified. Stabilization: typed error kinds localized (no raw English in Arabic mode), 'end'/'nomatch' session completion, stop-listening button, unmount/blur cleanup — adapter unit-tested; device check pending |
| History (save/list/reopen/delete/clear, on-device only) | Implemented and tested | Store logic unit-tested incl. cap + corruption handling |
| Settings (language, theme, rate, contrast, announcements, privacy) | Implemented and tested | Persistence + theme resolution unit-tested |
| Arabic RTL layout flipping | Implemented but not fully tested | I18nManager.forceRTL applied on language change; full visual flip verification needs a device (native RTL switch requires app reload) |
| OTA updates (expo-updates, preview/production channels) | Implemented but not fully tested (needs the 1.1.0 APK) | V1.1 Phase 0 (branch v1.1): expo-updates wired (runtimeVersion = appVersion policy, updates.url set, fallbackToCacheTimeout 0), UpdateService unit-tested (download never reloads; reload blocked while speech/recognition/processing busy; unavailable in builds without the native module). The 1.0.0 MVP APK has NO expo-updates module and can NEVER receive OTA — proof pending the 1.1.0 build + a live publish smoke test (parent-run). Release notes come from in-bundle src/update/releaseNotes.ts, not the eas --message text |
| Guardian pairing + consent (Supabase Auth + RLS) | Implemented but not fully tested (needs owner's Supabase project) | V1.1 Phase 1: migrations 0001-0003 (RLS denial matrix, hashed 15-min single-use pairing codes, redeem creates PENDING only, owner approve RPC mandatory, purge on sharing-off / last-guardian revoke, 24 h retention cleanup). Client contract unit-tested with a fake Supabase client; static SQL contract test (44 assertions) green. LIVE RLS execution (supabase/tests/rls_tests.sql) requires the owner's project — NOT yet run |
| Foreground GPS sharing (phone location) | Implemented but not fully tested (needs owner's Supabase project + device) | Foreground-only watch (Balanced, ~30 s/~25 m, batched uploads ≥3 points/60 s), stops on app background, instant purge on toggle-off. It is the PHONE's location, not the glasses'. Background tracking is NOT implemented (Phase 2) |
| Guardian PWA (map, freshness, FCM Web Push) | Implemented but not fully tested (needs deployment) | Installable PWA in guardian-pwa/: Supabase sign-in, code redeem, Leaflet/OSM latest-location map + 24 h history, freshness from updated_at, revoke-my-access, FCM Web Push endpoints registered separately (web-fcm) from Android (android-expo). No live deployment yet |
| Hazard alerts to guardians | Planned (Phase 3) | hazard_events table + notify-guardian Edge Function exist; NO live hazard detection/alert pipeline runs yet — do not claim otherwise |
| Smart glasses camera input | Planned for future hardware | Interface + typed NotAvailable implementation only. NO fake frames, NO fake Bluetooth/Wi-Fi |
| Distance measurement | Planned for future hardware | Impossible honestly without a depth sensor; app never claims meters |
| Continuous obstacle scanning ("is the path clear?") | Planned | Registered in the voice command registry as planned; the app says so when asked |

Nothing in this app is "Simulated": features either run for real or say
plainly that they are unavailable / planned.
