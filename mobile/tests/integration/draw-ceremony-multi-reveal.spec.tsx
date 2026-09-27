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

// Recording audio/haptics controllers — copied from draw-ceremony-spotlight.spec.tsx.
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
import { resolveCeremonyTimings, type PeakRarity } from '../../src/features/gacha/draw/ceremonyTimings';

type Rarity = 'COM' | 'RAR' | 'LEG';

function peakOf(rarities: Rarity[]): PeakRarity {
  if (rarities.includes('LEG')) return 'LEG';
  if (rarities.includes('RAR')) return 'RAR';
  return 'COM';
}

function multi(rarities: Rarity[]) {
  return {
    poolId: 'csharp',
    pityBefore: 0,
    pityAfter: 1,
    pityTriggered: false,
    highlightedRarity: (peakOf(rarities) === 'COM' ? null : peakOf(rarities)) as 'RAR' | 'LEG' | null,
    cards: rarities.map((rarity, i) => ({
      stableUid: String(i + 1),
      question: `Question number ${i + 1} about the runtime, ${rarity}.`,
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
        route={{
          key: 'ceremony',
          name: 'DrawCeremony',
          params: { slug: 'csharp', drawResult: multi(rarities), tapFlow: true, totalCards: 20, ...extraParams },
        } as any}
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

// Swipe → run the whole multi-pull schedule → cards-on-table. toTableMs is the sum of every phase
// on the TEST_BASE multi table for the pull's peak rarity; add margin for the tail.
function reachTable(tree: renderer.ReactTestRenderer, rarities: Rarity[]) {
  armSwipe(tree);
  const toTable = resolveCeremonyTimings({ isMulti: true, peakRarity: peakOf(rarities), motionAvailable: false }).toTableMs;
  advance(toTable + 50);
}

function has(tree: renderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAll((n) => (n.type as any) === 'View' && n.props.testID === testID).length > 0
    || tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID).length > 0;
}
function cardPresent(tree: renderer.ReactTestRenderer): boolean {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'reveal-spotlight-card').length > 0;
}
function bannerText(tree: renderer.ReactTestRenderer): string | null {
  const found = tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'reveal-spotlight-banner');
  if (found.length === 0) return null;
  const c = found[0].props.children;
  return Array.isArray(c) ? c.join('') : String(c ?? '');
}
function progressText(tree: renderer.ReactTestRenderer): string | null {
  const found = tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'reveal-spotlight-progress');
  if (found.length === 0) return null;
  const c = found[0].props.children;
  return Array.isArray(c) ? c.join('') : String(c ?? '');
}
function gridPresent(tree: renderer.ReactTestRenderer): boolean {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'draw-ceremony-summary-grid').length > 0;
}
// The "Tap to continue" hint renders only once the card has landed face up.
function faceUp(tree: renderer.ReactTestRenderer): boolean {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'reveal-spotlight-continue-hint').length > 0;
}

// Advance in small steps (flushing effects between each) until `pred` holds or `max` ms elapse,
// so a spotlight that re-mounts per card keeps scheduling and firing its next timer.
function advanceUntil(tree: renderer.ReactTestRenderer, pred: () => boolean, max = 30000, step = 150): boolean {
  let elapsed = 0;
  while (elapsed < max) {
    if (pred()) return true;
    advance(step);
    elapsed += step;
  }
  return pred();
}

