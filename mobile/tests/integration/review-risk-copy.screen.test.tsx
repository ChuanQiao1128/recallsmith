import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// App Review risk copy (G11): the draw/Library surfaces drop the "Pokedex"
// trademark, Profile's CTA opens Settings instead of the placeholder Edit
// Profile screen, the production Debug menu is read-only (ceremony report
// only), and the force-update overlay always has a real App Store link.

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

const storage = vi.hoisted(() => ({ items: new Map<string, string>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.items.get(key) ?? null),
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

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.6.1' }, appOwnership: null },
}));

vi.mock('expo-application', () => ({
  nativeApplicationVersion: '1.6.1',
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  saveRewardWalletState: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  loadDrawState: vi.fn(async () => ({ owned: [], pity: null })),
  saveDrawState: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => 'Both'),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => null),
}));

import { COLLECTION_COPY } from '../../src/features/gacha/copy/collectionCopy';
import { ProfileScreen } from '../../src/screens/ProfileScreen';
import { DebugMenuScreen } from '../../src/screens/DebugMenuScreen';
import { resolveIosUpdate, DEFAULT_APP_STORE_URL } from '../../src/config/remoteConfig';

function textBlob(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App Review risk copy (G11)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    storage.items.clear();
    alertMock.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (globalThis as any).__DEV__ = true;
    errorSpy.mockRestore();
  });

  it('collection copy never uses the Pokedex trademark', () => {
    const strings = [
      COLLECTION_COPY.resultPill(5),
      COLLECTION_COPY.resultEyebrow(5),
      COLLECTION_COPY.libraryEyebrow,
      COLLECTION_COPY.libraryEmptyEyebrow,
    ];
    for (const s of strings) {
      expect(s.toLowerCase()).not.toContain('pokedex');
      expect(s.toLowerCase()).toContain('collection');
    }
    expect(COLLECTION_COPY.resultPill(3)).toBe('Collection +3');
    expect(COLLECTION_COPY.resultEyebrow(3)).toBe('+3 TO YOUR COLLECTION');
    expect(COLLECTION_COPY.libraryEyebrow).toBe('COLLECTION');
    expect(COLLECTION_COPY.libraryEmptyEyebrow).toBe('YOUR COLLECTION IS EMPTY');
  });

  it('profile primary action opens Settings instead of the placeholder Edit Profile', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ProfileScreen navigation={{ navigate } as any} route={{ key: 'profile', name: 'Profile' } as any} />,
      );
    });
    await flush();

    const blob = textBlob(tree);
    expect(blob).toContain('Study settings');
    expect(blob).not.toContain('Edit profile');

    act(() => {
      findPressableByText(tree, 'Study settings').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Settings');
    expect(navigate).not.toHaveBeenCalledWith('EditProfile');
  });

  it('production debug menu shows only the ceremony report: no reset, no dev shells, no scenarios', async () => {
    (globalThis as any).__DEV__ = false;
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />,
      );
    });
    await flush();

    // The ceremony performance card is the one thing that survives.
    expect(tree.root.findByProps({ testID: 'debug-ceremony-perf' })).toBeTruthy();

    // Progress-wiping DANGER ZONE and dev-only tools are gone.
    expect(tree.root.findAllByProps({ testID: 'debug-reset-progress' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'debug-seed-wallet' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'debug-ceremony-tuning' })).toHaveLength(0);

    const blob = textBlob(tree);
    expect(blob).toContain('Diagnostics');
    expect(blob).not.toContain('Scenario switching and QA shortcuts');
    expect(blob).not.toContain('Open error shell');
    expect(blob).not.toContain('Offline banner');
    expect(blob).not.toContain('DANGER ZONE');
    expect(blob).not.toContain('New user');
  });

  it('update overlay falls back to the App Store listing when remote config has no link', () => {
    const resolved = resolveIosUpdate({ ios: { minSupportedVersion: '9.0.0' } }, '1.6.1');
    expect(resolved.updateUrl).toBe(DEFAULT_APP_STORE_URL);
    expect(DEFAULT_APP_STORE_URL).toBe('https://apps.apple.com/app/id6756044885');
  });
});
