# BASERA v1.1.4 — Olive Identity, Home Recomposition, One-Line Navigation

Owner sprint (2026-10-31): the v1.1.3 navy/royal identity was
rejected. This document records the replacement identity, every
measured accessibility adjustment, the zero-blue sweep, the Home
recomposition, and the single-line tab-label derivation.

**Untouched by design:** the official logo artwork and every asset
derived from it (launcher icon, adaptive foreground, splash, header
lockup — all from a96636d, byte-identical); guardian / Supabase /
auth logic; feature destinations; native code (android/ diff for
this release is `build.gradle` version fields only).

## 1. Identity — owner anchors

Deep olive `#26372D` · primary olive `#657A4D` · soft olive
`#788A5B` · light sage `#C7D5B8` · warm ivory `#F5F3EA` · white ·
text `#263229` · secondary `#687267`. Gold appears only via the
`accent` token (bronze in light palettes — raw `#F2B632` is ~1.9:1
as text — raw gold in dark palettes), exactly as in 1.1.3's
discipline. Semantic families stay recognizable: danger reds
unchanged; success a harmonized green; warning amber, distinct
from the gold accent; **info left blue behind** — it is now a deep
sage-olive (light) / light sage (dark), the only on-identity
informational tone.

## 2. Token maps (old 1.1.3 → new 1.1.4)

### Light
| token | 1.1.3 | 1.1.4 |
|---|---|---|
| background | #F5F8FD | **#F5F3EA** (owner ivory) |
| surface | #FFFFFF | #FFFFFF |
| surfaceAlt | #E3EEFD | #E6EAD9 |
| text | #14213D | **#263229** (owner) |
| textSecondary | #51637C | #5C665C (adj. A1) |
| primary | #1559C9 | **#657A4D** (owner; white on it = 4.73:1 ✓) |
| primaryText | #FFFFFF | #FFFFFF |
| tabActive | #0A2F73 | **#26372D** (owner deep olive) |
| tabInactive | #323C48 | #3D443C |
| tabActiveContainer | #EAF3FF | #E9EFE0 |
| accent | #7A5800 | #7A5800 (bronze-gold, unchanged) |
| danger / dangerText | #B3261E / #FFFFFF | unchanged |
| success | #137547 | #1E6B34 |
| warning | #9A4A00 | #9A4A00 (unchanged) |
| info | #1559C9 | #3D5C43 |
| border | #71809A | #7E8A76 |
| overlayBox | #1559C9 | #657A4D |
| primarySoft / on | #EAF3FF / #0A3A8C | #E9EFE0 / #2E4429 |
| dangerSoft / on | #F9DEDC / #7A1A14 | unchanged |
| successSoft / on | #D9EBDF / #0B4A26 | #DFEDD8 / #174D24 |
| warningSoft / on | #FBEEDB / #7A3E00 | unchanged |
| infoSoft / on | #DCE9FD / #0B3D91 | #E6EAD9 / #2C4430 |
| heroBackground | #071B49 | **#26372D** (owner deep olive) |
| heroText | #FFFFFF | #FFFFFF |
| heroTextSecondary | #B9D2F5 | **#C7D5B8** (owner light sage) |
| shadow | rgba(7,27,73,.16) | rgba(38,55,45,.16) |

### Dark
| token | 1.1.3 | 1.1.4 |
|---|---|---|
| background | #061434 | #131A15 |
| surface | #0A1F44 | #1D2820 |
| surfaceAlt | #12295A | #28362B |
| text | #F2F7FF | #F1F2E7 |
| textSecondary | #A9BBD6 | #ACBAA2 |
| primary | #4E9DF0 | #9DB47E |
| primaryText | #041633 | #17220F |
| tabActive | #BAD4FF | #D8E4CB (adj. A2) |
| tabInactive | #D3DCE8 | #D3DCC6 |
| tabActiveContainer | #122954 | **#26372D** (owner deep olive) |
| accent | #F2B632 | #F2B632 (owner gold, unchanged) |
| danger / dangerText | #FF8A80 / #2B0703 | unchanged |
| success | #40C48E | #4CC47E |
| warning | #FF9E57 | unchanged |
| info | #6FA8FF | #A9C29B |
| border | #3A5A8C | #4A5A46 |
| overlayBox | #1685F8 | #B7CBA3 |
| primarySoft / on | #12294F / #A9CCFF | #22301F / #C4D8AB |
| successSoft / on | #0E2E22 / #7FE0A8 | #142A1A / #8FE0A8 |
| infoSoft / on | #10294D / #9CC2FF | #1E2E22 / #BCDBAC |
| heroBackground | #1559C9 | #2E4034 |
| heroTextSecondary | #D6E6FD | **#C7D5B8** (owner light sage) |
| (danger/warning soft pairs unchanged) | | |

