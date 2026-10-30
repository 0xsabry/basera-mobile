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
| Object detection — YOLO11n on-device (TFLite) | Implemented but not fully tested (needs device/dev build) | Model is REAL (official Ultralytics ONNX → TFLite, hash-verified); post-processing PROVEN against the real model output in jest (44 tests). Native inference itself can only run in the dev build on a device — no emulator/device was available in this environment |
| Bounding-box overlay | Implemented but not fully tested | Drawn from the same normalized boxes the jest suite verifies; visual check needs a device |
| Description builder (AR + EN, counts, positions, priority ordering) | Implemented and tested | Unit-tested in both languages |
| Obstacle awareness (position + proximity category) | Implemented and tested | Unit-tested. Heuristic category ONLY — never a distance; see ObstacleAwareness.ts docstring |
| OCR — ML Kit (Arabic + Latin) | Implemented but not fully tested (needs device/dev build) | Real ML Kit binding installed; language-detection logic unit-tested; native OCR run needs a device |
| Text-to-Speech (AR + EN, rate, repeat, stop) | Implemented but not fully tested | expo-speech integration; audible verification needs a device |
| Voice commands — parser (AR + EN, 7 implemented + 1 planned) | Implemented and tested | Unit-tested incl. planned/unknown handling |
| Voice commands — microphone recognition | Implemented but not fully tested (needs device/dev build) | @react-native-voice/voice native module; device check pending |
| History (save/list/reopen/delete/clear, on-device only) | Implemented and tested | Store logic unit-tested incl. cap + corruption handling |
| Settings (language, theme, rate, contrast, announcements, privacy) | Implemented and tested | Persistence + theme resolution unit-tested |
| Arabic RTL layout flipping | Implemented but not fully tested | I18nManager.forceRTL applied on language change; full visual flip verification needs a device (native RTL switch requires app reload) |
| Smart glasses camera input | Planned for future hardware | Interface + typed NotAvailable implementation only. NO fake frames, NO fake Bluetooth/Wi-Fi |
| Distance measurement | Planned for future hardware | Impossible honestly without a depth sensor; app never claims meters |
| Continuous obstacle scanning ("is the path clear?") | Planned | Registered in the voice command registry as planned; the app says so when asked |

Nothing in this app is "Simulated": features either run for real or say
plainly that they are unavailable / planned.
