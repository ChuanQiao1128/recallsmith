import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// LibraryScreen wiring of the K02 Mistakes pill: the real mistakeBook module reads an in-memory
// AsyncStorage, so the count, the flag spread and the per-focus re-read are all exercised through
// the screen rather than through LibraryHeader alone.

function makeDeck(slug: string, title: string, uids: string[]) {
  return {
    Slug: slug,
    Title: title,
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    Cards: uids.map((uid, index) => ({ StableUid: uid, OrderInDeck: index + 1, Difficulty: 1, Question: `Q ${uid}` })),
  } as any;
}

const DECKS: Record<string, any> = {
  csharp: makeDeck('csharp', 'C# Interview', ['1', '2', '3']),
  python: makeDeck('python', 'Python Basics', ['p1', 'p2']),
};

let mockActiveDeckSlug = 'csharp';
let mockManifestDecks: Array<{ slug: string; title: string; availability: string }> = [];

// Every mounted useFocusEffect registers a "focus again" hook here, so a test can replay the
// navigation focus event the way React Navigation does: cleanup of the last run, then a new run.
const focusHooks = vi.hoisted(() => new Set<() => void>());

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
  useFocusEffect: (callback: () => void | (() => void)) => {
    React.useEffect(() => {
      let cleanup = callback();
      const refocus = () => {
        if (typeof cleanup === 'function') cleanup();
        cleanup = callback();
      };
      focusHooks.add(refocus);
      return () => {
        focusHooks.delete(refocus);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [callback]);
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
  resolveDeckBySlug: vi.fn(async (slug: string) => DECKS[slug] ?? null),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

const asyncStorageMap = new Map<string, string>();
// When set, reads of the Mistake Book key wait on this promise, so a test can look at the screen
// while the re-read is in flight.
let mistakeReadGate: Promise<void> | null = null;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (key === 'devcards:mistakes:v1' && mistakeReadGate) await mistakeReadGate;
      return asyncStorageMap.get(key) ?? null;
    }),
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
  loadDeckProgress: vi.fn(async (deck: any) =>
    (deck?.Cards ?? []).map((card: any) => ({
      stableUid: card.StableUid,
      stage: 2,
      lastReviewedAt: Date.now() - 1000,
      nextReviewAt: Date.now() + 86_400_000,
    })),
  ),
}));

import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { MISTAKE_BOOK_KEY, type MistakeEntry } from '../../src/features/gacha/mistakes/mistakeBook';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';

const asRemoteConfig = (value: unknown) => value as RemoteConfig;

function mistake(deckSlug: string, stableUid: string): MistakeEntry {
  const at = Date.now() - 60_000;
  return {
    deckSlug,
    stableUid,
    topic: null,
    wrongCount: 1,
    firstWrongAt: at,
    lastWrongAt: at,
    lastOutcome: 'again',
    correctStreak: 0,
    resolvedAt: null,
  };
}

function seedBook(entries: MistakeEntry[]) {
  const record: Record<string, MistakeEntry> = {};
  for (const e of entries) record[`${e.deckSlug}::${e.stableUid}`] = e;
  asyncStorageMap.set(MISTAKE_BOOK_KEY, JSON.stringify({ v: 1, entries: record }));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

const pills = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.type === 'string' && node.props?.testID === 'library-mistakes-pill');

function pillText(tree: renderer.ReactTestRenderer): string | null {
  const found = pills(tree);
  if (found.length === 0) return null;
  return found[0].findAll((node) => (node.type as any) === 'Text')[0].props.children;
}

async function mount() {
  const navigation = { navigate: vi.fn() } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LibraryScreen navigation={navigation} route={{ key: 'library', name: 'Library' } as any} />);
  });
  await flush();
  return { tree, navigation };
}

async function refocus() {
  await act(async () => {
    for (const hook of [...focusHooks]) hook();
  });
}

