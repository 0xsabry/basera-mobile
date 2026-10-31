#!/usr/bin/env python3
"""
BASERA brand-asset generator (see docs/BRANDING.md).

SOURCE OF TRUTH: the OFFICIAL logo supplied by the owner on
2026-10-31 — assets/brand/basera-logo-official.png (1254², deep-navy /
royal-blue rounded-square artwork: white eye+person symbol, gold
sound waves, "BASERA" wordmark, Arabic tagline). The artwork itself
is NEVER redrawn, regenerated or modified here; this script only
crops, scales and composites it into the platform surfaces:

  assets/icon.png                  classic icon, 1024², opaque —
                                   the full official artwork over the
                                   deep-navy field (its own rounded
                                   corners are transparent; the field
                                   fills them so the PNG carries no
                                   alpha, per the asset guard test)
  assets/adaptive-foreground.png   adaptive foreground, 1024², alpha —
                                   the SYMBOL ONLY (eye+person+waves),
                                   keyed off the artwork's own field so
                                   it floats on transparency with NO
                                   chip/tile shape of its own, centered
                                   inside the 66% adaptive safe zone so
                                   ANY launcher mask (circle, squircle,
                                   square, teardrop) frames it without
                                   clipping (v1.1.5; the v1.1.3 rounded
                                   "chip" collided with launcher masks)
  assets/brand/basera-symbol.png   the symbol crop itself (in-app
                                   tight-spot variant, e.g. auth header)
  android mipmap-*/ic_launcher_foreground.webp   108dp set
  android mipmap-*/ic_launcher.webp              48dp set
  android mipmap-*/ic_launcher_round.webp        48dp set, circle mask
  android drawable/splashscreen_black.xml        PLAIN SOLID BLACK —
                                   NO logo, by owner order 2026-10-31
                                   (the flashing logo splash looked bad).
                                   The legacy drawable-*/splashscreen_logo.png
                                   densities are NO LONGER generated and
                                   are NOT used by the splash; the files
                                   remain on disk only because the unused
                                   legacy drawable/ic_launcher_background.xml
                                   still references them (deleting them
                                   would fail aapt resource linking).

Adaptive background / field color: deep navy #061434 — sampled from
the logo's darkest field and the owner's brand spec.

This replaces the retired «ب» letterform generator (v1.1.2): the
in-app BrandMark glyph remains in the component library but no longer
serves launcher / splash / header duty.
"""
from PIL import Image, ImageDraw, ImageFilter
import os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OFFICIAL = os.path.join(ROOT, "assets", "brand", "basera-logo-official.png")
FIELD = (6, 20, 52, 255)  # #061434 deep navy

# Symbol crop in official-file coordinates. Measured from the file:
# white/gold symbol content spans x 146..1086, y 119..~677 (eye,
# person, waves, swooshes); the "BASERA" wordmark starts at y ~730,
# leaving a silent band at y 678..725 — the crop bottom (705) sits
# inside that band so no letter fragment enters the symbol assets.
SYMBOL_BOX = (100, 80, 1130, 705)

SS = 4  # supersample factor for masks


def load_official() -> Image.Image:
    return Image.open(OFFICIAL).convert("RGBA")


def classic(art: Image.Image, canvas: int) -> Image.Image:
    """Full official artwork over the deep-navy field, opaque RGB."""
    out = Image.new("RGBA", (canvas, canvas), FIELD)
    out.alpha_composite(art.resize((canvas, canvas), Image.LANCZOS))
    return out.convert("RGB")


def symbol_crop(art: Image.Image) -> Image.Image:
    return art.crop(SYMBOL_BOX)


def _field_like(r: int, g: int, b: int) -> bool:
    """Gate for the artwork's royal-blue field (measured from the file):
    blue-dominant with a green cap — the field's dark glow sits at
    G≤110 and its bright azure sheen (a background sweep outside the
    eye, e.g. (5, 150, 248)) reaches G≈170, while the bright-cyan
    swoosh core is (79, 229, 255) and the white/gold symbol parts are
    never blue-dominant (white-edge blends also fail r<=60), so the
    gate hugs the field and stops at every symbol edge."""
    return b >= g >= r and b - r >= 40 and g <= 170 and r <= 60


