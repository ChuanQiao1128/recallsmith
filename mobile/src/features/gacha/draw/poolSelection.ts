import type { CardProgress } from '../../../review/model';
import type { CardExport } from '../../../types/deckExport';
import { rarityOfCard } from './cardRarity';
import type { PityState } from './pity';

export type SelectionInput = {
  deckCards: CardExport[];
  ownedSet: Set<string>;
  progress: CardProgress[];
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
  const weighted: Weighted[] = missing.map((card) => ({ card, weight: 1.0 }));

  let pityFiredFor: 'LEG' | 'RAR' | null = null;
  let pityNext: PityState = pityState;
  const forcedCards: CardExport[] = [];

  if (pityState.draws >= pityState.threshold) {
    const missingLegendary = missing.find((card) => rarityOfCard(card) === 'LEG');
    if (missingLegendary) {
      forcedCards.push(missingLegendary);
      pityFiredFor = 'LEG';
      pityNext = { ...pityState, draws: 0 };
    } else {
      const missingRare = missing.find((card) => rarityOfCard(card) === 'RAR');
      if (missingRare) {
        forcedCards.push(missingRare);
        pityFiredFor = 'RAR';
        pityNext = { ...pityState, draws: 0 };
      }
    }
  }

  const forcedUids = new Set(forcedCards.map((card) => card.StableUid));
  const remaining: Weighted[] = weighted.filter((item) => !forcedUids.has(item.card.StableUid));

  const cards: CardExport[] = [...forcedCards];
  const slots = drawCount - forcedCards.length;
  let rngState = seed;

  function nextRandom(): number {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let value = rngState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  for (let index = 0; index < slots && remaining.length > 0; index += 1) {
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
    cards.push(remaining[pickedIndex].card);
    remaining.splice(pickedIndex, 1);
  }

  // The counter moves once per CALL, not once per card revealed, so the
  // threshold buys wildly different things depending on how the player pulls.
  // scripts/pity-simulation.ts (100k runs, 100-card deck of 70 COM/27 RAR/
  // 3 LEG, threshold 10) measured the cost of a first LEG:
  //   single-draw player: mean 9.46 cards, and never worse than 11 - the
  //                       guarantee is what ends almost every run.
  //   ten-draw  player:   mean 30 cards, p90 60, p99 80 - and the guarantee
  //                       never fires at all, because reaching 10 calls costs
  //                       110 cards and the whole deck is only 100. Its safety
  //                       net is deck exhaustion, not pity.
  // So the floor is not "10x worse" for ten-draw players, it is absent. Whether
  // to count per card or per call is a product decision and is left alone here;
  // this comment exists so the next reader inherits the number, not the guess.
  if (pityFiredFor === null) {
    const surfacedLegendary = cards.some((card) => rarityOfCard(card) === 'LEG');
    if (surfacedLegendary) {
      pityNext = { ...pityNext, draws: 0 };
    } else {
      // Cap at the threshold instead of incrementing forever. An all-commons
      // missing pool is the end state of every collection (once the last RAR
      // and LEG are owned, only commons are left to draw), and in that state
      // the guarantee block above can never fire, so the counter used to grow
      // without bound. That is not a cosmetic leak: buildPityProgressLabelV9
      // clamps `threshold - draws` at 0, so a player sitting at draws=57
      // reads "next draw guarantees a reveal" on every pull while nothing is
      // ever guaranteed. Capping keeps the counter armed rather than resetting
      // it, so the instant a RAR+ re-enters the pool (new deck version, or an
      // owned-set reset) the very next pull pays the guarantee out.
      pityNext = { ...pityNext, draws: Math.min(pityNext.draws + 1, pityNext.threshold) };
    }
  }

  return {
    cards,
    poolExhausted: cards.length < drawCount,
    pityNext,
    pityFiredFor,
  };
}
