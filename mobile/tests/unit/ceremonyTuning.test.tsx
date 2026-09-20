import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles },
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

const fixtures = vi.hoisted(() => ({
  activeSlug: 'csharp' as string | null,
  deck: { Cards: [] as Array<{ StableUid: string; Difficulty: number }> } as any,
  drawState: { owned: ['b'] as string[], pity: null as unknown },
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  saveRewardWalletState: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  loadDrawState: vi.fn(async () => fixtures.drawState),
  saveDrawState: vi.fn(async () => {}),
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => fixtures.activeSlug),
}));

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async () => fixtures.deck),
}));

vi.mock('../../src/components/ceremony/reanimatedGuard', () => ({
  motionAvailable: false,
  skiaAvailable: false,
}));

import {
  CeremonyTuningScreen,
  TUNING_KEYS,
  TUNING_STEP_MS,
  TUNING_MAX_MS,
  PROBE_REPORT_EVERY,
  summarizeFrameGaps,
  readTimingPath,
  writeTimingPath,
  mergeTimingOverride,
} from '../../src/screens/dev/CeremonyTuning';
import { DebugMenuScreen } from '../../src/screens/DebugMenuScreen';
import { DEVICE, getCeremonyTimingOverride, setCeremonyTimingOverride } from '../../src/features/gacha/draw/ceremonyTimings';
import { getCeremonyDevOverrides, setCeremonyDevOverride } from '../../src/features/gacha/draw/ceremonyPrefs';
import { saveRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';
import { loadDrawState, saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { loadActiveDeckSlug } from '../../src/content/activeDeck';
import { resolveDeckBySlug } from '../../src/content/deckRepository';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0);
}

function allText(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => n.props.children)
    .filter((c: unknown): c is string => typeof c === 'string')
    .join(' | ');
}

function textOf(tree: renderer.ReactTestRenderer, testID: string): unknown {
  return tree.root.findByProps({ testID }).props.children;
}

