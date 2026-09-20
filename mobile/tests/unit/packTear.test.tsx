// PackTear (B06) render + a11y smoke test. Mocks the guard module by its B00 §2.1
// contract (Skia components as 'Skia.<Name>' host elements, Reanimated hooks as
// plain-value fakes, an inert Gesture.Pan()) — never the native packages, which a
// guarded require() does not reach under vite-node. The key case proves the
// accessible 'activate' action starts the ceremony (DoD release-1.6.0-plan:185).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
  };
});

const guardState = vi.hoisted(() => ({ skiaAvailable: true, useImage: (_s: unknown): unknown => null }));

vi.mock('../../src/components/ceremony/reanimatedGuard', () => {
  const React = require('react');
  const host = (name: string) => (p: any) => React.createElement(`Skia.${name}`, p, p.children);
  const inert: any = {};
  for (const name of [
    'enabled',
    'activeOffsetX',
    'failOffsetY',
    'onUpdate',
    'onEnd',
    'onBegin',
    'onStart',
    'onFinalize',
    'minDistance',
    'runOnJS',
  ]) {
    inert[name] = () => inert;
  }
  const SkiaModule = {
    Canvas: host('Canvas'), Group: host('Group'), Rect: host('Rect'), RoundedRect: host('RoundedRect'),
    Image: host('Image'), Path: host('Path'), Circle: host('Circle'),
    useImage: (s: unknown) => guardState.useImage(s),
    vec: (x: number, y: number) => ({ x, y }),
    rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
    rrect: (r: any, rx: number, ry: number) => ({ rect: r, rx, ry }),
    Skia: { Path: { Make: () => ({ moveTo() { return this; }, lineTo() { return this; }, close() { return this; } }) } },
  };
  const Reanimated = {
    useSharedValue: (v: any) => ({ value: v }),
    useDerivedValue: (fn: () => any) => ({ value: fn() }),
    withTiming: (to: number) => to,
    runOnJS: (fn: any) => fn,
  };
  const GestureHandler = {
    available: false,
    PanHost: (p: any) => p.children,
    Gesture: { Pan: () => inert, Tap: () => inert },
  };
  return {
    get skiaAvailable() { return guardState.skiaAvailable; },
    motionAvailable: false,
    SkiaModule,
    Reanimated,
    GestureHandler,
  };
});

import {
  PackTear,
  packTestID,
  packBodyRect,
  seamProgressFromDelta,
  seamPointsPx,
  seamYAt,
  SEAM_PATH_NORMALISED,
  SEAL_COLOR,
  PEEL_ROTATE_X_RAD,
  type PackTearProps,
  type PackTimeline,
} from '../../src/components/ceremony/PackTear';
import type { PackPalette } from '../../src/theme/packArt';

const sv = <T,>(value: T) => ({ value });

function makeTimeline(over: Partial<Record<keyof PackTimeline, number>> = {}): PackTimeline {
  return {
    seam: sv(over.seam ?? 0),
    peel: sv(over.peel ?? 0),
    cardOut: sv(over.cardOut ?? 0),
    packScale: sv(over.packScale ?? 1),
    packY: sv(over.packY ?? 0),
    shiver: sv(over.shiver ?? 0),
  };
}

const PALETTE: PackPalette = {
  cover: ['#1', '#2', '#3', '#4'],
  halo: '#h',
  ring: '#r',
  titleInk: '#t',
  badgeBg: '#b',
  badgeInk: '#i',
};

function baseProps(over: Partial<PackTearProps> = {}): PackTearProps {
  return {
    width: 200,
    height: 300,
    coverImage: undefined,
    palette: PALETTE,
    phase: 'swipe',
    isMulti: false,
    pitySeal: false,
    timeline: makeTimeline(),
    disabled: false,
    onTear: vi.fn(),
    ...over,
  };
}

function renderPack(over: Partial<PackTearProps> = {}) {
  const props = baseProps(over);
  let root!: renderer.ReactTestRenderer;
  act(() => {
    root = renderer.create(React.createElement(PackTear, props));
  });
  return { root, props };
}

const byType = (root: renderer.ReactTestRenderer, type: string) => root.root.findAll((n) => n.type === type);
const rootView = (root: renderer.ReactTestRenderer) => root.root.findByProps({ accessibilityLabel: 'Reward pack' });

afterEach(() => {
  guardState.skiaAvailable = true;
  guardState.useImage = (_s: unknown) => null;
});

