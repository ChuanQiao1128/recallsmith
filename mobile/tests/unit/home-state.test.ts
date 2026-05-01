import { describe, expect, it } from 'vitest';
import { resolveHomeState } from '../../src/features/gacha/home/homeStateMachine';

describe('home state machine', () => {
  it('returns reward-ready when the user has pulls and no pressure', () => {
    expect(
      resolveHomeState({
        dueCount: 0,
        newCount: 0,
        wallet: { availablePulls: 2, reservePulls: 0 },
        streakCount: 3,
      }),
    ).toBe('reward-ready');
  });

  it('returns backlog when due count is heavy', () => {
    expect(
      resolveHomeState({
        dueCount: 24,
        newCount: 0,
        wallet: { availablePulls: 0, reservePulls: 0 },
        streakCount: 4,
      }),
    ).toBe('backlog');
  });
});
