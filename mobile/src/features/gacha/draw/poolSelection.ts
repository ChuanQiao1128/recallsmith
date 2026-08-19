import type { CardExport } from '../../../types/deckExport';
import { RARITY_RANK, rarityOfCard } from './cardRarity';
import type { PityState } from './pity';

// No `progress` field, deliberately. This input used to carry the
// caller's review history for the 3x previously-reviewed weighting
// described below; that weighting was deleted, the field was not, and
// it went on being loaded and passed for nothing. Keeping a parameter
// the function never reads is not free: it makes the type say gacha
// depends on review, which is the opposite of the rule we want
// (review may read owned; gacha never reads review), and the next
// person to add weighting would find the wire already run.
export type SelectionInput = {
  deckCards: CardExport[];
  ownedSet: Set<string>;
  drawCount: number;
  pityState: PityState;
  seed: number;
};

export type SelectionOutput = {
  cards: CardExport[];
  poolExhausted: boolean;
  pityNext: PityState;
  pityFiredFor: 'LEG' | 'RAR' | null;
};

export function selectDrawCards(input: SelectionInput): SelectionOutput {
  const { deckCards, ownedSet, drawCount, pityState, seed } = input;

  // Missing pool is deduplicated by StableUid, not just filtered. Nothing
  // between the deck export and this function enforces uid uniqueness, and
  // a duplicated uid used to let a single pull grant the same card twice:
  // the reveal ceremony shows two copies while the owned set (keyed by uid)
  // grows by one, so the player silently ends up a card short of the
  // drawCount they paid for. Found by the "never grants the same card twice"
  // property test, whose generator draws uids from a 6-value alphabet.
  const seenUids = new Set<string>();
  const missing: CardExport[] = [];
  for (const card of deckCards) {
    if (ownedSet.has(card.StableUid) || seenUids.has(card.StableUid)) continue;
    seenUids.add(card.StableUid);
    missing.push(card);
  }

  if (missing.length === 0) {
    return { cards: [], poolExhausted: true, pityNext: pityState, pityFiredFor: null };
  }

  // Pure uniform random from the missing pool — matches real gacha
  // collection mechanics. Previously this weighted by review history
  // (3× for previously-reviewed cards), which biased pulls toward cards
  // the user had already studied. That made the Library look like a
  // contiguous block at the front (#001-#005 always lit up first) —
  // unrealistic for a Pokedex collection game. The "spaced repetition"
  // reinforcement now lives only in study sessions, not in pulls.
  type Weighted = { card: CardExport; weight: number };
  // Drained in place as cards are dealt, so both the guaranteed pick and the
  // random pick draw from the same shrinking pool and no card can be dealt twice.
  const remaining: Weighted[] = missing.map((card) => ({ card, weight: 1.0 }));

  const cards: CardExport[] = [];
  let rngState = seed;

  function nextRandom(): number {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let value = rngState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  // Takes the highest-rarity card still in the pool, LEG before RAR, in deck
  // order. Returns null when only commons are left, which is the end state of
  // every collection and the one case where the guarantee cannot be honoured.
  function takeGuaranteed(): CardExport | null {
    let index = remaining.findIndex((item) => rarityOfCard(item.card) === 'LEG');
    if (index < 0) index = remaining.findIndex((item) => rarityOfCard(item.card) === 'RAR');
    if (index < 0) return null;
    return remaining.splice(index, 1)[0].card;
  }

  // The counter is per CARD REVEALED, not per call, and it resets on any RAR+
  // rather than on a LEG only. Read it as "how many commons in a row has the
  // player seen since the last rare or better". That is the unit the label
  // promises and the unit a player counts in, and it makes the guarantee say
  // one clean thing: while an unowned RAR+ is still in the pool, a run of
  // commons never gets longer than `threshold`.
  //
  // The previous rule advanced once per selectDrawCards call, so a ten-card
  // pull moved it by 1. scripts/pity-simulation.ts (100k runs, 100-card deck
  // of 70 COM/27 RAR/3 LEG, threshold 10) measured what that cost:
  //   before: single-draw mean 9.46 cards to a first LEG, never worse than 11;
  //           ten-draw mean 30 cards, p90 60, p99 80, and the guarantee never
  //           fired at all (10 calls = 110 cards, deck only holds 100), so its
  //           only safety net was deck exhaustion.
  //   after:  first LEG at mean 22.23 revealed cards single-draw vs 22.29
  //           ten-draw, a gap inside Monte Carlo noise, because the counter no
  //           longer knows or cares how cards were grouped into pulls. The
  //           script header carries the full before/after table, including the
  //           honest cost: resetting on RAR+ instead of LEG turns what was a
  //           hidden 10-pull LEG guarantee into the RAR+ one the label claims.
  // Firing mid-pull is what makes that true: the guarantee is checked before
  // every slot, so a ten-card pull that crosses the threshold at slot 7 gets
  // its RAR+ at slot 7, not on some later call.
  let pityDraws = pityState.draws;
  let pityFiredFor: 'LEG' | 'RAR' | null = null;

  for (let slot = 0; slot < drawCount && remaining.length > 0; slot += 1) {
    let picked: CardExport | null = null;

    if (pityDraws >= pityState.threshold) {
      picked = takeGuaranteed();
      if (picked !== null) {
        const firedRarity = rarityOfCard(picked) === 'LEG' ? 'LEG' : 'RAR';
        // Highest rarity wins when the guarantee pays out more than once in
        // one pull (only reachable when threshold < drawCount): the field
        // answers "what did the guarantee hand over", and a LEG is the answer
        // the player would point at.
        if (pityFiredFor === null || RARITY_RANK[firedRarity] > RARITY_RANK[pityFiredFor]) {
          pityFiredFor = firedRarity;
        }
      }
    }

    if (picked === null) {
      const totalWeight = remaining.reduce((sum, item) => sum + item.weight, 0);
      let roll = nextRandom() * totalWeight;
      let pickedIndex = 0;
      for (let weightIndex = 0; weightIndex < remaining.length; weightIndex += 1) {
        roll -= remaining[weightIndex].weight;
        if (roll <= 0) {
          pickedIndex = weightIndex;
          break;
        }
      }
      picked = remaining[pickedIndex].card;
      remaining.splice(pickedIndex, 1);
    }

    cards.push(picked);
    // Cap at the threshold instead of incrementing forever. Once the last RAR
    // and LEG are owned the guarantee can never fire, so an uncapped counter
    // would grow without bound. That is not a cosmetic leak:
    // buildPityProgressLabelV9 clamps `threshold - draws` at 0, so a player
    // sitting at draws=57 reads "next card guarantees a reveal" on every pull
    // while nothing is ever guaranteed. Capping keeps the counter armed rather
    // than resetting it, so the instant a RAR+ re-enters the pool (new deck
    // version, or an owned-set reset) the very next card pays the guarantee.
    pityDraws =
      rarityOfCard(picked) === 'COM' ? Math.min(pityDraws + 1, pityState.threshold) : 0;
  }

  return {
    cards,
    poolExhausted: cards.length < drawCount,
    pityNext: { ...pityState, draws: pityDraws },
    pityFiredFor,
  };
}
