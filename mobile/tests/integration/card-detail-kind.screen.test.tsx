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
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
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

// PG-ordered blobs from plan §4.3 (the only quotable MCQ text). Card 1: b correct
// (requiredCount 1). Card 2: a/c correct (requiredCount 2).
const PLAN_CARD_1_MCQ = {
  v: 1,
  options: [
    { key: 'a', why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.', text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.', correct: false },
    { key: 'b', why: null, text: 'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.', correct: true },
    { key: 'c', why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.', text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.', correct: false },
    { key: 'd', why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.', text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.', correct: false },
  ],
  shuffle: true,
  qualifier: 'LEAST operational overhead',
};

const PLAN_CARD_2_MCQ = {
  v: 1,
  options: [
    { key: 'a', why: null, text: 'Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.', correct: true },
    { key: 'b', why: 'Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.', text: 'Enable S3 Transfer Acceleration on the source bucket.', correct: false },
    { key: 'c', why: null, text: 'Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.', correct: true },
    { key: 'd', why: 'A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.', text: 'Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.', correct: false },
    { key: 'e', why: "MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.", text: 'Enable MFA Delete on the source bucket.', correct: false },
  ],
  shuffle: true,
  qualifier: null,
};

const DECK = {
  Slug: 'aws',
  Title: 'AWS',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 3,
  Cards: [
    { StableUid: 'one', OrderInDeck: 1, Difficulty: 2, Question: 'Q one', Mcq: PLAN_CARD_1_MCQ },
    { StableUid: 'two', OrderInDeck: 2, Difficulty: 3, Question: 'Q two', Mcq: PLAN_CARD_2_MCQ },
    { StableUid: 'qa', OrderInDeck: 3, Difficulty: 1, Question: 'Q plain' },
  ],
};

let ownedFixture: Set<string> | null = null;

vi.mock('../../src/content/activeDeck', () => ({ loadActiveDeckSlug: vi.fn(async () => 'aws') }));

vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => DECK) }));
// This screen loads the deck through deckCache's guarded loader. Mock deckCache
// to delegate straight to the (mocked) resolveDeckBySlug so the read keeps the
// same shape the test drives, without the real cache's dynamic scope import.
vi.mock('../../src/content/deckCache', async () => {
  const repo = (await import('../../src/content/deckRepository')) as {
    resolveDeckBySlug: (slug: string) => Promise<unknown>;
  };
  return {
    getCachedDeck: (slug: string) => repo.resolveDeckBySlug(slug),
    invalidateDeckCache: () => {},
  };
});
vi.mock('../../src/review/storage', () => ({ loadDeckProgress: vi.fn(async () => []) }));
vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({ resolveEffectiveOwned: vi.fn(async () => ownedFixture) }));

import { CardDetailScreen } from '../../src/screens/CardDetailScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { applyRemoteFeatures } from '../../src/config/featureFlags';

// Exactly 550 characters — a representative AWS stem length (p50 270, max 550 per the brief).
const LONG_QUESTION = (
  'A company must design a resilient, cost-effective architecture on AWS that durably captures every incoming order during seasonal traffic spikes and processes each one asynchronously with the least operational overhead possible. '
).repeat(4).slice(0, 550);

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

async function renderScreen(cardId: string): Promise<renderer.ReactTestRenderer> {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <CardDetailScreen
        navigation={{ navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any}
        route={{ key: 'k', name: 'CardDetail', params: { cardId } } as any}
      />,
    );
  });
  await flush();
  return tree;
}

function questionBlockText(tree: renderer.ReactTestRenderer) {
  const nodes = tree.root.findAll((n) => (n.type as any) === 'View' && n.props.testID === 'card-detail-question');
  expect(nodes).toHaveLength(1);
  const texts = nodes[0].findAll((n) => (n.type as any) === 'Text');
  expect(texts).toHaveLength(1);
  return texts[0];
}

function heroBlob(tree: renderer.ReactTestRenderer): string {
  const hero = tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'card-detail-hero');
  expect(hero).toHaveLength(1);
  return hero[0]
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => String(n.props.children ?? ''))
    .join('\n');
}

