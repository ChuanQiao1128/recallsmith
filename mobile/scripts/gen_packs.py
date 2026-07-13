"""Pack-cover PNGs v3 — kill the symmetric medallion, use painterly silhouettes.

Goals over v2:
  - NO centered geometric medallion (looked like Behance design exercise)
  - NO 14 hard light-rays (overwrought)
  - Asymmetric "creature" silhouette via overlapping blurred shapes
  - Cleaner brand band (drop "TRADING CARD GAME" subhead — too verbose)
  - Title slab unchanged but tighter
  - Subtle vignette + grain for premium feel
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math
import os
import random

OUT = "/sessions/compassionate-kind-babbage/mnt/DeveloperCards/recallSmith/mobile/assets/packs"
W, H = 400, 580
RADIUS = 38

FONT_BRAND = "/usr/share/fonts/truetype/lato/Lato-Heavy.ttf"
FONT_TITLE = "/usr/share/fonts/truetype/lato/Lato-Black.ttf"
FONT_BADGE = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
FONT_SUB = "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf"

PALETTES = {
    "csharp": {
        # Deep purple cosmic — C# / .NET
        "stops": [(58, 32, 122), (108, 67, 184), (180, 145, 232), (40, 18, 90)],
        "creature_main": (235, 200, 255, 230),
        "creature_shadow": (50, 22, 110, 200),
        "creature_glow": (255, 245, 200, 80),
        "title": "C#",
        "code": "C#",
        "code_bg": (30, 18, 70),
        "code_fg": (255, 233, 199),
        "title_ink": (255, 255, 255),
        "brand_ink": (40, 22, 90),
    },
    "ai": {
        # Cybernetic green-teal — AI / ML
        "stops": [(8, 70, 56), (24, 142, 110), (130, 230, 200), (4, 40, 32)],
        "creature_main": (190, 255, 230, 230),
        "creature_shadow": (4, 40, 32, 200),
        "creature_glow": (220, 255, 240, 100),
        "title": "AI",
        "code": "AI",
        "code_bg": (4, 30, 24),
        "code_fg": (190, 255, 230),
        "title_ink": (255, 255, 255),
        "brand_ink": (8, 50, 40),
    },
    "cloud": {
        # Sky blue with sunrise warm — Cloud / DevOps
        "stops": [(20, 90, 170), (80, 165, 230), (240, 200, 130), (12, 60, 130)],
        "creature_main": (255, 245, 220, 230),
        "creature_shadow": (10, 40, 90, 200),
        "creature_glow": (255, 230, 180, 100),
        "title": "Cloud",
        "code": "CLD",
        "code_bg": (10, 40, 90),
        "code_fg": (255, 245, 220),
        "title_ink": (255, 255, 255),
        "brand_ink": (12, 50, 110),
    },
    # Legacy entries kept so the old PNGs still regenerate if needed
    "aws": {
        "stops": [(160, 35, 12), (210, 70, 28), (245, 165, 70), (110, 22, 5)],
        "creature_main": (255, 230, 180, 230),
        "creature_shadow": (95, 20, 5, 200),
        "creature_glow": (255, 220, 150, 90),
        "title": "AWS Core",
        "code": "B3",
        "code_bg": (40, 14, 6),
        "code_fg": (255, 233, 199),
        "title_ink": (255, 255, 255),
        "brand_ink": (90, 25, 8),
    },
    "premium-deck": {
        "stops": [(245, 195, 220), (185, 220, 250), (210, 192, 240), (250, 215, 195)],
        "creature_main": (255, 255, 255, 220),
        "creature_shadow": (130, 95, 175, 130),
        "creature_glow": (220, 230, 255, 90),
        "title": "Premium",
        "code": "B2b",
        "code_bg": (255, 255, 255),
        "code_fg": (60, 35, 30),
        "title_ink": (60, 35, 30),
        "brand_ink": (60, 35, 30),
    },
    "default": {
        "stops": [(132, 84, 14), (188, 132, 38), (240, 210, 130), (78, 46, 6)],
        "creature_main": (255, 240, 200, 230),
        "creature_shadow": (78, 46, 6, 200),
        "creature_glow": (255, 220, 130, 100),
        "title": "Wild Pack",
        "code": "A2",
        "code_bg": (50, 28, 4),
        "code_fg": (255, 233, 199),
        "title_ink": (60, 35, 5),
        "brand_ink": (50, 28, 4),
    },
}

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vertical_gradient(stops, w, h):
    img = Image.new("RGB", (w, h))
    px = img.load()
    n = len(stops) - 1
    for y in range(h):
        f = y / (h - 1)
        seg = min(int(f * n), n - 1)
        local = (f * n) - seg
        col = lerp(stops[seg], stops[seg + 1], local)
        for x in range(w):
            px[x, y] = col
    return img

def rounded_mask(w, h, r):
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=r, fill=255)
    return mask

def soft_radial(w, h, color_rgba, cx, cy, radius, blur=14):
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 28
    for i in range(steps, 0, -1):
        r = int(radius * (i / steps))
        a = int(color_rgba[3] * ((i / steps) ** 1.6) * 0.16)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color_rgba[:3] + (a,))
    return layer.filter(ImageFilter.GaussianBlur(blur))

def painterly_blob(w, h, color_rgba, cx, cy, base_radius, n_lobes=7, seed=1):
    """Asymmetric organic blob built from N overlapping ellipses with jitter."""
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rng = random.Random(seed)
    for i in range(n_lobes):
        angle = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(0, base_radius * 0.45)
        r = base_radius * rng.uniform(0.55, 0.85)
        ex = cx + math.cos(angle) * dist
        ey = cy + math.sin(angle) * dist
        d.ellipse((ex - r, ey - r, ex + r, ey + r), fill=color_rgba)
    return layer.filter(ImageFilter.GaussianBlur(18))

def draw_creature_silhouette(base, palette, cx, cy):
    """Layered painterly silhouette evoking a creature. NOT centered, NOT geometric."""
    w, h = base.size

    # Shadow (back layer, slight offset for "ground" feel)
    shadow = painterly_blob(w, h, palette["creature_shadow"], cx + 14, cy + 22, 130, n_lobes=6, seed=2)
    base.alpha_composite(shadow)

    # Main body — biggest, painterly
    body = painterly_blob(w, h, palette["creature_main"], cx, cy, 115, n_lobes=8, seed=3)
    base.alpha_composite(body)

    # Highlights — small bright lobes, off-center upper-left (simulates light)
    hi = Image.new("RGBA", base.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    bright = (255, 255, 255, 160)
    hd.ellipse((cx - 60, cy - 70, cx - 20, cy - 30), fill=bright)
    hd.ellipse((cx - 30, cy - 50, cx - 10, cy - 30), fill=(255, 255, 255, 200))
    hi = hi.filter(ImageFilter.GaussianBlur(12))
    base.alpha_composite(hi)

    # Inner glow halo
    glow = soft_radial(w, h, palette["creature_glow"][:3] + (255,), cx, cy, 180, blur=22)
    base.alpha_composite(glow)


def draw_vignette(base):
    """Subtle dark corners for premium feel."""
    w, h = base.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(40):
        a = int(45 * (i / 40) ** 2)
        d.rectangle((i, i, w - 1 - i, h - 1 - i), outline=(0, 0, 0, a), width=1)
    return Image.alpha_composite(base, layer.filter(ImageFilter.GaussianBlur(2)))


def film_grain(w, h, intensity=4):
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = layer.load()
    rng = random.Random(7)
    for y in range(h):
        for x in range(w):
            v = rng.randint(-intensity, intensity)
            if v > 0:
                px[x, y] = (255, 255, 255, max(0, v) * 2)
            else:
                px[x, y] = (0, 0, 0, max(0, -v) * 2)
    return layer


def text_centered(d, x_center, y, text, font, fill, kerning=0):
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    if kerning > 0:
        cx = x_center - (tw + kerning * (len(text) - 1)) // 2
        for ch in text:
            d.text((cx, y - bbox[1]), ch, font=font, fill=fill)
            cx += d.textbbox((0, 0), ch, font=font)[2] + kerning
    else:
        d.text((x_center - tw // 2, y - bbox[1]), text, font=font, fill=fill)


def text_left(d, x, y, text, font, fill, kerning=0):
    bbox = d.textbbox((0, 0), text, font=font)
    if kerning > 0:
        cx = x
        for ch in text:
            d.text((cx, y - bbox[1]), ch, font=font, fill=fill)
            cx += d.textbbox((0, 0), ch, font=font)[2] + kerning
    else:
        d.text((x, y - bbox[1]), text, font=font, fill=fill)


def make_pack(slug, p):
    base = vertical_gradient(p["stops"], W, H).convert("RGBA")

    # Asymmetric creature silhouette — composition center is slightly off
    cx = W // 2 - 14
    cy = int(H * 0.42)
    draw_creature_silhouette(base, p, cx, cy)

    d = ImageDraw.Draw(base)

    # Brand band — slim, no "TRADING CARD GAME" subhead this time
    f_brand = ImageFont.truetype(FONT_BRAND, 28)
    f_pocket = ImageFont.truetype(FONT_SUB, 14)
    f_badge = ImageFont.truetype(FONT_BADGE, 17)
    f_title = ImageFont.truetype(FONT_TITLE, 30)

    band_top = 26
    band_bot = 70
    d.rectangle((22, band_top, W - 22, band_bot), fill=(255, 255, 255, 235))
    # "Pocket" suffix removed (was a Pokemon TCG Pocket reference).
    # Now uses neutral "deck" descriptor in matching style.
    text_left(d, 38, band_top + 10, "RECALL", f_brand, p["brand_ink"])
    text_left(d, 38 + d.textbbox((0, 0), "RECALL", f_brand)[2] + 10, band_top + 18, "deck", f_pocket, (60, 110, 200))

    # Code badge
    code = p["code"]
    bbox = d.textbbox((0, 0), code, font=f_badge)
    cw = bbox[2] - bbox[0] + 22
    bx2 = W - 30
    bx1 = bx2 - cw
    by1 = 32
    by2 = by1 + 28
    d.rounded_rectangle((bx1, by1, bx2, by2), radius=8, fill=p["code_bg"])
    text_centered(d, (bx1 + bx2) // 2, by1 + 7, code, f_badge, p["code_fg"])

    # Bottom title slab
    slab_top = H - 130
    slab_bot = H - 60
    slab = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(slab)
    sd.rounded_rectangle((30, slab_top, W - 30, slab_bot), radius=14, fill=(0, 0, 0, 145))
    base.alpha_composite(slab)
    text_centered(d, W // 2, slab_top + 22, p["title"], f_title, p["title_ink"])

    # Inner border highlight
    border = Image.new("RGBA", base.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    bd.rounded_rectangle((6, 6, W - 7, H - 7), radius=RADIUS - 4, outline=(255, 255, 255, 110), width=2)
    base.alpha_composite(border)

    # Vignette + grain
    base = draw_vignette(base)
    base.alpha_composite(film_grain(W, H, intensity=3))

    # Outer rounded mask
    mask = rounded_mask(W, H, RADIUS)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)

    # Edge shadow
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shd = ImageDraw.Draw(sh)
    shd.rounded_rectangle((0, 0, W - 1, H - 1), radius=RADIUS, outline=(20, 10, 0, 90), width=6)
    sh = sh.filter(ImageFilter.GaussianBlur(2))
    out.alpha_composite(sh)

    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for slug, p in PALETTES.items():
        img = make_pack(slug, p)
        path = os.path.join(OUT, f"{slug}.png")
        img.save(path, optimize=True)
        print(f"  wrote {os.path.basename(path)}  {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
