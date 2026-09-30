import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles },
    Alert: { alert: vi.fn() },
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

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
    getAllKeys: vi.fn(async () => []),
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

const obs = vi.hoisted(() => {
  const state = {
    status: { active: false, reason: 'pending' } as { active: boolean; reason: string },
    sendTestEvent: vi.fn(() =>
      state.status.active
        ? { sent: true, eventId: '0123456789abcdef0123456789abcdef', reason: 'active' }
        : { sent: false, eventId: null, reason: state.status.reason },
    ),
  };
  return state;
});

vi.mock('../../src/telemetry/observability', () => ({
  getObservabilityStatus: () => obs.status,
  sendTestEvent: () => obs.sendTestEvent(),
}));

import { DebugMenuScreen } from '../../src/screens/DebugMenuScreen';

const CRASH = /crash/i;

async function renderDebug() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <DebugMenuScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
}

function textOf(node: renderer.ReactTestInstance): string {
  const c = node.props.children;
  return Array.isArray(c) ? c.join('') : String(c ?? '');
}

describe('DebugMenu — Sentry status and test event', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    obs.sendTestEvent.mockClear();
  });

  afterEach(() => {
    (globalThis as any).__DEV__ = true;
    errorSpy.mockRestore();
  });

  it.each([true, false])('shows the section in all builds (__DEV__ = %s)', async (dev) => {
    (globalThis as any).__DEV__ = dev;
    obs.status = { active: false, reason: 'no-dsn' };
    const tree = await renderDebug();
    expect(tree.root.findAllByProps({ testID: 'debug-sentry-status' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'debug-sentry-test-event' }).length).toBeGreaterThan(0);
  });

  it('active: status line and a sent test event', async () => {
    (globalThis as any).__DEV__ = false;
    obs.status = { active: true, reason: 'active' };
    const tree = await renderDebug();
    expect(textOf(tree.root.findByProps({ testID: 'debug-sentry-status' }))).toBe('Sentry: active');

    const button = tree.root.findByProps({ testID: 'debug-sentry-test-event' });
    expect(button.props.accessibilityRole).toBe('button');
    await act(async () => {
      button.props.onPress();
    });
    expect(obs.sendTestEvent).toHaveBeenCalledTimes(1);
    expect(textOf(tree.root.findByProps({ testID: 'debug-sentry-test-event-result' }))).toBe('Sent: 01234567');
  });

  it('inactive: status line with the reason and a not-sent result', async () => {
    (globalThis as any).__DEV__ = false;
    obs.status = { active: false, reason: 'no-dsn' };
    const tree = await renderDebug();
    expect(textOf(tree.root.findByProps({ testID: 'debug-sentry-status' }))).toBe('Sentry: inactive (no-dsn)');

    await act(async () => {
      tree.root.findByProps({ testID: 'debug-sentry-test-event' }).props.onPress();
    });
    expect(obs.sendTestEvent).toHaveBeenCalledTimes(1);
    expect(textOf(tree.root.findByProps({ testID: 'debug-sentry-test-event-result' }))).toBe('Not sent (no-dsn)');
  });

  it.each([true, false])('has no element whose testID or text matches /crash/i (__DEV__ = %s)', async (dev) => {
    (globalThis as any).__DEV__ = dev;
    obs.status = { active: true, reason: 'active' };
    const tree = await renderDebug();
    const offenders = tree.root.findAll((node) => {
      const { testID, accessibilityLabel, children } = node.props ?? {};
      if (typeof testID === 'string' && CRASH.test(testID)) return true;
      if (typeof accessibilityLabel === 'string' && CRASH.test(accessibilityLabel)) return true;
      if (typeof children === 'string' && CRASH.test(children)) return true;
      if (Array.isArray(children) && children.some((c) => typeof c === 'string' && CRASH.test(c))) return true;
      return false;
    });
    expect(offenders).toHaveLength(0);
  });
});
