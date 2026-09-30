import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
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


import {
  DONE_FOR_TODAY_TEXT,
  MistakeBookScreen,
  REVIEW_DONE_HINT,
  REVIEW_DONE_LABEL,
  REVIEW_HINT,
} from '../../src/screens/MistakeBookScreen';
import { MISTAKE_BOOK_KEY, type MistakeEntry } from '../../src/features/gacha/mistakes/mistakeBook';
import { getCachedDeck } from '../../src/content/deckCache';
import { loadDeckProgress } from '../../src/review/storage';
import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';
import type { CardExport, DeckExport } from '../../src/types/deckExport';

// RemoteFeatures (remoteConfig.ts) types only mcq and paywall; newer flags are read untyped.
const asRemoteConfig = (value: unknown) => value as RemoteConfig;

// Local times, so the day boundaries hold in any time zone the suite runs in.
const NOW = new Date(2026, 8, 27, 9, 0, 0).getTime();
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

const AWS = deck('aws', 'AWS SAA', [card('s3-1', 1, 's3'), card('iam-1', 2, 'iam'), card('ec2-1', 20, null)]);
const CSHARP = deck('csharp', 'C# Interview', [card('linq-1', 1, 'linq'), card('linq-2', 2, 'linq')]);

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

describe('MistakeBookScreen done state (M01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    applyRemoteFeatures(null);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.mocked(getCachedDeck).mockImplementation((async (slug: string) =>
      slug === 'aws' ? AWS : slug === 'csharp' ? CSHARP : null) as any);
    vi.mocked(loadDeckProgress).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    applyRemoteFeatures(null);
  });

  it('labels the button as done at load when every mistake of the deck got today\'s correct answer', async () => {
    seedBook([
      { ...entry('csharp', 'linq-1', 'linq', NOW - 2 * DAY_MS), correctStreak: 1, lastCorrectAt: NOW - 60_000 },
      { ...entry('csharp', 'linq-2', 'linq', NOW - 3 * DAY_MS), correctStreak: 1, lastCorrectAt: NOW - 1000 },
    ]);
    const { tree, navigation } = await mount();

    const button = byTestID(tree, 'mistake-review-csharp')[0];
    expect(texts(button)).toEqual([REVIEW_DONE_LABEL]);
    expect(REVIEW_DONE_LABEL).toBe('No mistakes due today');
    expect(button.props.accessibilityHint).toBe(REVIEW_DONE_HINT);
    expect(REVIEW_DONE_HINT).toBe(
      "Every mistake here already has today's correct answer. Come back tomorrow to keep clearing them.",
    );
    // Still pressable: the press re-checks the deck and says why no run starts.
    expect(button.props.disabled).toBe(false);
    expect(button.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(texts(byTestID(tree, 'mistake-done-today-csharp')[0])).toEqual([DONE_FOR_TODAY_TEXT]);
    // Rows keep their own hint.
    expect(byTestID(tree, 'mistake-row-linq-1')[0].props.accessibilityHint).toBe('Opens the card');

    await act(async () => {
      byTestID(tree, 'mistake-review-csharp')[0].props.onPress();
    });
    await flush();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('switches to the done label and hint when the press finds every mistake answered today', async () => {
    // Mounted late in the evening: the correct answers stamped the next morning do not count as
    // today yet, so the deck opens as due. The clock then crosses local midnight before the press.
    const evening = new Date(2026, 8, 26, 23, 59, 0).getTime();
    const morning = new Date(2026, 8, 27, 0, 0, 30).getTime();
    vi.setSystemTime(evening);
    seedBook([
      { ...entry('csharp', 'linq-1', 'linq', evening - 2 * DAY_MS), correctStreak: 1, lastCorrectAt: morning },
      { ...entry('csharp', 'linq-2', 'linq', evening - 3 * DAY_MS), correctStreak: 1, lastCorrectAt: morning },
    ]);
    const { tree, navigation } = await mount();

    const before = byTestID(tree, 'mistake-review-csharp')[0];
    expect(texts(before)).toEqual(['Review mistakes + up to 3 related']);
    expect(before.props.accessibilityHint).toBe(REVIEW_HINT);
    expect(byTestID(tree, 'mistake-done-today-csharp')).toHaveLength(0);

    vi.setSystemTime(morning + 60_000);
    await act(async () => {
      byTestID(tree, 'mistake-review-csharp')[0].props.onPress();
    });
    await flush();

    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(loadDeckProgress).not.toHaveBeenCalled();
    const after = byTestID(tree, 'mistake-review-csharp')[0];
    expect(texts(after)).toEqual([REVIEW_DONE_LABEL]);
    expect(after.props.accessibilityHint).toBe(REVIEW_DONE_HINT);
    expect(after.props.disabled).toBe(false);
    const done = byTestID(tree, 'mistake-done-today-csharp');
    expect(done).toHaveLength(1);
    expect(texts(done[0])).toEqual([DONE_FOR_TODAY_TEXT]);
  });

  it('keeps the review label with the focus-run hint on an open deck', async () => {
    seedBook([
      entry('aws', 's3-1', 's3', NOW - 3000),
      { ...entry('aws', 'iam-1', 'iam', NOW - 2 * DAY_MS), correctStreak: 1, lastCorrectAt: NOW - 1000 },
    ]);
    const { tree } = await mount();

    const button = byTestID(tree, 'mistake-review-aws')[0];
    expect(texts(button)).toEqual(['Review mistakes + up to 3 related']);
    expect(button.props.accessibilityHint).toBe(REVIEW_HINT);
    expect(REVIEW_HINT).toBe('Starts a focus run with these mistakes');
    expect(byTestID(tree, 'mistake-done-today-aws')).toHaveLength(0);
  });

  it('shows the plain review label with the focus-run hint when the flag asks for no related cards', async () => {
    seedBook([entry('aws', 's3-1', 's3', NOW - 3000)]);
    applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { relatedCount: 0 } } }));
    const { tree } = await mount();

    const button = byTestID(tree, 'mistake-review-aws')[0];
    expect(texts(button)).toEqual(['Review mistakes']);
    expect(button.props.accessibilityHint).toBe(REVIEW_HINT);
  });
});
