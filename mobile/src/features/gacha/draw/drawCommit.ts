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

export type DrawnCardVm = {
  stableUid: string;
  question: string;
  difficulty: number;
  rarity: 'COM' | 'RAR' | 'LEG';
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
  const [{ resolveDeckBySlug }, { loadDeckProgress }] = await Promise.all([
    import('../../../content/deckRepository'),
    import('../../../review/storage'),
  ]);
  const deck = await resolveDeckBySlug(slug);
  if (!deck) return null;

  const [progress, drawState] = await Promise.all([
    loadDeckProgress(deck),
    loadDrawState(slug),
  ]);
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
    progress,
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

  const cards: DrawnCardVm[] = selection.cards.map((card) => ({
    stableUid: card.StableUid,
    question: card.Question,
    difficulty: card.Difficulty,
    rarity: rarityOfCard(card),
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
 */
export function replayDraw(record: DrawHistoryEntry, deckCards: CardExport[]): DrawReplayResult {
  const selection = selectDrawCards({
    deckCards,
    ownedSet: new Set(record.ownedBefore),
    // Empty on purpose: selection is uniform over the missing pool and
    // does not read review history. If that ever changes, progress has
    // to join the recorded inputs or replay stops being a replay.
    progress: [],
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
