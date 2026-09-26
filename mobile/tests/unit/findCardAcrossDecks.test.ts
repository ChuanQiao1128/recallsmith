import { describe, expect, it, vi } from 'vitest';

import { findCardAcrossDecks } from '../../src/features/gacha/library/findCardAcrossDecks';
import type { CardExport, DeckExport } from '../../src/types/deckExport';

function card(uid: string): CardExport {
  return { StableUid: uid, Question: `Q ${uid}`, Difficulty: 1, OrderInDeck: 1 };
}

function deck(slug: string, uids: string[]): DeckExport {
  return {
    Slug: slug,
    Title: slug,
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    IsFreeStarter: true,
    TotalCards: uids.length,
    FreeCardCount: uids.length,
    Cards: uids.map(card),
  };
}

const DECKS: Record<string, DeckExport> = {
  active: deck('active', ['a1', 'a2']),
  other: deck('other', ['b1', 'b2']),
  third: deck('third', ['c1']),
};

function deps(overrides: Partial<Parameters<typeof findCardAcrossDecks>[1]> = {}) {
  return {
    activeSlug: 'active',
    listSlugs: vi.fn(async () => ['active', 'other', 'third']),
    loadDeck: vi.fn(async (slug: string) => DECKS[slug] ?? null),
    ...overrides,
  };
}

describe('findCardAcrossDecks', () => {
  it('finds the card in the active deck first', async () => {
    const d = deps();
    const found = await findCardAcrossDecks('a2', d);
    expect(found?.deck.Slug).toBe('active');
    expect(found?.card.StableUid).toBe('a2');
    // The active deck answered, so no other deck was loaded.
    expect(d.loadDeck).toHaveBeenCalledTimes(1);
    expect(d.loadDeck).toHaveBeenCalledWith('active');
    expect(d.listSlugs).not.toHaveBeenCalled();
  });

  it('falls back to other installed decks', async () => {
    const d = deps();
    const found = await findCardAcrossDecks('c1', d);
    expect(found?.deck.Slug).toBe('third');
    expect(found?.card.StableUid).toBe('c1');
    // The active slug is not re-loaded when it reappears in listSlugs.
    const loadedSlugs = vi.mocked(d.loadDeck).mock.calls.map((c) => c[0]);
    expect(loadedSlugs).toEqual(['active', 'other', 'third']);
  });

  it('returns null when no installed deck holds the card', async () => {
    const d = deps();
    expect(await findCardAcrossDecks('missing', d)).toBeNull();

    // A rejected listSlugs counts as no other decks (active still tried).
    const rejects = deps({ listSlugs: vi.fn(async () => { throw new Error('nope'); }) });
    expect(await findCardAcrossDecks('b1', rejects)).toBeNull();

    // A null activeSlug just skips straight to the installed list.
    const noActive = deps({ activeSlug: null });
    const found = await findCardAcrossDecks('b1', noActive);
    expect(found?.deck.Slug).toBe('other');
  });
});
