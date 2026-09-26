import { describe, expect, it } from 'vitest';

import { buildCeremonyCues, cueTimesFromSchedule } from '../../src/features/gacha/draw/ceremonyCues';
import { CEREMONY_GAIN } from '../../src/components/ceremonyAudio';
import { resolveCeremonyTimings } from '../../src/features/gacha/draw/ceremonyTimings';

describe('ceremonyCues', () => {
  it('lists the tear, flash and settle cues relative to their phase start', () => {
    // LEG multi on the DEVICE table (approach 900, hold 1100, tearFlip 1800, flashReveal 400).
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true });
    const cues = buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings });

    // tear-flip: the rip and its light impact at the phase start, the stack thud at the midpoint.
    expect(cues).toContainEqual({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'hit', name: 'rip' } });
    expect(cues).toContainEqual({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'impact', style: 'light' } });
    expect(cues).toContainEqual({
      phase: 'tear-flip',
      offsetMs: Math.round(timings.tearFlip * 0.5),
      action: { kind: 'hit', name: 'stack-thud' },
    });

    // flash-reveal: seam burst, LEG stinger, Success BEFORE the heavy impact, at the phase start.
    expect(cues).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'seam-burst' } });
    expect(cues).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger' } });
    expect(cues).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'success' } });
    expect(cues).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'impact', style: 'heavy' } });

    // settle: the sparkle tail, then the bed drops to the quiet table level.
    expect(cues).toContainEqual({ phase: 'settle', offsetMs: 0, action: { kind: 'tail', name: 'sparkle-tail' } });
    expect(cues).toContainEqual({
      phase: 'settle',
      offsetMs: 0,
      action: { kind: 'bed', name: 'choir-swell', gain: CEREMONY_GAIN.bedTable },
    });

    // The LEG Success climax is listed before the heavy flash impact (G09 / MGACHA-08 order).
    const flash = cues.filter((c) => c.phase === 'flash-reveal');
    const successIdx = flash.findIndex((c) => c.action.kind === 'success');
    const impactIdx = flash.findIndex((c) => c.action.kind === 'impact');
    expect(successIdx).toBeGreaterThanOrEqual(0);
    expect(successIdx).toBeLessThan(impactIdx);
  });

  it('places the tell impact and the beat duck inside hold', () => {
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true });
    const cues = buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings });

    // The bed starts at hold; the tell impact lands 60% through; the duck ramps just before the hit.
    expect(cues).toContainEqual({
      phase: 'hold',
      offsetMs: 0,
      action: { kind: 'bed', name: 'choir-swell', gain: CEREMONY_GAIN.bed.LEG },
    });
    expect(cues).toContainEqual({
      phase: 'hold',
      offsetMs: Math.round(timings.hold * 0.6),
      action: { kind: 'impact', style: 'heavy' },
    });
    expect(cues).toContainEqual({
      phase: 'hold',
      offsetMs: timings.hold - timings.beatMs,
      action: { kind: 'duck', gain: CEREMONY_GAIN.duck, ms: 80 },
    });

    // A RAR peak takes the medium tell impact instead of the heavy one.
    const rar = resolveCeremonyTimings({ isMulti: true, peakRarity: 'RAR', motionAvailable: true });
    const rarCues = buildCeremonyCues({ peakRarity: 'RAR', isMulti: true, timings: rar });
    expect(rarCues).toContainEqual({
      phase: 'hold',
      offsetMs: Math.round(rar.hold * 0.6),
      action: { kind: 'impact', style: 'medium' },
    });
  });

  it('keeps a common single pull free of rarity cues', () => {
    const timings = resolveCeremonyTimings({ isMulti: false, peakRarity: 'COM', motionAvailable: true });
    const cues = buildCeremonyCues({ peakRarity: 'COM', isMulti: false, timings });

    // No rarity sting, no Success climax, no sparkle tail, no rarity tell impact.
    expect(cues.some((c) => c.action.kind === 'success')).toBe(false);
    expect(cues.some((c) => c.action.kind === 'tail')).toBe(false);
    expect(cues.some((c) => c.action.kind === 'hit' && c.action.name === 'stinger')).toBe(false);
    expect(cues.some((c) => c.action.kind === 'hit' && c.action.name === 'chime')).toBe(false);
    expect(cues.some((c) => c.action.kind === 'hit' && c.action.name === 'stack-thud')).toBe(false);
    // The only impacts are the light rip / flash impacts — never a heavy or medium tell impact.
    expect(cues.some((c) => c.action.kind === 'impact' && c.action.style !== 'light')).toBe(false);

    // The universal cues still fire: the bed, the rip and its impact, the seam burst.
    expect(cues).toContainEqual({
      phase: 'hold',
      offsetMs: 0,
      action: { kind: 'bed', name: 'air', gain: CEREMONY_GAIN.bed.COM },
    });
    expect(cues).toContainEqual({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'hit', name: 'rip' } });
    expect(cues).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'seam-burst' } });
  });

  it('turns a phase schedule into absolute cue times from one start', () => {
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: false });
    const cues = buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings });

    // The phase schedule TEST_BASE multi produces (approach 620, hold 300, tearFlip 940, flashReveal 280).
    const entries = [
      { at: 620, phase: 'hold' as const },
      { at: 920, phase: 'tear-flip' as const },
      { at: 1860, phase: 'flash-reveal' as const },
      { at: 2140, phase: 'settle' as const },
      { at: 2740, phase: 'tail' as const },
    ];
    const times = cueTimesFromSchedule(cues, entries);

    // Each cue is placed at entry.at + its phase-relative offset.
    expect(times).toContainEqual({ at: 920, action: { kind: 'hit', name: 'rip' } });
    expect(times).toContainEqual({ at: 1860, action: { kind: 'hit', name: 'seam-burst' } });
    expect(times).toContainEqual({ at: 2140, action: { kind: 'tail', name: 'sparkle-tail' } });
    expect(times).toContainEqual({ at: 920 + Math.round(940 * 0.5), action: { kind: 'hit', name: 'stack-thud' } });

    // The 'tail' entry has no cues; nothing lands at 2740.
    expect(times.some((t) => t.at === 2740)).toBe(false);

    // Stable-sorted ascending by `at`.
    const ats = times.map((t) => t.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));

    // Within one moment (flash-reveal @1860) the build order is preserved: burst → stinger → success → impact.
    const atFlash = times.filter((t) => t.at === 1860).map((t) => (t.action.kind === 'hit' ? t.action.name : t.action.kind));
    expect(atFlash).toEqual(['seam-burst', 'stinger', 'success', 'impact']);
  });
});
