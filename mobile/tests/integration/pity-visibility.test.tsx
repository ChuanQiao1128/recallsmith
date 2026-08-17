import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The pity counter was persisted, capped, simulated and unit tested, and no
// screen read it: buildPityProgressLabelV9 had zero callers and pityTriggered
// rode the route params unrendered. A guarantee the player cannot see is a
// guarantee they did not get, so these are visibility tests, not logic tests.

let drawStateFixture: { owned: string[]; pity: { draws: number; threshold: number } | null } = {
  owned: [],
  pity: { draws: 7, threshold: 10 },
};

const walletFixture = { availablePulls: 12, reservePulls: 0 };

vi.mock('react-native', () => {
  const React = require('react');
  return {
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Modal: ({ children, visible }: any) => (visible ? React.createElement('Modal', null, children) : null),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
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

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }]),
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Cards: [
      // Difficulty 3 is LEG, so the guarantee still has something to hand over.
      { StableUid: 'leg-1', OrderInDeck: 1, Difficulty: 3, Question: 'Q1' },
      { StableUid: 'com-1', OrderInDeck: 2, Difficulty: 1, Question: 'Q2' },
    ],
  })),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => false),
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(async () => walletFixture),
  consumePullsFromStoredWallet: vi.fn(async () => ({ wallet: walletFixture, spent: 0, promotedFromReserve: 0 })),
  saveRewardWalletState: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/draw/drawCommit', () => ({
  commitDraw: vi.fn(async () => null),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  loadDrawState: vi.fn(async () => drawStateFixture),
  saveDrawState: vi.fn(async () => {}),
  appendDrawHistory: vi.fn(async () => {}),
}));

import { DrawScreen } from '../../src/screens/DrawScreen';
import { DrawResultScreen } from '../../src/screens/DrawResultScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderDrawScreen(): Promise<renderer.ReactTestRenderer> {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <DrawScreen
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any}
      />,
    );
  });
  await flush();
  return tree;
}

describe('pity guarantee visibility', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    drawStateFixture = { owned: [], pity: { draws: 7, threshold: 10 } };
  });

  it('renders the guarantee countdown on the draw screen', async () => {
    const tree = await renderDrawScreen();

    const label = tree.root.findByProps({ testID: 'draw-pity-progress' });
    expect(label.props.children).toBe('3 cards until guaranteed reveal');
  });

  it('promises the next card once the pity threshold is reached', async () => {
    drawStateFixture = { owned: [], pity: { draws: 10, threshold: 10 } };

    const tree = await renderDrawScreen();

    const label = tree.root.findByProps({ testID: 'draw-pity-progress' });
    expect(label.props.children).toBe('Next card guarantees a missing rare or better');
  });

  it('stays silent when no legendary is left to guarantee', async () => {
    drawStateFixture = { owned: ['leg-1'], pity: { draws: 7, threshold: 10 } };

    const tree = await renderDrawScreen();

    expect(tree.root.findAll((node) => node.props?.testID === 'draw-pity-progress')).toHaveLength(0);
  });

  it('marks the result screen when the guarantee actually fired', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={
            {
              key: 'draw-result',
              name: 'DrawResult',
              params: {
                slug: 'csharp',
                deckTitle: 'C# Interview',
                ownedAfter: 4,
                totalCards: 20,
                drawResult: {
                  poolId: 'csharp',
                  pityBefore: 10,
                  pityAfter: 0,
                  pityTriggered: true,
                  highlightedRarity: 'RAR' as const,
                  cards: [{ stableUid: '1', question: 'Q1', difficulty: 2, rarity: 'RAR' as const }],
                },
              },
            } as any
          }
        />,
      );
    });
    await flush();

    const badge = tree.root.findByProps({ testID: 'draw-result-guarantee-badge' });
    expect(String(badge.props.children)).toContain('GUARANTEE');
  });

  it('leaves the result screen unmarked when the guarantee did not fire', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={
            {
              key: 'draw-result',
              name: 'DrawResult',
              params: {
                slug: 'csharp',
                deckTitle: 'C# Interview',
                ownedAfter: 4,
                totalCards: 20,
                drawResult: {
                  poolId: 'csharp',
                  pityBefore: 0,
                  pityAfter: 1,
                  pityTriggered: false,
                  highlightedRarity: null,
                  cards: [{ stableUid: '1', question: 'Q1', difficulty: 1, rarity: 'COM' as const }],
                },
              },
            } as any
          }
        />,
      );
    });
    await flush();

    expect(
      tree.root.findAll((node) => node.props?.testID === 'draw-result-guarantee-badge'),
    ).toHaveLength(0);
  });
});
