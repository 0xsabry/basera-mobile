# BASERA — Critical Bug-Fix Release (app 1.1.1 / versionCode 3, runtime 1.1.0)

Baseline: HEAD `665a250` (jest 27 suites / 392 tests, PWA 18/18, tsc/lint clean).
This release fixes the five owner-reported, device-observed bugs. All changes
are JS/TS only: `package.json`/`package-lock.json` are byte-identical to the
baseline, `android/` is untouched, `runtimeVersion` stays the string `"1.1.0"`
(OTA compatibility preserved), signing/project identity unchanged.

## Bug 1 — GPS shows wrong / unreliable addresses

**Root cause.** There was no reverse geocoding anywhere in the app: the
My Location card (Family) showed fix age, accuracy and an OSM tile preview,
but no human-readable address at all — any "address" a user saw was a saved
place name or stale context, never derived from the current fix. Coordinates
themselves were correct (`currentFix.ts` maps `coords.latitude/longitude`
to `GeoFix.lat/lng` in the right order).

**Fix** — `src/places/geocode.ts` (new) + wiring in
`src/components/MyLocationCard.tsx`:
- Nominatim reverse geocoding
  (`nominatim.openstreetmap.org/reverse`, `zoom=18`, `addressdetails=1`)
  with `User-Agent: BASERA/1.1 (me.auramarketing.basera)` and
  `Accept-Language` set to the **active app language**, so Arabic mode gets
  Arabic Egyptian names and English mode gets English.
- Policy compliance: cache keyed by coordinates rounded to ~100 m cells
  (plus language); ≥1.1 s between network calls; a fix <100 m from the last
  geocoded one reuses the cached result — never one request per GPS tick.
- Latest-wins: a monotonic token discards slow older responses; the card
  only applies a result whose `forFixAt` matches the displayed fix.
- Fallback chain: Nominatim → `expo-location` `reverseGeocodeAsync`
  (device geocoder) → coordinates-only display with an explicit
  "address unavailable" message. Nothing is ever fabricated.
- Formatting uses only returned fields (road → suburb/neighbourhood →
  city/town → state → country), skipping missing parts; the address is
  labelled **approximate** when accuracy is worse than 100 m; accuracy and
  fix age remain displayed; coordinates are shown on their own labelled
  line, visually distinct from the address. No coordinates are logged.
- Guardian PWA checked: it renders a map marker/freshness only — it never
  presented coordinates as an address.

**Tests:** `src/places/__tests__/geocode.test.ts` — 12 tests (AR/EN
formatting from fixture Nominatim payloads incl. missing fields, lat/lng
order in the request URL, Accept-Language, cache/throttle, stale-response
rejection, fallback order, approximate thresholds).

## Bug 2 — Arabic ↔ English switching breaks the layout

**Root cause.** `SettingsContext.applyLayoutDirection()` called
`I18nManager.forceRTL()` on language change, but React Native applies a
forced direction change only on reload and nothing restarted the app — so
strings switched while the running UI kept the old direction (mixed,
broken layout on every screen).

**Fix** — `src/state/languageRestart.ts` (new) + `SettingsContext`:
- `switchLanguage(lang)` persists the new locale, applies the direction
  flag, and — only when RTL-ness actually flips — requests a **safe
  restart** through a `LanguageRestartCoordinator`: it announces
  «سيتم إعادة تشغيل التطبيق لتطبيق اللغة» / "The app will restart to apply
  the language" **in the new language**, then reloads via
  `expo-updates.reloadAsync()` exactly once.
- If an accessibility operation is busy (speech, recognition, processing,
  hazard — `src/state/accessibilityBusy.ts`, which gained a subscribe
  API), the restart is announced as deferred and fires the moment the app
  becomes idle. A second request while pending is a no-op.
- If the updates module is unavailable (dev/Expo Go), nothing fakes a
  restart: `languageRestartPendingManual` is exposed in context and the
  persisted language + direction apply on the next cold start.
- All entry points use it: Settings language row, onboarding finish, and
  the voice "change language" command.
