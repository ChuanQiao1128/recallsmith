import type { CardProgress } from '../../../review/model';
import type { CardExport, DeckExport } from '../../../types/deckExport';
import type { OwnedGate } from '../contracts';
import type { CurrentCardLike } from '../session/sessionReviewHelpers';

/** 10 mistakes + up to 5 related cards. */
export const MAX_FOCUS_UIDS = 15;

export type FocusIndex = { cards: CardExport[]; cardMap: Map<string, CardExport> };

/** Route params are untrusted: strings only, trimmed, non-empty, first occurrence wins, capped. */
export function sanitizeFocusUids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (out.length >= MAX_FOCUS_UIDS) break;
    if (typeof value !== 'string') continue;
    const uid = value.trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

/**
 * The focus cards the deck has and the gate admits, in the given order. cardMap covers the whole
 * deck, like the normal session index. null when no focus card is usable.
 */
export function buildFocusIndex(
  deck: DeckExport,
  focusUids: readonly string[],
  ownedSet: OwnedGate,
): FocusIndex | null {
  const cardMap = new Map((deck.Cards ?? []).map((card) => [card.StableUid, card]));
  const cards: CardExport[] = [];
  const seen = new Set<string>();
  for (const uid of focusUids) {
    if (seen.has(uid)) continue;
    seen.add(uid);
    const card = cardMap.get(uid);
    if (!card) continue;
    if (ownedSet !== null && !ownedSet.has(uid)) continue;
    cards.push(card);
  }
  return cards.length > 0 ? { cards, cardMap } : null;
}

/** The first focus card not rated yet this run that has a progress row. Due state is ignored. */
export function pickFocusCard(params: {
  index: FocusIndex;
  progress: CardProgress[];
  ratedUids: ReadonlySet<string>;
}): CurrentCardLike | null {
  const { index, progress, ratedUids } = params;
  const progressMap = new Map(progress.map((row) => [row.stableUid, row]));
  for (const card of index.cards) {
    if (ratedUids.has(card.StableUid)) continue;
    const row = progressMap.get(card.StableUid);
    if (!row) continue;
    return { card: index.cardMap.get(card.StableUid) ?? card, progress: row };
  }
  return null;
}
