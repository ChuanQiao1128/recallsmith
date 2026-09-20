// StageCanvas (B05) render smoke test. Mocks the guard module by its B00 §2.1
// contract (Skia components as 'Skia.<Name>' host elements, Reanimated hooks as
// plain-value fakes) — never the native packages, which a guarded require() does
// not reach under vite-node.

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
    Canvas: host('Canvas'), Group: host('Group'), Rect: host('Rect'), RoundedRect: host('RoundedRect'), Image: host('Image'), Atlas: host('Atlas'),
    Path: host('Path'), Circle: host('Circle'), SweepGradient: host('SweepGradient'), RadialGradient: host('RadialGradient'), LinearGradient: host('LinearGradient'),
    useImage: (s: unknown) => guardState.useImage(s), useRSXformBuffer: () => [], useRectBuffer: () => [],
    vec: (x: number, y: number) => ({ x, y }), rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }), rrect: (r: any, rx: number, ry: number) => ({ rect: r, rx, ry }),
    Skia: { Path: { Make: () => ({ moveTo() { return this; }, lineTo() { return this; }, close() { return this; } }) }, RuntimeEffect: { Make: () => null }, Matrix4: () => [], Color: (c: string) => c },
    BlendMode: { Plus: 'plus', SrcOver: 'srcOver' },
  };
  const Reanimated = {
    useSharedValue: (v: any) => ({ value: v }), useDerivedValue: (fn: () => any) => ({ value: fn() }), useAnimatedStyle: (fn: () => any) => fn(), useAnimatedReaction: () => undefined,
    withTiming: (to: number) => to, withSpring: (to: number) => to, withDelay: (_ms: number, a: number) => a, withSequence: (...a: number[]) => a[a.length - 1], withRepeat: (a: number) => a,
    cancelAnimation: () => undefined, runOnJS: (fn: any) => fn,
    interpolate: (v: number, i: number[], o: number[]) => o[Math.max(0, i.findLastIndex((x) => v >= x))],
    interpolateColor: (v: number, i: number[], o: string[]) => o[Math.max(0, i.findLastIndex((x) => v >= x))],
    Easing: { bezier: () => (t: number) => t, linear: (t: number) => t, out: (e: any) => e, in: (e: any) => e, cubic: (t: number) => t, quad: (t: number) => t },
    View: (p: any) => React.createElement('Animated.View', p, p.children), createAnimatedComponent: (c: any) => c,
  };
  return { get skiaAvailable() { return guardState.skiaAvailable; }, motionAvailable: false, SkiaModule, Reanimated, GestureHandler: { available: false, PanHost: (p: any) => p.children, Gesture: { Pan: () => ({}), Tap: () => ({}) } } };
});

import {
  StageCanvas,
  STAGE_TESTID,
  RAY_COUNT,
  RAY_REVOLUTION_MS,
  MAX_PARTICLES,
  STAGE_TELL_COLORS,
  FLASH_COLORS,
  PARTICLE_COUNT,
  LEAK_BAND_RATIO,
  PACK_BODY_FRACTION,
  stageHaloColor,
  rayStops,
  tableCardSize,
  particlePose,
  poseToRSXform,
  packRectInStage,
  packSlotInStage,
  type StageTimeline,
} from '../../src/components/ceremony/StageCanvas';

const sv = (v: number) => ({ value: v });

function makeTimeline(cardCount: number): StageTimeline {
  return {
    tell: sv(0),
    dim: sv(0),
    leak: sv(0),
    flash: sv(0),
    rays: sv(0),
    raysAngle: sv(0),
    halo: sv(0),
    rim: Array.from({ length: cardCount }, (_, i) => sv(0.1 * (i + 1))),
    spill: Array.from({ length: cardCount }, () => ({ x: sv(0), y: sv(0), rot: sv(0) })),
  };
}

