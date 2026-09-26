import type { CardExport, DeckExport } from '../../../types/deckExport';
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
import { getFeatureFlags } from '../../../config/featureFlags';
import { mcqRequiredCount, resolveMcq } from '../mcq/normalizeMcq';
import { normalizeTopic } from '../library/topics';

export type DrawnCardVm = {
  stableUid: string;
  question: string;
  difficulty: number;
  rarity: 'COM' | 'RAR' | 'LEG';
  /** 1-based position in the deck (cardRank.ts) — what DrawResult prints as "No. 011 / 441". */
  rank: number;
  /** C07 topic label (normalizeTopic(card.Topic)); the key is ABSENT when the card has no topic. DrawResult renders it as the featured topic chip. */
  tag?: string;
  /** Present only when the card is MCQ under the flags read at commit time (D00 §2.6.1); DrawResult renders the "MC · pick n" mark. No option ever travels here. */
  kind?: 'mcq';
  requiredCount?: number;
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

export type CommitDrawOptions = {
  // The deck the caller already holds. When it is for this slug it is used as
  // is; DrawScreen loads and renders it before the pull, so re-reading and
  // re-parsing the file inside every commit (~13 KB+ for the large decks) only
  // added latency in the window right before the ceremony mounts. A null,
  // mismatched, or Cards-less value falls back to the dynamic-import resolve.
  deck?: DeckExport | null;
};

// Draw history is diagnostics, never on the critical path. Appends are chained
// onto this promise so they run in commit order, off the path a pull awaits,
// and can never fail a draw. `commitDraw` never awaits it; a test (or shutdown)
// that needs the writes to have landed awaits `flushDrawHistory()`.
let historyQueue: Promise<void> = Promise.resolve();

function enqueueDrawHistory(slug: string, entry: DrawHistoryEntry): void {
  historyQueue = historyQueue.then(() => appendDrawHistory(slug, entry)).catch(() => {});
}

/** Resolves once every enqueued history append has settled. */
export function flushDrawHistory(): Promise<void> {
  return historyQueue;
}

export async function commitDraw(
  slug: string,
  drawCount: 1 | 10,
  options?: CommitDrawOptions,
): Promise<DrawCommitResult | null> {
  // review/storage is deliberately absent from this import. A draw used
  // to load the deck's review progress and hand it to selectDrawCards,
  // which stopped reading it when the review-history weighting was
  // deleted. The load stayed: a storage round-trip on every pull whose
  // result was discarded, and a dependency edge from gacha to review
  // that nothing justified. The direction is now one-way by
  // construction -- review may read the owned set, gacha never reads
  // review -- which is what lets the two be reasoned about separately.
  const passed = options?.deck;
  let deck: DeckExport | null;
  if (passed && passed.Slug === slug && Array.isArray(passed.Cards)) {
    deck = passed;
  } else {
    const { resolveDeckBySlug } = await import('../../../content/deckRepository');
    deck = await resolveDeckBySlug(slug);
  }
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
  // failed commit would describe a draw that did not happen. Enqueued rather
  // than awaited so the deck parse + AsyncStorage write no longer sit in the
  // ~100 ms before the ceremony mounts; the queue preserves commit order.
  enqueueDrawHistory(slug, {
    drawId: buildDrawId(slug, ts, seed),
    slug,
    seed,
    drawCount,
    ownedBefore: [...ownedSet],
    pityBefore: pityState,
    drawnUids,
    ts,
  });

  const flags = getFeatureFlags();
  const ranks = rankCardsByOrder(deck.Cards);
  const cards: DrawnCardVm[] = selection.cards.map((card) => {
    const tag = normalizeTopic(card.Topic);
    const mcq = resolveMcq(card, flags);
    return {
      stableUid: card.StableUid,
      question: card.Question,
      difficulty: card.Difficulty,
      rarity: rarityOfCard(card),
      rank: ranks.get(card.StableUid) ?? 0,
      ...(tag !== null ? { tag } : {}),
      ...(mcq !== null ? { kind: 'mcq' as const, requiredCount: mcqRequiredCount(mcq) } : {}),
    };
  });

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
