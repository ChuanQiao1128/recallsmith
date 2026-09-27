import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-native / safe-area / linear-gradient surface — copied from draw-ceremony-spotlight.spec.tsx.
let reduceMotionEnabled = false;
const reduceMotionListeners = new Set<(enabled: boolean) => void>();
vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
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

// Recording audio/haptics controllers. bed/duck/tail are kept so a stray call would show up as a
// non-hit entry — the v2 ceremony must never make one.
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
import { CHARGE_DIM, resolveCeremonyTimings, type PeakRarity } from '../../src/features/gacha/draw/ceremonyTimings';
import { timelineTargets } from '../../src/components/ceremony/useCeremonyTimeline';
import { SPOTLIGHT_ENTRANCE_MS, SPOTLIGHT_FLYOUT_CUE_MS, spotlightFlipPlan } from '../../src/features/gacha/draw/spotlightPlan';

type Rarity = 'COM' | 'RAR' | 'LEG';

function peakOf(rarities: Rarity[]): PeakRarity {
  if (rarities.includes('LEG')) return 'LEG';
  if (rarities.includes('RAR')) return 'RAR';
  return 'COM';
}

function drawResult(rarities: Rarity[]) {
  return {
    poolId: 'csharp',
    pityBefore: 0,
    pityAfter: 1,
    pityTriggered: false,
    highlightedRarity: (peakOf(rarities) === 'COM' ? null : peakOf(rarities)) as 'RAR' | 'LEG' | null,
    cards: rarities.map((rarity, i) => ({
      stableUid: String(i + 1),
      question: `A single-pull question number ${i + 1} about the C# runtime for the read-full sheet.`,
      difficulty: 2,
      rarity,
    })),
  };
}

function renderScreen(rarities: Rarity[], extraParams: Record<string, unknown> = {}) {
  const replace = vi.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <DrawCeremonyScreen
        navigation={{ replace } as any}
        route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: drawResult(rarities), tapFlow: true, totalCards: 20, ...extraParams } } as any}
      />,
    );
  });
  return { tree, replace };
}

