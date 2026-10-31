# BASERA V1.1 — Premium UI/UX Redesign

**Date:** 2026-10-31 · **Branch:** v1.1 · **Runtime:** 1.1.0 (unchanged) · **JS-only, OTA-deliverable**
**Scope rule honored throughout:** presentation only. Every handler, service call, route,
testID-equivalent accessibility label and honest status from the previous UI is preserved.
No dependency was added (package.json + lockfile byte-identical to the pre-redesign HEAD),
no native file changed (android/ diff empty), no functionality was removed or faked.

## Why the installed app did not show this experience before

The owner's installed 1.1.0 APK still runs the ORIGINAL embedded JS bundle. The full V1.1
completion OTA was never successfully published from the sandbox (egress failures across
130+ attempts; the owner also has a Windows publish path). So the device showed the
pre-completion interface — stacks of identical full-width green buttons — not the
completed V1.1 UX, and certainly not this redesign. This redesign ships as the next
preview OTA on runtime 1.1.0; no reinstall is needed.

## The design system

`src/theme/tokens.ts` (rewritten) + `src/theme/glyphs.ts` (new) + `src/components/ui.tsx` (new):

- **Palettes** — refined deep-teal/ink system in light, dark, and high-contrast variants.
  Every text/background pair actually used is **programmatically verified ≥ 4.5:1 (WCAG AA)**
  by `src/theme/__tests__/contrast.test.ts` — 100 pair checks across the 4 palettes.
- **Scales** — 4pt spacing (xxs–xxl), radius (xs–pill), elevation (card/raised/hero),
  typography with a `display` step; all sizes still multiply by the user's textScale.
- **Iconography** — system-font glyphs in tinted tiles (`src/theme/glyphs.ts`). No icon
  package exists in the built APK and dependencies are frozen, so icons are glyph + label,
  never emoji, never icon-only, never color-only.
- **Primitives** — Screen, AppHeader/BrandMark, Card, Banner, EmptyState, SectionHeader,
  StatusPill, IconTile, FeatureTile (row/grid), ListRow, HeroAction, SegmentedControl
  (selected = filled + ✓ + bold), CompactAction + ActionGrid, ViewfinderFrame.
  AccessibleButton was restyled onto the same tokens with its API unchanged.
- **Accessibility** — targets ≥56dp (tiles/rows ≥72dp, hero 96dp), status always
  glyph + text, press feedback is opacity-only and fully disabled under reduced motion,
  chevrons flip by language direction (logical properties used throughout).

## Before → after, per screen

| Screen | Before | After |
|---|---|---|
| **Home** | Centered title + 5 identical full-width green buttons + plain bordered text cards | Brand header (mark, greeting, localized date), one voice hero, honest glasses card with status pill, device-status card from real signals (assistant + sharing pills), 2-column feature grid with distinct glyphs/subtitles, contextual alert banner + last-result card |
| **Tabs** | Plain glyph + label, tint-only active state | Active tab = tinted pill behind glyph + accent + bold label (never color alone); config exported (`TAB_SCREENS`) for structure tests; 5 tabs, order and labels unchanged |
| **Assistance** | Button stack + plain permission rows | Voice hero, feature tiles, speech controls as an action grid, permission rows with status pills, SOS in a danger card |
| **History** | Flat rows + full buttons | Day-grouped cards with thumbnails, kind/time meta, detail card with per-detection confidence |
| **Settings** | 20+ identical full-width option buttons | Grouped A–G sections; language/theme/text-size/radius/voices are segmented controls with ✓ on the selected option; switches in setting rows; permissions as cards with status pills — **every real control preserved** |
| **Family** | Headings + plain cards/rows | Sectioned cards with status pills (sharing state, background state, guardian approval), pairing code + QR in a framed card; all consent/deletion logic untouched |
| **Detect** | Plain preview + text lists + button stack | Viewfinder corner framing with detection boxes, result card, per-detection confidence pills, hazard Banner, action grid |
| **Read** | Plain preview + text + button stack | Viewfinder framing, result card with detected-language pill, action grid |
| **Voice** | One big button + text rows | Mic hero disc with an explicit idle/listening/error state machine (tone **and** text), transcript/feedback cards, command rows with implemented/planned pills |
| **Places** | Button chip stack + 6 stacked buttons per place | Form card with a segmented category picker (glyphs), place cards with category tile + proximity pill + compact action grid |
| **Alerts** | Plain cards with 3 stacked buttons each | Severity cards (level glyph + level pill + real notify-outcome pill), action grid, blind-spots honesty card |
| **Updates** | Plain text card | Status card with phase pill, release notes as a titled card |
| **Onboarding** | Title + text + 2 buttons | Brand hero (84dp mark), welcome line, body card, glasses-honesty info banner, language actions — finish flow identical |
| **Guardian auth** | Bare inputs + buttons | Brand header + form card with labeled fields, error banner; unconfigured state is an honest EmptyState |
| **ImageSourcePicker** (shared) | 4 identical buttons | 4 distinct tiles (gallery/camera/samples/glasses with its honest "not connected" subtitle); glasses NotAvailable alert unchanged |

