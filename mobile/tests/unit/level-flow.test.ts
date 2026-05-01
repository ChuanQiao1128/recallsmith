import { describe, expect, it } from 'vitest';
import { advanceStage, applyLevelRating, createLevelSessionState, type LevelSessionCard } from '../../src/features/gacha/session/levelFlow';

const cards: LevelSessionCard[] = [
  {
    stableUid: '1',
    question: 'Q1',
    answer: 'A1',
    code: 'code',
    codeLanguage: 'csharp',
    irlPrompt: 'IRL',
    irlHint: 'hint',
    audience: 'Both',
    tag: 'async-await',
    difficulty: 1,
    rarity: 'COM',
  },
];

describe('level flow helpers', () => {
  it('advances stage order', () => {
    expect(advanceStage('q')).toBe('a');
    expect(advanceStage('a')).toBe('irl');
    expect(advanceStage('irl')).toBe('irl');
  });

  it('records ratings and finishes at the end of the card list', () => {
    const result = applyLevelRating({
      state: createLevelSessionState(),
      cards,
      rating: 'good',
    });

    expect(result.finished).toBe(true);
    expect(result.state.completedCount).toBe(1);
    expect(result.state.ratings).toEqual([{ stableUid: '1', rating: 'good' }]);
  });
});
