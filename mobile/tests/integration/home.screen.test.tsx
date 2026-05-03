import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let progressFixture: any[] = [];
const setActiveDeckSlugMock = vi.fn(async (_slug?: string) => {});
const loadActiveDeckSlugMock = vi.fn(async () => 'csharp');
const navigateMock = vi.fn();

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
  listManifestDecks: vi.fn(async () => [
    { slug: 'csharp', title: 'C# Interview', locale: 'en-US', version: '1', deckType: 1, totalCards: 1, availability: 'live' },
  ]),
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: 1,
    Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1' }],
  })),
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
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(),
}));

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      status: 'signed_out',
      accessToken: '',
      init: vi.fn(async () => {}),
      userSub: null,
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
  fetchServerPremium: vi.fn(async () => false),
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

describe('HomeScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    progressFixture = [];
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
    progressFixture = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    act(() => {
      findPressableByLabel(tree, 'Start today’s challenge').props.onPress();
    });

    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
    expect(navigateMock).toHaveBeenCalledWith('Challenge', { slug: 'csharp' });
  });

  it('opens Library when there is no pressure today', async () => {
    progressFixture = [{ stableUid: '1', stage: 1, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 }];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    act(() => {
      findPressableByLabel(tree, 'Open library').props.onPress();
    });

    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
    expect(navigateMock).toHaveBeenCalledWith('Library');
  });

  it('keeps draw as a secondary entry without replacing the main CTA', async () => {
    progressFixture = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />);
    });
    await flush();

    act(() => {
      findPressableByLabel(tree, 'Draw support').props.onPress();
    });

    act(() => {
      findPressableByLabel(tree, 'Peek at reward draw').props.onPress();
    });

    expect(navigateMock).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
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

  it('shows first draw coach and routes into draw', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home', params: { firstDrawCoach: true } } as any} />);
    });
    await flush();

    act(() => {
      findPressableByLabel(tree, 'Draw support').props.onPress();
    });

    act(() => {
      findPressableByLabel(tree, 'Start first draw').props.onPress();
    });

    expect(navigateMock).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
  });

  it('renders churned state copy when mockState override is provided', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home', params: { mockState: 'churned' } } as any} />);
    });
    await flush();

    const textBlob = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    }).join('\n');

    expect(textBlob).toContain('Fresh start is available');
  });
});
