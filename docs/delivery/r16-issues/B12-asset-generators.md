# B12 — Asset generators + packArt registry (`asset-generators`)

Three Pillow scripts produce every bitmap the Seam of Light stage consumes (3 rarity frames, foil LUT, particle sheet, glow 9-slice, 5 card backs), `packArt.ts` registers them under the names the other briefs import, `aws-saa-c03` stops borrowing the cloud cover, and the ceremony page gradient gets its darker bottom stop.

## Context

Today the ceremony draws cards as "a white rectangle with a 2 px coloured border, an 8 px chip and a 9 px question" (design §1 table, `docs/release-1.6.0-plan-2026-09-19.md:44`) and the only bitmap the gacha tree owns is `csharp-back.png` (`mobile/src/theme/packArt.ts:171`, registry `:188-190`). Design §3.6 (`:135-148`, "素材清单"; the table rows are `:137-148`) lists what the new stage needs and says every item is producible with Python 3 + Pillow, the toolchain `mobile/scripts/gen_packs.py` already uses; B00 §6 fixes the sizes, file names and the `packArt.ts` export names that B05 (`PARTICLE_SHEET`, `GLOW_9SLICE`), B06/B08 (`cardBackImageForSlug`, `cardFrameForRarity`, `FOIL_LUT`), B09 (`DEFAULT_CARD_BACK`, rims) and B10 (`cardFrameForRarity`, `GLOW_9SLICE`, `GLOW_9SLICE_INSET` on DrawResult) import. B10 and B09 depend on this issue; the names below are contracts, not suggestions.

Two registry facts change with the assets. `normalizeSlugForPack` (`packArt.ts:198-225`) sends anything containing `aws` to `cloud` (`:214-223`) — deliberate when there was no AWS deck (`docs/aws-saa-demo-deck-plan-2026-09-16.md:17,27`), wrong now that `aws-saa-c03` is a live deck with its own `aws.png` cover (`:160`, registered `:179`) and palette (`aws: 1`, `:79`); `packPaletteFromSlug` (`:91-104`) has the same `includes('aws') → cloud` rule. And `PAGE_GRADIENT_CEREMONY`'s bottom stop `'#E8E2F2'` (`:131-135`) is too bright for light effects to read against; design §3.1 S0 darkens it to `'#D9D2E6'`.

`gen_packs.py` cannot be reused as-is: it hard-codes a container path (`:16`) and Linux font files (`:20-23`). The three new scripts are self-contained, path themselves from `__file__`, need nothing but Pillow, run on the build Mac's `python3` (3.8.10 + Pillow 10.4.0; `pngquant` is **not** installed, so the ≤ 200 KB budget is met with Pillow's own palette quantisation), and are byte-stable across runs so a re-run never dirties the tree.

