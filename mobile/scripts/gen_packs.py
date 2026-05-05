"""Generate placeholder Pokemon-TCG-Pocket-style pack art PNGs for recallSmith.

Renders 400x580 portrait packs with:
  - vertical gradient background per palette
  - radial halo glow
  - decorative ray streaks
  - concentric "blob" art evoking abstract creature silhouette
  - top brand band ("Pokémon TRADING CARD GAME / Pocket"-like, but generic)
  - bottom title slab with pack name
  - rounded corners + soft inner border

Saves to mobile/assets/packs/{slug}.png
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os
import sys

OUT = "/sessions/compassionate-kind-babbage/mnt/DeveloperCards/recallSmith/mobile/assets/packs"
W, H = 400, 580
RADIUS = 36

# Per-pack palette (mirrors theme/packArt.ts roughly)
PALETTES = {
    "csharp": {
        # purple "code/genes" feel
        "stops": [(92, 61, 160), (122, 77, 196), (167, 127, 224), (60, 35, 110)],
        "halo": (200, 165, 255),
        "ray": (255, 232, 200, 90),
        "blobs": [(180, 140, 240), (110, 70, 200), (220, 200, 255)],
        "title": "C# Interview",
        "subtitle": "MASTER CLASS",
        "code": "A1",
        "code_bg": (28, 18, 56),
        "code_fg": (255, 233, 199),
        "title_ink": (255, 255, 255),
    },
    "aws": {
        # orange/red "wave/cloud" feel
        "stops": [(209, 75, 42), (233, 106, 54), (242, 166, 90), (180, 50, 24)],
        "halo": (255, 200, 130),
        "ray": (255, 255, 220, 110),
        "blobs": [(255, 200, 120), (200, 60, 30), (255, 255, 240)],
        "title": "AWS Core",
        "subtitle": "CLOUD SAGA",
        "code": "B3",
        "code_bg": (40, 17, 10),
        "code_fg": (255, 233, 199),
        "title_ink": (255, 255, 255),
    },
    "premium-deck": {
        # pastel rainbow "premium"
        "stops": [(248, 201, 221), (199, 230, 245), (215, 197, 240), (251, 217, 196)],
        "halo": (255, 255, 240),
        "ray": (255, 255, 255, 120),
        "blobs": [(255, 220, 255), (180, 220, 255), (255, 230, 200)],
        "title": "Premium",
        "subtitle": "ELITE COLLECTION",
        "code": "B2b",
        "code_bg": (255, 255, 255),
        "code_fg": (60, 35, 30),
        "title_ink": (60, 35, 30),
    },
    "default": {
        # gold legendary fallback
        "stops": [(193, 139, 43), (232, 184, 90), (245, 218, 138), (140, 90, 16)],
        "halo": (255, 230, 160),
        "ray": (255, 245, 200, 120),
        "blobs": [(255, 220, 130), (180, 120, 30), (255, 250, 220)],
        "title": "Wild Pack",
        "subtitle": "TRAINER SERIES",
        "code": "A2",
        "code_bg": (58, 35, 5),
        "code_fg": (255, 233, 199),
        "title_ink": (60, 35, 5),
    },
}

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vertical_gradient(stops, w, h):
    """4-stop vertical gradient."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    n = len(stops) - 1
    for y in range(h):
        f = y / (h - 1)
        seg = min(int(f * n), n - 1)
        local_t = (f * n) - seg
        col = lerp(stops[seg], stops[seg + 1], local_t)
        for x in range(w):
            px[x, y] = col
    return img

def rounded_mask(w, h, r):
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=r, fill=255)
    return mask

def soft_radial(w, h, color_rgba, cx, cy, radius):
    """Soft radial glow, returned as RGBA."""
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 24
    for i in range(steps, 0, -1):
        r = int(radius * (i / steps))
        a = int(color_rgba[3] * ((i / steps) ** 1.4) * 0.18)
        d.ellipse(
            (cx - r, cy - r, cx + r, cy + r),
            fill=color_rgba[:3] + (a,),
        )
    return layer.filter(ImageFilter.GaussianBlur(8))

