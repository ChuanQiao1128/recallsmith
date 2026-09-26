import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const alertMock = vi.fn();
const setAudiencePreferenceMock = vi.fn(async (next: string) => next);
const getAudiencePreferenceMock = vi.fn(async () => 'both');
const resetAllReviewSchedulesMock = vi.fn(async (_now?: Date) => {});
const signOutNowMock = vi.fn(async () => {});
const getReminderPrefsMock = vi.fn(async () => ({
  morningEnabled: true,
  morningTime: '08:00',
  eveningEnabled: true,
  eveningTime: '20:00',
}));
const loadStreakSnapshotMock = vi.fn(async () => ({
  currentDailyStreak: 3,
  longestDailyStreak: 3,
  weekCompletedDays: 5,
  totalQualifiedSessions: 8,
  lastQualifiedDateKey: '2026-04-24',
  currentWeekKey: '2026-W17',
}));

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
    Linking: { canOpenURL: vi.fn(async () => true), openURL: vi.fn(async () => {}), openSettings: vi.fn(async () => {}) },
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
      signOutNow: signOutNowMock,
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
  DEFAULT_REMINDER_PREFS: {
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: false,
    eveningTime: '20:00',
  },
  getReminderPrefs: () => getReminderPrefsMock(),
  setReminderPrefs: vi.fn(async (next: any) => next),
  refreshDailyRemindersFromCache: vi.fn(async () => {}),
  getNotificationPermissionState: vi.fn(async () => 'granted'),
  requestNotificationPermission: vi.fn(async () => 'granted'),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: () => getAudiencePreferenceMock(),
  setAudiencePreference: (next: string) => setAudiencePreferenceMock(next),
}));

vi.mock('../../src/review/storage', () => ({
  resetAllReviewSchedules: (now: Date) => resetAllReviewSchedulesMock(now),
  loadAllProgress: vi.fn(async () => ({ csharp: [{ lastReviewedAt: 1 }] })),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: () => loadStreakSnapshotMock(),
}));

import { SettingsScreen } from '../../src/screens/SettingsScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function nodeText(node: renderer.ReactTestInstance): string {
  const content = node.props.children;
  return Array.isArray(content) ? content.join('') : String(content ?? '');
}

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && nodeText(child) === label).length > 0,
  );
}

function findPressableByTestID(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.props?.testID === testID);
}

function findHostNodesByTestID(
  tree: renderer.ReactTestRenderer,
  hostType: string,
  testID: string,
) {
  return tree.root.findAll(
    (node) => (node.type as any) === hostType && node.props?.testID === testID,
  );
}

async function renderSettings() {
  const navigate = vi.fn();
  const goBack = vi.fn();
  let tree!: renderer.ReactTestRenderer;

  await act(async () => {
    tree = renderer.create(
      <SettingsScreen
        navigation={{ navigate, goBack } as any}
        route={{ key: 'settings', name: 'Settings' } as any}
      />,
    );
  });
  await flush();

  return { tree, navigate };
}

