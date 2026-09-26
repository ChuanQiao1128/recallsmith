import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const alertMock = vi.fn();

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles },
    Alert: { alert: (...args: any[]) => alertMock(...args) },
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

const storage = vi.hoisted(() => ({ items: new Map<string, string>(), getItemFails: false }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (storage.getItemFails) throw new Error('storage down');
      return storage.items.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.items.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.items.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...storage.items.keys()]),
    multiRemove: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  },
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  saveRewardWalletState: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  loadDrawState: vi.fn(async () => ({ owned: [], pity: null })),
  saveDrawState: vi.fn(async () => {}),
}));

import { DebugMenuScreen, confirmDevOnly } from '../../src/screens/DebugMenuScreen';
import { saveRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';
import {
  CEREMONY_PERF_STORAGE_KEY,
  createCeremonyPerfSession,
} from '../../src/features/gacha/draw/ceremonyPerf';

function textBlob(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderDebug() {
  const navigate = vi.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />);
  });
  await flush();
  return { tree, navigate };
}

describe('DebugMenu — last ceremony report + production gating', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    storage.items.clear();
    storage.getItemFails = false;
    alertMock.mockReset();
    (saveRewardWalletState as any).mockClear();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (globalThis as any).__DEV__ = true;
    errorSpy.mockRestore();
  });

  it('shows the empty state when no ceremony has been recorded, and survives a storage failure', async () => {
    (globalThis as any).__DEV__ = false;
    const { tree } = await renderDebug();
    expect(tree.root.findByProps({ testID: 'debug-ceremony-perf' })).toBeTruthy();
    expect(textBlob(tree)).toContain('No ceremony recorded on this device yet');
    expect(tree.root.findAllByProps({ testID: 'debug-ceremony-perf-json' })).toHaveLength(0);

    storage.getItemFails = true;
    const second = await renderDebug();
    expect(textBlob(second.tree)).toContain('No ceremony recorded on this device yet');
  });

  it('renders the stored report (p50/p95/max, drops, phases, audio, device) and can reload + show JSON', async () => {
    (globalThis as any).__DEV__ = false;
    // A real session persists through the (mocked) AsyncStorage under the contract key.
    let t = 0;
    const frame: { pending: ((ts: number) => void) | null } = { pending: null };
    const session = createCeremonyPerfSession(
      { renderer: 'skia', reduceMotion: false, cardCount: 3, peakRarity: 'RAR', isMulti: true, tapFlow: true, slug: 'aws' },
      {
        now: () => t,
        raf: (cb) => { frame.pending = cb; return 1; },
        caf: () => { frame.pending = null; },
        device: () => ({ platform: 'ios', osVersion: '18.6', model: 'iPhone', jsEngine: 'hermes', appVersion: '1.6.0 (16)', updateId: 'deadbeefcafe', runtimeVersion: '1.6.0', channel: 'production' }),
      },
    );
    session.markPhase('swipe');
    t = 400;
    session.markPhase('approach');
    for (const dt of [0, 16, 16, 45, 16]) { t += dt; const cb = frame.pending; frame.pending = null; cb?.(t); }
    session.recordAudioLatency('rip', 6);
    t = 1200;
    session.markPhase('hold');
    t = 1500;
    session.stop();
    await flush();
    expect(storage.items.has(CEREMONY_PERF_STORAGE_KEY)).toBe(true);

    const { tree } = await renderDebug();
    const blob = textBlob(tree);
    expect(blob).toContain('LAST CEREMONY REPORT');
    expect(blob).toContain('skia · 3 cards · RAR · aws');
    expect(blob).toContain('Total 1500 ms · frames sampled from +400 ms');
    expect(blob).toContain('JS frames: p50 16 ms · p95 45 ms · max 45 ms · 1 > 32 ms of 4');
    expect(blob).toContain('Phases: swipe 400 ms → approach 800 ms → hold 300 ms');
    expect(blob).toContain('Audio hits: 1 · p50 6 ms · max 6 ms (rip)');
    expect(blob).toContain('Device: ios 18.6 · iPhone · hermes · app 1.6.0 (16) · update deadbeef (production)');
    expect(blob).not.toContain('"version"');

    await act(async () => {
      tree.root.findByProps({ testID: 'debug-ceremony-perf-json' }).props.onPress();
    });
    const json = tree.root.findByProps({ testID: 'debug-ceremony-perf-json-body' });
    expect(json.props.selectable).toBe(true);
    expect(JSON.parse(String(json.props.children)).meta.slug).toBe('aws');

    // Reload picks up a newer report.
    storage.items.set(CEREMONY_PERF_STORAGE_KEY, JSON.stringify({
      version: 1, startedAt: '2026-09-21T11:00:00.000Z', durationMs: 999, framesFromMs: null,
      meta: { renderer: 'fallback', reduceMotion: true, cardCount: 1, peakRarity: 'COM', isMulti: false, tapFlow: false },
      js: null, ui: null, phases: [], audio: [],
      device: { platform: 'android', osVersion: null, model: null, jsEngine: 'hermes', appVersion: null, updateId: null, runtimeVersion: null, channel: null },
    }));
    await act(async () => {
      tree.root.findByProps({ testID: 'debug-ceremony-perf-reload' }).props.onPress();
    });
    await flush();
    const after = textBlob(tree);
    expect(after).toContain('fallback · reduce motion · 1 card · COM');
    expect(after).toContain('Total 999 ms');
    expect(after).toContain('JS frames: no samples');
  });

  it('shows how many ceremony reports the device keeps', async () => {
    (globalThis as any).__DEV__ = false;
    const device = () => ({ platform: 'ios', osVersion: '18.6', model: 'iPhone', jsEngine: 'hermes', appVersion: '1.6.0 (16)', updateId: 'deadbeefcafe', runtimeVersion: '1.6.0', channel: 'production' });
    for (let i = 0; i < 2; i += 1) {
      const session = createCeremonyPerfSession(
        { renderer: 'skia', reduceMotion: false, cardCount: 3, peakRarity: 'RAR', isMulti: true, tapFlow: true, slug: `s${i}` },
        { now: () => 0, raf: null, caf: null, device },
      );
      session.markPhase('approach');
      session.stop();
      await flush();
    }

    const { tree } = await renderDebug();
    const count = tree.root.findByProps({ testID: 'debug-ceremony-perf-history-count' });
    const c = count.props.children;
    expect(Array.isArray(c) ? c.join('') : String(c)).toBe('Keeping the last 2 of 5 reports');
  });

  it('keeps the wallet/seed tools out of production and gates them behind a Dev only confirm', async () => {
    (globalThis as any).__DEV__ = false;
    const { tree } = await renderDebug();
    expect(tree.root.findAllByProps({ testID: 'debug-seed-wallet' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'debug-only-legendary' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'debug-ceremony-tuning' })).toHaveLength(0);
    // The whole DANGER ZONE (reset all progress) is not rendered in production —
    // a curious user can no longer wipe their own collection from here.
    expect(tree.root.findAllByProps({ testID: 'debug-reset-progress' })).toHaveLength(0);

    // confirmDevOnly: straight through in __DEV__, an Alert with Cancel/Continue otherwise.
    const action = vi.fn();
    confirmDevOnly(action, true);
    expect(action).toHaveBeenCalledTimes(1);
    alertMock.mockReset();
    confirmDevOnly(action, false);
    expect(action).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alertMock.mock.calls[0];
    expect(title).toBe('Dev only');
    expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Continue']);
    buttons[1].onPress();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('in __DEV__ the seed button still seeds straight away (no extra confirm)', async () => {
    (globalThis as any).__DEV__ = true;
    const { tree } = await renderDebug();
    await act(async () => {
      tree.root.findByProps({ testID: 'debug-seed-wallet' }).props.onPress();
    });
    await flush();
    expect(alertMock).not.toHaveBeenCalled();
    expect(saveRewardWalletState).toHaveBeenCalledWith({ availablePulls: 60, reservePulls: 5 });
  });
});
