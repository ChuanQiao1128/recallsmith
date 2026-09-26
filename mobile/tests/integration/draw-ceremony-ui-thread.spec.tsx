import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let reduceMotionEnabled = false;
const reduceMotionListeners = new Set<(enabled: boolean) => void>();

// react-native surface, copied from draw-ceremony.screen.test.tsx.
vi.mock('react-native', () => {
  const React = require('react');
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
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    __setReduceMotionEnabled: (enabled: boolean) => {
      reduceMotionEnabled = enabled;
      reduceMotionListeners.forEach((listener) => listener(enabled));
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

// Wrap playCeremonyTimeline / cancelCeremonyTimeline with spies (still running the real
// implementation) so a test can assert the plan is played once at the tear and cancelled once
// on fast-forward. The hook and the cue helpers stay real.
const planSpies = vi.hoisted(() => ({ play: null as any, cancel: null as any }));
vi.mock('../../src/components/ceremony/useCeremonyTimeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ceremony/useCeremonyTimeline')>();
  const play = vi.fn(actual.playCeremonyTimeline);
  const cancel = vi.fn(actual.cancelCeremonyTimeline);
  planSpies.play = play;
  planSpies.cancel = cancel;
  return { ...actual, playCeremonyTimeline: play, cancelCeremonyTimeline: cancel };
});

// One stable recording audio/haptics controller each: every cue the screen fires lands in
// `rec.audio` / `rec.haptics` as `"<layer>:<name>"`, so the schedule can be read by advancing
// the fake clock.
const rec = vi.hoisted(() => ({ audio: [] as string[], haptics: [] as string[] }));
vi.mock('../../src/components/ceremonyAudio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ceremonyAudio')>();
  const controller = {
    prewarm: () => {},
    warmUp: () => {},
    isWarm: () => true,
    bed: (name: string | null) => rec.audio.push(`bed:${name ?? 'null'}`),
    duck: () => rec.audio.push('duck'),
    hit: (name: string) => rec.audio.push(`hit:${name}`),
    tail: (name: string) => rec.audio.push(`tail:${name}`),
    play: () => {},
    stopAll: () => {},
    available: true,
  };
  return { ...actual, useCeremonyAudio: () => controller };
});
vi.mock('../../src/components/ceremonyHaptics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ceremonyHaptics')>();
  const controller = {
    tick: () => rec.haptics.push('tick'),
    impact: (style?: string) => rec.haptics.push(`impact:${style ?? 'medium'}`),
    success: () => rec.haptics.push('success'),
    reset: () => {},
    available: true,
  };
  return { ...actual, useCeremonyHaptics: () => controller };
});

import * as ReactNative from 'react-native';
import { DrawCeremonyScreen } from '../../src/screens/DrawCeremonyScreen';
import { REDUCED_MOTION_FLASH_MS } from '../../src/features/gacha/draw/ceremonyTimings';

