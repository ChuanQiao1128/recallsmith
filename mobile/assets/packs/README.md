# Pack art

Every deck gets two PNGs, registered by canonical slug in
`src/theme/packArt.ts` (`PACK_IMAGES` / `CARD_BACK_IMAGES`; fuzzy manifest
slugs such as `aws-saa-c03`, `aws-saa-fundamentals` or `claude-ccdv-f` are
folded onto the canonical key by `canonicalPackSlug`, which also picks the
deck's palette, so cover, back and colours always switch together):

| file | what | size |
| --- | --- | --- |
| `<slug>.png` | pack cover (sealed foil booster look, brand at top, deck name at bottom) | 1024×1536, 2:3, opaque, ≤ 1.2 MB |
| `<slug>-back.png` | card back shown during the tap-to-flip ceremony | 400×560, 5:7, opaque, ≤ 200 KB |

Covers render with `resizeMode="contain"` everywhere: on Home / Welcome, in
the 240×336 DrawScreen pack, and in the ceremony (the fallback pack and the
featured card back), each on a black matte so the thin letterbox bars blend
into the art. Keep the pack filling the frame with a black surround like
`csharp.png` (no transparency — the black foil edge hides the bars either
way). Card backs render with `"cover"` inside a 10-px-radius gold-edged slot,
so a full-bleed border pattern is expected.

## Provenance

### Illustrated (live decks)

Original artwork for DeveloperCards; no third-party logos or wordmarks — the
deck name is set in our own lettering. The AWS, AWS Basics and Claude pairs
were generated on the owner's Canva account (Canva Content Licence,
project-owned). The C# pair was supplied by the owner in the v9 checkpoint
(`8edaecd`); its generator is not recorded in the repo.

| deck | files | source |
| --- | --- | --- |
| C# | `csharp.png`, `csharp-back.png` | owner-supplied, checkpoint `8edaecd` (1024×1536 both) |
| AWS (`aws-saa-c03`) | `aws.png` | Canva AI design `DAHV00gWPmQ` — "sealed foil booster pack, luminous cloud citadel of stacked amber hexagon tiers in navy storm clouds, gold filigree border, DeveloperCards / AWS lettering". Exported PNG 1024×1536, then `scripts/packart/finish_canva_covers.py` (crop to the pack silhouette + 2:3, 256-colour median-cut with Floyd–Steinberg). |
| AWS | `aws-back.png` | Canva AI design `DAHV0xOTx6s` — navy velvet, gold filigree corners, central rosette medallion with AWS monogram. Exported 1024×1536, centre-cropped to 5:7, Lanczos → 400×560, quantised. |
| Claude (`claude-ccdv-f`) | `claude.png` | Canva AI design `DAHV03XulAM` — sealed foil booster pack, coral eight-point starburst over plum dusk with paper lanterns, gold filigree border. Canva left out the brand line and set the deck name too small, so the script inpaints the original word and re-letters **DeveloperCards** (72 px) and **Claude** (138 px) in Cochin Bold with a gold gradient, matching the other covers. Then the same crop/quantise pass. |
| Claude | `claude-back.png` | Canva AI design `DAHV09xO_6U` — plum velvet, gold filigree corners, medallion holding a coral starburst, "Claude" beneath. Same 5:7 crop → 400×560 pipeline. |
| AWS Basics (`aws-saa-fundamentals`) | `aws-basics.png` | 2026-10-18 AWS Basics cover. Canva AI design `DAHYS85MkV4` ("first steps") — sealed foil booster pack, glowing jade stone stairway climbing a misty green mountainside to a pale-gold sunrise, gold filigree border with a jade gem top and bottom. Canva's own "AWS Basics" ran into the corner filigree, so the export is the text-free copy `DAHYS0kAJGw` (the two text layers deleted, nothing else changed) and the script letters **DeveloperCards** (72 px) and **AWS Basics** (112 px, which keeps it at least 54 px clear of the filigree) in Cochin Bold with the Claude cover's gold gradient, then crops to the pack silhouette + 2:3 and quantises (256-colour median-cut, Floyd–Steinberg): 572 KB. Palette 6 in `packArt.ts` is sampled from it. |
| AWS Basics | `aws-basics-back.png` | Canva AI design `DAHYS_3p_n0` ("AWS Basics trading card back") — deep jade velvet, gold double-line frame, gold scroll corners, central ring medallion holding the jade stairway and sunrise, "AWS Basics" beneath (Canva serif). Centre-cropped to 5:7 (this trims the frame's top and bottom rules, as on the Claude back), Lanczos → 400×560, quantised: 188 KB. |

Flat-card (non-foil) first drafts of both covers exist as Canva designs
`DAHV07ruWro` (AWS) and `DAHV06nH7S0` (Claude) if the foil wrapper is ever
dropped from the family.

To regenerate: export the designs above as PNG 1024×1536 into a scratch
folder as `aws-foil-full.png` / `claude-foil1-full.png` /
`aws-basics-foil-full.png` (from `DAHYS0kAJGw`) and `aws-back-full.png` /
`claude-back-full.png` / `aws-basics-back-full.png`, then run
`python3 <repo>/mobile/scripts/packart/finish_canva_covers.py [slug ...]`
from that folder (slugs `aws`, `claude`, `aws-basics`; default all; needs
Pillow and the macOS system font `Cochin.ttc`; do not run it with
`python3 -I`, it imports `letter.py` from its own folder). Each pack comes
out as a quantised `<slug>.png` + `<slug>-back.png` to copy here. The cover
crop boxes and lettering positions are measured per export, so a new export
needs them re-measured.

### Placeholders (gen_packs.py)

`ai.png`, `cloud.png`, `premium-deck.png`, `default.png` (400×580) and their
`-back.png` files are procedural placeholders from `scripts/gen_packs.py` /
`scripts/gen_card_back.py`. They are still registered so those slugs resolve,
but they are not in the illustrated family and should be replaced the same way
before any of those decks go live.
