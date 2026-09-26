import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// A/C correct (requiredCount 2), stored order a, b, c, d. Only a and c carry no
// `why`; the wrong options need one, per normalizeMcq's rules.
const MCQ = {
  v: 1,
  qualifier: null,
  shuffle: true,
  options: [
    { key: 'a', text: 'Enable cross-region replication', why: null, correct: true },
    { key: 'b', text: 'Enable transfer acceleration', why: 'Speeds uploads; never copies to another Region.', correct: false },
    { key: 'c', text: 'Enable object lock in compliance mode', why: null, correct: true },
    { key: 'd', text: 'Apply a deny bucket policy', why: 'A policy can be edited or removed by an admin.', correct: false },
  ],
};

const CSHARP_DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 2,
  Cards: [
    {
      StableUid: 'cs-owned',
      OrderInDeck: 1,
      Difficulty: 2,
      Question: 'What does a using statement do?',
      Explanation: 'It disposes the resource at the end of the block.',
      CodeSnippet: 'using (var f = File.OpenRead(path)) {\n  Read(f);\n}',
      CodeLanguage: 'cs',
      RealWorldUsage: '- Wrap any IDisposable to guarantee cleanup.',
    },
    { StableUid: 'cs-locked', OrderInDeck: 2, Difficulty: 1, Question: 'A locked C# question' },
  ],
};

const AWS_DECK = {
  Slug: 'aws',
  Title: 'AWS',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 1,
  Cards: [
    {
      StableUid: 'aws-mcq',
      OrderInDeck: 1,
      Difficulty: 2,
      Question: 'Which options make the copy durable?',
      Explanation: 'Durability comes from replication plus retention.',
      Mcq: MCQ,
    },
  ],
};

const DECKS: Record<string, any> = { csharp: CSHARP_DECK, aws: AWS_DECK };

let ownedFixture: Set<string> | null = null;

vi.mock('../../src/content/activeDeck', () => ({ loadActiveDeckSlug: vi.fn(async () => 'csharp') }));

// The screen looks a card up across every installed deck. deckRepository lists
// the slugs; deckCache resolves each by slug from the fixture map.
vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    { slug: 'csharp', title: 'C# Interview', locale: 'en-US', version: '1', deckType: 1, availability: 'live' },
    { slug: 'aws', title: 'AWS', locale: 'en-US', version: '1', deckType: 2, availability: 'live' },
  ]),
  resolveDeckBySlug: vi.fn(async (slug: string) => DECKS[slug] ?? null),
}));
vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async (slug: string) => DECKS[slug] ?? null),
  invalidateDeckCache: () => {},
}));
vi.mock('../../src/review/storage', () => ({ loadDeckProgress: vi.fn(async () => []) }));
vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({ resolveEffectiveOwned: vi.fn(async () => ownedFixture) }));

import { CardDetailScreen } from '../../src/screens/CardDetailScreen';
import { loadActiveDeckSlug } from '../../src/content/activeDeck';

beforeEach(() => {
  ownedFixture = null;
  vi.mocked(loadActiveDeckSlug).mockImplementation(async () => 'csharp');
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function textBlob(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children ?? '');
    })
    .join('\n');
}

function byTestId(tree: renderer.ReactTestRenderer, testID: string) {
  // Only host nodes (string type) — the mocked RN wrappers are functional
  // components that pass testID through, so matching both would double-count.
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);
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
  (tree as any).__nav = navigation;
  return tree;
}

async function press(tree: renderer.ReactTestRenderer, testID: string) {
  const node = byTestId(tree, testID)[0];
  await act(async () => {
    node.props.onPress();
  });
  await flush();
}

describe('CardDetailScreen — show answer', () => {
  it('shows the answer sections after tapping Show answer on an owned card', async () => {
    ownedFixture = new Set(['cs-owned']);
    const tree = await renderScreen('cs-owned');

    // Closed by default — no answer body yet.
    expect(byTestId(tree, 'card-detail-answer')).toHaveLength(0);
    expect(byTestId(tree, 'card-detail-show-answer')).toHaveLength(1);

    await press(tree, 'card-detail-show-answer');

    expect(byTestId(tree, 'card-detail-answer')).toHaveLength(1);
    const blob = textBlob(tree);
    expect(blob).toContain('EXPLANATION');
    expect(blob).toContain('CODING SAMPLE');
    expect(blob).toContain('REAL USAGE');
    expect(blob).toContain('It disposes the resource at the end of the block.');
    expect(blob).toContain('Hide answer');
  });

  it('lists the correct options for a multiple-choice card', async () => {
    ownedFixture = new Set(['aws-mcq']);
    const tree = await renderScreen('aws-mcq');

    await press(tree, 'card-detail-show-answer');

    const correct = byTestId(tree, 'card-detail-mcq-correct');
    expect(correct).toHaveLength(1);
    const correctBlob = correct[0]
      .findAll((n) => (n.type as any) === 'Text')
      .map((n) => String(n.props.children ?? ''))
      .join('\n');
    expect(correctBlob).toContain('Enable cross-region replication');
    expect(correctBlob).toContain('Enable object lock in compliance mode');
    // Only the correct options, in stored order (a before c).
    expect(correctBlob.indexOf('cross-region')).toBeLessThan(correctBlob.indexOf('object lock'));
    expect(correctBlob).not.toContain('transfer acceleration');
    expect(correctBlob).not.toContain('deny bucket policy');
  });

  it('offers no Show answer toggle on a locked card', async () => {
    ownedFixture = new Set(); // non-null, does not hold cs-locked → locked
    const tree = await renderScreen('cs-locked');

    expect(byTestId(tree, 'card-detail-show-answer')).toHaveLength(0);
    expect(byTestId(tree, 'card-detail-answer')).toHaveLength(0);
    expect(textBlob(tree)).toContain('Not in your collection');
  });

  it('renders a skeleton while loading instead of placeholder data', async () => {
    ownedFixture = new Set(['cs-owned']);
    // loadActiveDeckSlug never resolves → the lookup never lands → still loading.
    vi.mocked(loadActiveDeckSlug).mockImplementation(() => new Promise<string | null>(() => {}));

    const tree = await renderScreen('cs-owned');

    expect(byTestId(tree, 'card-detail-skeleton')).toHaveLength(1);
    const blob = textBlob(tree);
    expect(blob).not.toContain('#000');
    expect(blob).not.toContain('Common');
    expect(blob).not.toContain('Card details');
  });

  it('renders an explicit not-found state for an unknown card id', async () => {
    ownedFixture = new Set(['cs-owned']);
    const tree = await renderScreen('no-such-card');

    expect(byTestId(tree, 'card-detail-not-found')).toHaveLength(1);
    const blob = textBlob(tree);
    expect(blob).toContain('Card not found');
    expect(blob).toContain("isn't on this phone");
  });

  it('opens a card from a deck that is not the active one', async () => {
    ownedFixture = new Set(['aws-mcq']);
    // Active deck is csharp; the card lives in aws, reached via the installed list.
    const tree = await renderScreen('aws-mcq');

    expect(byTestId(tree, 'card-detail-not-found')).toHaveLength(0);
    expect(byTestId(tree, 'card-detail-skeleton')).toHaveLength(0);
    expect(byTestId(tree, 'card-detail-show-answer')).toHaveLength(1);
    expect(textBlob(tree)).toContain('Which options make the copy durable?');
  });
});
