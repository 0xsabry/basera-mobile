#!/usr/bin/env python3
"""
BASERA brand-icon generator (see docs/BRANDING.md).

Renders the product's established brand mark — the «ب» letterform with
its accent dot, exactly as composed by the in-app BrandMark component
(src/components/ui.tsx) — into every launcher / splash surface:

  assets/icon.png                  classic icon, 1024², opaque
  assets/adaptive-foreground.png   adaptive foreground, 1024², alpha
  android mipmap-*/ic_launcher_foreground.webp   108dp set
  android mipmap-*/ic_launcher.webp              48dp set
  android mipmap-*/ic_launcher_round.webp        48dp set, circle mask
  android drawable-*/splashscreen_logo.png       tile mark on alpha

Colors are the shipped brand colors, sampled from the previous icon:
  field / adaptive background  #0B3D2E  (app.json adaptiveIcon, colors.xml)
  letter                       #FFFFFF  (primaryText on the brand field)
  accent dot                   #2FBF8F  (brand mint — the old icon's iris)

The «ب» is set in Noto Sans Arabic Bold — the same family/weight the
in-app BrandMark renders in on Android (system Arabic font, weight 700).
Rendered at 4x and downscaled for clean edges. No new brand identity:
this is the existing mark, reproduced at launcher sizes.
"""
from PIL import Image, ImageDraw, ImageFont
import os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FIELD = (11, 61, 46, 255)        # #0B3D2E
LETTER = (255, 255, 255, 255)    # #FFFFFF
DOT = (47, 191, 143, 255)        # #2FBF8F
FONT_PATH = "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf"
LETTER_CHAR = "\u0628"           # ب

SS = 4  # supersample factor


def letter_layer(canvas: int) -> Image.Image:
    """The «ب» + accent dot on transparency, mark inside the safe zone.

    Adaptive-icon safe zone: key art within the central 66% circle.
    The letterform spans ~46% of the canvas width; letter + dot span
    ~24%..78% vertically.
    """
    big = canvas * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Fit the letterform to the target width by measuring its bbox.
    target_w = 0.46 * big
    size = int(big * 0.9)
    while size > 10:
        f = ImageFont.truetype(FONT_PATH, size)
        box = d.textbbox((0, 0), LETTER_CHAR, font=f)
        if (box[2] - box[0]) <= target_w:
            break
        size = int(size * 0.92)
    f = ImageFont.truetype(FONT_PATH, size)
    box = d.textbbox((0, 0), LETTER_CHAR, font=f)
    lw, lh = box[2] - box[0], box[3] - box[1]
    # Letter center at 45% of canvas height (dot lives below it).
    cx, cy = big / 2, big * 0.45
    d.text((cx - box[0] - lw / 2, cy - box[1] - lh / 2), LETTER_CHAR, font=f, fill=LETTER)
    # Accent dot — the BrandMark's "eye", below the letterform.
    r = 0.045 * big
    dot_cy = big * 0.715
    d.ellipse([cx - r, dot_cy - r, cx + r, dot_cy + r], fill=DOT)
    return img.resize((canvas, canvas), Image.LANCZOS)


def classic(canvas: int) -> Image.Image:
    out = Image.new("RGBA", (canvas, canvas), FIELD)
    out.alpha_composite(letter_layer(canvas))
    # Fully opaque by construction — store as RGB so the file itself
    # carries no alpha channel (guarded in iconography.test.ts).
    return out.convert("RGB")


def tile_logo(canvas: int) -> Image.Image:
    """Splash logo: the BrandMark as a rounded tile on transparency."""
    big = canvas * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = big * 0.19
    d.rounded_rectangle([inset, inset, big - inset, big - inset],
                        radius=(big - 2 * inset) * 0.30, fill=FIELD)
    mark = letter_layer(canvas)
    img.alpha_composite(mark.resize((big, big), Image.LANCZOS))
    return img.resize((canvas, canvas), Image.LANCZOS)


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
    save(classic(1024), "assets/icon.png")
    save(letter_layer(1024), "assets/adaptive-foreground.png")
    dens = [("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]
    for name, mult in dens:
        fg = int(108 * mult)
        base = int(48 * mult)
        save(letter_layer(fg), f"android/app/src/main/res/mipmap-{name}/ic_launcher_foreground.webp")
        save(classic(base), f"android/app/src/main/res/mipmap-{name}/ic_launcher.webp")
        save(circle_masked(classic(base)), f"android/app/src/main/res/mipmap-{name}/ic_launcher_round.webp")
        splash = int(288 * mult)
        save(tile_logo(splash), f"android/app/src/main/res/drawable-{name}/splashscreen_logo.png")


if __name__ == "__main__":
    sys.exit(main())
