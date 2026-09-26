// G42 — idle stage + cheaper TapCard shadow + fallback-only spill sampler.
//
// Mocks the B02 guard the way stageCanvas.test.tsx does (Skia components as
// 'Skia.<Name>' host elements, Reanimated hooks as plain-value fakes) but with
// RECORDING withRepeat / cancelAnimation spies so we can assert the stage never
// starts a repeating animation while idle, and that the ray revolution is
// cancelled once the cards are on the table. The mock's useSharedValue is
// render-STABLE (React.useRef, like the real guard fallback) so the identity
// check `cancelAnimation call[0] === tl.raysAngle` holds across renders — a
// fresh `{ value: v }` per render (stageCanvas.test.tsx's shape) would break it.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: (p: any) => React.createElement('View', p, p.children),
    Text: (p: any) => React.createElement('Text', p, p.children),
    Pressable: (p: any) => React.createElement('Pressable', p, p.children),
    StyleSheet: { create: (s: any) => s, absoluteFillObject: {} },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: (p: any) => React.createElement('LinearGradient', p, p.children) };
});

const spies = vi.hoisted(() => ({ withRepeat: vi.fn((a: any) => a), cancelAnimation: vi.fn() }));

vi.mock('../../src/components/ceremony/reanimatedGuard', () => {
  const React = require('react');
  const host = (name: string) => (p: any) => React.createElement(`Skia.${name}`, p, p.children);
  const SkiaModule = {
    Canvas: host('Canvas'), Group: host('Group'), Rect: host('Rect'), RoundedRect: host('RoundedRect'), Image: host('Image'), Atlas: host('Atlas'),
    Path: host('Path'), Circle: host('Circle'), SweepGradient: host('SweepGradient'), RadialGradient: host('RadialGradient'), LinearGradient: host('LinearGradient'),
    useImage: () => null, useRSXformBuffer: () => [], useRectBuffer: () => [],
    vec: (x: number, y: number) => ({ x, y }), rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }), rrect: (r: any, rx: number, ry: number) => ({ rect: r, rx, ry }),
    Skia: { Path: { Make: () => ({ moveTo() { return this; }, lineTo() { return this; }, close() { return this; } }) }, RuntimeEffect: { Make: () => null }, Matrix4: () => [], Color: (c: string) => c },
    BlendMode: { Plus: 'plus', SrcOver: 'srcOver' },
  };
  const Reanimated = {
    // render-STABLE so a shared value keeps its object identity across renders.
    useSharedValue: (v: any) => React.useRef({ value: v }).current,
    useDerivedValue: (fn: () => any) => ({ value: fn() }),
    useAnimatedStyle: (fn: () => any) => fn(),
    useAnimatedReaction: () => undefined,
    withTiming: (to: number) => to, withSpring: (to: number) => to,
    withDelay: (_ms: number, a: number) => a, withSequence: (...a: number[]) => a[a.length - 1],
    withRepeat: spies.withRepeat, cancelAnimation: spies.cancelAnimation,
    runOnJS: (fn: any) => fn,
    interpolate: (v: number, i: number[], o: number[]) => o[Math.max(0, i.findLastIndex((x) => v >= x))],
    interpolateColor: (v: number, i: number[], o: string[]) => o[Math.max(0, i.findLastIndex((x) => v >= x))],
    Easing: { bezier: () => (t: number) => t, linear: (t: number) => t, out: (e: any) => e, in: (e: any) => e, cubic: (t: number) => t, quad: (t: number) => t },
    View: (p: any) => React.createElement('Animated.View', p, p.children), createAnimatedComponent: (c: any) => c,
  };
  return {
    skiaAvailable: true, motionAvailable: false, SkiaModule, Reanimated,
    GestureHandler: { available: false, PanHost: (p: any) => p.children, Gesture: { Pan: () => ({ onUpdate() { return this; }, onEnd() { return this; } }), Tap: () => ({}) } },
  };
});

import { StageCanvas, type StageTimeline } from '../../src/components/ceremony/StageCanvas';
import {
  useCeremonyTimeline,
  type CeremonyTimeline,
  type TimelineInput,
} from '../../src/components/ceremony/useCeremonyTimeline';
import { resolveCeremonyTimings } from '../../src/features/gacha/draw/ceremonyTimings';
import type { CeremonyPhase } from '../../src/features/gacha/draw/ceremonyTimings';
import { tapCardShadowOpacity, TAP_CARD_SHADOW_OPACITY } from '../../src/components/ceremony/TapCard';
import { shouldMountSpillSampler } from '../../src/components/ceremony/SpillSampler';

const sv = (v: number) => ({ value: v });

function makeStageTimeline(cardCount: number): StageTimeline {
  return {
    tell: sv(0), dim: sv(0), leak: sv(0), flash: sv(0), rays: sv(0.1), raysAngle: sv(0), halo: sv(0.35),
    rim: Array.from({ length: cardCount }, () => sv(0)),
    spill: Array.from({ length: cardCount }, () => ({ x: sv(0), y: sv(0), rot: sv(0) })),
  };
}

function Probe(props: { input: TimelineInput; onTimeline: (tl: CeremonyTimeline) => void }): null {
  const tl = useCeremonyTimeline(props.input);
  props.onTimeline(tl);
  return null;
}

beforeEach(() => {
  spies.withRepeat.mockClear();
  spies.cancelAnimation.mockClear();
});

describe('G42 idle stage', () => {
  it('starts no repeating animation while the stage is idle', () => {
    act(() => {
      renderer.create(
        React.createElement(StageCanvas, {
          width: 280, height: 360, peakRarity: 'LEG' as const,
          timeline: makeStageTimeline(3), reduceMotion: false, cardCount: 3, idle: true,
        }),
      );
    });
    expect(spies.withRepeat).not.toHaveBeenCalled();
  });

  it('cancels the ray revolution once the cards are on the table', () => {
    const timings = resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false });
    const mk = (phase: CeremonyPhase): TimelineInput => ({
      phase, peakRarity: 'RAR', isMulti: false, cardCount: 2, timings, spill: null, reduceMotion: false, compressed: false,
    });
    let tl!: CeremonyTimeline;
    const onTimeline = (x: CeremonyTimeline): void => { tl = x; };

    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(React.createElement(Probe, { input: mk('settle'), onTimeline }));
    });
    // While in 'settle' only `shiver` is cancelled — never the ray revolution.
    expect(spies.cancelAnimation.mock.calls.some((c) => c[0] === tl.raysAngle)).toBe(false);

    act(() => {
      root.update(React.createElement(Probe, { input: mk('cards-on-table'), onTimeline }));
    });
    expect(spies.cancelAnimation.mock.calls.some((c) => c[0] === tl.raysAngle)).toBe(true);
  });

  it('drops the slot shadow while a card is lifted or mid-flip', () => {
    expect(tapCardShadowOpacity(0, 0)).toBe(TAP_CARD_SHADOW_OPACITY);
    expect(tapCardShadowOpacity(1, 0)).toBe(TAP_CARD_SHADOW_OPACITY);
    expect(tapCardShadowOpacity(0.5, 0)).toBe(0);
    expect(tapCardShadowOpacity(0, 0.4)).toBe(0);
  });

  it('mounts the spill sampler only for the fallback stage', () => {
    expect(shouldMountSpillSampler('tear-flip', true, 'fallback')).toBe(true);
    expect(shouldMountSpillSampler('tear-flip', true, 'skia')).toBe(false);
    expect(shouldMountSpillSampler('tear-flip', false, 'fallback')).toBe(false);
    expect(shouldMountSpillSampler('hold', true, 'fallback')).toBe(false);
  });
});
