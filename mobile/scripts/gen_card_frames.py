"""Rarity card frames + foil LUT for the Seam of Light ceremony stage.

Outputs (written to ../assets/ui relative to this file):
  frame-com.png  400x560 RGBA  common frame  (matte gold, no gloss)
  frame-rar.png  400x560 RGBA  rare frame    (violet foil, gloss + grain)
  frame-leg.png  400x560 RGBA  legendary     (gold foil, gloss + grain)
  foil-lut.png   256x4   RGB   hue-sweep lookup table (never quantised)

Alpha contract of the three frames (probed by the verify with Pillow):
  * alpha 0 inside CARD_FRAME_ART_WINDOW (x 28..372, y 64..360)
  * alpha 0 inside the question slab           (x 28..372, y 384..536)
  * alpha >= 250 in the opaque frame band (the 24 px inside the outline)
  * alpha 0 outside the rounded corners, e.g. probe (2, 2)
Grain and gloss touch RGB only, never alpha. The art window and slab are
cut back to alpha 0 as the LAST drawing step so nothing can leak in.

Frames stay RGBA (a palette would resample alpha) and are kept under the
200 KB budget by walking the grain amplitude down until a save fits;
foil-lut.png is saved from an 'RGB'-mode image and is never quantised.
Pure Python 3.8 + Pillow, cwd-independent and deterministic (seeded grain),
so a re-run never dirties the tree. No external tools.
"""
from io import BytesIO
from pathlib import Path
import colorsys
import random

from PIL import Image, ImageDraw

W, H = 400, 560
RADIUS = 28                     # outer rounded corners
BAND = 24                       # opaque frame band
ART_WINDOW = (28, 64, 372, 360)  # x0, y0, x1, y1 — transparent
SLAB = (28, 384, 372, 536)      # question slab — transparent
SEED = 1606
MAX_BYTES = 200000

RARITY = {
    'com': {'base': (201, 165, 108), 'light': (236, 214, 176), 'dark': (140, 108, 62), 'gloss': False},  # colors.rarityCommon #C9A56C, matte
    'rar': {'base': (167, 139, 216), 'light': (214, 199, 240), 'dark': (96, 72, 150), 'gloss': True},    # colors.rarityRare #A78BD8, violet foil
    'leg': {'base': (245, 201, 94), 'light': (255, 236, 176), 'dark': (160, 116, 24), 'gloss': True},    # colors.rarityLegendary #F5C95E, gold foil
}

OUT = Path(__file__).resolve().parents[1] / 'assets' / 'ui'


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def blend(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def vgrad(stops, w, h):
    img = Image.new('RGB', (w, h))
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


def build_frame(spec, amp):
    base = spec['base']
    light = spec['light']
    dark = spec['dark']

    # Rounded card body: vertical light -> base -> dark ramp masked to the outline.
    grad = vgrad([light, base, dark], W, H)
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, H - 1), radius=RADIUS, fill=255)
    img = grad.convert('RGBA')
    img.putalpha(mask)

    d = ImageDraw.Draw(img)
    ax0, ay0, ax1, ay1 = ART_WINDOW
    # Bevel (2 px dark) + highlight (1 px light) strictly outside the art window.
    d.rectangle((ax0 - 2, ay0 - 2, ax1 + 1, ay1 + 1), outline=dark + (255,), width=2)
    d.rectangle((ax0 - 3, ay0 - 3, ax1 + 2, ay1 + 2), outline=light + (255,), width=1)
    # Title strip and the strip below the art window, flat base at full alpha.
    d.rectangle((BAND + 4, 24, W - BAND - 4, 60), fill=base + (255,))
    d.rectangle((BAND + 4, 360, W - BAND - 4, 384), fill=base + (255,))

    # Keep alpha exact: work RGB for gloss + grain, reattach the original alpha.
    alpha = img.getchannel('A')
    rgb = img.convert('RGB')

    if spec['gloss']:
        stripe = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(stripe).polygon(
            [(60, 0), (180, 0), (60, H), (-60, H)],
            fill=light + (90,),  # ~35 % blend into RGB
        )
        rgb = Image.alpha_composite(rgb.convert('RGBA'), stripe).convert('RGB')

    if amp:
        rng = random.Random(SEED)
        px = rgb.load()
        for y in range(H):
            for x in range(W):
                r, g, b = px[x, y]
                px[x, y] = (
                    min(255, max(0, r + rng.randint(-amp, amp))),
                    min(255, max(0, g + rng.randint(-amp, amp))),
                    min(255, max(0, b + rng.randint(-amp, amp))),
                )

    r, g, b = rgb.split()
    img = Image.merge('RGBA', (r, g, b, alpha))

    # LAST step: cut the art window and slab back to alpha 0 (replace, not composite).
    cut = ImageDraw.Draw(img)
    cut.rounded_rectangle(ART_WINDOW, radius=12, fill=(0, 0, 0, 0))
    cut.rounded_rectangle(SLAB, radius=12, fill=(0, 0, 0, 0))
    return img


def save_frame(name, spec):
    amps = [3, 2, 0] if not spec['gloss'] else [6, 4, 2, 0]
    for amp in amps:
        img = build_frame(spec, amp)
        buf = BytesIO()
        img.save(buf, 'PNG', optimize=True)
        if buf.tell() <= MAX_BYTES:
            path = OUT / name
            img.save(path, 'PNG', optimize=True)
            print('{}  {} bytes  (grain +/-{})'.format(path, path.stat().st_size, amp))
            return
    raise SystemExit('{}: exceeds {} bytes even at amp 0'.format(name, MAX_BYTES))


def save_lut():
    rar = RARITY['rar']['base']
    leg = RARITY['leg']['base']
    leg_light = RARITY['leg']['light']
    lut = Image.new('RGB', (256, 4))
    px = lut.load()
    for x in range(256):
        r, g, b = colorsys.hsv_to_rgb(x / 255.0, 0.55, 1.0)
        sweep = (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))
        px[x, 0] = sweep
        px[x, 1] = blend(sweep, rar, 0.4)
        px[x, 2] = blend(sweep, leg, 0.4)
        px[x, 3] = blend((255, 255, 255), leg_light, x / 255.0)
    path = OUT / 'foil-lut.png'
    lut.save(path, 'PNG', optimize=True)
    print('{}  {} bytes'.format(path, path.stat().st_size))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    save_frame('frame-com.png', RARITY['com'])
    save_frame('frame-rar.png', RARITY['rar'])
    save_frame('frame-leg.png', RARITY['leg'])
    save_lut()


if __name__ == '__main__':
    main()
