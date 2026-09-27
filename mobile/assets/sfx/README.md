# Ceremony SFX + Haptics + Skia install

Three optional libraries unlock the commercial-grade ceremony layer. Each is
guarded — without it the app keeps working, just less polished.

## One-time install (all three)

```bash
cd mobile

npx expo install expo-audio        # audio
npx expo install expo-haptics      # vibration
npx expo install @shopify/react-native-skia   # GPU stage light + pack tear

npx expo prebuild --clean          # regenerates ios/ + android/
# Then rebuild your dev client:
#   npx expo run:ios
#   npx expo run:android
```

After rebuild, all three layers automatically activate. No code changes needed.

## What each one does

| Library | When it fires | Effect |
|---|---|---|
| `expo-audio` | the charge / tear / burst / hero flyout + flip | eight one-shot hits, no bed or loop (see below) |
| `expo-haptics` | the three charge pulses / tear / LEG flash | tick (light), impact (light/medium/heavy), success (notification pattern) |
| `@shopify/react-native-skia` | the whole ceremony stage | dark stage / rays / halo / seam leak in one canvas, the full-screen burst in another, the hero light pillar on the spotlight |

## SFX files (v2, eight, Kenney CC0 under `sfx/v2/`)

As of release 1.7.0 the app loads only the v2 set — every ceremony sound is a one-shot hit
that plays its own file 1:1. **There is no bed, loop, ducking or tail any more.**

| File | Cue | Phase | Gain |
|---|---|---|---|
| `v2/charge.wav` | `charge` (three plucks at 0 / 350 / 700 ms) | approach start — pulses through hold | 0.9 |
| `v2/tear.wav` | `tear` | tear-flip start | 0.9 |
| `v2/burst.wav` | `burst` | flash-reveal (the full-screen burst) | 0.7 |
| `v2/flyout.wav` | `flyout` | spill (multi) / the hero flying out of the spotlight | 0.8 |
| `v2/flip.wav` | `flip` | the card flip start | 0.9 |
| `v2/stinger-com.wav` | `stinger-com` | the Common flip midpoint | 0.8 |
| `v2/stinger-rar.wav` | `stinger-rar` | the Rare flip midpoint | 0.9 |
| `v2/stinger-leg.wav` | `stinger-leg` | the Legendary flip midpoint | 1.0 |

All v2 files: 44.1 kHz, 16-bit PCM, mono, peak ≤ −1 dBFS, loudness-matched per role.
Licence: Kenney, CC0 — see `LICENSES.md`. The old v1 files and `gen_sfx.py` stay on disk but
are no longer referenced by the app.

### Player model (`mobile/src/components/ceremonyAudio.ts`)

- `warmUp()` (alias `prewarm()`) creates every player up front: DrawScreen calls it
  while the player is choosing a pack, DrawCeremonyScreen calls it again at mount.
  No player is created during the timeline once the set is warm.
- Hits play from a pool of two players per file: a retrigger inside a sound's tail
  takes the idle player instead of seeking the one that is still sounding.
- There is no looping bed player: every call is `hit(name)`, a one-shot.
- Each hit's JS-side trigger latency lands in the ceremony perf report
  (Settings → tap the version label 7 times → Debug menu → "Last ceremony report").

## Regenerate

```bash
python3 mobile/scripts/gen_sfx.py    # stdlib only, ~6 s, byte-identical output
npx expo start -c                    # clear Metro's asset cache
```

The generator verifies the ambience seam numerically (wrap step vs. ordinary
sample motion, head/tail RMS within 25 %) and aborts instead of writing a file that
would click at the loop point.

## How to swap in a sourced sample

1. Drop the `.wav` in `mobile/assets/sfx/` under the ceremony name it replaces
   (for example `crinkle.wav`).
2. Add a guarded `require` for it in `loadSfxSources()` and point that name's
   `SFX_ALIASES` entry at itself.
3. Record source / author / licence in `LICENSES.md` (CC0, CC-BY 4.0 with attribution,
   or Sonniss royalty-free only).
4. Restart Metro with cache clear: `npx expo start -c`.

Keep hits under ~1 s except `legendary.wav` (≤ 2 s); a bed must loop cleanly and be
at least several seconds long (see above).

## Troubleshooting

- **App still silent after install**: confirm `expo-audio` resolved by running
  `node -e "console.log(require('expo-audio').createAudioPlayer)"` in mobile/
- **Crash with "Native module not registered"**: forgot to run `expo prebuild`
  + rebuild dev client. Just installing the JS package isn't enough.
- **Skia stage doesn't render**: confirm with
  `node -e "console.log(require('@shopify/react-native-skia').Canvas)"`
- **Bed still gaps**: check the ceremony perf report's audio lines and that
  `ambience.wav` is 8.000 s / stereo (`python3 -c "import wave;w=wave.open('mobile/assets/sfx/ambience.wav');print(w.getnchannels(),w.getnframes()/w.getframerate())"`).
