import { rarityOfCard } from './cardRarity';
import { loadOwnedSet, markCardsOwned } from './ownedStore';
import { loadPityState, savePityState } from './pity';
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

export async function commitDraw(slug: string, drawCount: 1 | 10): Promise<DrawCommitResult | null> {
  const [{ resolveDeckBySlug }, { loadDeckProgress }] = await Promise.all([
    import('../../../content/deckRepository'),
    import('../../../review/storage'),
  ]);
  const deck = await resolveDeckBySlug(slug);
  if (!deck) return null;

  const [progress, ownedSet, pityState] = await Promise.all([
    loadDeckProgress(deck),
    loadOwnedSet(slug),
    loadPityState(slug),
  ]);

  const selection = selectDrawCards({
    deckCards: deck.Cards,
    ownedSet,
    progress,
    drawCount,
    pityState,
    seed: Date.now(),
  });

  const drawnUids = selection.cards.map((card) => card.StableUid);
  const ownedAfterSet =
    drawnUids.length > 0
      ? await markCardsOwned(slug, drawnUids)
      : ownedSet;
  await savePityState(slug, selection.pityNext);

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