describe('PackTear', () => {
  it('announces the pack as an accessible button with an activate action', () => {
    const { root } = renderPack();
    const view = rootView(root);
    expect(view.props.accessibilityRole).toBe('button');
    expect(view.props.accessibilityHint).toBe('Swipe right or double-tap to open');
    expect(view.props.accessibilityActions).toContainEqual({ name: 'activate', label: 'Open pack' });
    expect(view.props.accessibilityState).toEqual({ disabled: false });
    expect(view.props.accessible).toBe(true);
    expect(view.props.accessibilityElementsHidden).toBeUndefined();
  });

  it('starts the sequence when the activate action fires, exactly once', () => {
    const { root, props } = renderPack();
    const view = rootView(root);
    act(() => {
      view.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    });
    expect(props.onTear).toHaveBeenCalledTimes(1);
    expect(props.timeline.seam.value).toBe(1);
    act(() => {
      view.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    });
    expect(props.onTear).toHaveBeenCalledTimes(1);
  });

  it('does not start when disabled', () => {
    const { root, props } = renderPack({ disabled: true });
    const view = rootView(root);
    expect(view.props.accessibilityState.disabled).toBe(true);
    act(() => {
      view.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    });
    expect(props.onTear).not.toHaveBeenCalled();
  });

  it('ignores actions other than activate', () => {
    const { root, props } = renderPack();
    const view = rootView(root);
    act(() => {
      view.props.onAccessibilityAction({ nativeEvent: { actionName: 'escape' } });
    });
    expect(props.onTear).not.toHaveBeenCalled();
  });

  it('re-arms on a fresh swipe phase so activate can fire again', () => {
    const props = baseProps();
    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(React.createElement(PackTear, props));
    });
    act(() => {
      rootView(root).props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    });
    act(() => {
      root.update(React.createElement(PackTear, { ...props, phase: 'approach' }));
    });
    act(() => {
      root.update(React.createElement(PackTear, { ...props, phase: 'swipe' }));
    });
    act(() => {
      rootView(root).props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    });
    expect(props.onTear).toHaveBeenCalledTimes(2);
  });

  it('chooses the pack testID from phase and isMulti', () => {
    expect(packTestID('swipe', true)).toBe('draw-ceremony-swipe-pack');
    expect(packTestID('approach', true)).toBe('draw-ceremony-multi-flyin');
    expect(packTestID('hold', false)).toBe('draw-ceremony-single-pack-flyin');
    expect(packTestID('tear-flip', false)).toBe('draw-ceremony-single-pack-flyin');
    const { root } = renderPack({ phase: 'hold', isMulti: true });
    expect(root.root.findByProps({ testID: 'draw-ceremony-multi-flyin' })).toBeTruthy();
    expect(root.root.findAll((n) => n.props.testID === 'draw-ceremony-swipe-pack')).toHaveLength(0);
  });

  it('renders exactly one pointerEvents-none Canvas with the expected clip groups', () => {
    const { root } = renderPack();
    const canvases = byType(root, 'Skia.Canvas');
    expect(canvases).toHaveLength(1);
    expect(canvases[0].props.pointerEvents).toBe('none');
    expect(canvases[0].props.style).toEqual({ width: 200, height: 300 });

    const groups = byType(root, 'Skia.Group');
    const pathClips = groups.filter((g) => typeof g.props.clip?.value?.moveTo === 'function');
    expect(pathClips).toHaveLength(2);
    const roundedClips = groups.filter((g) => g.props.clip?.rx !== undefined);
    expect(roundedClips).toHaveLength(1);
    expect(groups[0].props.transform.value).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
  });

  it('draws the cover image when available and falls back to a rect otherwise', () => {
    guardState.useImage = () => null;
    const fallback = renderPack();
    expect(byType(fallback.root, 'Skia.Image')).toHaveLength(0);
    const rects = byType(fallback.root, 'Skia.Rect');
    expect(rects).toHaveLength(2);
    for (const r of rects) expect(r.props.color).toBe(PALETTE.cover[1]);

    const image = { fake: true };
    guardState.useImage = () => image;
    const withImage = renderPack({ coverImage: 7 as unknown as PackTearProps['coverImage'] });
    const images = byType(withImage.root, 'Skia.Image');
    expect(images).toHaveLength(2);
    for (const img of images) {
      expect(img.props.fit).toBe('cover');
      expect(img.props.image).toBe(image);
    }
    expect(byType(withImage.root, 'Skia.Rect')).toHaveLength(0);
  });

  it('adds deck-thickness edges for multi and a seal for pity draws', () => {
    const single = renderPack();
    expect(byType(single.root, 'Skia.RoundedRect')).toHaveLength(1);
    expect(byType(single.root, 'Skia.Circle')).toHaveLength(0);

    const multi = renderPack({ isMulti: true });
    const rounded = byType(multi.root, 'Skia.RoundedRect');
    expect(rounded).toHaveLength(3);
    const deckEdges = rounded.filter((r) => r.props.x === 36 || r.props.x === 33);
    expect(deckEdges).toHaveLength(2);
    for (const edge of deckEdges) expect(edge.props.color).toBe(PALETTE.ring);

    const pity = renderPack({ pitySeal: true });
    const circles = byType(pity.root, 'Skia.Circle');
    expect(circles).toHaveLength(2);
    const larger = circles.reduce((a, b) => (a.props.r >= b.props.r ? a : b));
    expect(larger.props.color).toBe(SEAL_COLOR);
  });

  it('drives the peel, scale and card-hint transforms from the timeline', () => {
    const timeline = makeTimeline({ peel: 0.5, packScale: 1.12, cardOut: 1 });
    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(React.createElement(PackTear, baseProps({ timeline })));
    });
    const groups = byType(root, 'Skia.Group');
    const strip = groups.find((g) => g.props.transform?.value?.[0]?.perspective === 800)!;
    expect(strip.props.transform.value[0]).toEqual({ perspective: 800 });
    expect(strip.props.transform.value[1]).toEqual({ translateY: -20 });
    expect(strip.props.transform.value[2].rotateX).toBeCloseTo(PEEL_ROTATE_X_RAD * 0.5);
    expect(strip.props.opacity.value).toBe(0.5);

    const packGroup = groups[0];
    expect(packGroup.props.transform.value).toContainEqual({ scale: 1.12 });

    const cardHint = byType(root, 'Skia.RoundedRect')[0];
    expect(cardHint.props.transform.value[0].translateY).toBe(-42);
    expect(cardHint.props.opacity).toBe(timeline.cardOut);
  });

  it('computes the pure seam geometry deterministically', () => {
    expect([-5, 0, 36, 72, 100].map(seamProgressFromDelta)).toEqual([0, 0, 0.5, 1, 1]);
    expect(packBodyRect(200, 300)).toEqual({ x: 30, y: 45, width: 140, height: 210 });

    expect(SEAM_PATH_NORMALISED).toHaveLength(14);
    for (let i = 1; i < SEAM_PATH_NORMALISED.length; i += 1) {
      expect(SEAM_PATH_NORMALISED[i][0]).toBeGreaterThan(SEAM_PATH_NORMALISED[i - 1][0]);
    }
    expect(SEAM_PATH_NORMALISED[0][0]).toBe(0);
    expect(SEAM_PATH_NORMALISED[13][0]).toBe(1);
    for (const [, ny] of SEAM_PATH_NORMALISED) {
      expect(ny).toBeGreaterThan(0);
      expect(ny).toBeLessThan(1);
    }

    const body = packBodyRect(200, 300);
    const points = seamPointsPx(body);
    expect(points[0].x).toBe(body.x);
    expect(points[points.length - 1].x).toBe(body.x + body.width);
    for (const p of points) {
      expect(p.y).toBeGreaterThanOrEqual(body.y);
      expect(p.y).toBeLessThanOrEqual(body.y + body.height * 0.18);
    }

    expect(seamYAt([{ x: 0, y: 0 }, { x: 10, y: 10 }], 5)).toBe(5);
    expect(seamYAt([{ x: 0, y: 0 }, { x: 10, y: 10 }], -1)).toBe(0);
    expect(seamYAt([{ x: 0, y: 0 }, { x: 10, y: 10 }], 11)).toBe(10);
  });

  it('still exposes the accessible button when Skia is unavailable', async () => {
    guardState.skiaAvailable = false;
    vi.resetModules();
    const mod = await import('../../src/components/ceremony/PackTear');
    const onTear = vi.fn();
    const props = { ...baseProps({ onTear }) };
    let root!: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(React.createElement(mod.PackTear, props));
    });
    expect(byType(root, 'Skia.Canvas')).toHaveLength(0);
    const view = root.root.findByProps({ accessibilityLabel: 'Reward pack' });
    expect(view.props.accessibilityRole).toBe('button');
    act(() => {
      view.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    });
    expect(onTear).toHaveBeenCalledTimes(1);
  });
});
