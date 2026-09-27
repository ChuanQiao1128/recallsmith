import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, style, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
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

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

vi.mock('../../src/review/storage', () => ({
  getUserScopedKey: vi.fn(async (key: string) => `devcards:u:test:${key}`),
  loadDeckProgress: vi.fn(async () => []),
}));

vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async () => null),
}));

vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({
  resolveEffectiveOwned: vi.fn(async () => new Set<string>()),
}));

import { MistakeBookScreen } from '../../src/screens/MistakeBookScreen';
import { MISTAKE_BOOK_KEY, type MistakeEntry } from '../../src/features/gacha/mistakes/mistakeBook';
import { getCachedDeck } from '../../src/content/deckCache';
import { loadDeckProgress } from '../../src/review/storage';
import { resolveEffectiveOwned } from '../../src/features/gacha/draw/effectiveOwned';
import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';

// RemoteFeatures (remoteConfig.ts) types only mcq and paywall; newer flags are read untyped.
const asRemoteConfig = (value: unknown) => value as RemoteConfig;
import type { CardExport, DeckExport } from '../../src/types/deckExport';

const NOW = Date.UTC(2026, 8, 27, 9, 0, 0);
const DAY_MS = 86_400_000;
const BOOK_KEY = `devcards:u:test:${MISTAKE_BOOK_KEY}`;

function card(uid: string, order: number, topic: string | null = null): CardExport {
  return { StableUid: uid, OrderInDeck: order, Difficulty: 1, Question: `Question ${uid}`, Topic: topic };
}

function deck(slug: string, title: string, cards: CardExport[]): DeckExport {
  return {
    Slug: slug,
    Title: title,
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    IsFreeStarter: true,
    TotalCards: cards.length,
    FreeCardCount: cards.length,
    Cards: cards,
  };
}

const AWS = deck('aws', 'AWS SAA', [
  card('s3-1', 1, 's3'),
  card('iam-1', 2, 'iam'),
  card('s3-2', 3, 's3'),
  card('s3-3', 4, 's3'),
  card('iam-2', 5, 'iam'),
  card('ec2-1', 20, null),
]);
const CSHARP = deck('csharp', 'C# Interview', [card('linq-1', 1, 'linq')]);

function entry(deckSlug: string, stableUid: string, topic: string | null, lastWrongAt: number, wrongCount = 1): MistakeEntry {
  return {
    deckSlug,
    stableUid,
    topic,
    wrongCount,
    firstWrongAt: lastWrongAt,
    lastWrongAt,
    lastOutcome: 'again',
    correctStreak: 0,
    resolvedAt: null,
  };
}

function seedBook(entries: MistakeEntry[]) {
  const record: Record<string, MistakeEntry> = {};
  for (const e of entries) record[`${e.deckSlug}::${e.stableUid}`] = e;
  store.set(BOOK_KEY, JSON.stringify({ v: 1, entries: record }));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

function texts(node: renderer.ReactTestInstance): string[] {
  return node
    .findAll((child) => (child.type as any) === 'Text')
    .map((child) => {
      const c = child.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
}

async function mount(params?: { slug?: string }) {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), addListener: vi.fn(() => () => {}) } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MistakeBookScreen navigation={navigation} route={{ key: 'mb', name: 'MistakeBook', params } as any} />,
    );
  });
  await flush();
  return { tree, navigation };
}

