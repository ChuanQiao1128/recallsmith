import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let viewportWidth = 390;
let viewportHeight = 844;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    useWindowDimensions: () => ({ width: viewportWidth, height: viewportHeight, scale: 3, fontScale: 1 }),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
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
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [{ slug: 'csharp' }]),
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: 3,
    Cards: [
      { StableUid: '1', OrderInDeck: 1, Question: 'Q1', Difficulty: 1 },
      { StableUid: '2', OrderInDeck: 2, Question: 'Q2', Difficulty: 2 },
      { StableUid: '3', OrderInDeck: 3, Question: 'Q3', Difficulty: 3 },
    ],
  })),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => [
    { stableUid: '1', stage: 0, nextReviewAt: 0 },
    { stableUid: '2', stage: 2, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 1000 },
    { stableUid: '3', stage: 4, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 2000 },
  ]),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => 'all'),
}));

import { DrawScreen } from '../../src/screens/DrawScreen';
import * as deckRepository from '../../src/content/deckRepository';
import * as rewardWallet from '../../src/features/gacha/rewards/rewardWallet';

function findPressableByTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.props.testID === testID);
}

function findTextNodeContaining(tree: renderer.ReactTestRenderer, needle: string) {
  return tree.root.find((node) => {
    if ((node.type as any) !== 'Text') return false;
    const children = node.props.children;
    const text = Array.isArray(children) ? children.join('') : String(children ?? '');
    return text.includes(needle);
  });
}

function collectText(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
    const c = node.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  }).join('\n');
}

function flattenStyle(style: any): Record<string, any> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  return style ?? {};
}

