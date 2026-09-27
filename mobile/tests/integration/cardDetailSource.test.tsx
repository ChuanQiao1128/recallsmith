import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    // CodeBlock (rendered when a code card's answer is open) reads Platform.
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (styles: any) => styles },
    Linking: { openURL: vi.fn(async () => undefined) },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children) };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

const CSHARP_DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 3,
  Cards: [
    {
      StableUid: 'cs-sourced',
      OrderInDeck: 1,
      Difficulty: 2,
      Question: 'What does a using statement do?',
      Explanation: 'It disposes the resource at the end of the block.',
    },
    { StableUid: 'cs-plain', OrderInDeck: 2, Difficulty: 1, Question: 'A card without a source', Explanation: 'Plain.' },
    { StableUid: 'cs-locked', OrderInDeck: 3, Difficulty: 1, Question: 'A locked C# question' },
  ],
};

const DECKS: Record<string, any> = { csharp: CSHARP_DECK };

const SOURCE_URL = 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using';
const SOURCES: Record<string, { url: string; quote: string | null }> = {
  'cs-sourced': { url: SOURCE_URL, quote: 'The using statement ensures the correct use of an IDisposable instance.' },
  'cs-locked': { url: 'https://learn.microsoft.com/en-us/dotnet/locked', quote: 'Locked quote text.' },
};

let ownedFixture: Set<string> | null = null;

vi.mock('../../src/content/activeDeck', () => ({ loadActiveDeckSlug: vi.fn(async () => 'csharp') }));
vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    { slug: 'csharp', title: 'C# Interview', locale: 'en-US', version: '1', deckType: 1, availability: 'live' },
  ]),
  resolveDeckBySlug: vi.fn(async (slug: string) => DECKS[slug] ?? null),
}));
vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async (slug: string) => DECKS[slug] ?? null),
  invalidateDeckCache: () => {},
}));
vi.mock('../../src/review/storage', () => ({ loadDeckProgress: vi.fn(async () => []) }));
vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({ resolveEffectiveOwned: vi.fn(async () => ownedFixture) }));
vi.mock('../../src/content/cardSource', () => ({
  getCardSource: vi.fn(async (_slug: string, uid: string) => SOURCES[uid] ?? null),
  sourceHostLabel: vi.fn((url: string) => (/^https:\/\/(?:www\.)?([^/:?#]+)/.exec(url)?.[1] ?? '').toLowerCase()),
}));

import { Linking } from 'react-native';
import { CardDetailScreen } from '../../src/screens/CardDetailScreen';
import { getCardSource } from '../../src/content/cardSource';
import { applyRemoteFeatures } from '../../src/config/featureFlags';

beforeEach(() => {
  ownedFixture = null;
  vi.mocked(getCardSource).mockClear();
  vi.mocked(Linking.openURL).mockClear();
});

afterEach(() => {
  applyRemoteFeatures(null);
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function byTestId(tree: renderer.ReactTestRenderer, testID: string) {
  // Only host nodes (string type) — the mocked RN wrappers are functional
  // components that pass testID through, so matching both would double-count.
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);
}

function textOf(node: renderer.ReactTestInstance): string {
  const children = node.props.children;
  return Array.isArray(children) ? children.join('') : String(children ?? '');
}

async function renderScreen(cardId: string): Promise<renderer.ReactTestRenderer> {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() };
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <CardDetailScreen
        navigation={navigation as any}
        route={{ key: 'k', name: 'CardDetail', params: { cardId } } as any}
      />,
    );
  });
  await flush();
  return tree;
}

async function press(tree: renderer.ReactTestRenderer, testID: string) {
  const node = byTestId(tree, testID)[0];
  await act(async () => {
    node.props.onPress();
  });
  await flush();
}

// WCAG 2.x contrast ratio of two #RRGGBB colours.
function contrast(fg: string, bg: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const flatStyle = (node: renderer.ReactTestInstance) =>
  Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));

