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

// Mutable auth fixture so a test can flip `loading` and re-render, the way a real
// auth reload would after the first successful settings load.
const authFixture: {
  status: string;
  email: string | null;
  loading: boolean;
  signOutNow: () => Promise<void>;
} = {
  status: 'signed_in',
  email: 'test@example.com',
  loading: false,
  signOutNow: signOutNowMock,
};

// Records the focus callback so a test can re-run it to simulate the screen
// regaining focus (return from SignIn/Paywall/an external link).
let focusCallback: (() => void) | null = null;

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
    TextInput: (props: any) => React.createElement('TextInput', props),
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

vi.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useFocusEffect: (callback: any) => {
      focusCallback = callback;
      React.useEffect(() => callback(), [callback]);
    },
  };
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
  useAuthStore: (selector: any) => selector(authFixture),
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

function textBlob(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => nodeText(node))
    .join('\n');
}

function findHostByTestID(tree: renderer.ReactTestRenderer, hostType: string, testID: string) {
  return tree.root.find((node) => (node.type as any) === hostType && node.props?.testID === testID);
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

function renderElement(navigate: any, goBack: any) {
  return (
    <SettingsScreen
      navigation={{ navigate, goBack } as any}
      route={{ key: 'settings', name: 'Settings' } as any}
    />
  );
}

describe('SettingsScreen background refresh', () => {
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

    authFixture.status = 'signed_in';
    authFixture.email = 'test@example.com';
    authFixture.loading = false;
    focusCallback = null;

    (globalThis as any).__DEV__ = false;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('keeps the settings content mounted when the screen refocuses', async () => {
    const { tree } = await renderSettings();
    expect(textBlob(tree)).toContain('Momentum');

    // A refocus while the reminder read is still pending must not swap the
    // screen for the spinner after the first successful load.
    getReminderPrefsMock.mockReturnValueOnce(new Promise(() => {}) as any);
    await act(async () => {
      focusCallback?.();
    });

    const blob = textBlob(tree);
    expect(blob).not.toContain('Loading settings...');
    expect(blob).toContain('Momentum');
  });

  it('keeps the typed DELETE confirmation across a refocus', async () => {
    const { tree } = await renderSettings();

    await act(async () => {
      findHostByTestID(tree, 'Pressable', 'settings-delete-account-open').props.onPress();
    });

    await act(async () => {
      findHostByTestID(tree, 'TextInput', 'settings-delete-account-input').props.onChangeText('DEL');
    });
    expect(findHostByTestID(tree, 'TextInput', 'settings-delete-account-input').props.value).toBe('DEL');

    await act(async () => {
      focusCallback?.();
    });
    await flush();

    expect(findHostByTestID(tree, 'TextInput', 'settings-delete-account-input').props.value).toBe('DEL');
  });

  it('keeps the settings screen visible when a background refresh fails', async () => {
    const { tree } = await renderSettings();
    expect(textBlob(tree)).toContain('Momentum');

    getReminderPrefsMock.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      focusCallback?.();
    });
    await flush();

    const blob = textBlob(tree);
    expect(blob).not.toContain('Settings unavailable');
    expect(blob).toContain('Momentum');
  });

  it('keeps the settings content while auth reloads after the first load', async () => {
    const navigate = vi.fn();
    const goBack = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(renderElement(navigate, goBack));
    });
    await flush();
    expect(textBlob(tree)).toContain('Momentum');

    authFixture.loading = true;
    await act(async () => {
      tree.update(renderElement(navigate, goBack));
    });

    const blob = textBlob(tree);
    expect(blob).not.toContain('Loading settings...');
    expect(blob).toContain('Momentum');
  });
});
