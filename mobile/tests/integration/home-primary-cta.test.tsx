import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let progressFixture: any[] = [];
let viewportWidth = 390;
let walletFixture = { availablePulls: 0, reservePulls: 0 };
let authFixture = {
  status: 'signed_out',
  accessToken: '',
  userSub: null as string | null,
};
let cachedPremiumFixture = false;
let streakFixture = {
  currentDailyStreak: 2,
  longestDailyStreak: 2,
  weekCompletedDays: 2,
  totalQualifiedSessions: 3,
  lastQualifiedDateKey: '2026-01-01',
  currentWeekKey: '2026-W01',
};
const fetchServerPremiumMock = vi.fn(async (_token: string) => false);
const resolveDeckActionMock = vi.fn(async (_input: any) => ({ kind: 'open', slug: 'csharp' }));
const executeDeckActionMock = vi.fn(async (_action: any) => ({ activeSlug: 'csharp' }));

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
  autoApplyFreeDeckUpdates: vi.fn(() => []),
  resolveDeckAction: (input: any) => resolveDeckActionMock(input),
  executeDeckAction: (action: any) => executeDeckActionMock(action),
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
      status: authFixture.status,
      accessToken: authFixture.accessToken,
      init: vi.fn(async () => {}),
      userSub: authFixture.userSub,
    }),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => cachedPremiumFixture,
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/home/homeRemote', () => ({
  fetchServerPremium: (token: string) => fetchServerPremiumMock(token),
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(async () => walletFixture),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => streakFixture),
}));

