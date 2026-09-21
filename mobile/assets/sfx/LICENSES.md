# Ceremony SFX — per-file sources and licences
2026-09-21 (supersedes the 2026-09-20 placeholder table)

This file records the source and licence of every ceremony sound effect. As of
2026-09-21 every committed file is synthesised by `mobile/scripts/gen_sfx.py`
(stdlib only, deterministic) and released under **CC0** by the project — nothing
is sampled from any library. The per-name table below still lists all 17 names
that `SFX_ALIASES` (`mobile/src/components/ceremonyAudio.ts`) resolves, so a
sourced replacement for any single name can be recorded here without touching
the code's naming.

## Accepted / rejected licences

- Accepted: `CC0`; `CC-BY 4.0` (attribution text mandatory — copy it into the table
  below AND into the app's credits screen when one exists); `Sonniss` GDC bundles
  (record as `Sonniss royalty-free`, **not** `CC0`).
- Rejected: `CC-BY-NC`, `CC-BY-SA`, "free for personal use", and any unknown licence.
- Format: 44.1 kHz, 16-bit PCM WAV, peak-normalised to −1 dBFS, no clipping. Hits are
  mono and ≤ 2 s; the bed (`ambience.wav`) is stereo, exactly 8.000 s and must loop
  seamlessly (the generator verifies the seam numerically and refuses to write a file
  that fails).

## Committed files (seven, all project-synthesised, CC0)

| Path | Layer | Length | Character | Generator |
|---|---|---|---|---|
| `sfx/ambience.wav` | bed (loops) | 8.000 s stereo | filtered-noise pad + slow A-major shimmer partials, breathes once per loop, crossfaded seam | `mobile/scripts/gen_sfx.py` `make_ambience` |
| `sfx/rip.wav` | hit | 240 ms | paper tear: noise burst, band centre sweeping 4.2 kHz → 700 Hz, fibre crackle | `make_rip` |
| `sfx/whoosh.wav` | hit | 340 ms | band-passed noise sweep (rises to ~2.6 kHz, falls away) | `make_whoosh` |
| `sfx/card-flip.wav` | hit | 170 ms | two-part snap ~70 ms apart with a paper slide between | `make_card_flip` |
| `sfx/card-drop.wav` | hit | 160 ms | soft thud: 110 → 55 Hz sine drop + damped noise + small click | `make_card_drop` |
| `sfx/legendary.wav` | hit | 1.9 s | rising 3-note bell chord (A5 C#6 E6, inharmonic partials) with a long tail | `make_legendary` |
| `sfx/shimmer.wav` | hit / tail | 620 ms | glassy sparkle: fast high arpeggio (A6 → C#8) with airy top | `make_shimmer` |

Why the bed is 8 s: expo-audio implements `loop` as end-notification → seek → play,
which leaves a small gap at every loop point. The 2026-09-20 placeholder bed was a
0.25 s file, so that gap repeated four times a second — the "stutter" reported on
device. An 8 s file with an inaudible seam moves the gap to once per 8 s, and the pad
is at its quietest exactly there.

## Aliases (today's state)

`SFX_ALIASES` maps every one of the 17 ceremony names onto one of the seven files:
all four **bed** names (`crinkle`, `air`, `shimmer-pad`, `choir-swell`) loop
`ambience.wav` on one shared player (switching beds is a level ramp, never a restart);
`chime`, `sparkle-tail` and `soft-chime` play `shimmer.wav`; `stinger` plays
`legendary.wav`; `card-slide` and `stack-thud` play `card-drop.wav`; `seam-burst`
plays `rip.wav`; the rest map to their own file. To swap a sourced file in for one
name: drop it under this directory with the intended name (for example
`crinkle.wav`), change that name's entry in `SFX_ALIASES` to point at itself, add a
`require` in `loadSfxSources()`, fill the row below, then restart Metro with `-c`.

## Per-name table

| File | Layer | Plays at | Today (aliased to) | Source URL | Author | Licence | Attribution text | Processing |
|---|---|---|---|---|---|---|---|---|
| `crinkle.wav` | bed | swipe (finger on the pack) | `ambience.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `air.wav` | bed | approach/hold | `ambience.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `shimmer-pad.wav` | bed | hold (RAR) | `ambience.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `choir-swell.wav` | bed | hold (LEG) | `ambience.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `whoosh.wav` | hit | swipe/approach | `whoosh.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `rip.wav` | hit | tear-flip | `rip.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `card-slide.wav` | hit | spill | `card-drop.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `stack-thud.wav` | hit | tear-flip (multi) | `card-drop.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `seam-burst.wav` | hit | flash-reveal | `rip.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `card-flip.wav` | hit | tap-to-flip | `card-flip.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `card-drop.wav` | hit | spill/table | `card-drop.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `chime.wav` | hit | flash-reveal (RAR) / RAR flip | `shimmer.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `stinger.wav` | hit | flash-reveal (LEG) | `legendary.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `shimmer.wav` | hit | tell/settle | `shimmer.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `legendary.wav` | hit | LEG flip | `legendary.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `sparkle-tail.wav` | tail | settle (RAR/LEG) | `shimmer.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |
| `soft-chime.wav` | tail | Reduce Motion mount | `shimmer.wav` | project-synthesised | RecallSmith (`gen_sfx.py`) | CC0 | none required | generated |

Sourced replacements must keep to the accepted list above (`CC0`, `CC-BY` 4.0 with
attribution, `Sonniss royalty-free`); `CC-BY-NC` and `CC-BY-SA` stay rejected.
