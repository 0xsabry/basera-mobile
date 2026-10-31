# BASERA Brand Color Alignment — v1.1.3

**Scope (owner order, strict): colors and tokens ONLY.** No layout,
component structure, copy, glyph, typography, spacing, or logic
changed. The only non-color changes in this release are the two
owner-ordered presentation swaps shipped alongside: the official
logo integration (docs/BRANDING.md) and the bottom-tab container
shape (WS2 below).

## Source of truth

The official logo (owner-supplied 2026-10-31): deep midnight navy,
royal blue, bright clean blue, warm gold, white. Owner spec anchors:
primary navy `#071B49` · deep navy `#061434` · royal `#1559C9` ·
bright `#1685F8` · soft `#EAF3FF` · gold `#F2B632` · white ·
light bg `#F5F8FD` · text `#14213D` · secondary `#64748B`.

All four palettes (`src/theme/tokens.ts`) were rebuilt on this
identity. The old olive-green / mint system is gone (sweep evidence
at the bottom).

## Token mapping — light

| token | old (1.1.2) | new (1.1.3) |
|---|---|---|
| background | #F5F7F6 | **#F5F8FD** (spec) |
| surface | #FFFFFF | #FFFFFF |
| surfaceAlt | #E8EFEB | #E3EEFD |
| text | #0B1F18 | **#14213D** (spec) |
| textSecondary | #3D5A4F | #51637C (adjusted, see A2) |
| primary | #0A6B4C | **#1559C9** (spec royal) |
| primaryText | #FFFFFF | #FFFFFF |
| tabActive | #064D34 | #0A2F73 |
| tabInactive | #2E3336 | #323C48 |
| tabActiveContainer | — (new token) | #EAF3FF (spec soft) |
| accent | #7C4D00 | #7A5800 (adjusted, see A1) |
| danger | #B3261E | #B3261E |
| dangerText | #FFFFFF | #FFFFFF |
| success | #14632C | #137547 (semantic family, see S) |
| warning | #7C4D00 | #9A4A00 (see A3) |
| info | #0B5394 | #1559C9 |
| border | #5A7264 | #71809A |
| overlayBox | #0A6B4C | #1559C9 |
| primarySoft | #DCEBE2 | #EAF3FF (spec soft) |
| onPrimarySoft | #0A4A34 | #0A3A8C |
| dangerSoft | #F9DEDC | #F9DEDC |
| onDangerSoft | #7A1A14 | #7A1A14 |
| successSoft | #D8EDDD | #D9EBDF (semantic family) |
| onSuccessSoft | #0B4A20 | #0B4A26 (semantic family) |
| warningSoft | #F5E7C8 | #FBEEDB |
| onWarningSoft | #5C3A00 | #7A3E00 |
| infoSoft | #D9E8F7 | #DCE9FD |
| onInfoSoft | #083E6E | #0B3D91 |
| heroBackground | #0A6B4C | **#071B49** (spec primary navy) |
| heroText | #FFFFFF | #FFFFFF |
| heroTextSecondary | #DCEBE2 | #B9D2F5 |
| shadow | rgba(9,30,22,0.14) | rgba(7,27,73,0.16) |

## Token mapping — dark

Dark surfaces are now deep-navy (was black-green).

| token | old | new |
|---|---|---|
| background | #0A100D | **#061434** (spec deep navy) |
| surface | #131D17 | #0A1F44 |
| surfaceAlt | #1D2A22 | #12295A |
| text | #F2F7F4 | #F2F7FF |
| textSecondary | #B4CCBE | #A9BBD6 |
| primary | #2FBF8F | #4E9DF0 (bright-blue family) |
| primaryText | #03130B | #041633 |
| tabActive | #4ADEA6 | #BAD4FF |
| tabInactive | #CDD2CE | #D3DCE8 |
| tabActiveContainer | — | #122954 |
| accent | #FFC44D | **#F2B632** (spec gold, raw — passes on navy) |
| danger | #FF8A80 | #FF8A80 |
| dangerText | #2B0703 | #2B0703 |
| success | #4CC38A | #40C48E (semantic family) |
| warning | #FFC44D | #FF9E57 (see A3) |
| info | #6CB2F5 | #6FA8FF |
| border | #4A6A58 | #3A5A8C |
| overlayBox | #2FBF8F | **#1685F8** (spec bright) |
| primarySoft | #173528 | #12294F |
| onPrimarySoft | #7FE3BC | #A9CCFF |
| dangerSoft | #3D1A16 | #3D1A16 |
| onDangerSoft | #FFB4A8 | #FFB4A8 |
| successSoft | #14301F | #0E2E22 (semantic family) |
| onSuccessSoft | #8FE8B0 | #7FE0A8 (semantic family) |
| warningSoft | #38300F | #38260E |
| onWarningSoft | #FFD968 | #FFC98A |
| infoSoft | #12293D | #10294D |
| onInfoSoft | #8FC6F8 | #9CC2FF |
| heroBackground | #2FBF8F | #1559C9 (spec royal) |
| heroText | #03130B | #FFFFFF |
| heroTextSecondary | #052E1D | #D6E6FD |
| shadow | rgba(0,0,0,0.5) | rgba(0,0,0,0.5) |