- Audit follow-through (found by a new static scan test,
  `src/i18n/__tests__/hardcodedStrings.test.ts`): four hardcoded bilingual
  strings bypassing the dictionary were fixed (History back label, spoken
  OCR prefix, onboarding spoken welcome, voice language confirmation) and
  one device-locale-pinned date (`family.tsx`) now formats in the app
  language. No module-level `isRTL` captures exist; the scan test's
  whitelist now contains only brand/proper-noun and recognition-vocabulary
  entries, guarded against staleness.

**Tests:** `languageRestart.test.ts` + `accessibilityBusy.test.ts` —
restart matrix, idle/busy/deferred/double-request/unavailable/reload-
failure paths; scan test passes with zero known-debt entries.

## Bug 3 — Selecting an image always errors

**Root causes (per failure mode).**
1. Sources returned the **raw** picker asset (content:// or file://,
   PNG/JPEG/WebP/HEIC, any size). Detection ran a single
   `manipulateAsync`; any failure (unsupported format, unresolvable
   content URI, huge-image memory pressure) escaped as a raw native error.
   ML Kit OCR received the raw URI with **no** normalization at all.
2. `buildTensorFromJpegBase64` only guarded a null decode — jpeg-js
   actually **throws** on non-JPEG input (verified on host: `SOI not
   found` against the bundled PNG sample), escaping untyped.
3. Sources threw raw `Error('PERMISSION_DENIED:x')`, matched elsewhere by
   string prefix only.
4. Both AI screens collapsed almost every failure into one generic
   message (Arabic) or the raw English exception text (English).

**Fix** — `src/ai/normalizeImage.ts` (new) is the single choke point:
every selected/captured/sample image is resized to a ≤1280 px long edge
and re-encoded as JPEG (compress 0.85) via `expo-image-manipulator`
before **any** consumer. Detection computes its letterbox from the
normalized image; ML Kit and the Arabic PP-OCR engine both receive the
normalized file. A typed `ImagePipelineError`
(`permission-denied | unsupported-format | decode-failed | model-failed |
processing-failed`) plus `classifyImageError()` maps every failure to a
localized Arabic/English message that says what failed and what to do —
in the picker and in both screens. Busy/re-entry guards were verified
intact. No remote upload or AI backend was introduced; all processing
stays on-device.

**Tests:** `src/ai/__tests__/normalizeImage.test.ts` (21) +
`src/input/__tests__/imageSourcesPermission.test.ts` (2): classifier
mapping for every representative error, resize math, the manipulator call
contract (mocked native module), and the **host pipeline on real bytes** —
a real PNG and corrupt bytes classify as decode-failed; a real JPEG
produces the 3×640×640 tensor.

## Bug 4 — No voice output; voice list confusing

**Root causes (audited).**
1. **Stale persisted voice (confirmed in code):** `utter()` passed the
   persisted `voiceIdentifier` unconditionally and nothing validated it
   against the device voice list. If that voice/engine vanished, every
   utterance could fail with `onError` only clearing a busy flag — total
   silence with no signal anywhere.
2. **Swallowed engine errors (confirmed):** all TTS callbacks funnelled
   to the same busy-clear; an Arabic utterance on a device without Arabic
   voice data failed invisibly.
3. The picker rendered every ar/en voice as `${name} — ${language}` in a
   segmented control — raw identifiers like `ar-xa-x-ser-network`, dozens
   of entries, no way to test any of them; an empty list made the picker
   silently vanish.
4. Ruled out: the master speech gate cannot get stuck off — default is
   `true`, settings parsing merges defaults, and the only writer is the
   labelled Settings switch. Rate is clamped 0.5–2.0 in the service and
   the slider matches.

**Fix.**
- `src/ai/voiceCatalog.ts` (new, pure): curates the device list —
  ar/en only, deduped, empty IDs dropped, exact-locale first, human
  engine hint only when safely readable (e.g. "Google"); raw IDs are
  never displayed. Labels are «العربية — صوت متاح» /
  "English — Available voice" (+ hint).
