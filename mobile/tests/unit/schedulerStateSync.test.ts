import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null) } }));
vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => null) }));

import { mergeRemoteIntoLocalProgress } from '../../src/sync/progressSync';
import { scheduleWithFsrs } from '../../src/review/fsrsScheduler';
import { applyRemoteFeatures } from '../../src/config/featureFlags';

const T = 1_790_000_000_000;
const state = { lapses: 1, hardStreak: 0, fsrsStability: 0.39150242161493015,
  fsrsDifficulty: 6.607035107311108, fsrsAnchorAt: T, fsrsReviewedAt: T };
const reviewed = { stableUid: 'one', stage: 0, lastReviewedAt: T, nextReviewAt: T + 600_000, ...state };
function row(extra: object = {}) { return { deckSlug: 'deck', stableUid: 'one', status: 1,
  reviewCount: 2, lastRating: 1, lastReviewedAtMs: T, nextReviewAtMs: T + 600_000,
  srsStage: 0, updatedAtMs: T + 1, schedulerState: state, ...extra }; }

describe('scheduler state travels with its winning review', () => {
  it('restores all six fields into a fresh installation', () => {
    const result = mergeRemoteIntoLocalProgress([{ stableUid: 'one', stage: 0, nextReviewAt: T }], [row()] as any);
    expect(result.merged[0]).toMatchObject(reviewed);
  });
  it('fills the model when the core fields already match, then becomes a no-op', () => {
    const local = { stableUid: 'one', stage: 0, lastReviewedAt: T, nextReviewAt: T + 600_000 };
    const first = mergeRemoteIntoLocalProgress([local], [row()] as any);
    expect(first.changed).toBe(true);
    expect(first.merged[0]).toMatchObject(state);
    expect(mergeRemoteIntoLocalProgress(first.merged, [row()] as any).changed).toBe(false);
  });
  it('keeps a newer local review and its model', () => {
    const local = { ...reviewed, lastReviewedAt: T + 1000, fsrsAnchorAt: T + 1000, lapses: 3 };
    expect(mergeRemoteIntoLocalProgress([local], [row()] as any).merged[0]).toEqual(local);
  });
  it('clears stale model fields when a newer legacy review wins', () => {
    const result = mergeRemoteIntoLocalProgress([reviewed], [row({ lastReviewedAtMs: T + 1000,
      schedulerState: null })] as any);
    expect(result.merged[0].fsrsStability).toBeUndefined();
    expect(result.merged[0].lapses).toBeUndefined();
  });
  it('does not erase a matching local model when talking to the old server', () => {
    const old: any = row(); delete old.schedulerState;
    expect(mergeRemoteIntoLocalProgress([reviewed], [old]).merged[0]).toEqual(reviewed);
  });
  it('preserves an existing model when migration added a null state to the same old row', () => {
    expect(mergeRemoteIntoLocalProgress([reviewed], [row({ schedulerState: null })] as any).merged[0])
      .toEqual(reviewed);
  });
  it('rejects an unanchored model and invalid counters', () => {
    const result = mergeRemoteIntoLocalProgress([], [row({ schedulerState: { ...state,
      fsrsAnchorAt: T - 1, lapses: -3, hardStreak: '2' } })] as any);
    expect(result.merged[0].fsrsStability).toBeUndefined();
    expect(result.merged[0].lapses).toBeUndefined();
    expect(result.merged[0].hardStreak).toBeUndefined();
  });
  it('retains a local revision demotion instead of adopting the old schedule', () => {
    const local = { ...reviewed, stage: 0, nextReviewAt: T + 1, revisionDemotedAt: T + 1 };
    const result = mergeRemoteIntoLocalProgress([local], [row()] as any);
    expect(result.merged[0]).toEqual(local);
  });
  it('makes the next FSRS decision identical before and after restoration', () => {
    applyRemoteFeatures({ features: { fsrs: { enabled: true } } } as any);
    const restored = mergeRemoteIntoLocalProgress([], [row()] as any).merged[0];
    expect(scheduleWithFsrs(restored, 'good', T + 86_400_000))
      .toEqual(scheduleWithFsrs(reviewed, 'good', T + 86_400_000));
  });
});
