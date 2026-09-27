import type { CardProgress } from '../../../review/model';
import type { CardExport, DeckExport } from '../../../types/deckExport';
import type { OwnedGate } from '../contracts';
import { isLearnedProgress } from '../selectors/progressSelectors';
import type { MistakeEntry } from './mistakeBook';

/** How many related cards a focus run adds to the mistakes by default. */
export const RELATED_REVIEW_COUNT = 3;
/** Hard ceiling on the related cards, whatever the caller or the remote flag asks for. */
const MAX_RELATED_COUNT = 5;
/** An untagged mistake relates to the cards within this many deck positions of it. */
const NEIGHBOUR_DISTANCE = 5;

function normalizeCount(count: number | undefined): number {
  const value = count ?? RELATED_REVIEW_COUNT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, MAX_RELATED_COUNT);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pure and deterministic: picks up to `count` learned, owned cards of the deck that are not
 * active mistakes, closest first to the most recent mistakes (same topic, or deck neighbours for
 * an untagged mistake), then the weakest (lowest stage, longest unseen). Never mutates its inputs.
 * `now` is part of the contract for future ranking and is not read today.
 */
export function pickRelatedCards(input: {
  deck: DeckExport;
  progress: CardProgress[];
  ownedSet: OwnedGate;
  mistakes: MistakeEntry[];
  now: Date;
  count?: number;
}): string[] {
  const { deck, progress, ownedSet } = input;
  const count = normalizeCount(input.count);
  if (count === 0) return [];

  const cards: CardExport[] = Array.isArray(deck.Cards) ? deck.Cards : [];
  const cardMap = new Map(cards.map((card) => [card.StableUid, card]));
  const progressMap = new Map(progress.map((row) => [row.stableUid, row]));

  const mistakes = input.mistakes
    .filter((entry) => entry.deckSlug === deck.Slug)
    .slice()
    .sort(
      (a, b) =>
        b.lastWrongAt - a.lastWrongAt ||
        compareStrings(`${a.deckSlug}::${a.stableUid}`, `${b.deckSlug}::${b.stableUid}`),
    );
  const mistakeUids = new Set(mistakes.map((entry) => entry.stableUid));

  const affinity = (card: CardExport): number => {
    for (let i = 0; i < mistakes.length; i += 1) {
      const mistake = mistakes[i];
      if (mistake.topic) {
        if (card.Topic === mistake.topic) return i;
        continue;
      }
      const mistakeCard = cardMap.get(mistake.stableUid);
      if (!mistakeCard) continue;
      if (Math.abs(card.OrderInDeck - mistakeCard.OrderInDeck) <= NEIGHBOUR_DISTANCE) return i;
    }
    return Infinity;
  };

  const candidates = cards
    .filter((card) => ownedSet === null || ownedSet.has(card.StableUid))
    .filter((card) => !mistakeUids.has(card.StableUid))
    .map((card) => ({ card, row: progressMap.get(card.StableUid) }))
    .filter((entry): entry is { card: CardExport; row: CardProgress } => !!entry.row && isLearnedProgress(entry.row))
    .map((entry) => ({ ...entry, rank: affinity(entry.card) }));

  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
    const stage = (a.row.stage ?? 0) - (b.row.stage ?? 0);
    if (stage !== 0) return stage;
    const reviewed = (a.row.lastReviewedAt ?? 0) - (b.row.lastReviewedAt ?? 0);
    if (reviewed !== 0) return reviewed;
    const order = a.card.OrderInDeck - b.card.OrderInDeck;
    if (order !== 0) return order;
    return compareStrings(a.card.StableUid, b.card.StableUid);
  });

  return candidates.slice(0, count).map((entry) => entry.card.StableUid);
}
