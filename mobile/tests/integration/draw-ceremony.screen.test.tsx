import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let reduceMotionEnabled = false;
let windowWidth = 390;
const reduceMotionListeners = new Set<(enabled: boolean) => void>();

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
    AccessibilityInfo: {
      isReduceMotionEnabled: vi.fn(async () => reduceMotionEnabled),
      addEventListener: vi.fn((_event: string, listener: (enabled: boolean) => void) => {
        reduceMotionListeners.add(listener);
        return { remove: () => reduceMotionListeners.delete(listener) };
      }),
    },
    useWindowDimensions: () => ({ width: windowWidth, height: 844, scale: 3, fontScale: 1 }),
    __setReduceMotionEnabled: (enabled: boolean) => {
      reduceMotionEnabled = enabled;
      reduceMotionListeners.forEach((listener) => listener(enabled));
    },
    __setWindowWidth: (width: number) => {
      windowWidth = width;
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

const MULTI_DRAW_RESULT = {
  poolId: 'csharp',
  pityBefore: 0,
  pityAfter: 1,
  pityTriggered: false,
  highlightedRarity: 'LEG' as const,
  cards: [
    { stableUid: '1', question: 'Q1', difficulty: 3, rarity: 'LEG' as const },
    { stableUid: '2', question: 'Q2', difficulty: 2, rarity: 'RAR' as const },
  ],
};

const SINGLE_DRAW_RESULT = {
  poolId: 'csharp',
  pityBefore: 0,
  pityAfter: 1,
  pityTriggered: false,
  highlightedRarity: 'RAR' as const,
  cards: [{ stableUid: '1', question: 'Q1', difficulty: 2, rarity: 'RAR' as const }],
};

const MULTI_TIMING = {
  approach: 620,
  hold: 300,
  tearFlip: 940,
  flashReveal: 280,
  settle: 300,
};

const SINGLE_TIMING = {
  approach: 300,
  hold: 180,
  tearFlip: 360,
  flashReveal: 220,
  settle: 200,
};

const REDUCED_TIMING = {
  flashReveal: 180,
  settle: 240,
};

function collectText(tree: renderer.ReactTestRenderer) {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

function phaseTitle(tree: renderer.ReactTestRenderer) {
  const value = tree.root.findByProps({ testID: 'draw-ceremony-phase-copy' }).props.children;
  return Array.isArray(value) ? value.join('') : String(value ?? '');
}

function phaseBody(tree: renderer.ReactTestRenderer) {
  const value = tree.root.findByProps({ testID: 'draw-ceremony-phase-body-copy' }).props.children;
  return Array.isArray(value) ? value.join('') : String(value ?? '');
}

function armCeremonySwipe(tree: renderer.ReactTestRenderer) {
  const stage = tree.root.findByProps({ testID: 'draw-ceremony-stage' });
  act(() => {
    stage.props.onResponderGrant({ nativeEvent: { pageX: 16 } });
    stage.props.onResponderMove({ nativeEvent: { pageX: 104 } });
    stage.props.onResponderRelease({ nativeEvent: { pageX: 104 } });
  });
}

describe('DrawCeremonyScreen v9', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (ReactNative as any).__setReduceMotionEnabled(false);
    (ReactNative as any).__setWindowWidth(390);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps multi timing in commercial window and unlocks skip only in settle', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    expect(collectText(tree)).toContain('Swipe to open');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);
    armCeremonySwipe(tree);
    expect(collectText(tree)).toContain('Legendary inbound');
    const multiTotal =
      MULTI_TIMING.approach +
      MULTI_TIMING.hold +
      MULTI_TIMING.tearFlip +
      MULTI_TIMING.flashReveal +
      MULTI_TIMING.settle;
    expect(multiTotal).toBeGreaterThanOrEqual(2100);
    expect(multiTotal).toBeLessThanOrEqual(2600);

    await act(async () => {
      vi.advanceTimersByTime(MULTI_TIMING.approach - 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Legendary inbound');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Hold steady');

    await act(async () => {
      vi.advanceTimersByTime(MULTI_TIMING.hold - 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Hold steady');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Opening carousel');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(MULTI_TIMING.tearFlip - 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Opening carousel');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Card revealed');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(MULTI_TIMING.flashReveal - 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Card revealed');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Cards in place');
    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();
    expect(tree.root.findByProps({ nativeID: 'draw-ceremony-skip-hint' })).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(820);
    });

    expect(replace).toHaveBeenCalledWith(
      'DrawResult',
      expect.objectContaining({
        slug: 'csharp',
        drawResult: MULTI_DRAW_RESULT,
      }),
    );
  });

  it('keeps single timing in commercial window with ordered phase transitions', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: SINGLE_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    armCeremonySwipe(tree);
    expect(phaseTitle(tree)).toContain('Rare inbound');

    const singleTotal =
      SINGLE_TIMING.approach +
      SINGLE_TIMING.hold +
      SINGLE_TIMING.tearFlip +
      SINGLE_TIMING.flashReveal +
      SINGLE_TIMING.settle;
    expect(singleTotal).toBeGreaterThanOrEqual(1100);
    expect(singleTotal).toBeLessThanOrEqual(1400);

    await act(async () => {
      vi.advanceTimersByTime(SINGLE_TIMING.approach - 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Rare inbound');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Hold steady');

    await act(async () => {
      vi.advanceTimersByTime(SINGLE_TIMING.hold - 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Hold steady');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Opening reveal');

    await act(async () => {
      vi.advanceTimersByTime(SINGLE_TIMING.tearFlip - 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Opening reveal');

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Card revealed');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(SINGLE_TIMING.flashReveal);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Cards in place');
    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();
  });

  it('keeps skip locked through tear-flip and advances fallback orbit continuously', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(980);
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'draw-ceremony-orbit-stage' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    const orbitStart = parseFloat(
      String(tree.root.findByProps({ testID: 'draw-ceremony-orbit-progress' }).props.children),
    );
    const sampleStart = Number(
      tree.root.findByProps({ testID: 'draw-ceremony-orbit-samples' }).props.children,
    );

    await act(async () => {
      vi.advanceTimersByTime(450);
      await Promise.resolve();
    });

    const orbitMid = parseFloat(
      String(tree.root.findByProps({ testID: 'draw-ceremony-orbit-progress' }).props.children),
    );
    const sampleMid = Number(
      tree.root.findByProps({ testID: 'draw-ceremony-orbit-samples' }).props.children,
    );
    expect(orbitMid).toBeGreaterThan(orbitStart);
    expect(sampleMid).toBeGreaterThan(sampleStart);
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
    });

    const orbitLate = parseFloat(
      String(tree.root.findByProps({ testID: 'draw-ceremony-orbit-progress' }).props.children),
    );
    expect(orbitLate).toBeGreaterThan(orbitMid);
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(520);
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();
  });

  it('supports reduced-motion fast path with settle-gated skip and <=450ms handoff', async () => {
    (ReactNative as any).__setReduceMotionEnabled(true);
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT } } as any}
        />,
      );
    });

    expect(collectText(tree)).toContain('Card revealed');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(REDUCED_TIMING.flashReveal - 1);
    });
    expect(phaseTitle(tree)).toContain('Card revealed');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(phaseTitle(tree)).toContain('Cards in place');
    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(REDUCED_TIMING.settle - 1);
    });
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('uses rarity-based flash colors', async () => {
    const replace = vi.fn();

    const rarResult = {
      ...MULTI_DRAW_RESULT,
      highlightedRarity: 'RAR' as const,
      cards: [{ stableUid: '1', question: 'Q1', difficulty: 2, rarity: 'RAR' as const }],
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: rarResult } } as any}
        />,
      );
    });
    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(
        SINGLE_TIMING.approach + SINGLE_TIMING.hold + SINGLE_TIMING.tearFlip + 1,
      );
    });

    const flash = tree.root.findByProps({ testID: 'draw-ceremony-reveal-flash' });
    expect(flash.props.style[1].backgroundColor).toBe('rgba(201,173,247,0.95)');
    expect(phaseBody(tree).trim().length).toBeGreaterThan(0);
  });

  it('uses single-draw tear copy without ten-card wording', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: SINGLE_DRAW_RESULT } } as any}
        />,
      );
    });
    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    const copy = collectText(tree);
    expect(copy).toContain('Your card is spinning into place.');
    expect(copy).not.toContain('Ten cards are spinning into place.');
  });

  it('uses a dedicated single-pack approach path without multi side lanes', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: SINGLE_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(180);
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'draw-ceremony-single-pack-flyin' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-multi-flyin' })).toHaveLength(0);
  });

  it.each([360, 375, 390, 430])('keeps ceremony contract stable at width %ipx', async (width) => {
    (ReactNative as any).__setWindowWidth(width);
    (ReactNative as any).__setReduceMotionEnabled(true);

    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-root' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-ceremony-stage' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(REDUCED_TIMING.flashReveal);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();

    const ctaText = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .find((node) => node.props.children === 'Show result');
    expect(ctaText).toBeTruthy();
    expect(ctaText?.props.numberOfLines).toBe(1);
  });

  it('shows deterministic reveal semantics for reduced-motion when lottie path is available', async () => {
    vi.resetModules();
    vi.doMock('../../src/components/CeremonyLottie', async () => {
      const actual = await vi.importActual<any>('../../src/components/CeremonyLottie');
      const React = require('react');
      return {
        ...actual,
        ceremonyLottieAvailable: true,
        CeremonyLottie: ({ onAnimationFinish }: any) =>
          React.createElement('View', { testID: 'mock-ceremony-lottie', onAnimationFinish }),
      };
    });

    const { DrawCeremonyScreen: DrawCeremonyScreenWithLottie } = await import(
      '../../src/screens/DrawCeremonyScreen'
    );
    (ReactNative as any).__setReduceMotionEnabled(true);

    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreenWithLottie
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'draw-ceremony-reveal-rarity' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-ceremony-reveal-question' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(REDUCED_TIMING.flashReveal - 1);
      await Promise.resolve();
    });
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(REDUCED_TIMING.settle - 1);
      await Promise.resolve();
    });
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledTimes(1);

    vi.doUnmock('../../src/components/CeremonyLottie');
    vi.resetModules();
  });

  it('ignores early lottie finish before settle', async () => {
    vi.resetModules();
    vi.doMock('../../src/components/CeremonyLottie', async () => {
      const actual = await vi.importActual<any>('../../src/components/CeremonyLottie');
      const React = require('react');
      return {
        ...actual,
        ceremonyLottieAvailable: true,
        CeremonyLottie: ({ onAnimationFinish }: any) =>
          React.createElement('View', { testID: 'mock-ceremony-lottie', onAnimationFinish }),
      };
    });

    const { DrawCeremonyScreen: DrawCeremonyScreenWithLottie } = await import(
      '../../src/screens/DrawCeremonyScreen'
    );

    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreenWithLottie
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT } } as any}
        />,
      );
    });

    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    const lottie = tree.root.findByProps({ testID: 'mock-ceremony-lottie' });
    act(() => {
      lottie.props.onAnimationFinish();
    });
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1140);
    });
    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();

    const settledLottie = tree.root.findByProps({ testID: 'mock-ceremony-lottie' });
    act(() => {
      settledLottie.props.onAnimationFinish();
    });
    expect(replace).toHaveBeenCalledTimes(1);

    vi.doUnmock('../../src/components/CeremonyLottie');
    vi.resetModules();
  });

  it('keeps normal-motion lottie multi choreography and cadence parity', async () => {
    vi.resetModules();
    vi.doMock('../../src/components/CeremonyLottie', async () => {
      const actual = await vi.importActual<any>('../../src/components/CeremonyLottie');
      const React = require('react');
      return {
        ...actual,
        ceremonyLottieAvailable: true,
        CeremonyLottie: ({ onAnimationFinish }: any) =>
          React.createElement('View', { testID: 'mock-ceremony-lottie', onAnimationFinish }),
      };
    });

    const { DrawCeremonyScreen: DrawCeremonyScreenWithLottie } = await import(
      '../../src/screens/DrawCeremonyScreen'
    );

    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreenWithLottie
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    expect(phaseTitle(tree)).toContain('Swipe to open');
    armCeremonySwipe(tree);
    expect(phaseTitle(tree)).toContain('Legendary inbound');

    await act(async () => {
      vi.advanceTimersByTime(620);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-hold-marker' })).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-orbit-stage' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-ceremony-orbit-mode' }).props.children).toBe('lottie');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    const orbitStart = parseFloat(
      String(tree.root.findByProps({ testID: 'draw-ceremony-orbit-progress' }).props.children),
    );
    const focusStart = parseFloat(
      String(tree.root.findByProps({ testID: 'draw-ceremony-orbit-focus' }).props.children),
    );
    const samplesStart = Number(
      tree.root.findByProps({ testID: 'draw-ceremony-orbit-samples' }).props.children,
    );

    await act(async () => {
      vi.advanceTimersByTime(470);
      await Promise.resolve();
    });

    const orbitMid = parseFloat(
      String(tree.root.findByProps({ testID: 'draw-ceremony-orbit-progress' }).props.children),
    );
    const focusMid = parseFloat(
      String(tree.root.findByProps({ testID: 'draw-ceremony-orbit-focus' }).props.children),
    );
    const samplesMid = Number(
      tree.root.findByProps({ testID: 'draw-ceremony-orbit-samples' }).props.children,
    );
    expect(orbitMid).toBeGreaterThan(orbitStart);
    expect(focusMid).toBeGreaterThan(focusStart);
    expect(samplesMid).toBeGreaterThan(samplesStart);
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(470);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-reveal-flash' }).props.style[1].opacity).toBe(
      0.85,
    );
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(280);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();

    act(() => {
      tree.unmount();
    });

    vi.doUnmock('../../src/components/CeremonyLottie');
    vi.resetModules();
  });

  it('keeps lottie single draw path free of multi-only orbit choreography', async () => {
    vi.resetModules();
    vi.doMock('../../src/components/CeremonyLottie', async () => {
      const actual = await vi.importActual<any>('../../src/components/CeremonyLottie');
      const React = require('react');
      return {
        ...actual,
        ceremonyLottieAvailable: true,
        CeremonyLottie: ({ onAnimationFinish }: any) =>
          React.createElement('View', { testID: 'mock-ceremony-lottie', onAnimationFinish }),
      };
    });

    const { DrawCeremonyScreen: DrawCeremonyScreenWithLottie } = await import(
      '../../src/screens/DrawCeremonyScreen'
    );

    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreenWithLottie
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: SINGLE_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-single-pack-flyin' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-multi-flyin' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(640);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'mock-ceremony-lottie' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-orbit-stage' })).toHaveLength(0);

    act(() => {
      tree.unmount();
    });

    vi.doUnmock('../../src/components/CeremonyLottie');
    vi.resetModules();
  });
});
