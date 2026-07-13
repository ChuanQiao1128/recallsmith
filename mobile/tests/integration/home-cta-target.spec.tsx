import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let progressFixture: any[] = [];
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

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    {
      slug: 'csharp',
      title: 'C# Interview',
      locale: 'en-US',
      version: '1',
      deckType: 1,
      totalCards: 1,
      availability: 'live',
    },
  ]),
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: 1,
    Cards: [{ StableUid: '1', Question: 'Q1', Answer: 'A1', OrderInDeck: 1, Difficulty: 1 }],
  })),
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
      deckSummaries: [
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
      updates: {},
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
  loadRewardWalletState: vi.fn(async () => ({ availablePulls: 0, reservePulls: 0 })),
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

import { HomeScreen } from '../../src/screens/HomeScreen';
import * as deckRepository from '../../src/content/deckRepository';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('home primary CTA target', () => {
  const listManifestDecksMock = vi.mocked(deckRepository.listManifestDecks);

  beforeEach(() => {
    setActiveDeckSlugMock.mockClear();
    navigateMock.mockClear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('navigates to Challenge when today has pending work', async () => {
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
    // Daily study now bypasses the Challenge interstitial and goes
    // straight into SessionCard for a one-tap study entry.
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

  it('navigates to Library when no deck is available', async () => {
    listManifestDecksMock.mockResolvedValueOnce([]);
    progressFixture = [];

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
