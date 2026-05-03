import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let progressFixture: any[] = [];
let viewportWidth = 390;

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    useWindowDimensions: () => ({ width: viewportWidth, height: 844, scale: 3, fontScale: 1 }),
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
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    {
      slug: 'csharp',
      title: 'C# Interview',
      locale: 'en-US',
      version: '1',
      deckType: 1,
      totalCards: 10,
      availability: 'live',
    },
  ]),
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: 10,
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
          totalCards: 10,
          localCards: 10,
          studyCards: 10,
          canStudy: true,
          dueToday,
          plannedToday: dueToday,
          newToday,
          masteredApprox: Math.max(0, 10 - newToday),
          percent: 0.4,
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('home primary CTA uniqueness', () => {
  beforeEach(() => {
    progressFixture = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];
    viewportWidth = 390;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it.each([360, 375, 390, 430])(
    'keeps one primary CTA and stable first-screen hierarchy at width %d',
    async (width) => {
      viewportWidth = width;
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(
          <HomeScreen
            navigation={{ navigate: vi.fn() } as any}
            route={{ key: 'home', name: 'Home' } as any}
          />,
        );
      });
      await flush();

      const matches = tree.root.findAll((node) => node.props?.testID === 'home-primary-cta');
      expect(matches).toHaveLength(1);

      const primaryCtaText = matches[0].find(
        (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
      );
      expect(primaryCtaText.props.numberOfLines).toBe(1);

      const rootMatches = tree.root.findAll((node) => node.props?.testID === 'screen-home-root');
      expect(rootMatches).toHaveLength(1);

      const primarySurfaceMatches = tree.root.findAll(
        (node) => node.props?.testID === 'screen-home-primary-cta',
      );
      expect(primarySurfaceMatches).toHaveLength(1);

      const textBlob = tree.root
        .findAll((node) => (node.type as any) === 'Text')
        .map((node) => {
          const c = node.props.children;
          return Array.isArray(c) ? c.join('') : String(c ?? '');
        })
        .join('\n');
      expect(textBlob).not.toContain('Peek at reward draw');
      expect(textBlob).not.toContain('Start first draw');
    },
  );

  it('adds explicit accessibility semantics on Home collapsible triggers', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'home', name: 'Home' } as any}
        />,
      );
    });
    await flush();

    const decksToggle = tree.root.find((node) => node.props?.testID === 'home-collapse-decks-toggle');
    const weekToggle = tree.root.find(
      (node) => node.props?.testID === 'home-collapse-week-support-toggle',
    );
    const drawToggle = tree.root.find(
      (node) => node.props?.testID === 'home-collapse-draw-support-toggle',
    );

    expect(decksToggle.props.accessibilityRole).toBe('button');
    expect(weekToggle.props.accessibilityRole).toBe('button');
    expect(drawToggle.props.accessibilityRole).toBe('button');
    expect(decksToggle.props.accessibilityState).toEqual({ expanded: false });
    expect(weekToggle.props.accessibilityState).toEqual({ expanded: false });
    expect(drawToggle.props.accessibilityState).toEqual({ expanded: false });

    act(() => {
      decksToggle.props.onPress();
      weekToggle.props.onPress();
      drawToggle.props.onPress();
    });

    expect(
      tree.root.find((node) => node.props?.testID === 'home-collapse-decks-toggle').props
        .accessibilityState,
    ).toEqual({ expanded: true });
    expect(
      tree.root.find((node) => node.props?.testID === 'home-collapse-week-support-toggle').props
        .accessibilityState,
    ).toEqual({ expanded: true });
    expect(
      tree.root.find((node) => node.props?.testID === 'home-collapse-draw-support-toggle').props
        .accessibilityState,
    ).toEqual({ expanded: true });
  });
});
