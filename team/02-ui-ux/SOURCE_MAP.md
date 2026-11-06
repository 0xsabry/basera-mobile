# 02 — Source Map: UI/UX

## Screens (Expo Router, `src/app/`)

| Path | Screen |
|---|---|
| `src/app/(tabs)/index.tsx` | Home |
| `src/app/(tabs)/assistance.tsx` | Smart Assistant hub |
| `src/app/(tabs)/history.tsx` | History |
| `src/app/(tabs)/family.tsx` | Family / Guardian |
| `src/app/(tabs)/settings.tsx` | Settings |
| `src/app/detect.tsx` | Object detection flow |
| `src/app/read.tsx` | Text reading (OCR) flow |
| `src/app/voice.tsx` | Voice commands flow |
| `src/app/alerts.tsx` | Hazard alerts list |
| `src/app/places.tsx` | Saved places |
| `src/app/updates.tsx` | In-app update screen |
| `src/app/onboarding.tsx` | First-run onboarding + permissions |
| `src/app/guardian-auth.tsx` | Guardian sign-in / sign-up |
| `src/app/settings-voice.tsx` | Voice selection (auto / system / custom) |
| `src/app/_layout.tsx` | Root layout, providers, startup |
| `src/app/(tabs)/_layout.tsx` | Tab bar definition |

## Design system

| Path | Contents |
|---|---|
| `src/components/ui.tsx` | `Screen`, `Card`, `Banner`, `StatusPill`, `ListRow`, `SectionHeader`, `EmptyState`, `QuietGroup` — every screen is composed from these; screens do not hand-roll cards |
| `src/components/AccessibleButton.tsx` | The one button component (label, variant, busy/disabled states) |
| `src/components/ThemedStatusBar.tsx` | Status bar follows the active theme in both modes |
| `src/components/ImageSourcePicker.tsx` | Gallery / camera-test source picker |
| `src/components/MyLocationCard.tsx`, `src/components/LocationMapPreview.tsx` | Location card + OSM tile preview with attribution |
| `src/components/QrCodeView.tsx` | Pairing QR rendering |
| `src/theme/tokens.ts` | Spacing, radius, elevation, type scale |
| `src/theme/glyphs.ts` | `GLYPHS` icon set (text glyphs, screen-reader friendly) |
| `src/state/SettingsContext.tsx` | `SettingsProvider`, `useSettings()`, `colorsFor(isDark, highContrast)`, `resolveIsDark()`, `applyLayoutDirection()` — theme resolution and RTL |

## Visual identity

- Olive identity (from 1.1.4): deep olive `#26372D`, primary `#657A4D`,
  sage `#C7D5B8`, ivory `#F5F3EA`. No blue anywhere in `src/`.
- Official logo frozen byte-identical: `assets/brand/basera-logo-official.png`.
- Fresh installs default to the **light** theme; the status bar stays
  readable in both themes.

## Accessibility machinery

| Path | Role |
|---|---|
| `src/state/accessibilityBusy.ts` | Busy announcements for assistive tech |
| `src/state/navGuard.ts` | Navigation guards for in-progress flows |
| `src/state/haptics.ts` | Haptic feedback wrapper |
| `src/state/languageRestart.ts` | Applies a language change safely |

## Localization

| Path | Role |
|---|---|
| `src/i18n/strings.ts` | `STRINGS: Record<'en' \| 'ar', Record<StringKey, string>>` — key parity enforced by type and test |
| `src/i18n/__tests__/copy.test.ts` | Bans dialect terms + standalone «مش», label length budgets, explanation length caps, terminology spot checks |
| `src/i18n/__tests__/hardcodedStrings.test.ts` | Fails if UI text bypasses the string table |

## Tests

`src/components/__tests__/ui.smoke.test.tsx`, `screenLayout.test.ts`,
`iconography.test.ts`, `themedStatusBar.test.tsx`,
`src/theme/__tests__/contrast.test.ts`, `src/state/__tests__/*.test.ts`,
`src/app/__tests__/noEntrySpeech.test.ts` (the app never speaks unprompted
on entry).
