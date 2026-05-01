import type { ReviewRating } from '../../../review/model';

export type LevelStage = 'q' | 'a' | 'irl';

export type LevelSessionCard = {
  stableUid: string;
  question: string;
  answer: string;
  code: string;
  codeLanguage: string;
  irlPrompt: string;
  irlHint: string;
  audience: string;
  tag: string;
  difficulty: number;
  rarity: 'COM' | 'RAR' | 'LEG';
};

export type LevelSessionState = {
  stage: LevelStage;
  cardIndex: number;
  completedCount: number;
  ratings: Array<{ stableUid: string; rating: ReviewRating }>;
  perCardAgainCount: Record<string, number>;
  perCardHardStreak: Record<string, number>;
};

export function createLevelSessionState(): LevelSessionState {
  return {
    stage: 'q',
    cardIndex: 0,
    completedCount: 0,
    ratings: [],
    perCardAgainCount: {},
    perCardHardStreak: {},
  };
}

export function advanceStage(stage: LevelStage): LevelStage {
  if (stage === 'q') return 'a';
  if (stage === 'a') return 'irl';
  return 'irl';
}

export function applyLevelRating(params: {
  state: LevelSessionState;
  cards: LevelSessionCard[];
  rating: ReviewRating;
}): {
  state: LevelSessionState;
  finished: boolean;
  triggeredLeech: boolean;
  demoted: boolean;
} {
  const { state, cards, rating } = params;
  const card = cards[state.cardIndex];
  if (!card) {
    return { state, finished: true, triggeredLeech: false, demoted: false };
  }

  const againCount = (state.perCardAgainCount[card.stableUid] ?? 0) + (rating === 'again' ? 1 : 0);
  const hardStreak = rating === 'hard' ? (state.perCardHardStreak[card.stableUid] ?? 0) + 1 : 0;
  const triggeredLeech = hardStreak >= 3 || againCount >= 5;
  const demoted = againCount >= 3;

  const nextState: LevelSessionState = {
    stage: 'q',
    cardIndex: state.cardIndex + 1,
    completedCount: state.completedCount + 1,
    ratings: [...state.ratings, { stableUid: card.stableUid, rating }],
    perCardAgainCount: {
      ...state.perCardAgainCount,
      [card.stableUid]: againCount,
    },
    perCardHardStreak: {
      ...state.perCardHardStreak,
      [card.stableUid]: hardStreak,
    },
  };

  return {
    state: nextState,
    finished: nextState.cardIndex >= cards.length,
    triggeredLeech,
    demoted,
  };
}
