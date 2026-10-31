# BASERA Branding & Launcher Icon

## CURRENT STATE (v1.1.5) — the OFFICIAL logo is now the brand

On **2026-10-31 the owner supplied the official BASERA logo** (a
1254×1254 PNG: deep-navy/royal-blue rounded-square artwork — white
eye+person symbol with gold sound waves, the "BASERA" wordmark, and
the Arabic tagline «بصيرة.. نحو حياة أسهل»). This supersedes the
v1.1.2 audit below: the "no official asset exists" finding was true
until that delivery and is **no longer true**.

- **Preserved original**: `assets/brand/basera-logo-official.png` —
  a byte-identical copy of the delivered file (SHA-256
  `b44e8357332deaef671a3e8c7c2850c26e9862ff27f2cbc971769c373b3fe8e4`).
  The artwork is never redrawn, regenerated, or modified; derived
  assets are only crops/scales/composites of it.
- **Single source of truth**: that file. Every brand surface derives
  from it via `scripts/generate-brand-icons.py` (rewritten for it).
- **Classic icon** (`assets/icon.png`, 1024², opaque): the full
  official artwork over the deep-navy field `#061434` (the artwork's
  own corners are transparent; the field fills them).
- **Adaptive icon**: background `#061434` (app.json +
  `@color/iconBackground`); foreground
  (`assets/adaptive-foreground.png`, 1024², alpha) = **the SYMBOL
  ONLY** (eye + person + waves + swooshes), keyed off the artwork's
  own field — no chip, no tile, no shape of its own (v1.1.5; the
  v1.1.3 rounded "chip" fought the launchers' own masks: under a
  circular launcher the chip's corners were cropped, under a square
  one its rounded corners read as a picture-in-picture). The symbol
  crop was measured from the file: symbol content spans x 146..1086
  / y 119..~677 of 1254, the wordmark starts at y ~730, and the crop
  box `(100, 80) → (1130, 705)` bottoms out in the silent band
  between them so no letter fragment enters the symbol assets. The
  field is removed by border flood-fill through a measured
  blue-dominance gate (the bright-cyan swoosh core, G≈229, and the
  white/gold parts are never field-like, so the fill flows around
  the symbol and preserves the eye's enclosed dark interior as
  artwork); a 1px alpha feather hides keying steps. The keyed
  symbol is placed at 53% canvas width, centered: measured on the
  generated asset, its farthest opaque pixel sits at **0.305 ×
  canvas** from center — inside the 66% safe-zone circle (0.33)
  with margin. **Mask-board verification** (PIL composite of the
  shipped foreground over `#061434`, masks applied at full
  resolution, board rendered at 192/96/48 —
  `branding-v6-mask-board.png`): **circle, squircle,
  rounded-square 20%, square and teardrop each clip ZERO opaque
  foreground pixels**, and visually the symbol (waves included)
  sits complete inside every shape at every size. White/magenta
  halo checks on the same board show clean keyed edges.
- **Symbol asset** (`assets/brand/basera-symbol.png`): the same crop
  at native resolution, for in-app tight spots.
- **Splash**: the full official lockup centered on transparency
  (`drawable-*/splashscreen_logo.png`), over the deep-navy splash
  background `#061434` (`@color/splashscreen_background`).
- **In-app**: the Home header (`AppHeader`) and the onboarding hero
  show the official logo (`BrandLogo` in `src/components/ui.tsx`);
  the guardian-auth header (tight row) shows the symbol crop
  (`BrandSymbol`). The «ب» `BrandMark` component remains in the
  library for reference but is **retired** from launcher / splash /
  header duty — do not reintroduce it on prominent surfaces.
- **Brand colors**: the app's four palettes are aligned to this
  logo — see `docs/BRAND_COLORS_1.1.3.md`.

Regeneration: `python3 scripts/generate-brand-icons.py` re-derives
the whole set from the preserved official file. Do not hand-edit
the density files.

Notes / limits (unchanged from v1.1.2): launcher icons ship inside
the APK and cannot change via OTA; no monochrome (themed-icon)
layer exists (background + foreground only).

---

## HISTORICAL (v1.1.2 audit — superseded by the above)

### What was actually shipping before the v1.1.2 pass

Inspected first-hand at HEAD `6ff796b`:

- **`assets/icon.png`** (1024², opaque) — an **eye**: a white eye outline
  with a `#2FBF8F` iris disc, full-bleed on `#0B3D2E`. The same file was
  configured as the classic icon **and** as the adaptive-icon foreground
  (`app.json → android.adaptiveIcon.foregroundImage`). As a foreground it
  was wrong: fully opaque and edge-to-edge, so launcher masks (circle,
  squircle) cropped the eye, and there was no transparent safe-zone
  padding. It also did **not** match the in-app brand mark.
- **Android mipmaps** — generated from that eye (foreground webp =
  the eye at 432² etc.), same defects baked in.
- **Splash logo** (`drawable-*/splashscreen_logo.png`) — the **stock Expo
  template placeholder**: grey keyline circles and grid on white. Never
  replaced since scaffolding.
- **In-app mark** — the `BrandMark` component (`src/components/ui.tsx`):
  the Arabic letter **«ب»** on the brand-green tile with an accent dot
  below the letter — shipped since the V1.1 redesign.
- No Latin "B" and no "+" exists in any shipped asset. On the owner's
  device the cropped eye under a launcher mask reads as an abstract
  placeholder; whatever the exact perception, the set was inconsistent
  (eye outside / «ب» inside / template splash) and is now unified.

### Did an official BASERA logo asset exist at v1.1.2 time?

**No — at that time.** The repository was searched (`assets/`, `docs/`,
the full tree for `*logo*` / `*brand*` files): the only brand artwork
anywhere was the eye `icon.png` above and the in-app «ب» `BrandMark`.
No distinct official logo file had been delivered to the project.
The owner delivered the official logo on 2026-10-31 (see top of this
document); the v1.1.2 «ب» launcher set it replaced is retired.

### The v1.1.2 fix (retired in v1.1.3)

The launcher set was the product's established «ب» BrandMark rendered
as a proper adaptive set (white letterform + mint dot in the safe
zone on the `#0B3D2E` field, splash tile to match). It shipped in
1.1.2 and is fully replaced by the official-logo set above.
