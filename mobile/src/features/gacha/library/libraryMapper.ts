import type { DeckExport } from '../../../types/deckExport';
import type { CardProgress } from '../../../review/model';
import type { LibraryVM } from '../contracts';
import { isLearnedProgress, isMasteredProgress, isNewProgress, isScheduledProgress, startOfToday } from '../selectors/progressSelectors';
import { formatDateKey } from '../../../review/model';
import { rarityFromDifficulty, type Rarity } from '../draw/cardRarity';
import { cardIconFor } from '../../../theme/cardIcon';

export type LibraryCardStatus = 'new' | 'learning' | 'mastered';
export type LibraryCardBadgeTone = 'new' | 'learning' | 'mastered';
// Now includes the gacha rarity dimension. Real Pokedex players
// also want to slice by COM/RAR/LEG, not just by SRS state.
export type LibraryFilter = 'all' | 'new' | 'learning' | 'mastered' | 'rare' | 'legendary';

export type LibraryCardRow = {
  stableUid: string;
  orderInDeck: number;
  question: string;
  difficulty: number;
  // Drop rarity from the gacha system into the Library row so tiles
  // can render rarity indicators (stars) and the filter sheet can
  // slice by rarity tier independently of SRS status.
  rarity: Rarity;
  // Single emoji derived from card.Tag → fallback to card.CodeLanguage.
  // Lets every tile carry a small visual identity, breaking up the
  // "rows of identical text rectangles" feel.
  icon: string;
  status: LibraryCardStatus;
  statusLabel: 'Missing' | 'Learning' | 'Mastered';
  badgeTone: LibraryCardBadgeTone;
  isDueToday: boolean;
  isUpdated: boolean;
};

export type LibraryFilterChip = {
  key: LibraryFilter;
  label: 'All' | 'New' | 'Learning' | 'Mastered' | 'Rare' | 'Legendary';
  count: number;
};

export type LibraryDeckOption = {
  slug: string;
  title: string;
};

export type LibraryViewModel = LibraryVM & {
  decks: LibraryDeckOption[];
  selectedDeckSlug: string;
  filter: LibraryFilter;
  filters: LibraryFilterChip[];
  cards: LibraryCardRow[];
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
        rarity: rarityFromDifficulty(card.Difficulty),
        icon: cardIconFor(card),
        status,
        statusLabel: status === 'mastered' ? 'Mastered' : status === 'learning' ? 'Learning' : 'Missing',
        badgeTone: status,
        isDueToday: isDueToday(progressEntry as CardProgress, now),
        isUpdated: getCardRevision(card) > getSeenRevision(progressEntry as CardProgress) && isLearnedProgress(progressEntry as CardProgress),
      };
    });
}

export function buildLibraryVM(params: {
  deck: DeckExport;
  progress: CardProgress[];
  filter?: LibraryFilter;
  now?: Date;
  isTrial?: boolean;
  previewTotal?: number;
  decks?: LibraryDeckOption[];
  selectedDeckSlug?: string | null;
}): LibraryViewModel {
  const {
    deck,
    progress,
    filter = 'all',
    now = new Date(),
    isTrial = false,
    previewTotal = 0,
    decks = [{ slug: deck.Slug, title: deck.Title }],
    selectedDeckSlug,
  } = params;
  const rows = buildLibraryCardRows({ deck, progress, now, isTrial, previewTotal });
  const newCount = rows.filter((item) => item.status === 'new').length;
  const masteredCount = rows.filter((item) => item.status === 'mastered').length;
  const learningCount = rows.filter((item) => item.status === 'learning').length;
  // Rarity counts — independent of SRS state. Counts ALL cards (owned
  // + missing) of each tier so the filter chips show the deck's rarity
  // distribution, not just what the user owns.
  const rareCount = rows.filter((item) => item.rarity === 'RAR').length;
  const legendaryCount = rows.filter((item) => item.rarity === 'LEG').length;
  const dueTodayCount = rows.filter((item) => item.isDueToday).length;
  const updatedCount = countUpdatedCards(
    isTrial ? (deck.Cards ?? []).slice(0, previewTotal) : deck.Cards ?? [],
    progress,
  );
  const drawStatusLabel =
    dueTodayCount > 0
      ? 'Clear today’s due cards before opening more new content.'
      : newCount > 0
        ? 'You have room to learn fresh cards today.'
        : 'No pending pressure right now — browse your library or return later.';

  // Filter resolver — SRS dimensions and rarity dimensions are
  // independent. Only one filter active at a time (single-select chips).
  const cards =
    filter === 'all'
      ? rows
      : filter === 'new'
        ? rows.filter((item) => item.status === 'new')
        : filter === 'learning'
          ? rows.filter((item) => item.status === 'learning')
          : filter === 'mastered'
            ? rows.filter((item) => item.status === 'mastered')
            : filter === 'rare'
              ? rows.filter((item) => item.rarity === 'RAR')
              : filter === 'legendary'
                ? rows.filter((item) => item.rarity === 'LEG')
                : rows;

  const filters: LibraryFilterChip[] = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'new', label: 'New', count: newCount },
    { key: 'learning', label: 'Learning', count: learningCount },
    { key: 'mastered', label: 'Mastered', count: masteredCount },
    { key: 'rare', label: 'Rare', count: rareCount },
    { key: 'legendary', label: 'Legendary', count: legendaryCount },
  ];

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
    decks,
    selectedDeckSlug: decks.some((item) => item.slug === selectedDeckSlug) && selectedDeckSlug ? selectedDeckSlug : deck.Slug,
    filter,
    filters,
    cards,
  };
}
