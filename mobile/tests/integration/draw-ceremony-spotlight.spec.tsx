import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-native / safe-area / linear-gradient surface — copied from draw-ceremony.screen.test.tsx.
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

// Recording audio/haptics controllers — copied from draw-ceremony-ui-thread.spec.tsx.
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

// TEST_BASE single timings: approach 300, hold 180, tearFlip 360, flashReveal 220, settle 200, tail 500.
const single = (rarity: 'COM' | 'RAR' | 'LEG') => ({
  poolId: 'csharp',
  pityBefore: 0,
  pityAfter: 1,
  pityTriggered: false,
  highlightedRarity: (rarity === 'COM' ? null : rarity) as 'RAR' | 'LEG' | null,
  cards: [{ stableUid: '1', question: 'A long single-pull question about the C# runtime used for the read-full sheet.', difficulty: 3, rarity }],
});

function renderScreen(rarity: 'COM' | 'RAR' | 'LEG', replace = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <DrawCeremonyScreen
        navigation={{ replace } as any}
        route={{ key: 'ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: single(rarity), tapFlow: true, totalCards: 20 } } as any}
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

// Swipe → run the whole single-pull schedule → cards-on-table (the spotlight interactive).
// LEG's hold is the longest (220), so advance past the worst-case total (approach 300 + hold
// 220 + tearFlip 360 + flashReveal 220 + settle 200 + tail 500 = 1800) with margin.
function reachTable(tree: renderer.ReactTestRenderer) {
  armSwipe(tree);
  advance(2000);
}

function collectText(tree: renderer.ReactTestRenderer) {
  return tree.root
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}
function spotlightRoot(tree: renderer.ReactTestRenderer) {
  return tree.root.find((n) => (n.type as any) === 'View' && n.props.testID === 'reveal-spotlight');
}
function ctaHosts(scope: renderer.ReactTestInstance) {
  return scope.findAll((n) => (n.type as any) === 'Pressable' && n.props.testID === 'screen-draw-ceremony-primary-cta');
}

describe('DrawCeremony single-pull spotlight', () => {
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

  it('single pull skips the tiny table and reveals the card in the spotlight on tap', () => {
    const { tree, replace } = renderScreen('RAR');
    reachTable(tree);

    // No tiny table card at all — the reveal is the spotlight.
    expect(tree.root.findAll((n) => (n.type as any) === 'Pressable' && n.props.testID === 'tap-card-0')).toHaveLength(0);
    const card = () => tree.root.findByProps({ testID: 'reveal-spotlight-card' });
    expect(card().props.accessibilityLabel).toBe('Card 1 of 1, face down');

    act(() => {
      card().props.onPress();
    });
    expect(card().props.accessibilityLabel).toBe('Card 1 of 1, Rare revealed');

    // The CTA now reads Continue (the only card is flipped); pressing it lands on DrawResult.
    const cta = ctaHosts(tree.root)[0];
    expect(cta.findAll((n) => (n.type as any) === 'Text')[0].props.children).toBe('Continue');
    act(() => {
      cta.props.onPress();
    });
    expect(replace).toHaveBeenCalledWith('DrawResult', expect.objectContaining({ revealedUids: ['1'] }));
  });

  it('warm-mounts the spotlight hidden from hold and shows it from flash-reveal', () => {
    const { tree } = renderScreen('RAR');
    armSwipe(tree);
    advance(300 + 5); // hold
    let root = spotlightRoot(tree);
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    const flat = Object.assign({}, ...[root.props.style].flat(Infinity).filter(Boolean));
    expect(flat.opacity).toBe(0);

    advance(180 + 360 + 5); // flash-reveal
    root = spotlightRoot(tree);
    expect(root.props.pointerEvents).toBe('auto');
    expect(root.props.accessibilityElementsHidden).toBe(false);
    const flatShown = Object.assign({}, ...[root.props.style].flat(Infinity).filter(Boolean));
    expect(flatShown.opacity).not.toBe(0);
  });

  it('shows the Rare and Legendary banner words from rarityLabel after the flip', () => {
    const rar = renderScreen('RAR');
    reachTable(rar.tree);
    act(() => {
      rar.tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    advance(225 + 5); // RAR midpoint
    expect(rar.tree.root.findByProps({ testID: 'reveal-spotlight-banner' }).props.children).toBe('Rare');

    const leg = renderScreen('LEG');
    reachTable(leg.tree);
    act(() => {
      leg.tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    advance(700 + 5); // LEG midpoint
    expect(leg.tree.root.findByProps({ testID: 'reveal-spotlight-banner' }).props.children).toBe('Legendary');
  });

  it('fires the flip sound at flip start and the rarity sting at the flip midpoint', () => {
    const { tree } = renderScreen('LEG');
    reachTable(tree);
    const flip = () => rec.audio.filter((x) => x === 'hit:flip').length;
    const leg = () => rec.audio.filter((x) => x === 'hit:stinger-leg').length;
    const success = () => rec.haptics.filter((x) => x === 'success').length;
    const baseSuccess = success();

    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    // Nothing has landed yet: the flip sound waits for flipStartMs (300).
    expect(flip()).toBe(0);
    advance(299);
    expect(flip()).toBe(0);
    advance(1); // flipStartMs = 300
    expect(flip()).toBe(1);
    expect(leg()).toBe(0);

    advance(700 - 300); // midpointMs = 700
    expect(leg()).toBe(1);
    expect(success()).toBe(baseSuccess);

    advance(950 - 700); // landMs = 950
    expect(success()).toBe(baseSuccess + 1);
  });

  it('fires a Common stinger at the flip midpoint', () => {
    const { tree } = renderScreen('COM');
    reachTable(tree);
    const flip = () => rec.audio.filter((x) => x === 'hit:flip').length;
    const com = () => rec.audio.filter((x) => x === 'hit:stinger-com').length;
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    // COM flips at once (flipStartMs 0); its stinger waits for the midpoint (175).
    expect(flip()).toBe(1);
    expect(com()).toBe(0);
    advance(175 + 5);
    expect(com()).toBe(1);
  });

  it('renders the primary CTA inside the spotlight while it is visible', () => {
    const { tree } = renderScreen('RAR');
    reachTable(tree);
    // Exactly one primary CTA in the whole tree, and it lives inside the spotlight.
    expect(ctaHosts(tree.root)).toHaveLength(1);
    expect(ctaHosts(spotlightRoot(tree))).toHaveLength(1);
  });

  it('opens the full question sheet from the read-full link', () => {
    const { tree } = renderScreen('RAR');
    reachTable(tree);
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    advance(225 + 5); // midpoint reveals the read-full link
    expect(tree.root.findAllByProps({ testID: 'reveal-spotlight-full-question' })).toHaveLength(0);
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-read-full' }).props.onPress();
    });
    const sheet = tree.root.find((n) => (n.type as any) === 'View' && n.props.testID === 'reveal-spotlight-full-question');
    expect(sheet).toBeTruthy();
    expect(collectText(tree)).toContain('read-full sheet');
    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-full-close' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'reveal-spotlight-full-question' })).toHaveLength(0);
  });
});
