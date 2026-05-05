"""Generate a placeholder pack-opening Lottie JSON.

Timeline (90 frames @ 30fps = 3 seconds):
  Frame 0-15   : pack drops in from top with bounce (translateY -200→0, scale 0.5→1.1→1)
  Frame 15-40  : pack pulses (scale 1→1.05→1)
  Frame 40-55  : pack vibrates (rotation -3°→3°→-3°→3°→0)
  Frame 55-70  : flash overlay scales out from center (scale 0→6, opacity 0→1→0)
  Frame 55-90  : 12 sparkle dots burst outward
  Frame 70-90  : pack opacity 1→0 (the pack "rips open")

Output: assets/lottie/pack-opening.json
"""
import json
import math
import os

OUT = "/sessions/compassionate-kind-babbage/mnt/DeveloperCards/recallSmith/mobile/assets/lottie/pack-opening.json"

W, H = 400, 400
FR = 30
DURATION = 90
CX, CY = 200, 200

# Color helpers (Lottie wants 0..1 floats)
def rgba(r, g, b, a=1):
    return [r / 255, g / 255, b / 255, a]

POKE_PURPLE = rgba(122, 77, 196)
POKE_PURPLE_LIGHT = rgba(167, 127, 224)
POKE_GOLD = rgba(245, 201, 94)
POKE_BLUE = rgba(63, 183, 219)
WHITE = rgba(255, 255, 255)


def kf_static(value):
    """Static (non-animated) Lottie property."""
    return {"a": 0, "k": value}


def kf_anim(keyframes):
    """Animated Lottie property. keyframes = [(frame, value), ...]"""
    out = []
    for frame, value in keyframes:
        out.append({
            "t": frame,
            "s": value if isinstance(value, list) else [value],
            "h": 0,
            # Linear in/out interpolation for simplicity
            "i": {"x": [0.5], "y": [1]},
            "o": {"x": [0.5], "y": [0]},
        })
    # Lottie expects the LAST keyframe to drop the easing fields (it's just a stop)
    if out:
        out[-1] = {"t": out[-1]["t"], "s": out[-1]["s"], "h": 0}
    return {"a": 1, "k": out}


def make_shape_layer(name, ind, ks, shapes, ip=0, op=DURATION):
    """A type-4 shape layer."""
    return {
        "ddd": 0,
        "ind": ind,
        "ty": 4,
        "nm": name,
        "sr": 1,
        "ks": ks,
        "ao": 0,
        "shapes": shapes,
        "ip": ip,
        "op": op,
        "st": 0,
        "bm": 0,
    }


def transform(position=None, anchor=(0, 0), scale=(100, 100), rotation=0, opacity=100):
    """Standard ks transform."""
    return {
        "o": kf_static(opacity) if not isinstance(opacity, dict) else opacity,
        "r": kf_static(rotation) if not isinstance(rotation, dict) else rotation,
        "p": kf_static(list(position) + [0]) if isinstance(position, (tuple, list)) else position,
        "a": kf_static(list(anchor) + [0]),
        "s": kf_static(list(scale) + [100]) if isinstance(scale, (tuple, list)) else scale,
    }


def fill(color):
    return {
        "ty": "fl",
        "c": kf_static(color),
        "o": kf_static(100),
        "r": 1,
        "bm": 0,
        "nm": "Fill",
    }


def ellipse_shape(size=(100, 100), pos=(0, 0)):
    return {
        "ty": "el",
        "p": kf_static(list(pos)),
        "s": kf_static(list(size)),
        "nm": "Ellipse",
    }


def rect_shape(size=(100, 140), pos=(0, 0), corner=12):
    return {
        "ty": "rc",
        "p": kf_static(list(pos)),
        "s": kf_static(list(size)),
        "r": kf_static(corner),
        "nm": "Rect",
    }


def transform_shape():
    """Required terminating transform inside a group."""
    return {
        "ty": "tr",
        "p": kf_static([0, 0]),
        "a": kf_static([0, 0]),
        "s": kf_static([100, 100]),
        "r": kf_static(0),
        "o": kf_static(100),
        "sk": kf_static(0),
        "sa": kf_static(0),
        "nm": "Transform",
    }


def group(items, name="Group"):
    return {
        "ty": "gr",
        "it": items + [transform_shape()],
        "nm": name,
        "bm": 0,
    }


# ── Build layers (rendered back-to-front) ──────────────────────────────────

