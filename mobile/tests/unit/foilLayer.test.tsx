import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

import { FoilLayer, foilAvailable, prewarmFoilShader, FOIL_SKSL } from '../../src/components/ceremony/FoilLayer';
import { HolographicLayer, skiaAvailable } from '../../src/components/HolographicLayer';

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('FoilLayer', () => {
  it('renders null under vitest and never touches the Skia clock', () => {
    let tree: any;
    act(() => {
      tree = renderer.create(
        React.createElement(FoilLayer, { width: 80, height: 116, accentColor: '#A78BD8', rarity: 'RAR', active: true }),
      );
    });
    expect(tree.toJSON()).toBeNull();
    expect(foilAvailable).toBe(false);
  });

  it('prewarmFoilShader is a no-op without Skia and never throws', () => {
    expect(() => {
      prewarmFoilShader();
      prewarmFoilShader();
    }).not.toThrow();
    expect(FOIL_SKSL).toContain('u_tilt');
    expect(FOIL_SKSL).toContain('u_time');
    expect(FOIL_SKSL).toContain('u_res');
    expect(FOIL_SKSL).toContain('u_lut');
    expect(FOIL_SKSL).toContain('half4 main');
  });

  it('HolographicLayer shim forwards to FoilLayer', () => {
    expect(skiaAvailable).toBe(false);
    let shimmer: any;
    act(() => {
      shimmer = renderer.create(
        React.createElement(HolographicLayer, { variant: 'shimmer', width: 80, height: 116, accentColor: '#fff' }),
      );
    });
    expect(shimmer.toJSON()).toBeNull();
    let burst: any;
    act(() => {
      burst = renderer.create(
        React.createElement(HolographicLayer, { variant: 'burst', width: 80, height: 116, accentColor: '#fff' }),
      );
    });
    expect(burst.toJSON()).toBeNull();
  });
});
