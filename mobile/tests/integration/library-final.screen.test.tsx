vi.mock('../../src/sync/progressSync', () => ({ applyCachedRemoteProgress: vi.fn(async () => 0) }));
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// deckCache memoizes deck reads at module scope; clear it between tests so a
// changed resolveDeckBySlug mock is not shadowed by a prior test's entry (G30).
beforeEach(() => {
  invalidateDeckCache();
});

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
let mockUserScope = '';
let mockManifestDecks: Array<{ slug: string; title: string; availability: string }> = [];
let mockDecksBySlug: Record<string, any> = {};
let fontScaleFixture = 1;
let windowWidthFixture = 390;
let windowHeightFixture = 844;

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    TextInput: (props: any) => React.createElement('TextInput', props),
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
    useWindowDimensions: () => ({ width: windowWidthFixture, height: windowHeightFixture, fontScale: fontScaleFixture }),
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

// deckCache reads the user scope through a guarded dynamic import of
// progressScope; mock it so that import resolves to a fixed scope instead of
// dragging in the real authStore -> react-native chain the runner cannot parse.
vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
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
  getUserScopedKey: vi.fn(async (baseKey: string) => `${mockUserScope}${baseKey}`),
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
    fontScaleFixture = 1;
    windowWidthFixture = 390;
    windowHeightFixture = 844;
    invalidateDrawStateCache();
    mockActiveDeckSlug = 'csharp';
    mockUserScope = '';
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
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Card 1, not collected yet' })).toHaveLength(0);
    act(() => tree.root.findByProps({ testID: 'library-filter-chip-all' }).props.onPress());
    const missingCard = tree.root.find((node) =>
      (node.type as any) === 'Pressable' && node.props.accessibilityLabel === 'Card 1, not collected yet');
    expect(missingCard.props.accessibilityRole).toBe('button');
    expect(missingCard.findAll((node) => (node.type as any) === 'Text' && node.props.children === '?')).toHaveLength(1);
    expect(missingCard.findAll((node) => (node.type as any) === 'Text' && node.props.children === 'Q1')).toHaveLength(0);
  });

  it.each([1, 3.2])('keeps the no-match instruction and reset action readable at font scale %s', async (fontScale) => {
    fontScaleFixture = fontScale;
    windowWidthFixture = 375;
    windowHeightFixture = 667;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();
    act(() => tree.root.findByProps({ testID: 'library-search' }).props.onChangeText('no matching question'));
    const empty = tree.root.findByProps({ testID: 'library-empty-state' });
    const texts = empty.findAll((node) => (node.type as any) === 'Text');
    expect(texts.map((text) => text.props.children)).toEqual([
      'Nothing matches', 'Try clearing the filter or pick another deck.', 'Reset filters',
    ]);
    const large = fontScale > 1.3;
    expect(texts.map((text) => text.props.numberOfLines)).toEqual(large ? [undefined, undefined, undefined] : [2, 2, 1]);
    const flatten = (style: any): any => Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten)) : style || {};
    const reset = empty.findByProps({ testID: 'library-empty-cta' });
    const resetStyle = typeof reset.props.style === 'function' ? reset.props.style({ pressed: false }) : reset.props.style;
    expect(flatten(resetStyle).alignSelf).toBe(large ? 'stretch' : undefined);
    expect(flatten(resetStyle).height).toBeUndefined();
    for (const text of texts) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    }
    act(() => reset.props.onPress());
    await flush();
    expect(tree.root.findByProps({ testID: 'library-search' }).props.value).toBe('');
    expect(tree.root.findByProps({ testID: 'library-filter-chip-all' }).props.accessibilityState.selected).toBe(true);
    expect(tree.root.findByProps({ testID: 'library-card-grid' }).props.data).toHaveLength(3);
    expect(tree.root.findAllByProps({ testID: 'library-empty-state' })).toHaveLength(0);
  });

  it('keeps common filters visible and puts rarity filters in the additional panel', async () => {
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
    expect(tree.root.findByProps({ testID: 'library-sheet-filter-rare' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-sheet-filter-legendary' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-all' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-new' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-learning' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-mastered' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-owned' })).toBeTruthy();
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
        tree.root.findByProps({ testID: `library-filter-chip-${filterKey}` }).props.onPress();
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
    expect(tree.root.findAllByProps({ testID: 'library-card-1' })).toHaveLength(0);
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

    for (const uid of ['2', '3']) {
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
    expect(tree.root.findAllByProps({ testID: 'library-card-9' })).toHaveLength(0);
    act(() => tree.root.findByProps({ testID: 'library-filter-chip-all' }).props.onPress());
    expect(tree.root.findByProps({ testID: 'library-card-9' })).toBeTruthy();
  });
  it('searches owned cards by question, displayed number and ID, then clears the query', async () => {
    mockDecksBySlug.csharp.Cards[1].Question = 'How does a queue retry?';
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(
      <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
    ); });
    await flush();
    const search = () => tree.root.findByProps({ testID: 'library-search' });
    expect(search().props.style.minHeight).toBeGreaterThanOrEqual(44);
    for (const query of ['QUEUE RETRY', '#002', '2']) {
      act(() => search().props.onChangeText(query));
      expect(tree.root.findByProps({ testID: 'library-card-2' })).toBeTruthy();
      expect(tree.root.findAllByProps({ testID: 'library-card-3' })).toHaveLength(0);
    }
    act(() => search().props.onChangeText(''));
    expect(tree.root.findByProps({ testID: 'library-card-3' })).toBeTruthy();
  });

  it('restores the last filter for this account and deck without leaking it to another account', async () => {
    async function mountLibrary(expectedFilter: 'owned' | 'all' = 'owned') {
      let tree!: renderer.ReactTestRenderer;
      await act(async () => { tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      ); });
      await vi.waitFor(async () => {
        await flush();
        expect(tree.root.findByProps({ testID: `library-filter-chip-${expectedFilter}` }).props.accessibilityState.selected).toBe(true);
      }, { timeout: 2000, interval: 10 });
      return tree;
    }
    mockUserScope = 'account-a:';
    let tree = await mountLibrary();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-owned' }).props.accessibilityState.selected).toBe(true);
    await act(async () => { tree.root.findByProps({ testID: 'library-filter-chip-all' }).props.onPress(); });
    act(() => tree.unmount());
    tree = await mountLibrary('all');
    expect(tree.root.findByProps({ testID: 'library-filter-chip-all' }).props.accessibilityState.selected).toBe(true);
    act(() => tree.unmount());
    mockUserScope = 'account-b:';
    tree = await mountLibrary();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-owned' }).props.accessibilityState.selected).toBe(true);
    expect(asyncStorageMap.get('account-a:library-filter:v1:csharp')).toBe('all');
    expect(asyncStorageMap.has('account-b:library-filter:v1:csharp')).toBe(false);
    act(() => tree.unmount());
  });

  it('remembers a separate filter for each deck when switching packs', async () => {
    mockManifestDecks.push({ slug: 'aws', title: 'AWS Core', availability: 'live' });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(
      <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
    ); });
    await flush();
    await act(async () => { tree.root.findByProps({ testID: 'library-filter-chip-learning' }).props.onPress(); });
    await act(async () => { tree.root.findByProps({ testID: 'library-deck-aws' }).props.onPress(); });
    await flush();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-owned' }).props.accessibilityState.selected).toBe(true);
    await act(async () => { tree.root.findByProps({ testID: 'library-filter-chip-all' }).props.onPress(); });
    await act(async () => { tree.root.findByProps({ testID: 'library-deck-csharp' }).props.onPress(); });
    await flush();
    expect(tree.root.findByProps({ testID: 'library-filter-chip-learning' }).props.accessibilityState.selected).toBe(true);
    expect(asyncStorageMap.get('library-filter:v1:csharp')).toBe('learning');
    expect(asyncStorageMap.get('library-filter:v1:aws')).toBe('all');
    act(() => tree.unmount());
  });

});
