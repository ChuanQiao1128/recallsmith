import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let walletFixture = { availablePulls: 0, reservePulls: 0 };
let activeSlugFixture: string | null = 'csharp';
let deckSummariesFixture: any[] = [];

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
      updates: {},
      allUpcoming30: Array.from({ length: 30 }, (_, i) => ({
        dateKey: new Date(now + i * 86_400_000).toISOString(),
        count: i === 0 ? totalDue : 0,
      })),
      asOfISO: new Date(now).toISOString(),
    };
  }),
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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
    navigateMock.mockReset();
    setActiveDeckSlugMock.mockClear();
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
});
