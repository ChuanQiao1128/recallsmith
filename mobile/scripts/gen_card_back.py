"""Per-deck card backs for the gacha tap-to-flip phase.

Outputs (written to ../assets/packs relative to this file):
  ai-back.png  cloud-back.png  aws-back.png  premium-deck-back.png  default-back.png
  each 400x560, fully opaque, <= 200 KB.

Never touches csharp-back.png (shipped separately) or any pack cover.

Each back is a vertical 4-stop gradient of the deck's `cover` ramp, a filigree
ring of 3 concentric ellipses with 24 tick marks, a monogram, a 12-px inner
border, and seeded film grain. Composited onto an opaque image, then reduced
to a 256-colour palette with Pillow's FASTOCTREE (no external tool) so every
file lands under the 200 KB budget.

The palette table below is copied from mobile/src/theme/packArt.ts:23-82
(the five `cover` ramps + CANONICAL_PALETTE_INDEX). Pure Python 3.8 + Pillow,
cwd-independent and deterministic (seeded grain), so a re-run never dirties
the tree.
"""
from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFont

W, H = 400, 560
MAX_BYTES = 200000
SEED = 1606
OUT = Path(__file__).resolve().parents[1] / 'assets' / 'packs'

# From packArt.ts PALETTES[].cover, ring, titleInk (index order 0..4).
PALETTES = [
    # 0 — purple "最強的基因"
    {'cover': ['#5C3DA0', '#7A4DC4', '#A77FE0', '#5C3DA0'], 'ring': (255, 255, 255), 'title_ink': (255, 255, 255)},
    # 1 — orange "波導奏動"
    {'cover': ['#D14B2A', '#E96A36', '#F2A65A', '#B33718'], 'ring': (255, 236, 196), 'title_ink': (255, 255, 255)},
    # 2 — pastel rainbow "超級異彩"
    {'cover': ['#F8C9DD', '#C7E6F5', '#D7C5F0', '#FBD9C4'], 'ring': (255, 255, 255), 'title_ink': (58, 44, 31)},
    # 3 — mint/teal
    {'cover': ['#2E8C7C', '#3FB29B', '#A8E2D3', '#1F5F55'], 'ring': (255, 255, 255), 'title_ink': (255, 255, 255)},
    # 4 — gold/legendary
    {'cover': ['#C18B2B', '#E8B85A', '#F5DA8A', '#8E5E10'], 'ring': (255, 255, 255), 'title_ink': (58, 35, 5)},
]

# From packArt.ts CANONICAL_PALETTE_INDEX; monogram per packArt.ts:165 ('R' back).
DECKS = [
    ('ai', 3, 'AI'),
    ('cloud', 2, 'C'),
    ('aws', 1, 'AWS'),
    ('premium-deck', 4, 'P'),
    ('default', 0, 'R'),
]


def hex_rgb(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def vgrad(stops):
    img = Image.new('RGB', (W, H))
    px = img.load()
    n = len(stops) - 1
    for y in range(H):
        f = y / (H - 1)
        seg = min(int(f * n), n - 1)
        local = (f * n) - seg
        col = lerp(stops[seg], stops[seg + 1], local)
        for x in range(W):
            px[x, y] = col
    return img


def make_back(pal, monogram):
    stops = [hex_rgb(c) for c in pal['cover']]
    base = vgrad(stops).convert('RGBA')

    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    ring = pal['ring']
    ring_a = ring + (140,)  # ~0.55 alpha
    cx, cy = 200, 280
    for i, (rad, wdt) in enumerate([(150, 3), (132, 2), (116, 1)]):
        d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), outline=ring_a, width=wdt)
    # 24 tick marks around the outer ring.
    from math import cos, sin, pi
    r_in, r_out = 154, 168
    for i in range(24):
        ang = i * (2 * pi / 24)
        d.line(
            (cx + r_in * cos(ang), cy + r_in * sin(ang), cx + r_out * cos(ang), cy + r_out * sin(ang)),
            fill=ring_a, width=2,
        )

    # Monogram — sized default font (Pillow >= 10.1), disc fallback otherwise.
    ink = pal['title_ink']
    try:
        font = ImageFont.load_default(size=140)
        bbox = d.textbbox((0, 0), monogram, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), monogram, font=font, fill=ink + (255,))
    except Exception:
        d.ellipse((cx - 70, cy - 70, cx + 70, cy + 70), fill=ink + (255,))

    # 12-px inner border in titleInk at ~0.35 alpha.
    d.rectangle((16, 16, W - 17, H - 17), outline=ink + (89,), width=12)

    img = Image.alpha_composite(base, overlay).convert('RGB')

    # Seeded film grain +/- 4 on RGB.
    rng = random.Random(SEED)
    px = img.load()
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            px[x, y] = (
                min(255, max(0, r + rng.randint(-4, 4))),
                min(255, max(0, g + rng.randint(-4, 4))),
                min(255, max(0, b + rng.randint(-4, 4))),
            )

    return img.quantize(colors=256, method=Image.Quantize.FASTOCTREE)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ok = True
    for slug, idx, monogram in DECKS:
        img = make_back(PALETTES[idx], monogram)
        path = OUT / '{}-back.png'.format(slug)
        img.save(path, 'PNG', optimize=True)
        size = path.stat().st_size
        print('{}  {} bytes'.format(path, size))
        if size > MAX_BYTES:
            ok = False
    if not ok:
        raise SystemExit('a card back exceeds {} bytes'.format(MAX_BYTES))


if __name__ == '__main__':
    main()
