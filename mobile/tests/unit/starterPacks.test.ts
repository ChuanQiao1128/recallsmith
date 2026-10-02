import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// starterGate imports AsyncStorage at module scope; pickStarterUids itself never touches storage.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { STARTER_LESSON_SIZE, pickStarterUids } from '../../src/features/gacha/starter/starterGate';
import { normalizeMcq } from '../../src/features/gacha/mcq/normalizeMcq';
import { STARTER_BUILD, STARTER_PACKS, type StarterPackCard } from '../../src/content/starter';

// Contract R24-00 §2.1: the three goal decks a fresh install can start offline.
const SLUGS = ['aws-saa-c03', 'claude-ccdv-f', 'csharp-basics'] as const;
const STARTER_DIR = resolve(__dirname, '../../src/content/starter');
const MAX_TOTAL_BYTES = 300 * 1024;
const MIN_CARDS = 30;

// pickStarterUids reads the app's mapped shape (deckRepository maps the flat file to PascalCase).
function asLessonCards(cards: ReadonlyArray<StarterPackCard>) {
  return cards.map((c) => ({ StableUid: c.stableUid, OrderInDeck: c.orderInDeck, Mcq: c.mcq }));
}

function readPackFile(slug: string): unknown {
  return JSON.parse(readFileSync(resolve(STARTER_DIR, `${slug}.starter.json`), 'utf8'));
}

describe('bundled starter packs (R24 §2.1)', () => {
  it('ships exactly the three goal decks', () => {
    expect(Object.keys(STARTER_PACKS).sort()).toEqual([...SLUGS].sort());
    expect(Object.keys(STARTER_BUILD).sort()).toEqual([...SLUGS].sort());
  });

  it('keeps the three files under 300 KB combined', () => {
    const total = SLUGS.reduce((sum, slug) => sum + statSync(resolve(STARTER_DIR, `${slug}.starter.json`)).size, 0);
    expect(total).toBeLessThan(MAX_TOTAL_BYTES);
  });

  describe.each(SLUGS)('%s', (slug) => {
    const pack = STARTER_PACKS[slug];

    it('parses as the flat deck shape and matches the bundled module', () => {
      const raw = readPackFile(slug) as Record<string, unknown>;
      expect(raw).toEqual(pack);
      expect(pack.slug).toBe(slug);
      expect(typeof pack.title).toBe('string');
      expect(pack.title.length).toBeGreaterThan(0);
      expect(typeof pack.locale).toBe('string');
      expect(pack.deckType).toBe(1);
      expect(Array.isArray(pack.cards)).toBe(true);
    });

    it('carries a "<buildId>-starter" version that is not a live buildId', () => {
      expect(pack.version.endsWith('-starter')).toBe(true);
      expect(pack.version).toBe(`${STARTER_BUILD[slug]}-starter`);
      expect(STARTER_BUILD[slug]).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]+$/);
      // The temp install file name uses the version raw.
      expect(pack.version).not.toContain('/');
    });

    it('is a prefix: at least 30 cards, totalCards is the full deck count', () => {
      expect(pack.cards.length).toBeGreaterThanOrEqual(MIN_CARDS);
      expect(Number.isInteger(pack.totalCards)).toBe(true);
      expect(pack.totalCards).toBeGreaterThanOrEqual(pack.cards.length);
    });

    it('keeps the cards in strictly ascending orderInDeck (one contiguous prefix, no gaps re-ordered)', () => {
      const orders = pack.cards.map((c) => c.orderInDeck);
      for (const order of orders) expect(Number.isInteger(order)).toBe(true);
      for (let i = 1; i < orders.length; i += 1) expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    });

    it('gives every card a unique non-empty stableUid and the verbatim card fields', () => {
      const uids = pack.cards.map((c) => c.stableUid);
      for (const uid of uids) {
        expect(typeof uid).toBe('string');
        expect(uid.length).toBeGreaterThan(0);
      }
      expect(new Set(uids).size).toBe(uids.length);
      for (const card of pack.cards) {
        expect(typeof card.question).toBe('string');
        expect(typeof card.explanation).toBe('string');
        expect(Number.isInteger(card.revision)).toBe(true);
        expect(Number.isInteger(card.difficulty)).toBe(true);
      }
    });

    it('holds at least five non-MCQ cards', () => {
      const nonMcq = pack.cards.filter((c) => normalizeMcq(c.mcq) === null);
      expect(nonMcq.length).toBeGreaterThanOrEqual(STARTER_LESSON_SIZE);
    });

    it('picks the same starter lesson as the full deck would (the answer is settled inside the pack)', () => {
      const cards = asLessonCards(pack.cards);
      const picked = pickStarterUids(cards);
      expect(picked).toHaveLength(STARTER_LESSON_SIZE);

      // The prefix through the 5th non-MCQ card is where the lesson is decided; any longer prefix,
      // the pack itself, and so the full deck (a longer prefix still) give the same uids.
      const fifth = pack.cards.findIndex((c) => c.stableUid === picked[STARTER_LESSON_SIZE - 1]);
      expect(fifth).toBeGreaterThanOrEqual(0);
      const lessonPrefix = cards.slice(0, fifth + 1);
      expect(pickStarterUids(lessonPrefix)).toEqual(picked);
      for (let end = fifth + 1; end <= cards.length; end += 1) {
        expect(pickStarterUids(cards.slice(0, end))).toEqual(picked);
      }
    });
  });
});
