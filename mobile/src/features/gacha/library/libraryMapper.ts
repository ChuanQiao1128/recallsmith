import type { DeckExport } from '../../../types/deckExport';
import type { CardProgress } from '../../../review/model';
import type { LibraryVM, OwnedGate } from '../contracts';
import { isLearnedProgress, isMasteredProgress, isNewProgress, isScheduledProgress, startOfToday } from '../selectors/progressSelectors';
import { formatDateKey } from '../../../review/model';
import { rarityFromDifficulty, type Rarity } from '../draw/cardRarity';
import { cardIconFor } from '../../../theme/cardIcon';
import { compareTopicLabels, normalizeTopic, topicKey, UNTAGGED_TOPIC_KEY, UNTAGGED_TOPIC_LABEL } from './topics';
import { formatRank, rankCardsByOrder } from './cardRank';

export { formatRank, rankCardsByOrder } from './cardRank';

// 'missing' is reachable only when a caller passes an ownedSet. Ungated there
// is no way to know a card was never drawn, so the shipped three-value split
// (and its labels) stays exactly as it is -- see buildLibraryCardRows.
export type LibraryCardStatus = 'missing' | 'new' | 'learning' | 'mastered';
export type LibraryCardBadgeTone = LibraryCardStatus;
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
  statusLabel: 'Missing' | 'New' | 'Learning' | 'Mastered';
  badgeTone: LibraryCardBadgeTone;
  /**
   * "Not in the collection, as far as this call can tell" -- the one predicate
   * the silhouette presentation should key off. It exists because `status`
   * alone cannot answer the question in both modes: gated, missing is its own
   * status; ungated, the answer is the legacy proxy (unstudied stands in for
   * uncollected) and the status is 'new'. A renderer that tests the status
   * string directly is correct in one mode and wrong in the other.
   */
  isMissing: boolean;
  isDueToday: boolean;
  isUpdated: boolean;
  topic: string | null;
  /**
   * 1-based position in the deck's OrderInDeck order — the number printed as
   * "#011" on the tile, the session header and DrawResult. OrderInDeck itself
   * is an authoring key with gaps (5, 780, 3700…) and was being shown raw.
   * Identity stays stableUid; this is display only.
   */
  rank: number;
};

export type LibraryFilterChip = {
  key: LibraryFilter;
  label: 'All' | 'New' | 'Learning' | 'Mastered' | 'Rare' | 'Legendary';
  count: number;
};

export type LibraryTopicChip = { key: string; label: string; count: number };

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
  topics: LibraryTopicChip[];
  topicFilter: string | null;
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

