import type { CardExport } from '../../../types/deckExport';
import { rarityOfCard } from './cardRarity';
import {
  appendDrawHistory,
  loadDrawState,
  saveDrawState,
  type DrawHistoryEntry,
} from './drawStateStore';
import { normalizePityState } from './pity';
import { selectDrawCards } from './poolSelection';
import { rankCardsByOrder } from '../library/cardRank';

export type DrawnCardVm = {
  stableUid: string;
  question: string;
  difficulty: number;
  rarity: 'COM' | 'RAR' | 'LEG';
  /** 1-based position in the deck (cardRank.ts) — what DrawResult prints as "No. 011 / 441". */
  rank: number;
};

export type DrawCommitResult = {
  cards: DrawnCardVm[];
  poolExhausted: boolean;
  pityFiredFor: 'LEG' | 'RAR' | null;
  highlightedRarity: 'RAR' | 'LEG' | null;
  ownedAfter: number;
  totalCards: number;
  pityBefore: number;
  pityAfter: number;
};

function buildDrawId(slug: string, ts: number, seed: number): string {
  return `${slug}:${ts}:${seed >>> 0}`;
}

export async function commitDraw(slug: string, drawCount: 1 | 10): Promise<DrawCommitResult | null> {
  // review/storage is deliberately absent from this import. A draw used
  // to load the deck's review progress and hand it to selectDrawCards,
  // which stopped reading it when the review-history weighting was
  // deleted. The load stayed: a storage round-trip on every pull whose
  // result was discarded, and a dependency edge from gacha to review
  // that nothing justified. The direction is now one-way by
  // construction -- review may read the owned set, gacha never reads
  // review -- which is what lets the two be reasoned about separately.
  const { resolveDeckBySlug } = await import('../../../content/deckRepository');
  const deck = await resolveDeckBySlug(slug);
  if (!deck) return null;

  const drawState = await loadDrawState(slug);
  const ownedSet = new Set(drawState.owned);
  const pityState = normalizePityState(drawState.pity);

  // Same value for both fields today: the RNG is seeded from the clock.
  // They are recorded separately because they answer different questions
  // ("which pull was this" vs "what drove the shuffle"), and a future
  // seed source must not silently take the timestamp's meaning with it.
  const ts = Date.now();
  const seed = ts;

  const selection = selectDrawCards({
    deckCards: deck.Cards,
    ownedSet,
    drawCount,
    pityState,
    seed,
  });

  const drawnUids = selection.cards.map((card) => card.StableUid);
  const ownedAfterSet = new Set(ownedSet);
  for (const stableUid of drawnUids) {
    ownedAfterSet.add(stableUid);
  }

  // The whole commit is one write. Owned and pity used to be two
  // independent setItem calls; being killed between them left a card
  // granted that never counted toward pity (or the reverse), and nothing
  // on disk could tell us which half to trust.
  await saveDrawState(slug, {
    owned: [...ownedAfterSet],
    pity: selection.pityNext,
  });

  // After the commit, never before: a history entry that outlives a
  // failed commit would describe a draw that did not happen.
  await appendDrawHistory(slug, {
    drawId: buildDrawId(slug, ts, seed),
    slug,
    seed,
    drawCount,
    ownedBefore: [...ownedSet],
    pityBefore: pityState,
    drawnUids,
    ts,
  });

  const ranks = rankCardsByOrder(deck.Cards);
  const cards: DrawnCardVm[] = selection.cards.map((card) => ({
    stableUid: card.StableUid,
    question: card.Question,
    difficulty: card.Difficulty,
    rarity: rarityOfCard(card),
    rank: ranks.get(card.StableUid) ?? 0,
  }));

  let highlightedRarity: 'RAR' | 'LEG' | null = null;
  for (const card of cards) {
    if (card.rarity === 'LEG') {
      highlightedRarity = 'LEG';
      break;
    }
    if (card.rarity === 'RAR') {
      highlightedRarity = 'RAR';
    }
  }

  return {
    cards,
    poolExhausted: selection.poolExhausted,
    pityFiredFor: selection.pityFiredFor,
    highlightedRarity,
    ownedAfter: ownedAfterSet.size,
    totalCards: deck.Cards.length,
    pityBefore: pityState.draws,
    pityAfter: selection.pityNext.draws,
  };
}

export type DrawReplayResult = {
  drawnUids: string[];
  matches: boolean;
};

/**
 * Re-runs a recorded draw from its persisted inputs.
 *
 * A seed passed as a parameter only buys testability: it lets us pin an
 * outcome in a test we wrote. Reproducibility is a different property and
 * it costs a write: only because the seed and the inputs it was applied
 * to are on disk can we answer "why did this user get these cards" months
 * later. Pure on purpose, so replaying a complaint never touches storage
 * or mutates the state being investigated.
 *
 * The deck is passed in rather than stored in the record: card bodies are
 * large and already versioned elsewhere. The consequence is honest -- a
 * replay against a different deck revision is not the same draw, and a
 * mismatch there means the content changed, not that the RNG did.
 *
 * What makes a replay possible at all is that every input to a draw is
 * either in the record or in the deck. Selection is uniform over the
 * missing pool and reads no review history, so nothing about the user's
 * study state has to be recorded. If weighting by review history ever
 * comes back, that state joins DrawHistoryEntry in the same change or
 * replay quietly stops being a replay.
 */
export function replayDraw(record: DrawHistoryEntry, deckCards: CardExport[]): DrawReplayResult {
  const selection = selectDrawCards({
    deckCards,
    ownedSet: new Set(record.ownedBefore),
    drawCount: record.drawCount,
    pityState: record.pityBefore,
    seed: record.seed,
  });

  const drawnUids = selection.cards.map((card) => card.StableUid);
  const matches =
    drawnUids.length === record.drawnUids.length &&
    drawnUids.every((uid, index) => uid === record.drawnUids[index]);

  return { drawnUids, matches };
}
