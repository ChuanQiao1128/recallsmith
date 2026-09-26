import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const alertMock = vi.fn();
const openSettingsMock = vi.fn(async () => {});
const getReminderPrefsMock = vi.fn(async () => ({
  morningEnabled: true,
  morningTime: '08:00',
  eveningEnabled: false,
  eveningTime: '20:00',
}));
const setReminderPrefsMock = vi.fn(async (patch: any) => ({
  morningEnabled: true,
  morningTime: '08:00',
  eveningEnabled: false,
  eveningTime: '20:00',
  ...patch,
}));
const refreshDailyRemindersFromCacheMock = vi.fn(async () => {});
const getNotificationPermissionStateMock = vi.fn(async () => 'granted');
const requestNotificationPermissionMock = vi.fn(async () => 'granted');
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
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Platform: { OS: 'ios' },
    Linking: {
      canOpenURL: vi.fn(async () => true),
      openURL: vi.fn(async () => {}),
      openSettings: () => openSettingsMock(),
    },
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
  DEFAULT_REMINDER_PREFS: {
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: false,
    eveningTime: '20:00',
  },
  getReminderPrefs: () => getReminderPrefsMock(),
  setReminderPrefs: (patch: any) => setReminderPrefsMock(patch),
  refreshDailyRemindersFromCache: () => refreshDailyRemindersFromCacheMock(),
  getNotificationPermissionState: () => getNotificationPermissionStateMock(),
  requestNotificationPermission: () => requestNotificationPermissionMock(),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => 'both'),
  setAudiencePreference: vi.fn(async (next: string) => next),
}));

vi.mock('../../src/review/storage', () => ({
  resetAllReviewSchedules: vi.fn(async () => {}),
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
    await Promise.resolve();
  });
}

function nodeText(node: renderer.ReactTestInstance): string {
  const content = node.props.children;
  return Array.isArray(content) ? content.join('') : String(content ?? '');
}

function findByTestID(tree: renderer.ReactTestRenderer, testID: string) {
  // Match only host elements (string type) so a component that receives testID
  // as a prop (e.g. the ToggleRow wrapper) isn't double-counted alongside the
  // real host Pressable it renders.
  return tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.testID === testID,
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

describe('SettingsScreen reminders section', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertMock.mockReset();
    openSettingsMock.mockReset();
    openSettingsMock.mockResolvedValue(undefined);
    getReminderPrefsMock.mockReset();
    getReminderPrefsMock.mockResolvedValue({
      morningEnabled: true,
      morningTime: '08:00',
      eveningEnabled: false,
      eveningTime: '20:00',
    });
    setReminderPrefsMock.mockReset();
    setReminderPrefsMock.mockImplementation(async (patch: any) => ({
      morningEnabled: true,
      morningTime: '08:00',
      eveningEnabled: false,
      eveningTime: '20:00',
      ...patch,
    }));
    refreshDailyRemindersFromCacheMock.mockReset();
    refreshDailyRemindersFromCacheMock.mockResolvedValue(undefined);
    getNotificationPermissionStateMock.mockReset();
    getNotificationPermissionStateMock.mockResolvedValue('granted');
    requestNotificationPermissionMock.mockReset();
    requestNotificationPermissionMock.mockResolvedValue('granted');
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

  it('shows Turn on reminders while permission is undetermined', async () => {
    getNotificationPermissionStateMock.mockResolvedValue('undetermined');
    const { tree } = await renderSettings();

    expect(findByTestID(tree, 'settings-reminders-turn-on')).toHaveLength(1);
    expect(findByTestID(tree, 'settings-reminders-open-settings')).toHaveLength(0);
    expect(findByTestID(tree, 'settings-reminders-morning-toggle')).toHaveLength(0);
  });

  it('shows Open iOS Settings when notifications are denied', async () => {
    getNotificationPermissionStateMock.mockResolvedValue('denied');
    const { tree } = await renderSettings();

    expect(findByTestID(tree, 'settings-reminders-open-settings')).toHaveLength(1);
    expect(findByTestID(tree, 'settings-reminders-turn-on')).toHaveLength(0);

    await act(async () => {
      findByTestID(tree, 'settings-reminders-open-settings')[0].props.onPress();
      await Promise.resolve();
    });
    expect(openSettingsMock).toHaveBeenCalledTimes(1);
  });

  it('shows morning and evening toggles once notifications are granted', async () => {
    getNotificationPermissionStateMock.mockResolvedValue('granted');
    const { tree } = await renderSettings();

    expect(findByTestID(tree, 'settings-reminders-morning-toggle')).toHaveLength(1);
    expect(findByTestID(tree, 'settings-reminders-evening-toggle')).toHaveLength(1);
    expect(findByTestID(tree, 'settings-reminders-turn-on')).toHaveLength(0);
  });

  it('does not render a sign-in button in the reminders section', async () => {
    getNotificationPermissionStateMock.mockResolvedValue('granted');
    const { tree } = await renderSettings();

    const signInTexts = tree.root.findAll(
      (node) => (node.type as any) === 'Text' && nodeText(node) === 'Sign in',
    );
    expect(signInTexts).toHaveLength(0);
  });

  it('Settings requests permission when Turn on reminders is pressed', async () => {
    getNotificationPermissionStateMock.mockResolvedValue('undetermined');
    requestNotificationPermissionMock.mockResolvedValue('granted');
    const { tree } = await renderSettings();

    await act(async () => {
      findByTestID(tree, 'settings-reminders-turn-on')[0].props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(requestNotificationPermissionMock).toHaveBeenCalledTimes(1);
    // Granting flips the section to the granted controls.
    expect(findByTestID(tree, 'settings-reminders-morning-toggle')).toHaveLength(1);
  });

  it('Settings saves an evening toggle and re-syncs reminders', async () => {
    getNotificationPermissionStateMock.mockResolvedValue('granted');
    const { tree } = await renderSettings();

    await act(async () => {
      findByTestID(tree, 'settings-reminders-evening-toggle')[0].props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(setReminderPrefsMock).toHaveBeenCalledWith({ eveningEnabled: true });
    expect(refreshDailyRemindersFromCacheMock).toHaveBeenCalled();
  });
});
