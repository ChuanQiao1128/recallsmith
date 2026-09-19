import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeDeck(slug: string, title: string, cards: Array<{ uid: string; order: number; difficulty: number; question: string }>) {
  return {
    Slug: slug,
    Title: title,
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    Cards: cards.map((card) => ({
      StableUid: card.uid,
      OrderInDeck: card.order,
      Difficulty: card.difficulty,
      Question: card.question,
    })),
  } as any;
}

let mockActiveDeckSlug = 'csharp';
let mockManifestDecks: Array<{ slug: string; title: string; availability: string }> = [];

// Fixtures driving the four deckRepository exports. Reset in beforeEach.
let resolveDeckFixture: (slug: string) => any = () => null;
let updatesFixture: Record<string, any> = {};
let installDeckOkFixture = true;

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    FlatList: ({ data = [], renderItem, ListHeaderComponent, ListEmptyComponent, ...props }: any) =>
      React.createElement(
        'FlatList',
        props,
        ListHeaderComponent,
        (data as any[]).length === 0
          ? typeof ListEmptyComponent === 'function'
            ? ListEmptyComponent()
            : ListEmptyComponent
          : null,
        ...(data as any[]).map((item, index) => renderItem({ item, index })),
      ),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    useWindowDimensions: () => ({ width: 390, height: 844 }),
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
  loadActiveDeckSlug: vi.fn(async () => mockActiveDeckSlug),
  setActiveDeckSlug: vi.fn(async (slug: string) => {
    mockActiveDeckSlug = slug;
  }),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => mockManifestDecks),
  resolveDeckBySlug: vi.fn(async (slug: string) => resolveDeckFixture(slug)),
  checkManifestForUpdates: vi.fn(async () => updatesFixture),
  installDeckFromUrl: vi.fn(async () => installDeckOkFixture),
}));

const asyncStorageMap = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageMap.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageMap.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      asyncStorageMap.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...asyncStorageMap.keys()]),
  },
}));

vi.mock('../../src/review/storage', () => ({
  getUserScopedKey: vi.fn(async (baseKey: string) => baseKey),
  loadDeckProgress: vi.fn(async () => [
    { stableUid: '1', stage: 0, nextReviewAt: 0 },
    { stableUid: '2', stage: 2, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 },
    { stableUid: '3', stage: 4, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 },
  ]),
}));

import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { installDeckFromUrl } from '../../src/content/deckRepository';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';

const installDeckFromUrlMock = vi.mocked(installDeckFromUrl);

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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

describe('LibraryScreen install path (I2)', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    asyncStorageMap.clear();
    invalidateDrawStateCache();
    mockActiveDeckSlug = 'csharp';
    mockManifestDecks = [{ slug: 'csharp', title: 'C# Interview', availability: 'live' }];
    resolveDeckFixture = () => null;
    updatesFixture = {};
    installDeckOkFixture = true;
    vi.clearAllMocks();
  });

  it('installs an uninstalled installable deck instead of throwing', async () => {
    const installedDeck = makeDeck('csharp', 'C# Interview', [
      { uid: '1', order: 1, difficulty: 1, question: 'Q1' },
      { uid: '2', order: 2, difficulty: 2, question: 'Q2' },
      { uid: '3', order: 3, difficulty: 3, question: 'Q3' },
    ]);
    let resolveCalls = 0;
    resolveDeckFixture = () => {
      resolveCalls += 1;
      return resolveCalls === 1 ? null : installedDeck;
    };
    updatesFixture = {
      csharp: { remoteUrl: 'https://cdn.example.com/content/csharp.json', remoteVersion: 'v1', remoteSha256: null },
    };
    installDeckOkFixture = true;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);
    expect(installDeckFromUrlMock).toHaveBeenCalledWith(
      'csharp',
      'https://cdn.example.com/content/csharp.json',
      'v1',
      null,
    );
    expect(tree.root.findByProps({ testID: 'library-card-grid' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'library-unavailable-state' })).toHaveLength(0);
    const text = collectText(tree);
    expect(text).not.toContain('Library unavailable');
    expect(text).not.toContain('Deck is not installed yet');
  });

  it('shows the unavailable state with a Go to Home CTA when the deck cannot be installed', async () => {
    resolveDeckFixture = () => null;
    updatesFixture = {};

    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    expect(installDeckFromUrlMock).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'library-unavailable-state' })).toBeTruthy();
    const text = collectText(tree);
    expect(text).toContain('This deck is not available on this device yet.');
    expect(text).toContain('Go to Home');
    expect(tree.root.findByProps({ testID: 'library-unavailable-retry' })).toBeTruthy();

    act(() => {
      tree.root.findByProps({ testID: 'library-unavailable-home-cta' }).props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Home');
  });

  it('shows the unavailable state when the install fails', async () => {
    resolveDeckFixture = () => null;
    updatesFixture = {
      csharp: { remoteUrl: 'https://cdn.example.com/content/csharp.json', remoteVersion: 'v1', remoteSha256: null },
    };
    installDeckOkFixture = false;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);
    expect(tree.root.findByProps({ testID: 'library-unavailable-state' })).toBeTruthy();
    const text = collectText(tree);
    expect(text).toContain('Install failed. Check your connection and retry.');
    expect(text).not.toContain('Deck is not installed yet');
  });
});
