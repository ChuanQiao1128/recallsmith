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

if __name__ == '__main__':
    a = run_aws(); c = run_claude()
    print(a.size, c.size)