## Token mapping — light high-contrast (overrides)

| token | old | new |
|---|---|---|
| primary | #004D33 | #0A3A8C |
| tabActive | #003D29 | #08306B |
| tabInactive | #000000 | #000000 |
| tabActiveContainer | — | #EAF3FF (inherited) |
| success | #00511F | #00511F (semantic family, kept) |
| warning | #5C3A00 | #7A3400 |
| info | #003B73 | #06377A |
| danger | #8F130C | #8F130C |
| accent | #5C3A00 | #5C3F00 |
| onPrimarySoft | #004D33 | #0A3A8C |
| onSuccessSoft | #00511F | #00511F (kept) |
| onWarningSoft | #5C3A00 | #7A3400 |
| onInfoSoft | #003B73 | #06377A |
| heroBackground | #004D33 | #071B49 |
| heroTextSecondary | #DCEBE2 | #D6E6FD |
| text / textSecondary / border / softs | unchanged pattern (black on white) | same |

## Token mapping — dark high-contrast (overrides)

| token | old | new |
|---|---|---|
| surface | #0D0D0D | #0A1428 |
| surfaceAlt | #1A1A1A | #14213D (spec text navy) |
| primary | #4DFFC3 | #7FB8FF |
| primaryText | #00150C | #04122B |
| tabActive | #4DFFC3 | #A9D1FF |
| tabActiveContainer | — | #0E2148 |
| success | #00FF9D | #00FF9D (semantic family, kept) |
| warning | #FFE14D | #FFB26B (see A3) |
| info | #66CCFF | #7FC4FF |
| danger | #FF6D60 | #FF6D60 |
| accent | #FFE14D | #FFE14D |
| overlayBox | #2FBF8F (inherited) | #7FC4FF |
| softs | #0D0D0D | #0A1428 |
| onPrimarySoft | #4DFFC3 | #8FC2FF |
| onDangerSoft | #FF6D60 | #FF8A75 |
| onSuccessSoft | #00FF9D | #00FF9D (kept) |
| onWarningSoft | #FFE14D | #FFB26B |
| onInfoSoft | #66CCFF | #7FC4FF |
| heroBackground | #4DFFC3 | #7FB8FF |
| heroText | #00150C | #04122B |
| heroTextSecondary | #052E1D | #0A2E6E |

