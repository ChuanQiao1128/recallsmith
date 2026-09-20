#!/usr/bin/env bash
# B12 — asset-generators verify. cwd = worktree root. Re-runs the brief's
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   mobile/scripts/gen_card_frames.py (and gen_card_back.py, gen_particles.py)
#   do not exist, so the `[ -f ]` check fails before anything runs. Were step 1
#   skipped, step 2 (no PNG under mobile/assets/ui, no *-back.png but csharp),
#   step 3 (the eleven PNGs are absent), step 4 (packArt.ts still has
#   '#E8E2F2', no aws branch, no DEFAULT_CARD_BACK) and step 5 (packArt.test.ts
#   still asserts ai/cloud have no back; new cases absent) would each fail on
#   base as well. Step 6 (tsc) and step 7 (scope/frozen, purely negative) pass
#   on base by design. Needs python3 + Pillow (the build Mac has 3.8.10 +
#   Pillow 10.4.0); a missing Pillow is reported as a failure, not skipped.
#   Bytecode from the compile check goes to $TMP (never to
#   mobile/scripts/__pycache__, which is not gitignored and would trip the
#   scope guard); step 7 fails if that directory exists at all.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B12 VERIFY FAIL: $*" >&2; exit 1; }

p=mobile/src/theme/packArt.ts
t=mobile/tests/unit/packArt.test.ts
UI=mobile/assets/ui
PK=mobile/assets/packs
SCRIPTS=(mobile/scripts/gen_card_frames.py mobile/scripts/gen_particles.py mobile/scripts/gen_card_back.py)
PNGS=("$UI/frame-com.png" "$UI/frame-rar.png" "$UI/frame-leg.png" "$UI/foil-lut.png" "$UI/particles.png" "$UI/glow-9slice.png"
      "$PK/ai-back.png" "$PK/cloud-back.png" "$PK/aws-back.png" "$PK/premium-deck-back.png" "$PK/default-back.png")
TMP="${TMPDIR:-/tmp}/b12-verify.$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# ── 1. Scripts exist and compile under the build Mac's python3 (FAILS ON BASE)
echo "[1/7] generator scripts"
for s in "${SCRIPTS[@]}"; do
  [ -f "$s" ] || fail "$s does not exist (base tree fails here)"
  # compile to a scratch .pyc: `python3 -m py_compile` would write mobile/scripts/__pycache__/*.pyc,
  # which is not gitignored and would surface in step 7's untracked scan
  python3 -c 'import py_compile, sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)' "$s" "$TMP/$(basename "$s").pyc" \
    || fail "$s does not compile"
  grep -Eq "pngquant|matplotlib|numpy|import cairo|urllib|requests" "$s" && fail "$s mentions a banned tool/module (comments count — see the brief's Constraints)"
  grep -Eq "^OUT *= *['\"]/" "$s" && fail "$s hard-codes an absolute output path"
  grep -q "__file__" "$s" || fail "$s must locate its output directory from __file__"
  grep -Eq "humanizer|bypass|undetect|detector|evade|Gemini said" "$s" && fail "banned term in $s"
done
# the two scripts with film grain seed it with 1606; gen_particles.py is analytic (no random source)
for s in mobile/scripts/gen_card_frames.py mobile/scripts/gen_card_back.py; do
  grep -q "1606" "$s" || fail "$s must seed its grain with random.Random(1606)"
done
python3 -c "import PIL; from PIL import Image, ImageDraw, ImageFilter" 2>/dev/null || fail "python3 Pillow is not importable (the scripts need it)"

# ── 2. Byte-stable regeneration + csharp-back untouched ────────────────────
echo "[2/7] regenerate and compare"
for f in "${PNGS[@]}"; do [ -f "$f" ] || fail "missing generated asset $f"; done
shasum -a 256 "${PNGS[@]}" "$PK/csharp-back.png" > "$TMP/before"
for s in "${SCRIPTS[@]}"; do
  ( cd "$TMP" && python3 "$ROOT/$s" ) || fail "$s exited non-zero when run from a foreign cwd"
