import type { DeckExport, CardExport } from '../../../types/deckExport';
import type { CardProgress } from '../../../review/model';
import { buildChallengeRoute } from './sessionBuilder';
import { isLearnedProgress, isNewProgress, isScheduledProgress, startOfToday } from '../selectors/progressSelectors';
import { formatDateKey } from '../../../review/model';

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

export function countDueToday(progressList: CardProgress[], now: Date): number {
  return progressList.filter((progress) => isDueTodayBucket(progress, now)).length;
}

export function countNewAvailable(progressList: CardProgress[]): number {
  return progressList.filter((progress) => isNewProgress(progress)).length;
}

export function countLearned(progressList: CardProgress[]): number {
  return progressList.filter((progress) => isLearnedProgress(progress)).length;
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
  mode: 'review-due' | 'learn-new' | 'mixed';
  avoidUid?: string | null;
  index?: { cards: CardExport[]; cardMap: Map<string, CardExport> } | null;
}): CurrentCardLike | null {
  const { deck, progress, now, mode, avoidUid, index } = params;
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

  const pickDue = () => pickWith((_card, progressEntry) => isDueTodayBucket(progressEntry, now));
  const pickUpdated = () => pickWith((card, progressEntry) => isUpdatedCard(card, progressEntry));
  const pickNew = () => pickWith((_card, progressEntry) => isNewProgress(progressEntry));

  if (mode === 'review-due') return pickDue();
  if (mode === 'learn-new') return pickNew();
  return pickDue() ?? pickUpdated() ?? pickNew();
}

export function planChallengeRoute(params: {
  deck: DeckExport;
  progress: CardProgress[];
  now?: Date;
}) {
  const { deck, progress, now = new Date() } = params;
  const dueCount = countDueToday(progress, now);
  const newCount = countNewAvailable(progress);

  return buildChallengeRoute({
    slug: deck.Slug,
    deckTitle: deck.Title,
    dueCount,
    newCount,
  });
}