(background #000000, text/textSecondary/border #FFFFFF unchanged.)

## Accessibility adjustments (owner-authorized, with measured ratios)

All ratios computed with the suite's own WCAG helper
(`src/theme/__tests__/contrast.test.ts`); every locked pair passes.

- **A1 — light `accent`: spec gold #F2B632 → #7A5800.** The accent
  token is used as text/icon color and is locked ≥ 4.5:1 on
  background and surface. Raw #F2B632 measures **1.82:1** on white —
  unusable as text. #7A5800 (darkened bronze-gold, same hue family)
  measures **6.51:1** on surface / 6.12:1 on background. The dark
  palettes carry the raw spec gold (#F2B632 = 8.91:1 on the dark
  surface; HC #FFE14D = 14.10:1) because navy surfaces support it.
- **A2 — light `textSecondary`: spec #64748B → #51637C.** #64748B
  measures **4.06:1** on the `surfaceAlt` tint (a locked pair) —
  below AA. #51637C measures **5.23:1** on surfaceAlt, 6.0+ on
  surface and background.
- **A3 — `warning` ≠ brand gold.** Warning moved to the orange
  family (light #9A4A00, dark #FF9E57, lightHC #7A3400, darkHC
  #FFB26B) so a warning can never be mistaken for the gold accent
  (light accent #7A5800 bronze vs warning #9A4A00 orange — distinct
  hue + lightness; dark accent is yellow-gold #F2B632 vs warning
  orange #FF9E57). In the old palette warning and accent were the
  SAME value in three of four palettes — a real ambiguity, now fixed.
- **A4 — dark `primary` #4E9DF0 with `primaryText` #041633.** White
  text on bright blues in this family measures ~3.6:1 (fails);
  the bright-family primary therefore takes dark navy text
  (**6.34:1**), the same pattern the old mint primary used.
- **Tab locks (≥ 9:1), measured after alignment** —
  tabInactive / tabActive on `surface`, tabActive on
  `tabActiveContainer`:
  light 11.20 / 12.60 / 11.25 · dark 11.74 / 10.79 / 9.48 ·
  lightHC 21.00 / 12.76 / 11.40 · darkHC 18.36 / 11.59 / 9.96.

## (S) Semantic families — deliberate exceptions

- **danger** stays the red family (values unchanged) — red must
  read as danger, not brand.
- **success** stays a GREEN family, deliberately: success must read
  as success. Its values were harmonized/desaturated toward the
  blue brand (light #137547, dark #40C48E, softs #D9EBDF / #0E2E22,
  on-colors #0B4A26 / #7FE0A8; HC values #00511F / #00FF9D kept).
  These are the ONLY green-family values left in `src/` (plus two
  old hexes quoted inside a historical comment in
  `contrast.test.ts`, documenting the v1.1.2 before-state).

## WS2 — tab container (owner-ordered presentation change)

The v1.1.2 indicator pill is folded into ONE shape cue: a fixed
48×36 rounded-square (radius 12) container behind each tab glyph —
active filled with `tabActiveContainer`, inactive transparent.
One cue, no layout shift (identical box in both states), same five
destinations/glyphs/labels/order, same bar geometry. Glyph-on-
container is locked ≥ 9:1 (table above). Justification: two stacked
cues (pill + tint) read as noise at 24dp; the container is the
shape language the rest of the app already uses (cards, tiles).

## Also aligned (colors only)

- `app.json`: adaptiveIcon background + expo-notifications color
  `#0B3D2E` → `#061434`.
- `android/.../values/colors.xml`: `iconBackground`,
  `notification_icon_color`, `splashscreen_background` → `#061434`
  (splash background was #FFFFFF).
- Guardian PWA: theme-color + manifest `theme_color` /
  `background_color` → `#061434`; header navy, royal accent
  `#1559c9`, ink `#14213d`, page bg `#f5f8fd`, slate borders and
  freshness-state colors aligned to the app tokens (fresh = royal,
  stale family = warning orange, no-signal/paused = `textSecondary`
  slate; danger red unchanged). PWA icons were NOT regenerated
  (outside the ordered scope).

## Zero-green sweep — evidence

Command (run at the WS3 commit): grep of all 28 old-identity hex
values + a green-dominance scan (g > r+12 and g > b+8) over
`src/`, `guardian-pwa/`, `app.json`,
`android/app/src/main/res/values/`.

Remaining green-family values in `src/`, ALL deliberate:
`#137547 #0B4A26 #D9EBDF #40C48E #0E2E22 #7FE0A8 #00511F #00FF9D`
(semantic-success family, see S) — and `#064D34` / `#24382E`
appearing ONLY inside the historical comment at
`src/theme/__tests__/contrast.test.ts:118` (the documented
v1.1.2 before-state). No other old-identity hex remains anywhere
in app source, PWA, app.json, or android values.

## Changed test assertions (enumerated)

1. `contrast.test.ts` — added pair `tabActive/tabActiveContainer`
   to the AA text pairs and a dedicated ≥ 9:1 tab test for it
   (+8 tests); historical ratio comments extended with the v1.1.3
   measured table. No existing assertion weakened or removed.
2. `iconography.test.ts` — `adaptiveIcon.backgroundColor`
   expectation `#0B3D2E` → `#061434` (the brand background value
   itself changed; the assertion's intent is unchanged).
3. Palette-dependent snapshot/value assertions elsewhere: none
   existed — all other suites consume tokens symbolically.
