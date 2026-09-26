// G42 (MGACHA-10) — TapCard now passes the holographic foil LUT so FoilLayer's
// SkSL branch has a LUT to sample. Mirrors tapCard.test.tsx's RN / expo-linear-
// gradient mocks (the ceremony setup owns the guard, Skia and gesture-handler)
// and mocks FoilLayer to a host element so its props can be read directly.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

vi.mock('../../src/components/ceremony/FoilLayer', () => {
  const React = require('react');
  return { FoilLayer: ({ children, ...props }: any) => React.createElement('FoilLayer', props, children) };
});

import { TapCard, type TapCardProps } from '../../src/components/ceremony/TapCard';
import { FOIL_LUT } from '../../src/theme/packArt';

const TIMINGS = { flipMs: { COM: 0, RAR: 0, LEG: 0 }, rimSettleMs: { COM: 0, RAR: 0, LEG: 0 }, liftMs: 0, landMs: 0 };

function renderCard(overrides: Partial<TapCardProps> = {}) {
  const props: TapCardProps = {
    card: { stableUid: 'u1', question: 'Q?', difficulty: 5, rarity: 'RAR' },
    index: 0, total: 2, width: 80, height: 116,
    disabled: false, flipped: true,
    onFlipped: vi.fn(), reduceMotion: false, timings: TIMINGS,
    ...overrides,
  };
  let tree: any;
  act(() => {
    tree = renderer.create(React.createElement(TapCard, props));
  });
  return { tree, props };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('TapCard foil LUT', () => {
  it('passes the foil LUT to the focused rare card', () => {
    const { tree } = renderCard({ focused: true, flipped: true });
    const foils = tree.root.findAll((n: any) => n.type === 'FoilLayer');
    expect(foils).toHaveLength(1);
    expect(foils[0].props.lut).toBe(FOIL_LUT);
  });
});