import { HomeScreen } from '../../src/screens/HomeScreen';
import { useSessionStore } from '../../src/features/gacha/session/sessionStore';

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
    authFixture = {
      status: 'signed_out',
      accessToken: '',
      userSub: null,
    };
    walletFixture = { availablePulls: 0, reservePulls: 0 };
    cachedPremiumFixture = false;
    streakFixture = {
      currentDailyStreak: 2,
      longestDailyStreak: 2,
      weekCompletedDays: 2,
      totalQualifiedSessions: 3,
      lastQualifiedDateKey: '2026-01-01',
      currentWeekKey: '2026-W01',
    };
    fetchServerPremiumMock.mockReset();
    fetchServerPremiumMock.mockResolvedValue(false);
    resolveDeckActionMock.mockClear();
    executeDeckActionMock.mockClear();
    useSessionStore.getState().resetSession();
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

      const matches = tree.root.findAll(
        (node) =>
          node.props?.testID === 'home-primary-cta' && (node.type as any) === 'Pressable',
      );
      expect(matches).toHaveLength(1);

      const primaryCtaText = matches[0].find(
        (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
      );
      expect(primaryCtaText.props.numberOfLines).toBe(1);

      const rootMatches = tree.root.findAll(
        (node) => node.props?.testID === 'screen-home-root' && (node.type as any) === 'SafeAreaView',
      );
      expect(rootMatches).toHaveLength(1);

      const primarySurfaceMatches = tree.root.findAll(
        (node) =>
          node.props?.testID === 'screen-home-primary-cta' && (node.type as any) === 'View',
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
      expect(textBlob).toContain('Due');
      expect(textBlob).toContain('New');
      expect(textBlob).toContain('Learned');
      // Fourth tile is the selected deck's owned cards, not the cross-deck due
      // sum that read "0 Total" under a 441-card deck.
      expect(textBlob).toContain('Owned');
      expect(textBlob).not.toContain('Total');

      const metricStyle = tree.root.findByProps({ testID: 'home-today-count-total' }).props.style;
      expect(metricStyle).toEqual(
        expect.arrayContaining([
          width < 390 ? expect.objectContaining({ width: '48%' }) : expect.objectContaining({ flex: 1 }),
        ]),
      );
    },
  );

  it.each([
    {
      label: 'locked',
      wallet: { availablePulls: 0, reservePulls: 0 },
      expectedPrimaryCta: 'Start today’s challenge',
      expectedDrawBadge: 'Learn a new card to earn a pull',
      expectedRoute: 'SessionCard',
      expectedParams: { slug: 'csharp' },
    },
    // The deck fixture always has work due, so every wallet state below keeps
    // the primary button on study. The wallet badge is where the reward is
    // announced, and it stays informative in all four states.
    {
      label: 'available',
      wallet: { availablePulls: 2, reservePulls: 0 },
      expectedPrimaryCta: 'Start today’s challenge',
      expectedDrawBadge: '2 pulls ready',
      expectedRoute: 'SessionCard',
      expectedParams: { slug: 'csharp' },
    },
    {
      label: 'reserve',
      wallet: { availablePulls: 1, reservePulls: 2 },
      expectedPrimaryCta: 'Start today’s challenge',
      expectedDrawBadge: '1 pull ready · 2 more waiting',
      expectedRoute: 'SessionCard',
      expectedParams: { slug: 'csharp' },
    },
    {
      label: 'wallet-full',
      wallet: { availablePulls: 60, reservePulls: 5 },
      expectedPrimaryCta: 'Start today’s challenge',
      expectedDrawBadge: 'Wallet full (60 + 5)',
      expectedRoute: 'SessionCard',
      expectedParams: { slug: 'csharp' },
    },
  ])(
    'keeps v9 reward gateway contract for %s wallet state',
    async ({ wallet, expectedPrimaryCta, expectedDrawBadge, expectedRoute, expectedParams }) => {
      walletFixture = wallet;
      const navigate = vi.fn();
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(
          <HomeScreen
            navigation={{ navigate } as any}
            route={{ key: 'home', name: 'Home' } as any}
          />,
        );
      });
      await flush();

      const primaryCta = tree.root.find(
        (node) => node.props?.testID === 'home-primary-cta' && (node.type as any) === 'Pressable',
      );
      const primaryCtaLabel = primaryCta
        .find((node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number')
        .props.children;
      expect(primaryCtaLabel).toBe(expectedPrimaryCta);
      expect(tree.root.findByProps({ testID: 'home-draw-status-badge' }).props.children).toBe(
        expectedDrawBadge,
      );

      await act(async () => {
        primaryCta.props.onPress();
        await Promise.resolve();
      });

      expect(navigate).toHaveBeenCalledWith(expectedRoute, expectedParams);
    },
  );

  it.each([
    {
      label: 'today_done_locked',
      progress: [{ stableUid: '1', stage: 0, nextReviewAt: 0 }],
      wallet: { availablePulls: 0, reservePulls: 0 },
      expectedPrimaryCta: 'Continue today’s challenge',
      expectedRoute: 'SessionCard',
      expectedParams: { slug: 'csharp' },
    },
    {
      // Minimum goal met but cards still waiting: the reward does not get to
      // end the day on the user's behalf.
      label: 'today_done_available',
      progress: [{ stableUid: '1', stage: 0, nextReviewAt: 0 }],
      wallet: { availablePulls: 2, reservePulls: 0 },
      expectedPrimaryCta: 'Continue today’s challenge',
      expectedRoute: 'SessionCard',
      expectedParams: { slug: 'csharp' },
    },
    {
      label: 'today_full_clear_locked',
      progress: [
        {
          stableUid: '1',
          stage: 1,
          lastReviewedAt: Date.now() - 1000,
          nextReviewAt: Date.now() + 24 * 60 * 60 * 1000,
        },
      ],
      wallet: { availablePulls: 0, reservePulls: 0 },
      expectedPrimaryCta: 'Open library',
      expectedRoute: 'Library',
      expectedParams: undefined,
    },
    {
      label: 'today_full_clear_available',
      progress: [
        {
          stableUid: '1',
          stage: 1,
          lastReviewedAt: Date.now() - 1000,
          nextReviewAt: Date.now() + 24 * 60 * 60 * 1000,
        },
      ],
      wallet: { availablePulls: 2, reservePulls: 0 },
      // Nothing left to learn: the draw may take the button, and the label
      // now names the screen it actually opens.
      expectedPrimaryCta: 'Open reward draw',
      expectedRoute: 'Draw',
      expectedParams: { slug: 'csharp', rewardPending: true },
    },
  ])(
    'keeps CTA label and route aligned for %s',
    async ({ progress, wallet, expectedPrimaryCta, expectedRoute, expectedParams }) => {
      progressFixture = progress;
      walletFixture = wallet;
      streakFixture = {
        ...streakFixture,
        lastQualifiedDateKey: formatDateKey(new Date()),
      };

      const navigate = vi.fn();
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(
          <HomeScreen
            navigation={{ navigate } as any}
            route={{ key: 'home', name: 'Home' } as any}
          />,
        );
      });
      await flush();

      const primaryCta = tree.root.find(
        (node) => node.props?.testID === 'home-primary-cta' && (node.type as any) === 'Pressable',
      );
      const primaryCtaLabel = primaryCta
        .find((node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number')
        .props.children;
      expect(primaryCtaLabel).toBe(expectedPrimaryCta);

      await act(async () => {
        primaryCta.props.onPress();
        await Promise.resolve();
      });

      if (expectedParams) {
        expect(navigate).toHaveBeenCalledWith(expectedRoute, expectedParams);
      } else {
        expect(navigate).toHaveBeenCalledWith(expectedRoute);
      }
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

    expect(decksToggle.props.accessibilityRole).toBe('button');
    expect(weekToggle.props.accessibilityRole).toBe('button');
    expect(decksToggle.props.accessibilityState).toEqual({ expanded: false });
    expect(weekToggle.props.accessibilityState).toEqual({ expanded: false });
    expect(tree.root.findAll((node) => node.props?.testID === 'home-collapse-draw-support-toggle')).toHaveLength(0);

    act(() => {
      decksToggle.props.onPress();
      weekToggle.props.onPress();
    });

    expect(
      tree.root.find((node) => node.props?.testID === 'home-collapse-decks-toggle').props
        .accessibilityState,
    ).toEqual({ expanded: true });
    expect(
      tree.root.find((node) => node.props?.testID === 'home-collapse-week-support-toggle').props
        .accessibilityState,
    ).toEqual({ expanded: true });
  });

  it('keeps cached premium active when the server premium check fails', async () => {
    cachedPremiumFixture = true;
    authFixture = {
      status: 'signed_in',
      accessToken: 'access-token',
      userSub: 'premium-user',
    };
    fetchServerPremiumMock.mockRejectedValueOnce(new Error('network'));

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

    act(() => {
      tree.root.find((node) => node.props?.testID === 'home-collapse-decks-toggle').props.onPress();
    });

    await act(async () => {
      tree.root.find((node) => node.props?.testID === 'home-deck-row-csharp').props.onPress();
      await Promise.resolve();
    });

    expect(fetchServerPremiumMock).toHaveBeenCalledWith('access-token');
    expect(resolveDeckActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        premium: true,
        signedIn: true,
      }),
    );
  });
});
