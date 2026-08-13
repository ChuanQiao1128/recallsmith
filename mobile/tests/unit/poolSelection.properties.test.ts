// Property tests for the draw pool selector.
//
// The example tests in poolSelection.test.ts assert "input A yields B".
// These assert "for every input in the contract, this sentence holds",
// which is a different and stronger claim: the generators below ARE the
// executable version of what we believe a caller may hand us.
//
// Two generator choices are deliberate, not accidents:
//   - StableUid is drawn from a tiny alphabet, so duplicate uids inside
//     one deck happen constantly. The deck export *should* have unique
//     uids, but "should" is not enforced anywhere between the CDN and
//     this function, and a duplicate would silently hand the player the
//     same card twice in one pull.
//   - Decks made entirely of COM cards are allowed, because that is the
//     end state of every real collection: once the player owns every
//     RAR and LEG, the only thing left in the missing pool is commons.
//     That is precisely the state the pity counter has to survive.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CardExport } from '../../src/types/deckExport';
import { rarityOfCard } from '../../src/features/gacha/draw/cardRarity';
import { selectDrawCards } from '../../src/features/gacha/draw/poolSelection';
import type { PityState } from '../../src/features/gacha/draw/pity';

// Small alphabet on purpose: collisions are the point (see header).
const UID_ALPHABET = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];

const cardArb: fc.Arbitrary<CardExport> = fc
  .record({
    StableUid: fc.constantFrom(...UID_ALPHABET),
    Difficulty: fc.integer({ min: 1, max: 3 }),
    OrderInDeck: fc.integer({ min: 1, max: 50 }),
  })
  .map((raw) => ({
    StableUid: raw.StableUid,
    Question: `Q-${raw.StableUid}`,
    Difficulty: raw.Difficulty,
    OrderInDeck: raw.OrderInDeck,
  }));

// Only COM cards (Difficulty 1). Kept separate so the pity properties can
// hammer the "nothing left but commons" end state without waiting for the
// mixed generator to stumble into it.
const commonOnlyCardArb: fc.Arbitrary<CardExport> = fc
  .record({
    StableUid: fc.constantFrom(...UID_ALPHABET),
    OrderInDeck: fc.integer({ min: 1, max: 50 }),
  })
  .map((raw) => ({
    StableUid: raw.StableUid,
    Question: `Q-${raw.StableUid}`,
    Difficulty: 1,
    OrderInDeck: raw.OrderInDeck,
  }));

// A *valid* persisted pity record: normalizePityState guarantees
// draws >= 0 and threshold > 0, so the properties only have to hold on
// states the loader can actually produce.
const pityStateArb: fc.Arbitrary<PityState> = fc
  .integer({ min: 1, max: 12 })
  .chain((threshold) =>
    fc.integer({ min: 0, max: threshold }).map((draws) => ({ draws, threshold })),
  );

type Input = {
  deckCards: CardExport[];
  ownedSet: Set<string>;
  drawCount: number;
  pityState: PityState;
  seed: number;
};

function inputArb(cards: fc.Arbitrary<CardExport> = cardArb): fc.Arbitrary<Input> {
  return fc
    .record({
      deckCards: fc.array(cards, { minLength: 0, maxLength: 20 }),
      owned: fc.uniqueArray(fc.constantFrom(...UID_ALPHABET)),
      drawCount: fc.integer({ min: 1, max: 12 }),
      pityState: pityStateArb,
      seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    })
    .map((raw) => ({
      deckCards: raw.deckCards,
      ownedSet: new Set(raw.owned),
      drawCount: raw.drawCount,
      pityState: raw.pityState,
      seed: raw.seed,
    }));
}

function call(input: Input) {
  return selectDrawCards({ ...input, progress: [] });
}

// Mirrors the selector's own pool rule: unowned, deduplicated by uid,
// first entry wins. Properties have to be stated over *this* pool rather
// than over the raw deckCards array, because a deck that lists one uid
// twice with two different difficulties is self-contradictory and the
// selector has to pick one answer. First-wins is that answer.
function missingPool(input: Input): CardExport[] {
  const seen = new Set<string>();
  return input.deckCards.filter((card) => {
    if (input.ownedSet.has(card.StableUid) || seen.has(card.StableUid)) return false;
    seen.add(card.StableUid);
    return true;
  });
}

describe('poolSelection properties', () => {
  it('never grants the same card twice in one pull', () => {
    fc.assert(
      fc.property(inputArb(), (input) => {
        const { cards } = call(input);
        const uids = cards.map((card) => card.StableUid);
        expect(new Set(uids).size).toBe(uids.length);
      }),
    );
  });

  it('never grants a card the player already owns', () => {
    fc.assert(
      fc.property(inputArb(), (input) => {
        const { cards } = call(input);
        for (const card of cards) {
          expect(input.ownedSet.has(card.StableUid)).toBe(false);
        }
      }),
    );
  });

  it('conserves count: output size is exactly min(drawCount, distinct missing)', () => {
    fc.assert(
      fc.property(inputArb(), (input) => {
        const result = call(input);
        const expected = Math.min(input.drawCount, missingPool(input).length);
        expect(result.cards.length).toBe(expected);
        expect(result.poolExhausted).toBe(result.cards.length < input.drawCount);
      }),
    );
  });

  it('is deterministic: same input yields a deeply equal result', () => {
    fc.assert(
      fc.property(inputArb(), (input) => {
        expect(call(input)).toEqual(call(input));
      }),
    );
  });

  it('keeps the pity counter inside its domain (0, held, or +1, never past threshold)', () => {
    // Domain closure is what makes the label honest: buildPityProgressLabelV9
    // renders `threshold - draws` and clamps at 0, so a counter that runs
    // past the threshold shows "guaranteed" forever while nothing changes.
    fc.assert(
      fc.property(inputArb(), (input) => {
        const { pityNext } = call(input);
        expect(pityNext.threshold).toBe(input.pityState.threshold);
        expect([0, input.pityState.draws, input.pityState.draws + 1]).toContain(pityNext.draws);
        expect(pityNext.draws).toBeLessThanOrEqual(pityNext.threshold);
      }),
    );
  });

  it('keeps the pity counter bounded on an all-commons pool', () => {
    // The end-state stress case: a deck with no RAR/LEG left can never fire
    // pity, so the counter takes the "+1" branch on every single pull.
    fc.assert(
      fc.property(inputArb(commonOnlyCardArb), (input) => {
        let state = input.pityState;
        for (let pull = 0; pull < 40; pull += 1) {
          state = call({ ...input, pityState: state }).pityNext;
          expect(state.draws).toBeLessThanOrEqual(state.threshold);
        }
      }),
    );
  });

  it('honours the pity promise: at threshold with a RAR+ in the pool, one is granted', () => {
    fc.assert(
      fc.property(inputArb(), (input) => {
        const atThreshold = {
          ...input,
          pityState: { ...input.pityState, draws: input.pityState.threshold },
        };
        const missingRarePlus = missingPool(atThreshold).some(
          (card) => rarityOfCard(card) !== 'COM',
        );
        fc.pre(missingRarePlus);

        const result = call(atThreshold);
        expect(result.pityFiredFor).not.toBeNull();
        expect(result.cards.some((card) => rarityOfCard(card) !== 'COM')).toBe(true);
        expect(result.pityNext.draws).toBe(0);
      }),
    );
  });
});