- Settings picker rebuilt: a System-default row plus per-language groups
  of selectable rows, each with a **Test voice** button.
  `SpeechService.testSpeak()` actually speaks the sample in that voice
  (announcement path — never clobbers Repeat) and resolves honestly;
  a failed test shows «تعذّر تشغيل هذا الصوت…» and reverts a selected
  failing voice to the system default.
- `SpeechService.validateVoiceSelection()` runs when the picker loads:
  a persisted identifier the device no longer has is cleared (service +
  settings) to the system default — the silent-everything mode is gone.
- An empty language group now shows the exact recovery guidance
  (install voice data via Android Settings → Accessibility →
  Text-to-speech output) instead of a vanished picker.

**Tests:** `voiceCatalog.test.ts` (6) + `speechServiceVoice.test.ts`
(10): curation of junk/duplicate/mixed-locale fixtures, test-speak
success/failure/gate-off semantics, stale-selection clearing.

## Bug 5 — Bottom navigation icons barely visible

**Root cause (measured, and it corrects the first guess).** The colour
ratios already passed WCAG on paper (inactive `textSecondary` on
`surface`: 7.57:1 light / 10.13:1 dark). The real failure is rendering:
the tab glyphs are thin outline forms (◇ ♡ ⌂ ⚙) drawn at fontWeight 400 —
~1 px strokes that wash out on real device displays regardless of the
nominal ratio.

**Fix.** Dedicated `tabActive`/`tabInactive` tokens in all four palettes
(global `primary`/`textSecondary` untouched), held by tests to ≥9:1
against the tab-bar surface (after: inactive 12.5:1 light / 13.4:1 dark;
active 9.9:1 / 10.1:1; high-contrast higher), and the inactive glyph
weight raised 400 → 600 (active 800) at the same restrained 24 dp — no
filled blocks, no oversized icons. Active state remains colour + weight
on both glyph and label (never colour alone); safe-area padding and
TalkBack labels unchanged.

**Tests:** `src/theme/__tests__/contrast.test.ts` extended by 24 tests
(tab pairs asserted for icon and label in all four palettes).

## Verification matrix

| Area | Host / automated | Real device |
|---|---|---|
| Jest full suite | **35 suites / 482 tests PASS** (baseline 392 kept, +90 new) | — |
| Guardian PWA tests | **18/18 PASS** | — |
| TypeScript / lint | `tsc` clean; `expo lint` 0 errors, 0 warnings | — |
| Android export | succeeds; all 3 TFLite models present, SHA-256 identical to source (yolo11n `19bfdc3c…`, ppocr_det `04e8e0b6…`, ppocr_arabic_rec `1fc31af5…`) | — |
| Geocoding format/throttle/fallback | unit-tested with fixtures | NOT TESTED (live Nominatim + device geocoder) |
| Image normalization contract + JPEG tensor | unit/host-tested on real bytes | NOT TESTED (manipulator/ML Kit/TFLite on handset) |
| Language restart decision logic | unit-tested | NOT TESTED (actual reload + RTL flip on handset) |
| Voice curation / test-speak logic | unit-tested with mocked expo-speech | NOT TESTED (audibility is device-only by nature) |
| Tab contrast | computed + locked by tests | NOT TESTED (on-screen visibility) |

**No real-device testing was performed for this release.** Device model /
Android version / test date: NOT TESTED — nothing in this document claims
otherwise. The mandatory on-device checklist (GPS address in AR+EN,
language round-trip across all tabs, gallery/camera/OCR flows, voice
playback + picker test, tab visibility in 3 themes at text scale 1.3)
must be run by the team on the delivered APK.

## Build

Standalone team APK (embedded bundle — opens BASERA directly, no Metro):

```bash
export EXPO_TOKEN=<robot token for @0xsabry>
~/workspace/.scratch-basera/build-team-apk.sh   # eas build --platform android --profile preview
```

App **1.1.1**, Android **versionCode 3**, package
`me.auramarketing.basera`, runtimeVersion `"1.1.0"` (OTA updates published
for runtime 1.1.0 remain compatible with this build).
