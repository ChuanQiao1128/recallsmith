// BurstCanvas (I06) render smoke test. Mocks the guard module by its B00 §2.1 contract
// (Skia components as 'Skia.<Name>' host elements, Reanimated hooks as plain-value fakes) —
// never the native packages, which a guarded require() does not reach under vite-node.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: (p: any) => React.createElement('View', p, p.children),
    Text: (p: any) => React.createElement('Text', p, p.children),
    StyleSheet: { create: (s: any) => s, absoluteFillObject: {} },
  };
});

const guardState = vi.hoisted(() => ({ skiaAvailable: true, useImage: (_s: unknown): unknown => null }));

vi.mock('../../src/components/ceremony/reanimatedGuard', () => {
  const React = require('react');
  const host = (name: string) => (p: any) => React.createElement(`Skia.${name}`, p, p.children);
  const SkiaModule = {
    Canvas: host('Canvas'), Group: host('Group'), Rect: host('Rect'), Atlas: host('Atlas'),
    RadialGradient: host('RadialGradient'), LinearGradient: host('LinearGradient'), SweepGradient: host('SweepGradient'),
    BlendColor: host('BlendColor'),
    useImage: (s: unknown) => guardState.useImage(s), useRSXformBuffer: () => [],
    vec: (x: number, y: number) => ({ x, y }), rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
  };
  const Reanimated = {
    useSharedValue: (v: any) => ({ value: v }), useDerivedValue: (fn: () => any) => ({ value: fn() }),
    useAnimatedStyle: (fn: () => any) => fn(), useAnimatedReaction: () => undefined,
    withTiming: (to: number) => to, withSequence: (...a: number[]) => a[a.length - 1],
    cancelAnimation: () => undefined, runOnJS: (fn: any) => fn,
    Easing: { bezier: () => (t: number) => t, linear: (t: number) => t, out: (e: any) => e, in: (e: any) => e, cubic: (t: number) => t, quad: (t: number) => t },
    View: (p: any) => React.createElement('Animated.View', p, p.children), createAnimatedComponent: (c: any) => c,
  };
  return { get skiaAvailable() { return guardState.skiaAvailable; }, motionAvailable: false, SkiaModule, Reanimated, GestureHandler: { available: false } };
});

import {
  BurstCanvas,
  BURST_CANVAS_TESTID,
  BURST_TINT,
  burstParticlePose360,
} from '../../src/components/ceremony/BurstCanvas';

const sv = (v: number) => ({ value: v });

function render(overrides: Partial<React.ComponentProps<typeof BurstCanvas>> = {}) {
  const props = {
    width: 390,
    height: 844,
    peakRarity: 'LEG' as const,
    flash: sv(0),
    reduceMotion: false,
    particleSheet: 42 as any,
    ...overrides,
  };
  let root!: renderer.ReactTestRenderer;
  act(() => {
    root = renderer.create(React.createElement(BurstCanvas, props));
  });
  return { root, props };
}

const byType = (root: renderer.ReactTestRenderer, type: string) => root.root.findAll((n) => n.type === type);
const descendants = (inst: renderer.ReactTestInstance, type: string) =>
  inst.findAll((n) => (n.type as unknown as string) === type);

afterEach(() => {
  guardState.skiaAvailable = true;
  guardState.useImage = (_s: unknown) => null;
});

describe('BurstCanvas', () => {
  it('draws one window-sized canvas with a tinted flash and a particle atlas', () => {
    guardState.useImage = () => ({ fake: true });
    const { root, props } = render();
    const canvases = byType(root, 'Skia.Canvas');
    expect(canvases).toHaveLength(1);
    expect(canvases[0].props.testID).toBe(BURST_CANVAS_TESTID);
    expect(canvases[0].props.pointerEvents).toBe('none');
    expect(canvases[0].props.style.width).toBe(props.width);
    expect(canvases[0].props.style.height).toBe(props.height);

    // The flash rect is driven by the `flash` shared value and tinted to the rarity colour.
    const flashRect = byType(root, 'Skia.Rect').find((r) => r.props.opacity === props.flash)!;
    expect(flashRect).toBeDefined();
    const gradient = descendants(flashRect, 'Skia.RadialGradient')[0];
    expect(gradient.props.colors).toEqual([BURST_TINT.LEG, `${BURST_TINT.LEG}00`]);

    // Exactly one plus-blended particle atlas.
    const atlas = byType(root, 'Skia.Atlas');
    expect(atlas).toHaveLength(1);
    expect(atlas[0].props.blendMode).toBe('plus');
  });

  it('burstParticlePose360 spreads the burst in every direction and is deterministic', () => {
    const origin = { x: 200, y: 200 };
    // Deterministic on (index, elapsed).
    expect(burstParticlePose360(3, 450, 900, origin, 150)).toEqual(burstParticlePose360(3, 450, 900, origin, 150));
    // Zeroed outside its life window; visible inside.
    expect(burstParticlePose360(3, -1, 900, origin, 150).scale).toBe(0);
    expect(burstParticlePose360(3, 900, 900, origin, 150).scale).toBe(0);
    expect(burstParticlePose360(3, 450, 900, origin, 150).scale).toBeGreaterThan(0);

    // Across many sprites the burst fans in every direction (some left/right/up/down of origin).
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const p = burstParticlePose360(i, 200, 800, origin, 150);
      xs.push(p.x);
      ys.push(p.y);
    }
    expect(Math.min(...xs)).toBeLessThan(origin.x);
    expect(Math.max(...xs)).toBeGreaterThan(origin.x);
    expect(Math.min(...ys)).toBeLessThan(origin.y);
    expect(Math.max(...ys)).toBeGreaterThan(origin.y);
  });

  it('mounts nothing under reduce motion or without Skia', () => {
    const rm = render({ reduceMotion: true });
    expect(rm.root.toJSON()).toBeNull();

    guardState.skiaAvailable = false;
    vi.resetModules();
    return import('../../src/components/ceremony/BurstCanvas').then((mod) => {
      let root!: renderer.ReactTestRenderer;
      act(() => {
        root = renderer.create(
          React.createElement(mod.BurstCanvas, {
            width: 390, height: 844, peakRarity: 'LEG', flash: sv(0), reduceMotion: false,
          }),
        );
      });
      expect(root.toJSON()).toBeNull();
    });
  });
});
