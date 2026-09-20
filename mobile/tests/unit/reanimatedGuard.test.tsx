import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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
    StyleSheet: { create: (styles: any) => styles },
  };
});

import {
  GestureHandler,
  Reanimated,
  SkiaModule,
  motionAvailable,
  skiaAvailable,
} from '../../src/components/ceremony/reanimatedGuard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('reanimatedGuard', () => {
  it('reports no motion under vitest', () => {
    expect(motionAvailable).toBe(false);
    expect(skiaAvailable).toBe(false);
    expect(SkiaModule).toBeNull();
    expect(GestureHandler.available).toBe(false);
    expect((globalThis as { __CEREMONY_MOTION_AVAILABLE__?: unknown }).__CEREMONY_MOTION_AVAILABLE__).toBe(false);
  });

  it('animation helpers return their targets immediately', () => {
    const cb = vi.fn();
    expect(Reanimated.withTiming(0.85, { duration: 60 }, cb)).toBe(0.85);
    expect(cb).toHaveBeenCalledWith(true);
    expect(Reanimated.withSpring(1)).toBe(1);
    expect(Reanimated.withDelay(100, 0.5)).toBe(0.5);
    expect(Reanimated.withSequence(1, 0.3, 0)).toBe(0);
    expect(Reanimated.withRepeat(0.2, -1, true)).toBe(0.2);
    const fn = () => {};
    expect(Reanimated.runOnJS(fn)).toBe(fn);
    expect(Reanimated.cancelAnimation({ value: 1 })).toBeUndefined();
  });

  it('interpolates numbers and colours in plain JS', () => {
    expect(Reanimated.interpolate(0.5, [0, 1], [0, 100])).toBe(50);
    expect(Reanimated.interpolate(2, [0, 1], [0, 100])).toBe(200);
    expect(Reanimated.interpolate(0.25, [0, 0.5, 1], [0, 10, 100])).toBe(5);
    expect(Reanimated.interpolateColor(0.5, [0, 1], ['#000000', '#FFFFFF'])).toBe('rgba(128,128,128,1)');
    expect(Reanimated.interpolateColor(0, [0, 1], ['#FFF7EC', '#A78BD8'])).toBe('#FFF7EC');
    expect(Reanimated.interpolateColor(1, [0, 1], ['#FFF7EC', '#A78BD8'])).toBe('#A78BD8');
  });

  it('easings are identity curves with the same shape', () => {
    expect(Reanimated.Easing.bezier(0.05, 0.7, 0.1, 1)(0.3)).toBe(0.3);
    expect(Reanimated.Easing.out(Reanimated.Easing.cubic)(0.7)).toBe(0.7);
    expect(Reanimated.Easing.in(Reanimated.Easing.quad)(0.2)).toBe(0.2);
    expect(Reanimated.Easing.linear(0.9)).toBe(0.9);
  });

  it('hooks behave as plain refs inside a component', () => {
    const captured: Array<{ sv: any; derived: any; style: any; reaction: any }> = [];

    function Probe() {
      const sv = Reanimated.useSharedValue(3);
      const derived = Reanimated.useDerivedValue(() => sv.value * 2);
      const style = Reanimated.useAnimatedStyle(() => ({ opacity: 0.5 }));
      const reaction = Reanimated.useAnimatedReaction();
      captured.push({ sv, derived, style, reaction });
      return null;
    }

    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(React.createElement(Probe));
    });
    act(() => {
      tree.update(React.createElement(Probe));
    });

    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(captured[1].sv).toBe(captured[0].sv);
    expect(captured[1].derived.value).toBe(6);
    expect(captured[1].style).toEqual({ opacity: 0.5 });
    expect(captured[1].reaction).toBeUndefined();

    act(() => {
      tree.unmount();
    });
  });

  it('falls back to RN View and inert gestures', () => {
    const Probe = () => null;
    expect(Reanimated.createAnimatedComponent(Probe)).toBe(Probe);

    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(React.createElement(Reanimated.View, { testID: 'x' }));
    });
    const host = tree.toJSON() as { type: string; props: { testID?: string } };
    expect(host.type).toBe('View');
    expect(host.props.testID).toBe('x');
    act(() => {
      tree.unmount();
    });

    let hostRoot!: ReactTestRenderer;
    act(() => {
      hostRoot = renderer.create(
        React.createElement(GestureHandler.PanHost, { gesture: {} }, React.createElement('Text', null, 'child')),
      );
    });
    const rendered = hostRoot.toJSON() as { type: string; children: unknown[] };
    expect(rendered.type).toBe('Text');
    expect(rendered.children).toEqual(['child']);
    act(() => {
      hostRoot.unmount();
    });

    const chained = GestureHandler.Gesture.Pan().onUpdate(() => {}).enabled(false).activeOffsetX([-10, 10]).runOnJS(true);
    expect(typeof chained.onEnd).toBe('function');
  });
});
