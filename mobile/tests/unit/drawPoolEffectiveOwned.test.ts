import { beforeEach, describe, expect, it, vi } from 'vitest';

// R25 G01: the draw pool is "cards missing from the collection the Library
// shows", i.e. resolveEffectiveOwned (drawState.owned + learned + open
// starter-lesson cards), not drawState.owned alone. Storage, review progress
// and the starter gate all stay real here: the claim is about how those three
// sources meet in a draw, and stubbing any of them would answer it for the code.
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
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) store.delete(key);
    }),
  },
}));

import type { CardProgress } from '../../src/review/model';
import { saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { commitDraw, flushDrawHistory, replayDraw } from '../../src/features/gacha/draw/drawCommit';
import { loadDrawHistory, loadDrawState, saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { loadDrawPoolOwned, loadDrawStatus } from '../../src/features/gacha/draw/drawPool';
import { ensureStarterLesson } from '../../src/features/gacha/starter/starterGate';

const SLUG = 'csharp';
const STAGE_KEY = 'recallsmith:onboarding:stage:v1';

type Card = { StableUid: string; Question: string; Difficulty: number; OrderInDeck: number };

function card(StableUid: string, OrderInDeck: number, Difficulty = 1): Card {
  return { StableUid, Question: `Question ${StableUid}`, Difficulty, OrderInDeck };
}

function deckOf(cards: Card[]): any {
  return {
    Slug: SLUG,
    Title: 'C# Basics',
    Locale: 'en',
    Version: '1',
    DeckType: 1,
    IsFreeStarter: true,
    TotalCards: cards.length,
    FreeCardCount: cards.length,
    Cards: cards,
  };
}

function learned(stableUid: string): CardProgress {
  return { stableUid, stage: 2, lastReviewedAt: 1_700_000_000_000, nextReviewAt: 1_700_086_400_000 };
}

function untouched(stableUid: string): CardProgress {
  return { stableUid, stage: 0, nextReviewAt: 0 };
}

describe('draw pool uses the effective owned set', () => {
  beforeEach(async () => {
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage(null);
  });

  it('never draws a card of the open starter lesson', async () => {
    // Six cards: the lesson takes the first five, so exactly one is drawable.
    const deck = deckOf([card('s1', 1), card('s2', 2), card('s3', 3), card('s4', 4), card('s5', 5), card('s6', 6)]);
    store.set(STAGE_KEY, 'starter');
    await ensureStarterLesson(deck);

    const result = await commitDraw(SLUG, 10, { deck });

    expect(result!.cards.map((c) => c.stableUid)).toEqual(['s6']);
    expect(result!.poolExhausted).toBe(true);
    // The starter cards are a read-time union only; the drawn card is the
    // only thing written to drawState.owned.
    expect((await loadDrawState(SLUG)).owned).toEqual(['s6']);
    expect(result!.ownedAfter).toBe(6);
    expect(result!.totalCards).toBe(6);
  });

  it('never draws a learned card, and still writes the drawn card to owned', async () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(`c${i + 1}`, i + 1));
    const deck = deckOf(cards);
    await saveDeckProgress(deck, [learned('c1'), learned('c2'), learned('c3'), untouched('c4')]);
    await saveDrawState(SLUG, { owned: ['c5'], pity: null });

    for (let i = 0; i < 20; i += 1) {
      const result = await commitDraw(SLUG, 1, { deck });
      if (result!.cards.length === 0) break;
      expect(['c1', 'c2', 'c3', 'c5']).not.toContain(result!.cards[0].stableUid);
    }

    const owned = new Set((await loadDrawState(SLUG)).owned);
    // Everything not learned ended up drawn: c4 (only scheduled, never
    // answered) and c6..c12, plus the pre-owned c5. The learned cards never
    // entered drawState.owned through a draw.
    expect([...owned].sort()).toEqual(['c10', 'c11', 'c12', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
  });

  it('pool size equals total minus effective owned', async () => {
    const cards = Array.from({ length: 30 }, (_, i) => card(`c${i + 1}`, i + 1));
    const deck = deckOf(cards);
    await saveDeckProgress(deck, [learned('c1'), learned('c2'), learned('c3')]);
    await saveDrawState(SLUG, { owned: ['c3', 'c4', 'c5'], pity: null });

    const effective = await loadDrawPoolOwned(SLUG);
    expect(effective.size).toBe(5);

    // Three ten-card draws: 10 + 10 + 5. The pool held exactly 30 - 5 cards.
    const first = await commitDraw(SLUG, 10, { deck });
    const second = await commitDraw(SLUG, 10, { deck });
    const third = await commitDraw(SLUG, 10, { deck });
    expect(first!.cards).toHaveLength(10);
    expect(second!.cards).toHaveLength(10);
    expect(third!.cards).toHaveLength(5);
    expect(third!.poolExhausted).toBe(true);
    expect(third!.ownedAfter).toBe(30);

    const after = await commitDraw(SLUG, 1, { deck });
    expect(after!.cards).toHaveLength(0);
    expect(after!.poolExhausted).toBe(true);
  });

  it('the rare guarantee only targets a Rare or better missing from the effective set', async () => {
    // The only LEG and the only RAR left by drawState.owned are both learned.
    // With the guarantee armed it must not hand either over; it has nothing
    // to target, so the slot is an ordinary common.
    const cards = [card('leg', 1, 3), card('rar', 2, 2), card('rar2', 3, 2), card('c1', 4), card('c2', 5), card('c3', 6)];
    const deck = deckOf(cards);
    await saveDeckProgress(deck, [learned('leg'), learned('rar')]);
    await saveDrawState(SLUG, { owned: ['rar2'], pity: { draws: 10, threshold: 10 } });

    const result = await commitDraw(SLUG, 1, { deck });

    expect(result!.cards).toHaveLength(1);
    expect(['c1', 'c2', 'c3']).toContain(result!.cards[0].stableUid);
    expect(result!.pityFiredFor).toBeNull();
  });

  it('the rare guarantee picks the missing Rare when the Legendary is learned', async () => {
    const cards = [card('leg', 1, 3), card('rar', 2, 2), card('c1', 3), card('c2', 4)];
    const deck = deckOf(cards);
    await saveDeckProgress(deck, [learned('leg')]);
    await saveDrawState(SLUG, { owned: [], pity: { draws: 10, threshold: 10 } });

    const result = await commitDraw(SLUG, 1, { deck });

    expect(result!.cards.map((c) => c.stableUid)).toEqual(['rar']);
    expect(result!.pityFiredFor).toBe('RAR');
  });

  it('records the effective set as ownedBefore so a replay is still the same draw', async () => {
    const cards = Array.from({ length: 8 }, (_, i) => card(`c${i + 1}`, i + 1));
    const deck = deckOf(cards);
    await saveDeckProgress(deck, [learned('c1'), learned('c2')]);

    const result = await commitDraw(SLUG, 1, { deck });
    await flushDrawHistory();

    const [entry] = await loadDrawHistory(SLUG);
    expect([...entry.ownedBefore].sort()).toEqual(['c1', 'c2']);
    const replay = replayDraw(entry, deck.Cards);
    expect(replay.matches).toBe(true);
    expect(replay.drawnUids).toEqual(result!.cards.map((c) => c.stableUid));
  });

  describe('loadDrawStatus (the Draw screen pack-complete state)', () => {
    it('reads pack complete when only learned cards were missing from drawState.owned', async () => {
      const cards = [card('c1', 1), card('c2', 2, 3), card('c3', 3)];
      const deck = deckOf(cards);
      await saveDeckProgress(deck, [learned('c2'), learned('c3')]);
      await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 4, threshold: 10 } });

      const status = await loadDrawStatus(SLUG, cards);

      expect(status.collectionComplete).toBe(true);
      // The only LEG is learned: nothing is left to guarantee, so no countdown.
      expect(status.pityLabel).toBe('');
    });

    it('reads pack complete while the starter lesson covers the rest', async () => {
      const cards = [card('s1', 1), card('s2', 2), card('s3', 3), card('s4', 4), card('s5', 5), card('s6', 6)];
      const deck = deckOf(cards);
      store.set(STAGE_KEY, 'starter');
      await ensureStarterLesson(deck);
      await saveDrawState(SLUG, { owned: ['s6'], pity: null });

      expect((await loadDrawStatus(SLUG, cards)).collectionComplete).toBe(true);
    });

    it('is not complete while one card is missing from the effective set', async () => {
      const cards = [card('c1', 1), card('c2', 2, 3), card('c3', 3)];
      const deck = deckOf(cards);
      await saveDeckProgress(deck, [learned('c3')]);
      await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 4, threshold: 10 } });

      const status = await loadDrawStatus(SLUG, cards);

      expect(status.collectionComplete).toBe(false);
      expect(status.pityLabel).toBe('A rare card is guaranteed within 6 cards');
      expect(status.pityThreshold).toBe(10);
    });

    it('an empty deck is never complete', async () => {
      expect((await loadDrawStatus(SLUG, [])).collectionComplete).toBe(false);
    });
  });
});