function kindChipText(tree: renderer.ReactTestRenderer): string | null {
  const nodes = tree.root.findAll((n) => (n.type as any) === 'View' && n.props.testID === 'card-detail-kind-chip');
  if (nodes.length === 0) return null;
  return nodes[0]
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => String(n.props.children))
    .join('');
}

describe('CardDetailScreen MCQ hero chip', () => {
  afterEach(() => applyRemoteFeatures(null));

  it('shows the multiple-choice chip and never the options', async () => {
    ownedFixture = new Set(['one', 'two', 'qa']);

    const one = await renderScreen('one');
    expect(kindChipText(one)).toBe('Multiple choice');
    const oneBlob = textBlob(one);
    expect(oneBlob).toContain('Q one');
    for (const leak of ['Amazon SQS standard queue', 'Vertical scaling', 'Object Lock', 'Transfer Acceleration', 'WHY']) {
      expect(oneBlob).not.toContain(leak);
    }

    const two = await renderScreen('two');
    expect(kindChipText(two)).toBe('Multiple choice · pick 2');
    const twoBlob = textBlob(two);
    expect(twoBlob).toContain('Q two');
    for (const leak of ['Amazon SQS standard queue', 'Vertical scaling', 'Object Lock', 'Transfer Acceleration', 'WHY']) {
      expect(twoBlob).not.toContain(leak);
    }
  });

  it('hides the chip on Q/A, locked and kill-switched cards', async () => {
    ownedFixture = new Set(['one', 'two', 'qa']);
    const qa = await renderScreen('qa');
    expect(kindChipText(qa)).toBeNull();

    ownedFixture = new Set(['two']);
    const locked = await renderScreen('one');
    expect(kindChipText(locked)).toBeNull();
    expect(textBlob(locked)).toContain('Not in your collection');

    ownedFixture = new Set(['one', 'two', 'qa']);
    applyRemoteFeatures({ features: { mcq: { enabled: false } } });
    const killed = await renderScreen('one');
    expect(kindChipText(killed)).toBeNull();
    expect(textBlob(killed)).toContain('Q one');
  });
});

describe('CardDetailScreen full question', () => {
  afterEach(() => applyRemoteFeatures(null));

  it('renders a 550-character question in full below the hero', async () => {
    expect(LONG_QUESTION.length).toBe(550);
    const longDeck = {
      ...DECK,
      Cards: [{ StableUid: 'long', OrderInDeck: 1, Difficulty: 2, Question: LONG_QUESTION }],
    };
    // Persistent (not Once): the read now flows through deckCache, so the exact
    // number of resolveDeckBySlug reads is an implementation detail of the cache;
    // the deck returned is what matters and it is the same on every read.
    vi.mocked(resolveDeckBySlug).mockResolvedValue(longDeck as any);
    ownedFixture = new Set(['long']);

    const tree = await renderScreen('long');

    const block = questionBlockText(tree);
    expect(block.props.children).toBe(LONG_QUESTION);
    expect(block.props.numberOfLines).toBeUndefined();

    // The stem no longer lives inside the fixed, clipping hero.
    expect(heroBlob(tree)).not.toContain(LONG_QUESTION);
  });

  it('shows the locked title in the question block without leaking the question', async () => {
    const longDeck = {
      ...DECK,
      Cards: [{ StableUid: 'long', OrderInDeck: 1, Difficulty: 2, Question: LONG_QUESTION }],
    };
    // Persistent (not Once): the read now flows through deckCache, so the exact
    // number of resolveDeckBySlug reads is an implementation detail of the cache;
    // the deck returned is what matters and it is the same on every read.
    vi.mocked(resolveDeckBySlug).mockResolvedValue(longDeck as any);
    ownedFixture = new Set(); // non-null and does not hold 'long' → locked

    const tree = await renderScreen('long');

    expect(questionBlockText(tree).props.children).toBe('Not in your collection yet');
    expect(textBlob(tree)).not.toContain(LONG_QUESTION);
  });
});