function render(overrides: Partial<React.ComponentProps<typeof StageCanvas>> = {}) {
  const cardCount = overrides.cardCount ?? 3;
  const props = {
    width: 280,
    height: 360,
    peakRarity: 'LEG' as const,
    timeline: makeTimeline(cardCount),
    reduceMotion: false,
    cardCount,
    ...overrides,
  };
  let root!: renderer.ReactTestRenderer;
  act(() => {
    root = renderer.create(React.createElement(StageCanvas, props));
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

describe('StageCanvas', () => {
  it('renders exactly one Canvas with the default/overridden testID and pointerEvents none', () => {
    const { root } = render();
    const canvases = byType(root, 'Skia.Canvas');
    expect(canvases).toHaveLength(1);
    expect(canvases[0].props.testID).toBe(STAGE_TESTID);
    expect(canvases[0].props.pointerEvents).toBe('none');

    const custom = render({ testID: 'custom-stage' });
    expect(byType(custom.root, 'Skia.Canvas')[0].props.testID).toBe('custom-stage');
  });

  it('draws the light layers in order and ends with the flash rect', () => {
    const { root, props } = render();
    // Rects appear in render order: vignette, rays, halo, leak, flash.
    const rects = byType(root, 'Skia.Rect');

    // vignette
    expect(rects[0].props.opacity).toBe(props.timeline.dim);
    expect(descendants(rects[0], 'Skia.RadialGradient').length).toBeGreaterThan(0);
    // rays
    expect(rects[1].props.opacity).toBe(props.timeline.rays);
    const sweep = descendants(rects[1], 'Skia.SweepGradient')[0];
    expect(sweep.props.colors).toHaveLength(24);
    expect(sweep.props.positions).toHaveLength(24);
    // halo
    expect(rects[2].props.opacity).toBe(props.timeline.halo);
    // flash last
    const last = rects[rects.length - 1];
    expect(last.props.opacity).toBe(props.timeline.flash);
    expect(last.props.color).toBe(FLASH_COLORS.LEG);
  });

  it('has exactly one plus-blended rect (the seam light-leak)', () => {
    const { root, props } = render();
    const plusRects = byType(root, 'Skia.Rect').filter((r) => r.props.blendMode === 'plus');
    expect(plusRects).toHaveLength(1);
    expect(plusRects[0].props.opacity).toBe(props.timeline.leak);
  });

  it('draws one stroked rim per card inside the centre-origin group, offsets untouched', () => {
    const base = makeTimeline(3);
    const timeline: StageTimeline = {
      ...base,
      spill: [base.spill[0], { x: sv(30), y: sv(-12), rot: sv(0.4) }, base.spill[2]],
    };
    const { root } = render({ cardCount: 3, timeline });

    const rims = byType(root, 'Skia.RoundedRect');
    expect(rims).toHaveLength(3);
    rims.forEach((r) => {
      expect(r.props.style).toBe('stroke');
      expect(r.props.strokeWidth).toBe(2);
    });

    const originGroup = byType(root, 'Skia.Group').find(
      (g) => JSON.stringify(g.props.transform) === JSON.stringify([{ translateX: 140 }, { translateY: 180 }]),
    );
    expect(originGroup).toBeDefined();

    // each rim group's opacity is the matching rim shared value
    const rimGroups = byType(root, 'Skia.Group').filter((g) => Array.isArray(g.props.transform?.value));
    expect(rimGroups[0].props.opacity).toBe(timeline.rim[0]);
    expect(rimGroups[1].props.opacity).toBe(timeline.rim[1]);
    expect(rimGroups[1].props.transform.value).toEqual([
      { translateX: 30 },
      { translateY: -12 },
      { rotate: 0.4 },
    ]);

    expect(byType(render({ cardCount: 0 }).root, 'Skia.RoundedRect')).toHaveLength(0);
    expect(byType(render({ cardCount: 12, timeline: makeTimeline(12) }).root, 'Skia.RoundedRect')).toHaveLength(10);
  });

  it('mounts the Atlas and glow images only when an image loads', () => {
    const none = render();
    expect(byType(none.root, 'Skia.Atlas')).toHaveLength(0);
    expect(byType(none.root, 'Skia.Image')).toHaveLength(0);

    guardState.useImage = () => ({ fake: true });
    const { root } = render({ cardCount: 3 });
    const atlas = byType(root, 'Skia.Atlas');
    expect(atlas).toHaveLength(1);
    expect(atlas[0].props.sprites).toHaveLength(MAX_PARTICLES);
    expect(atlas[0].props.blendMode).toBe('plus');
    expect(byType(root, 'Skia.Image')).toHaveLength(3);
  });

  it('under reduceMotion drops rays, particles and flash but keeps the ambient layers', () => {
    guardState.useImage = () => ({ fake: true });
    const { root, props } = render({ reduceMotion: true });
    expect(byType(root, 'Skia.SweepGradient')).toHaveLength(0);
    expect(byType(root, 'Skia.Atlas')).toHaveLength(0);
    expect(byType(root, 'Skia.Rect').filter((r) => r.props.opacity === props.timeline.flash)).toHaveLength(0);
    // vignette + halo present, leak present, rims present
    expect(byType(root, 'Skia.RadialGradient').length).toBeGreaterThanOrEqual(2);
    expect(byType(root, 'Skia.Rect').filter((r) => r.props.blendMode === 'plus')).toHaveLength(1);
    expect(byType(root, 'Skia.RoundedRect')).toHaveLength(3);
  });

  it('returns null when Skia is unavailable', async () => {
    guardState.skiaAvailable = false;
    vi.resetModules();
    const mod = await import('../../src/components/ceremony/StageCanvas');
    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(
        React.createElement(mod.StageCanvas, {
          width: 280,
          height: 360,
          peakRarity: 'LEG',
          timeline: makeTimeline(0),
          reduceMotion: false,
          cardCount: 0,
        }),
      );
    });
    expect(root.toJSON()).toBeNull();
  });

  it('stageHaloColor and rayStops resolve the contract colours', () => {
    expect(stageHaloColor(0, 'LEG')).toBe(STAGE_TELL_COLORS.NEUTRAL);
    expect(stageHaloColor(0.4, 'LEG')).toBe(STAGE_TELL_COLORS.RAR);
    expect(stageHaloColor(1, 'LEG')).toBe(STAGE_TELL_COLORS.LEG);
    expect(stageHaloColor(1, 'RAR')).toBe(STAGE_TELL_COLORS.RAR);
    expect(stageHaloColor(1, 'COM')).toBe(STAGE_TELL_COLORS.COM);
    expect(stageHaloColor(0, 'COM')).toBe(STAGE_TELL_COLORS.NEUTRAL);

    const stops = rayStops();
    expect(stops.colors).toHaveLength(24);
    expect(stops.positions[0]).toBe(0);
    for (let i = 1; i < stops.positions.length; i += 1) {
      expect(stops.positions[i]).toBeGreaterThan(stops.positions[i - 1]);
      expect(stops.positions[i]).toBeLessThan(1);
    }
    expect(stops.colors[0]).not.toBe(stops.colors[1]);
    expect(stops.colors[0]).toBe(stops.colors[2]);
  });

  it('tableCardSize, particlePose and poseToRSXform are deterministic', () => {
    expect(tableCardSize(1)).toEqual({ width: 132, height: 184 });
    expect(tableCardSize(5)).toEqual({ width: 80, height: 116 });
    expect(tableCardSize(6)).toEqual({ width: 72, height: 100 });

    const o = { x: 0, y: 0 };
    expect(particlePose(3, -1, 900, o, 100).scale).toBe(0);
    expect(particlePose(3, 900, 900, o, 100).scale).toBe(0);
    const mid = particlePose(3, 450, 900, o, 100);
    expect(mid.scale).toBeGreaterThan(0);
    expect(mid.alpha).toBe(0.5);
    expect(mid).not.toEqual(particlePose(4, 450, 900, o, 100));
    expect(particlePose(3, 450, 900, o, 100)).toEqual(mid);

    expect(poseToRSXform({ x: 10, y: 20, scale: 1, rotation: 0 }, 64)).toEqual({ scos: 1, ssin: 0, tx: -22, ty: -12 });
  });

  it('exposes the frozen ceremony constants', () => {
    expect(RAY_COUNT).toBe(12);
    expect(RAY_REVOLUTION_MS).toBe(14000);
    expect(MAX_PARTICLES).toBe(120);
    (Object.keys(PARTICLE_COUNT) as Array<keyof typeof PARTICLE_COUNT>).forEach((r) => {
      expect(PARTICLE_COUNT[r]).toBeLessThanOrEqual(MAX_PARTICLES);
    });
    expect(LEAK_BAND_RATIO).toBe(0.18);
    expect(PACK_BODY_FRACTION).toBe(0.7);
  });

  it('passes raysAngle (radians) to the ray transform unchanged', () => {
    const timeline = makeTimeline(0);
    timeline.raysAngle = sv(Math.PI);
    const { root } = render({ cardCount: 0, timeline });
    const raysRect = byType(root, 'Skia.Rect').find((r) => descendants(r, 'Skia.SweepGradient').length > 0)!;
    expect(raysRect.props.transform.value[0].rotate).toBe(Math.PI);

    const zeroTl: StageTimeline = { ...makeTimeline(0), raysAngle: sv(0) };
    const zero = render({ cardCount: 0, timeline: zeroTl });
    const zeroRays = byType(zero.root, 'Skia.Rect').find((r) => descendants(r, 'Skia.SweepGradient').length > 0)!;
    expect(zeroRays.props.transform.value[0].rotate).toBe(0);
  });

  it('packRectInStage / packSlotInStage stay concentric with the body fraction', () => {
    const pack = packRectInStage(280, 360);
    expect(pack.x).toBeCloseTo(75.6);
    expect(pack.y).toBeCloseTo(65.4);
    expect(pack.width).toBeCloseTo(128.8);
    expect(pack.height).toBeCloseTo(193.2);

    const slot = packSlotInStage(280, 360);
    expect(slot.x).toBeCloseTo(48);
    expect(slot.y).toBeCloseTo(24);
    expect(slot.width).toBeCloseTo(184);
    expect(slot.height).toBeCloseTo(276);

    ([
      [280, 360],
      [390, 520],
    ] as const).forEach(([w, h]) => {
      const p = packRectInStage(w, h);
      const s = packSlotInStage(w, h);
      expect(s.width * PACK_BODY_FRACTION).toBeCloseTo(p.width);
      expect(s.height).toBeCloseTo(s.width * 1.5);
      expect(s.x + s.width / 2).toBeCloseTo(p.x + p.width / 2);
      expect(s.y + s.height / 2).toBeCloseTo(p.y + p.height / 2);
    });
  });
});
