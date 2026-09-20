"""Particle sprite sheet + glow 9-slice for the Seam of Light ceremony stage.

Outputs (written to ../assets/ui relative to this file):
  particles.png    256x64 RGBA  four 64x64 sprites at x = 0 / 64 / 128 / 192
                                 in order: dot, star, fleck, shard
  glow-9slice.png  96x96  RGBA  soft radial glow, 32 px 9-slice cap inset

Every sprite's RGB is pure white (255, 255, 255); only the alpha channel
carries the shape, so the ceremony Atlas `colors` array / RN `tintColor`
recolours each sprite freely.

  dot   : Gaussian falloff, alpha = 255*exp(-(r/14)^2), clipped at r <= 30
  star  : 4-point star (outer radius 28, inner 7), alpha 255, GaussianBlur(0.8)
  fleck : ellipse 34x12 rotated 28 deg, alpha 230, GaussianBlur(1.2)
  shard : thin triangle (apex up, base 10 px, height 40), alpha 220, GaussianBlur(0.8)
  glow  : alpha = 255*exp(-(r/30)^2) from centre (48, 48), centre 32x32 held
          near-flat (alpha >= 200) so stretching the 9-slice never bands, and
          the corners fall to alpha <= 8.

Purely analytic (Gaussian, polygon, ellipse, triangle, blur) — no random
source. Pure Python 3.8 + Pillow, cwd-independent and deterministic, so a
re-run never dirties the tree. No external tools.
"""
from math import cos, exp, hypot, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SPRITE = 64
GLOW = 96
CENTER_INSET = 32
OUT = Path(__file__).resolve().parents[1] / 'assets' / 'ui'


def alpha_from(size, fn):
    a = Image.new('L', (size, size), 0)
    px = a.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = max(0, min(255, int(round(fn(x, y)))))
    return a


def dot_alpha():
    c = SPRITE / 2.0
    def fn(x, y):
        r = hypot(x + 0.5 - c, y + 0.5 - c)
        if r > 30:
            return 0
        return 255 * exp(-(r / 14.0) ** 2)
    return alpha_from(SPRITE, fn)


def star_alpha():
    a = Image.new('L', (SPRITE, SPRITE), 0)
    cx = cy = SPRITE / 2.0
    pts = []
    for i in range(8):
        ang = -pi / 2 + i * pi / 4
        rad = 28 if i % 2 == 0 else 7
        pts.append((cx + rad * cos(ang), cy + rad * sin(ang)))
    ImageDraw.Draw(a).polygon(pts, fill=255)
    return a.filter(ImageFilter.GaussianBlur(0.8))


def fleck_alpha():
    a = Image.new('L', (SPRITE, SPRITE), 0)
    cx = cy = SPRITE / 2.0
    ImageDraw.Draw(a).ellipse((cx - 17, cy - 6, cx + 17, cy + 6), fill=230)
    a = a.rotate(28, resample=Image.BICUBIC)
    return a.filter(ImageFilter.GaussianBlur(1.2))


def shard_alpha():
    a = Image.new('L', (SPRITE, SPRITE), 0)
    cx = cy = SPRITE / 2.0
    ImageDraw.Draw(a).polygon(
        [(cx, cy - 20), (cx - 5, cy + 20), (cx + 5, cy + 20)], fill=220,
    )
    return a.filter(ImageFilter.GaussianBlur(0.8))


def glow_alpha():
    cx = cy = GLOW / 2.0
    lo, hi = CENTER_INSET, GLOW - CENTER_INSET  # centre 32x32 band [32, 64)
    def fn(x, y):
        r = hypot(x + 0.5 - cx, y + 0.5 - cy)
        v = 255 * exp(-(r / 30.0) ** 2)
        if lo <= x < hi and lo <= y < hi:
            v = max(v, 205)  # hold the 9-slice centre near-flat (>= 200)
        return v
    return alpha_from(GLOW, fn)


def white_rgba(alpha):
    w, h = alpha.size
    r = Image.new('L', (w, h), 255)
    return Image.merge('RGBA', (r, r, r, alpha))


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    sheet = Image.new('RGBA', (SPRITE * 4, SPRITE), (255, 255, 255, 0))
    for i, alpha in enumerate([dot_alpha(), star_alpha(), fleck_alpha(), shard_alpha()]):
        sheet.paste(white_rgba(alpha), (i * SPRITE, 0))
    sheet_path = OUT / 'particles.png'
    sheet.save(sheet_path, 'PNG', optimize=True)
    print('{}  {} bytes'.format(sheet_path, sheet_path.stat().st_size))

    glow = white_rgba(glow_alpha())
    glow_path = OUT / 'glow-9slice.png'
    glow.save(glow_path, 'PNG', optimize=True)
    print('{}  {} bytes'.format(glow_path, glow_path.stat().st_size))


if __name__ == '__main__':
    main()
