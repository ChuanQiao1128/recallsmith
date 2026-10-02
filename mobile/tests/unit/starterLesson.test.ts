import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

const recordFunnelEventMock = vi.fn();
vi.mock('../../src/telemetry/funnel', () => ({
  recordFunnelEvent: (...args: unknown[]) => recordFunnelEventMock(...args),
}));

import type { CardProgress } from '../../src/review/model';
import { setActiveUserSubForStorage } from '../../src/review/storage';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { loadDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { loadDeckWallet } from '../../src/features/gacha/rewards/deckWallet';
import { getOnboardingStage, startStarterLesson } from '../../src/features/gacha/onboarding/onboardingPrefs';
import {
  STARTER_LESSON_KEY,
  STARTER_LESSON_SIZE,
  ensureStarterLesson,
  isStarterLessonComplete,
  isStarterLessonDeck,
  isStarterLessonOpen,
  loadStarterUids,
  pickStarterUids,
} from '../../src/features/gacha/starter/starterGate';
import { completeStarterLesson, skipStarterLesson } from '../../src/features/gacha/starter/starterLesson';
import { ensureDeckBootstrap } from '../../src/features/gacha/rewards/deckWallet';
import { isPermissionPromptPending } from '../../src/features/gacha/starter/permissionPromptGate';

const STAGE_KEY = 'recallsmith:onboarding:stage:v1';
const GOAL_KEY = 'recallsmith:study-goal:v1';

const MCQ = {
  v: 1,
  qualifier: null,
  shuffle: true,
  options: [
    { key: 'a', text: 'Right', why: null, correct: true },
    { key: 'b', text: 'Wrong one', why: 'Because b is wrong.', correct: false },
    { key: 'c', text: 'Wrong two', why: 'Because c is wrong.', correct: false },
  ],
};

const qa = (StableUid: string, OrderInDeck: number) => ({ StableUid, OrderInDeck });
const mcq = (StableUid: string, OrderInDeck: number) => ({ StableUid, OrderInDeck, Mcq: MCQ });

function learned(stableUid: string): CardProgress {
  return { stableUid, stage: 0, lastReviewedAt: 1_000, nextReviewAt: 2_000 };
}
function untouched(stableUid: string): CardProgress {
  return { stableUid, stage: 0, nextReviewAt: 0 };
}

describe('starter lesson', () => {
  beforeEach(() => {
    store.clear();
    recordFunnelEventMock.mockClear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage(null);
  });

  it('picks the first 5 cards in deck order, MCQ cards excluded', () => {
    expect(STARTER_LESSON_SIZE).toBe(5);
    const cards = [qa('q7', 70), mcq('m1', 10), qa('q2', 20), qa('q3', 30), mcq('m4', 40), qa('q5', 50), qa('q6', 60), qa('q8', 80)];
    expect(pickStarterUids(cards)).toEqual(['q2', 'q3', 'q5', 'q6', 'q7']);
    expect(pickStarterUids([mcq('m1', 1), qa('q1', 2)])).toEqual(['q1']);
    expect(pickStarterUids([])).toEqual([]);
  });

  it('opens with the goal step and records the goal deck lesson once', async () => {
    expect(await isStarterLessonOpen()).toBe(false);
    await startStarterLesson();
    expect(await getOnboardingStage()).toBe('starter');
    expect(await isStarterLessonOpen()).toBe(true);

    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'aws-saa-c03', examDate: null }));
    // Not the goal deck: no lesson there.
    expect(await ensureStarterLesson({ Slug: 'csharp-basics', Cards: [qa('c1', 1)] })).toBeNull();

    const deck = { Slug: 'aws-saa-c03', Cards: [qa('a1', 1), qa('a2', 2), mcq('a3', 3), qa('a4', 4), qa('a5', 5), qa('a6', 6), qa('a7', 7)] };
    const lesson = await ensureStarterLesson(deck);
    expect(lesson).toEqual({ slug: 'aws-saa-c03', uids: ['a1', 'a2', 'a4', 'a5', 'a6'] });

    // A later deck update does not reshuffle the lesson the learner started.
    const updated = { ...deck, Cards: [qa('new', 0), ...deck.Cards] };
    expect(await ensureStarterLesson(updated)).toEqual(lesson);
    expect([...(await loadStarterUids('aws-saa-c03'))]).toEqual(['a1', 'a2', 'a4', 'a5', 'a6']);
    expect((await loadStarterUids('csharp-basics')).size).toBe(0);
  });

  it('is complete once every lesson card the deck still holds has been studied', () => {
    const lesson = { slug: 'aws', uids: ['a1', 'a2', 'gone'] };
    expect(isStarterLessonComplete(lesson, [learned('a1'), untouched('a2')])).toBe(false);
    expect(isStarterLessonComplete(lesson, [learned('a1'), learned('a2')])).toBe(true);
    expect(isStarterLessonComplete({ slug: 'aws', uids: [] }, [untouched('a1')])).toBe(true);
  });

  it('completing closes the stage, grants the 3-pull bootstrap and arms the reminder prompt', async () => {
    await startStarterLesson();
    await ensureStarterLesson({ Slug: 'aws', Cards: [qa('a1', 1)] });
    expect(await isPermissionPromptPending()).toBe(false);
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 0, reservePulls: 0 });

    const result = await completeStarterLesson('aws');

    expect(result).toEqual({ completed: true, granted: 3, wallet: { availablePulls: 3, reservePulls: 0 } });
    expect(await getOnboardingStage()).toBe('done');
    expect(store.has(STARTER_LESSON_KEY)).toBe(false);
    expect(await isPermissionPromptPending()).toBe(true);
    // The lesson's cards were never written into the draw state.
    expect((await loadDrawState('aws')).owned).toEqual([]);
    // R24 M01: the anonymous funnel step, once, with the lesson deck.
    expect(recordFunnelEventMock).toHaveBeenCalledTimes(1);
    expect(recordFunnelEventMock).toHaveBeenCalledWith('starter_completed', 'aws');
  });

  it('existing users (stage done) never see the lesson', async () => {
    store.set(STAGE_KEY, 'done');
    expect(await isStarterLessonOpen()).toBe(false);
    expect(await ensureStarterLesson({ Slug: 'aws', Cards: [qa('a1', 1)] })).toBeNull();
    expect(store.has(STARTER_LESSON_KEY)).toBe(false);
    expect((await completeStarterLesson('aws')).completed).toBe(false);
    expect(await isPermissionPromptPending()).toBe(false);
    expect(recordFunnelEventMock).not.toHaveBeenCalled();
  });

  it('skipping a lesson that cannot run closes the stage and lets every pack bootstrap as before', async () => {
    await startStarterLesson();
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'csharp-basics', examDate: null }));
    // While open, no pack bootstraps -- the lock the skip exists to release.
    expect((await ensureDeckBootstrap('aws')).granted).toBe(0);

    expect(await skipStarterLesson()).toBe(true);

    expect(await getOnboardingStage()).toBe('done');
    expect(store.has(STARTER_LESSON_KEY)).toBe(false);
    // The prompt is armed so the first DrawResult "Done" still offers reminders.
    expect(await isPermissionPromptPending()).toBe(true);
    // The skip itself grants nothing; the ordinary first-visit bootstrap now pays on any pack.
    expect(await loadDeckWallet('csharp-basics')).toEqual({ availablePulls: 0, reservePulls: 0 });
    expect((await ensureDeckBootstrap('aws')).granted).toBe(3);
    // A second skip (or an existing user) changes nothing.
    expect(await skipStarterLesson()).toBe(false);
  });

  it('knows which deck the open lesson teaches', async () => {
    expect(await isStarterLessonDeck('aws')).toBe(false); // closed (welcome)
    await startStarterLesson();
    // No goal, no record: whichever deck opens first becomes the lesson (ensureStarterLesson's rule).
    expect(await isStarterLessonDeck('aws')).toBe(true);
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'csharp-basics', examDate: null }));
    expect(await isStarterLessonDeck('aws')).toBe(false);
    expect(await isStarterLessonDeck('csharp-basics')).toBe(true);
    // A recorded lesson wins over the goal.
    store.set(STARTER_LESSON_KEY, JSON.stringify({ slug: 'aws', uids: ['a1'] }));
    expect(await isStarterLessonDeck('aws')).toBe(true);
    expect(await isStarterLessonDeck('csharp-basics')).toBe(false);
    store.set(STAGE_KEY, 'done');
    expect(await isStarterLessonDeck('aws')).toBe(false);
  });
});
