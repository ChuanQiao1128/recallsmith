import type { ReviewRating } from '../../../review/model';
import type { LevelSessionCard } from '../session/levelFlow';

export type SettlementVM = {
  title: string;
  progressHeadline: string;
  nextRecommendation: string;
  pullsAwarded: number;
  masteredCount: number;
  streakDelta: number;
};

export function buildSettlementVm(params: {
  deckTitle: string;
  cards: LevelSessionCard[];
  ratings: Array<{ stableUid: string; rating: ReviewRating }>;
}): SettlementVM {
  const { deckTitle, cards, ratings } = params;
  const goodish = ratings.filter((item) => item.rating === 'good' || item.rating === 'easy').length;
  const hardish = ratings.filter((item) => item.rating === 'hard').length;
  const masteredCount = ratings.filter((item) => {
    const card = cards.find((entry) => entry.stableUid === item.stableUid);
    return (item.rating === 'good' || item.rating === 'easy') && (card?.rarity === 'RAR' || card?.rarity === 'LEG');
  }).length;
  const pullsAwarded = Math.max(1, Math.min(5, Math.ceil(goodish / 2)));
  const streakDelta = ratings.some((item) => item.rating !== 'again') ? 1 : 0;
  const progressHeadline = `${goodish} strong recall${goodish === 1 ? '' : 's'} · ${hardish} card${hardish === 1 ? '' : 's'} needed extra effort in ${deckTitle}.`;

  return {
    title: `${deckTitle} run complete`,
    progressHeadline,
    nextRecommendation: pullsAwarded > 0 ? 'Use Draw for the reward loop or return Home for another route.' : 'Return Home for a shorter follow-up route.',
    pullsAwarded,
    masteredCount,
    streakDelta,
  };
}
