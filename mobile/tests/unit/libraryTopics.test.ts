import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildLibraryVM, buildLibraryCardRows } from '../../src/features/gacha/library/libraryMapper';
import {
  normalizeTopic,
  topicKey,
  UNTAGGED_TOPIC_KEY,
  UNTAGGED_TOPIC_LABEL,
} from '../../src/features/gacha/library/topics';

const NOW = new Date('2026-04-23T12:00:00.000Z');

const deck = {
  Slug: 'aws',
  Title: 'AWS',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 5,
  Cards: [
    { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Topic: 'IAM' },
    { StableUid: '2', OrderInDeck: 2, Difficulty: 2, Question: 'Q2', Topic: 'Compute / EC2' },
    { StableUid: '3', OrderInDeck: 3, Difficulty: 3, Question: 'Q3' },
    { StableUid: '4', OrderInDeck: 4, Difficulty: 2, Question: 'Q4', Topic: ' IAM ' },
    { StableUid: '5', OrderInDeck: 5, Difficulty: 1, Question: 'Q5', Topic: '' },
  ],
} as any;

const plainDeck = {
  Slug: 'plain',
  Title: 'Plain',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 5,
  Cards: [
    { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' },
    { StableUid: '2', OrderInDeck: 2, Difficulty: 2, Question: 'Q2' },
    { StableUid: '3', OrderInDeck: 3, Difficulty: 3, Question: 'Q3' },
    { StableUid: '4', OrderInDeck: 4, Difficulty: 2, Question: 'Q4' },
    { StableUid: '5', OrderInDeck: 5, Difficulty: 1, Question: 'Q5' },
  ],
} as any;

const uid = (row: { stableUid: string }) => row.stableUid;
const key = (chip: { key: string }) => chip.key;

// fast-check deck builder: a topic array (null = untagged, key omitted) → a deck.
const topicArb = fc.array(fc.option(fc.constantFrom('IAM', 'S3', 'EC2', 'All', '???', ' iam '), { nil: null }), {
  maxLength: 30,
});
function deckFromTopics(topics: (string | null)[]) {
  return {
    Slug: 'p',
    Title: 'P',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: topics.length,
    Cards: topics.map((t, i) => {
      const card: any = { StableUid: `u${i}`, OrderInDeck: i + 1, Difficulty: 1 + (i % 3), Question: `Q${i}` };
      if (t !== null) card.Topic = t;
      return card;
    }),
  } as any;
}
const groupKeyOfRow = (row: { topic: string | null }): string =>
  row.topic === null ? UNTAGGED_TOPIC_KEY : topicKey(row.topic);

describe('library topics', () => {
  it('normalizes topics: trims, maps blank and non-strings to null', () => {
    expect(normalizeTopic(' IAM ')).toBe('IAM');
    expect(normalizeTopic('')).toBe(null);
    expect(normalizeTopic('   ')).toBe(null);
    expect(normalizeTopic(null)).toBe(null);
    expect(normalizeTopic(undefined)).toBe(null);
    expect(normalizeTopic(7)).toBe(null);
    expect(normalizeTopic(['x'])).toBe(null);
  });

  it('derives stable chip keys and sidesteps the reserved keys', () => {
    expect(topicKey('IAM & S3')).toBe('iam-s3');
    expect(topicKey('Compute / EC2')).toBe('compute-ec2');
    expect(topicKey('IAM')).toBe('iam');
    expect(topicKey('All')).toBe('t-all');
    expect(topicKey('Untagged')).toBe('t-untagged');
    expect(topicKey('???')).toBe('t-');
    expect(UNTAGGED_TOPIC_KEY).toBe('untagged');
    expect(UNTAGGED_TOPIC_LABEL).toBe('Untagged');
  });

  it('exposes no topic chips and keeps deck order for a deck without topics', () => {
    const vm = buildLibraryVM({ deck: plainDeck, progress: [], now: NOW });
    expect(vm.topics).toEqual([]);
    expect(vm.topicFilter).toBe(null);
    expect(vm.cards.map(uid)).toEqual(['1', '2', '3', '4', '5']);
    expect(vm.cards.every((row) => row.topic === null)).toBe(true);
    const filtered = buildLibraryVM({ deck: plainDeck, progress: [], now: NOW, topicFilter: 'iam' });
    expect(filtered.cards.map(uid)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('lists All, each topic in first-seen deck order, then Untagged', () => {
    const vm = buildLibraryVM({ deck, progress: [], now: NOW });
    expect(vm.topics.map(key)).toEqual(['all', 'iam', 'compute-ec2', 'untagged']);
    expect(vm.topics.map((chip) => chip.label)).toEqual(['All', 'IAM', 'Compute / EC2', 'Untagged']);
    expect(vm.topics.map((chip) => chip.count)).toEqual([5, 2, 1, 2]);
  });

  it('orders cards by topic group then orderInDeck when any topic exists', () => {
    const vm = buildLibraryVM({ deck, progress: [], now: NOW });
    expect(vm.cards.map(uid)).toEqual(['1', '4', '2', '3', '5']);
    expect(vm.filters.map(key)).toEqual(['all', 'new', 'learning', 'mastered', 'rare', 'legendary']);
  });

  it('keeps only the selected group and treats an unknown key as All', () => {
    const iam = buildLibraryVM({ deck, progress: [], now: NOW, topicFilter: 'iam' });
    expect(iam.cards.map(uid)).toEqual(['1', '4']);
    expect(iam.topicFilter).toBe('iam');

    const untagged = buildLibraryVM({ deck, progress: [], now: NOW, topicFilter: 'untagged' });
    expect(untagged.cards.map(uid)).toEqual(['3', '5']);

    const all = buildLibraryVM({ deck, progress: [], now: NOW, topicFilter: 'all' });
    expect(all.cards.map(uid)).toEqual(['1', '4', '2', '3', '5']);
    expect(all.topicFilter).toBe(null);

    const nope = buildLibraryVM({ deck, progress: [], now: NOW, topicFilter: 'nope' });
    expect(nope.cards.map(uid)).toEqual(['1', '4', '2', '3', '5']);
    expect(nope.topicFilter).toBe(null);
  });

  it('composes the topic filter with the status filter', () => {
    const rareIam = buildLibraryVM({ deck, progress: [], now: NOW, filter: 'rare', topicFilter: 'iam' });
    expect(rareIam.cards.map(uid)).toEqual(['4']);

    const rareAll = buildLibraryVM({ deck, progress: [], now: NOW, filter: 'rare' });
    expect(rareAll.cards.map(uid)).toEqual(['4', '2']);
  });

  it('appends topic last on every row and the two new keys last on the VM', () => {
    const rows = buildLibraryCardRows({ deck, progress: [], now: NOW });
    const rowKeys = Object.keys(rows[0]);
    expect(rowKeys.length).toBe(13);
    expect(rowKeys.slice(-2)).toEqual(['isUpdated', 'topic']);

    const vm = buildLibraryVM({ deck, progress: [], now: NOW });
    expect(Object.keys(vm)).toEqual([
      'title',
      'subtitle',
      'drawStatusLabel',
      'counts',
      'decks',
      'selectedDeckSlug',
      'filter',
      'filters',
      'cards',
      'topics',
      'topicFilter',
    ]);
  });

  it('keeps every row, groups in chip order and orders each group by orderInDeck (property)', () => {
    fc.assert(
      fc.property(topicArb, (topics) => {
        const d = deckFromTopics(topics);
        const rows = buildLibraryCardRows({ deck: d, progress: [], now: NOW });
        const vm = buildLibraryVM({ deck: d, progress: [], now: NOW });

        // Same uid multiset (a topic filter is not applied here).
        expect(vm.cards.map(uid).sort()).toEqual(rows.map(uid).sort());

        const hasTopics = rows.some((row) => row.topic !== null);
        if (!hasTopics) {
          expect(vm.topics).toEqual([]);
          expect(vm.cards.map((row) => row.orderInDeck)).toEqual(rows.map((row) => row.orderInDeck));
          return;
        }

        // Non-'all' chip counts cover every row exactly once.
        const covered = vm.topics.filter((chip) => chip.key !== 'all').reduce((sum, chip) => sum + chip.count, 0);
        expect(covered).toBe(rows.length);

        const chipIndex = new Map(vm.topics.map((chip, index) => [chip.key, index]));
        for (let i = 1; i < vm.cards.length; i++) {
          const prev = vm.cards[i - 1];
          const curr = vm.cards[i];
          const prevIdx = chipIndex.get(groupKeyOfRow(prev))!;
          const currIdx = chipIndex.get(groupKeyOfRow(curr))!;
          expect(currIdx).toBeGreaterThanOrEqual(prevIdx);
          if (currIdx === prevIdx) {
            expect(curr.orderInDeck).toBeGreaterThan(prev.orderInDeck);
          }
        }
      }),
    );
  });

  it('filters each chip down to exactly its group (property)', () => {
    fc.assert(
      fc.property(topicArb, (topics) => {
        const d = deckFromTopics(topics);
        const rows = buildLibraryCardRows({ deck: d, progress: [], now: NOW });
        const vm = buildLibraryVM({ deck: d, progress: [], now: NOW });

        for (const chip of vm.topics) {
          if (chip.key === 'all') continue;
          const filtered = buildLibraryVM({ deck: d, progress: [], now: NOW, topicFilter: chip.key });
          const expected = rows
            .filter((row) => groupKeyOfRow(row) === chip.key)
            .sort((a, b) => a.orderInDeck - b.orderInDeck)
            .map(uid);
          expect(filtered.cards.map(uid)).toEqual(expected);
          expect(filtered.cards.length).toBe(chip.count);
        }
      }),
    );
  });
});
