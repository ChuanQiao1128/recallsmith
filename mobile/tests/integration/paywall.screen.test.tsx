import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const linkingMock = vi.hoisted(() => ({
  canOpenURL: vi.fn(async () => true),
  openURL: vi.fn(async (_url: string) => {}),
  openSettings: vi.fn(async () => {}),
}));

const alertMock = vi.fn();
const rcGetMonthlyPackageSafeMock = vi.fn();
const rcPurchaseMonthlyMock = vi.fn(async () => ({ entitlements: { active: {} } }));
const rcRestoreMock = vi.fn(async () => ({ entitlements: { active: {} } }));
const rcGetCustomerInfoSafeMock = vi.fn(async () => ({ entitlements: { active: {} } }));
const isPremiumActiveMock = vi.fn(() => false);
const premiumStatusMock = vi.fn<() => 'unknown' | 'free' | 'premium'>(() => 'free');
const featureFlagsMock = vi.fn();
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

function defaultFeatureFlags() {
  return {
    mcq: {
      enabled: true,
      recallFirst: true,
      maxPerRun: 2,
      answerTelemetry: false,
    },
    paywall: { hidden: false },
  };
}

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
    Linking: linkingMock,
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

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => premiumStatusMock() === 'premium',
  usePremiumStatus: () => premiumStatusMock(),
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/premium/revenuecat', () => ({
  rcGetMonthlyPackageSafe: () => rcGetMonthlyPackageSafeMock(),
  rcPurchaseMonthly: () => rcPurchaseMonthlyMock(),
  rcRestore: () => rcRestoreMock(),
  rcGetCustomerInfoSafe: () => rcGetCustomerInfoSafeMock(),
  isPremiumActive: (_info: any) => isPremiumActiveMock(),
}));

vi.mock('../../src/config/featureFlags', () => ({
  useFeatureFlags: () => featureFlagsMock(),
  getFeatureFlags: () => featureFlagsMock(),
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
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: () => loadStreakSnapshotMock(),
}));

import { PaywallScreen } from '../../src/screens/PaywallScreen';
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

function findHostNodesByTestID(
  tree: renderer.ReactTestRenderer,
  hostType: string,
  testID: string,
) {
  return tree.root.findAll(
    (node) => (node.type as any) === hostType && node.props?.testID === testID,
  );
}

function textBlob(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => nodeText(node))
    .join('\n');
}

async function renderPaywall() {
  let tree!: renderer.ReactTestRenderer;

  await act(async () => {
    tree = renderer.create(
      <PaywallScreen
        navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any}
        route={{ key: 'paywall', name: 'Paywall' } as any}
      />,
    );
  });
  await flush();

  return tree;
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

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rcGetMonthlyPackageSafeMock.mockReset();
  rcGetMonthlyPackageSafeMock.mockResolvedValue(null);
  rcPurchaseMonthlyMock.mockReset();
  rcPurchaseMonthlyMock.mockResolvedValue({ entitlements: { active: {} } });
  rcRestoreMock.mockReset();
  rcRestoreMock.mockResolvedValue({ entitlements: { active: {} } });
  rcGetCustomerInfoSafeMock.mockReset();
  rcGetCustomerInfoSafeMock.mockResolvedValue({ entitlements: { active: {} } });
  isPremiumActiveMock.mockReset();
  isPremiumActiveMock.mockReturnValue(false);
  premiumStatusMock.mockReset();
  premiumStatusMock.mockReturnValue('free');
  featureFlagsMock.mockReset();
  featureFlagsMock.mockReturnValue(defaultFeatureFlags());
  linkingMock.canOpenURL.mockReset();
  linkingMock.canOpenURL.mockResolvedValue(true);
  linkingMock.openURL.mockReset();
  linkingMock.openURL.mockResolvedValue(undefined);
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

