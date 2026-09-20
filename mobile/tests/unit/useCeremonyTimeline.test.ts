import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// The guard imports `View` from react-native; this per-file mock is what stops
// vitest from loading the real react-native (libraryCardTile.test.tsx pattern).
vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import {
  useCeremonyTimeline,
  timelineTargets,
  haloColorForTell,
  resolveEasing,
  tableSlotLayout,
  spillSlotOffset,
  EASING,
  TELL_COLORS,
  SEAM_PRECUT,
  SHIVER_PX,
  MAX_TIMELINE_CARDS,
  type CeremonyTimeline,
  type TimelineInput,
} from '../../src/components/ceremony/useCeremonyTimeline';
import type { CeremonyPhase, PeakRarity } from '../../src/features/gacha/draw/ceremonyTimings';
import { resolveCeremonyTimings } from '../../src/features/gacha/draw/ceremonyTimings';
import { buildSpillSchedule, centreSlot } from '../../src/features/gacha/draw/spillSchedule';

const PHASES: CeremonyPhase[] = ['swipe', 'approach', 'hold', 'tear-flip', 'flash-reveal', 'settle', 'cards-on-table'];
const RARITIES: PeakRarity[] = ['COM', 'RAR', 'LEG'];

function Probe(props: { input: TimelineInput; onTimeline: (tl: CeremonyTimeline) => void }): null {
  const tl = useCeremonyTimeline(props.input);
  props.onTimeline(tl);
  return null;
}

