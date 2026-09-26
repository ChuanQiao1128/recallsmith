import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the B02 guard with a recording, render-stable surface: `useSharedValue` is a real
// useRef so a value survives re-renders, and every `with*` returns an inspectable record
// instead of collapsing to its target — so a test can read the withDelay offsets the plan
// assigned. `cancelAnimation` is a spy so the fast-forward hand-back can be asserted.
const guard = vi.hoisted(() => ({ cancelAnimation: vi.fn() }));
vi.mock('../../src/components/ceremony/reanimatedGuard', () => {
  const React = require('react');
  const identity = (t: number) => t;
  const Reanimated = {
    useSharedValue: <T,>(v: T) => React.useRef({ value: v }).current,
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedReaction: () => undefined,
    useFrameCallback: () => ({ setActive: () => undefined, isActive: false, callbackId: -1 }),
    withTiming: (to: unknown, cfg?: unknown) => ({ type: 'timing', to, cfg }),
    withSpring: (to: unknown) => ({ type: 'spring', to }),
    withDelay: (delayMs: number, animation: unknown) => ({ type: 'delay', delayMs, animation }),
    withSequence: (...steps: unknown[]) => ({ type: 'sequence', steps }),
    withRepeat: (animation: unknown, reps: number, reverse: boolean) => ({ type: 'repeat', animation, reps, reverse }),
    cancelAnimation: (v: unknown) => guard.cancelAnimation(v),
    runOnJS: (fn: unknown) => fn,
    interpolate: (_v: number, _i: number[], o: number[]) => o[0],
    interpolateColor: (_v: number, _i: number[], o: string[]) => o[0],
    Easing: { bezier: () => identity, linear: identity, out: (e: unknown) => e, in: (e: unknown) => e, cubic: identity, quad: identity },
    View: (p: any) => React.createElement('Animated.View', p, p.children),
    createAnimatedComponent: (c: unknown) => c,
  };
  return { Reanimated, motionAvailable: true, skiaAvailable: true, SkiaModule: null, GestureHandler: { available: false, PanHost: (p: any) => p.children, Gesture: { Pan: () => ({}), Tap: () => ({}) } } };
});

import {
  useCeremonyTimeline,
  playCeremonyTimeline,
  cancelCeremonyTimeline,
  sequenceAt,
  type CeremonyTimeline,
  type TimelineInput,
} from '../../src/components/ceremony/useCeremonyTimeline';
import { resolveCeremonyTimings } from '../../src/features/gacha/draw/ceremonyTimings';

function Probe(props: { input: TimelineInput; onTimeline: (tl: CeremonyTimeline) => void }): null {
  props.onTimeline(useCeremonyTimeline(props.input));
  return null;
}

const TIMINGS = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: false });
// TEST_BASE multi LEG: approach 620, hold 300, tearFlip 940, flashReveal 280, settle 300.
const A = TIMINGS.approach;
const H = TIMINGS.hold;
const TF = TIMINGS.tearFlip;
const FR = TIMINGS.flashReveal;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  guard.cancelAnimation.mockClear();
});

function mount(input: TimelineInput): { root: renderer.ReactTestRenderer; get: () => CeremonyTimeline } {
  let tl!: CeremonyTimeline;
  let root!: renderer.ReactTestRenderer;
  act(() => {
    root = renderer.create(React.createElement(Probe, { input, onTimeline: (x) => (tl = x) }));
  });
  return { root, get: () => tl };
}

const base = (phase: TimelineInput['phase'], over: Partial<TimelineInput> = {}): TimelineInput => ({
  phase,
  peakRarity: 'LEG',
  isMulti: true,
  cardCount: 2,
  timings: TIMINGS,
  spill: null,
  reduceMotion: false,
  compressed: false,
  ...over,
});

