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
                                   a rounded "chip" crop of the SYMBOL
                                   portion of the artwork (eye+person
                                   +waves; measured bbox in the script),
                                   placed at 62% canvas width, centered,
                                   so the symbol sits inside the 66%
                                   adaptive safe zone under any mask
  assets/brand/basera-symbol.png   the symbol crop itself (in-app
                                   tight-spot variant, e.g. auth header)
  android mipmap-*/ic_launcher_foreground.webp   108dp set
  android mipmap-*/ic_launcher.webp              48dp set
  android mipmap-*/ic_launcher_round.webp        48dp set, circle mask
  android drawable-*/splashscreen_logo.png       full official artwork
                                   centered on transparency; the splash
                                   window background is the deep navy
                                   #061434 (res/values/colors.xml)

Adaptive background / field color: deep navy #061434 — sampled from
the logo's darkest field and the owner's brand spec.

This replaces the retired «ب» letterform generator (v1.1.2): the
in-app BrandMark glyph remains in the component library but no longer
serves launcher / splash / header duty.
"""
from PIL import Image, ImageDraw
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


def rounded_chip(img: Image.Image, radius_frac: float = 0.16) -> Image.Image:
    """Apply a rounded-rectangle alpha to the symbol crop so it reads
    as a deliberate artwork tile on the adaptive navy field."""
    w, h = img.size
    mask = Image.new("L", (w * SS, h * SS), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, w * SS, h * SS], radius=int(h * SS * radius_frac), fill=255)
    out = img.copy()
    out.putalpha(mask.resize((w, h), Image.LANCZOS))
    return out


def adaptive_foreground(art: Image.Image, canvas: int) -> Image.Image:
    """Symbol chip centered on transparency, inside the safe zone.

    Chip width = 62% of canvas; the symbol's own widest row (the eye)
    then spans ~57% — inside the central 66% circle — and the chip is
    vertically centered so mask cropping touches only its navy
    corners, never the symbol.
    """
    chip = rounded_chip(symbol_crop(art))
    target_w = int(canvas * 0.62)
    target_h = round(chip.height * target_w / chip.width)
    chip = chip.resize((target_w, target_h), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(chip, ((canvas - target_w) // 2, (canvas - target_h) // 2))
    return out


def splash_logo(art: Image.Image, canvas: int) -> Image.Image:
    """Full official artwork centered on transparency (72% width);
    the splash window supplies the deep-navy background."""
    target = int(canvas * 0.72)
    tile = art.resize((target, target), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(tile, ((canvas - target) // 2, (canvas - target) // 2))
    return out


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
        splash = int(288 * mult)
        save(splash_logo(art, splash), f"android/app/src/main/res/drawable-{name}/splashscreen_logo.png")


if __name__ == "__main__":
    sys.exit(main())
