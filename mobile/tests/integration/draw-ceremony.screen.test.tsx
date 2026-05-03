import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  let reduceMotionEnabled = false;
  const reduceMotionListeners = new Set<(enabled: boolean) => void>();

  class MockAnimatedValue {
    value: number;
    constructor(value: number) {
      this.value = value;
    }
    interpolate(config: any) {
      return config.outputRange?.[0] ?? this.value;
    }
    setValue(value: number) {
      this.value = value;
    }
    stopAnimation() {}
  }

  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
    AccessibilityInfo: {
      isReduceMotionEnabled: vi.fn(async () => reduceMotionEnabled),
      addEventListener: vi.fn((_event: string, listener: (enabled: boolean) => void) => {
        reduceMotionListeners.add(listener);
        return { remove: () => reduceMotionListeners.delete(listener) };
      }),
    },
    __setReduceMotionEnabled: (enabled: boolean) => {
      reduceMotionEnabled = enabled;
      reduceMotionListeners.forEach((listener) => listener(enabled));
    },
    Animated: {
      View: ({ children, ...props }: any) => React.createElement('AnimatedView', props, children),
      Value: MockAnimatedValue,
      timing: (value: any, config: any) => ({
        start: (cb?: any) => {
          if (typeof config?.toValue === 'number' && value?.setValue) value.setValue(config.toValue);
          cb?.();
        },
      }),
      spring: (value: any, config: any) => ({
        start: (cb?: any) => {
          if (typeof config?.toValue === 'number' && value?.setValue) value.setValue(config.toValue);
          cb?.();
        },
      }),
      sequence: (animations: Array<{ start: (cb?: any) => void }>) => ({
        start: (cb?: any) => {
          animations.forEach((anim) => anim.start?.());
          cb?.();
        },
      }),
      parallel: (animations: Array<{ start: (cb?: any) => void }>) => ({
        start: (cb?: any) => {
          animations.forEach((anim) => anim.start?.());
          cb?.();
        },
      }),
    },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children) };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

import * as ReactNative from 'react-native';
import { DrawCeremonyScreen } from '../../src/screens/DrawCeremonyScreen';
import { MOCK_DRAW_RESULTS } from '../../src/mock/draw';

function collectText(tree: renderer.ReactTestRenderer) {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

function flattenStyle(styleProp: any): Record<string, any> {
  if (typeof styleProp === 'function') return flattenStyle(styleProp({ pressed: false }));
  if (Array.isArray(styleProp)) return styleProp.filter(Boolean).reduce((acc, item) => ({ ...acc, ...flattenStyle(item) }), {});
  return styleProp ?? {};
}

describe('DrawCeremonyScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (ReactNative as any).__setReduceMotionEnabled(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('uses reward-draw naming consistently during ceremony', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen navigation={{ replace: vi.fn() } as any} route={{ key: 'draw-ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MOCK_DRAW_RESULTS } } as any} />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Reward draw ceremony');
    expect(textBlob).toContain('Cards entering orbit');
    expect(textBlob).toContain('Glyph field online');
    expect(textBlob).toContain('> recall.draw()');
    expect(textBlob).toContain('Featured reward window');
    expect(textBlob).toContain('LEG core breach');
    expect(textBlob).toContain('seed #');
    expect(textBlob).not.toContain('collectible reveal');
  });

  it('exposes required root and primary CTA testIDs with minimum tap size', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen navigation={{ replace: vi.fn() } as any} route={{ key: 'draw-ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MOCK_DRAW_RESULTS } } as any} />,
      );
    });

    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-root' })).toBeTruthy();
    const primaryCta = tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' });
    const flattenedStyle = flattenStyle(primaryCta.props.style);
    expect(flattenedStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(flattenedStyle.minWidth).toBeGreaterThanOrEqual(44);
  });

  it('uses a reduced-motion branch and hands off within 450ms when reduce motion is enabled', async () => {
    (ReactNative as any).__setReduceMotionEnabled(true);
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'draw-ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MOCK_DRAW_RESULTS } } as any}
        />,
      );
    });

    expect(collectText(tree)).toContain('Reduced-motion ceremony enabled');

    await act(async () => {
      vi.advanceTimersByTime(419);
    });
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(31);
    });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('keeps the 10-pull cosmic ceremony alive until the full 2200ms sequence finishes', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'draw-ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MOCK_DRAW_RESULTS } } as any}
        />,
      );
    });

    expect(collectText(tree)).toContain('Cards entering orbit');

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(collectText(tree)).toContain('Center card charging the reveal');
    expect(collectText(tree)).toContain('Final breach armed');
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(collectText(tree)).toContain('Result spread stabilizing');
    expect(collectText(tree)).toContain('Center card revealed last');
    expect(collectText(tree)).toContain('Flip axis at 180°');
    expect(collectText(tree)).toContain(MOCK_DRAW_RESULTS.cards[0].question);
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(replace).toHaveBeenCalledWith(
      'DrawResult',
      expect.objectContaining({
        slug: 'csharp',
        drawResult: MOCK_DRAW_RESULTS,
        ceremonyEcho: {
          rarity: 'LEG',
          phaseCue: 'Center card revealed last · Flip axis at 180°',
        },
      }),
    );
  });

  it('runs a dedicated single-pull ceremony before handing off to the result page', async () => {
    const replace = vi.fn();
    const singlePull = { ...MOCK_DRAW_RESULTS, cards: [MOCK_DRAW_RESULTS.cards[0]] };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'draw-ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: singlePull } } as any}
        />,
      );
    });

    expect(collectText(tree)).toContain('Single pull reveal warming up');
    expect(collectText(tree)).toContain('Tap to reveal');
    expect(collectText(tree)).toContain('RAR resonance');

    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(collectText(tree)).toContain('Single pull locking onto the center card');
    expect(collectText(tree)).toContain('Flip breach armed');
    expect(collectText(tree)).toContain('Tap to reveal');

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(collectText(tree)).toContain('Single pull reward revealed');
    expect(collectText(tree)).toContain('Front face unlocked');
    expect(collectText(tree)).toContain('Flip axis at 180°');
    expect(collectText(tree)).toContain(singlePull.cards[0].question);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(replace).toHaveBeenCalledWith(
      'DrawResult',
      expect.objectContaining({
        slug: 'csharp',
        drawResult: singlePull,
        ceremonyEcho: {
          rarity: 'RAR',
          phaseCue: 'Front face unlocked · Flip axis at 180°',
        },
      }),
    );
  });
});
