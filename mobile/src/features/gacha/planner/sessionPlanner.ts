import type { DeckExport, CardExport } from '../../../types/deckExport';
import type { CardProgress } from '../../../review/model';
import type { ChallengeRoute, OwnedGate } from '../contracts';
import { buildChallengeRoute, buildSweepRoute } from './sessionBuilder';
import { isLearnedProgress, isNewProgress, isScheduledProgress, startOfToday } from '../selectors/progressSelectors';
import { formatDateKey } from '../../../review/model';
import type { StudyMode } from '../../../navigation/types';

export type CurrentCardLike = {
  card: CardExport;
  progress: CardProgress;
};

function buildCardMap(deck: DeckExport): Map<string, CardExport> {
  const map = new Map<string, CardExport>();
  for (const card of deck.Cards ?? []) map.set(card.StableUid, card);
  return map;
}

function sortCards(deck: DeckExport): CardExport[] {
  return [...(deck.Cards ?? [])].sort((a, b) => a.OrderInDeck - b.OrderInDeck);
}

function isDueTodayBucket(progress: CardProgress, now: Date): boolean {
  if (!isScheduledProgress(progress)) return false;

  const today0 = startOfToday(now);
  const todayKey = formatDateKey(today0);
  const next = new Date(progress.nextReviewAt);
  const effective = next.getTime() < today0.getTime() ? today0 : next;
  return formatDateKey(effective) === todayKey;
}

function isOwned(stableUid: string, ownedSet: OwnedGate): boolean {
  return ownedSet === null || ownedSet.has(stableUid);
}

/*
 * Every entry point below takes the same OwnedGate, and it is optional on all
 * of them on purpose.
 *
 * A required parameter would make the compiler enumerate the call sites, which
 * is worth something -- but it would also force this change to edit every
 * screen and every existing test with a placeholder the next phase immediately
 * replaces, and a `null` typed in to silence a compiler is not a decision
 * anybody made. So the gate arrives one caller at a time: each starts ungated,
 * is switched over deliberately, and gets a test that fails if the switch is
 * ever undone. Nothing here changes behaviour until a caller passes a set.
 */

export function countDueToday(progressList: CardProgress[], now: Date, ownedSet: OwnedGate = null): number {
  return progressList.filter((progress) => isOwned(progress.stableUid, ownedSet) && isDueTodayBucket(progress, now))
    .length;
}

export function countNewAvailable(progressList: CardProgress[], ownedSet: OwnedGate = null): number {
  return progressList.filter((progress) => isOwned(progress.stableUid, ownedSet) && isNewProgress(progress)).length;
}

export function countLearned(progressList: CardProgress[], ownedSet: OwnedGate = null): number {
  return progressList.filter((progress) => isOwned(progress.stableUid, ownedSet) && isLearnedProgress(progress)).length;
}

/**
 * How many cards of this deck the account can play at all. Ungated that is the
 * whole deck (one progress row per card, see loadDeckProgress); gated it is the
 * rows the set admits. It is the planner's "is there anything here" question,
 * asked before due/new are even looked at: a fresh install that has not pulled
 * yet has 0 due, 0 new and 0 owned, and only the last number tells that apart
 * from a caught-up collector who owns cards with nothing scheduled today.
 */
export function countOwned(progressList: CardProgress[], ownedSet: OwnedGate = null): number {
  return progressList.filter((progress) => isOwned(progress.stableUid, ownedSet)).length;
}

function getCardRevision(card: CardExport): number {
  const revision = (card as any)?.Revision;
  return typeof revision === 'number' && revision > 0 ? revision : 1;
}

function getSeenRevision(progress: CardProgress): number {
  const seen = (progress as any).lastSeenRevision;
  if (typeof seen === 'number') return seen;
  return isLearnedProgress(progress) ? 1 : 0;
}

function isUpdatedCard(card: CardExport, progress: CardProgress): boolean {
  if (!isLearnedProgress(progress)) return false;
  return getCardRevision(card) > getSeenRevision(progress);
}