function armSwipe(tree: renderer.ReactTestRenderer) {
  const stage = tree.root.findByProps({ testID: 'draw-ceremony-stage' });
  act(() => {
    stage.props.onResponderGrant({ nativeEvent: { pageX: 16 } });
    stage.props.onResponderMove({ nativeEvent: { pageX: 104 } });
    stage.props.onResponderRelease({ nativeEvent: { pageX: 104 } });
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function reachTable(tree: renderer.ReactTestRenderer, rarities: Rarity[]) {
  armSwipe(tree);
  const toTable = resolveCeremonyTimings({ isMulti: rarities.length > 1, peakRarity: peakOf(rarities), motionAvailable: false }).toTableMs;
  advance(toTable + 50);
}

function advanceUntil(tree: renderer.ReactTestRenderer, pred: () => boolean, max = 30000, step = 150): boolean {
  let elapsed = 0;
  while (elapsed < max) {
    if (pred()) return true;
    advance(step);
    elapsed += step;
  }
  return pred();
}

const count = (name: string) => rec.audio.filter((x) => x === name).length;
const cardPresent = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'reveal-spotlight-card').length > 0;
const gridPresent = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'draw-ceremony-summary-grid').length > 0;

describe('DrawCeremony v2 ceremony', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (ReactNative as any).__setReduceMotionEnabled(false);
    rec.audio.length = 0;
    rec.haptics.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-reveals a single pull: the card flies out, flips by itself and plays its stinger', () => {
    const { tree } = renderScreen(['RAR'], { autoReveal: true });
    armSwipe(tree);

    // TEST_BASE single RAR: approach 300, hold 180, tearFlip 360 → flash-reveal at 840.
    advance(840);
    expect(count('hit:burst')).toBe(1); // the full-screen burst at flash-reveal
    expect(count('hit:flyout')).toBe(0);

    // The hero flies out SPOTLIGHT_FLYOUT_CUE_MS after entering.
    advance(SPOTLIGHT_FLYOUT_CUE_MS);
    expect(count('hit:flyout')).toBe(1);
    expect(count('hit:flip')).toBe(0);

    // It flips by itself SPOTLIGHT_ENTRANCE_MS after entering.
    advance(SPOTLIGHT_ENTRANCE_MS - SPOTLIGHT_FLYOUT_CUE_MS);
    expect(count('hit:flip')).toBe(1);
    expect(count('hit:stinger-rar')).toBe(0);

    // The stinger plays at the plan midpoint.
    advance(spotlightFlipPlan('RAR', false).midpointMs);
    expect(count('hit:stinger-rar')).toBe(1);

    // The card ends face up on the table with a Continue CTA.
    expect(advanceUntil(tree, () => {
      const cta = tree.root.findAll((n) => (n.type as any) === 'Pressable' && n.props.testID === 'screen-draw-ceremony-primary-cta');
      if (cta.length === 0) return false;
      return cta[0].findAll((n) => (n.type as any) === 'Text')[0].props.children === 'Continue';
    })).toBe(true);
  });

  it('tapping during the flip finishes it and plays only the stinger', () => {
    const { tree } = renderScreen(['LEG'], { autoReveal: true });
    armSwipe(tree);

    // TEST_BASE single LEG: flash-reveal at 300 + 220 + 360 = 880; auto-flip at + entrance.
    advance(880);
    advance(SPOTLIGHT_ENTRANCE_MS); // the flip has been requested; the card is flipping
    expect(count('hit:stinger-leg')).toBe(0);

    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress(); // tap during the flip
    });
    // Exactly one stinger, fired at the tap.
    expect(count('hit:stinger-leg')).toBe(1);

    // None later — the pending flip stinger was cancelled.
    advance(3000);
    expect(count('hit:stinger-leg')).toBe(1);
  });

  it('skip all plays only the highest remaining stinger', () => {
    const rarities: Rarity[] = ['LEG', 'RAR', 'COM'];
    const { tree } = renderScreen(rarities);
    reachTable(tree, rarities);

    act(() => {
      tree.root.findByProps({ testID: 'draw-ceremony-reveal-all' }).props.onPress();
    });
    expect(advanceUntil(tree, () => cardPresent(tree))).toBe(true);

    // Skip the rest of the walk: the single sound is the best remaining stinger (Legendary).
    rec.audio.length = 0;
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-skip-all' }).props.onPress();
    });
    const stingers = rec.audio.filter((x) => x.startsWith('hit:stinger'));
    expect(stingers).toEqual(['hit:stinger-leg']);
    expect(gridPresent(tree)).toBe(true);
  });

  it('dims the stage for every rarity from the charge', () => {
    // Timeline probe: every rarity dims to CHARGE_DIM from the charge (approach) through the hold,
    // and only 'swipe' is undimmed.
    for (const r of ['COM', 'RAR', 'LEG'] as const) {
      expect(timelineTargets({ phase: 'swipe', peakRarity: r, isMulti: false, reduceMotion: false }).dim).toBe(0);
      expect(timelineTargets({ phase: 'approach', peakRarity: r, isMulti: false, reduceMotion: false }).dim).toBe(CHARGE_DIM);
      expect(timelineTargets({ phase: 'hold', peakRarity: r, isMulti: false, reduceMotion: false }).dim).toBe(CHARGE_DIM);
    }
  });

  it('never starts a bed or a tail: every cue is a one-shot hit', () => {
    const rarities: Rarity[] = ['RAR', 'COM', 'COM'];
    const { tree } = renderScreen(rarities, { autoReveal: true });
    reachTable(tree, rarities);
    advanceUntil(tree, () => gridPresent(tree));
    advance(5000);

    expect(rec.audio.length).toBeGreaterThan(0);
    expect(rec.audio.some((x) => x.startsWith('bed:'))).toBe(false);
    expect(rec.audio.some((x) => x.startsWith('tail:'))).toBe(false);
    expect(rec.audio.some((x) => x === 'duck')).toBe(false);
    expect(rec.audio.every((x) => x.startsWith('hit:'))).toBe(true);
  });
});
