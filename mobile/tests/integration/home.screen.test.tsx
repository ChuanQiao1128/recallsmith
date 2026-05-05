import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let progressFixture: any[] = [];
const setActiveDeckSlugMock = vi.fn(async (_slug?: string) => {});
const loadActiveDeckSlugMock = vi.fn(async () => 'csharp');
const navigateMock = vi.fn();
let manifestDecksFixture: any[] = [
  { slug: 'csharp', title: 'C# Interview', locale: 'en-US', version: '1', deckType: 1, totalCards: 1, availability: 'live' },
];
let resolvedDeckFixture: any = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 1,
  Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1' }],
};
const resolveDeckBySlugMock = vi.fn(async (_slug: string) => resolvedDeckFixture);
let authFixture = {
  status: 'signed_out',
  accessToken: '',
  userSub: null as string | null,
};
let cachedPremiumFixture = false;
const fetchServerPremiumMock = vi.fn(async (_token: string) => false);

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Modal: ({ children, visible }: any) => (visible ? React.createElement('Modal', null, children) : null),
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
  useNavigation: () => ({ navigate: navigateMock }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: () => loadActiveDeckSlugMock(),
  setActiveDeckSlug: (slug: string) => setActiveDeckSlugMock(slug),
}));

vi.mock('../../src/content/deckRepository', () => ({
  checkManifestForUpdates: vi.fn(async () => ({})),
  listManifestDecks: vi.fn(async () => manifestDecksFixture),
  resolveDeckBySlug: (slug: string) => resolveDeckBySlugMock(slug),
  installDeckFromUrl: vi.fn(async () => true),
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

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => cachedPremiumFixture,
  setIsPremiumUser: vi.fn(),
}));

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      status: authFixture.status,
      accessToken: authFixture.accessToken,
      init: vi.fn(async () => {}),
      userSub: authFixture.userSub,
      loading: false,
    }),
}));

vi.mock('../../src/features/gacha/components/HomeHero', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ hero, onPress }: any) =>
      React.createElement(
        'Pressable',
        { onPress },
        React.createElement('Text', null, hero.ctaLabel),
      ),
  };
});

vi.mock('../../src/features/gacha/components/TodayPressureCard', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('View', null, React.createElement('Text', null, 'TodayPressureCard')),
  };
});

vi.mock('../../src/features/gacha/components/RoutePreview', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('View', null, React.createElement('Text', null, 'RoutePreview')),
  };
});

vi.mock('../../src/features/gacha/home/homeRemote', () => ({
  fetchPremiumDeckUrl: vi.fn(async () => null),
  fetchServerPremium: (token: string) => fetchServerPremiumMock(token),
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(async () => ({ availablePulls: 2, reservePulls: 0 })),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => ({
    currentDailyStreak: 4,
    longestDailyStreak: 4,
    weekCompletedDays: 5,
    totalQualifiedSessions: 9,
    lastQualifiedDateKey: '2026-04-24',
    currentWeekKey: '2026-W17',
  })),
}));

import { HomeScreen } from '../../src/screens/HomeScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function findPressablesByTestID(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((node) => (node.type as any) === 'Pressable' && node.props?.testID === testID);
}