## Verification (all executed on the final tree)

- **Jest:** 23 suites / **348 tests PASS** (baseline 21/233 → +100 contrast tests,
  +15 UI tests: render-smoke for all 13 screens via the project's jest mocks +
  react-dom/server, tab-structure test, RTL chevron test). No test weakened.
- **tsc:** clean · **Lint:** 0 errors, 0 warnings.
- **Frozen deps:** `git diff` on package.json + package-lock.json vs pre-redesign HEAD = empty.
- **Native:** `git diff` on android/, app.json, eas.json = empty. Runtime stays "1.1.0";
  package/owner/projectId/signing untouched.
- **Export:** `expo export --platform android` OK; all 3 ML models byte-identical
  (yolo11n 19bfdc3c…, ppocr_det 04e8e0b6…, ppocr_arabic_rec 1fc31af5…).

## Screenshots — honesty labels

Rendered from the **exported WEB build** (`expo export --platform web`) in headless
Firefox (Playwright) at 390×844 @2x, with the app's own persisted-settings key seeded
to pass the onboarding gate and select language/theme. These are **rendered-web**
captures of the real redesigned screens — NOT Android device screenshots; native-only
behavior (TalkBack, haptics, camera/ML) is not represented by them and remains
device-verification territory. Files in `~/workspace/your_files/basera-redesign/`:

- `onboarding-ar.png` — Onboarding, Arabic, system-light
- `home-ar-dark.png` — Home, Arabic, dark · `home-en-light.png` — Home, English, light
- `assistance-ar-dark.png` — Assistance, Arabic, dark
- `settings-ar-dark.png` — Settings, Arabic, dark · `settings-en-light.png` — English, light
- `family-ar-dark.png` — Family (honest unconfigured state), Arabic, dark
- `voice-ar-dark.png` — Voice mic hero, Arabic, dark
- `detect-ar-dark.png` — Detect source tiles, Arabic, dark
- `places-ar-dark.png` — Places form, Arabic, dark
- `alerts-en-light.png` — Alerts, English, light

(The sandbox's Chromium is policy-locked for direct headless use — "Hatch WebGL domain
policy is required" — so Firefox via Playwright was the working renderer.)

## Remaining blockers

- **OTA publish** — see the mission report: attempted with the established alternating-route
  recipe; result recorded there with the log tail. If it did not land, the owner can publish
  from Windows with the same command used for the V1.1 completion update.
- **OTA group 24af3e7b-4d6c-41b0-adb5-1de6eee3c8fc** (owner's question) — investigation
  result recorded in the mission report.
- Device verification (TalkBack pass, small/large handsets, keyboard/safe-area behavior
  on hardware) remains a team task — nothing here claims it.
