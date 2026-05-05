import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
let mockDecksBySlug: Record<string, any> = {};

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
  resolveDeckBySlug: vi.fn(async (slug: string) => mockDecksBySlug[slug] ?? null),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async (deck: any) => {
    if (deck?.Slug === 'aws') {
      return [
        { stableUid: 'a1', stage: 2, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 },
      ];
    }
    return [
      { stableUid: '1', stage: 0, nextReviewAt: 0 },
      { stableUid: '2', stage: 2, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 },
      { stableUid: '3', stage: 4, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 },
    ];
  }),
}));

import { LibraryScreen } from '../../src/screens/LibraryScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LibraryScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockActiveDeckSlug = 'csharp';
    mockManifestDecks = [{ slug: 'csharp', title: 'C# Interview', availability: 'live' }];
    mockDecksBySlug = {
      csharp: makeDeck('csharp', 'C# Interview', [
        { uid: '1', order: 1, difficulty: 1, question: 'Q1' },
        { uid: '2', order: 2, difficulty: 2, question: 'Q2' },
        { uid: '3', order: 3, difficulty: 3, question: 'Q3' },
      ]),
      aws: makeDeck('aws', 'AWS Core', [
        { uid: 'a1', order: 1, difficulty: 2, question: 'EC2 question' },
        { uid: 'a2', order: 2, difficulty: 2, question: 'IAM question' },
      ]),
    };
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('renders All/Owned/Missing filters with collection status chips', async () => {
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    expect(tree.root.find((node) => node.props?.testID === 'screen-library-root')).toBeTruthy();
    expect(tree.root.find((node) => node.props?.testID === 'screen-library-primary-surface')).toBeTruthy();
    expect(tree.root.find((node) => node.props?.testID === 'library-card-grid')).toBeTruthy();

    const blob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const c = node.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      })
      .join('\n');

    expect(blob).toContain('Library');
    expect(blob).toContain('All');
    expect(blob).toContain('Owned');
    expect(blob).toContain('Missing');
    expect(blob).toContain('2/3');
    expect(blob).not.toContain('You have room to learn fresh cards today.');
    expect(blob).not.toContain('Clear today');
    expect(tree.root.find((node) => node.props?.testID === 'library-filter-all')).toBeTruthy();
    expect(tree.root.find((node) => node.props?.testID === 'library-filter-owned')).toBeTruthy();
    expect(tree.root.find((node) => node.props?.testID === 'library-filter-missing')).toBeTruthy();

    const badgeBackgrounds = ['1', '2', '3'].map((stableUid) => {
      const badge = tree.root.find((node) => node.props?.testID === `library-card-status-${stableUid}`);
      return badge.props.style[1].backgroundColor;
    });
    expect(new Set(badgeBackgrounds).size).toBe(3);
  });

  it('opens card detail from library card grid', async () => {
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const q1 = tree.root.find((node) => node.props?.testID === 'library-card-1');

    act(() => {
      q1.props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('CardDetail', { cardId: '1' });
  });

  it('renders deck switcher for multiple decks and refreshes the grid for selected deck', async () => {
    const navigate = vi.fn();
    mockManifestDecks = [
      { slug: 'csharp', title: 'C# Interview', availability: 'live' },
      { slug: 'aws', title: 'AWS Core', availability: 'live' },
    ];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    expect(tree.root.find((node) => node.props?.testID === 'library-deck-switcher')).toBeTruthy();
    expect(tree.root.find((node) => node.props?.testID === 'library-deck-csharp')).toBeTruthy();
    const awsDeckChip = tree.root.find((node) => node.props?.testID === 'library-deck-aws');
    expect(tree.root.find((node) => node.props?.testID === 'library-card-1')).toBeTruthy();

    act(() => {
      awsDeckChip.props.onPress();
    });
    await flush();

    expect(tree.root.find((node) => node.props?.testID === 'library-card-a1')).toBeTruthy();
    expect(tree.root.findAll((node) => node.props?.testID === 'library-card-1')).toHaveLength(0);
  });

  it('applies focusSlug route params on initial load', async () => {
    const navigate = vi.fn();
    mockManifestDecks = [
      { slug: 'csharp', title: 'C# Interview', availability: 'live' },
      { slug: 'aws', title: 'AWS Core', availability: 'live' },
    ];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate } as any} route={{ key: 'library', name: 'Library', params: { focusSlug: 'aws' } } as any} />,
      );
    });
    await flush();

    expect(tree.root.find((node) => node.props?.testID === 'library-card-a1')).toBeTruthy();
    expect(tree.root.findAll((node) => node.props?.testID === 'library-card-1')).toHaveLength(0);
  });

  it('renders empty-state recovery CTA when no cards are available', async () => {
    const navigate = vi.fn();
    mockDecksBySlug.csharp = makeDeck('csharp', 'C# Interview', []);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const blob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const c = node.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      })
      .join('\n');

    expect(blob).toContain('No cards in this library yet');
    expect(blob).toContain('Install a deck');
    expect(blob).not.toContain('Open deck gate');
    expect(tree.root.find((node) => node.props?.testID === 'library-empty-state')).toBeTruthy();

    const emptyCta = tree.root.find((node) => node.props?.testID === 'library-empty-cta');
    act(() => {
      emptyCta.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Deck');
  });
});