describe('LibraryScreen Mistakes pill', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    invalidateDeckCache();
    invalidateDrawStateCache();
    asyncStorageMap.clear();
    focusHooks.clear();
    mistakeReadGate = null;
    mockActiveDeckSlug = 'csharp';
    mockManifestDecks = [
      { slug: 'csharp', title: 'C# Interview', availability: 'live' },
      { slug: 'python', title: 'Python Basics', availability: 'live' },
    ];
    applyRemoteFeatures(null);
    vi.clearAllMocks();
  });

  afterEach(() => {
    applyRemoteFeatures(null);
  });

  it('shows the stored count of the selected deck and opens the Mistake Book for it', async () => {
    seedBook([mistake('csharp', '1'), mistake('csharp', '2'), mistake('python', 'p1')]);
    const { tree, navigation } = await mount();

    expect(pillText(tree)).toBe('Mistakes · 2');
    expect(pills(tree)[0].props.accessibilityLabel).toBe('Open Mistake Book, 2 to review');
    await act(async () => {
      pills(tree)[0].props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('MistakeBook', { slug: 'csharp' });
  });

  // Y08 mobile-13: the pill counts what the Mistake Book lists, so an entry for a card a content
  // update removed (or for a deck that is not installed) never keeps the pill up.
  it('counts only mistakes whose card is still in the selected deck', async () => {
    seedBook([mistake('csharp', '1'), mistake('csharp', 'removed-card'), mistake('csharp', '3')]);
    const { tree } = await mount();
    expect(pillText(tree)).toBe('Mistakes · 2');
    expect(pills(tree)[0].props.accessibilityLabel).toBe('Open Mistake Book, 2 to review');

    // Only an orphan left: no pill, just as the book would show its empty state.
    seedBook([mistake('csharp', 'removed-card')]);
    await refocus();
    await flush();
    expect(pills(tree)).toHaveLength(0);
  });

  it('shows no pill for a selected deck that is not installed', async () => {
    mockActiveDeckSlug = 'rust';
    mockManifestDecks = [...mockManifestDecks, { slug: 'rust', title: 'Rust', availability: 'live' }];
    seedBook([mistake('rust', 'r1')]);
    const { tree } = await mount();
    expect(pills(tree)).toHaveLength(0);
  });

  it('hides the pill when the mistakeBook flag is off', async () => {
    applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { enabled: false } } }));
    seedBook([mistake('csharp', '1')]);
    const { tree } = await mount();

    expect(tree.root.findAll((node) => node.props?.testID === 'library-card-grid').length).toBeGreaterThan(0);
    expect(pills(tree)).toHaveLength(0);
  });

  it('re-reads the book on focus and keeps the pill on screen while it does', async () => {
    seedBook([mistake('csharp', '1'), mistake('csharp', '2')]);
    const { tree } = await mount();
    expect(pillText(tree)).toBe('Mistakes · 2');

    // A focus run resolved one mistake while Library was in the background.
    seedBook([mistake('csharp', '1')]);
    let openGate!: () => void;
    mistakeReadGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    await refocus();
    await flush();

    // Read in flight: the previous count stays, so the header does not collapse and regrow.
    expect(pillText(tree)).toBe('Mistakes · 2');

    await act(async () => {
      openGate();
    });
    await flush();
    expect(pillText(tree)).toBe('Mistakes · 1');

    // Every mistake cleared: the next focus hides the pill.
    mistakeReadGate = null;
    seedBook([]);
    await refocus();
    await flush();
    expect(pills(tree)).toHaveLength(0);
  });

  it('never shows the previous deck count on a deck switch', async () => {
    seedBook([mistake('csharp', '1'), mistake('csharp', '2'), mistake('python', 'p1')]);
    const { tree } = await mount();
    expect(pillText(tree)).toBe('Mistakes · 2');

    let openGate!: () => void;
    mistakeReadGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    await act(async () => {
      tree.root
        .findAll((node) => typeof node.type === 'string' && node.props?.testID === 'library-deck-python')[0]
        .props.onPress();
    });
    await flush();
    // Python's read is still pending: C#'s count must not be shown against it.
    expect(pills(tree)).toHaveLength(0);

    await act(async () => {
      openGate();
    });
    await flush();
    expect(pillText(tree)).toBe('Mistakes · 1');
  });
});