export function countUpdatedCards(cards: any[], progress: CardProgress[], ownedSet: OwnedGate = null): number {
  const progressMap = new Map(progress.map((item) => [item.stableUid, item]));
  let count = 0;

  for (const card of cards) {
    // A card you do not hold cannot be "updated for you" -- the badge invites a
    // re-read of content the gate will not open.
    if (ownedSet && !ownedSet.has(card?.StableUid)) continue;
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
  ownedSet?: OwnedGate;
}): LibraryCardRow[] {
  const { deck, progress, now = new Date(), isTrial = false, previewTotal = 0, ownedSet = null } = params;
  const cards = isTrial ? (deck.Cards ?? []).slice(0, previewTotal) : deck.Cards ?? [];
  const progressMap = new Map(progress.map((item) => [item.stableUid, item]));
  const ranks = rankCardsByOrder(deck.Cards ?? []);

  return [...cards]
    .sort((a, b) => a.OrderInDeck - b.OrderInDeck)
    .map((card) => {
      const progressEntry = progressMap.get(card.StableUid) ?? { stableUid: card.StableUid, stage: 0, nextReviewAt: 0 };
      // Three-valued on purpose: true, false, and "this call has no gate, so
      // ownership is not a question it can answer".
      const owned = ownedSet === null ? null : ownedSet.has(card.StableUid);
      // Missing outranks every SRS state. Gated, a card that is somehow both
      // studied and unowned is still a card the user cannot open, and calling
      // it Learning would advertise a door that does not exist.
      const status: LibraryCardStatus =
        owned === false
          ? 'missing'
          : isMasteredProgress(progressEntry)
            ? 'mastered'
            : isLearnedProgress(progressEntry)
              ? 'learning'
              : 'new';
      // Ungated, "unstudied" is the only proxy for "uncollected" the app has
      // ever had, and it is the proxy the shipped silhouette tile is built on.
      // Keeping it means an ungated caller renders exactly what it renders
      // today; the moment a real set arrives, the proxy is replaced by the
      // truth and a drawn-but-unstudied card stops being a "?" placeholder.
      const isMissing = owned === null ? status === 'new' : !owned;

      return {
        stableUid: card.StableUid,
        orderInDeck: card.OrderInDeck,
        question: card.Question,
        difficulty: card.Difficulty,
        rarity: rarityFromDifficulty(card.Difficulty),
        icon: cardIconFor(card),
        status,
        statusLabel: isMissing
          ? 'Missing'
          : status === 'mastered'
            ? 'Mastered'
            : status === 'learning'
              ? 'Learning'
              : 'New',
        badgeTone: status,
        isMissing,
        // A card outside the collection is neither due nor updated: both of
        // those are invitations to study, and the gate refuses the invitation.
        // Ungated this changes nothing -- an unstudied card is never scheduled
        // and never counts as updated.
        isDueToday: !isMissing && isDueToday(progressEntry as CardProgress, now),
        isUpdated:
          !isMissing &&
          getCardRevision(card) > getSeenRevision(progressEntry as CardProgress) &&
          isLearnedProgress(progressEntry as CardProgress),
        topic: normalizeTopic(card.Topic),
        rank: ranks.get(card.StableUid) ?? 0,
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
  ownedSet?: OwnedGate;
  topicFilter?: string | null;
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
    ownedSet = null,
    topicFilter = null,
  } = params;
  const rows = buildLibraryCardRows({ deck, progress, now, isTrial, previewTotal, ownedSet });
  // Gated, these three read "of the cards you hold" -- an unowned card carries
  // status 'missing' and so falls out of all three on its own, no second gate
  // needed here.
  const newCount = rows.filter((item) => item.status === 'new').length;
  const masteredCount = rows.filter((item) => item.status === 'mastered').length;
  const learningCount = rows.filter((item) => item.status === 'learning').length;
  // Ungated this equals learningCount + masteredCount, which is the formula
  // LibraryScreen computes by hand today -- so a caller can move to this field
  // before it has a set to pass, and see no change until it does.
  const ownedCount = rows.filter((item) => !item.isMissing).length;
  // Rarity counts — independent of SRS state. Counts ALL cards (owned
  // + missing) of each tier so the filter chips show the deck's rarity
  // distribution, not just what the user owns.
  const rareCount = rows.filter((item) => item.rarity === 'RAR').length;
  const legendaryCount = rows.filter((item) => item.rarity === 'LEG').length;
  const dueTodayCount = rows.filter((item) => item.isDueToday).length;
  const updatedCount = countUpdatedCards(
    isTrial ? (deck.Cards ?? []).slice(0, previewTotal) : deck.Cards ?? [],
    progress,
    ownedSet,
  );
  const drawStatusLabel =
    dueTodayCount > 0
      ? 'Clear today’s due cards before opening more new content.'
      : newCount > 0
        ? 'You have room to learn fresh cards today.'
        : 'No pending pressure right now — browse your library or return later.';

  // Filter resolver — SRS dimensions and rarity dimensions are
  // independent. Only one filter active at a time (single-select chips).
  const statusFiltered =
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

  const groupKeyOf = (row: LibraryCardRow): string => (row.topic === null ? UNTAGGED_TOPIC_KEY : topicKey(row.topic));
  const hasTopics = rows.some((row) => row.topic !== null);
  // One chip per distinct key; the label is the first-seen normalized text, so "IAM/S3" and
  // "IAM & S3" share one chip. Chips are then sorted by label (numeric-aware, see
  // compareTopicLabels): deck order put "4.1 Cost" before "1.2 Secure" because that is where the
  // authoring tool happened to put the first card of each domain.
  const topicOrder: string[] = [];
  const topicLabel = new Map<string, string>();
  const topicCount = new Map<string, number>();
  if (hasTopics) {
    for (const row of rows) {
      if (row.topic === null) continue;
      const key = topicKey(row.topic);
      if (!topicLabel.has(key)) {
        topicOrder.push(key);
        topicLabel.set(key, row.topic);
      }
      topicCount.set(key, (topicCount.get(key) ?? 0) + 1);
    }
    topicOrder.sort((a, b) => compareTopicLabels(topicLabel.get(a) ?? a, topicLabel.get(b) ?? b));
  }
  const untaggedCount = rows.filter((row) => row.topic === null).length;
  const topics: LibraryTopicChip[] = hasTopics
    ? [
        { key: 'all', label: 'All', count: rows.length },
        ...topicOrder.map((key) => ({ key, label: topicLabel.get(key) ?? key, count: topicCount.get(key) ?? 0 })),
        ...(untaggedCount > 0 ? [{ key: UNTAGGED_TOPIC_KEY, label: UNTAGGED_TOPIC_LABEL, count: untaggedCount }] : []),
      ]
    : [];
  const effectiveTopicFilter =
    topicFilter !== null && topicFilter !== 'all' && topics.some((chip) => chip.key === topicFilter) ? topicFilter : null;
  const groupIndex = new Map(topics.map((chip, index) => [chip.key, index]));
  const rank = (row: LibraryCardRow): number => groupIndex.get(groupKeyOf(row)) ?? Number.MAX_SAFE_INTEGER;
  // Grouping IS the order: topic groups in chip order (All first, sorted topics, Untagged last),
  // OrderInDeck inside a group. Copy before sorting —
  // for filter === 'all' the resolver hands back `rows` itself.
  const cards = !hasTopics
    ? statusFiltered
    : [...statusFiltered]
        .filter((row) => effectiveTopicFilter === null || groupKeyOf(row) === effectiveTopicFilter)
        .sort((a, b) => rank(a) - rank(b) || a.orderInDeck - b.orderInDeck);

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
      ownedCount,
      totalCount: rows.length,
    },
    decks,
    selectedDeckSlug: decks.some((item) => item.slug === selectedDeckSlug) && selectedDeckSlug ? selectedDeckSlug : deck.Slug,
    filter,
    filters,
    cards,
    topics,
    topicFilter: effectiveTopicFilter,
  };
}