describe('HomeScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    progressFixture = [];
    manifestDecksFixture = [
      { slug: 'csharp', title: 'C# Interview', locale: 'en-US', version: '1', deckType: 1, totalCards: 1, availability: 'live' },
    ];
    resolvedDeckFixture = {
      Slug: 'csharp',
      Title: 'C# Interview',
      Locale: 'en-US',
      Version: '1',
      DeckType: 1,
      TotalCards: 1,
      Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1' }],
    };
    resolveDeckBySlugMock.mockReset();
    resolveDeckBySlugMock.mockImplementation(async () => resolvedDeckFixture);
    authFixture = {
      status: 'signed_out',
      accessToken: '',
      userSub: null,
    };
    cachedPremiumFixture = false;
    fetchServerPremiumMock.mockReset();
    fetchServerPremiumMock.mockResolvedValue(false);
    navigateMock.mockReset();
    setActiveDeckSlugMock.mockClear();
    loadActiveDeckSlugMock.mockClear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('opens Challenge when today has work', async () => {
    progressFixture = [{ stableUid: '1', stage: 1, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() - 1000 }];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    act(() => {
      findPressableByLabel(tree, 'Open C# Interview').props.onPress();
    });

    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
    expect(navigateMock).toHaveBeenCalledWith('Challenge', { slug: 'csharp' });
    expect(tree.root.findByProps({ testID: 'home-study-due-link' })).toBeTruthy();
  });

  it('opens Library when there is no pressure today', async () => {
    progressFixture = [{ stableUid: '1', stage: 1, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 }];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    act(() => {
      findPressableByLabel(tree, 'Open C# Interview').props.onPress();
    });

    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
    expect(navigateMock).toHaveBeenCalledWith('Library');
  });

  it('keeps draw support out of the default secondary drawers', async () => {
    progressFixture = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    expect(findPressablesByTestID(tree, 'home-collapse-decks-toggle')).toHaveLength(1);
    expect(findPressablesByTestID(tree, 'home-collapse-week-support-toggle')).toHaveLength(1);
    expect(findPressablesByTestID(tree, 'home-collapse-draw-support-toggle')).toHaveLength(0);
  });

  it('keeps home focused on the main route instead of support clutter', async () => {
    progressFixture = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    const textBlob = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    }).join('\n');

    expect(textBlob).toContain('C# Interview');
    expect(textBlob).toContain('TodayPressureCard');
    expect(textBlob).not.toContain('Week summary');
    expect(textBlob).not.toContain('Milestones');
    expect(textBlob).not.toContain('QUIET ROUTE CARD');
    expect(textBlob).not.toContain('Reward draw');
  });

  it('shows first draw as a secondary hero link and routes into draw', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home', params: { firstDrawCoach: true } } as any} />);
    });
    await flush();

    act(() => {
      tree.root.findByProps({ testID: 'home-first-draw-link' }).props.onPress();
    });

    expect(navigateMock).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
  });

  it('labels the icon-only Settings entry for assistive tech', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    const settingsButtons = tree.root.findAll(
      (node) =>
        (node.type as any) === 'Pressable' && node.props?.accessibilityLabel === 'Settings',
    );

    expect(settingsButtons).toHaveLength(1);
    expect(settingsButtons[0].props.accessibilityRole).toBe('button');
  });

  it('does not render v6 fallback state copy when mockState override is provided', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home', params: { mockState: 'churned' } } as any} />);
    });
    await flush();

    const textBlob = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    }).join('\n');

    expect(textBlob).not.toContain('Fresh start is available');
    expect(findPressablesByTestID(tree, 'home-primary-cta')).toHaveLength(1);
  });

  it('keeps refresh failures on a retry CTA instead of routing to Library', async () => {
    progressFixture = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];
    let shouldRejectDeck = true;
    resolveDeckBySlugMock.mockImplementation(async () => {
      if (shouldRejectDeck) {
        throw new Error('deck read failed');
      }
      return resolvedDeckFixture;
    });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();
    await flush();

    const retryCta = findPressableByLabel(tree, 'Try again');
    expect(retryCta.props.testID).toBe('home-primary-cta');

    const callsBeforeRetry = resolveDeckBySlugMock.mock.calls.length;
    shouldRejectDeck = false;
    act(() => {
      retryCta.props.onPress();
    });
    await flush();
    await flush();

    expect(resolveDeckBySlugMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    expect(navigateMock).not.toHaveBeenCalledWith('Library');
    expect(findPressableByLabel(tree, 'Open C# Interview')).toBeTruthy();
  });

  it('uses cached premium while a server premium refresh fails', async () => {
    manifestDecksFixture = [
      { slug: 'csharp', title: 'Premium Deck', locale: 'en-US', version: '1', deckType: 2, totalCards: 10, availability: 'live' },
    ];
    resolvedDeckFixture = null;
    authFixture = {
      status: 'signed_in',
      accessToken: 'access-token',
      userSub: 'premium-user',
    };
    cachedPremiumFixture = true;
    fetchServerPremiumMock.mockRejectedValueOnce(new Error('network'));

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    act(() => {
      findPressablesByTestID(tree, 'home-collapse-decks-toggle')[0].props.onPress();
    });

    await act(async () => {
      findPressablesByTestID(tree, 'home-deck-row-csharp')[0].props.onPress();
      await Promise.resolve();
    });

    expect(fetchServerPremiumMock).toHaveBeenCalledWith('access-token');
    expect(navigateMock).not.toHaveBeenCalledWith('Paywall');
    expect(navigateMock).toHaveBeenCalledWith('Library');
  });
});