describe('playCeremonyTimeline', () => {
  it('starts every approach-to-settle animation at tear with UI-thread delays', () => {
    const { get } = mount(base('swipe', { planned: true }));
    const tl = get();
    playCeremonyTimeline(tl, { peakRarity: 'LEG', isMulti: true, timings: TIMINGS, spill: null });

    const tHold = A;
    const tFlash = A + H + TF;
    const tSettle = A + H + TF + FR;

    // The whole plan is one shared-value assignment per value, each fronted by a UI-thread delay.
    expect((tl.tell.value as any).type).toBe('delay');
    expect((tl.tell.value as any).delayMs).toBe(tHold);
    expect((tl.flash.value as any).delayMs).toBe(tFlash);
    expect((tl.rim[0].value as any).delayMs).toBe(tSettle); // i=0 → +0
    expect((tl.rim[1].value as any).delayMs).toBe(tSettle + 40); // i=1 → +40
  });

  it('skips per-phase animation while a plan is playing', () => {
    let tl!: CeremonyTimeline;
    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(React.createElement(Probe, { input: base('swipe', { planned: true }), onTimeline: (x) => (tl = x) }));
    });

    const SENTINEL = { sentinel: true };
    tl.tell.value = SENTINEL as unknown as number;

    // A phase change while the plan owns the choreography must not touch the shared value.
    act(() => {
      root.update(React.createElement(Probe, { input: base('hold', { planned: true }), onTimeline: (x) => (tl = x) }));
    });
    expect(tl.tell.value).toBe(SENTINEL);

    // Clearing `planned` hands the per-phase path back: it reassigns the value.
    act(() => {
      root.update(React.createElement(Probe, { input: base('hold', { planned: false }), onTimeline: (x) => (tl = x) }));
    });
    expect(tl.tell.value).not.toBe(SENTINEL);
  });

  it('hands back to per-phase animation after the plan is cancelled for fast-forward', () => {
    let tl!: CeremonyTimeline;
    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(React.createElement(Probe, { input: base('hold', { planned: true }), onTimeline: (x) => (tl = x) }));
    });

    guard.cancelAnimation.mockClear();
    cancelCeremonyTimeline(tl);
    const cancelled = guard.cancelAnimation.mock.calls.map((c) => c[0]);
    // Every shared value is cancelled — including each spill component and rim…
    for (const sv of [tl.tell, tl.dim, tl.seam, tl.leak, tl.flash, tl.cameraScale, tl.cameraRot, tl.shiver, tl.packScale, tl.packY, tl.peel, tl.cardOut, tl.rays, tl.halo]) {
      expect(cancelled).toContain(sv);
    }
    for (const r of tl.rim) expect(cancelled).toContain(r);
    // …except raysAngle, whose revolution loop the mount effect owns.
    expect(cancelled).not.toContain(tl.raysAngle);

    // With compressed:true the per-phase path assigns again even though planned is still true
    // (the 'hold' case reassigns `tell`), so a fast-forward gets the compressed choreography.
    const SENTINEL = { sentinel: true };
    tl.tell.value = SENTINEL as unknown as number;
    act(() => {
      root.update(
        React.createElement(Probe, { input: base('hold', { planned: true, compressed: true }), onTimeline: (x) => (tl = x) }),
      );
    });
    expect(tl.tell.value).not.toBe(SENTINEL);
  });

  it('lays each step after the previous one without negative gaps', () => {
    // Overlapping steps (the second starts before the first finishes) never produce a negative
    // gap: the cursor tracks where the previous step ended, so the second becomes a bare animation.
    const seq = sequenceAt([
      { at: 100, durationMs: 50, animation: 'A' },
      { at: 120, durationMs: 30, animation: 'B' }, // cursor after A = 150 > 120 → gap 0
      { at: 400, durationMs: 10, animation: 'C' }, // cursor = 180 → gap 220
    ]) as any;
    expect(seq.type).toBe('sequence');
    expect(seq.steps[0]).toEqual({ type: 'delay', delayMs: 100, animation: 'A' });
    expect(seq.steps[1]).toBe('B'); // gap 0 → the bare animation, never withDelay(negative)
    expect(seq.steps[2]).toEqual({ type: 'delay', delayMs: 220, animation: 'C' });

    // A lone step returns the single part directly (no withSequence wrapper).
    expect(sequenceAt([{ at: 60, durationMs: 10, animation: 'X' }])).toEqual({ type: 'delay', delayMs: 60, animation: 'X' });
    // A step already at the cursor (0) is the bare animation.
    expect(sequenceAt([{ at: 0, durationMs: 10, animation: 'Z' }])).toBe('Z');
    // Input order does not matter: it sorts by `at` first.
    const unsorted = sequenceAt([
      { at: 400, durationMs: 10, animation: 'C' },
      { at: 100, durationMs: 50, animation: 'A' },
    ]) as any;
    expect(unsorted.steps[0]).toEqual({ type: 'delay', delayMs: 100, animation: 'A' });
  });
});