describe('useCeremonyTimeline', () => {
  it('timelineTargets encodes the storyboard rest values per phase', () => {
    expect(timelineTargets({ phase: 'swipe', peakRarity: 'COM', isMulti: false, reduceMotion: false })).toEqual({
      tell: 0, dim: 0, leak: 0, flash: 0, cameraScale: 1, packScale: 1, rays: 0.1, halo: 0.25, peel: 0, cardOut: 0, rim: 0,
    });

    // approach: single anticipates to 1.12 / rays 0.22; multi to 1.10 / rays 0.26.
    const aSingle = timelineTargets({ phase: 'approach', peakRarity: 'RAR', isMulti: false, reduceMotion: false });
    expect(aSingle.packScale).toBe(1.12);
    expect(aSingle.rays).toBe(0.22);
    const aMulti = timelineTargets({ phase: 'approach', peakRarity: 'RAR', isMulti: true, reduceMotion: false });
    expect(aMulti.packScale).toBe(1.1);
    expect(aMulti.rays).toBe(0.26);

    // hold: LEG dims the backdrop by 0.3; RAR does not dim.
    expect(timelineTargets({ phase: 'hold', peakRarity: 'LEG', isMulti: false, reduceMotion: false }).dim).toBe(0.3);
    expect(timelineTargets({ phase: 'hold', peakRarity: 'RAR', isMulti: false, reduceMotion: false }).dim).toBe(0);

    // tear-flip: peel and cardOut reach 1.
    const tf = timelineTargets({ phase: 'tear-flip', peakRarity: 'RAR', isMulti: false, reduceMotion: false });
    expect(tf.peel).toBe(1);
    expect(tf.cardOut).toBe(1);

    // flash-reveal: flash blooms to 0.85, pack back to rest.
    const fr = timelineTargets({ phase: 'flash-reveal', peakRarity: 'RAR', isMulti: false, reduceMotion: false });
    expect(fr.flash).toBe(0.85);
    expect(fr.packScale).toBe(1);

    // settle: rim is the tell for RAR/LEG (0.55), none for COM; halo 0.35, rays 0.10.
    const settleRar = timelineTargets({ phase: 'settle', peakRarity: 'RAR', isMulti: false, reduceMotion: false });
    expect(settleRar.rim).toBe(0.55);
    expect(settleRar.halo).toBe(0.35);
    expect(settleRar.rays).toBe(0.1);
    expect(timelineTargets({ phase: 'settle', peakRarity: 'LEG', isMulti: false, reduceMotion: false }).rim).toBe(0.55);
    expect(timelineTargets({ phase: 'settle', peakRarity: 'COM', isMulti: false, reduceMotion: false }).rim).toBe(0);

    // cards-on-table equals settle.
    for (const r of RARITIES) {
      expect(timelineTargets({ phase: 'cards-on-table', peakRarity: r, isMulti: false, reduceMotion: false })).toEqual(
        timelineTargets({ phase: 'settle', peakRarity: r, isMulti: false, reduceMotion: false }),
      );
    }
  });

  it('reduce motion keeps packScale and flash at rest in every phase', () => {
    for (const phase of PHASES) {
      for (const r of RARITIES) {
        const T = timelineTargets({ phase, peakRarity: r, isMulti: false, reduceMotion: true });
        expect(T.packScale).toBe(1);
        expect(T.flash).toBe(0);
        expect(T.cameraScale).toBe(1);
      }
    }
    // The rim colour IS the tell from the RM mount phase.
    expect(timelineTargets({ phase: 'flash-reveal', peakRarity: 'RAR', isMulti: false, reduceMotion: true }).rim).toBe(0.55);
  });

  it('haloColorForTell withholds rarity until the tell and goes violet then gold for LEG', () => {
    expect(haloColorForTell(0, 'RAR')).toBe('#FFF7EC');
    expect(haloColorForTell(1, 'RAR')).toBe('#A78BD8');
    expect(haloColorForTell(0.4, 'LEG')).toBe('#A78BD8');
    expect(haloColorForTell(0.6, 'LEG')).toBe('#F5C95E');
    expect(haloColorForTell(1, 'COM')).toBe('#FFF3E0');
    // Honest tell: rarity is withheld while the tell is low.
    expect(haloColorForTell(0.2, 'COM')).not.toBe(TELL_COLORS.RAR);
  });

  it('resolveEasing returns an identity-under-fallback function for every EASING member', () => {
    const names = [EASING.EMPHASIZED_OUT, EASING.STANDARD, EASING.LINEAR, EASING.OUT_CUBIC, EASING.OUT_QUAD];
    for (const name of names) {
      const fn = resolveEasing(name);
      expect(typeof fn).toBe('function');
      expect(fn(0.25)).toBeCloseTo(0.25);
      expect(fn(0.5)).toBeCloseTo(0.5);
      expect(fn(0.75)).toBeCloseTo(0.75);
    }
  });

  it('tableSlotLayout and spillSlotOffset reproduce the tap-table geometry', () => {
    expect(tableSlotLayout(1)).toEqual({ width: 132, height: 184, rowLength: 1, rows: 1 });
    expect(tableSlotLayout(5)).toEqual({ width: 80, height: 116, rowLength: 5, rows: 1 });
    expect(tableSlotLayout(10)).toEqual({ width: 72, height: 100, rowLength: 5, rows: 2 });

    for (let count = 1; count <= 10; count++) {
      const { rowLength } = tableSlotLayout(count);
      expect(centreSlot(count)).toBe(Math.floor((rowLength - 1) / 2));
    }

    expect(spillSlotOffset(2, 5)).toEqual({ x: 0, y: 0, rot: 0 });
    expect(spillSlotOffset(0, 5)).toEqual({ x: -152, y: 28, rot: -14 });
    // Row 1, col 0 of a two-row 10-card table (width 72).
    expect(spillSlotOffset(5, 10).x).toBe(-136);

    // A 10-card table has 10 distinct landing points.
    const points = new Set<string>();
    for (let s = 0; s < 10; s++) {
      const o = spillSlotOffset(s, 10);
      points.add(`${o.x},${o.y},${o.rot}`);
    }
    expect(points.size).toBe(10);
  });

  it('drives every shared value to the phase target under the guard fallback', () => {
    const cards = [{ rarity: 'LEG' as const }, { rarity: 'COM' as const }];
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: false });
    const schedule = buildSpillSchedule(cards, 940);
    const mk = (phase: CeremonyPhase): TimelineInput => ({
      phase, peakRarity: 'LEG', isMulti: true, cardCount: 2, timings, spill: schedule, reduceMotion: false, compressed: false,
    });

    let tl!: CeremonyTimeline;
    const onTimeline = (x: CeremonyTimeline): void => {
      tl = x;
    };

    const expectTargets = (phase: CeremonyPhase): void => {
      const T = timelineTargets({ phase, peakRarity: 'LEG', isMulti: true, reduceMotion: false });
      expect(tl.tell.value).toBe(T.tell);
      expect(tl.dim.value).toBe(T.dim);
      expect(tl.leak.value).toBe(T.leak);
      expect(tl.packScale.value).toBe(T.packScale);
      expect(tl.rays.value).toBe(T.rays);
      expect(tl.halo.value).toBe(T.halo);
      expect(tl.peel.value).toBe(T.peel);
      expect(tl.cardOut.value).toBe(T.cardOut);
    };

    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(React.createElement(Probe, { input: mk('swipe'), onTimeline }));
    });
    expectTargets('swipe');
    // After mount (non-RM) the fallback collapses the rays loop to its target (radians).
    expect(tl.raysAngle.value).toBe(Math.PI * 2);

    act(() => {
      root.update(React.createElement(Probe, { input: mk('approach'), onTimeline }));
    });
    expectTargets('approach');
    // The hook took the cut over from the finger.
    expect(tl.seam.value).toBe(SEAM_PRECUT);

    act(() => {
      root.update(React.createElement(Probe, { input: mk('hold'), onTimeline }));
    });
    expectTargets('hold');
    expect(tl.shiver.value).toBe(-SHIVER_PX); // the beat's sequence collapses to its last member (px)
    expect(tl.seam.value).toBe(SEAM_PRECUT);

    act(() => {
      root.update(React.createElement(Probe, { input: mk('tear-flip'), onTimeline }));
    });
    expectTargets('tear-flip');
    expect(tl.seam.value).toBe(1);
    expect(tl.shiver.value).toBe(0);
    const slot0 = schedule.entries.find((e) => e.index === 0)!.slot;
    const slot1 = schedule.entries.find((e) => e.index === 1)!.slot;
    expect(tl.spill[0].x.value).toBe(spillSlotOffset(slot0, 2).x);
    expect(tl.spill[0].y.value).toBe(spillSlotOffset(slot0, 2).y);
    expect(tl.spill[0].rot.value).toBe((spillSlotOffset(slot0, 2).rot * Math.PI) / 180); // radians for Skia
    expect(tl.spill[1].x.value).toBe(spillSlotOffset(slot1, 2).x);
    expect(tl.spill[1].y.value).toBe(spillSlotOffset(slot1, 2).y);
    expect(tl.spill[1].rot.value).toBe((spillSlotOffset(slot1, 2).rot * Math.PI) / 180);
    expect(tl.cameraRot.value).toBe(0); // the decaying rock sequence collapses to rest

    act(() => {
      root.update(React.createElement(Probe, { input: mk('flash-reveal'), onTimeline }));
    });
    expectTargets('flash-reveal');
    expect(tl.flash.value).toBe(0); // the bloom sequence collapses to its last member
    expect(tl.cameraScale.value).toBe(1); // the punch sequence collapses to rest

    act(() => {
      root.update(React.createElement(Probe, { input: mk('settle'), onTimeline }));
    });
    expectTargets('settle');
    expect(tl.rim[0].value).toBe(0.55);
    expect(tl.rim[1].value).toBe(0.55);

    act(() => {
      root.update(React.createElement(Probe, { input: mk('cards-on-table'), onTimeline }));
    });
    expectTargets('cards-on-table');

    expect(tl.spill.length).toBe(2);
    expect(tl.rim.length).toBe(2);
  });

  it('reduce motion lays cards out statically with no scale or flash', () => {
    const cards = [{ rarity: 'RAR' as const }, { rarity: 'COM' as const }];
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'RAR', motionAvailable: false });
    const schedule = buildSpillSchedule(cards, 940);

    let tl!: CeremonyTimeline;
    const onTimeline = (x: CeremonyTimeline): void => {
      tl = x;
    };
    act(() => {
      renderer.create(
        React.createElement(Probe, {
          input: {
            phase: 'flash-reveal', peakRarity: 'RAR', isMulti: true, cardCount: 2,
            timings, spill: schedule, reduceMotion: true, compressed: false,
          },
          onTimeline,
        }),
      );
    });

    expect(tl.flash.value).toBe(0);
    expect(tl.packScale.value).toBe(1);
    expect(tl.rim[0].value).toBe(0.55);
    expect(tl.rim[1].value).toBe(0.55);
    const o0 = spillSlotOffset(schedule.entries.find((e) => e.index === 0)!.slot, 2);
    expect(tl.spill[0].x.value).toBe(o0.x);
    expect(tl.spill[0].y.value).toBe(o0.y);
  });

  it('returns a stable timeline reference and clamps the card arrays', () => {
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'RAR', motionAvailable: false });
    const mk = (cardCount: number): TimelineInput => ({
      phase: 'swipe', peakRarity: 'RAR', isMulti: true, cardCount,
      timings, spill: null, reduceMotion: false, compressed: false,
    });

    let tl!: CeremonyTimeline;
    const onTimeline = (x: CeremonyTimeline): void => {
      tl = x;
    };

    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(React.createElement(Probe, { input: mk(3), onTimeline }));
    });
    const first = tl;
    act(() => {
      root.update(React.createElement(Probe, { input: mk(3), onTimeline }));
    });
    expect(tl).toBe(first);

    act(() => {
      root.update(React.createElement(Probe, { input: mk(12), onTimeline }));
    });
    expect(tl.spill.length).toBe(MAX_TIMELINE_CARDS);
    expect(tl.rim.length).toBe(MAX_TIMELINE_CARDS);

    act(() => {
      root.update(React.createElement(Probe, { input: mk(0), onTimeline }));
    });
    expect(tl.spill.length).toBe(0);
    expect(tl.rim.length).toBe(0);
  });

  it('compressed hold shortens durations but never targets', () => {
    const timings = resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false });
    let tl!: CeremonyTimeline;
    const onTimeline = (x: CeremonyTimeline): void => {
      tl = x;
    };
    act(() => {
      renderer.create(
        React.createElement(Probe, {
          input: {
            phase: 'hold', peakRarity: 'RAR', isMulti: false, cardCount: 1,
            timings, spill: null, reduceMotion: false, compressed: true,
          },
          onTimeline,
        }),
      );
    });
    expect(tl.tell.value).toBe(1);
    expect(timelineTargets({ phase: 'hold', peakRarity: 'RAR', isMulti: false, reduceMotion: false }).tell).toBe(1);
  });
});
