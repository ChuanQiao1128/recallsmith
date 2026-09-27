// ceremonySfxV2 — asserts the committed v2 WAVs match the loudness-balanced one-shot contract
// the ceremony depends on. Reads the files straight off disk with node:fs and parses the RIFF
// chunks (never assuming a 44-byte header), so a re-encode that broke the format would fail here.

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CEREMONY_GAIN,
  SFX_FILES,
  createCeremonyAudioController,
} from '../../src/components/ceremonyAudio';

const V2_DIR = fileURLToPath(new URL('../../assets/sfx/v2/', import.meta.url));

type Wav = { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number; samples: Float32Array };

/** Parse a PCM WAV by walking its RIFF chunks (fmt + data); tolerant of any header size / extra chunks. */
function parseWav(buf: Buffer): Wav {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let data: { start: number; size: number } | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = { start: body, size };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error('malformed WAV: missing fmt/data');
  const count = Math.floor(data.size / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) samples[i] = buf.readInt16LE(data.start + i * 2) / 32768;
  return { ...fmt, samples };
}

function loadWav(name: string): Wav {
  return parseWav(readFileSync(`${V2_DIR}${name}.wav`));
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  const n = Math.max(1, to - from);
  return Math.sqrt(sum / n);
}

function peak(samples: Float32Array): number {
  let m = 0;
  for (let i = 0; i < samples.length; i += 1) m = Math.max(m, Math.abs(samples[i]));
  return m;
}

const dbfs = (v: number) => 20 * Math.log10(v);

describe('ceremony SFX v2', () => {
  it('ships exactly the eight Kenney v2 sounds and no looping bed', () => {
    expect([...SFX_FILES]).toEqual([
      'charge', 'tear', 'burst', 'flyout', 'flip', 'stinger-com', 'stinger-rar', 'stinger-leg',
    ]);
    for (const name of SFX_FILES) {
      expect(existsSync(`${V2_DIR}${name}.wav`)).toBe(true);
    }
    // The v2 controller is hit-only: there is no bed / duck / tail surface any more.
    const ctrl = createCeremonyAudioController({ audio: null, sources: {} }) as Record<string, unknown>;
    expect(typeof ctrl.hit).toBe('function');
    expect(ctrl.bed).toBeUndefined();
    expect(ctrl.duck).toBeUndefined();
    expect(ctrl.tail).toBeUndefined();
  });

  it('every v2 sound is a short 44.1 kHz 16-bit mono PCM WAV whose tail has decayed', () => {
    for (const name of SFX_FILES) {
      const wav = loadWav(name);
      expect(wav.audioFormat).toBe(1); // PCM
      expect(wav.sampleRate).toBe(44100);
      expect(wav.bitsPerSample).toBe(16);
      expect(wav.channels).toBe(1);
      const durationS = wav.samples.length / wav.channels / wav.sampleRate;
      expect(durationS).toBeLessThanOrEqual(2.0);
      expect(dbfs(peak(wav.samples))).toBeLessThanOrEqual(-1);
      // The last 10 ms has decayed (no click / non-gapless loop seam).
      const tailFrom = wav.samples.length - Math.round(0.01 * wav.sampleRate) * wav.channels;
      expect(dbfs(rms(wav.samples, Math.max(0, tailFrom)))).toBeLessThan(-45);
    }
  });

  it('escalates the stingers COM < RAR < LEG and keeps the foley at least 3 dB under them', () => {
    // Effective level = whole-file RMS in dBFS + the role gain in dB.
    const effective = (name: keyof typeof CEREMONY_GAIN.hit) =>
      dbfs(rms(loadWav(name).samples)) + dbfs(CEREMONY_GAIN.hit[name]);

    const com = effective('stinger-com');
    const rar = effective('stinger-rar');
    const leg = effective('stinger-leg');
    expect(com).toBeLessThan(rar);
    expect(rar).toBeLessThan(leg);

    // The foley sits at least 3 dB below the quietest stinger.
    for (const foley of ['charge', 'tear', 'flyout', 'flip'] as const) {
      expect(effective(foley)).toBeLessThanOrEqual(com - 3);
    }
    // The burst is loud but stays under the LEG stinger.
    expect(effective('burst')).toBeLessThanOrEqual(leg);
  });
});
