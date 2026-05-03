import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const alertMock = vi.fn();
const setAudiencePreferenceMock = vi.fn(async (next: string) => next);
const resetAllReviewSchedulesMock = vi.fn(async (_now?: Date) => {});

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    Modal: ({ children, visible }: any) => (visible ? React.createElement('Modal', null, children) : null),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    RefreshControl: (props: any) => React.createElement('RefreshControl', props),
    Platform: { OS: 'ios' },
    Linking: { canOpenURL: vi.fn(async () => true), openURL: vi.fn(async () => {}) },
    Alert: { alert: (...args: any[]) => alertMock(...args) },
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: any) => {
    React.useEffect(() => callback(), [callback]);
  },
}));

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

vi.mock('expo-file-system', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  readDirectoryAsync: vi.fn(async () => []),
  deleteAsync: vi.fn(async () => {}),
  getInfoAsync: vi.fn(async () => ({ exists: false })),
}));

vi.mock('react-native-purchases', () => ({
  default: {
    getCustomerInfo: vi.fn(async () => ({ entitlements: { active: {} }, activeSubscriptions: [] })),
    invalidateCustomerInfoCache: vi.fn(async () => {}),
    restorePurchases: vi.fn(async () => ({})),
  },
}));

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      status: 'signed_in',
      email: 'test@example.com',
      loading: false,
      signOutNow: vi.fn(async () => {}),
    }),
}));

vi.mock('../../src/content/deckRepository', () => ({
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

vi.mock('../../src/config/remoteConfig', () => ({
  getCurrentAppVersion: () => '1.0.0',
  fetchRemoteConfig: vi.fn(async () => ({ minSupportedVersion: null, latestVersion: '1.0.0' })),
  compareSemver: vi.fn(() => 0),
}));

vi.mock('../../src/notifications/reminders', () => ({
  getReminderPrefs: vi.fn(async () => ({ enabled: false, morningTime: '08:00', eveningTime: '20:00' })),
  setReminderPrefs: vi.fn(async (next: any) => next),
  refreshDailyRemindersFromCache: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => 'both'),
  setAudiencePreference: (next: string) => setAudiencePreferenceMock(next),
}));

vi.mock('../../src/review/storage', () => ({
  resetAllReviewSchedules: (now: Date) => resetAllReviewSchedulesMock(now),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => ({
    currentDailyStreak: 3,
    longestDailyStreak: 3,
    weekCompletedDays: 5,
    totalQualifiedSessions: 8,
    lastQualifiedDateKey: '2026-04-24',
    currentWeekKey: '2026-W17',
  })),
}));

import { SettingsScreen } from '../../src/screens/SettingsScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('SettingsScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertMock.mockReset();
    setAudiencePreferenceMock.mockClear();
    resetAllReviewSchedulesMock.mockClear();
    (globalThis as any).__DEV__ = false;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('saves audience preference when a chip is pressed', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SettingsScreen navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any} route={{ key: 'settings', name: 'Settings' } as any} />);
    });
    await flush();

    await act(async () => {
      findPressableByText(tree, 'Junior').props.onPress();
      await Promise.resolve();
    });

    expect(setAudiencePreferenceMock).toHaveBeenCalledWith('junior');
  });

  it('confirms and runs Fresh Start reset flow', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SettingsScreen navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any} route={{ key: 'settings', name: 'Settings' } as any} />);
    });
    await flush();

    act(() => {
      findPressableByText(tree, 'Reset review schedule').props.onPress();
    });

    expect(alertMock).toHaveBeenCalledWith(
      'Reset review schedule',
      'Keep your library. Bring learned cards back into today. Continue?',
      expect.any(Array),
    );

    const buttons = alertMock.mock.calls[0][2];
    await act(async () => {
      await buttons[1].onPress();
    });

    expect(resetAllReviewSchedulesMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith(
      'Review schedule reset',
      'Learned cards are due again today. Your library stays intact.',
    );
  });

  it('renders momentum and reminder support copy', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SettingsScreen navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any} route={{ key: 'settings', name: 'Settings' } as any} />);
    });
    await flush();

    const textBlob = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    }).join('\n');

    expect(textBlob).toContain('Momentum');
    expect(textBlob).toContain('3 days');
    expect(textBlob).toContain('8');
    expect(textBlob).toContain('due cards remain');
  });
});
