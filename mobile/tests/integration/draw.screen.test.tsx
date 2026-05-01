import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

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

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function collectText(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
    const c = node.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  }).join('\n');
}

describe('DrawScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.clear();
    store.set('recallsmith:reward-wallet:v1', JSON.stringify({ availablePulls: 2, reservePulls: 1 }));
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

    await act(async () => {
      findPressableByText(tree, 'Open 10 pull').props.onPress();
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
      findPressableByText(tree, 'Open 1 pull').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    const walletRaw = store.get('recallsmith:reward-wallet:v1');
    expect(walletRaw).toBeTruthy();
    expect(JSON.parse(walletRaw!)).toEqual({ availablePulls: 2, reservePulls: 0 });
    expect(navigation.navigate).toHaveBeenCalledWith('DrawCeremony', expect.objectContaining({ slug: 'csharp' }));
  });

  it('shows a library fallback CTA when draw is locked', async () => {
    store.set('recallsmith:reward-wallet:v1', JSON.stringify({ availablePulls: 0, reservePulls: 0 }));
    const navigation = { goBack: vi.fn(), navigate: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawScreen navigation={navigation} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      findPressableByText(tree, 'View library').props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith('Deck', { slug: 'csharp' });
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
    expect(textBlob).toContain('Drop odds');
    expect(textBlob).toContain('Current pool');
    expect(textBlob).toContain('Open 10 pull');
    expect(textBlob).not.toContain('COSMIC ARCHIVE');
    expect(textBlob).not.toContain('DROP TABLE');
  });
});
