import type { DeckExport } from '../../../types/deckExport';
import type { CardProgress } from '../../../review/model';
import type { LibraryVM } from '../contracts';
import { isLearnedProgress, isMasteredProgress, isNewProgress, isScheduledProgress, startOfToday } from '../selectors/progressSelectors';
import { formatDateKey } from '../../../review/model';

export type LibraryCardStatus = 'new' | 'learning' | 'mastered';

export type LibraryCardRow = {
  stableUid: string;
  orderInDeck: number;
  question: string;
  difficulty: number;
  status: LibraryCardStatus;
  statusLabel: 'New' | 'Learning' | 'Mastered';
  isDueToday: boolean;
  isUpdated: boolean;
};

function isDueToday(progress: CardProgress, now: Date): boolean {
  if (!isScheduledProgress(progress)) return false;
  const today0 = startOfToday(now);
  const todayKey = formatDateKey(today0);
  const next = new Date(progress.nextReviewAt);
  const effective = next.getTime() < today0.getTime() ? today0 : next;
  return formatDateKey(effective) === todayKey;
}

function getCardRevision(card: any): number {
  const revision = card?.Revision;
  return typeof revision === 'number' && revision > 0 ? revision : 1;
}

function getSeenRevision(progress: CardProgress): number {
  const seen = (progress as any).lastSeenRevision;
  if (typeof seen === 'number') return seen;
  return isLearnedProgress(progress) ? 1 : 0;
}

export function countUpdatedCards(cards: any[], progress: CardProgress[]): number {
  const progressMap = new Map(progress.map((item) => [item.stableUid, item]));
  let count = 0;

  for (const card of cards) {
    const progressEntry = progressMap.get(card?.StableUid);
    if (!progressEntry) continue;
    if (!isLearnedProgress(progressEntry)) continue;
    if (getCardRevision(card) > getSeenRevision(progressEntry)) count += 1;
  }

  return count;
}

export function buildLibraryCardRows(params: {
  deck: DeckExport;
  progress: CardProgress[];
  now?: Date;
  isTrial?: boolean;
  previewTotal?: number;
}): LibraryCardRow[] {
  const { deck, progress, now = new Date(), isTrial = false, previewTotal = 0 } = params;
  const cards = isTrial ? (deck.Cards ?? []).slice(0, previewTotal) : deck.Cards ?? [];
  const progressMap = new Map(progress.map((item) => [item.stableUid, item]));

  return [...cards]
    .sort((a, b) => a.OrderInDeck - b.OrderInDeck)
    .map((card) => {
      const progressEntry = progressMap.get(card.StableUid) ?? { stableUid: card.StableUid, stage: 0, nextReviewAt: 0 };
      const status: LibraryCardStatus = isMasteredProgress(progressEntry)
        ? 'mastered'
        : isLearnedProgress(progressEntry)
          ? 'learning'
          : 'new';

      return {
        stableUid: card.StableUid,
        orderInDeck: card.OrderInDeck,
        question: card.Question,
        difficulty: card.Difficulty,
        status,
        statusLabel: status === 'mastered' ? 'Mastered' : status === 'learning' ? 'Learning' : 'New',
        isDueToday: isDueToday(progressEntry as CardProgress, now),
        isUpdated: getCardRevision(card) > getSeenRevision(progressEntry as CardProgress) && isLearnedProgress(progressEntry as CardProgress),
      };
    });
}

export function buildLibraryVM(params: {
  deck: DeckExport;
  progress: CardProgress[];
  now?: Date;
  isTrial?: boolean;
  previewTotal?: number;
}): LibraryVM {
  const { deck, progress, now = new Date(), isTrial = false, previewTotal = 0 } = params;
  const newCount = progress.filter((item) => isNewProgress(item)).length;
  const masteredCount = progress.filter((item) => isMasteredProgress(item)).length;
  const learningCount = progress.filter((item) => isLearnedProgress(item) && !isMasteredProgress(item)).length;
  const dueTodayCount = progress.filter((item) => isDueToday(item, now)).length;
  const updatedCount = countUpdatedCards(isTrial ? (deck.Cards ?? []).slice(0, previewTotal) : deck.Cards ?? [], progress);
  const drawStatusLabel =
    dueTodayCount > 0
      ? 'Clear today’s due cards before opening more new content.'
      : newCount > 0
        ? 'You have room to learn fresh cards today.'
        : 'No pending pressure right now — browse your library or return later.';

  return {
    title: deck.Title,
    subtitle: isTrial ? 'Library · Free trial slice' : 'Library · Owned cards',
    drawStatusLabel,
    counts: {
      newCount,
      learningCount,
      masteredCount,
      dueTodayCount,
      updatedCount,
    },
  };
}
