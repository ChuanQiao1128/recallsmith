import type { CardProgress } from '../../../review/model';
import { readStoredDeckProgress } from '../../../review/storage';
import { rarityOfCard } from './cardRarity';
import { resolveEffectiveOwned } from './effectiveOwned';
import { loadDrawState } from './drawStateStore';
import { buildPityProgressLabelV9, DEFAULT_PITY_STATE, normalizePityState } from './pity';

/**
 * R25 G01: what a draw treats as "already collected" -- the same effective set
 * the Library counts (resolveEffectiveOwned: drawState.owned + learned cards +
 * open starter-lesson cards). Excluding drawState.owned alone let a draw hand
 * over, mark NEW and charge for a card the Library was already showing as
 * collected.
 *
 * Progress comes from readStoredDeckProgress: a read of what is on disk with
 * none of loadDeckProgress's migration or reconcile writes, so a draw still
 * never writes review state. A failed read (or no stored progress yet) counts
 * as "nothing learned": the draw falls back to owned + starter rather than
 * failing the pull.
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

export type DrawStatus = { pityLabel: string; collectionComplete: boolean; pityThreshold: number };

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
    };
  } catch {
    // A storage failure must not cost the user the pack. A missing progress
    // line is a smaller loss than an unopenable draw screen, and claiming
    // "complete" on a failed read would lock the pack for no reason.
    return { pityLabel: '', collectionComplete: false, pityThreshold: DEFAULT_PITY_STATE.threshold };
  }
}
