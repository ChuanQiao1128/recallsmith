# Pack art

Every deck gets two PNGs, registered by canonical slug in
`src/theme/packArt.ts` (`PACK_IMAGES` / `CARD_BACK_IMAGES`; fuzzy manifest
slugs such as `aws-saa-c03` or `claude-ccdv-f` are folded onto the canonical
key by `canonicalPackSlug`):

| file | what | size |
| --- | --- | --- |
| `<slug>.png` | pack cover (sealed foil booster look, brand at top, deck name at bottom) | 1024×1536, 2:3, opaque, ≤ 1.2 MB |
| `<slug>-back.png` | card back shown during the tap-to-flip ceremony | 400×560, 5:7, opaque, ≤ 200 KB |

Covers render with `resizeMode="contain"` on Home / Welcome and `"cover"` in
the 240×336 DrawScreen pack, so keep the pack filling the frame with a black
surround like `csharp.png` (no transparency — the black foil edge hides the
crop either way). Card backs render with `"cover"` inside a 10-px-radius
gold-edged slot, so a full-bleed border pattern is expected.

## Provenance

### Illustrated (live decks)

Original artwork for DeveloperCards; no third-party logos or wordmarks — the
deck name is set in our own lettering. The AWS and Claude pairs were generated
on the owner's Canva account (Canva Content Licence, project-owned). The C#
pair was supplied by the owner in the v9 checkpoint (`8edaecd`); its generator
is not recorded in the repo.

| deck | files | source |
| --- | --- | --- |
| C# | `csharp.png`, `csharp-back.png` | owner-supplied, checkpoint `8edaecd` (1024×1536 both) |
| AWS (`aws-saa-c03`) | `aws.png` | Canva AI design `DAHV00gWPmQ` — "sealed foil booster pack, luminous cloud citadel of stacked amber hexagon tiers in navy storm clouds, gold filigree border, DeveloperCards / AWS lettering". Exported PNG 1024×1536, then `scripts/packart/finish_canva_covers.py` (crop to the pack silhouette + 2:3, 256-colour median-cut with Floyd–Steinberg). |
| AWS | `aws-back.png` | Canva AI design `DAHV0xOTx6s` — navy velvet, gold filigree corners, central rosette medallion with AWS monogram. Exported 1024×1536, centre-cropped to 5:7, Lanczos → 400×560, quantised. |
| Claude (`claude-ccdv-f`) | `claude.png` | Canva AI design `DAHV03XulAM` — sealed foil booster pack, coral eight-point starburst over plum dusk with paper lanterns, gold filigree border. Canva left out the brand line and set the deck name too small, so the script inpaints the original word and re-letters **DeveloperCards** (72 px) and **Claude** (138 px) in Cochin Bold with a gold gradient, matching the other covers. Then the same crop/quantise pass. |
| Claude | `claude-back.png` | Canva AI design `DAHV09xO_6U` — plum velvet, gold filigree corners, medallion holding a coral starburst, "Claude" beneath. Same 5:7 crop → 400×560 pipeline. |

Flat-card (non-foil) first drafts of both covers exist as Canva designs
`DAHV07ruWro` (AWS) and `DAHV06nH7S0` (Claude) if the foil wrapper is ever
dropped from the family.

To regenerate: export the design above as PNG 1024×1536 into a scratch
folder as `aws-foil-full.png` / `claude-foil1-full.png` /
`aws-back-full.png` / `claude-back-full.png`, then run
`python3 scripts/packart/finish_canva_covers.py` from that folder (needs
Pillow and the macOS system font `Cochin.ttc`).

### Placeholders (gen_packs.py)

`ai.png`, `cloud.png`, `premium-deck.png`, `default.png` (400×580) and their
`-back.png` files are procedural placeholders from `scripts/gen_packs.py` /
`scripts/gen_card_back.py`. They are still registered so those slugs resolve,
but they are not in the illustrated family and should be replaced the same way
before any of those decks go live.
