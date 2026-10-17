Post-processing for the Canva-generated pack covers and card backs.
See `assets/packs/README.md` for the design ids and the exact steps.

- `finish_canva_covers.py` — per pack (`aws`, `claude`, `aws-basics`): crops
  the exported foil-pack render to the pack silhouette at 2:3 (1024×1536),
  re-letters the Claude cover (inpainting the original word first) and the
  text-free AWS Basics cover, centre-crops the card back to 5:7 and resizes
  it to 400×560, then quantises both to 256 colours (median-cut,
  Floyd–Steinberg) as `<slug>.png` / `<slug>-back.png`, ready to commit.
- `letter.py` — gold-gradient serif lettering helper (Cochin Bold on macOS).
