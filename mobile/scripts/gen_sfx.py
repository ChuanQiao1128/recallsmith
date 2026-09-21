#!/usr/bin/env python3
"""Generate the ceremony SFX set procedurally (stdlib only: wave + math + random).

Output (mobile/assets/sfx/, 44.1 kHz, 16-bit PCM, peak-normalised to -1 dBFS):

  ambience.wav   8 s STEREO seamless loop — filtered-noise pad + slow shimmer
                 partials. The tail is crossfaded into the head so the loop point
                 is inaudible; the script verifies the seam numerically (see
                 verify_loop_seam) and refuses to write a file that fails.
  rip.wav        paper tear: noise burst, band centre sweeping down, fibre crackle
  whoosh.wav     band-passed noise sweep (rises, then falls away)
  card-flip.wav  two-part snap (two short transients ~70 ms apart)
  card-drop.wav  soft thud (low sine drop + damped noise + small click)
  legendary.wav  rising 3-note bell chord (inharmonic partials) with a long tail
  shimmer.wav    short glassy sparkle (fast high arpeggio) — the 'chime' / tail hit

The hits are mono. Every file is deterministic (seeded PRNG), so re-running the
script reproduces byte-identical output. Nothing here is sampled from any
library: all seven files are project-synthesised and released under CC0
(see mobile/assets/sfx/LICENSES.md).

Run:  python3 mobile/scripts/gen_sfx.py
"""
import math
import os
import random
import sys
import wave
from array import array

SR = 44100
PEAK_DBFS = -1.0
PEAK = 10 ** (PEAK_DBFS / 20)  # 0.891
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sfx'))

# ── WAV I/O ────────────────────────────────────────────────────────────────


def normalise(channels):
    """Scale every channel by one common factor so the loudest sample hits PEAK."""
    peak = max((abs(s) for ch in channels for s in ch), default=0.0) or 1.0
    k = PEAK / peak
    return [[s * k for s in ch] for ch in channels]


def write_wav(name, channels):
    """channels: list of float lists in [-1, 1] (1 = mono, 2 = stereo). Normalises, clips, writes."""
    channels = normalise(channels)
    n = len(channels[0])
    for ch in channels:
        assert len(ch) == n, 'channel length mismatch'
    pcm = array('h')
    clipped = 0
    for i in range(n):
        for ch in channels:
            s = ch[i]
            if s > 1.0:
                s = 1.0
                clipped += 1
            elif s < -1.0:
                s = -1.0
                clipped += 1
            pcm.append(int(round(s * 32767)))
    assert clipped == 0, f'{name}: {clipped} samples clipped after normalisation'
    if sys.byteorder != 'little':
        pcm.byteswap()
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(len(channels))
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'  wrote {name:14s} {n / SR * 1000:7.0f} ms  {len(channels)} ch  {os.path.getsize(path) / 1024:6.0f} KB')


# ── Building blocks ────────────────────────────────────────────────────────


def zeros(n):
    return [0.0] * n


def noise(n, seed):
    rng = random.Random(seed)
    u = rng.uniform
    return [u(-1.0, 1.0) for _ in range(n)]


def one_pole_lp(x, alpha):
    """alpha may be a float or a per-sample list (0..1; higher = brighter)."""
    out = zeros(len(x))
    y = 0.0
    if isinstance(alpha, float):
        a = alpha
        for i, s in enumerate(x):
            y += a * (s - y)
            out[i] = y
    else:
        for i, s in enumerate(x):
            y += alpha[i] * (s - y)
            out[i] = y
    return out


def one_pole_hp(x, alpha):
    out = zeros(len(x))
    y = 0.0
    prev = 0.0
    for i, s in enumerate(x):
        y = alpha * (y + s - prev)
        prev = s
        out[i] = y
    return out


def biquad_bp(x, centre_hz, q):
    """RBJ constant-skirt band-pass. centre_hz: float or per-sample list (a sweep)."""
    out = zeros(len(x))
    x1 = x2 = y1 = y2 = 0.0
    sweep = not isinstance(centre_hz, float)
    if not sweep:
        w0 = 2 * math.pi * centre_hz / SR
        alpha = math.sin(w0) / (2 * q)
        b0 = alpha
        b2 = -alpha
        a0 = 1 + alpha
        a1 = -2 * math.cos(w0)
        a2 = 1 - alpha
        nb0, nb2, na1, na2 = b0 / a0, b2 / a0, a1 / a0, a2 / a0
    for i, s in enumerate(x):
        if sweep:
            w0 = 2 * math.pi * centre_hz[i] / SR
            alpha = math.sin(w0) / (2 * q)
            a0 = 1 + alpha
            nb0 = alpha / a0
            nb2 = -alpha / a0
            na1 = -2 * math.cos(w0) / a0
            na2 = (1 - alpha) / a0
        y = nb0 * s + nb2 * x2 - na1 * y1 - na2 * y2
        x2, x1 = x1, s
        y2, y1 = y1, y
        out[i] = y
    return out