export function pickNextCard(params: {
  deck?: DeckExport | null;
  progress: CardProgress[];
  now: Date;
  mode: 'review-due' | 'learn-new' | 'mixed' | 'sweep';
  avoidUid?: string | null;
  index?: { cards: CardExport[]; cardMap: Map<string, CardExport> } | null;
  ownedSet?: OwnedGate;
}): CurrentCardLike | null {
  const { deck, progress, now, mode, avoidUid, index, ownedSet = null } = params;
  const cardMap = index?.cardMap ?? (deck ? buildCardMap(deck) : null);
  const cards = index?.cards ?? (deck ? sortCards(deck) : null);
  if (!cardMap || !cards) return null;

  const progressMap = new Map(progress.map((item) => [item.stableUid, item]));

  const pickWith = (predicate: (card: CardExport, progress: CardProgress) => boolean) => {
    for (const card of cards) {
      if (avoidUid && card.StableUid === avoidUid) continue;
      const progressEntry = progressMap.get(card.StableUid);
      if (!progressEntry) continue;
      if (predicate(card, progressEntry)) {
        return { card: cardMap.get(card.StableUid)!, progress: progressEntry };
      }
    }

    if (avoidUid) {
      for (const card of cards) {
        const progressEntry = progressMap.get(card.StableUid);
        if (!progressEntry) continue;
        if (predicate(card, progressEntry)) {
          return { card: cardMap.get(card.StableUid)!, progress: progressEntry };
        }
      }
    }

    return null;
  };

  // The owned check sits inside each predicate rather than in pickWith's loop.
  // Two reasons, one structural and one about evidence. Structural: pickWith
  // scans twice -- once honouring avoidUid, once ignoring it -- and a check
  // hoisted into the loop body would have to be written into both scans, so the
  // predicate is the DRY position, not the loop. Evidence: with three separate
  // conjuncts, deleting any one of them turns exactly one test red, which is
  // what proves each entry path is guarded on its own instead of all three
  // riding on a single shared line. The cost is that a fourth pick added later
  // must remember `owns` -- if you are adding one, add it.
  const owns = (card: CardExport) => isOwned(card.StableUid, ownedSet);
  const pickDue = () => pickWith((card, progressEntry) => owns(card) && isDueTodayBucket(progressEntry, now));
  const pickUpdated = () => pickWith((card, progressEntry) => owns(card) && isUpdatedCard(card, progressEntry));
  const pickNew = () => pickWith((card, progressEntry) => owns(card) && isNewProgress(progressEntry));

  // Sweep: every owned learned card, longest-unseen first, deck order as the
  // tie-break; the due bucket is deliberately ignored (economy-v2 R8). A card
  // just rated carries lastReviewedAt = now and so sinks to the end on its own.
  const pickSweep = () => {
    const ranked = cards
      .map((card) => ({ card, progressEntry: progressMap.get(card.StableUid) }))
      .filter(
        (entry): entry is { card: CardExport; progressEntry: CardProgress } =>
          !!entry.progressEntry && owns(entry.card) && isLearnedProgress(entry.progressEntry),
      )
      .sort(
        (a, b) =>
          (a.progressEntry.lastReviewedAt ?? 0) - (b.progressEntry.lastReviewedAt ?? 0) ||
          a.card.OrderInDeck - b.card.OrderInDeck,
      );
    const first = ranked.find((entry) => !avoidUid || entry.card.StableUid !== avoidUid) ?? ranked[0] ?? null;
    return first ? { card: cardMap.get(first.card.StableUid)!, progress: first.progressEntry } : null;
  };

  if (mode === 'sweep') return pickSweep();
  if (mode === 'review-due') return pickDue();
  if (mode === 'learn-new') return pickNew();
  return pickDue() ?? pickUpdated() ?? pickNew();
}

export function planChallengeRoute(params: {
  deck: DeckExport;
  progress: CardProgress[];
  now?: Date;
  ownedSet?: OwnedGate;
  mode?: StudyMode;
}): ChallengeRoute {
  const { deck, progress, now = new Date(), ownedSet = null, mode } = params;
  const dueCount = countDueToday(progress, now, ownedSet);
  const newCount = countNewAvailable(progress, ownedSet);

  if (mode === 'sweep') {
    return buildSweepRoute({
      slug: deck.Slug,
      deckTitle: deck.Title,
      learnedCount: countLearned(progress, ownedSet),
      dueCount,
      newCount,
    });
  }

  return buildChallengeRoute({
    slug: deck.Slug,
    deckTitle: deck.Title,
    dueCount,
    newCount,
    ownedCount: countOwned(progress, ownedSet),
  });
}