describe('SettingsScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertMock.mockReset();
    setAudiencePreferenceMock.mockClear();
    getAudiencePreferenceMock.mockReset();
    getAudiencePreferenceMock.mockResolvedValue('both');
    resetAllReviewSchedulesMock.mockClear();
    signOutNowMock.mockReset();
    signOutNowMock.mockResolvedValue(undefined);
    getReminderPrefsMock.mockReset();
    getReminderPrefsMock.mockResolvedValue({
      morningEnabled: true,
      morningTime: '08:00',
      eveningEnabled: true,
      eveningTime: '20:00',
    });
    loadStreakSnapshotMock.mockReset();
    loadStreakSnapshotMock.mockResolvedValue({
      currentDailyStreak: 3,
      longestDailyStreak: 3,
      weekCompletedDays: 5,
      totalQualifiedSessions: 8,
      lastQualifiedDateKey: '2026-04-24',
      currentWeekKey: '2026-W17',
    });

    (globalThis as any).__DEV__ = false;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('keeps root and primary CTA testID contract with single anchor', async () => {
    const { tree } = await renderSettings();

    const roots = findHostNodesByTestID(tree, 'SafeAreaView', 'screen-settings-root');
    const primaryCtas = findHostNodesByTestID(tree, 'Pressable', 'screen-settings-primary-cta');

    expect(roots).toHaveLength(1);
    expect(primaryCtas).toHaveLength(1);

    const primaryText = findPressableByTestID(tree, 'screen-settings-primary-cta').find(
      (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
    );
    expect(primaryText.props.numberOfLines).toBe(1);

    // G34: the momentum meta line (reminder status) no longer clamps to one
    // line, so its explanation wraps instead of ending in an ellipsis at large
    // text sizes. The button label above it keeps its single-line clamp.
    const reminderMeta = tree.root.findAll(
      (node) => (node.type as any) === 'Text' && nodeText(node).includes('due cards remain'),
    );
    expect(reminderMeta.length).toBeGreaterThan(0);
    reminderMeta.forEach((node) => {
      expect(node.props.numberOfLines).toBeUndefined();
    });
  });

  it('saves audience preference when a chip is pressed', async () => {
    const { tree } = await renderSettings();

    await act(async () => {
      findPressableByText(tree, 'Junior').props.onPress();
      await Promise.resolve();
    });

    expect(setAudiencePreferenceMock).toHaveBeenCalledWith('junior');
  });

  it('confirms and runs Fresh Start reset flow', async () => {
    const { tree } = await renderSettings();

    await act(async () => {
      findPressableByText(tree, 'Make all learned cards due today').props.onPress();
    });

    expect(alertMock).toHaveBeenCalledWith(
      'Make all learned cards due today?',
      expect.stringContaining('1 learned card'),
      expect.any(Array),
    );

    const buttons = alertMock.mock.calls[0][2];
    await act(async () => {
      await buttons[1].onPress();
    });

    expect(resetAllReviewSchedulesMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith(
      'Cards are due now',
      'Your library and owned cards are unchanged.',
    );
  });

  it('renders Premium section and routes action to Paywall', async () => {
    const { tree, navigate } = await renderSettings();

    const textBlob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => nodeText(node))
      .join('\n');

    expect(textBlob).toContain('Premium');
    expect(textBlob).toContain('Open premium');

    act(() => {
      findPressableByText(tree, 'Open premium').props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('Paywall');
  });

  it('renders the ready screen with defaults when stored values are missing', async () => {
    getReminderPrefsMock.mockResolvedValueOnce(null as any);
    loadStreakSnapshotMock.mockResolvedValueOnce(null as any);

    const { tree } = await renderSettings();

    const textBlob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => nodeText(node))
      .join('\n');

    expect(textBlob).toContain('Momentum');
    expect(textBlob).toContain('0 days streak');

    const roots = findHostNodesByTestID(tree, 'SafeAreaView', 'screen-settings-root');
    const primaryCtas = findHostNodesByTestID(tree, 'Pressable', 'screen-settings-primary-cta');
    expect(roots).toHaveLength(1);
    expect(primaryCtas).toHaveLength(1);
  });

  it('renders error state and retries refresh', async () => {
    getReminderPrefsMock.mockRejectedValueOnce(new Error('network down'));

    const { tree } = await renderSettings();

    const textBlob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => nodeText(node))
      .join('\n');
    expect(textBlob).toContain('Settings unavailable');

    await act(async () => {
      findPressableByTestID(tree, 'screen-settings-primary-cta').props.onPress();
      await Promise.resolve();
    });
    await flush();

    expect(getReminderPrefsMock).toHaveBeenCalledTimes(2);

    const postRetryBlob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => nodeText(node))
      .join('\n');
    expect(postRetryBlob).toContain('Momentum');
  });
  it('opens the Debug menu after 7 taps on the version label within 3 s, even outside __DEV__', async () => {
    vi.useFakeTimers();
    try {
      const { tree, navigate } = await renderSettings();
      expect((globalThis as any).__DEV__).toBe(false);
      // The __DEV__ Debug section is absent in production.
      expect(tree.root.findAll((node) => (node.type as any) === 'Text' && nodeText(node) === 'Open debug menu')).toHaveLength(0);
      const label = findPressableByTestID(tree, 'settings-version-label');
      expect(nodeText(label.findByType('Text' as any))).toBe('App version 1.0.0');

      // Six taps spread over 6 × 700 ms = 4.2 s never complete a 3 s window.
      for (let i = 0; i < 6; i += 1) {
        act(() => { label.props.onPress(); });
        vi.advanceTimersByTime(700);
      }
      expect(navigate).not.toHaveBeenCalledWith('DebugMenu');

      // Seven quick taps do.
      vi.advanceTimersByTime(5000);
      for (let i = 0; i < 6; i += 1) {
        act(() => { label.props.onPress(); });
        vi.advanceTimersByTime(200);
      }
      expect(navigate).not.toHaveBeenCalledWith('DebugMenu');
      act(() => { label.props.onPress(); });
      expect(navigate).toHaveBeenCalledWith('DebugMenu');
      expect(navigate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