def biquad_lp(x, cutoff_hz, q=0.7071):
    """RBJ second-order low-pass (12 dB/oct)."""
    w0 = 2 * math.pi * cutoff_hz / SR
    alpha = math.sin(w0) / (2 * q)
    cw = math.cos(w0)
    a0 = 1 + alpha
    b0 = (1 - cw) / 2 / a0
    b1 = (1 - cw) / a0
    b2 = b0
    a1 = -2 * cw / a0
    a2 = (1 - alpha) / a0
    out = zeros(len(x))
    x1 = x2 = y1 = y2 = 0.0
    for i, s in enumerate(x):
        y = b0 * s + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, s
        y2, y1 = y1, y
        out[i] = y
    return out


def env_ad(n, attack_s, decay_pow=2.0, hold_s=0.0):
    """Attack (linear) → optional hold → decay ((1-t)^pow) envelope over n samples."""
    a = max(1, int(attack_s * SR))
    h = int(hold_s * SR)
    out = zeros(n)
    for i in range(n):
        if i < a:
            out[i] = i / a
        elif i < a + h:
            out[i] = 1.0
        else:
            t = (i - a - h) / max(1, n - a - h)
            out[i] = (1 - t) ** decay_pow
    return out


def env_exp(n, tau_s, attack_s=0.002):
    """Exponential decay with a short linear attack."""
    a = max(1, int(attack_s * SR))
    out = zeros(n)
    for i in range(n):
        d = math.exp(-i / (tau_s * SR))
        out[i] = d * (i / a if i < a else 1.0)
    return out


def sine(freq, n, amp=1.0, phase=0.0, vibrato_hz=0.0, vibrato_depth=0.0):
    out = zeros(n)
    ph = phase
    two_pi = 2 * math.pi
    for i in range(n):
        f = freq
        if vibrato_hz:
            f = freq * (1 + vibrato_depth * math.sin(two_pi * vibrato_hz * i / SR))
        ph += two_pi * f / SR
        out[i] = amp * math.sin(ph)
    return out


def mul(x, env):
    return [a * b for a, b in zip(x, env)]


def gain(x, g):
    return [s * g for s in x]


def mix(*tracks):
    n = max(len(t) for t in tracks)
    out = zeros(n)
    for t in tracks:
        for i, s in enumerate(t):
            out[i] += s
    return out


def place(track, at_s, total_n):
    """Return a total_n buffer with `track` starting at `at_s` seconds."""
    out = zeros(total_n)
    start = int(at_s * SR)
    for i, s in enumerate(track):
        j = start + i
        if j >= total_n:
            break
        out[j] = s
    return out


def lin_sweep(n, f0, f1, curve=1.0):
    return [f0 + (f1 - f0) * ((i / max(1, n - 1)) ** curve) for i in range(n)]


def bell(freq, n, tau_s, amp=1.0, seed=0):
    """A bell: inharmonic partial set with faster decay for higher partials."""
    partials = [(1.0, 1.0), (2.0, 0.55), (2.76, 0.35), (3.9, 0.22), (5.4, 0.12), (6.8, 0.07)]
    out = zeros(n)
    rng = random.Random(seed)
    for ratio, a in partials:
        det = 1 + rng.uniform(-0.0015, 0.0015)
        tau = tau_s / (1 + 0.55 * (ratio - 1))
        part = mul(sine(freq * ratio * det, n, a * amp, phase=rng.uniform(0, 6.28)), env_exp(n, tau, attack_s=0.003))
        out = mix(out, part)
    return out


# ── Ambience loop ──────────────────────────────────────────────────────────

LOOP_S = 8.0
LOOP_N = int(LOOP_S * SR)
XFADE_S = 1.0
XFADE_N = int(XFADE_S * SR)
SEAM_CHECK_MS = 50


