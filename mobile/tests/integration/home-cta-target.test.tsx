import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let progressFixture: any[] = [];
let deckSummariesFixture: any[] | null = null;
let updatesFixture: Record<string, any> = {};
let walletFixture = { availablePulls: 0, reservePulls: 0 };
const setActiveDeckSlugMock = vi.fn(async (_slug: string) => {});
const navigateMock = vi.fn();

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    Alert: { alert: vi.fn() },
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

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: (slug: string) => setActiveDeckSlugMock(slug),
}));

vi.mock('../../src/features/gacha/home/deckActionResolver', () => ({
  loadHomeDeckSummaries: vi.fn(async () => {
    const now = Date.now();
    const dueToday = progressFixture.filter((item) => {
      const next = Number(item?.nextReviewAt ?? 0);
      return next <= now;
    }).length;
    const newToday = progressFixture.filter((item) => Number(item?.stage ?? 0) === 0).length;
    return {
      deckSummaries:
        deckSummariesFixture ??
        [
          {
            slug: 'csharp',
            title: 'C# Interview',
            locale: 'en-US',
            version: '1',
            deckType: 1,
            totalCards: 1,
            localCards: 1,
            studyCards: 1,
            canStudy: true,
            dueToday,
            plannedToday: dueToday,
            newToday,
            masteredApprox: Math.max(0, 1 - newToday),
            percent: 1,
          },
        ],
      updates: updatesFixture,
      allUpcoming30: Array.from({ length: 30 }, (_, i) => ({
        dateKey: new Date(now + i * 86_400_000).toISOString(),
        count: i === 0 ? dueToday : 0,
      })),
      asOfISO: new Date(now).toISOString(),
    };
  }),
  loadDeckUpdates: vi.fn(async () => ({})),
  resolveDeckAction: vi.fn(async () => ({ kind: 'open', slug: 'csharp' })),
  executeDeckAction: vi.fn(async () => ({ activeSlug: 'csharp' })),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => progressFixture),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

vi.mock('../../src/sync/progressSync', () => ({
  forceProgressSync: vi.fn(async () => {}),
  applyCachedRemoteProgress: vi.fn(async () => {}),
}));

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      status: 'signed_out',
      accessToken: '',
      init: vi.fn(async () => {}),
      userSub: null,
    }),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/home/homeRemote', () => ({
  fetchServerPremium: vi.fn(async () => false),
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(async () => walletFixture),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => ({
    currentDailyStreak: 2,
    longestDailyStreak: 2,
    weekCompletedDays: 2,
    totalQualifiedSessions: 3,
    lastQualifiedDateKey: '2026-01-01',
    currentWeekKey: '2026-W01',
  })),
}));

vi.mock('../../src/features/gacha/components/TodayPressureCard', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('View', null, React.createElement('Text', null, 'TodayPressureCard')),
  };
});

