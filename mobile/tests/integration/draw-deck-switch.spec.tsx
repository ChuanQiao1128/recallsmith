import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// deckCache memoizes deck reads at module scope; clear it between tests so a
// changed resolveDeckBySlug mock is not shadowed by a prior test's entry (G30).
beforeEach(() => {
  invalidateDeckCache();
});

let walletFixture = { availablePulls: 12, reservePulls: 0 };
// When set, loadRewardWalletState returns whatever this resolves to instead of
// the fixture — lets a test hold the wallet read pending to prove the wallet
// and draw status load in parallel.
let walletLoader: (() => Promise<any>) | null = null;
let manifestFixture: any[] = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
let resolveDeckFixture: any = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
};
let updatesFixture: Record<string, any> = {};

const consumePullsFromStoredWalletMock = vi.fn(async (count: number) => {
  const spent = Math.min(count, walletFixture.availablePulls);
  const nextWallet = {
    availablePulls: Math.max(0, walletFixture.availablePulls - spent),
    reservePulls: walletFixture.reservePulls,
  };
  walletFixture = nextWallet;
  return { wallet: nextWallet, spent, promotedFromReserve: 0 };
});

const commitDrawMock = vi.fn(async (_slug: string, drawCount: 1 | 10, _options?: any) => ({
  cards: Array.from({ length: drawCount }, (_, index) => ({
    stableUid: `card-${index + 1}`,
    question: `Q${index + 1}`,
    difficulty: 1,
    rarity: 'COM' as const,
  })),
  poolExhausted: false,
  pityFiredFor: null,
  highlightedRarity: null,
  ownedAfter: drawCount,
  totalCards: 30,
  pityBefore: 0,
  pityAfter: 1,
}));

// Records that the screen read draw state; a test asserts it happened before
// the (held) wallet read resolved, which only holds if the two run in parallel.
const loadDrawStateMock = vi.fn(async () => ({ owned: [], pity: null }));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
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

// deckCache reads the user scope through a guarded dynamic import of
// progressScope; mock it so that import resolves to a fixed scope instead of
// dragging in the real authStore -> react-native chain the runner cannot parse.
vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => manifestFixture),
  resolveDeckBySlug: vi.fn(async (slug: string) => {
    if (typeof resolveDeckFixture === 'function') return resolveDeckFixture(slug);
    return resolveDeckFixture;
  }),
  checkManifestForUpdates: vi.fn(async () => updatesFixture),
  installDeckFromUrl: vi.fn(async () => false),
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(async () => (walletLoader ? walletLoader() : walletFixture)),
  consumePullsFromStoredWallet: vi.fn(async (count: number) => consumePullsFromStoredWalletMock(count)),
  saveRewardWalletState: vi.fn(async () => {}),
  refundPullsToStoredWallet: vi.fn(async () => walletFixture),
}));

vi.mock('../../src/features/gacha/draw/drawCommit', () => ({
  commitDraw: vi.fn(async (slug: string, drawCount: 1 | 10, options?: any) => commitDrawMock(slug, drawCount, options)),
}));

// The screen reads draw state through loadDrawStatus -> loadDrawState. Mocked
// per the brief so the parallel-load assertion has a call to watch.
vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  loadDrawState: vi.fn(async () => loadDrawStateMock()),
}));

const scheduleProgressSyncMock = vi.fn();
vi.mock('../../src/sync/progressSync', () => ({
  scheduleProgressSync: (arg?: any) => scheduleProgressSyncMock(arg),
}));

import { DrawScreen } from '../../src/screens/DrawScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function armPackSwipe(tree: renderer.ReactTestRenderer) {
  const swipeZone = tree.root.findByProps({ testID: 'draw-card-stack-stage' });
  act(() => {
    swipeZone.props.onResponderGrant({ nativeEvent: { pageX: 10 } });
    swipeZone.props.onResponderRelease({ nativeEvent: { pageX: 120 } });
  });
}

function collectText(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

function has(tree: renderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

describe('DrawScreen deck switch (G38)', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    walletFixture = { availablePulls: 12, reservePulls: 0 };
    walletLoader = null;
    manifestFixture = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
    resolveDeckFixture = {
      Slug: 'csharp',
      Title: 'C# Interview',
      Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
    };
    updatesFixture = {};
    consumePullsFromStoredWalletMock.mockClear();
    commitDrawMock.mockClear();
    loadDrawStateMock.mockClear();
  });

  it('keeps the draw header mounted while a neighbour deck loads', async () => {
    manifestFixture = [
      { slug: 'csharp', availability: 'live', title: 'C# Interview' },
      { slug: 'aws', availability: 'live', title: 'AWS Interview' },
    ];
    // The AWS deck resolves only when the test lets it, so the switch is
    // observably in flight.
    let resolveAws: ((deck: any) => void) | undefined;
    resolveDeckFixture = (slug: string) => {
      if (slug === 'aws') {
        return new Promise((resolve) => {
          resolveAws = resolve;
        });
      }
      return {
        Slug: 'csharp',
        Title: 'C# Interview',
        Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
      };
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    // Switch to the neighbour; its deck read is still pending.
    await act(async () => {
      tree.root.findByProps({ testID: 'draw-neighbor-left' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The chamber stays: header present, only the pack area spins, and the
    // full-screen "Preparing draw..." never appears.
    expect(has(tree, 'draw-header')).toBe(true);
    expect(has(tree, 'draw-pack-inline-loader')).toBe(true);
    expect(collectText(tree)).not.toContain('Preparing draw...');

    // The AWS deck arrives; the switch completes.
    await act(async () => {
      resolveAws?.({
        Slug: 'aws',
        Title: 'AWS Interview',
        Cards: [{ StableUid: '2', OrderInDeck: 1, Difficulty: 1, Question: 'Q2' }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(collectText(tree)).toContain('AWS Interview');
    expect(has(tree, 'draw-pack-inline-loader')).toBe(false);
  });

  it('loads the wallet and draw status in parallel', async () => {
    // Hold the wallet read open. If the loads were serial, loadDrawState would
    // not run until the wallet resolved; in parallel it runs immediately.
    let resolveWallet: ((wallet: any) => void) | undefined;
    walletLoader = () =>
      new Promise((resolve) => {
        resolveWallet = resolve;
      });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    // Draw state was read even though the wallet read is still pending.
    expect(loadDrawStateMock).toHaveBeenCalled();

    // Let the wallet resolve so nothing is left dangling.
    await act(async () => {
      resolveWallet?.({ availablePulls: 12, reservePulls: 0 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(collectText(tree)).toContain('Open 10');
  });

  it('passes the already-loaded deck to commitDraw', async () => {
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();
    armPackSwipe(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitDrawMock).toHaveBeenCalledWith(
      'csharp',
      1,
      expect.objectContaining({ deck: expect.objectContaining({ Slug: 'csharp' }) }),
    );
  });
});
