"""Render a gold serif header onto a cover. Usage: functions only."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SUP = '/System/Library/Fonts/Supplemental/'

def gold_text_layer(size, text, font, cx, cy, top_rgb=(255, 232, 168), bot_rgb=(196, 140, 52),
                    outline_rgb=(58, 32, 8), glow_rgb=(0, 0, 0), glow_alpha=190, glow_blur=10, letter_gap=2):
    W, H = size
    # measure with per-glyph kerning gap
    tmp = ImageDraw.Draw(Image.new('L', (1, 1)))
    widths = [tmp.textbbox((0, 0), ch, font=font)[2] for ch in text]
    total = sum(widths) + letter_gap * (len(text) - 1)
    bbox = tmp.textbbox((0, 0), text, font=font)
    th = bbox[3] - bbox[1]
    x0 = cx - total // 2
    y0 = cy - th // 2 - bbox[1]
    # mask of the glyphs
    mask = Image.new('L', size, 0)
    md = ImageDraw.Draw(mask)
    x = x0
    for ch, w in zip(text, widths):
        md.text((x, y0), ch, font=font, fill=255)
        x += w + letter_gap
    # outline mask (stroke)
    omask = Image.new('L', size, 0)
    od = ImageDraw.Draw(omask)
    x = x0
    for ch, w in zip(text, widths):
        od.text((x, y0), ch, font=font, fill=255, stroke_width=3, stroke_fill=255)
        x += w + letter_gap
    # glow / shadow
    glow = Image.new('RGBA', size, (0, 0, 0, 0))
    g = Image.new('RGBA', size, glow_rgb + (0,))
    g.putalpha(omask.point(lambda v: int(v * glow_alpha / 255)))
    g = g.filter(ImageFilter.GaussianBlur(glow_blur))
    glow.alpha_composite(g)
    # outline layer
    out = Image.new('RGBA', size, outline_rgb + (0,))
    out.putalpha(omask)
    # gradient gold fill
    grad = Image.new('RGBA', size, (0, 0, 0, 0))
    gy0, gy1 = y0 + bbox[1], y0 + bbox[3]
    gd = ImageDraw.Draw(grad)
    for y in range(gy0, gy1 + 1):
        t = (y - gy0) / max(1, gy1 - gy0)
        # slight sheen band around 45%
        sheen = max(0.0, 1 - abs(t - 0.45) * 6)
        c = tuple(int(top_rgb[i] + (bot_rgb[i] - top_rgb[i]) * t + 40 * sheen) for i in range(3))
        c = tuple(min(255, v) for v in c)
        gd.line((0, y, W, y), fill=c + (255,))
    grad.putalpha(mask)
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    layer.alpha_composite(glow)
    layer.alpha_composite(out)
    layer.alpha_composite(grad)
    return layer

def font(name, size, index=0):
    return ImageFont.truetype(SUP + name, size, index=index)
