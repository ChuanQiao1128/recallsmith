import type { CardProgress } from '../../../review/model';
import { readStoredDeckProgress } from '../../../review/storage';
import { rarityOfCard } from './cardRarity';
import { resolveEffectiveOwned } from './effectiveOwned';
import { loadDrawState } from './drawStateStore';
import { buildPityProgressLabelV9, DEFAULT_PITY_STATE, normalizePityState } from './pity';

/**
 * R25 G01: what a draw treats as "already collected" -- the effective set
 * (resolveEffectiveOwned: drawState.owned + learned cards + open starter-lesson
 * cards). Excluding drawState.owned alone let a draw hand over, mark NEW and
 * charge for a card the Library was already showing as collected.
 *
 * Progress comes from readStoredDeckProgress: a read of the current progress
 * key with none of loadDeckProgress's migration or reconcile writes, so a draw
 * still never writes review state. Two consequences, both deliberate:
 * - Progress that still sits only under a legacy or global key is not seen
 *   until the Library or Home has run loadDeckProgress (which migrates it).
 *   Until then the set matches the Library's only for migrated progress.
 * - Entries are not filtered to the deck, so a retired uid can be in the set.
 *   It never reaches the pool (the pool is deck cards), and drawCommit counts
 *   ownedAfter over deck cards only.
 * A failed read (or no stored progress yet) counts as "nothing learned": the
 * draw falls back to owned + starter rather than failing the pull.
 */
export async function loadDrawPoolOwned(slug: string): Promise<Set<string>> {
  let progress: CardProgress[] = [];
  try {
    progress = (await readStoredDeckProgress(slug)) ?? [];
  } catch {
    progress = [];
  }
  return resolveEffectiveOwned(slug, progress);
}

export type DrawStatus = {
  pityLabel: string;
  collectionComplete: boolean;
  pityThreshold: number;
  /** 2026-10-17 batch open: the distinct deck cards not in the effective owned set -- the pool a
   *  draw picks from (same dedupe by StableUid as poolSelection), so the screen never offers a
   *  batch bigger than the pool can fill. */
  undrawnCount: number;
};

// Distinct StableUids among the deck cards not in `owned`: the size of the pool selectDrawCards
// builds from the same inputs.
function countUndrawn(deckCards: any[], owned: ReadonlySet<string>): number {
  const seen = new Set<string>();
  for (const card of deckCards) {
    const uid = card?.StableUid;
    if (owned.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
  }
  return seen.size;
}

// The guarantee's whole product value is that a player can see it coming.
// buildPityProgressLabelV9 shipped with the counter persisted, capped and
// tested, and zero callers, so the cost was paid and none of the benefit
// collected. This is the caller (DrawScreen).
//
// Reads the effective owned set once and answers both questions that depend
// on it. They used to be one read for the pity label and no read at all for
// "is there anything left to draw", which is why the screen went on offering a
// pull it could not fill. Both use the same set the pool is built from
// (loadDrawPoolOwned), so the screen never offers a draw the pool cannot fill
// nor hides one it can.
export async function loadDrawStatus(slug: string, deckCards: any[]): Promise<DrawStatus> {
  try {
    const [state, owned] = await Promise.all([loadDrawState(slug), loadDrawPoolOwned(slug)]);
    // Counts the legendary gap only, which is what the label's own contract
    // says. An unowned RAR also keeps the guarantee live, so a deck missing
    // rares but no legendaries stays silent rather than over-promising.
    const missingLegCount = deckCards.filter(
      (card) => rarityOfCard(card) === 'LEG' && !owned.has(card?.StableUid),
    ).length;
    // An empty deck is not a completed collection. Treating it as one would
    // put the "you own everything" copy in front of a user who owns nothing.
    const collectionComplete =
      deckCards.length > 0 && deckCards.every((card) => owned.has(card?.StableUid));
    return {
      pityLabel: buildPityProgressLabelV9(normalizePityState(state.pity), missingLegCount),
      collectionComplete,
      pityThreshold: normalizePityState(state.pity).threshold,
      undrawnCount: countUndrawn(deckCards, owned),
    };
  } catch {
    // A storage failure must not cost the user the pack. A missing progress
    // line is a smaller loss than an unopenable draw screen, and claiming
    // "complete" on a failed read would lock the pack for no reason. The
    // undrawn count falls back to the whole deck for the same reason: the
    // selection still draws only missing cards, and the charge is the cards
    // received, so over-offering a batch costs nothing.
    return {
      pityLabel: '',
      collectionComplete: false,
      pityThreshold: DEFAULT_PITY_STATE.threshold,
      undrawnCount: countUndrawn(deckCards, new Set()),
    };
  }
}
