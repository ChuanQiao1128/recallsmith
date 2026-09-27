// RevealSpotlight light pillar (I06) — the Skia beam behind the hero. Mocks the guard with a
// recording Skia host surface so the pillar Rect + its LinearGradient can be inspected; the
// pillar never mounts without Skia or under Reduce Motion.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

const guardState = vi.hoisted(() => ({ skiaAvailable: true }));

vi.mock('../../src/components/ceremony/reanimatedGuard', () => {
  const React = require('react');
  const host = (name: string) => (p: any) => React.createElement(`Skia.${name}`, p, p.children);
  const SkiaModule = {
    Canvas: host('Canvas'), Group: host('Group'), Rect: host('Rect'), Atlas: host('Atlas'),
    SweepGradient: host('SweepGradient'), RadialGradient: host('RadialGradient'), LinearGradient: host('LinearGradient'),
    BlendColor: host('BlendColor'),
    useImage: () => null, useRSXformBuffer: () => [],
    vec: (x: number, y: number) => ({ x, y }), rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
  };
  const identity = (t: number) => t;
  const Reanimated = {
    useSharedValue: (v: any) => ({ value: v }), useDerivedValue: (fn: () => any) => ({ value: fn() }),
    useAnimatedStyle: (fn: () => any) => fn(), useAnimatedReaction: () => undefined,
    withTiming: (to: any) => to, withSpring: (to: any) => to, withDelay: (_ms: number, a: any) => a,
    withSequence: (...a: any[]) => a[a.length - 1], withRepeat: (a: any) => a,
    cancelAnimation: () => undefined, runOnJS: (fn: any) => fn,
    interpolate: (_v: number, _i: number[], o: number[]) => o[0],
    interpolateColor: (_v: number, _i: number[], o: string[]) => o[0],
    Easing: { bezier: () => identity, linear: identity, out: (e: any) => e, in: (e: any) => e, cubic: identity, quad: identity },
    View: (p: any) => React.createElement('Animated.View', p, p.children), createAnimatedComponent: (c: any) => c,
  };
  return { get skiaAvailable() { return guardState.skiaAvailable; }, motionAvailable: false, SkiaModule, Reanimated, GestureHandler: { available: false } };
});

import { RevealSpotlight, RevealSpotlightProps, SPOTLIGHT_PILLAR_COLORS } from '../../src/components/ceremony/RevealSpotlight';

const COVER = ['#5C3DA0', '#7A4DC4', '#A77FE0', '#5C3DA0'] as const;

function makeProps(overrides: Partial<RevealSpotlightProps> = {}): RevealSpotlightProps {
  return {
    card: { stableUid: '1', question: 'A question that needs the read-full sheet on the runtime.', rarity: 'RAR' },
    index: 0,
    total: 1,
    visible: true,
    interactive: true,
    reduceMotion: false,
    packPaletteCover: COVER,
    ...overrides,
  };
}

function render(overrides: Partial<RevealSpotlightProps> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(React.createElement(RevealSpotlight, makeProps(overrides)));
  });
  return tree;
}

const pillars = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((n) => (n.type as any) === 'Skia.Rect' && n.props.testID === 'reveal-spotlight-pillar');

afterEach(() => {
  guardState.skiaAvailable = true;
});

describe('RevealSpotlight light pillar', () => {
  it('draws the light pillar behind the card only with Skia and never under reduce motion', () => {
    // With Skia and motion: exactly one pillar Rect with a vertical rarity-coloured gradient.
    const tree = render({ reduceMotion: false });
    expect(pillars(tree)).toHaveLength(1);
    const grad = pillars(tree)[0].findAll((n) => (n.type as any) === 'Skia.LinearGradient');
    expect(grad.length).toBeGreaterThan(0);
    expect(grad[0].props.colors).toContain(SPOTLIGHT_PILLAR_COLORS.RAR);

    // Under Reduce Motion the SpotlightCanvas (and its pillar) never mounts.
    expect(pillars(render({ reduceMotion: true }))).toHaveLength(0);
  });

  it('never draws the pillar without Skia', () => {
    guardState.skiaAvailable = false;
    expect(pillars(render({ reduceMotion: false }))).toHaveLength(0);
  });
});