describe('MistakeBookScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    applyRemoteFeatures(null);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.mocked(getCachedDeck).mockImplementation((async (slug: string) =>
      slug === 'aws' ? AWS : slug === 'csharp' ? CSHARP : null) as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    applyRemoteFeatures(null);
  });

  it('lists active mistakes for each deck with question, topic and wrong count', async () => {
    seedBook([
      entry('aws', 's3-1', 's3', NOW - 2 * DAY_MS, 2),
      entry('aws', 'ec2-1', null, NOW - 1000),
      entry('csharp', 'linq-1', 'linq', NOW - DAY_MS - 1000, 1),
      // Not listed: resolved, out of the 30-day window, card missing from the installed deck, deck not installed.
      { ...entry('aws', 'iam-1', 'iam', NOW - 1000), correctStreak: 2, resolvedAt: NOW - 500 },
      entry('aws', 's3-3', 's3', NOW - 31 * DAY_MS),
      entry('aws', 'gone', 's3', NOW - 1000),
      entry('gcp', 'x', null, NOW - 1000),
    ]);
    const { tree } = await mount();

    expect(byTestID(tree, 'mistake-book-loading')).toHaveLength(0);
    expect(byTestID(tree, 'mistake-book-empty')).toHaveLength(0);
    expect(texts(tree.root)).toContain('Mistake Book');

    // Decks in order of their newest mistake.
    const decks = tree.root
      .findAll((node) => typeof node.type === 'string' && /^mistake-deck-/.test(node.props?.testID ?? ''))
      .map((node) => node.props.testID);
    expect(decks).toEqual(['mistake-deck-aws', 'mistake-deck-csharp']);
    expect(byTestID(tree, 'mistake-deck-gcp')).toHaveLength(0);

    const awsRows = byTestID(tree, 'mistake-deck-aws')[0]
      .findAll((node) => typeof node.type === 'string' && /^mistake-row-/.test(node.props?.testID ?? ''))
      .map((node) => node.props.testID);
    expect(awsRows).toEqual(['mistake-row-ec2-1', 'mistake-row-s3-1']);
    expect(texts(byTestID(tree, 'mistake-deck-aws')[0])).toContain('AWS SAA');

    const s3Row = byTestID(tree, 'mistake-row-s3-1')[0];
    expect(s3Row.props.accessibilityRole).toBe('button');
    expect(texts(s3Row)).toEqual(['Question s3-1', 's3', 'Wrong ×2', 'Last wrong 2 days ago']);
    expect(texts(byTestID(tree, 'mistake-row-ec2-1')[0])).toEqual(['Question ec2-1', 'Wrong ×1', 'Last wrong today']);
    expect(texts(byTestID(tree, 'mistake-row-linq-1')[0])).toEqual([
      'Question linq-1',
      'linq',
      'Wrong ×1',
      'Last wrong yesterday',
    ]);
    const question = byTestID(tree, 'mistake-row-s3-1')[0].findAll((n) => (n.type as any) === 'Text')[0];
    expect(question.props.numberOfLines).toBe(2);
    for (const id of ['mistake-row-iam-1', 'mistake-row-s3-3', 'mistake-row-gone']) {
      expect(byTestID(tree, id)).toHaveLength(0);
    }
    expect(texts(tree.root).join(' ')).not.toContain('—');

    const review = byTestID(tree, 'mistake-review-aws')[0];
    expect(review.props.accessibilityRole).toBe('button');
    expect(texts(review)).toEqual(['Review mistakes + 3 related']);
  });

  it('opens CardDetail when a mistake is tapped', async () => {
    seedBook([entry('aws', 's3-1', 's3', NOW - 1000)]);
    const { tree, navigation } = await mount();

    await act(async () => {
      byTestID(tree, 'mistake-row-s3-1')[0].props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('CardDetail', { cardId: 's3-1' });
  });

  it('starts a focus session with the mistakes and related cards', async () => {
    seedBook([
      entry('aws', 's3-1', 's3', NOW - 3000),
      entry('aws', 'iam-1', 'iam', NOW - 1000),
      entry('csharp', 'linq-1', 'linq', NOW - 2000),
    ]);
    const learned = (uid: string, stage: number) => ({
      stableUid: uid,
      stage,
      lastReviewedAt: NOW - DAY_MS,
      nextReviewAt: NOW + 5 * DAY_MS,
    });
    vi.mocked(loadDeckProgress).mockResolvedValue([
      learned('s3-1', 1),
      learned('iam-1', 1),
      learned('s3-2', 2),
      learned('s3-3', 1),
      learned('iam-2', 3),
      learned('ec2-1', 0),
    ]);
    vi.mocked(resolveEffectiveOwned).mockResolvedValue(new Set(['s3-1', 'iam-1', 's3-2', 's3-3', 'iam-2', 'ec2-1']));
    const { tree, navigation } = await mount({ slug: 'aws' });

    // A slug narrows the book to that deck.
    expect(byTestID(tree, 'mistake-deck-csharp')).toHaveLength(0);

    await act(async () => {
      byTestID(tree, 'mistake-review-aws')[0].props.onPress();
    });
    await flush();

    expect(loadDeckProgress).toHaveBeenCalledWith(AWS);
    expect(resolveEffectiveOwned).toHaveBeenCalledWith('aws', expect.any(Array));
    // Mistakes newest first, then iam (newest mistake's topic), then s3 by stage, then the rest.
    expect(navigation.navigate).toHaveBeenCalledWith('SessionCard', {
      slug: 'aws',
      focusUids: ['iam-1', 's3-1', 'iam-2', 's3-3', 's3-2'],
    });
  });

  it('starts a focus session with the mistakes only when progress cannot be read or the flag asks for none', async () => {
    seedBook([entry('aws', 's3-1', 's3', NOW - 3000), entry('aws', 'iam-1', 'iam', NOW - 1000)]);
    vi.mocked(loadDeckProgress).mockRejectedValueOnce(new Error('storage down'));
    const first = await mount();
    await act(async () => {
      byTestID(first.tree, 'mistake-review-aws')[0].props.onPress();
    });
    await flush();
    expect(first.navigation.navigate).toHaveBeenCalledWith('SessionCard', { slug: 'aws', focusUids: ['iam-1', 's3-1'] });

    applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { relatedCount: 0 } } }));
    const second = await mount();
    expect(texts(byTestID(second.tree, 'mistake-review-aws')[0])).toEqual(['Review mistakes']);
  });

  it('shows the empty state when there are no active mistakes', async () => {
    const { tree } = await mount();

    const empty = byTestID(tree, 'mistake-book-empty');
    expect(empty).toHaveLength(1);
    expect(texts(empty[0])[0]).toBe('No mistakes to review');
    expect(byTestID(tree, 'mistake-review-aws')).toHaveLength(0);
  });

  it('reloads the book when the screen regains focus', async () => {
    const { tree, navigation } = await mount();
    expect(byTestID(tree, 'mistake-book-empty')).toHaveLength(1);
    expect(navigation.addListener).toHaveBeenCalledWith('focus', expect.any(Function));

    seedBook([entry('aws', 's3-1', 's3', NOW - 1000)]);
    const onFocus = navigation.addListener.mock.calls[0][1];
    await act(async () => {
      onFocus();
    });
    await flush();
    expect(byTestID(tree, 'mistake-row-s3-1')).toHaveLength(1);
  });
});
