import { describe, expect, it } from 'vitest';

import { buildCeremonyCues, cueTimesFromSchedule } from '../../src/features/gacha/draw/ceremonyCues';
import { resolveCeremonyTimings, type PeakRarity } from '../../src/features/gacha/draw/ceremonyTimings';

const RARITIES: PeakRarity[] = ['COM', 'RAR', 'LEG'];

describe('ceremonyCues', () => {
  it('pulses the charge at approach start, hold start and mid-hold with light, medium and heavy impacts', () => {
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true });
    const cues = buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings, tapFlow: true });

    // approach start: the charge sound (its three plucks land on the three pulse haptics) and pulse 1.
    expect(cues).toContainEqual({ phase: 'approach', offsetMs: 0, action: { kind: 'hit', name: 'charge' } });
    expect(cues).toContainEqual({ phase: 'approach', offsetMs: 0, action: { kind: 'impact', style: 'light' } });
    // hold: the second (medium) pulse at the start, the third (heavy) at mid-hold — nothing else.
    expect(cues).toContainEqual({ phase: 'hold', offsetMs: 0, action: { kind: 'impact', style: 'medium' } });
    expect(cues).toContainEqual({
      phase: 'hold',
      offsetMs: Math.round(timings.hold * 0.5),
      action: { kind: 'impact', style: 'heavy' },
    });
    expect(cues.filter((c) => c.phase === 'hold')).toHaveLength(2);
    // The charge sound plays exactly once.
    expect(cues.filter((c) => c.action.kind === 'hit' && c.action.name === 'charge')).toHaveLength(1);
  });

  it('tears at tear-flip and bursts at flash-reveal for every rarity', () => {
    for (const r of RARITIES) {
      const t = resolveCeremonyTimings({ isMulti: true, peakRarity: r, motionAvailable: true });
      const cues = buildCeremonyCues({ peakRarity: r, isMulti: true, timings: t, tapFlow: true });
      expect(cues).toContainEqual({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'hit', name: 'tear' } });
      expect(cues).toContainEqual({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'impact', style: 'light' } });
      // multi spills at the tear midpoint.
      expect(cues).toContainEqual({
        phase: 'tear-flip',
        offsetMs: Math.round(t.tearFlip * 0.5),
        action: { kind: 'hit', name: 'flyout' },
      });
      expect(cues).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'burst' } });
      expect(cues).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'impact', style: 'heavy' } });
    }
    // A single pull has no flyout (nothing spills).
    const single = buildCeremonyCues({
      peakRarity: 'COM',
      isMulti: false,
      timings: resolveCeremonyTimings({ isMulti: false, peakRarity: 'COM', motionAvailable: true }),
      tapFlow: true,
    });
    expect(single.some((c) => c.action.kind === 'hit' && c.action.name === 'flyout')).toBe(false);
  });

  it('plays the peak stinger at the flash only on the featured path', () => {
    const t = resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: true });

    // Featured path (tapFlow off): the burst, then the peak stinger, the LEG success BEFORE the impact.
    const featured = buildCeremonyCues({ peakRarity: 'LEG', isMulti: false, timings: t, tapFlow: false });
    expect(featured).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger-leg' } });
    expect(featured).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'success' } });
    const flash = featured.filter((c) => c.phase === 'flash-reveal');
    const burstIdx = flash.findIndex((c) => c.action.kind === 'hit' && c.action.name === 'burst');
    const stingIdx = flash.findIndex((c) => c.action.kind === 'hit' && c.action.name === 'stinger-leg');
    const successIdx = flash.findIndex((c) => c.action.kind === 'success');
    const impactIdx = flash.findIndex((c) => c.action.kind === 'impact');
    expect(burstIdx).toBeLessThan(stingIdx);
    expect(successIdx).toBeGreaterThanOrEqual(0);
    expect(successIdx).toBeLessThan(impactIdx);

    // Tap flow: the burst still fires, but the stinger does not (the spotlight's flip plays it).
    const tap = buildCeremonyCues({ peakRarity: 'LEG', isMulti: false, timings: t, tapFlow: true });
    expect(tap).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'burst' } });
    expect(tap.some((c) => c.action.kind === 'hit' && String(c.action.name).startsWith('stinger'))).toBe(false);
    expect(tap.some((c) => c.action.kind === 'success')).toBe(false);

    // RAR / COM featured stingers (RAR has no flash success).
    const rar = buildCeremonyCues({
      peakRarity: 'RAR',
      isMulti: false,
      timings: resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }),
      tapFlow: false,
    });
    expect(rar).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger-rar' } });
    expect(rar.some((c) => c.action.kind === 'success')).toBe(false);
    const com = buildCeremonyCues({
      peakRarity: 'COM',
      isMulti: false,
      timings: resolveCeremonyTimings({ isMulti: false, peakRarity: 'COM', motionAvailable: true }),
      tapFlow: false,
    });
    expect(com).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger-com' } });
  });

  it('reduce motion keeps only the stinger', () => {
    const t = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true });
    // Tap flow under RM: the spotlight crossfade plays the stinger, so the table cues are empty.
    expect(buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings: t, tapFlow: true, reduceMotion: true })).toEqual([]);

    // Featured path under RM: only the peak stinger (+ success for LEG) — no charge / tear / burst.
    const rm = buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings: t, tapFlow: false, reduceMotion: true });
    expect(rm).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger-leg' } });
    expect(rm).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'success' } });
    expect(rm.some((c) => c.action.kind === 'hit' && c.action.name === 'burst')).toBe(false);
    expect(rm.some((c) => c.action.kind === 'hit' && c.action.name === 'charge')).toBe(false);

    // A COM featured RM pull is just its stinger, no success.
    const rmCom = buildCeremonyCues({
      peakRarity: 'COM',
      isMulti: false,
      timings: resolveCeremonyTimings({ isMulti: false, peakRarity: 'COM', motionAvailable: true }),
      tapFlow: false,
      reduceMotion: true,
    });
    expect(rmCom).toEqual([{ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger-com' } }]);
  });

  it('turns a phase schedule into absolute cue times from one start', () => {
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: false });
    const cues = buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings, tapFlow: false });

    // TEST_BASE multi (approach 620, hold 300, tearFlip 940, flashReveal 280), with the approach
    // entry prepended (the screen schedules cues from the tear, approach included).
    const entries = [
      { at: 0, phase: 'approach' as const },
      { at: 620, phase: 'hold' as const },
      { at: 920, phase: 'tear-flip' as const },
      { at: 1860, phase: 'flash-reveal' as const },
      { at: 2140, phase: 'settle' as const },
      { at: 2740, phase: 'tail' as const },
    ];
    const times = cueTimesFromSchedule(cues, entries);

    expect(times).toContainEqual({ at: 0, action: { kind: 'hit', name: 'charge' } });
    expect(times).toContainEqual({ at: 920, action: { kind: 'hit', name: 'tear' } });
    expect(times).toContainEqual({ at: 920 + Math.round(940 * 0.5), action: { kind: 'hit', name: 'flyout' } });
    expect(times).toContainEqual({ at: 1860, action: { kind: 'hit', name: 'burst' } });

    // The 'tail' entry has no cues; nothing lands at 2740.
    expect(times.some((t) => t.at === 2740)).toBe(false);

    // Stable-sorted ascending by `at`.
    const ats = times.map((t) => t.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));

    // Within one moment (flash-reveal @1860) the build order holds: burst → stinger → success → impact.
    const atFlash = times.filter((t) => t.at === 1860).map((t) => (t.action.kind === 'hit' ? t.action.name : t.action.kind));
    expect(atFlash).toEqual(['burst', 'stinger-leg', 'success', 'impact']);
  });
});