def ray_layer(w, h, cx, cy, color_rgba, n=12, length=320, width=58):
    """Rotating-spoke ray pattern."""
    layer = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    Cx, Cy = cx + w // 2, cy + h // 2
    for i in range(n):
        angle = (i / n) * 2 * math.pi
        # draw as polygon (triangle wedge from center)
        x1 = Cx + math.cos(angle - 0.04) * length
        y1 = Cy + math.sin(angle - 0.04) * length
        x2 = Cx + math.cos(angle + 0.04) * length
        y2 = Cy + math.sin(angle + 0.04) * length
        x3 = Cx + math.cos(angle) * (length * 1.1)
        y3 = Cy + math.sin(angle) * (length * 1.1)
        d.polygon(
            [(Cx, Cy), (x1, y1), (x3, y3), (x2, y2)],
            fill=color_rgba,
        )
    layer = layer.filter(ImageFilter.GaussianBlur(2))
    return layer.crop((w // 2, h // 2, w // 2 + w, h // 2 + h))

def draw_blob(img, color, cx, cy, r, alpha=200):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(6))
    img.alpha_composite(layer)

def make_pack(slug, p):
    # 1) base gradient
    base = vertical_gradient(p["stops"], W, H).convert("RGBA")

    # 2) soft halo behind the art
    halo = soft_radial(W, H, p["halo"] + (255,), W // 2, int(H * 0.42), 280)
    base.alpha_composite(halo)

    # 3) ray streaks
    rays = ray_layer(W, H, W // 2, int(H * 0.42), p["ray"], n=14, length=360)
    base.alpha_composite(rays)

    # 4) abstract blob "creature art" — three overlapping circles
    cx, cy = W // 2, int(H * 0.42)
    draw_blob(base, p["blobs"][0], cx - 60, cy - 30, 110, alpha=220)
    draw_blob(base, p["blobs"][1], cx + 50, cy + 20, 130, alpha=210)
    draw_blob(base, p["blobs"][2], cx, cy - 70, 80, alpha=190)
    # crescent highlight on the top blob
    hl = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(hl)
    d.ellipse((cx - 40, cy - 110, cx + 30, cy - 50), fill=(255, 255, 255, 80))
    hl = hl.filter(ImageFilter.GaussianBlur(8))
    base.alpha_composite(hl)

    # 5) top brand band ("Pokémon-ish")
    d = ImageDraw.Draw(base)
    band_h = 70
    d.rectangle((20, 14, W - 20, 14 + band_h), fill=(255, 255, 255, 220))
    d.rounded_rectangle(
        (20, 14, W - 20, 14 + band_h),
        radius=12,
        fill=None,
        outline=(0, 0, 0, 0),
    )
    # Use default font (Pillow's bundled font is small) — draw bigger by multiline trick:
    # Instead we'll draw simple shapes for the wordmark since the bundled font is tiny.
    # Bigger "RECALL" wordmark using rectangles as a faux pixel font.
    draw_wordmark(d, "RECALL", 36, 28, color=(40, 30, 24), size=4)
    draw_wordmark(d, "TRADING  CARD  GAME", 36, 50, color=(80, 60, 40), size=2)
    draw_wordmark(d, "Pocket", 36, 64, color=(20, 90, 170), size=3)

    # 6) Pack code badge top-right
    code = p["code"]
    bw = 18 + len(code) * 14
    bx2 = W - 30
    bx1 = bx2 - bw
    by1 = 26
    by2 = by1 + 30
    d.rounded_rectangle((bx1, by1, bx2, by2), radius=8, fill=p["code_bg"])
    draw_wordmark(d, code, bx1 + 8, by1 + 9, color=p["code_fg"], size=3)

    # 7) Title slab at bottom
    slab_y1 = H - 130
    slab_y2 = H - 70
    slab = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(slab)
    sd.rounded_rectangle(
        (40, slab_y1, W - 40, slab_y2), radius=12, fill=(0, 0, 0, 130)
    )
    base.alpha_composite(slab)
    title_ink = p["title_ink"]
    # Center title
    title_text = p["title"].upper()
    title_size = 5
    title_w = wordmark_width(title_text, title_size)
    draw_wordmark(d, title_text, (W - title_w) // 2, slab_y1 + 14, color=title_ink, size=title_size)
    sub = p["subtitle"]
    sub_w = wordmark_width(sub, 2)
    draw_wordmark(d, sub, (W - sub_w) // 2, slab_y1 + 38, color=title_ink, size=2)

    # 8) inner border highlight
    border = Image.new("RGBA", base.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    bd.rounded_rectangle((6, 6, W - 7, H - 7), radius=RADIUS - 4, outline=(255, 255, 255, 130), width=3)
    base.alpha_composite(border)

    # 9) outer rounded mask + soft outline
    mask = rounded_mask(W, H, RADIUS)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)

    # 10) edge shadow
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shd = ImageDraw.Draw(sh)
    shd.rounded_rectangle((0, 0, W - 1, H - 1), radius=RADIUS, outline=(20, 10, 0, 90), width=6)
    sh = sh.filter(ImageFilter.GaussianBlur(2))
    out.alpha_composite(sh)

    return out


# ── Faux pixel-font wordmark (so we don't depend on system fonts) ─────────
# Each character is encoded as a 5-row, 4-column bitmap.
# Capital letters + digits + a few symbols. Lowercase mapped to caps.
GLYPHS = {
    "A": [
        " XX ",
        "X  X",
        "XXXX",
        "X  X",
        "X  X",
    ],
    "B": ["XXX ", "X  X", "XXX ", "X  X", "XXX "],
    "C": [" XXX", "X   ", "X   ", "X   ", " XXX"],
    "D": ["XXX ", "X  X", "X  X", "X  X", "XXX "],
    "E": ["XXXX", "X   ", "XXX ", "X   ", "XXXX"],
    "F": ["XXXX", "X   ", "XXX ", "X   ", "X   "],
    "G": [" XXX", "X   ", "X XX", "X  X", " XXX"],
    "H": ["X  X", "X  X", "XXXX", "X  X", "X  X"],
    "I": ["XXX ", " X  ", " X  ", " X  ", "XXX "],
    "J": ["  XX", "   X", "   X", "X  X", " XX "],
    "K": ["X  X", "X X ", "XX  ", "X X ", "X  X"],
    "L": ["X   ", "X   ", "X   ", "X   ", "XXXX"],
    "M": ["X  X", "XXXX", "XXXX", "X  X", "X  X"],
    "N": ["X  X", "XX X", "X XX", "X  X", "X  X"],
    "O": [" XX ", "X  X", "X  X", "X  X", " XX "],
    "P": ["XXX ", "X  X", "XXX ", "X   ", "X   "],
    "Q": [" XX ", "X  X", "X  X", "X XX", " XXX"],
    "R": ["XXX ", "X  X", "XXX ", "X X ", "X  X"],
    "S": [" XXX", "X   ", " XX ", "   X", "XXX "],
    "T": ["XXXX", " X  ", " X  ", " X  ", " X  "],
    "U": ["X  X", "X  X", "X  X", "X  X", " XX "],
    "V": ["X  X", "X  X", "X  X", " XX ", " XX "],
    "W": ["X  X", "X  X", "XXXX", "XXXX", "X  X"],
    "X": ["X  X", " XX ", " XX ", " XX ", "X  X"],
    "Y": ["X  X", "X  X", " XX ", " X  ", " X  "],
    "Z": ["XXXX", "  X ", " X  ", "X   ", "XXXX"],
    "0": [" XX ", "X  X", "X  X", "X  X", " XX "],
    "1": [" XX ", "  X ", "  X ", "  X ", " XXX"],
    "2": [" XX ", "X  X", "  X ", " X  ", "XXXX"],
    "3": ["XXX ", "   X", " XX ", "   X", "XXX "],
    "4": ["X  X", "X  X", "XXXX", "   X", "   X"],
    "5": ["XXXX", "X   ", "XXX ", "   X", "XXX "],
    "6": [" XX ", "X   ", "XXX ", "X  X", " XX "],
    "7": ["XXXX", "   X", "  X ", " X  ", " X  "],
    "8": [" XX ", "X  X", " XX ", "X  X", " XX "],
    "9": [" XX ", "X  X", " XXX", "   X", " XX "],
    "#": ["X X ", "XXXX", "X X ", "XXXX", "X X "],
    "+": ["    ", " X  ", "XXX ", " X  ", "    "],
    " ": ["    ", "    ", "    ", "    ", "    "],
    "-": ["    ", "    ", "XXXX", "    ", "    "],
    ".": ["    ", "    ", "    ", "    ", " X  "],
}

def draw_wordmark(d, text, x, y, color, size=3):
    """Draw text using faux pixel font. `size` is pixel block size."""
    cx = x
    for ch in text.upper():
        glyph = GLYPHS.get(ch, GLYPHS[" "])
        for ry, row in enumerate(glyph):
            for cxn, c in enumerate(row):
                if c == "X":
                    px = cx + cxn * size
                    py = y + ry * size
                    d.rectangle((px, py, px + size - 1, py + size - 1), fill=color)
        cx += 5 * size  # 4-wide + 1 spacing

def wordmark_width(text, size):
    return len(text) * 5 * size

def main():
    os.makedirs(OUT, exist_ok=True)
    for slug, p in PALETTES.items():
        img = make_pack(slug, p)
        path = os.path.join(OUT, f"{slug}.png")
        img.save(path)
        print(f"wrote {path}")

if __name__ == "__main__":
    main()
