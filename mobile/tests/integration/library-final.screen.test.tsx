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

// The Library reads a collection now, so this file needs somewhere for one to
// live. A map is enough: the real drawStateStore runs on top of it, which is
// what makes "this account drew card 1" a fact the screen has to read rather
// than a value handed to it.
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
  // The real scope helper is a one-liner over the signed-in sub, and the draw
  // state store keys through it. Stubbing it as identity keeps every deck in
  // one partition, which is all this file's fixtures need.
  getUserScopedKey: vi.fn(async (baseKey: string) => baseKey),
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
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';

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
    asyncStorageMap.clear();
    invalidateDrawStateCache();
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

  it('highlights exactly the cards the caller named, not the first unstudied one', async () => {
    // The csharp fixture's progress makes card 1 the only 'new' one, so the
    // old first-new-card heuristic would light up #1. A draw that granted
    // #2 and #3 must light up #2 and #3 instead.
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <LibraryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'library',
            name: 'Library',
            params: { scrollToNew: true, highlightUids: ['2', '3'] },
          } as any}
        />,
      );
    });
    await flush();

    const borderWidthOf = (uid: string) => {
      const card = tree.root.findByProps({ testID: `library-card-${uid}` });
      const style = Array.isArray(card.props.style)
        ? Object.assign({}, ...card.props.style)
        : card.props.style;
      return style.borderWidth;
    };

    expect(borderWidthOf('2')).toBe(2);
    expect(borderWidthOf('3')).toBe(2);
    expect(borderWidthOf('1')).not.toBe(2);
  });

  it('ignores named uids that are not on screen and falls back to nothing', async () => {
    // A uid from another deck (or filtered out) must not silently promote
    // some other card into the highlight.
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <LibraryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'library',
            name: 'Library',
            params: { scrollToNew: true, highlightUids: ['not-in-this-deck'] },
          } as any}
        />,
      );
    });
    await flush();

    for (const uid of ['1', '2', '3']) {
      const card = tree.root.findByProps({ testID: `library-card-${uid}` });
      const style = Array.isArray(card.props.style)
        ? Object.assign({}, ...card.props.style)
        : card.props.style;
      expect(style.borderWidth).not.toBe(2);
    }
  });

  it('highlights first new card when entering with scrollToNew flag', async () => {
    // Card 1 has to be drawn for this to still be a "new card". Before the
    // ownership gate, "new" meant "unstudied", so every deck had one on day
    // zero and the flag always found something; now it means "held and
    // unstudied", and a deck nobody has pulled from has nothing to highlight.
    // The assertion below is unchanged -- what changed is that the fixture has
    // to say out loud which card this account owns.
    await saveDrawState('csharp', { owned: ['1'], pity: null });

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

  it('shows the Review all CTA with the learned count and starts a sweep', async () => {
    // Default fixture: card 2 is learning, card 3 is mastered → 2 owned learned cards.
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const cta = tree.root.findByProps({ testID: 'library-sweep-cta' });
    expect(cta.props.accessibilityLabel).toBe('Review all learned cards');
    const label = cta.find((child: any) => (child.type as any) === 'Text').props.children;
    expect(label).toBe('Review all · 2');

    act(() => cta.props.onPress());
    expect(navigate).toHaveBeenCalledWith('SessionCard', { slug: 'csharp', mode: 'sweep' });
  });

  it('hides the Review all CTA when nothing has been learned', async () => {
    mockDecksBySlug.csharp = makeDeck('csharp', 'C# Interview', [{ uid: '9', order: 1, difficulty: 1, question: 'Q9' }]);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    expect(tree.root.findAllByProps({ testID: 'library-sweep-cta' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'library-card-9' })).toBeTruthy();
  });
});
