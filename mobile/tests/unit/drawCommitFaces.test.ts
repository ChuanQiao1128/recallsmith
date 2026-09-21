import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

const SLUG = 'csharp';
const SCOPE = 'devcards:u:anon:';

// PG-ordered blobs (v, options[{key, why, text, correct}], shuffle, qualifier),
// copied from plan §4.3 (docs/mcq-card-type-plan-2026-09-18.md:177-253) — the only
// MCQ text a fixture may quote. Card 1: b correct (why null), a/c/d wrong. Card 2:
// a/c correct (why null), b/d/e wrong.
const PLAN_CARD_1_MCQ = {
  v: 1,
  options: [
    {
      key: 'a',
      why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.',
      text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.',
      correct: false,
    },
    {
      key: 'b',
      why: null,
      text: 'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.',
      correct: true,
    },
    {
      key: 'c',
      why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.',
      text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.',
      correct: false,
    },
    {
      key: 'd',
      why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.',
      text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.',
      correct: false,
    },
  ],
  shuffle: true,
  qualifier: 'LEAST operational overhead',
};

const PLAN_CARD_2_MCQ = {
  v: 1,
  options: [
    {
      key: 'a',
      why: null,
      text: 'Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.',
      correct: true,
    },
    {
      key: 'b',
      why: 'Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.',
      text: 'Enable S3 Transfer Acceleration on the source bucket.',
      correct: false,
    },
    {
      key: 'c',
      why: null,
      text: 'Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.',
      correct: true,
    },
    {
      key: 'd',
      why: 'A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.',
      text: 'Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.',
      correct: false,
    },
    {
      key: 'e',
      why: "MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.",
      text: 'Enable MFA Delete on the source bucket.',
      correct: false,
    },
  ],
  shuffle: true,
  qualifier: null,
};

const deckCards = [
  { StableUid: 'c1', Question: 'Q1', Difficulty: 1, OrderInDeck: 1, Topic: 'IAM' },
  { StableUid: 'c2', Question: 'Q2', Difficulty: 2, OrderInDeck: 2, Topic: 'Compute', Mcq: PLAN_CARD_1_MCQ },
  { StableUid: 'c3', Question: 'Q3', Difficulty: 3, OrderInDeck: 3, Mcq: PLAN_CARD_2_MCQ },
  { StableUid: 'c4', Question: 'Q4', Difficulty: 1, OrderInDeck: 4, Topic: '   ', Mcq: { v: 2 } },
];

const deck = {
  Slug: SLUG,
  Title: 'C# Basics',
  Locale: 'en',
  Version: '1',
  DeckType: 1,
  IsFreeStarter: true,
  TotalCards: deckCards.length,
  FreeCardCount: deckCards.length,
  Cards: deckCards,
};

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async (slug: string) => (slug === SLUG ? deck : null)),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  getUserScopedKey: vi.fn(async (baseKey: string) => `${SCOPE}${baseKey}`),
}));

import { commitDraw, type DrawnCardVm } from '../../src/features/gacha/draw/drawCommit';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { applyRemoteFeatures } from '../../src/config/featureFlags';

const STATE_KEY = `${SCOPE}devcards:draw-state:${SLUG}`;

function byUid(cards: DrawnCardVm[]): Record<string, DrawnCardVm> {
  const out: Record<string, DrawnCardVm> = {};
  for (const card of cards) out[card.stableUid] = card;
  return out;
}

describe('drawCommit MCQ faces', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
    store.set(STATE_KEY, JSON.stringify({ owned: [], pity: { draws: 0, threshold: 10 } }));
  });

  afterEach(() => applyRemoteFeatures(null));

  it('tags drawn cards with topic and kind', async () => {
    const result = await commitDraw(SLUG, 10);
    expect(result).not.toBeNull();
    const cards = result!.cards;
    const { c1, c2, c3, c4 } = byUid(cards);

    expect(c1.tag).toBe('IAM');
    expect('kind' in c1).toBe(false);
    expect('requiredCount' in c1).toBe(false);

    expect(c2.tag).toBe('Compute');
    expect(c2.kind).toBe('mcq');
    expect(c2.requiredCount).toBe(1);
    expect(Object.keys(c2)).toEqual([
      'stableUid',
      'question',
      'difficulty',
      'rarity',
      'rank',
      'tag',
      'kind',
      'requiredCount',
    ]);

    expect('tag' in c3).toBe(false);
    expect(c3.kind).toBe('mcq');
    expect(c3.requiredCount).toBe(2);

    expect('tag' in c4).toBe(false);
    expect('kind' in c4).toBe(false);

    for (const card of cards) {
      expect('options' in card).toBe(false);
      expect('Mcq' in card).toBe(false);
      expect('why' in card).toBe(false);
      expect('qualifier' in card).toBe(false);
    }
  });

  it('drops the kind under the kill switch and keeps the tag', async () => {
    applyRemoteFeatures({ features: { mcq: { enabled: false } } });
    const result = await commitDraw(SLUG, 10);
    expect(result).not.toBeNull();
    const { c2, c3 } = byUid(result!.cards);

    expect(c2.tag).toBe('Compute');
    expect('kind' in c2).toBe(false);
    expect('requiredCount' in c2).toBe(false);
    expect('kind' in c3).toBe(false);
  });
});