def make_ambience_channel(seed, detune, pan_partial_gain):
    """One channel of the pad, LOOP_N + XFADE_N long (the extra tail is folded into the head)."""
    n = LOOP_N + XFADE_N
    two_pi = 2 * math.pi
    # LFO periods divide LOOP_S so the texture at t=8 s continues the texture at t=0.
    # Slow "breath": the pad is quietest at the loop point (masks the player's seek/play gap).
    breath = [0.62 + 0.38 * (0.5 - 0.5 * math.cos(two_pi * i / LOOP_N)) for i in range(n)]
    # Filtered noise bed: white → one-pole LP whose cutoff wanders slowly (4 s period).
    raw = noise(n, seed)
    alpha = [0.012 + 0.010 * (0.5 + 0.5 * math.sin(two_pi * 2 * i / LOOP_N + seed)) for i in range(n)]
    bed = one_pole_lp(raw, alpha)
    bed = mul(bed, breath)
    # Airy high band ("breath" of the pad), very quiet: noise → 2-pole LP → band-pass ~2 kHz.
    air = biquad_bp(biquad_lp(noise(n, seed + 101), 3200.0), 2000.0, 1.6)
    air_lfo = [0.5 + 0.5 * math.sin(two_pi * 1 * i / LOOP_N + 1.3 + seed) for i in range(n)]
    air = gain(mul(mul(air, air_lfo), breath), 0.02)
    # Shimmer partials: an A-major spread (A3 E4 A4 C#5 E5 A5), each with its own
    # amplitude LFO (periods 8/4/2/8/4/8 s) and slow vibrato; slightly detuned per channel.
    chord = [(220.0, 0.16, 1), (329.63, 0.11, 2), (440.0, 0.10, 4), (554.37, 0.07, 1), (659.25, 0.06, 2), (880.0, 0.045, 1)]
    partials = zeros(n)
    rng = random.Random(seed + 7)
    for k, (f, a, cycles) in enumerate(chord):
        lfo = [0.35 + 0.65 * (0.5 + 0.5 * math.sin(two_pi * cycles * i / LOOP_N + rng.uniform(0, 6.28))) for i in range(n)]
        tone = sine(f * (1 + detune * (k % 2 * 2 - 1)), n, a * pan_partial_gain, phase=rng.uniform(0, 6.28), vibrato_hz=0.25 + 0.05 * k, vibrato_depth=0.0025)
        partials = mix(partials, mul(tone, lfo))
    partials = mul(partials, breath)
    # Final 2-pole LP keeps the whole pad dark (nothing above ~5 kHz survives).
    return biquad_lp(mix(bed, gain(partials, 0.55), air), 4800.0)


def fold_loop(ch):
    """Crossfade the extra tail into the head (equal-power) so wrap-around is continuous."""
    loop = ch[:LOOP_N]
    tail = ch[LOOP_N:LOOP_N + XFADE_N]
    for i in range(XFADE_N):
        t = i / XFADE_N
        a = math.cos(t * math.pi / 2)  # tail: 1 → 0
        b = math.sin(t * math.pi / 2)  # head: 0 → 1
        loop[i] = a * tail[i] + b * loop[i]
    return loop


def verify_loop_seam(channels):
    """Numeric seam check on the normalised loop. Prints the metrics and returns True/False.

    1. The wrap step |L[0] - L[N-1]| must sit inside the ordinary sample-to-sample motion
       of the last 50 ms (≤ 3 × its 99th-percentile step), i.e. there is no click at the seam.
    2. The RMS of the first 50 ms and the last 50 ms must agree within 25 %: the texture
       on both sides of the seam is the same texture.
    """
    ok = True
    m = int(SEAM_CHECK_MS / 1000 * SR)
    for idx, ch in enumerate(normalise(channels)):
        head = ch[:m]
        tail = ch[-m:]
        steps = sorted(abs(tail[i] - tail[i - 1]) for i in range(1, m))
        p99 = steps[int(0.99 * (len(steps) - 1))]
        wrap = abs(ch[0] - ch[-1])
        rms = lambda xs: math.sqrt(sum(s * s for s in xs) / len(xs))  # noqa: E731
        rh, rt = rms(head), rms(tail)
        ratio = rh / rt if rt > 0 else float('inf')
        step_ok = wrap <= 3 * p99
        rms_ok = 0.75 <= ratio <= 1.25
        print(f'  seam ch{idx}: wrap step {wrap:.5f} (p99 step {p99:.5f}) {"ok" if step_ok else "FAIL"};'
              f' rms head {rh:.4f} / tail {rt:.4f} = {ratio:.3f} {"ok" if rms_ok else "FAIL"}')
        ok = ok and step_ok and rms_ok
    return ok


def make_ambience():
    left = fold_loop(make_ambience_channel(seed=11, detune=+0.0008, pan_partial_gain=1.0))
    right = fold_loop(make_ambience_channel(seed=23, detune=-0.0008, pan_partial_gain=0.94))
    assert verify_loop_seam([left, right]), 'ambience loop seam check failed'
    return [left, right]


# ── Hits ───────────────────────────────────────────────────────────────────


def make_rip():
    n = int(SR * 0.24)
    centre = lin_sweep(n, 4200.0, 700.0, curve=0.6)
    body = biquad_bp(noise(n, 31), centre, 0.9)
    body = mul(body, env_ad(n, 0.004, decay_pow=1.6))
    # Fibre crackle: sparse impulses, denser at the start, each a tiny HP click.
    rng = random.Random(32)
    crackle = zeros(n)
    i = 0
    while i < n:
        crackle[i] = rng.uniform(0.4, 1.0) * (1 if rng.random() < 0.5 else -1)
        i += int(rng.uniform(60, 60 + 900 * (i / n)))
    crackle = mul(one_pole_hp(crackle, 0.9), env_ad(n, 0.002, decay_pow=1.2))
    return [mix(body, gain(crackle, 0.55))]


