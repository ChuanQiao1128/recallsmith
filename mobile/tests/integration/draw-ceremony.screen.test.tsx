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
import { getActiveCeremonyPerf, clearActiveCeremonyPerf } from '../../src/features/gacha/draw/ceremonyPerf';

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
    expect(collectText(tree)).toContain('Pack inbound');
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
    expect(phaseTitle(tree)).toContain('Pack inbound');

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
    expect(phaseTitle(tree)).toContain('Pack open');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(MULTI_TIMING.flashReveal - 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Pack open');
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
    expect(phaseTitle(tree)).toContain('Pack inbound');

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
    expect(phaseTitle(tree)).toContain('Pack inbound');

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
    expect(phaseTitle(tree)).toContain('Pack open');
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

    expect(collectText(tree)).toContain('Pack open');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(REDUCED_TIMING.flashReveal - 1);
    });
    expect(phaseTitle(tree)).toContain('Pack open');
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

  it('keeps normal-motion multi choreography and cadence parity', async () => {
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

    expect(phaseTitle(tree)).toContain('Swipe to open');
    armCeremonySwipe(tree);
    expect(phaseTitle(tree)).toContain('Pack inbound');

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
    expect(tree.root.findByProps({ testID: 'draw-ceremony-orbit-mode' }).props.children).toBe('fallback');
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
  });

  it('reaches the tap-to-flip table by timer when tapFlow is on and flips only on the table', async () => {
    // Grammar: the table is entered from settle by timer (settleMs + tableTailMs), never a native callback.
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT, tapFlow: true } } as any}
        />,
      );
      await Promise.resolve();
    });

    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(620 + 300 + 940 + 1);
      await Promise.resolve();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'tap-card-0' }).props.onPress();
      await Promise.resolve();
    });
    expect(tree.root.findAllByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'tap-card-0' }).props.accessibilityLabel).toBe('Card 1 of 2, face down');

    await act(async () => {
      vi.advanceTimersByTime(280);
      await Promise.resolve();
    });
    expect(
      tree.root.findAll((n) => (n.type as any) === 'Text').find((n) => n.props.children === 'Show result'),
    ).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(300 + 500);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-cards-on-table' })).toBeTruthy();
    expect(
      tree.root.findAll((n) => (n.type as any) === 'Text').find((n) => n.props.children === 'Skip · 0/2'),
    ).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'tap-card-0' }).props.onPress();
      await Promise.resolve();
    });
    expect(
      tree.root.findAll((n) => (n.type as any) === 'Text').find((n) => n.props.children === 'Skip · 1/2'),
    ).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'tap-card-1' }).props.onPress();
      await Promise.resolve();
    });
    expect(
      tree.root.findAll((n) => (n.type as any) === 'Text').find((n) => n.props.children === 'Continue'),
    ).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' }).props.onPress();
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledWith(
      'DrawResult',
      expect.objectContaining({
        revealedUids: ['1', '2'],
        ceremonyEcho: expect.objectContaining({ tableReached: true }),
      }),
    );
  });

  it('keeps the rarity word out of every text before a card is face up', async () => {
    // Grammar: the rarity word is withheld from the tree until a card is face up (B00 §3.6).
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: SINGLE_DRAW_RESULT, tapFlow: true } } as any}
        />,
      );
      await Promise.resolve();
    });

    expect(collectText(tree)).not.toContain('Rare');
    expect(collectText(tree)).not.toContain('Legendary');

    armCeremonySwipe(tree);
    expect(collectText(tree)).not.toContain('Rare');

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(collectText(tree)).not.toContain('Rare');

    await act(async () => {
      vi.advanceTimersByTime(180);
      await Promise.resolve();
    });
    expect(collectText(tree)).not.toContain('Rare');

    await act(async () => {
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });
    expect(collectText(tree)).not.toContain('Rare');

    await act(async () => {
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });
    expect(collectText(tree)).not.toContain('Rare');
    expect(collectText(tree)).not.toContain('Legendary');

    await act(async () => {
      vi.advanceTimersByTime(200 + 500);
      await Promise.resolve();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'tap-card-0' }).props.onPress();
      await Promise.resolve();
    });
    expect(collectText(tree)).toContain('Rare');
  });

  it('reduced motion with tapFlow keeps the reveal on the table with no flash', async () => {
    // Grammar: Reduce Motion is a parallel path that still reaches the table; the flash never fires.
    (ReactNative as any).__setReduceMotionEnabled(true);
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT, tapFlow: true } } as any}
        />,
      );
      await Promise.resolve();
    });

    expect(phaseTitle(tree)).toContain('Pack open');
    expect(tree.root.findByProps({ testID: 'draw-ceremony-reveal-flash' }).props.style[1].opacity).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(180);
      await Promise.resolve();
    });
    expect(
      tree.root.findAll((n) => (n.type as any) === 'Text').find((n) => n.props.children === 'Show result'),
    ).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(240);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-cards-on-table' })).toBeTruthy();
    expect(
      tree.root.findAll((n) => (n.type as any) === 'Text').find((n) => n.props.children === 'Skip · 0/2'),
    ).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-ceremony-reveal-flash' }).props.style[1].opacity).toBe(0);
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      tree.root.findByProps({ testID: 'tap-card-0' }).props.onPress();
      await Promise.resolve();
    });
    expect(
      tree.root.findAll((n) => (n.type as any) === 'Text').find((n) => n.props.children === 'Skip · 1/2'),
    ).toBeTruthy();
  });

  it('exposes the pack as an accessible button whose activate action starts the ceremony', async () => {
    // Grammar: onTear is shared — the pack's activate action starts the same sequence as a swipe.
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

    const pack = tree.root.findByProps({ accessibilityLabel: 'Reward pack' });
    expect(pack.props.accessibilityRole).toBe('button');
    expect(pack.props.accessibilityActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'activate' })]),
    );

    await act(async () => {
      pack.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Pack inbound');
  });

  it('renders the fallback stage when motion is unavailable and still reaches settle', async () => {
    // Grammar: under vitest the renderer is always 'fallback'; the Skia canvas never mounts.
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

    expect(tree.root.findByProps({ testID: 'draw-ceremony-fallback-stage' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-stage-canvas' })).toHaveLength(0);

    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(300 + 180 + 360 + 220);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).toContain('Cards in place');
  });

  it('spills exactly as many cards as were drawn', async () => {
    // Grammar: the deal renders exactly cards.length spill views, never padded.
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
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-spill-card-0' }).length).toBeGreaterThanOrEqual(1);
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-spill-card-1' }).length).toBeGreaterThanOrEqual(1);
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-spill-card-2' })).toHaveLength(0);
  });

  it('lets a repeat user compress from hold without leaving the ceremony', async () => {
    // Grammar: skipPolicy returns only 'none' | 'compress'; compress never calls goResult.
    vi.resetModules();
    vi.doMock('../../src/features/gacha/draw/ceremonyPrefs', async () => ({
      ...(await vi.importActual<any>('../../src/features/gacha/draw/ceremonyPrefs')),
      readCeremoniesCompleted: async () => 1,
    }));
    const { DrawCeremonyScreen: Screen } = await import('../../src/screens/DrawCeremonyScreen');

    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Screen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT } } as any}
        />,
      );
      await Promise.resolve();
    });

    armCeremonySwipe(tree);

    await act(async () => {
      vi.advanceTimersByTime(620 + 179);
      await Promise.resolve();
    });
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-fast-forward' })).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-fast-forward' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'draw-ceremony-fast-forward' }).props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(0 + 588 + 280);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'screen-draw-ceremony-primary-cta' })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();

    vi.doUnmock('../../src/features/gacha/draw/ceremonyPrefs');
    vi.resetModules();
  });

  it('never shows a fast-forward control on a first-ever ceremony before settle', async () => {
    // Grammar: skipPolicy fails closed — a first-ever ceremony shows nothing before settle.
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

    const assertControls = () => {
      expect(tree.root.findAllByProps({ testID: 'draw-ceremony-fast-forward' })).toHaveLength(0);
      expect(tree.root.findByProps({ accessibilityLabel: 'Leave ceremony' })).toBeTruthy();
    };

    assertControls();
    armCeremonySwipe(tree);
    assertControls();

    await act(async () => {
      vi.advanceTimersByTime(620);
      await Promise.resolve();
    });
    assertControls();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    assertControls();

    await act(async () => {
      vi.advanceTimersByTime(940);
      await Promise.resolve();
    });
    assertControls();
  });
  it('commits the tap table hidden from hold (warm) and shows it at flash-reveal — same cards, no new mounts', async () => {
    // Perf: the table's native views and bitmaps are created during the still hold phase,
    // not on the flash frame. Hidden = out of flow, invisible, non-interactive, VoiceOver-hidden.
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT, tapFlow: true } } as any}
        />,
      );
      await Promise.resolve();
    });
    const tableContainers = () =>
      tree.root.findAll((n) => (n.type as any) === 'View' && n.findAll((c) => c.props?.testID === 'tap-card-0').length > 0 && n.props.pointerEvents !== undefined);

    const hostCards = () => tree.root.findAll((n) => (n.type as any) === 'Pressable' && n.props.testID === 'tap-card-0');
    expect(hostCards()).toHaveLength(0);
    armCeremonySwipe(tree);
    // approach: still no table
    expect(hostCards()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(620 + 1);
      await Promise.resolve();
    });
    expect(phaseTitle(tree)).not.toBe('Pack inbound');
    // hold: the cards exist but are warm-hidden
    const warmCards = hostCards();
    expect(warmCards).toHaveLength(1);
    const warm = tableContainers()[0];
    expect(warm.props.pointerEvents).toBe('none');
    expect(warm.props.accessibilityElementsHidden).toBe(true);
    expect(warm.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(warm.props.testID).toBeUndefined();
    expect(warm.props.style.opacity).toBe(0);
    expect(warmCards[0].props.disabled).toBe(true);
    expect(warmCards[0].props.accessibilityLabel).toBe('Card 1 of 2, face down');
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-cards-on-table' })).toHaveLength(0);
    // the rarity word is still withheld while the table is warm
    expect(collectText(tree)).not.toContain('Legendary');
    expect(collectText(tree)).not.toContain('Rare');

    await act(async () => {
      vi.advanceTimersByTime(300 + 940);
      await Promise.resolve();
    });
    // flash-reveal: the same container turns visible and interactive-ready (cards still disabled)
    const shown = tree.root.find((n) => (n.type as any) === 'View' && n.findAll((c) => c.props?.testID === 'tap-card-0').length > 0 && n.props.accessibilityElementsHidden === false);
    expect(shown.props.pointerEvents).toBeUndefined();
    expect(shown.props.style.opacity).toBeUndefined();
    expect(tree.root.findByProps({ testID: 'tap-card-0' }).props.disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(280 + 300 + 500);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-cards-on-table' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'tap-card-0' }).props.disabled).toBe(false);

    act(() => {
      tree.unmount();
    });
  });

  it('does not warm the table under Reduce Motion (flash-reveal mounts it, as before)', async () => {
    (ReactNative as any).__setReduceMotionEnabled(true);
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT, tapFlow: true } } as any}
        />,
      );
      await Promise.resolve();
    });
    // RM: mount → flash-reveal at t = 0, table already committed in its visible container
    const container = tree.root.find((n) => (n.type as any) === 'View' && n.findAll((c) => c.props?.testID === 'tap-card-0').length > 0 && n.props.accessibilityElementsHidden === false);
    expect(container.props.pointerEvents).toBeUndefined();
    act(() => {
      tree.unmount();
    });
  });

  it('records a ceremony perf report: phases in order, frames only from approach, stopped at unmount', async () => {
    clearActiveCeremonyPerf();
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_DRAW_RESULT, tapFlow: true } } as any}
        />,
      );
      await Promise.resolve();
    });
    const session = getActiveCeremonyPerf();
    expect(session).not.toBeNull();
    expect(session!.active).toBe(true);

    armCeremonySwipe(tree);
    await act(async () => {
      vi.advanceTimersByTime(620 + 300 + 940 + 280 + 300 + 500);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ testID: 'draw-ceremony-cards-on-table' })).toBeTruthy();
    expect(session!.active).toBe(true);
    expect(session!.report).toBeNull();

    act(() => {
      tree.unmount();
    });
    expect(session!.active).toBe(false);
    const report = session!.report!;
    expect(report.phases.map((p) => p.phase)).toEqual([
      'swipe', 'approach', 'hold', 'tear-flip', 'flash-reveal', 'settle', 'cards-on-table',
    ]);
    // Under TEST_BASE the timers drive the durations: approach 620, hold 300, tear 940, flash 280, settle 300 (+500 tail).
    const byPhase = Object.fromEntries(report.phases.map((p) => [p.phase, p.durationMs]));
    expect(byPhase.approach).toBe(620);
    expect(byPhase.hold).toBe(300);
    expect(byPhase['tear-flip']).toBe(940);
    expect(byPhase['flash-reveal']).toBe(280);
    expect(byPhase.settle).toBe(800);
    expect(report.meta).toEqual(expect.objectContaining({ renderer: 'fallback', cardCount: 2, peakRarity: 'LEG', isMulti: true, tapFlow: true, slug: 'csharp', reduceMotion: false }));
    // Node has no requestAnimationFrame: no JS samples, and frame sampling was armed at approach.
    expect(report.js).toBeNull();
    expect(report.ui).toBeNull();
    expect(report.framesFromMs).toBe(report.phases[1].atMs);
    expect(getActiveCeremonyPerf()).toBeNull();
  });
});