describe('DrawCeremony multi-pull reveal', () => {
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

  it('sends a tapped table card through the spotlight and back to the table', () => {
    const rarities: Rarity[] = ['COM', 'COM', 'RAR'];
    const { tree } = renderScreen(rarities);
    reachTable(tree, rarities);

    // No spotlight yet; the table is showing.
    expect(cardPresent(tree)).toBe(false);
    expect(has(tree, 'draw-ceremony-cards-on-table')).toBe(true);

    // Tap the first (COM) table card — it flies into the spotlight.
    act(() => {
      tree.root.findByProps({ testID: 'tap-card-0' }).props.onPress();
    });
    expect(cardPresent(tree)).toBe(true);
    expect(progressText(tree)).toBe('1 / 3');

    // A COM holds ~350 ms after landing then auto-advances; with nothing queued the spotlight
    // closes and the table is back (not the grid — only one of three cards is face up).
    expect(advanceUntil(tree, () => !cardPresent(tree))).toBe(true);
    expect(has(tree, 'draw-ceremony-cards-on-table')).toBe(true);
    expect(gridPresent(tree)).toBe(false);
  });

  it('reveal all walks every card through the spotlight in rising rarity and ends on the summary grid', () => {
    const rarities: Rarity[] = ['LEG', 'RAR', 'RAR', 'RAR', 'COM', 'COM', 'COM', 'COM', 'COM', 'COM'];
    const { tree } = renderScreen(rarities);
    reachTable(tree, rarities);

    act(() => {
      tree.root.findByProps({ testID: 'draw-ceremony-reveal-all' }).props.onPress();
    });

    // The walk starts on the lowest rarity (Common) and progress counts from one.
    expect(advanceUntil(tree, () => bannerText(tree) !== null)).toBe(true);
    expect(bannerText(tree)).toBe('Common');
    expect(progressText(tree)).toBe('1 / 10');

    // It builds to the Legendary last, which is shown as card 10 of 10 and holds face up for a tap.
    expect(advanceUntil(tree, () => bannerText(tree) === 'Legendary')).toBe(true);
    expect(progressText(tree)).toBe('10 / 10');
    expect(advanceUntil(tree, () => faceUp(tree))).toBe(true);
    expect(gridPresent(tree)).toBe(false);

    // Tapping the held Legendary ends the sequence on the summary grid.
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    expect(advanceUntil(tree, () => gridPresent(tree))).toBe(true);
    expect(cardPresent(tree)).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-summary-cell-0' }).length).toBeGreaterThan(0);
  });

  it('holds a Legendary in the spotlight until it is tapped', () => {
    const rarities: Rarity[] = ['LEG', 'COM'];
    const { tree } = renderScreen(rarities);
    reachTable(tree, rarities);

    act(() => {
      tree.root.findByProps({ testID: 'draw-ceremony-reveal-all' }).props.onPress();
    });

    // Walk past the Common until the Legendary is up.
    expect(advanceUntil(tree, () => bannerText(tree) === 'Legendary')).toBe(true);
    // It never auto-advances: a long wait leaves it in the spotlight, no grid yet.
    advance(6000);
    expect(bannerText(tree)).toBe('Legendary');
    expect(cardPresent(tree)).toBe(true);
    expect(gridPresent(tree)).toBe(false);

    // A tap releases it to the grid.
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    expect(advanceUntil(tree, () => gridPresent(tree))).toBe(true);
  });

  it('skip all jumps to the summary grid', () => {
    const rarities: Rarity[] = ['LEG', 'RAR', 'COM', 'COM'];
    const { tree } = renderScreen(rarities);
    reachTable(tree, rarities);

    act(() => {
      tree.root.findByProps({ testID: 'draw-ceremony-reveal-all' }).props.onPress();
    });
    expect(advanceUntil(tree, () => cardPresent(tree))).toBe(true);

    // Skip all collapses the rest of the walk straight to the grid.
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-skip-all' }).props.onPress();
    });
    expect(gridPresent(tree)).toBe(true);
    expect(cardPresent(tree)).toBe(false);
    // Every card is on the grid.
    expect(tree.root.findAllByProps({ testID: 'draw-ceremony-summary-cell-3' }).length).toBeGreaterThan(0);
  });

  it('opens a summary grid card back in the spotlight face up', () => {
    const rarities: Rarity[] = ['LEG', 'RAR', 'COM'];
    const { tree } = renderScreen(rarities);
    reachTable(tree, rarities);

    // Reveal all, then skip straight to the grid.
    act(() => {
      tree.root.findByProps({ testID: 'draw-ceremony-reveal-all' }).props.onPress();
    });
    expect(advanceUntil(tree, () => cardPresent(tree))).toBe(true);
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-skip-all' }).props.onPress();
    });
    expect(gridPresent(tree)).toBe(true);

    const flipsBefore = rec.audio.filter((x) => x === 'hit:flip').length;

    // Tapping a grid cell re-opens that card in the spotlight, already face up (no flip).
    act(() => {
      tree.root.findByProps({ testID: 'draw-ceremony-summary-cell-0' }).props.onPress();
    });
    expect(cardPresent(tree)).toBe(true);
    // Face up immediately: the banner is present and no progress counter (inspect mode).
    expect(bannerText(tree)).not.toBeNull();
    expect(progressText(tree)).toBeNull();
    advance(2000);
    expect(rec.audio.filter((x) => x === 'hit:flip').length).toBe(flipsBefore);

    // Tapping the inspected card closes it back to the grid.
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    expect(gridPresent(tree)).toBe(true);
    expect(cardPresent(tree)).toBe(false);
  });

  it('plays one flip and one sting per card and keeps the table tap silent', () => {
    const rarities: Rarity[] = ['RAR', 'COM', 'COM'];
    const { tree } = renderScreen(rarities);
    reachTable(tree, rarities);

    // Ignore the ceremony's own approach→settle cues; count only what the tap produces.
    rec.audio.length = 0;
    act(() => {
      tree.root.findByProps({ testID: 'tap-card-0' }).props.onPress();
    });
    // The table tap itself is silent — no flip sound fired at tap time.
    expect(rec.audio.filter((x) => x === 'hit:flip').length).toBe(0);

    // Walk the single tapped RAR through its flip: exactly one flip and one stinger.
    advanceUntil(tree, () => rec.audio.filter((x) => x === 'hit:stinger-rar').length > 0, 2000);
    expect(rec.audio.filter((x) => x === 'hit:flip').length).toBe(1);
    expect(rec.audio.filter((x) => x === 'hit:stinger-rar').length).toBe(1);
  });

  it('plays a Common stinger when a Common card is revealed', () => {
    const rarities: Rarity[] = ['COM', 'RAR'];
    const { tree } = renderScreen(rarities);
    reachTable(tree, rarities);

    rec.audio.length = 0;
    act(() => {
      tree.root.findByProps({ testID: 'tap-card-0' }).props.onPress(); // the Common
    });
    advanceUntil(tree, () => rec.audio.filter((x) => x === 'hit:stinger-com').length > 0, 2000);
    expect(rec.audio.filter((x) => x === 'hit:stinger-com').length).toBe(1);
  });

  it('auto-reveals every card when autoReveal is on', () => {
    const rarities: Rarity[] = ['RAR', 'COM', 'COM'];
    const { tree } = renderScreen(rarities, { autoReveal: true });
    reachTable(tree, rarities);

    // No button press: the sequence has started by itself on reaching the table.
    expect(advanceUntil(tree, () => cardPresent(tree), 3000)).toBe(true);
    // It walks every card and ends on the grid on its own (RAR is the last, auto-advancing).
    expect(advanceUntil(tree, () => gridPresent(tree))).toBe(true);
    expect(cardPresent(tree)).toBe(false);
  });
});