### High-contrast variants
Re-based on the same identity: light HC keeps the white-soft
pattern with deep-olive text colors (primary #3E5228, tabActive
#1E2E20, container #DCE5CF, hero #26372D); dark HC uses near-black
olive surfaces (#0C120D on #000000) with pale sage primaries
(#B9D69A / #D6E5C3) and the hero inverted to pale sage with deep
olive text. Full values in `src/theme/tokens.ts`.

## 3. Accessibility adjustments (measured with the suite's own math)

- **A1 — light textSecondary:** owner `#687267` measures 5.01:1 on
  white and 4.51:1 on ivory but **4.09:1 on surfaceAlt** (a locked
  pair) → darkened one step to **#5C665C** (5.38 ivory / 4.88
  surfaceAlt). Same grey-olive family.
- **A2 — dark tabActive:** owner sage `#C7D5B8` on the deep-olive
  container `#26372D` measures **8.18:1** — under the ≥9:1 tab
  floor. Lightened one step to **#D8E4CB** → **9.53:1** on the
  container, 11.54:1 on surface. The ≥9:1 tab lock is KEPT at full
  strength; no floor exception was needed.
- Owner primary `#657A4D` needed **no** adjustment: white on it is
  4.73:1. Owner soft olive `#788A5B` carries no text (3.76:1 with
  white) — it appears only in non-text roles (its derivatives
  drive soft tints / overlay).

**Locked tab ratios (v1.1.4, all ≥ 9):** light inactive 10.05 ·
active 12.60 · container 10.73 — dark inactive 10.77 · active
11.54 · container 9.53 — light HC 21.00 / 14.32 / 11.01 — dark HC
18.95 / 14.31 / 10.15. Every AA text pair (≥ 4.5:1) passes in all
four palettes (contrast suite: 136/136).

## 4. Zero-blue sweep (evidence)

Method (same as the 1.1.3 green sweep): grep for all 28 old-
identity hex values + a blue-dominance review over `src/`,
`guardian-pwa/`, `app.json`, android `values/`.

- `src/`: **zero** old blue/navy hexes remain. The only hex
  literals left in screens/components are functional and
  color-neutral: QR code black/white (`QrCodeView` — scannability)
  and the white map-marker border (`LocationMapPreview` — drawn
  over third-party map tiles). Neither is an identity color.
- `guardian-pwa/`: theme/background/accent/freshness colors
  aligned to olive (manifest `theme_color`/`background_color`
  #26372D; `--bg` #26372D, `--ink` #263229, `--accent` #657A4D,
  page bg #F5F3EA). Colors only; PWA icons unchanged (they carry
  the previous mark — same flag as 1.1.3; outside this sprint's
  scope since the launcher assets were frozen by the owner).
- `app.json` + android `colors.xml`: the `#061434` values there
  describe the **frozen native icon/splash presentation** (the
  logo's own navy field behind the symbol chip). The owner froze
  logo-derived assets for this sprint and limited android/ changes
  to `build.gradle`; these values are part of that presentation,
  not the app theme. Flagged here explicitly rather than silently
  left.

## 5. Home recomposition (before → after)

Before (1.1.3): header (40dp logo; greeting with md top margin) →
hero 80dp → 2×2 grid (tiles 118dp, 2-line subtitles) → glasses
strip 64dp → family strip 64dp → [alert banner] → «آخر نتيجة»
section header (24px) + quiet group. No SOS on Home.

After (1.1.4): tighter screen padding/gaps (md/sm) → compact
header (36dp logo, greeting margin sm) → hero 68dp → grid (tiles
102dp, subtitles clamped to ONE line; full text remains in the
a11y hint) → **SOS strip** (danger soft fill + border, triggers
the identical `triggerSos` flow as Assistance/Alerts, outcome as
assertive live text) → glasses strip compact (48dp) → ONE section
«الموقع والأماكن» whose status line is the compact family strip
(real sharing state pill) → alert banner when present → last
result block (caption label + summary + Repeat). Every datum and
destination from the old screen is preserved; TalkBack order =
visual order; all targets ≥ 48dp.

**Measured height (web preview, AR dark, empty states):** full
content height **865px vs the 844 viewport = 1.02×** at 390×844,
and **890 vs 740 = 1.20×** at 360×740 — at or under the ≈1.2
target on both sizes (measured as the ScrollView's scrollHeight
in the preview DOM).

## 6. Bottom navigation — single-line derivation

The two-line zone (bar 88dp) is reverted; the bar is 70dp. Label
size is derived, not fixed. Two measured facts drive it:

1. Advance ratios of the longest labels: «المساعد الذكي» ≈ **7.2
   px per 1px font size** (DOM-measured at weights 600 AND 800 —
   Arabic advances barely change with weight here), "Smart
   Assistant" ≈ **8.05** at weight 800 (canvas) / 7.65 at 600
   (DOM). Working ratios carry a margin: **AR 7.4, EN 8.2**.
2. The label box is NOT the tab width: the vendored bottom-tabs
   library hardcodes `padding: 5` on the item button, and
   `tabBarItemStyle` styles only the wrapper — it cannot override
   that padding (confirmed in the library source and the preview
   DOM: the label's clientWidth was 62 inside a 72px tab). The
   derivation therefore uses `tabWidth − 12` (10 padding + 2
   safety). An earlier revision of this sprint assumed the
   padding away and the preview caught the overflow (scrollWidth
   68 > clientWidth 62) — exactly why the proof below is DOM
   measurement, not arithmetic.

`size = clamp(7, floor((tabWidth − 12) / ratio × 2) / 2, 13)`
from `useWindowDimensions`: at 360dp → AR 8.0 / EN 7.0; at 390dp
→ AR 8.5 / EN 8.0. `adjustsFontSizeToFit` + `minimumFontScale
0.8` remain as the on-device net (Android's Roboto/Noto advances
are narrower than the preview stack's, so the preview is the
binding case).

**Proof (preview DOM, final build):** every tab label measures
`scrollWidth == clientWidth` (fits, shrink-wrapped) — AR 390:
«المساعد الذكي» 61/61 · AR 360: 58/58 · AR 360 on the Assistance
tab (active, weight 800): 61/61 · EN 360: "Smart Assistant"
53/53; all other labels fit with room. The 360dp crops
(`tabbar-v6-*.png`) show complete single-line labels, no
ellipsis. Bar labels do not follow the app text scale (fixed bar
geometry; TalkBack reads the full label) — the same cap the
previous design applied.

## 7. Per-screen consistency findings (§5 sweep)

All 13 screens compose from the token-driven primitives, so the
identity flows through automatically. Concrete findings:

- **Home / Assistance:** recomposed / tile-subtitle clamp applies
  to both grids (shared `FeatureTile`); hero compacted (shared
  `HeroAction`, Assistance benefits identically).
- **Detect:** overlay label sits on `overlayBox` (now primary
  olive); the 16px label floor from 1.1.2 unchanged.
- **Family:** QR frame + pairing-code digits (40px, whitelisted
  functional literal) inherit surface/border tokens; QR black/
  white is functional, unchanged.
- **Places:** map marker white border is functional over map
  tiles, unchanged; everything else token-driven.
- **Voice:** the 32dp control-disc glyph (whitelisted cap) takes
  `primary`/`heroText` tokens — now olive.
- **Settings / History / Alerts / Read / Updates / Onboarding /
  Guardian-auth:** no hardcoded identity colors found; headers,
  pills, segmented controls and banners all resolve through
  tokens and were re-rendered in the new identity for the preview
  set (Settings + Family + Assistance + History inspected).
- No off-scale padding literals exist in `src/app` (grep-verified).

## 8. Release

gradle `versionName "1.1.4"` / `versionCode 6` (verified 1.1.3/5
before bumping — gradle is authoritative), app.json synced,
`runtimeVersion` stays `"1.1.0"` (JS + tokens only; the OTA fleet
on runtime 1.1.0 can receive this bundle; the APK carries it
natively). Release-notes entry added (runtime 1.1.0).