layers = []
ind = 1

# Layer 1: ambient soft purple background halo (always present, gentle pulse)
halo = make_shape_layer(
    "Halo",
    ind,
    transform(
        position=(CX, CY),
        scale=kf_anim([(0, [90, 90]), (45, [110, 110]), (90, [90, 90])]),
        opacity=60,
    ),
    [group([ellipse_shape(size=(360, 360)), fill(POKE_PURPLE_LIGHT)])],
)
layers.append(halo)
ind += 1

# Layer 2: 12 sparkle dots — each at a different angle, fly outward 55 → 90
for i in range(12):
    angle = (i / 12) * 2 * math.pi + (i % 3) * 0.18
    start_x = CX
    start_y = CY
    end_x = CX + math.cos(angle) * (140 + (i * 17) % 60)
    end_y = CY + math.sin(angle) * (140 + (i * 17) % 60)
    size = 16 + (i * 5) % 12
    color = [POKE_GOLD, WHITE, POKE_PURPLE_LIGHT][i % 3]
    sparkle = make_shape_layer(
        f"Sparkle{i}",
        ind,
        {
            "o": kf_anim([(0, [0]), (55, [0]), (62, [100]), (85, [0]), (90, [0])]),
            "r": kf_static(0),
            "p": kf_anim([
                (55, [start_x, start_y, 0]),
                (90, [end_x, end_y, 0]),
            ]),
            "a": kf_static([0, 0, 0]),
            "s": kf_anim([
                (55, [0, 0, 100]),
                (62, [120, 120, 100]),
                (90, [40, 40, 100]),
            ]),
        },
        [group([ellipse_shape(size=(size, size)), fill(color)])],
        ip=55,
    )
    layers.append(sparkle)
    ind += 1

# Layer 3: white radial flash — scales out from center 55 → 70
flash = make_shape_layer(
    "Flash",
    ind,
    transform(
        position=(CX, CY),
        scale=kf_anim([(55, [0, 0]), (62, [320, 320]), (70, [600, 600])]),
        opacity=kf_anim([(55, [0]), (62, [85]), (70, [0])]),
    ),
    [group([ellipse_shape(size=(140, 140)), fill(WHITE)])],
    ip=55,
    op=70,
)
layers.append(flash)
ind += 1

# Layer 4: the pack itself — drop in, pulse, vibrate, fade out
pack = make_shape_layer(
    "Pack",
    ind,
    {
        "o": kf_anim([
            (0, [0]),
            (5, [100]),
            (60, [100]),
            (75, [0]),
        ]),
        "r": kf_anim([
            (0, [0]),
            (40, [0]),
            (43, [-3]),
            (46, [3]),
            (49, [-2]),
            (52, [2]),
            (55, [0]),
        ]),
        "p": kf_anim([
            (0, [CX, CY - 200, 0]),
            (10, [CX, CY + 8, 0]),
            (15, [CX, CY, 0]),
        ]),
        "a": kf_static([0, 0, 0]),
        "s": kf_anim([
            (0, [50, 50, 100]),
            (10, [110, 110, 100]),
            (15, [100, 100, 100]),
            (25, [105, 105, 100]),
            (35, [100, 100, 100]),
        ]),
    },
    [
        # outer glow ring
        group(
            [ellipse_shape(size=(160, 220)), fill(POKE_PURPLE_LIGHT)],
            name="PackGlow",
        ),
        # main pack body — purple rounded rect
        group(
            [rect_shape(size=(140, 200), corner=18), fill(POKE_PURPLE)],
            name="PackBody",
        ),
        # gold accent stripe near top
        group(
            [
                rect_shape(size=(100, 14), pos=(0, -70), corner=4),
                fill(POKE_GOLD),
            ],
            name="PackStripe",
        ),
    ],
    op=80,
)
layers.append(pack)
ind += 1

# Final root document
animation = {
    "v": "5.7.4",
    "fr": FR,
    "ip": 0,
    "op": DURATION,
    "w": W,
    "h": H,
    "nm": "Pack opening (placeholder)",
    "ddd": 0,
    "assets": [],
    "layers": layers,
    "markers": [],
    "meta": {
        "g": "recallSmith placeholder",
        "a": "claude",
        "k": "placeholder",
        "d": "swap with a real one from lottiefiles.com",
    },
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(animation, f, separators=(",", ":"))
print(f"wrote {OUT}  ({os.path.getsize(OUT)} bytes)")
