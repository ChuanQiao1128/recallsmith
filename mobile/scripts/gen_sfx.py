"""Generate 6 placeholder SFX WAV files for the ceremony screen.

Each is short (50-300ms), distinct timbre. They prove the audio pipeline works
end-to-end so you can swap them with real freesound.org files later.

Output: mobile/assets/sfx/{whoosh,rip,card-drop,card-flip,shimmer,legendary}.wav
"""
import math
import os
import struct
import wave
import random

SR = 44100   # sample rate
OUT = "/sessions/compassionate-kind-babbage/mnt/DeveloperCards/recallSmith/mobile/assets/sfx"
os.makedirs(OUT, exist_ok=True)

def write_wav(path, samples_float, sr=SR):
    """Write mono 16-bit PCM WAV from a list of floats in [-1, 1]."""
    # Soft-clip + normalise
    peak = max(abs(s) for s in samples_float) or 1.0
    samples_float = [s / peak * 0.9 for s in samples_float]
    pcm = b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples_float)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    print(f"  wrote {os.path.basename(path)}  {len(samples_float)/sr*1000:.0f}ms")

def env_ad(n_samples, attack_frac=0.05, decay_pow=2.0):
    """Attack-decay envelope, peaks early then decays."""
    out = []
    a = max(1, int(n_samples * attack_frac))
    for i in range(n_samples):
        if i < a:
            out.append(i / a)
        else:
            t = (i - a) / max(1, n_samples - a)
            out.append((1 - t) ** decay_pow)
    return out

def noise(n, seed=42):
    rng = random.Random(seed)
    return [rng.uniform(-1, 1) for _ in range(n)]

def lowpass(samples, alpha=0.3):
    """One-pole LP filter to soften noise."""
    out = [samples[0]]
    for s in samples[1:]:
        out.append(out[-1] + alpha * (s - out[-1]))
    return out

def highpass(samples, alpha=0.95):
    out = [0]
    prev = samples[0]
    for s in samples[1:]:
        out.append(alpha * (out[-1] + s - prev))
        prev = s
    return out

def tone(freq_hz, n_samples, sr=SR, harmonics=(1.0,), freq_drift=0):
    """Sine sum with optional harmonics + linear pitch drift."""
    out = []
    phase = [0.0] * len(harmonics)
    for i in range(n_samples):
        t = i / sr
        f = freq_hz + freq_drift * (i / n_samples)
        s = 0.0
        for hi, amp in enumerate(harmonics):
            phase[hi] += 2 * math.pi * f * (hi + 1) / sr
            s += amp * math.sin(phase[hi])
        out.append(s / sum(harmonics))
    return out

def mix(*tracks):
    n = max(len(t) for t in tracks)
    out = [0.0] * n
    for t in tracks:
        for i, s in enumerate(t):
            out[i] += s
    return out

def apply_envelope(samples, env):
    return [s * e for s, e in zip(samples, env)]

# ── 1) whoosh — 200ms swept noise (pack approaching) ──────────────────────
def make_whoosh():
    n = int(SR * 0.20)
    base = lowpass(noise(n, seed=1), alpha=0.18)  # rumbly
    # Pitch sweep: high to low using two LPs cascading
    swept = base
    for _ in range(3):
        swept = lowpass(swept, alpha=0.25)
    env = env_ad(n, attack_frac=0.20, decay_pow=2.5)
    return apply_envelope(swept, env)

# ── 2) rip — 120ms harsh noise burst (pack tearing) ──────────────────────
def make_rip():
    n = int(SR * 0.12)
    crackle = highpass(noise(n, seed=2), alpha=0.97)
    # Add some tonal bite
    bite = tone(180, n, harmonics=(1.0, 0.4, 0.2))
    mixed = mix(crackle, [b * 0.3 for b in bite])
    env = env_ad(n, attack_frac=0.02, decay_pow=2.8)
    return apply_envelope(mixed, env)

# ── 3) card-drop — 80ms thud + tonal click ───────────────────────────────
def make_card_drop():
    n = int(SR * 0.08)
    thud = lowpass(noise(n, seed=3), alpha=0.10)
    click = tone(140, n, harmonics=(1.0, 0.5))
    mixed = mix([t * 0.7 for t in thud], [c * 0.4 for c in click])
    env = env_ad(n, attack_frac=0.05, decay_pow=4.0)
    return apply_envelope(mixed, env)

# ── 4) card-flip — 100ms swooshy paper flip ──────────────────────────────
def make_card_flip():
    n = int(SR * 0.10)
    paper = highpass(noise(n, seed=4), alpha=0.85)
    paper = lowpass(paper, alpha=0.50)
    bell = tone(880, n, harmonics=(1.0, 0.3))
    mixed = mix([p * 0.6 for p in paper], [b * 0.3 for b in bell])
    env = env_ad(n, attack_frac=0.10, decay_pow=2.5)
    return apply_envelope(mixed, env)

# ── 5) shimmer — 250ms magical arpeggio (rare card glow) ─────────────────
def make_shimmer():
    n = int(SR * 0.25)
    base_freqs = [880, 1108, 1318, 1760]  # A5, C#6, E6, A6
    layers = []
    for i, f in enumerate(base_freqs):
        sl = int(SR * 0.04 * i)  # stagger 40ms between notes
        sample = [0.0] * sl + tone(f, n - sl, harmonics=(1.0, 0.5, 0.25))
        env = [0.0] * sl + env_ad(n - sl, attack_frac=0.10, decay_pow=2.0)
        layers.append([s * e * 0.6 for s, e in zip(sample, env)])
    return mix(*layers)

# ── 6) legendary — 400ms dramatic chord with long decay ──────────────────
def make_legendary():
    n = int(SR * 0.40)
    # Major chord: A4, C#5, E5, A5
    voices = [
        tone(440, n, harmonics=(1.0, 0.5, 0.3, 0.15)),
        tone(554, n, harmonics=(1.0, 0.5, 0.3, 0.15)),
        tone(659, n, harmonics=(1.0, 0.5, 0.3, 0.15)),
        tone(880, n, harmonics=(1.0, 0.5, 0.3, 0.15)),
    ]
    mixed = mix(*voices)
    # Add airy noise tail for "magical" feel
    air = highpass(noise(n, seed=6), alpha=0.97)
    air_env = env_ad(n, attack_frac=0.20, decay_pow=1.5)
    air = [a * e * 0.15 for a, e in zip(air, air_env)]
    main_env = env_ad(n, attack_frac=0.05, decay_pow=1.2)
    mixed_env = [m * e for m, e in zip(mixed, main_env)]
    return mix(mixed_env, air)

print("Generating 6 placeholder SFX...")
write_wav(os.path.join(OUT, "whoosh.wav"), make_whoosh())
write_wav(os.path.join(OUT, "rip.wav"), make_rip())
write_wav(os.path.join(OUT, "card-drop.wav"), make_card_drop())
write_wav(os.path.join(OUT, "card-flip.wav"), make_card_flip())
write_wav(os.path.join(OUT, "shimmer.wav"), make_shimmer())
write_wav(os.path.join(OUT, "legendary.wav"), make_legendary())
print("done.")