def make_whoosh():
    n = int(SR * 0.34)
    centre = [500 + 2100 * math.sin(math.pi * (i / n) ** 0.8) for i in range(n)]
    body = biquad_bp(noise(n, 41), centre, 1.1)
    env = [math.sin(math.pi * (i / n) ** 0.7) ** 1.3 for i in range(n)]
    body = mul(body, env)
    low = mul(one_pole_lp(noise(n, 42), 0.05), env)
    return [mix(body, gain(low, 0.5))]


def snap(n_s, centre, seed, ping_hz, ping_amp):
    n = int(SR * n_s)
    click = mul(biquad_bp(noise(n, seed), centre, 2.5), env_exp(n, 0.006, attack_s=0.0006))
    ping = mul(sine(ping_hz, n, ping_amp), env_exp(n, 0.012, attack_s=0.0006))
    return mix(click, ping)


def make_card_flip():
    total = int(SR * 0.17)
    first = snap(0.05, 3200.0, 51, 1900.0, 0.35)
    second = snap(0.09, 2200.0, 52, 1300.0, 0.3)
    # Paper slide between the two snaps.
    slide_n = int(SR * 0.07)
    slide = gain(mul(biquad_bp(noise(slide_n, 53), 5200.0, 0.8), env_ad(slide_n, 0.01, decay_pow=1.5)), 0.18)
    return [mix(place(first, 0.0, total), place(slide, 0.012, total), place(gain(second, 0.9), 0.072, total))]


def make_card_drop():
    n = int(SR * 0.16)
    drop = zeros(n)
    # Pitch-dropping sine (110 → 55 Hz) gives the "weight".
    ph = 0.0
    for i in range(n):
        f = 55 + 55 * math.exp(-i / (0.03 * SR))
        ph += 2 * math.pi * f / SR
        drop[i] = math.sin(ph)
    drop = mul(drop, env_exp(n, 0.045, attack_s=0.001))
    body = mul(one_pole_lp(noise(n, 61), 0.08), env_exp(n, 0.03, attack_s=0.001))
    click = mul(biquad_bp(noise(int(SR * 0.02), 62), 1800.0, 1.5), env_exp(int(SR * 0.02), 0.004, attack_s=0.0005))
    return [mix(gain(drop, 0.9), gain(body, 0.5), place(gain(click, 0.25), 0.0, n))]


def make_legendary():
    n = int(SR * 1.9)
    notes = [(880.0, 0.00, 1), (1108.73, 0.13, 2), (1318.51, 0.26, 3)]  # A5, C#6, E6 — rising
    out = zeros(n)
    for f, at, seed in notes:
        b = bell(f, n - int(at * SR), tau_s=0.55, amp=0.5, seed=seed)
        out = mix(out, place(b, at, n))
    # Sub-octave glow under the chord + an airy tail.
    glow = mul(sine(440.0, n, 0.18, vibrato_hz=4.5, vibrato_depth=0.003), env_ad(n, 0.28, decay_pow=1.4))
    air = gain(mul(biquad_bp(noise(n, 71), 6500.0, 1.0), env_ad(n, 0.2, decay_pow=1.2)), 0.05)
    return [mix(out, glow, air)]


def make_shimmer():
    n = int(SR * 0.62)
    freqs = [1760.0, 2217.46, 2637.02, 3520.0, 4434.92]  # A6 C#7 E7 A7 C#8
    out = zeros(n)
    for k, f in enumerate(freqs):
        at = 0.022 * k
        m = n - int(at * SR)
        tone = mul(sine(f, m, 0.35 - 0.04 * k), env_exp(m, 0.14 + 0.02 * k, attack_s=0.002))
        out = mix(out, place(tone, at, n))
    air = gain(mul(biquad_bp(noise(n, 81), 8000.0, 0.9), env_ad(n, 0.02, decay_pow=1.5)), 0.05)
    return [mix(out, air)]


# ── Main ───────────────────────────────────────────────────────────────────


def main():
    os.makedirs(OUT, exist_ok=True)
    print(f'Generating ceremony SFX into {OUT}')
    print('ambience (8 s stereo loop) …')
    write_wav('ambience.wav', make_ambience())
    write_wav('rip.wav', make_rip())
    write_wav('whoosh.wav', make_whoosh())
    write_wav('card-flip.wav', make_card_flip())
    write_wav('card-drop.wav', make_card_drop())
    write_wav('legendary.wav', make_legendary())
    write_wav('shimmer.wav', make_shimmer())
    print('done.')


if __name__ == '__main__':
    main()
