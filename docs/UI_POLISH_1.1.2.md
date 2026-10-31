# UI Polish 1.1.2 — bottom navigation, Home composition, consistency

Every change names the defect it fixes. No decorative changes.

## Bottom navigation

| Defect (as shipped in 1.1.1) | Fix |
| --- | --- |
| The Smart Assistant tab glyph was `◇` — a plain diamond that communicates nothing (owner: "generic symbols users cannot understand") | Glyph → `✦`, the contemporary smart-assistant spark. Other four kept: `⌂` home, `▤` history log, `♡` family/care, `⚙` settings — all five distinct (guard test extended: `◇` must not return) |
| Active vs inactive was hard to tell apart: in the light palette both tints were dark greens (inactive `#24382E` 12.50:1, active `#064D34` 9.91:1); only cue besides hue was weight | Inactive tint → NEUTRAL grey (light `#2E3336`, dark `#CDD2CE`); active stays brand green. **Plus a shape cue**: a 24×3.5dp indicator pill above the active glyph (unfocused tabs render it transparent — no layout shift). Weights stay 800/600. State is now carried by hue family + shape + weight |
| The mandated new label «المساعد الذكي» / "Smart Assistant" is wider than its tab at full label size → would wrap/clip | Labels live in a **fixed two-line zone** (bar height 78→88): the long label wraps at its word boundary inside the zone, short labels use line 1, glyph columns stay aligned, nothing shrinks or clips. (First attempt — one line + `adjustsFontSizeToFit` — was reverted after the web preview showed it ellipsizing the mandated label; that API is not honored by every renderer.) Verified in web previews at 390dp width, both languages, normal + 1.3 text scale |
| — | Contrast after (on `surface`, locked ≥ 9:1 in tests): light inactive **12.78** / active **9.91**; dark inactive **11.27** / active **10.11**; light HC 21.00 / 12.36; dark HC 19.44 / 15.19 (HC unchanged) |

Targets unchanged (≥58dp item, 78dp bar), labels always visible,
screen-reader labels unchanged, RTL order = declaration order reversed
by the RTL layout (verified in the AR web preview: الرئيسية rightmost).

No filled pill behind the active icon: the indicator bar gives the
same instant state read without a filled block, keeping the bar quiet
and consistent with the flat, border-led surface language.

## Home composition

Defect: Home read as one long vertical list of full-width rows
(owner's words), despite the polish pass — the four core features were
full-width list rows under the hero.

Fix: the four core features (Describe, Read, Saved places, Safety
alerts) now compose as a **balanced 2×2 grid** of the design system's
existing `FeatureTile` (grid layout) inside `FeatureGrid` — compact
cards, glyph on top, title + one-line subtitle, ≥48dp targets (tiles
are 118dp+). Same destinations, same order, same labels and hints.
The Assistance hub mirrors the identical grid (it previously repeated
the same list rows — leaving it would have kept the defect alive one
tab away). Everything else on Home is untouched: brand header,
greeting, voice hero («المساعد الذكي» is named in the tagline under
the brand), compact glasses strip, family strip with the real sharing
state, conditional alert banner, last-result section.

## Design-consistency defects found & fixed (all screens swept)

1. **SOS button text was 2.28:1 in dark theme.** `AccessibleButton`'s
   danger variant hard-coded white text on `colors.danger`; in the
   dark palettes danger is a light salmon (`#FF8A80` → 2.28:1, dark-HC
   `#FF6D60` → 2.76:1). New `dangerText` token (light `#FFFFFF` on
   `#B3261E` = 6.54:1; dark `#2B0703` on `#FF8A80` = 8.11:1; dark-HC
   inherits = 6.24:1), pair locked ≥ 4.5:1 in `contrast.test.ts`.
2. **Detection overlay label below the type floor.** `detect.tsx`
   box label was `fontSize: 14` — smaller than every text token
   (caption floor is 16) on the app's most-read overlay. → 16.
3. **Literal radius off-token.** Family QR frame used `borderRadius:
   16` literal → `radius.card` (same value, token discipline). The new
   tab indicator uses `radius.pill` instead of a literal.
4. Left alone, deliberately: QR code black/white and its white frame
   background (functional — QR decoders need the contrast), the map
   marker's white border (map convention), the detection box's 4dp
   corner (a measurement-frame annotation, squarer on purpose).

Reduced motion: all press feedback already routes through
`settings.reducedMotion` (tiles/buttons render opacity 1); the new
indicator is static (no animation anywhere in the bar). Themes: all
four palettes re-measured above. Enlarged text (scale 1.3) verified
in the web preview — grid tiles grow, tab labels shrink-to-fit,
nothing clips.
