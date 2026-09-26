import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let walletFixture = { availablePulls: 0, reservePulls: 0 };
let activeSlugFixture: string | null = 'csharp';
let deckSummariesFixture: any[] = [];
let updatesFixture: Record<string, any> = {};

const navigateMock = vi.fn();
const setActiveDeckSlugMock = vi.fn(async (_slug: string) => {});

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
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
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
  loadActiveDeckSlug: vi.fn(async () => activeSlugFixture),
  setActiveDeckSlug: vi.fn(async (slug: string) => setActiveDeckSlugMock(slug)),
}));

vi.mock('../../src/features/gacha/home/deckActionResolver', () => ({
  loadHomeDeckSummaries: vi.fn(async () => {
    const now = Date.now();
    const totalDue = deckSummariesFixture.reduce((sum, deck) => sum + Number(deck.dueToday ?? 0), 0);
    return {
      deckSummaries: deckSummariesFixture,
      updates: updatesFixture,
      allUpcoming30: Array.from({ length: 30 }, (_, i) => ({
        dateKey: new Date(now + i * 86_400_000).toISOString(),
        count: i === 0 ? totalDue : 0,
      })),
      asOfISO: new Date(now).toISOString(),
    };
  }),
  autoApplyFreeDeckUpdates: vi.fn(() => []),
  resolveDeckAction: vi.fn(async () => ({ kind: 'open', slug: 'csharp' })),
  executeDeckAction: vi.fn(async () => ({ activeSlug: 'csharp' })),
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

vi.mock('../../src/sync/progressSync', () => ({
  forceProgressSync: vi.fn(async () => {}),
}));

import { Alert } from 'react-native';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { loadHomeDeckSummaries } from '../../src/features/gacha/home/deckActionResolver';

// Mirrors the mocked module's default snapshot so per-test overrides of
// loadHomeDeckSummaries can be restored to the shared behaviour in beforeEach.
function makeHomeSummary() {
  const now = Date.now();
  const totalDue = deckSummariesFixture.reduce((sum, deck) => sum + Number(deck.dueToday ?? 0), 0);
  return {
    deckSummaries: deckSummariesFixture,
    updates: updatesFixture,
    allUpcoming30: Array.from({ length: 30 }, (_, i) => ({
      dateKey: new Date(now + i * 86_400_000).toISOString(),
      count: i === 0 ? totalDue : 0,
    })),
    asOfISO: new Date(now).toISOString(),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// The title of the featured hero pack (rendered as fallback text when the RN
// facade has no Image), which follows the selected deck.
function featuredTitle(tree: renderer.ReactTestRenderer): string {
  const pack = tree.root.findByProps({ testID: 'home-featured-pack' });
  return pack
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => String(node.props.children ?? ''))
    .join('');
}

const textBlob = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children ?? ''),
    )
    .join('\n');

describe('HomeScreen v9', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    walletFixture = { availablePulls: 2, reservePulls: 0 };
    activeSlugFixture = 'csharp';
    deckSummariesFixture = [
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
        dueToday: 1,
        plannedToday: 1,
        newToday: 1,
        masteredApprox: 4,
        percent: 0.4,
      },
      {
        slug: 'aws',
        title: 'AWS Core',
        locale: 'en-US',
        version: '1',
        deckType: 1,
        totalCards: 8,
        localCards: 8,
        studyCards: 8,
        canStudy: true,
        dueToday: 2,
        plannedToday: 2,
        newToday: 0,
        masteredApprox: 5,
        percent: 0.62,
      },
    ];
    updatesFixture = {};
    navigateMock.mockReset();
    setActiveDeckSlugMock.mockClear();
    // Restore the shared cache-first/revalidate stub so per-test overrides of
    // loadHomeDeckSummaries never leak into the next test.
    vi.mocked(loadHomeDeckSummaries).mockReset();
    vi.mocked(loadHomeDeckSummaries).mockImplementation(async () => makeHomeSummary() as any);
  });

  it('renders root shell with one primary CTA surface', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    expect(tree.root.findByProps({ testID: 'screen-home-root' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'screen-home-primary-cta' })).toBeTruthy();
    expect(
      tree.root.findAll(
        (node) =>
          node.props?.testID === 'home-primary-cta' && (node.type as any) === 'Pressable',
      ),
    ).toHaveLength(1);
    expect(tree.root.findByProps({ testID: 'home-pack-visual' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'home-draw-status-badge' })).toBeTruthy();
    const goal = tree.root.findByProps({ testID: 'home-goal-line' });
    expect(String(goal.props.children)).toContain('Full clear: 2 cards');
  });

  it('shows due-card study link and routes it directly to SessionCard', async () => {
    // The Home daily-study path bypasses the Challenge route-preview
    // interstitial and drops users straight into the first review card.
    // Saves a tap on the highest-volume daily action.
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const studyLink = tree.root.findByProps({ testID: 'home-study-due-link' });
    expect(studyLink).toBeTruthy();

    act(() => {
      studyLink.props.onPress();
    });

    expect(navigateMock).toHaveBeenCalledWith('SessionCard', expect.objectContaining({}));
    const lastCall = navigateMock.mock.calls.find((c) => c[0] === 'SessionCard');
    expect(lastCall?.[0]).toBe('SessionCard');
  });

  it('hides due-card study link when no deck has due work', async () => {
    deckSummariesFixture = deckSummariesFixture.map((deck) => ({
      ...deck,
      dueToday: 0,
      plannedToday: 0,
      newToday: 0,
    }));

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    expect(tree.root.findAllByProps({ testID: 'home-study-due-link' })).toHaveLength(0);
  });

  it('keeps settings button accessible and opens first draw coach link when enabled', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: navigateMock } as any}
          route={{ key: 'home', name: 'Home', params: { firstDrawCoach: true } } as any}
        />,
      );
    });
    await flush();

    const settings = tree.root.find(
      (node) => (node.type as any) === 'Pressable' && node.props?.accessibilityLabel === 'Settings',
    );
    expect(settings).toBeTruthy();

    const firstDrawLink = tree.root.findByProps({ testID: 'home-first-draw-link' });
    act(() => {
      firstDrawLink.props.onPress();
    });

    expect(navigateMock).toHaveBeenCalledWith('Draw', {
      slug: 'csharp',
      rewardPending: true,
    });
  });

  // Ready pulls no longer outrank due cards. The primary button is the app's
  // daily answer to "why are you here", and while there is study work left
  // that answer is study.
  it('routes primary CTA to study even when pulls are available', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const primary = tree.root.find(
      (node) =>
        node.props?.testID === 'home-primary-cta' && (node.type as any) === 'Pressable',
    );
    await act(async () => {
      primary.props.onPress();
      await Promise.resolve();
    });

    expect(navigateMock).toHaveBeenCalledWith('SessionCard', { slug: 'csharp' });
    expect(navigateMock).not.toHaveBeenCalledWith('Draw', expect.anything());
  });

  it('routes the hero pack to study, not Draw, when work is due and pulls are available', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const featuredPack = tree.root.find(
      (node) =>
        (node.type as any) === 'Pressable' && node.props?.testID === 'home-featured-pack',
    );
    expect(featuredPack.props.accessibilityLabel).toBe('Start today’s challenge');

    await act(async () => {
      featuredPack.props.onPress();
      await Promise.resolve();
    });

    expect(navigateMock).toHaveBeenCalledWith('SessionCard', { slug: 'csharp' });
    expect(navigateMock).not.toHaveBeenCalledWith('Draw', expect.anything());
  });

  it('routes the hero pack to Draw when the first-draw coach is on', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen
          navigation={{ navigate: navigateMock } as any}
          route={{ key: 'home', name: 'Home', params: { firstDrawCoach: true } } as any}
        />,
      );
    });
    await flush();

    const featuredPack = tree.root.find(
      (node) =>
        (node.type as any) === 'Pressable' && node.props?.testID === 'home-featured-pack',
    );
    expect(featuredPack.props.accessibilityLabel).toBe('Open reward draw');

    await act(async () => {
      featuredPack.props.onPress();
      await Promise.resolve();
    });

    expect(navigateMock).toHaveBeenCalledWith('Draw', {
      slug: 'csharp',
      rewardPending: true,
    });
  });

  it('lists only real packs under Your packs', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const tiles = tree.root.findByProps({ testID: 'home-pack-visual' }).findAll(
      (node) =>
        (node.type as any) === 'Pressable'
        && typeof node.props.accessibilityLabel === 'string'
        && node.props.accessibilityLabel.includes(' pack — '),
    );
    const copy = textBlob(tree);

    expect(tiles).toHaveLength(2);
    expect(copy).toContain('Your packs');
    expect(copy).not.toContain('Choose a pack');
    expect(tiles.every((tile) => !tile.props.accessibilityLabel.includes('Coming'))).toBe(true);
  });

  it('selects an installed pack in place without leaving Home', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const tiles = tree.root.findByProps({ testID: 'home-pack-visual' }).findAll(
      (node) =>
        (node.type as any) === 'Pressable'
        && typeof node.props.accessibilityLabel === 'string'
        && node.props.accessibilityLabel.includes(' pack — '),
    );
    const awsTile = tiles.find((tile) => tile.props.accessibilityLabel.startsWith('AWS Core pack'));
    expect(awsTile).toBeTruthy();

    await act(async () => {
      awsTile!.props.onPress();
      await Promise.resolve();
    });

    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('aws');
    expect(navigateMock).not.toHaveBeenCalledWith('Library');
  });

  it('paints Home from local decks before the remote manifest check returns', async () => {
    // Cache-first summaries resolve; the remote revalidation never does.
    vi.mocked(loadHomeDeckSummaries).mockImplementation((params: any) =>
      params?.remote === false
        ? (Promise.resolve(makeHomeSummary()) as any)
        : (new Promise(() => {}) as any),
    );

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    // Home is up on the cache-first pass alone — no waiting on the network.
    expect(tree.root.findByProps({ testID: 'screen-home-primary-cta' })).toBeTruthy();
    expect(textBlob(tree)).not.toContain('Loading home...');
  });

  it('loads local summaries first and remote summaries second', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const calls = vi.mocked(loadHomeDeckSummaries).mock.calls;
    expect(calls[0]?.[0]).toEqual({ premium: false, remote: false });
    expect(vi.mocked(loadHomeDeckSummaries)).toHaveBeenCalledWith({ premium: false, remote: true });
  });

  it('selecting a pack tile rebuilds the view without reloading deck summaries', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    expect(featuredTitle(tree)).toBe('C# Interview');
    const loadCallsBefore = vi.mocked(loadHomeDeckSummaries).mock.calls.length;
    setActiveDeckSlugMock.mockClear();

    const tiles = tree.root.findByProps({ testID: 'home-pack-visual' }).findAll(
      (node) =>
        (node.type as any) === 'Pressable'
        && typeof node.props.accessibilityLabel === 'string'
        && node.props.accessibilityLabel.includes(' pack — '),
    );
    const awsTile = tiles.find((tile) => tile.props.accessibilityLabel.startsWith('AWS Core pack'));
    expect(awsTile).toBeTruthy();

    await act(async () => {
      awsTile!.props.onPress();
      await Promise.resolve();
    });

    // A local rebuild: no deck-summary reload, active slug moved, featured deck
    // switched to AWS.
    expect(vi.mocked(loadHomeDeckSummaries).mock.calls.length).toBe(loadCallsBefore);
    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('aws');
    expect(featuredTitle(tree)).toBe('AWS Core');
  });

  it('renders the hero and pack shelf with zero decks', async () => {
    deckSummariesFixture = [];
    activeSlugFixture = null;
    (Alert.alert as any).mockClear();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const shelf = tree.root.findByProps({ testID: 'home-pack-visual' });
    const tiles = shelf.findAll(
      (node) =>
        (node.type as any) === 'Pressable'
        && typeof node.props.accessibilityLabel === 'string'
        && node.props.accessibilityLabel.includes(' pack — '),
    );
    const featuredPack = tree.root.find(
      (node) => (node.type as any) === 'Pressable' && node.props?.testID === 'home-featured-pack',
    );

    expect(shelf).toBeTruthy();
    expect(featuredPack).toBeTruthy();
    expect(tiles).toHaveLength(0);
    expect(featuredPack.props.accessibilityLabel).toBe('Connect to load packs');

    await act(async () => {
      featuredPack.props.onPress();
      await Promise.resolve();
    });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('renders a manifest coming deck as a disabled Soon tile', async () => {
    deckSummariesFixture.push({
      slug: 'aws-saa-c03',
      title: 'AWS SAA-C03',
      locale: 'en-US',
      version: '1',
      deckType: 1,
      availability: 'coming',
      totalCards: 120,
      localCards: 0,
      studyCards: 0,
      canStudy: false,
      dueToday: 0,
      plannedToday: 0,
      newToday: 0,
      masteredApprox: 0,
      percent: 0,
    });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const tiles = tree.root.findByProps({ testID: 'home-pack-visual' }).findAll(
      (node) =>
        (node.type as any) === 'Pressable'
        && typeof node.props.accessibilityLabel === 'string'
        && node.props.accessibilityLabel.includes(' pack — '),
    );
    const comingTile = tiles.find(
      (tile) => tile.props.accessibilityLabel === 'AWS SAA-C03 pack — Soon',
    );

    expect(tiles).toHaveLength(3);
    expect(comingTile).toBeTruthy();
    expect(comingTile!.props.disabled).toBe(true);
  });

  it('centers the draw status label under the CTA', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const badge = tree.root.find(
      (node) => node.props?.testID === 'home-draw-status-badge' && (node.type as any) === 'Text',
    );

    expect(badge.props.style).toEqual(
      expect.objectContaining({ textAlign: 'center', alignSelf: 'center' }),
    );
  });

  it('says Caught up in the header when the selected deck is clear and pulls are locked', async () => {
    deckSummariesFixture = deckSummariesFixture.map((deck) => ({
      ...deck,
      dueToday: 0,
      plannedToday: 0,
      newToday: 0,
    }));
    walletFixture = { availablePulls: 0, reservePulls: 0 };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const caughtUpNodes = tree.root.findAll(
      (node) => (node.type as any) === 'Text' && node.props.children === 'Caught up',
    );
    expect(caughtUpNodes).toHaveLength(1);
    expect(textBlob(tree)).not.toContain('All caught up for now');

    const badge = tree.root.find(
      (node) => node.props?.testID === 'home-draw-status-badge' && (node.type as any) === 'Text',
    );
    const badgeChildren = Array.isArray(badge.props.children)
      ? badge.props.children.join('')
      : String(badge.props.children ?? '');
    expect(badgeChildren).toBe('No cards due · a free pull returns tomorrow');

    walletFixture = { availablePulls: 1, reservePulls: 0 };
    let tree2!: renderer.ReactTestRenderer;
    await act(async () => {
      tree2 = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    expect(textBlob(tree2)).toContain('A reward draw is ready');
    expect(
      tree2.root.findAll((node) => (node.type as any) === 'Text' && node.props.children === 'Caught up'),
    ).toHaveLength(0);
  });

  it('celebrates a mastered deck only when every card reached the mastery stage', async () => {
    // The hero title 'Deck mastered 🎉' renders as visible Text; the per-deck
    // 'Mastered ✓' status only surfaces on the selector tile's accessibility
    // label (the tile shows a color dot, not a text badge), so it is read there.
    const masteredLabelCount = (tree: renderer.ReactTestRenderer) =>
      tree.root.findAll(
        (node) =>
          typeof node.props?.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.includes('Mastered ✓'),
      ).length;
    const clear = (extra: Record<string, unknown>) =>
      deckSummariesFixture.map((deck) =>
        deck.slug === 'csharp'
          ? { ...deck, dueToday: 0, plannedToday: 0, newToday: 0, totalCards: 10, masteredApprox: 10, ...extra }
          : { ...deck, dueToday: 0, plannedToday: 0, newToday: 0 },
      );

    deckSummariesFixture = clear({});
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();
    expect(textBlob(tree)).not.toContain('Deck mastered 🎉');
    expect(masteredLabelCount(tree)).toBe(0);

    deckSummariesFixture = clear({ masteredCount: 10 });
    let tree2!: renderer.ReactTestRenderer;
    await act(async () => {
      tree2 = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();
    expect(textBlob(tree2)).toContain('Deck mastered 🎉');
    expect(masteredLabelCount(tree2)).toBeGreaterThan(0);

    deckSummariesFixture = clear({ masteredCount: 10, dueToday: 1, plannedToday: 1 });
    let tree3!: renderer.ReactTestRenderer;
    await act(async () => {
      tree3 = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();
    expect(textBlob(tree3)).not.toContain('Deck mastered 🎉');
    expect(masteredLabelCount(tree3)).toBe(0);
  });

  it('hides the goal line when the selected deck has nothing due and nothing new', async () => {
    deckSummariesFixture = deckSummariesFixture.map((deck) => ({
      ...deck,
      dueToday: 0,
      plannedToday: 0,
      newToday: 0,
    }));

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    expect(tree.root.findAllByProps({ testID: 'home-goal-line' })).toHaveLength(0);
    expect(textBlob(tree)).not.toContain('Full clear: 0 cards');
  });

  it('caps the goal line at the route length the session will build', async () => {
    // due 4 + new 3 = 7 cards, but the planner runs at most 5 a session, and
    // the summary says "5 / 5 · full clear" -- Home has to name the same 5.
    deckSummariesFixture = deckSummariesFixture.map((deck) =>
      deck.slug === 'csharp' ? { ...deck, dueToday: 4, plannedToday: 4, newToday: 3 } : deck,
    );

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const goal = tree.root.findByProps({ testID: 'home-goal-line' });
    expect(String(goal.props.children)).toBe('Keep streak: 1 card · Full clear: 5 cards');
  });

  it('labels the tiles with the short deck title on two lines', async () => {
    deckSummariesFixture = [
      { ...deckSummariesFixture[0], slug: 'claude-ccdv-f', title: 'Claude Developer Foundations (CCDV-F)' },
      { ...deckSummariesFixture[1], slug: 'aws-saa-c03', title: 'AWS Associate Architect' },
    ];
    activeSlugFixture = 'claude-ccdv-f';

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const tiles = tree.root.findByProps({ testID: 'home-pack-visual' }).findAll(
      (node) =>
        (node.type as any) === 'Pressable'
        && typeof node.props.accessibilityLabel === 'string'
        && node.props.accessibilityLabel.includes(' pack — '),
    );
    const labels = tiles.map((tile) => tile.props.accessibilityLabel);
    expect(labels).toContain('Claude CCDV-F pack — 1 due');
    expect(labels).toContain('AWS SAA-C03 pack — 2 due');

    // The tile label under the thumbnail gets two lines (the thumbnail's own
    // fallback monogram stays at one).
    const titleNodes = tiles.flatMap((tile) =>
      tile.findAll(
        (node) =>
          (node.type as any) === 'Text'
          && node.props.numberOfLines === 2
          && (node.props.children === 'Claude CCDV-F' || node.props.children === 'AWS SAA-C03'),
      ),
    );
    expect(titleNodes.map((node) => node.props.children).sort()).toEqual(['AWS SAA-C03', 'Claude CCDV-F']);

    // The Today card keeps the full title: that is where there is room for it.
    expect(textBlob(tree)).toContain('Claude Developer Foundations (CCDV-F)');
  });

  it('shows the update chip and a one-line notice for a stale installed deck', async () => {
    // Installed build has 81 of the 115 cards the manifest now lists.
    deckSummariesFixture = deckSummariesFixture.map((deck) =>
      deck.slug === 'csharp'
        ? { ...deck, slug: 'csharp-basics', title: 'C# / .NET', totalCards: 115, localCards: 81, studyCards: 81 }
        : deck,
    );
    activeSlugFixture = 'csharp-basics';
    updatesFixture = {
      'csharp-basics': {
        slug: 'csharp-basics',
        installedVersion: '20260816',
        remoteVersion: '20260921',
        hasUpdate: true,
        remoteUrl: 'https://example.test/csharp-basics.json',
        remoteSha256: null,
      },
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    const chip = tree.root.find(
      (node) => (node.type as any) === 'View' && node.props?.testID === 'home-pack-update-chip-csharp-basics',
    );
    const chipText = chip.find((node) => (node.type as any) === 'Text');
    expect(chipText.props.children).toBe('Update · +34 cards');
    expect(chipText.props.numberOfLines).toBe(2);
    expect(tree.root.findAllByProps({ testID: 'home-pack-update-chip-aws' })).toHaveLength(0);

    const notice = tree.root.find(
      (node) => (node.type as any) === 'Text' && node.props?.testID === 'home-update-notice',
    );
    expect(notice.props.numberOfLines).toBe(1);
    expect(String(notice.props.children)).toBe('C# / .NET update ready · +34 cards — tap the pack to install.');
  });

  it('drops the notice when the update belongs to a deck that is not selected', async () => {
    updatesFixture = {
      aws: {
        slug: 'aws',
        installedVersion: '1',
        remoteVersion: '2',
        hasUpdate: true,
        remoteUrl: 'https://example.test/aws.json',
        remoteSha256: null,
      },
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      );
    });
    await flush();

    expect(tree.root.findAllByProps({ testID: 'home-pack-update-chip-aws' }).length).toBeGreaterThan(0);
    expect(
      tree.root.findAll((node) => (node.type as any) === 'Text' && node.props?.testID === 'home-update-notice'),
    ).toHaveLength(0);
  });
});