`mobile/tests/unit/packArt.test.ts:19-24` asserts that `ai`/`cloud` have **no** card back; that assertion documents the old incremental rollout and is replaced (B00 §9 #5) while `cardBackImageForSlug`'s undefined-on-miss contract for unregistered slugs (`:245-250`, test `:23,:26-31`) is kept by exporting the default back separately instead of registering `default`.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` §0, §1 (B12 row; B06 appends `SEAM_BAND_RATIO` to the same file), §5 (B12 deps: B01, **B06**), §6 (the asset table — every path, size and export name), §8, §9 #5.
2. `mobile/src/theme/packArt.ts` in full (250 lines): `:23-69` `PALETTES`, `:75-82` `CANONICAL_PALETTE_INDEX`, `:84-114` `packPaletteFromSlug`, `:131-135` `PAGE_GRADIENT_CEREMONY`, `:157-162` pack imports, `:164-171` card-back import + comment, `:173-190` registries, `:198-225` `normalizeSlugForPack`, `:227-250` lookups. If B06 has merged, the last line is `export const SEAM_BAND_RATIO = 0.18;` — it stays last.
3. `mobile/tests/unit/packArt.test.ts` (38 lines).
4. `mobile/src/features/gacha/draw/cardRarity.ts:1-3` (`Rarity` type; the file has only a type import, so `packArt.ts` may import it without a cycle).
5. `mobile/scripts/gen_packs.py:1-30` (what NOT to copy: absolute `OUT`, font paths) and its drawing helpers for style reference.
6. `mobile/vitest.config.ts` (PNG imports resolve to URL strings under vitest; equality of two `packImageForSlug` results is string equality).
7. `docs/release-1.6.0-plan-2026-09-19.md:135-148` (§3.6 asset table; `:160-171` is the §3.7 code-change table, whose `packArt.ts + scripts/gen_*` row is `:172`).

## Constraints

- **Scope (the ONLY paths that may change/appear):**
  - `mobile/scripts/gen_card_frames.py`, `mobile/scripts/gen_card_back.py`, `mobile/scripts/gen_particles.py` (new)
  - `mobile/assets/ui/frame-com.png`, `frame-rar.png`, `frame-leg.png`, `foil-lut.png`, `particles.png`, `glow-9slice.png` (new; the `mobile/assets/ui/` directory is new)
  - `mobile/assets/packs/ai-back.png`, `cloud-back.png`, `aws-back.png`, `premium-deck-back.png`, `default-back.png` (new)
  - `mobile/src/theme/packArt.ts`
  - `mobile/tests/unit/packArt.test.ts`
  No README, no `.gitattributes`, no other asset, no change to `csharp-back.png`, `csharp.png`, `ai.png`, `cloud.png`, `aws.png`, `default.png`, `premium-deck.png`, `gen_packs.py`, `gen_sfx.py`.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **No dependency changes**; `"vite": "7.2.4"` stays; no `@sentry`. Scripts: Python ≥ 3.8 syntax only (no `list[int]` / `X | None` annotations at runtime, no `match`), `from PIL import …` only from the standard library + Pillow, no `matplotlib`, no `numpy`, no network, no `pngquant` call. **The verify greps the words `pngquant`, `matplotlib`, `numpy`, `import cairo`, `urllib`, `requests` in each script, comments and docstrings included** — do not write "no pngquant available, quantise with Pillow" in a docstring; say "quantised with Pillow's FASTOCTREE (no external tool)".
- **Scripts are cwd-independent and deterministic**: output directory = `Path(__file__).resolve().parents[1] / 'assets' / ('ui' | 'packs')`, created with `mkdir(parents=True, exist_ok=True)`; every random source is `random.Random(1606)` — `gen_card_frames.py` (grain) and `gen_card_back.py` (grain) must contain the literal `1606`; `gen_particles.py` is purely analytic (Gaussian, polygon, ellipse, triangle, blur) and has no random source, so it need not mention the seed; no timestamps in PNG chunks (Pillow writes none by default — do not add `pnginfo`). Running a script twice yields byte-identical files (the verify hashes before/after).
- **No bytecode beside the sources.** `python3 -m py_compile scripts/x.py` writes `scripts/__pycache__/x.cpython-38.pyc`, and neither `.gitignore` nor `mobile/.gitignore` ignores `__pycache__` — the verify's pathspec-scoped untracked scan over `mobile/scripts` would report it as an out-of-scope file, and a `git add -A` would commit it. Compile with the bytecode redirected (Acceptance 1) or `rm -rf mobile/scripts/__pycache__` before you commit; the verify fails outright if that directory exists.
- **Sizes and modes are exact** (B00 §6): frames 400×560 RGBA; `foil-lut.png` 256×4 **RGB** (never quantised); `particles.png` 256×64 RGBA; `glow-9slice.png` 96×96 RGBA with RGB = white everywhere (so RN `tintColor` recolours it); card backs 400×560 fully opaque (RGB, RGBA or `P` after quantisation). Every PNG ≤ 200 000 bytes (`stat -f %z`). Quantise (`Image.quantize(colors=256, method=Image.Quantize.FASTOCTREE)`) only where an RGBA/RGB save would exceed the budget — card backs in practice; frames stay RGBA so alpha is exact.
- **Alpha contract of the frames** (probed by the verify with Pillow): fully transparent (alpha 0) inside `CARD_FRAME_ART_WINDOW` (x 28..372, y 64..360) and inside the question slab (x 28..372, y 384..536); opaque (alpha ≥ 250) in the outer band (the 24 px inside the rounded outline, radius 28); alpha 0 outside the rounded corners (probe (2, 2)). Grain/gloss touch RGB only, never alpha.
- **`packArt.ts` export names verbatim** (B00 §6): `CARD_FRAME_IMAGES`, `cardFrameForRarity`, `CARD_FRAME_SIZE`, `CARD_FRAME_ART_WINDOW`, `CARD_FRAME_NINE_SLICE_INSET`, `FOIL_LUT`, `PARTICLE_SHEET`, `PARTICLE_SPRITES`, `PARTICLE_SPRITE_SIZE`, `GLOW_9SLICE`, `GLOW_9SLICE_INSET`, `DEFAULT_CARD_BACK`. Existing exports keep their signatures: `packPaletteFromSlug`, `packPaletteFromIndex`, `PAGE_GRADIENT_LIGHT`, `PAGE_GRADIENT_CEREMONY`, `rarityHaloColor`, `rarityAccentColor`, `packImageForSlug`, `cardBackImageForSlug`, `PackPalette`.
- **`SEAM_BAND_RATIO`** (B06's one appended line) must remain the last non-empty line of `packArt.ts` when present; add your exports above the registry/lookup region, never after it. B06 allows an end-of-line `//` comment on that line (`export const SEAM_BAND_RATIO = 0.18; // top 18 % …`), so the verify matches the line by its `export const SEAM_BAND_RATIO = 0.18;` prefix — do not touch the comment either.
- **`cardBackImageForSlug` keeps undefined-on-miss**: `'totally-unknown-deck'`, `null`, `''`, `'   '` → `undefined`. `default` is NOT a key of `CARD_BACK_IMAGES`.
- **Existing test literals allowed to change:** exactly the case at `packArt.test.ts:19-24` (its two `ai`/`cloud` lines go, its title may say "unregistered"); every other existing `expect` stays; add cases only otherwise.
- **Banned literals** in any new file, identifier or comment: `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. No `@ts-ignore`, `eslint-disable`, `.skip(`, `.only(`.

## Changes required

1. **`mobile/scripts/gen_card_frames.py`** — writes `assets/ui/frame-com.png`, `frame-rar.png`, `frame-leg.png`, `foil-lut.png`. Module docstring states the outputs, sizes and the alpha contract. Constants (shared with `packArt.ts`, keep the numbers identical):
   ```python
   W, H = 400, 560
   RADIUS = 28                     # outer rounded corners
   BAND = 24                       # opaque frame band
   ART_WINDOW = (28, 64, 372, 360) # x0, y0, x1, y1 — transparent
   SLAB = (28, 384, 372, 536)      # question slab — transparent
   SEED = 1606
   RARITY = {
       'com': {'base': (201, 165, 108), 'light': (236, 214, 176), 'dark': (140, 108, 62), 'gloss': False},  # colors.rarityCommon #C9A56C, matte
       'rar': {'base': (167, 139, 216), 'light': (214, 199, 240), 'dark': (96, 72, 150), 'gloss': True},    # colors.rarityRare #A78BD8, violet foil
       'leg': {'base': (245, 201, 94), 'light': (255, 236, 176), 'dark': (160, 116, 24), 'gloss': True},    # colors.rarityLegendary #F5C95E, gold foil
   }
   ```
   Per rarity: start from a fully transparent RGBA canvas; paint the rounded outline (`ImageDraw.rounded_rectangle`, radius `RADIUS`, covering the whole 400×560 canvas) with a vertical `light → base → dark` ramp; draw a 2-px bevel line (`dark`) and a 1-px highlight (`light`) around the art window — both strictly OUTSIDE the window rectangle (x 26..27 / 372..373, y 62..63 / 360..361 and one pixel further out); a title strip y 24..60 and a strip y 360..384 in `base` at alpha 255; for `gloss` rarities add a diagonal gloss stripe (`light` at ~35 % blended into RGB) and film grain (`random.Random(SEED)`, ±`amp` per RGB channel, alpha untouched); COM stays matte (no gloss, grain ±3). **Cut `ART_WINDOW` and `SLAB` back to alpha 0 as the LAST drawing step** (`ImageDraw.Draw(img).rounded_rectangle(box, radius=12, fill=(0, 0, 0, 0))` directly on the RGBA image — `ImageDraw` replaces pixels, it does not alpha-composite, so the window really is alpha 0 afterwards; do not go through `Image.alpha_composite` for this step) so grain, bevel and gloss can never leak into the window. Save `frame-<rarity>.png` as RGBA with `optimize=True`. Budget loop: the grain is what costs bytes, so save to a `BytesIO` first with `amp` walking `6 → 4 → 2 → 0` (COM `3 → 2 → 0`) and write the first result ≤ 200 000 bytes to disk (deterministic: the loop always picks the same amplitude for the same code); never quantise a frame (a palette would resample alpha). Exit non-zero if even `amp = 0` exceeds the budget.
   `foil-lut.png`: 256×4 RGB (saved from an `'RGB'`-mode image — never `'P'`, never `'RGBA'`); row 0 = full hue sweep (HSV h = x/255, s 0.55, v 1.0 via `colorsys.hsv_to_rgb`), row 1 = the same sweep blended 40 % toward `RARITY['rar']['base']`, row 2 = blended 40 % toward `RARITY['leg']['base']`, row 3 = white → `leg.light` highlight ramp. Save RGB, `optimize=True`. `print()` one line per file with its path and byte size; exit 0.

2. **`mobile/scripts/gen_particles.py`** — writes `assets/ui/particles.png` (256×64 RGBA, four 64×64 sprites at x offsets 0 / 64 / 128 / 192 — **dot, star, fleck, shard** in that order, matching `PARTICLE_SPRITES`) and `assets/ui/glow-9slice.png` (96×96 RGBA). All sprite RGB is pure white `(255, 255, 255)`; only alpha carries the shape so the Atlas `colors` array / RN `tintColor` recolour them:
   - dot: Gaussian falloff, alpha = 255·exp(−(r/14)²) clipped at r ≤ 30;
   - star: 4-point star polygon (outer radius 28, inner 7) filled alpha 255, then a 1-px `GaussianBlur(0.8)` on alpha only;
   - fleck: ellipse 34×12 rotated 28°, alpha 230, blurred 1.2;
   - shard: thin triangle (apex up, base 10 px, height 40) alpha 220, blurred 0.8.
   - glow: alpha = 255·exp(−(r/30)²) from the centre (48, 48), clamped so alpha(48,48) ≥ 240 and alpha at any corner ≤ 8; RGB white. The 9-slice cap inset is 32 (`GLOW_9SLICE_INSET`) — the centre 32×32 must be near-flat (alpha ≥ 200) so stretching it does not band.
   Save RGBA, `optimize=True`; print sizes; exit 0.

3. **`mobile/scripts/gen_card_back.py`** — writes `assets/packs/{ai,cloud,aws,premium-deck,default}-back.png` (400×560, opaque, ≤ 200 KB). Never writes `csharp-back.png`. Hard-code the palette table from `packArt.ts:23-82` (the five `cover` 4-stop ramps + `CANONICAL_PALETTE_INDEX`: `ai → 3`, `cloud → 2`, `aws → 1`, `'premium-deck' → 4`, `default → 0`) with a comment naming that source. Per deck: vertical 4-stop gradient of the deck's `cover`; filigree ring = 3 concentric ellipses (`ring` colour from the palette at alpha ≈ 0.55, widths 3/2/1) around the centre (200, 280) with 24 tick marks; a monogram (`ai → 'AI'`, `cloud → 'C'`, `aws → 'AWS'`, `'premium-deck' → 'P'`, `default → 'R'` — the R-monogram the procedural back uses, `packArt.ts:165`) drawn with `ImageFont.load_default(size=140)` inside `try/except` (Pillow ≥ 10.1) falling back to a plain inner disc when the sized default font is unavailable; a 12-px inner border in `titleInk` at alpha 0.35; film grain ±4 (`random.Random(1606)`). Composite onto opaque, then `quantize(colors=256, method=Image.Quantize.FASTOCTREE)` and save with `optimize=True`; print each byte size; exit non-zero if any file exceeds 200 000 bytes.

4. **`mobile/src/theme/packArt.ts`** — registry + normalisation + gradient.
   a. `:131-135` — bottom stop `'#E8E2F2'` → `'#D9D2E6'` (comment: design §3.1 S0, darkened so seam light reads).
   b. `packPaletteFromSlug` (`:91-104`): insert **before** the cloud branch
      ```ts
      } else if (lower === 'aws' || lower.startsWith('aws-')) {
        canonical = 'aws';
      ```
      so `aws-saa-c03` resolves to `CANONICAL_PALETTE_INDEX.aws` (`1`, orange). The cloud branch keeps its `includes('aws')` line (a slug like `my-aws-notes` still lands on cloud, matching `normalizeSlugForPack`).
   c. `normalizeSlugForPack` (`:198-225`): insert **before** the cloud branch (`:214`) `if (s === 'aws' || s.startsWith('aws-')) return 'aws';` with a one-line comment (aws-saa-c03 is a live deck with its own cover, `docs/aws-saa-demo-deck-plan-2026-09-16.md`).
   d. Imports (after `:171`): `import type { Rarity } from '../features/gacha/draw/cardRarity';` plus the eleven PNG imports (`../../assets/ui/frame-com.png` → `frameCom`, `frame-rar.png` → `frameRar`, `frame-leg.png` → `frameLeg`, `foil-lut.png` → `foilLut`, `particles.png` → `particleSheet`, `glow-9slice.png` → `glowNineSlice`, `../../assets/packs/ai-back.png` → `aiCardBack`, `cloud-back.png` → `cloudCardBack`, `aws-back.png` → `awsCardBack`, `premium-deck-back.png` → `premiumCardBack`, `default-back.png` → `defaultCardBack`).
   e. `CARD_BACK_IMAGES` (`:188-190`) becomes `{ csharp: csharpCardBack, ai: aiCardBack, cloud: cloudCardBack, aws: awsCardBack, 'premium-deck': premiumCardBack }` — **no `default` key**. Rewrite the comments at `:164-170` and `:184-187` (every shipped deck now has a back; unregistered slugs still return `undefined` so the procedural back stays canonical for un-themed decks; the generic back is `DEFAULT_CARD_BACK` for callers that want one).
   f. New exports, placed right after `CARD_BACK_IMAGES` and before `normalizeSlugForPack` (never after `cardBackImageForSlug`, so `SEAM_BAND_RATIO` stays last):
      ```ts
      export const DEFAULT_CARD_BACK: ImageSourcePropType = defaultCardBack;
      export const CARD_FRAME_SIZE = { width: 400, height: 560 } as const;
      export const CARD_FRAME_ART_WINDOW = { x: 28, y: 64, width: 344, height: 296 } as const;
      export const CARD_FRAME_NINE_SLICE_INSET = 40;
      export const CARD_FRAME_IMAGES: Record<Rarity, ImageSourcePropType> = { COM: frameCom, RAR: frameRar, LEG: frameLeg };
      export function cardFrameForRarity(rarity: Rarity): ImageSourcePropType {
        return CARD_FRAME_IMAGES[rarity] ?? CARD_FRAME_IMAGES.COM;
      }
      export const FOIL_LUT: ImageSourcePropType = foilLut;
      export const PARTICLE_SHEET: ImageSourcePropType = particleSheet;
      export const PARTICLE_SPRITE_SIZE = 64;
      export const PARTICLE_SPRITES = { dot: 0, star: 64, fleck: 128, shard: 192 } as const;
      export const GLOW_9SLICE: ImageSourcePropType = glowNineSlice;
      export const GLOW_9SLICE_INSET = 32;
      ```
      with a short comment block naming the producing script for each group (`gen_card_frames.py` / `gen_particles.py` / `gen_card_back.py`) and the consumers (B05 StageCanvas, B08 TapCard/FoilLayer, B09 FallbackStage, B10 DrawResult).
   g. Nothing else moves: `packImageForSlug`, `cardBackImageForSlug`, `PACK_IMAGES`, the pack imports `:157-162`, `PALETTES`, `rarityHaloColor`, `rarityAccentColor` stay byte-identical.

5. **`mobile/tests/unit/packArt.test.ts`** — extend the import to `{ cardBackImageForSlug, cardFrameForRarity, DEFAULT_CARD_BACK, packImageForSlug, packPaletteFromSlug }`.
   a. Replace the case at `:19-24` with `it('returns undefined for slugs that have no registered card back', ...)` asserting only `cardBackImageForSlug('totally-unknown-deck')` is `undefined`.
   b. Add, in a new `describe('packArt — aws and stage assets')`:
      1. `it('routes aws-saa-c03 to the aws cover, not the cloud cover', ...)` — `packImageForSlug('aws-saa-c03')` `toBe(packImageForSlug('aws'))` and `not.toBe(packImageForSlug('cloud'))`; `packImageForSlug('AWS-SAA-C03')` same.
      2. `it('gives aws-saa-c03 the aws card back and palette', ...)` — `cardBackImageForSlug('aws-saa-c03')` `toBe(cardBackImageForSlug('aws'))` and `toBeDefined()`; `packPaletteFromSlug('aws-saa-c03')` `toEqual(packPaletteFromSlug('aws'))` and `not.toEqual(packPaletteFromSlug('cloud'))`.
      3. `it('registers a card back for every shipped deck and a separate default', ...)` — `ai`, `cloud`, `premium-deck` defined; `DEFAULT_CARD_BACK` defined; `cardBackImageForSlug('default')` is `undefined`.
      4. `it('exposes a frame for every rarity', ...)` — `cardFrameForRarity('COM')`, `('RAR')`, `('LEG')` defined and pairwise distinct.

## Acceptance

Run from `mobile/`. `docs/delivery/r16-issues/B12.verify.sh` re-runs these verbatim from the worktree root.

1. Scripts exist and compile, with the bytecode written to a scratch file instead of `scripts/__pycache__/`: `for s in scripts/gen_card_frames.py scripts/gen_card_back.py scripts/gen_particles.py; do python3 -c 'import py_compile, sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)' "$s" "${TMPDIR:-/tmp}/b12.pyc"; done` (exit 0; `python3 --version` is 3.8.10 on the build Mac). `[ ! -e scripts/__pycache__ ]` must hold before you commit — if you ran a plain `python3 -m py_compile` at any point, `rm -rf scripts/__pycache__`. `gen_card_frames.py` and `gen_card_back.py` contain the literal `1606`; none of the three contains `pngquant`, `matplotlib`, `numpy`, `import cairo`, `urllib` or `requests` (comments included).
2. Byte-stable: `shasum -a 256 assets/ui/*.png assets/packs/*-back.png > /tmp/b12.before && (cd .. && python3 mobile/scripts/gen_card_frames.py && python3 mobile/scripts/gen_particles.py && python3 mobile/scripts/gen_card_back.py) && shasum -a 256 assets/ui/*.png assets/packs/*-back.png | diff - /tmp/b12.before` — empty diff (the committed PNGs are exactly what the scripts write, and `csharp-back.png` is untouched).
3. Sizes/modes/alpha (exit 0): `sips -g pixelWidth -g pixelHeight` reports 400×560 for the 3 frames and the 5 backs, 256×4 for `foil-lut.png`, 256×64 for `particles.png`, 96×96 for `glow-9slice.png`; `stat -f %z` ≤ 200000 for all eleven; the Pillow probes in the verify script (frame alpha contract, LUT `RGB`, particles/glow `RGBA` white, glow centre ≥ 240 / corner ≤ 8, backs opaque) pass.
4. `packArt.ts` guards (exit 0): `p=src/theme/packArt.ts; grep -q "'#D9D2E6'" "$p" && ! grep -q "'#E8E2F2'" "$p" && grep -q "if (s === 'aws' || s.startsWith('aws-')) return 'aws';" "$p" && grep -q "canonical = 'aws';" "$p" && grep -q "export const DEFAULT_CARD_BACK" "$p" && grep -q "export function cardFrameForRarity(rarity: Rarity): ImageSourcePropType" "$p" && grep -q "export const CARD_FRAME_SIZE = { width: 400, height: 560 } as const;" "$p" && grep -q "export const CARD_FRAME_ART_WINDOW = { x: 28, y: 64, width: 344, height: 296 } as const;" "$p" && grep -q "export const CARD_FRAME_NINE_SLICE_INSET = 40;" "$p" && grep -q "export const PARTICLE_SPRITES = { dot: 0, star: 64, fleck: 128, shard: 192 } as const;" "$p" && grep -q "export const PARTICLE_SPRITE_SIZE = 64;" "$p" && grep -q "export const GLOW_9SLICE_INSET = 32;" "$p"` plus the ordering rules (aws branch before `return 'cloud'` / `canonical = 'cloud'`; `SEAM_BAND_RATIO` last when present; no `default:` inside `CARD_BACK_IMAGES`).
5. `npx vitest run tests/unit/packArt.test.ts tests/integration/home.screen.test.tsx tests/integration/draw.screen.test.tsx tests/integration/draw-result.screen.test.tsx --reporter=dot` — 4 files pass; `packArt.test.ts` has ≥ 9 `it(` and the four new titles exist; the old `cardBackImageForSlug('ai')).toBeUndefined()` line is gone.
6. `npm run test:typecheck` — exit 0.
7. Scope + frozen guard: only the scope paths above (plus `docs/delivery/r16-issues/*`) differ from the merge-base; `csharp-back.png`, `gen_packs.py`, the frozen files and `package.json` are unchanged.

## Do NOT

- Do NOT replace `aws.png` (the owner's illustration lands at wave end, `docs/delivery-wave-1.6-plan-2026-09-19.md:99` — "放入 AWS 封面插画和音效文件（B12/B14 留了位置）"), `csharp-back.png`, or any existing pack cover; do NOT add a "seal" variant or any file not in the scope list.
- Do NOT call `pngquant`, `matplotlib`, `numpy`, `cairo`, system fonts by path, or the network from the scripts — and do NOT write those tool names in comments or docstrings either (the verify greps the bare words); do NOT hard-code an absolute output path; do NOT leave `scripts/__pycache__/` behind.
- Do NOT register `default` in `CARD_BACK_IMAGES`; do NOT change `cardBackImageForSlug`'s or `packImageForSlug`'s signature or their empty/null handling.
- Do NOT remove `includes('aws')` from the cloud branches; do NOT touch `PALETTES`, `CANONICAL_PALETTE_INDEX` values, `PAGE_GRADIENT_LIGHT`, `rarityHaloColor`, `rarityAccentColor`.
- Do NOT move or edit `export const SEAM_BAND_RATIO = 0.18;` if it is present (B06's line); do NOT add it yourself if absent.
- Do NOT edit `HomeScreen.tsx`, `DrawScreen.tsx`, `DrawResultScreen.tsx`, `DrawCeremonyScreen.tsx`, `assets/packs/README.md`, `vitest.config.ts`, or any other test than `packArt.test.ts`.
- Standing rules: no `git push`, no PR, never touch `main`, no `npm install`/`npm ci`/EAS/expo commands, no `.skip`/`.only`/`@ts-ignore`/`eslint-disable`, no tsconfig loosening.