import { executeDeckAction } from '../../src/features/gacha/home/deckActionResolver';
import { HomeScreen } from '../../src/screens/HomeScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('home primary CTA target', () => {
  beforeEach(() => {
    setActiveDeckSlugMock.mockClear();
    navigateMock.mockClear();
    vi.mocked(executeDeckAction).mockClear();
    deckSummariesFixture = null;
    updatesFixture = {};
    walletFixture = { availablePulls: 0, reservePulls: 0 };
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  // Named "navigates to Challenge" until issue #11. It has asserted
  // SessionCard since the Challenge interstitial was taken out of the daily
  // flow; the name survived the change and was the only thing in the repo
  // still claiming Home goes through Challenge.
  it('navigates straight into SessionCard when today has pending work', async () => {
    progressFixture = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: navigateMock } as any}
          route={{ key: 'home', name: 'Home' } as any}
        />,
      );
    });
    await flush();

    const cta = tree.root.find((node) => node.props?.testID === 'home-primary-cta');
    await act(async () => {
      cta.props.onPress();
      await Promise.resolve();
    });

    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
    // Daily study bypasses the Challenge interstitial and goes straight
    // into SessionCard.
    expect(navigateMock).toHaveBeenCalledWith('SessionCard', { slug: 'csharp' });
  });

  it('navigates to Library when there is no pending work', async () => {
    progressFixture = [
      {
        stableUid: '1',
        stage: 1,
        lastReviewedAt: Date.now() - 1000,
        nextReviewAt: Date.now() + 24 * 60 * 60 * 1000,
      },
    ];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: navigateMock } as any}
          route={{ key: 'home', name: 'Home' } as any}
        />,
      );
    });
    await flush();

    const cta = tree.root.find((node) => node.props?.testID === 'home-primary-cta');
    await act(async () => {
      cta.props.onPress();
      await Promise.resolve();
    });

    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
    expect(navigateMock).toHaveBeenCalledWith('Library');
  });

  // The inverse of what this case used to assert. A wallet with pulls in it
  // is a reward for study already done; letting it take the primary button
  // while cards are due made Home answer a question nobody asked, and the
  // label it showed ("Open <deck>") named a screen it did not open.
  it('navigates to study, not Draw, when work is due and pulls are available', async () => {
    progressFixture = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];
    walletFixture = { availablePulls: 2, reservePulls: 0 };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: navigateMock } as any}
          route={{ key: 'home', name: 'Home' } as any}
        />,
      );
    });
    await flush();

    const cta = tree.root.find((node) => node.props?.testID === 'home-primary-cta');
    await act(async () => {
      cta.props.onPress();
      await Promise.resolve();
    });

    expect(navigateMock).toHaveBeenCalledWith('SessionCard', { slug: 'csharp' });
    expect(navigateMock).not.toHaveBeenCalledWith('Draw', expect.anything());

    const ctaLabel = cta
      .find((node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number')
      .props.children;
    expect(ctaLabel).toBe('Start today’s challenge');
  });

  it('sends a brand-new user with starter pulls straight to Draw', async () => {
    progressFixture = [];
    deckSummariesFixture = [
      {
        slug: 'csharp',
        title: 'C# Interview',
        locale: 'en-US',
        version: '1',
        deckType: 1,
        totalCards: 40,
        localCards: 0,
        studyCards: 0,
        canStudy: false,
        dueToday: 0,
        plannedToday: 0,
        newToday: 0,
        masteredApprox: 0,
        percent: 0,
      },
    ];
    updatesFixture = {
      csharp: {
        slug: 'csharp',
        installedVersion: null,
        remoteVersion: '1',
        hasUpdate: true,
        remoteUrl: 'https://example.test/csharp.json',
        remoteSha256: null,
      },
    };
    walletFixture = { availablePulls: 3, reservePulls: 0 };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: navigateMock } as any}
          route={{ key: 'home', name: 'Home' } as any}
        />,
      );
    });
    await flush();

    const cta = tree.root.find((node) => node.props?.testID === 'home-primary-cta');
    const ctaLabel = cta
      .find((node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number')
      .props.children;
    expect(ctaLabel).toBe('Open reward draw');

    await act(async () => {
      cta.props.onPress();
      await Promise.resolve();
    });

    expect(navigateMock).toHaveBeenCalledWith('Draw', {
      slug: 'csharp',
      rewardPending: true,
    });
    expect(navigateMock).not.toHaveBeenCalledWith('Library');
    expect(executeDeckAction).not.toHaveBeenCalled();
  });

  it('keeps the library CTA for an installable deck when the wallet is empty', async () => {
    progressFixture = [];
    deckSummariesFixture = [
      {
        slug: 'csharp',
        title: 'C# Interview',
        locale: 'en-US',
        version: '1',
        deckType: 1,
        totalCards: 40,
        localCards: 0,
        studyCards: 0,
        canStudy: false,
        dueToday: 0,
        plannedToday: 0,
        newToday: 0,
        masteredApprox: 0,
        percent: 0,
      },
    ];
    updatesFixture = {
      csharp: {
        slug: 'csharp',
        installedVersion: null,
        remoteVersion: '1',
        hasUpdate: true,
        remoteUrl: 'https://example.test/csharp.json',
        remoteSha256: null,
      },
    };
    walletFixture = { availablePulls: 0, reservePulls: 0 };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: navigateMock } as any}
          route={{ key: 'home', name: 'Home' } as any}
        />,
      );
    });
    await flush();

    const cta = tree.root.find((node) => node.props?.testID === 'home-primary-cta');
    const ctaLabel = cta
      .find((node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number')
      .props.children;
    expect(ctaLabel).toBe('Open library');

    await act(async () => {
      cta.props.onPress();
      await Promise.resolve();
    });

    expect(navigateMock).toHaveBeenCalledWith('Library');
    expect(navigateMock).not.toHaveBeenCalledWith('Draw', expect.anything());
  });

  it('navigates to Library when no deck is available', async () => {
    progressFixture = [];
    deckSummariesFixture = [];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: navigateMock } as any}
          route={{ key: 'home', name: 'Home' } as any}
        />,
      );
    });
    await flush();

    const cta = tree.root.find((node) => node.props?.testID === 'home-primary-cta');
    expect(cta.props.disabled).toBe(false);
    await act(async () => {
      cta.props.onPress();
      await Promise.resolve();
    });

    expect(setActiveDeckSlugMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('Library');
  });
});