def keyed_symbol(art: Image.Image) -> Image.Image:
    """The symbol crop with the artwork's own field removed (alpha).

    Region growing from the crop borders through field-like pixels
    only: the fill flows AROUND the symbol (white eye outline, gold
    waves, cyan swoosh are never field-like, so it cannot cross into
    them) and the eye's dark interior — enclosed by the white outline —
    is preserved as artwork. Source-transparent pixels (the artwork's
    rounded corners) count as background by definition. A 1px alpha
    feather hides keying steps at icon sizes.
    """
    crop = symbol_crop(art)
    w, h = crop.size
    rgb = crop.convert("RGB")
    px = rgb.load()
    src_alpha = crop.split()[3]
    sa = src_alpha.load()

    gate = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            if sa[x, y] < 128 or _field_like(r, g, b):
                gate[row + x] = 1

    bg = bytearray(w * h)
    stack: list[int] = []
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if gate[i] and not bg[i]:
                bg[i] = 1
                stack.append(i)
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if gate[i] and not bg[i]:
                bg[i] = 1
                stack.append(i)
    while stack:
        i = stack.pop()
        x, y = i % w, i // w
        for j in (
            i - 1 if x > 0 else -1,
            i + 1 if x < w - 1 else -1,
            i - w if y > 0 else -1,
            i + w if y < h - 1 else -1,
        ):
            if j >= 0 and gate[j] and not bg[j]:
                bg[j] = 1
                stack.append(j)

    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            if bg[row + x]:
                ap[x, y] = 0
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.1))

    final = Image.new("L", (w, h))
    fp = final.load()
    kp = alpha.load()
    for y in range(h):
        for x in range(w):
            fp[x, y] = kp[x, y] * sa[x, y] // 255
    out = crop.copy()
    out.putalpha(final)
    return out


def adaptive_foreground(art: Image.Image, canvas: int) -> Image.Image:
    """SYMBOL ONLY on transparency, inside the 66% safe zone.

    No chip, no tile, no shape of its own: the launcher masks the
    foreground + #061434 background pair into its own circle /
    squircle / square / teardrop, and any shape baked into the
    foreground fights that mask. The keyed symbol is scaled to 53%
    canvas width: measured on the generated asset, its farthest
    opaque pixel sits at ≈ 0.307 × canvas from center — comfortably
    inside the 0.33 safe-circle radius (at 57% it grazed 0.330).
    docs/BRANDING.md records the mask-board verification (zero
    opaque pixels clipped by any standard mask).
    """
    sym = keyed_symbol(art)
    target_w = int(canvas * 0.53)
    target_h = round(sym.height * target_w / sym.width)
    sym = sym.resize((target_w, target_h), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(sym, ((canvas - target_w) // 2, (canvas - target_h) // 2))
    return out


SPLASH_BLACK_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Splash window background: PLAIN SOLID BLACK, no logo anywhere
     (owner order 2026-10-31 — the half-second flashing logo splash
     looked bad). The launch window shows only this color until the
     app's first frame is drawn. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#000000" />
</shape>
"""


def write_splash_black() -> None:
    """The splash is intentionally PURE BLACK with no logo (owner order
    2026-10-31) — this step exists so a regen can never resurrect the
    old logo splash. It writes only the black drawable; the splash
    theme (res/values/styles.xml) points at it."""
    relpath = "android/app/src/main/res/drawable/splashscreen_black.xml"
    p = os.path.join(ROOT, relpath)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(SPLASH_BLACK_XML)
    print("wrote", relpath, "(plain black splash, no logo)")


def circle_masked(img: Image.Image) -> Image.Image:
    s = img.size[0]
    mask = Image.new("L", (s * SS, s * SS), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([0, 0, s * SS, s * SS], fill=255)
    out = img.copy()
    out.putalpha(mask.resize((s, s), Image.LANCZOS))
    return out


def save(img: Image.Image, relpath: str):
    p = os.path.join(ROOT, relpath)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if relpath.endswith(".webp"):
        img.save(p, "WEBP", lossless=True)
    else:
        img.save(p, "PNG")
    print("wrote", relpath, img.size)


def main():
    art = load_official()
    save(classic(art, 1024), "assets/icon.png")
    save(adaptive_foreground(art, 1024), "assets/adaptive-foreground.png")
    save(symbol_crop(art), "assets/brand/basera-symbol.png")
    dens = [("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]
    for name, mult in dens:
        fg = int(108 * mult)
        base = int(48 * mult)
        save(adaptive_foreground(art, fg), f"android/app/src/main/res/mipmap-{name}/ic_launcher_foreground.webp")
        save(classic(art, base), f"android/app/src/main/res/mipmap-{name}/ic_launcher.webp")
        save(circle_masked(classic(art, base)), f"android/app/src/main/res/mipmap-{name}/ic_launcher_round.webp")
    write_splash_black()


if __name__ == "__main__":
    sys.exit(main())