describe('CeremonyTuning screen + DebugMenu ceremony seeds', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).__DEV__ = true;
    setCeremonyTimingOverride(null);
    setCeremonyDevOverride('forceFallback', false);
    setCeremonyDevOverride('forceRepeat', false);
    fixtures.activeSlug = 'csharp';
    fixtures.deck = { Cards: [] };
    fixtures.drawState = { owned: ['b'], pity: null };
    (saveRewardWalletState as any).mockClear();
    (loadDrawState as any).mockClear();
    (saveDrawState as any).mockClear();
    (loadActiveDeckSlug as any).mockClear();
    (resolveDeckBySlug as any).mockClear();
  });

  afterEach(() => {
    (globalThis as any).__DEV__ = true;
    vi.unstubAllGlobals();
  });

  it('summarizeFrameGaps uses nearest-rank p95 and reports max and count', () => {
    expect(summarizeFrameGaps([])).toEqual({ p95: 0, max: 0, count: 0 });
    expect(summarizeFrameGaps([10])).toEqual({ p95: 10, max: 10, count: 1 });
    const twenty = [...Array(19).fill(16), 60];
    expect(summarizeFrameGaps(twenty)).toEqual({ p95: 16, max: 60, count: 20 });
    const hundred = [...Array(95).fill(16), ...Array(5).fill(40)];
    const summary = summarizeFrameGaps(hundred);
    expect(summary.p95).toBe(16);
    expect(summary.max).toBe(40);
    const input = [3, 1, 2];
    summarizeFrameGaps(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('readTimingPath and writeTimingPath round-trip every TUNING_KEY without mutating the input', () => {
    for (const key of TUNING_KEYS) {
      const before = readTimingPath(DEVICE, key);
      const written = writeTimingPath(DEVICE, key, 7);
      expect(readTimingPath(written, key)).toBe(7);
      expect(readTimingPath(DEVICE, key)).toBe(before);
      expect(readTimingPath(writeTimingPath(DEVICE, key, -5), key)).toBe(0);
      expect(readTimingPath(writeTimingPath(DEVICE, key, 9999), key)).toBe(TUNING_MAX_MS);
    }
    const copy = mergeTimingOverride(DEVICE, null);
    expect(copy).toEqual(DEVICE);
    expect(copy).not.toBe(DEVICE);
  });

  it('renders the unavailable text and nothing else when __DEV__ is false', () => {
    (globalThis as any).__DEV__ = false;
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<CeremonyTuningScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 't', name: 'CeremonyTuning' } as any} />);
    });
    expect(tree.root.findAllByProps({ testID: 'ceremony-tuning-unavailable' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'ceremony-tuning-root' }).length).toBe(0);
  });

  it('writes the DEVICE override through setCeremonyTimingOverride from a stepper row', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<CeremonyTuningScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 't', name: 'CeremonyTuning' } as any} />);
    });
    expect(getCeremonyTimingOverride()).toBeNull();
    act(() => {
      tree.root.findByProps({ testID: 'ceremony-tuning-slider-single.hold.LEG-plus' }).props.onPress();
    });
    expect(getCeremonyTimingOverride()?.single?.hold.LEG).toBe(DEVICE.single.hold.LEG + TUNING_STEP_MS);
    expect(textOf(tree, 'ceremony-tuning-slider-single.hold.LEG-value')).toBe(DEVICE.single.hold.LEG + TUNING_STEP_MS);
    act(() => {
      tree.root.findByProps({ testID: 'ceremony-tuning-slider-single.hold.LEG-minus' }).props.onPress();
    });
    act(() => {
      tree.root.findByProps({ testID: 'ceremony-tuning-slider-single.hold.LEG-minus' }).props.onPress();
    });
    expect(getCeremonyTimingOverride()?.single?.hold.LEG).toBe(DEVICE.single.hold.LEG - TUNING_STEP_MS);
    act(() => {
      tree.root.findByProps({ testID: 'ceremony-tuning-reset' }).props.onPress();
    });
    expect(getCeremonyTimingOverride()).toBeNull();
    expect(textOf(tree, 'ceremony-tuning-slider-single.hold.LEG-value')).toBe(DEVICE.single.hold.LEG);
  });

  it('flags a table that exceeds the device ceiling in the cap readout', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<CeremonyTuningScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 't', name: 'CeremonyTuning' } as any} />);
    });
    expect(textOf(tree, 'ceremony-tuning-cap-single-LEG')).toContain('3120 / 3300');
    expect(String(textOf(tree, 'ceremony-tuning-cap-single-LEG'))).not.toContain('OVER');
    for (let i = 0; i < 10; i += 1) {
      act(() => {
        tree.root.findByProps({ testID: 'ceremony-tuning-slider-single.approach-plus' }).props.onPress();
      });
    }
    expect(textOf(tree, 'ceremony-tuning-cap-single-LEG')).toContain('3320 / 3300 OVER');
    expect(textOf(tree, 'ceremony-tuning-cap-multi-LEG')).toContain('5000 / 5500');
    expect(String(textOf(tree, 'ceremony-tuning-cap-multi-LEG'))).not.toContain('OVER');
  });

  it('reports frame gaps from requestAnimationFrame deltas while the probe is on', () => {
    const queue: Array<(ts: number) => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<CeremonyTuningScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 't', name: 'CeremonyTuning' } as any} />);
    });
    expect(String(textOf(tree, 'ceremony-tuning-probe'))).toContain('IDLE');
    act(() => {
      tree.root.findByProps({ testID: 'ceremony-tuning-probe-toggle' }).props.onPress();
    });
    let t = 1000;
    act(() => {
      for (let i = 0; i <= PROBE_REPORT_EVERY; i += 1) {
        const cb = queue.shift();
        t += i === 5 ? 60 : 16;
        if (cb) cb(t);
      }
    });
    expect(String(textOf(tree, 'ceremony-tuning-probe'))).toContain('max 60.0 ms');
    expect(String(textOf(tree, 'ceremony-tuning-probe')).endsWith('FAIL')).toBe(true);
    act(() => {
      tree.root.findByProps({ testID: 'ceremony-tuning-probe-toggle' }).props.onPress();
    });
    const stale = queue.shift();
    if (stale) {
      t += 16;
      stale(t);
    }
    expect(queue.length).toBe(0);
    expect((globalThis as any).cancelAnimationFrame).toHaveBeenCalled();
  });

  it('DebugMenu seeds the wallet at 30/5 and reports it', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'debug-seed-wallet' }).props.onPress();
    });
    await act(async () => {});
    expect(saveRewardWalletState).toHaveBeenCalledWith({ availablePulls: 30, reservePulls: 5 });
    expect(allText(tree)).toContain('Wallet seeded 30/5');
  });

  it('DebugMenu owns every non-Legendary card of the active deck and leaves Legendary unowned', async () => {
    fixtures.activeSlug = 'csharp';
    fixtures.deck = { Cards: [{ StableUid: 'a', Difficulty: 1 }, { StableUid: 'b', Difficulty: 2 }, { StableUid: 'c', Difficulty: 3 }] };
    fixtures.drawState = { owned: ['b'], pity: null };
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'debug-only-legendary' }).props.onPress();
    });
    await act(async () => {});
    expect(saveDrawState).toHaveBeenCalledWith('csharp', { owned: ['b', 'a'], pity: null });
    expect(allText(tree)).toContain('1 Legendary left');

    (saveDrawState as any).mockClear();
    fixtures.activeSlug = null;
    let tree2!: renderer.ReactTestRenderer;
    await act(async () => {
      tree2 = renderer.create(<DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />);
    });
    await act(async () => {
      tree2.root.findByProps({ testID: 'debug-only-legendary' }).props.onPress();
    });
    await act(async () => {});
    expect(saveDrawState).not.toHaveBeenCalled();
    expect(allText(tree2)).toContain('No active deck');
  });

  it('DebugMenu toggles the ceremony dev overrides and opens the tuning screen', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />);
    });
    const fallbackText = () => tree.root.findByProps({ testID: 'debug-force-fallback' }).findByType('Text' as any).props.children;
    act(() => {
      tree.root.findByProps({ testID: 'debug-force-fallback' }).props.onPress();
    });
    expect(getCeremonyDevOverrides().forceFallback).toBe(true);
    expect(String(fallbackText())).toContain('ON');
    act(() => {
      tree.root.findByProps({ testID: 'debug-force-fallback' }).props.onPress();
    });
    expect(getCeremonyDevOverrides().forceFallback).toBe(false);
    act(() => {
      tree.root.findByProps({ testID: 'debug-force-repeat' }).props.onPress();
    });
    expect(getCeremonyDevOverrides().forceRepeat).toBe(true);
    act(() => {
      tree.root.findByProps({ testID: 'debug-force-repeat' }).props.onPress();
    });
    expect(getCeremonyDevOverrides().forceRepeat).toBe(false);
    act(() => {
      tree.root.findByProps({ testID: 'debug-ceremony-tuning' }).props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('CeremonyTuning');
    expect(findPressableByText(tree, 'Open error shell')).toBeTruthy();
  });

  it('DebugMenu hides the ceremony tools when __DEV__ is false', async () => {
    (globalThis as any).__DEV__ = false;
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />);
    });
    expect(tree.root.findAllByProps({ testID: 'debug-ceremony-tools' }).length).toBe(0);
    expect(tree.root.findAllByProps({ testID: 'debug-reset-progress' }).length).toBeGreaterThan(0);
  });
});
