Post-processing for the Canva-generated pack covers and card backs.
See `assets/packs/README.md` for the design ids and the exact steps.

- `finish_canva_covers.py` — crops the exported foil-pack renders to the pack
  silhouette at 2:3 (1024×1536), inpaints + re-letters the Claude cover, and
  writes `*-cover-rgb.png`; quantise the result to 256 colours before
  committing (see the README).
- `letter.py` — gold-gradient serif lettering helper (Cochin Bold on macOS).
