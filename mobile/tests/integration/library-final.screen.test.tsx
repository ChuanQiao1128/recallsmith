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
      return [{ stableUid: 'a1', stage: 2, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 }];
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

function collectText(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

describe('LibraryScreen v9', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('renders collection bar and primary grid shell ids', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    expect(tree.root.findByProps({ testID: 'screen-library-root' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'screen-library-primary-surface' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-card-grid' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-collection-bar' })).toBeTruthy();
    expect(collectText(tree)).toContain('2/3');
    const statusOne = tree.root.findByProps({ testID: 'library-card-status-1' });
    const statusOneText = statusOne.find((child: any) => (child.type as any) === 'Text').props.children;
    expect(statusOneText).toBe('Missing');
  });

  it('shows only All/New/Learning/Mastered filters in filter sheet', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    act(() => {
      tree.root.findByProps({ testID: 'library-filter-summary' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'library-filter-sheet' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-sheet-filter-all' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-sheet-filter-new' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-sheet-filter-learning' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-sheet-filter-mastered' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'library-sheet-filter-owned' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'library-sheet-filter-missing' })).toHaveLength(0);
  });

  it('keeps collection bar invariant across filter toggles', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const readCollectionBar = () => {
      const bar = tree.root.findByProps({ testID: 'library-collection-bar' });
      const value = bar.props.children;
      return Array.isArray(value) ? value.join('') : String(value ?? '');
    };

    const baseline = readCollectionBar();
    expect(baseline).toBe('2/3');

    for (const filterKey of ['all', 'new', 'learning', 'mastered'] as const) {
      act(() => {
        tree.root.findByProps({ testID: 'library-filter-summary' }).props.onPress();
      });
      act(() => {
        tree.root.findByProps({ testID: `library-sheet-filter-${filterKey}` }).props.onPress();
      });
      expect(readCollectionBar()).toBe(baseline);
    }
  });

  it('applies focusSlug route param on initial load', async () => {
    mockManifestDecks = [
      { slug: 'csharp', title: 'C# Interview', availability: 'live' },
      { slug: 'aws', title: 'AWS Core', availability: 'live' },
    ];

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'library', name: 'Library', params: { focusSlug: 'aws' } } as any}
        />,
      );
    });
    await flush();

    expect(tree.root.findByProps({ testID: 'library-card-a1' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'library-card-1' })).toHaveLength(0);
  });

  it('highlights first new card when entering with scrollToNew flag', async () => {
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <LibraryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'library', name: 'Library', params: { scrollToNew: true } } as any}
        />,
      );
    });
    await flush();

    const firstCard = tree.root.findByProps({ testID: 'library-card-1' });
    const flattenedStyle = Array.isArray(firstCard.props.style)
      ? Object.assign({}, ...firstCard.props.style)
      : firstCard.props.style;
    expect(flattenedStyle.borderWidth).toBe(2);
  });

  it('renders empty-state recovery CTA when deck has no cards', async () => {
    mockDecksBySlug.csharp = makeDeck('csharp', 'C# Interview', []);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    expect(tree.root.findByProps({ testID: 'library-empty-state' })).toBeTruthy();
    expect(collectText(tree)).toContain('Nothing matches');
    expect(tree.root.findByProps({ testID: 'library-empty-cta' })).toBeTruthy();
  });
});