describe('PaywallScreen', () => {
  it('renders priceString with the monthly period and the purchase button when a package is available', async () => {
    rcGetMonthlyPackageSafeMock.mockResolvedValue({
      product: { identifier: 'premium_monthly', priceString: 'NZ$4.99' },
    });

    const tree = await renderPaywall();

    const billing = findHostNodesByTestID(tree, 'Text', 'paywall-billing-value');
    expect(billing).toHaveLength(1);
    expect(nodeText(billing[0])).toBe('NZ$4.99 / month');
    expect(findHostNodesByTestID(tree, 'Pressable', 'paywall-subscribe')).toHaveLength(1);
    expect(textBlob(tree)).not.toContain('Not available right now');
    expect(textBlob(tree)).not.toContain('Monthly subscription');
  });

  it('renders Not available right now and no purchase button when no priceString is available', async () => {
    rcGetMonthlyPackageSafeMock.mockResolvedValue(null);

    const tree = await renderPaywall();

    const billing = findHostNodesByTestID(tree, 'Text', 'paywall-billing-value');
    expect(billing).toHaveLength(1);
    expect(nodeText(billing[0])).toBe('Not available right now');
    expect(findHostNodesByTestID(tree, 'Pressable', 'paywall-subscribe')).toHaveLength(0);
    expect(findPressableByText(tree, 'Restore Purchases')).toBeTruthy();
  });

  it('opens Terms of Use and Privacy Policy with Linking.openURL', async () => {
    const tree = await renderPaywall();
    const terms = findHostNodesByTestID(tree, 'Pressable', 'paywall-terms-link')[0];
    const privacy = findHostNodesByTestID(tree, 'Pressable', 'paywall-privacy-link')[0];

    act(() => {
      terms.props.onPress();
      privacy.props.onPress();
    });

    expect(linkingMock.openURL).toHaveBeenNthCalledWith(
      1,
      'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
    );
    expect(linkingMock.openURL).toHaveBeenNthCalledWith(
      2,
      'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74',
    );
  });

  it('shows a Retry control when the price is unavailable and refetches on press', async () => {
    rcGetMonthlyPackageSafeMock.mockResolvedValue(null);

    const tree = await renderPaywall();

    expect(findHostNodesByTestID(tree, 'Pressable', 'paywall-price-retry')).toHaveLength(1);
    expect(findHostNodesByTestID(tree, 'Pressable', 'paywall-subscribe')).toHaveLength(0);

    // Network is back: the next fetch returns a package.
    rcGetMonthlyPackageSafeMock.mockResolvedValue({
      product: { identifier: 'premium_monthly', priceString: 'NZ$4.99' },
    });

    const retry = findHostNodesByTestID(tree, 'Pressable', 'paywall-price-retry')[0];
    await act(async () => {
      retry.props.onPress();
    });
    await flush();

    const billing = findHostNodesByTestID(tree, 'Text', 'paywall-billing-value');
    expect(nodeText(billing[0])).toBe('NZ$4.99 / month');
    expect(findHostNodesByTestID(tree, 'Pressable', 'paywall-subscribe')).toHaveLength(1);
    expect(findHostNodesByTestID(tree, 'Pressable', 'paywall-price-retry')).toHaveLength(0);
  });

  it('reports a pending purchase as pending, not failed', async () => {
    rcGetMonthlyPackageSafeMock.mockResolvedValue({
      product: { identifier: 'premium_monthly', priceString: 'NZ$4.99' },
    });
    rcGetCustomerInfoSafeMock.mockResolvedValue({ entitlements: { active: {} } });
    isPremiumActiveMock.mockReturnValue(false);
    rcPurchaseMonthlyMock.mockRejectedValue({ code: '20' });

    const tree = await renderPaywall();
    const subscribe = findHostNodesByTestID(tree, 'Pressable', 'paywall-subscribe')[0];

    await act(async () => {
      subscribe.props.onPress();
    });
    await flush();

    expect(alertMock).toHaveBeenCalledWith(
      'Purchase pending',
      expect.stringContaining('waiting for approval'),
    );
    const alertTitles = alertMock.mock.calls.map((call) => call[0]);
    expect(alertTitles).not.toContain('Purchase failed');
  });

  it('shows a checking state instead of Not subscribed while premium status is unknown', async () => {
    premiumStatusMock.mockReturnValue('unknown');

    const tree = await renderPaywall();
    const blob = textBlob(tree);

    expect(blob).toContain('Checking your subscription…');
    expect(blob).toContain('Checking…');
    expect(blob).not.toContain('Not subscribed');
  });
});

describe('SettingsScreen paywall entrance', () => {
  it('hides the Open premium card when features.paywall.hidden is true', async () => {
    featureFlagsMock.mockReturnValue({
      ...defaultFeatureFlags(),
      paywall: { hidden: true },
    });

    const { tree } = await renderSettings();

    expect(textBlob(tree)).not.toContain('Open premium');
    expect(findHostNodesByTestID(tree, 'SafeAreaView', 'screen-settings-root')).toHaveLength(1);
    expect(findHostNodesByTestID(tree, 'Pressable', 'screen-settings-primary-cta')).toHaveLength(1);
  });

  it('shows the Open premium card and routes to Paywall when the flag is false', async () => {
    const { tree, navigate } = await renderSettings();

    expect(textBlob(tree)).toContain('Open premium');

    act(() => {
      findPressableByText(tree, 'Open premium').props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('Paywall');
  });
});
