# BASERA Branding & Launcher Icon — audit and fix (v1.1.2)

## What was actually shipping before this pass

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

## Does an official BASERA logo asset exist?

**No.** The repository was searched (`assets/`, `docs/`, the full tree
for `*logo*` / `*brand*` files): the only brand artwork anywhere is the
eye `icon.png` above and the in-app «ب» `BrandMark`. No distinct
official logo file was ever delivered to the project.

## The fix — the established «ب» mark, reproduced faithfully

Per the owner's fallback instruction, the launcher set is the product's
established brand mark — the «ب» BrandMark — rendered properly:

- **Foreground** (`assets/adaptive-foreground.png`, 1024², transparent):
  the «ب» letterform in white (`#FFFFFF`) with its accent dot in brand
  mint (`#2FBF8F`, the old icon's iris color) below it, composed inside
  the adaptive safe zone (letterform ≈46% of canvas width; letter + dot
  span ≈24–76% vertically, inside the central 66% mask circle).
- **Background layer**: unchanged — `#0B3D2E`
  (`app.json adaptiveIcon.backgroundColor` + `@color/iconBackground`).
- **Classic icon** (`assets/icon.png`): the same mark composited on the
  `#0B3D2E` field.
- **Splash logo**: the BrandMark as a rounded `#0B3D2E` tile with the
  white «ب» + mint dot, on transparency, over the existing white
  splash background — replacing the Expo template placeholder.
- **In-app surfaces** (header `BrandMark`, onboarding) already render
  the same «ب» mark and were not changed; launcher and in-app identity
  now match.

The letter is set in **Noto Sans Arabic Bold** — the family/weight the
in-app mark renders in on Android (system Arabic font, weight 700).

## Regeneration

`scripts/generate-brand-icons.py` (Python + Pillow, supersampled ×4)
renders the whole set: `assets/icon.png`,
`assets/adaptive-foreground.png`, the five mipmap densities
(`ic_launcher`, `ic_launcher_round`, `ic_launcher_foreground` webp) and
the five splash-logo densities. Re-run it after any brand-color change;
do not hand-edit the density files.

## Notes / limits

- Launcher icons ship inside the APK; they **cannot** change via OTA.
  Existing installs keep the eye until they install the 1.1.2 APK.
- No monochrome (themed-icon) layer was added: the adaptive XML ships
  background + foreground only, as before.