describe('CardDetailScreen — source row', () => {
  it('meets WCAG AA text contrast for every text in the Source row, SOURCE label included', async () => {
    ownedFixture = new Set(['cs-sourced']);
    const tree = await renderScreen('cs-sourced');
    await press(tree, 'card-detail-show-answer');

    const answerBg = flatStyle(byTestId(tree, 'card-detail-answer')[0]).backgroundColor;
    expect(answerBg).toBe('#FFFFFF');
    const texts = byTestId(tree, 'card-detail-source')[0].findAll((n) => (n.type as any) === 'Text');
    const label = texts.find((n) => textOf(n) === 'SOURCE');
    expect(label).toBeDefined();
    // Y08 mobile-9: the 11pt SOURCE label was inkMuted #8A7B6A, 4.10:1 on white.
    expect(contrast(flatStyle(label!).color, answerBg)).toBeGreaterThanOrEqual(4.5);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    for (const text of texts) expect(contrast(flatStyle(text).color, answerBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('shows the source host and quote under an opened answer', async () => {
    ownedFixture = new Set(['cs-sourced']);
    const tree = await renderScreen('cs-sourced');
    await press(tree, 'card-detail-show-answer');

    const answer = byTestId(tree, 'card-detail-answer');
    expect(answer).toHaveLength(1);
    const row = answer[0].findAll((n) => typeof n.type === 'string' && n.props?.testID === 'card-detail-source');
    expect(row).toHaveLength(1);
    expect(row[0].props.accessibilityRole).toBe('link');
    // An explicit label replaces the children's text for VoiceOver, so it must carry the quote too
    // (X07 mobile-1: the old 'Open source on <host>' label dropped the quote).
    expect(row[0].props.accessibilityLabel).toBe(
      `Source, learn.microsoft.com: ${SOURCES['cs-sourced'].quote}`,
    );
    expect(row[0].props.accessibilityHint).toBe('Opens the source in your browser');
    expect(textOf(byTestId(tree, 'card-detail-source-host')[0])).toBe('learn.microsoft.com');
    const quote = byTestId(tree, 'card-detail-source-quote');
    expect(quote).toHaveLength(1);
    expect(quote[0].props.numberOfLines).toBe(3);
    expect(textOf(quote[0])).toBe(SOURCES['cs-sourced'].quote);
    expect(vi.mocked(getCardSource)).toHaveBeenCalledWith('csharp', 'cs-sourced');

    // Hiding the answer hides the row with it.
    await press(tree, 'card-detail-show-answer');
    expect(byTestId(tree, 'card-detail-source')).toHaveLength(0);
  });

  it('labels a Source row without a quote with the host alone', async () => {
    ownedFixture = new Set(['cs-sourced']);
    vi.mocked(getCardSource).mockResolvedValueOnce({ url: SOURCE_URL, quote: null });
    const tree = await renderScreen('cs-sourced');
    await press(tree, 'card-detail-show-answer');

    const row = byTestId(tree, 'card-detail-source');
    expect(row).toHaveLength(1);
    expect(row[0].props.accessibilityLabel).toBe('Source, learn.microsoft.com');
    expect(row[0].props.accessibilityHint).toBe('Opens the source in your browser');
    expect(byTestId(tree, 'card-detail-source-quote')).toHaveLength(0);
  });

  it('opens the https source URL when the Source row is tapped', async () => {
    ownedFixture = new Set(['cs-sourced']);
    const tree = await renderScreen('cs-sourced');
    await press(tree, 'card-detail-show-answer');

    await press(tree, 'card-detail-source');
    expect(vi.mocked(Linking.openURL)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Linking.openURL)).toHaveBeenCalledWith(SOURCE_URL);
  });

  it('shows no Source row for a card without a source', async () => {
    ownedFixture = new Set(['cs-plain']);
    const tree = await renderScreen('cs-plain');
    await press(tree, 'card-detail-show-answer');

    expect(byTestId(tree, 'card-detail-answer')).toHaveLength(1);
    expect(vi.mocked(getCardSource)).toHaveBeenCalledWith('csharp', 'cs-plain');
    expect(byTestId(tree, 'card-detail-source')).toHaveLength(0);
    expect(byTestId(tree, 'card-detail-source-quote')).toHaveLength(0);
  });

  it('shows no Source row when the cardSource flag is off', async () => {
    applyRemoteFeatures({ features: { cardSource: { enabled: false } } } as any);
    ownedFixture = new Set(['cs-sourced']);
    const tree = await renderScreen('cs-sourced');
    await press(tree, 'card-detail-show-answer');

    expect(byTestId(tree, 'card-detail-answer')).toHaveLength(1);
    expect(byTestId(tree, 'card-detail-source')).toHaveLength(0);
    expect(vi.mocked(getCardSource)).not.toHaveBeenCalled();
  });

  it('never loads a source for a locked card', async () => {
    ownedFixture = new Set(); // non-null, does not hold cs-locked → locked
    const tree = await renderScreen('cs-locked');

    expect(byTestId(tree, 'card-detail-show-answer')).toHaveLength(0);
    expect(byTestId(tree, 'card-detail-source')).toHaveLength(0);
    expect(vi.mocked(getCardSource)).not.toHaveBeenCalled();
  });

  it('loads the source only after the answer is opened', async () => {
    ownedFixture = new Set(['cs-sourced']);
    const tree = await renderScreen('cs-sourced');

    expect(vi.mocked(getCardSource)).not.toHaveBeenCalled();
    expect(byTestId(tree, 'card-detail-source')).toHaveLength(0);

    await press(tree, 'card-detail-show-answer');
    expect(vi.mocked(getCardSource)).toHaveBeenCalledTimes(1);
    expect(byTestId(tree, 'card-detail-source')).toHaveLength(1);
  });

  it('drops a source that arrives after the card changed', async () => {
    ownedFixture = new Set(['cs-sourced', 'cs-plain']);
    let release!: (value: { url: string; quote: string | null } | null) => void;
    vi.mocked(getCardSource).mockImplementationOnce(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() };
    const route = (cardId: string) => ({ key: 'k', name: 'CardDetail', params: { cardId } }) as any;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<CardDetailScreen navigation={navigation as any} route={route('cs-sourced')} />);
    });
    await flush();
    await press(tree, 'card-detail-show-answer');

    await act(async () => {
      tree.update(<CardDetailScreen navigation={navigation as any} route={route('cs-plain')} />);
    });
    await flush();
    // The new card's answer is open (and has no source) when the old load lands.
    await press(tree, 'card-detail-show-answer');
    expect(byTestId(tree, 'card-detail-answer')).toHaveLength(1);
    await act(async () => {
      release(SOURCES['cs-sourced']);
    });
    await flush();

    expect(byTestId(tree, 'card-detail-source')).toHaveLength(0);
  });
});