done
shasum -a 256 "${PNGS[@]}" "$PK/csharp-back.png" > "$TMP/after"
diff "$TMP/before" "$TMP/after" >&2 || fail "regenerated PNGs differ from the committed ones (scripts are not deterministic, or the tree is stale)"
# nothing else appeared under the two asset dirs (dotfiles such as a local .DS_Store are
# gitignored and skipped, as the previous `ls | grep` form skipped them)
extra=""
for f in "$UI"/*; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    frame-com.png|frame-rar.png|frame-leg.png|foil-lut.png|particles.png|glow-9slice.png) ;;
    *) extra="$extra $f" ;;
  esac
done
[ -z "$extra" ] || { echo "$extra" >&2; fail "unexpected files under $UI"; }
extra=""
for f in "$PK"/*; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    README.md|ai.png|aws.png|cloud.png|csharp.png|default.png|premium-deck.png) ;;
    ai-back.png|cloud-back.png|aws-back.png|premium-deck-back.png|default-back.png|csharp-back.png) ;;
    *) extra="$extra $f" ;;
  esac
done
[ -z "$extra" ] || { echo "$extra" >&2; fail "unexpected files under $PK"; }

# ── 3. Sizes (sips), budget, modes and alpha contract (Pillow probes) ──────
echo "[3/7] sizes / budget / alpha"
dims() { sips -g pixelWidth -g pixelHeight "$1" | awk '/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w"x"h}'; }
for f in "$UI/frame-com.png" "$UI/frame-rar.png" "$UI/frame-leg.png" "$PK/ai-back.png" "$PK/cloud-back.png" "$PK/aws-back.png" "$PK/premium-deck-back.png" "$PK/default-back.png"; do
  [ "$(dims "$f")" = "400x560" ] || fail "$f is $(dims "$f"), expected 400x560"
done
[ "$(dims "$UI/foil-lut.png")" = "256x4" ]     || fail "foil-lut.png is $(dims "$UI/foil-lut.png"), expected 256x4"
[ "$(dims "$UI/particles.png")" = "256x64" ]   || fail "particles.png is $(dims "$UI/particles.png"), expected 256x64"
[ "$(dims "$UI/glow-9slice.png")" = "96x96" ]  || fail "glow-9slice.png is $(dims "$UI/glow-9slice.png"), expected 96x96"
for f in "${PNGS[@]}"; do
  sz=$(stat -f %z "$f"); [ "$sz" -le 200000 ] || fail "$f is $sz bytes (> 200000)"
done
python3 - "$UI" "$PK" <<'PY' || fail "Pillow probes failed"
import sys
from PIL import Image
ui, pk = sys.argv[1], sys.argv[2]
errors = []
def a(img, x, y): return img.getpixel((x, y))[3]
for r in ('com', 'rar', 'leg'):
    im = Image.open(f'{ui}/frame-{r}.png')
    if im.mode != 'RGBA': errors.append(f'frame-{r}.png mode {im.mode}, expected RGBA')
    im = im.convert('RGBA')
    if a(im, 200, 212) != 0: errors.append(f'frame-{r}.png art window centre alpha {a(im,200,212)} != 0')
    if a(im, 40, 80) != 0: errors.append(f'frame-{r}.png art window corner alpha {a(im,40,80)} != 0')
    if a(im, 200, 460) != 0: errors.append(f'frame-{r}.png question slab alpha {a(im,200,460)} != 0')
    if a(im, 2, 2) != 0: errors.append(f'frame-{r}.png outside rounded corner alpha {a(im,2,2)} != 0')
    if a(im, 200, 10) < 250: errors.append(f'frame-{r}.png top band alpha {a(im,200,10)} < 250')
    if a(im, 12, 280) < 250: errors.append(f'frame-{r}.png left band alpha {a(im,12,280)} < 250')
    if a(im, 200, 550) < 250: errors.append(f'frame-{r}.png bottom band alpha {a(im,200,550)} < 250')
lut = Image.open(f'{ui}/foil-lut.png')
if lut.mode != 'RGB': errors.append(f'foil-lut.png mode {lut.mode}, expected RGB')
if len({lut.getpixel((x, 0)) for x in range(0, 256, 32)}) < 6: errors.append('foil-lut.png row 0 is not a hue sweep')
sp = Image.open(f'{ui}/particles.png')
if sp.mode != 'RGBA': errors.append(f'particles.png mode {sp.mode}, expected RGBA')
sp = sp.convert('RGBA')
for name, x0 in (('dot', 0), ('star', 64), ('fleck', 128), ('shard', 192)):
    px = sp.getpixel((x0 + 32, 32))
    if px[3] < 120: errors.append(f'particles.png {name} sprite centre alpha {px[3]} < 120')
    if px[:3] != (255, 255, 255): errors.append(f'particles.png {name} sprite RGB {px[:3]} != white')
    if sp.getpixel((x0 + 1, 1))[3] > 8: errors.append(f'particles.png {name} sprite corner alpha > 8')
gl = Image.open(f'{ui}/glow-9slice.png')
if gl.mode != 'RGBA': errors.append(f'glow-9slice.png mode {gl.mode}, expected RGBA')
gl = gl.convert('RGBA')
c = gl.getpixel((48, 48))
if c[3] < 240: errors.append(f'glow centre alpha {c[3]} < 240')
if c[:3] != (255, 255, 255): errors.append(f'glow centre RGB {c[:3]} != white')
if gl.getpixel((40, 40))[3] < 200: errors.append('glow inner cap (40,40) alpha < 200')
for pt in ((0, 0), (95, 0), (0, 95), (95, 95)):
    if gl.getpixel(pt)[3] > 8: errors.append(f'glow corner {pt} alpha > 8')
for d in ('ai', 'cloud', 'aws', 'premium-deck', 'default'):
    im = Image.open(f'{pk}/{d}-back.png').convert('RGBA')
    if im.size != (400, 560): errors.append(f'{d}-back.png size {im.size}')
    for pt in ((200, 280), (5, 5), (394, 554)):
        if im.getpixel(pt)[3] < 250: errors.append(f'{d}-back.png not opaque at {pt}')
if errors:
    print('\n'.join(errors)); sys.exit(1)
print('pillow probes ok')
PY

# ── 4. packArt.ts guards (FAILS ON BASE) ───────────────────────────────────
echo "[4/7] packArt.ts guards"
grep -q "'#D9D2E6'" "$p"                                       || fail "PAGE_GRADIENT_CEREMONY bottom stop not darkened (base tree fails here)"
grep -q "'#E8E2F2'" "$p" && fail "old bottom stop '#E8E2F2' still present"
grep -Fq "if (s === 'aws' || s.startsWith('aws-')) return 'aws';" "$p" || fail "normalizeSlugForPack aws branch missing"
grep -Fq "canonical = 'aws';" "$p"                              || fail "packPaletteFromSlug aws branch missing"
L_AWS_N=$(grep -nF "if (s === 'aws' || s.startsWith('aws-')) return 'aws';" "$p" | head -1 | cut -d: -f1)
L_CLOUD_N=$(grep -nF "return 'cloud';" "$p" | head -1 | cut -d: -f1)
[ "$L_AWS_N" -lt "$L_CLOUD_N" ] || fail "aws branch must come before the cloud branch in normalizeSlugForPack"
L_AWS_P=$(grep -nF "canonical = 'aws';" "$p" | head -1 | cut -d: -f1)
L_CLOUD_P=$(grep -nF "canonical = 'cloud';" "$p" | head -1 | cut -d: -f1)
[ "$L_AWS_P" -lt "$L_CLOUD_P" ] || fail "aws branch must come before the cloud branch in packPaletteFromSlug"
grep -q "lower.includes('aws')" "$p" && grep -q "s.includes('aws')" "$p" || fail "cloud branches lost their includes('aws') line"
for lit in \
  "export const DEFAULT_CARD_BACK" \
  "export function cardFrameForRarity(rarity: Rarity): ImageSourcePropType" \
  "export const CARD_FRAME_SIZE = { width: 400, height: 560 } as const;" \
  "export const CARD_FRAME_ART_WINDOW = { x: 28, y: 64, width: 344, height: 296 } as const;" \
  "export const CARD_FRAME_NINE_SLICE_INSET = 40;" \
  "export const CARD_FRAME_IMAGES: Record<Rarity, ImageSourcePropType>" \
  "export const FOIL_LUT: ImageSourcePropType" \
  "export const PARTICLE_SHEET: ImageSourcePropType" \
  "export const PARTICLE_SPRITE_SIZE = 64;" \
  "export const PARTICLE_SPRITES = { dot: 0, star: 64, fleck: 128, shard: 192 } as const;" \
  "export const GLOW_9SLICE: ImageSourcePropType" \
  "export const GLOW_9SLICE_INSET = 32;" \
  "import type { Rarity } from '../features/gacha/draw/cardRarity';" \
  "from '../../assets/ui/frame-com.png'" "from '../../assets/ui/frame-rar.png'" "from '../../assets/ui/frame-leg.png'" \
  "from '../../assets/ui/foil-lut.png'" "from '../../assets/ui/particles.png'" "from '../../assets/ui/glow-9slice.png'" \
  "from '../../assets/packs/ai-back.png'" "from '../../assets/packs/cloud-back.png'" "from '../../assets/packs/aws-back.png'" \
  "from '../../assets/packs/premium-deck-back.png'" "from '../../assets/packs/default-back.png'" \
  "from '../../assets/packs/csharp-back.png'" \
  "export function packImageForSlug(slug: string | null | undefined): ImageSourcePropType | undefined" \
  "export function cardBackImageForSlug(slug: string | null | undefined): ImageSourcePropType | undefined"; do
  grep -Fq "$lit" "$p" || fail "packArt.ts literal missing: $lit"
done
# CARD_BACK_IMAGES: five deck keys, no default
block="$(awk '/^const CARD_BACK_IMAGES/,/^\};/' "$p")"
for k in "csharp:" "ai:" "cloud:" "aws:" "'premium-deck':"; do
  printf '%s\n' "$block" | grep -q "$k" || fail "CARD_BACK_IMAGES lacks $k"
done
printf '%s\n' "$block" | grep -Eq "^\s*default:" && fail "CARD_BACK_IMAGES must not register default (undefined-on-miss contract)"
# SEAM_BAND_RATIO (B06) stays the last non-empty line when present. B06 allows an
# end-of-line `//` comment on that line (B06 brief, Constraints), so match the prefix.
if grep -q "SEAM_BAND_RATIO" "$p"; then
  case "$(grep -v '^[[:space:]]*$' "$p" | tail -n 1)" in
    "export const SEAM_BAND_RATIO = 0.18;"*) ;;
    *) fail "SEAM_BAND_RATIO is no longer the last line of packArt.ts" ;;
  esac
fi
# PALETTES / CANONICAL_PALETTE_INDEX untouched
grep -Fq "  aws: 1, // orange" "$p" || fail "CANONICAL_PALETTE_INDEX.aws changed"
grep -Fq "  cloud: 2, // pastel rainbow" "$p" || fail "CANONICAL_PALETTE_INDEX.cloud changed"
grep -Eq "humanizer|bypass|undetect|detector|evade|Gemini said" "$p" "$t" && fail "banned term in packArt.ts / test"

# ── 5. packArt.test.ts + targeted vitest (FAILS ON BASE) ───────────────────
echo "[5/7] packArt.test.ts + vitest"
grep -q "cardBackImageForSlug('ai')).toBeUndefined()" "$t" && fail "stale assertion: ai has no card back (must be replaced, base tree fails here)"
grep -q "cardBackImageForSlug('cloud')).toBeUndefined()" "$t" && fail "stale assertion: cloud has no card back"
grep -q "cardBackImageForSlug('totally-unknown-deck')).toBeUndefined()" "$t" || fail "undefined-on-miss assertion removed"
for s in \
  'routes aws-saa-c03 to the aws cover, not the cloud cover' \
  'gives aws-saa-c03 the aws card back and palette' \
  'registers a card back for every shipped deck and a separate default' \
  'exposes a frame for every rarity'; do
  grep -Fq "it('$s'" "$t" || fail "missing packArt test case: $s"
done
for s in \
  'returns a defined image for the canonical csharp slug' \
  'resolves C# variants (cs-dotnet, c-sharp, c#) to the csharp card back' \
  'returns undefined for null / empty / whitespace slug' \
  'packImageForSlug still resolves csharp to a defined image'; do
  grep -Fq "it('$s'" "$t" || fail "existing packArt case removed: $s"
done
[ "$(grep -cE "^\s*it\(" "$t")" -ge 9 ] || fail "packArt.test.ts needs >= 9 it() blocks"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$t" "$p" && fail "test gutting / suppression found"
( cd mobile && npx vitest run \
    tests/unit/packArt.test.ts \
    tests/integration/home.screen.test.tsx \
    tests/integration/draw.screen.test.tsx \
    tests/integration/draw-result.screen.test.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 6. Typecheck ───────────────────────────────────────────────────────────
echo "[6/7] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 7. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[7/7] scope + frozen guard"
[ ! -e mobile/scripts/__pycache__ ] || fail "mobile/scripts/__pycache__ exists (py_compile bytecode; not gitignored) — delete it, it must never be committed"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/assets/packs/csharp-back.png mobile/assets/packs/csharp.png mobile/assets/packs/ai.png mobile/assets/packs/cloud.png \
  mobile/assets/packs/aws.png mobile/assets/packs/default.png mobile/assets/packs/premium-deck.png mobile/assets/packs/README.md \
  mobile/scripts/gen_packs.py mobile/scripts/gen_sfx.py mobile/package.json mobile/package-lock.json)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -q '"vite": "7.2.4"' mobile/package.json || fail "vite pin changed"
grep -rq "@sentry" mobile/package.json mobile/src 2>/dev/null && fail "@sentry reference found"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
  | grep -Ev '^(mobile/scripts/gen_card_frames\.py|mobile/scripts/gen_card_back\.py|mobile/scripts/gen_particles\.py|mobile/assets/ui/(frame-com|frame-rar|frame-leg|foil-lut|particles|glow-9slice)\.png|mobile/assets/packs/(ai|cloud|aws|premium-deck|default)-back\.png|mobile/src/theme/packArt\.ts|mobile/tests/unit/packArt\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B12 scope"; }

echo "B12 VERIFY OK"
