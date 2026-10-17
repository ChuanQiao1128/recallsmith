"""Finish the Canva pack exports: crop, re-letter, card back, quantise.

Run from the scratch folder that holds the exports (file names in
assets/packs/README.md): `python3 <repo>/mobile/scripts/packart/finish_canva_covers.py
[slug ...]` (default: every pack). Each pack writes `<slug>.png` and
`<slug>-back.png`, ready to copy into mobile/assets/packs/.
"""
import sys

from PIL import Image, ImageDraw, ImageFilter
import letter

GOLD_TOP = (255, 224, 158)
GOLD_BOT = (208, 138, 52)

def patch_text(im, box, blur=14):
    """Remove gold lettering inside box by normalized-blur inpainting (pure PIL)."""
    x0, y0, x1, y1 = box
    reg = im.crop(box).convert('RGB')
    w, h = reg.size
    px = reg.load()
    mask = Image.new('L', (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r > 120 and g > 85 and r > b + 45 and g > b + 20:
                mp[x, y] = 255
    mask = mask.filter(ImageFilter.MaxFilter(7))
    keep = mask.point(lambda v: 255 - v)
    # normalized blur: blur(img*keep)/blur(keep)
    src = Image.new('RGB', (w, h), (0, 0, 0))
    src.paste(reg, (0, 0), keep)
    bs = src.filter(ImageFilter.GaussianBlur(blur))
    bk = keep.filter(ImageFilter.GaussianBlur(blur))
    bp, kp = bs.load(), bk.load()
    out = reg.copy()
    op = out.load()
    for y in range(h):
        for x in range(w):
            if mp[x, y]:
                k = kp[x, y] / 255.0
                if k < 0.02:
                    k = 0.02
                r, g, b = bp[x, y]
                op[x, y] = (min(255, int(r / k)), min(255, int(g / k)), min(255, int(b / k)))
    # soft-edge blend back
    soft = mask.filter(ImageFilter.GaussianBlur(2))
    im.paste(out, (x0, y0), soft)
    return im

def crop_to_2x3(im, bbox, margin_y=12):
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) / 2
    top = max(0, y0 - margin_y)
    bot = min(im.height, y1 + margin_y)
    h = bot - top
    w = int(round(h * 2 / 3))
    left = int(round(cx - w / 2))
    left = max(0, min(left, im.width - w))
    return im.crop((left, top, left + w, top + h)).resize((1024, 1536), Image.LANCZOS)

def gold(im, text, size, cx, cy, outline=(70, 38, 10), glow_alpha=170, glow_blur=9, gap=2):
    f = letter.font('Cochin.ttc', size, 1)
    im.alpha_composite(letter.gold_text_layer(im.size, text, f, cx, cy, GOLD_TOP, GOLD_BOT, outline,
                                              glow_alpha=glow_alpha, glow_blur=glow_blur, letter_gap=gap))
    return im

def run_claude():
    im = Image.open('claude-foil1-full.png').convert('RGBA')
    im = patch_text(im, (370, 1175, 660, 1285))
    im = gold(im, 'DeveloperCards', 72, 516, 282)
    im = gold(im, 'Claude', 138, 516, 1222, gap=3)
    bbox = (72, 38, 960, 1491)
    out = crop_to_2x3(im.convert('RGB'), bbox)
    out.save('claude-cover-rgb.png')
    return out

def run_aws():
    im = Image.open('aws-foil-full.png').convert('RGB')
    bbox = (118, 80, 919, 1457)
    out = crop_to_2x3(im, bbox)
    out.save('aws-cover-rgb.png')
    return out

def run_aws_basics():
    # 2026-10-18 AWS Basics cover. The export is Canva DAHYS0kAJGw, a copy of
    # DAHYS85MkV4 with its two text layers deleted, so both panels are plain
    # black and nothing needs inpainting. Coordinates are in export space:
    # the inner gold frame runs x 138-883 (centre 511), the top panel is clear
    # at y 244-350 and the bottom one at y 1150-1298, where the corner
    # filigree curls in to x 160 / 862 at y 1192. Lettering plus outline lands
    # at x 241-780, y 260-333 ('DeveloperCards') and x 196-819, y 1189-1272
    # ('AWS Basics'), about 30 px clear of the filigree, so keep 112 px.
    im = Image.open('aws-basics-foil-full.png').convert('RGBA')
    im = gold(im, 'DeveloperCards', 72, 511, 296)
    im = gold(im, 'AWS Basics', 112, 511, 1230)
    bbox = (37, 33, 986, 1495)
    out = crop_to_2x3(im.convert('RGB'), bbox)
    out.save('aws-basics-cover-rgb.png')
    return out

def finish_back(src, dst=None):
    """Card back: centre-crop the export to 5:7, Lanczos to 400x560."""
    im = Image.open(src).convert('RGB')
    w, h = im.size
    if w * 7 >= h * 5:  # too wide: trim the sides
        cw = int(round(h * 5 / 7))
        left = (w - cw) // 2
        box = (left, 0, left + cw, h)
    else:  # too tall (the 1024x1536 exports): trim top and bottom
        ch = int(round(w * 7 / 5))
        top = (h - ch) // 2
        box = (0, top, w, top + ch)
    out = im.crop(box).resize((400, 560), Image.LANCZOS)
    if dst:
        out.save(dst)
    return out

def quantise(im, dst, colors=256):
    """256-colour median-cut with Floyd-Steinberg dithering, the pass every
    committed pack PNG gets (cover <= 1.2 MB, back <= 200 KB). Drop `colors`
    to 192 or 128 if a back comes out over budget."""
    q = im.convert('RGB').quantize(colors=colors, method=Image.Quantize.MEDIANCUT,
                                   dither=Image.Dither.FLOYDSTEINBERG)
    q.save(dst, optimize=True)
    return q

# slug -> (cover step, card-back export)
PACKS = {
    'aws': (run_aws, 'aws-back-full.png'),
    'claude': (run_claude, 'claude-back-full.png'),
    'aws-basics': (run_aws_basics, 'aws-basics-back-full.png'),
}

def finish_pack(slug):
    cover_step, back_src = PACKS[slug]
    quantise(cover_step(), slug + '.png')
    quantise(finish_back(back_src, slug + '-back-rgb.png'), slug + '-back.png')

if __name__ == '__main__':
    for slug in sys.argv[1:] or list(PACKS):
        finish_pack(slug)
        print(slug, Image.open(slug + '.png').size, Image.open(slug + '-back.png').size)