describe('DrawScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.clear();
    store.set('recallsmith:reward-wallet:v1', JSON.stringify({ availablePulls: 2, reservePulls: 1 }));
    viewportWidth = 390;
    viewportHeight = 844;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('consumes one pull and enters ceremony when draw opens', async () => {
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'screen-draw-root' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'screen-draw-primary-cta' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' })).toBeTruthy();

    await act(async () => {
      findPressableByTestId(tree, 'screen-draw-primary-cta').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    const walletRaw = store.get('recallsmith:reward-wallet:v1');
    expect(walletRaw).toBeTruthy();
    expect(JSON.parse(walletRaw!)).toEqual({ availablePulls: 2, reservePulls: 0 });
    expect(navigation.navigate).toHaveBeenCalledWith('DrawCeremony', expect.objectContaining({ slug: 'csharp' }));
  });

  it('supports opening a single pull from the draw page', async () => {
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findPressableByTestId(tree, 'screen-draw-secondary-cta').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    const walletRaw = store.get('recallsmith:reward-wallet:v1');
    expect(walletRaw).toBeTruthy();
    expect(JSON.parse(walletRaw!)).toEqual({ availablePulls: 2, reservePulls: 0 });
    expect(navigation.navigate).toHaveBeenCalledWith(
      'DrawCeremony',
      expect.objectContaining({
        slug: 'csharp',
        drawResult: expect.objectContaining({
          cards: expect.any(Array),
        }),
      }),
    );

    const drawResult = navigation.navigate.mock.calls.at(-1)?.[1]?.drawResult;
    expect(drawResult.cards).toHaveLength(1);
  });

  it('routes locked active-pool users back home instead of opening Deck', async () => {
    store.set('recallsmith:reward-wallet:v1', JSON.stringify({ availablePulls: 0, reservePulls: 0 }));
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(collectText(tree)).toContain('Back to Home');
    expect(collectText(tree)).toContain('Preview 1 pull (free)');

    act(() => {
      findPressableByTestId(tree, 'screen-draw-primary-cta').props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });

  it('still lets the user preview a single pull when wallet is empty', async () => {
    store.set('recallsmith:reward-wallet:v1', JSON.stringify({ availablePulls: 0, reservePulls: 0 }));
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(collectText(tree)).toContain('Preview 1 pull (free)');

    await act(async () => {
      findPressableByTestId(tree, 'screen-draw-secondary-cta').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.parse(store.get('recallsmith:reward-wallet:v1')!)).toEqual({ availablePulls: 0, reservePulls: 0 });
    expect(navigation.navigate).toHaveBeenCalledWith(
      'DrawCeremony',
      expect.objectContaining({
        slug: 'csharp',
        drawResult: expect.objectContaining({
          cards: expect.any(Array),
        }),
      }),
    );
    const drawResult = navigation.navigate.mock.calls.at(-1)?.[1]?.drawResult;
    expect(drawResult.cards).toHaveLength(1);
  });

  it('renders the resolved active deck title for non-default pools', async () => {
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;
    const resolveSpy = vi.spyOn(deckRepository, 'resolveDeckBySlug');
    resolveSpy.mockResolvedValueOnce({
      Slug: 'python',
      Title: 'Python Advanced',
      Locale: 'en-US',
      Version: '1',
      DeckType: 1,
      TotalCards: 1,
      Cards: [{ StableUid: 'py-1', OrderInDeck: 1, Question: 'Q', Difficulty: 1 }],
    } as any);

    try {
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'python' } } as any} />);
        await Promise.resolve();
        await Promise.resolve();
      });

      const textBlob = collectText(tree);
      expect(textBlob).toContain('Current pool · Python Advanced');
      expect(textBlob).not.toContain('Current pool · C# Interview');
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it('renders a productized draw briefing instead of prototype-only labels', async () => {
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textBlob = collectText(tree);

    expect(textBlob).toContain('Reward draw');
    expect(textBlob).toContain('Pull briefing');
    expect(textBlob).toContain('One reward pull opens a 10-card reveal.');
    expect(textBlob).toContain('Current pool');
    expect(textBlob).toContain('Open 10-card pull');
    expect(textBlob).not.toContain('Drop odds');
    expect(textBlob).not.toContain('until guaranteed');
    expect(textBlob).not.toContain('COM 70%');
    expect(textBlob).not.toContain('COSMIC ARCHIVE');
    expect(textBlob).not.toContain('DROP TABLE');

    expect(findTextNodeContaining(tree, 'Use reward pulls after the study route').props.numberOfLines).toBe(1);
    expect(findTextNodeContaining(tree, 'Open 10-card pull').props.numberOfLines).toBe(1);
  });

  it('keeps the decorative card stack compact on a 360pt viewport', async () => {
    viewportWidth = 360;
    viewportHeight = 640;
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const stackStage = tree.root.findByProps({ testID: 'draw-card-stack-stage' });
    expect(flattenStyle(stackStage.props.style).height).toBeLessThanOrEqual(192);
    expect(findTextNodeContaining(tree, 'Open 10-card pull').props.numberOfLines).toBe(1);
  });

  it('renders an error state with retry action when draw dependencies fail', async () => {
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;
    const walletSpy = vi.spyOn(rewardWallet, 'loadRewardWalletState');
    walletSpy.mockRejectedValueOnce(new Error('wallet failed'));
    walletSpy.mockResolvedValue({ availablePulls: 2, reservePulls: 1 });

    try {
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(collectText(tree)).toContain('Draw unavailable right now');
      expect(tree.root.findByProps({ testID: 'screen-draw-primary-cta' })).toBeTruthy();
      expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' })).toBeTruthy();

      await act(async () => {
        findPressableByTestId(tree, 'screen-draw-primary-cta').props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(collectText(tree)).toContain('Open 10-card pull');
      expect(walletSpy).toHaveBeenCalledTimes(2);
    } finally {
      walletSpy.mockRestore();
    }
  });

  it('routes to library instead of a no-op draw action when there is no active pool', async () => {
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;
    const resolveSpy = vi.spyOn(deckRepository, 'resolveDeckBySlug');
    resolveSpy.mockResolvedValueOnce(null as any);

    try {
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(collectText(tree)).toContain('No active draw pool yet');

      act(() => {
        findPressableByTestId(tree, 'screen-draw-primary-cta').props.onPress();
      });

      expect(navigation.navigate).toHaveBeenCalledWith('Library');
    } finally {
      resolveSpy.mockRestore();
    }
  });
});
