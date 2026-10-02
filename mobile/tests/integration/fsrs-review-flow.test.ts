// F03 (contract R24-00 §4.3), end to end below the screen: a new Q/A card passes
// its learning check, is rated Good on its due day, then Good again on the next
// due day. Each rating goes through the session's real save path
// (buildRatedSessionState) and the real event recorder, and the test reads the
// events back out of the offline queue as they would be pushed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

let uuidN = 0;
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => `evt-${++uuidN}`) }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
// Signed out: nothing reaches the network, the events wait in the pending queue.
vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async () => ({ success: false, data: null, error: { code: 'OFFLINE' }, traceId: 't', version: '1' })),
}));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => null) }));
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  saveDeckProgress: vi.fn(async () => undefined),
  setActiveUserSubForStorage: vi.fn(),
}));

import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import type { CardProgress, ReviewRating } from '../../src/review/model';
import { invalidateProgressQueueCache } from '../../src/sync/progressQueueCache';
import { getSchedulerVersion, recordReviewEvent, type ProgressEvent } from '../../src/sync/progressSync';
import type { CardExport } from '../../src/types/deckExport';

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
const CARD: CardExport = { StableUid: 'qa-1', OrderInDeck: 1, Difficulty: 1, Question: 'What does SQS decouple?' };

beforeEach(() => {
  // The queue is cached in memory too; both go so every case starts with an empty queue.
  store.clear();
  invalidateProgressQueueCache();
  applyRemoteFeatures(null);
});

afterEach(() => {
  applyRemoteFeatures(null);
});

/** One rating through the session save path, then the event the screen records for it. */
async function rateAndRecord(
  progress: CardProgress,
  rating: ReviewRating,
  atMs: number,
  reviewStage: 'learning_check' | 'repeat_review',
): Promise<CardProgress> {
  const { updatedOne } = buildRatedSessionState({
    current: { card: CARD, progress },
    progress: [progress],
    rating,
    mode: 'mixed',
    sessionDone: 0,
    sessionLimit: 5,
    now: new Date(atMs),
    cardIndex: null,
    learningCheck: reviewStage === 'learning_check',
  });
  const id = await recordReviewEvent({
    deckSlug: 'aws',
    stableUid: updatedOne.stableUid,
    rating,
    reviewedAtMs: atMs,
    reviewStage,
    progressAfter: updatedOne,
    lastSeenRevision: updatedOne.lastSeenRevision,
  });
  expect(id).not.toBeNull();
  return updatedOne;
}

function queuedEvents(): ProgressEvent[] {
  const keys = [...store.keys()].filter((k) => k.endsWith('sync:progressQueue:v1'));
  expect(keys).toHaveLength(1);
  return JSON.parse(store.get(keys[0])!) as ProgressEvent[];
}

describe('FSRS review flow: learning check, then Good on each due day', () => {
  it('schedules 1, 3 then 9 days and stamps every queued event fsrs-5', async () => {
    const fresh: CardProgress = { stableUid: 'qa-1', stage: 0, nextReviewAt: 0 };

    // The recall check at the end of the first session: Remembered = hard, due tomorrow.
    const afterCheck = await rateAndRecord(fresh, 'hard', T0, 'learning_check');
    expect(afterCheck.nextReviewAt).toBe(T0 + DAY_MS);
    expect(afterCheck.fsrsStability).toBeCloseTo(1.1839, 4);
    expect(afterCheck.fsrsDifficulty).toBeCloseTo(6.4883, 4);

    // Good on the due day: FSRS from that state after one day, 3 days (the ladder said 2).
    const day1 = afterCheck.nextReviewAt;
    const afterGood = await rateAndRecord(afterCheck, 'good', day1, 'repeat_review');
    expect(afterGood.nextReviewAt).toBe(day1 + 3 * DAY_MS);
    expect(afterGood.fsrsStability).toBeCloseTo(3.4452, 4);
    expect(afterGood.fsrsDifficulty).toBeCloseTo(6.4733, 4);
    expect(afterGood.fsrsAnchorAt).toBe(day1);
    expect(afterGood.stage).toBe(1);

    // Good again on that due day: 9 days (the ladder said 4).
    const day4 = afterGood.nextReviewAt;
    const afterGood2 = await rateAndRecord(afterGood, 'good', day4, 'repeat_review');
    expect(afterGood2.nextReviewAt).toBe(day4 + 9 * DAY_MS);
    expect(afterGood2.fsrsStability).toBeCloseTo(9.4222, 4);
    expect(afterGood2.fsrsDifficulty).toBeCloseTo(6.4583, 4);
    expect(afterGood2.stage).toBe(3);

    const events = queuedEvents();
    expect(events.map((e) => e.schedulerVersion)).toEqual(['fsrs-5', 'fsrs-5', 'fsrs-5']);
    expect(events.map((e) => e.reviewStage)).toEqual(['learning_check', 'repeat_review', 'repeat_review']);
    expect(events.map((e) => e.rating)).toEqual([2, 3, 3]);
    expect(events.map((e) => (e.progressAfter!.nextReviewAt - e.reviewedAtMs) / DAY_MS)).toEqual([1, 3, 9]);
    expect(events[2].progressAfter).toEqual(afterGood2);
  });

  it('with features.fsrs off, the same flow is the ladder (1, 2, 4 days) stamped ladder-v1', async () => {
    applyRemoteFeatures({ features: { fsrs: { enabled: false } } } as unknown as RemoteConfig);
    const fresh: CardProgress = { stableUid: 'qa-1', stage: 0, nextReviewAt: 0 };

    const afterCheck = await rateAndRecord(fresh, 'hard', T0, 'learning_check');
    const afterGood = await rateAndRecord(afterCheck, 'good', afterCheck.nextReviewAt, 'repeat_review');
    await rateAndRecord(afterGood, 'good', afterGood.nextReviewAt, 'repeat_review');

    const events = queuedEvents();
    expect(events.map((e) => e.schedulerVersion)).toEqual(['ladder-v1', 'ladder-v1', 'ladder-v1']);
    expect(events.map((e) => (e.progressAfter!.nextReviewAt - e.reviewedAtMs) / DAY_MS)).toEqual([1, 2, 4]);
    expect(events.every((e) => e.progressAfter!.fsrsAnchorAt === undefined)).toBe(true);
  });
});

describe('getSchedulerVersion', () => {
  it("is 'fsrs-5' by default and 'ladder-v1' with the kill switch off", () => {
    expect(getSchedulerVersion()).toBe('fsrs-5');
    applyRemoteFeatures({ features: { fsrs: { enabled: false } } } as unknown as RemoteConfig);
    expect(getSchedulerVersion()).toBe('ladder-v1');
    applyRemoteFeatures({ features: { fsrs: { enabled: true } } } as unknown as RemoteConfig);
    expect(getSchedulerVersion()).toBe('fsrs-5');
  });
});