const MULTI_LEG = {
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

function armCeremonySwipe(tree: renderer.ReactTestRenderer) {
  const stage = tree.root.findByProps({ testID: 'draw-ceremony-stage' });
  act(() => {
    stage.props.onResponderGrant({ nativeEvent: { pageX: 16 } });
    stage.props.onResponderMove({ nativeEvent: { pageX: 104 } });
    stage.props.onResponderRelease({ nativeEvent: { pageX: 104 } });
  });
}

function phaseTitle(tree: renderer.ReactTestRenderer) {
  const value = tree.root.findByProps({ testID: 'draw-ceremony-phase-copy' }).props.children;
  return Array.isArray(value) ? value.join('') : String(value ?? '');
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('DrawCeremonyScreen UI-thread ceremony (G43)', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (ReactNative as any).__setReduceMotionEnabled(false);
    rec.audio.length = 0;
    rec.haptics.length = 0;
    planSpies.play?.mockClear();
    planSpies.cancel?.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays the whole timeline once at the tear, before any phase timer fires', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace: vi.fn() } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_LEG } } as any}
        />,
      );
      await Promise.resolve();
    });

    expect(planSpies.play).not.toHaveBeenCalled();
    armCeremonySwipe(tree);
    // The plan is assigned once, synchronously at the tear — no phase timer has advanced yet.
    expect(planSpies.play).toHaveBeenCalledTimes(1);
    expect(phaseTitle(tree)).toContain('Pack inbound');
  });

  it('fires the tear, flash and settle cues on the schedule from the tear', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace: vi.fn() } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_LEG } } as any}
        />,
      );
      await Promise.resolve();
    });
    armCeremonySwipe(tree);

    // TEST_BASE multi: approach 620, hold 300, tearFlip 940, flashReveal 280.
    // rip (tear start) at 620 + 300 = 920, not before.
    await advance(919);
    expect(rec.audio).not.toContain('hit:rip');
    await advance(1);
    expect(rec.audio).toContain('hit:rip'); // 920

    // seam-burst (flash start) at 920 + 940 = 1860.
    await advance(1859 - 920);
    expect(rec.audio).not.toContain('hit:seam-burst');
    await advance(1);
    expect(rec.audio).toContain('hit:seam-burst'); // 1860

    // sparkle-tail (settle start) at 1860 + 280 = 2140.
    await advance(2139 - 1860);
    expect(rec.audio).not.toContain('tail:sparkle-tail');
    await advance(1);
    expect(rec.audio).toContain('tail:sparkle-tail'); // 2140
  });

  it('fires the reduced-motion cues on the reduced schedule', async () => {
    (ReactNative as any).__setReduceMotionEnabled(true);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawCeremonyScreen
          navigation={{ replace: vi.fn() } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_LEG } } as any}
        />,
      );
      await Promise.resolve();
    });

    // The reduced-motion path never plans; the flash burst fires as soon as RM resolves…
    expect(planSpies.play).not.toHaveBeenCalled();
    expect(rec.audio).toContain('hit:seam-burst');
    expect(rec.audio).not.toContain('tail:sparkle-tail');

    // …and the sparkle tail lands on the reduced schedule at REDUCED_MOTION_FLASH_MS.
    await advance(REDUCED_MOTION_FLASH_MS - 1);
    expect(rec.audio).not.toContain('tail:sparkle-tail');
    await advance(1);
    expect(rec.audio).toContain('tail:sparkle-tail');
  });

  it('hands animation back to the per-phase path when a repeat user fast-forwards', async () => {
    // A repeat user (>=1 completed ceremony) unlocks the fast-forward control (MGACHA-09).
    vi.resetModules();
    vi.doMock('../../src/features/gacha/draw/ceremonyPrefs', async () => ({
      ...(await vi.importActual<any>('../../src/features/gacha/draw/ceremonyPrefs')),
      readCeremoniesCompleted: async () => 1,
    }));
    const { DrawCeremonyScreen: Screen } = await import('../../src/screens/DrawCeremonyScreen');

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Screen
          navigation={{ replace: vi.fn() } as any}
          route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MULTI_LEG } } as any}
        />,
      );
      await Promise.resolve();
    });

    armCeremonySwipe(tree);
    planSpies.cancel?.mockClear();

    // Into hold, past the tell: the fast-forward control appears.
    await advance(620 + 179);
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-fast-forward' })).toHaveLength(0);
    await advance(1);
    expect(tree.root.findByProps({ testID: 'draw-ceremony-fast-forward' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'draw-ceremony-fast-forward' }).props.onPress();
      await Promise.resolve();
    });
    // Fast-forward cancels the UI-thread plan exactly once and hands back to the per-phase path.
    expect(planSpies.cancel).toHaveBeenCalledTimes(1);

    vi.doUnmock('../../src/features/gacha/draw/ceremonyPrefs');
    vi.resetModules();
  });
});
