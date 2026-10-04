import { beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStore, failing } = vi.hoisted(() => ({ asyncStore: new Map<string, string>(), failing: { on: false } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => {
      if (failing.on) throw new Error('disk');
      return asyncStore.has(k) ? asyncStore.get(k)! : null;
    }),
    setItem: vi.fn(async (k: string, v: string) => {
      if (failing.on) throw new Error('disk');
      asyncStore.set(k, v);
    }),
  },
}));

import { buildExamPace, examPaceLabel } from '../../src/features/goal/examPace';
import { EXAM_PACE_ANCHOR_KEY, resolveDayStartLearned } from '../../src/features/goal/examPaceAnchor';
import { REMOTE_PROGRESS_CURSOR_MS_KEY } from '../../src/features/gacha/rewards/progressSettled';
import { setActiveUserSubForStorage } from '../../src/review/storage';

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();
const goal = { deckSlug: 'aws-saa-c03', examDate: '2026-10-22' };

// The record lives in the progress partition (review/storage.ts getUserScopedKey), the same one
// Home's learned count is read from.
const ANON_KEY = `devcards:u:anon:${EXAM_PACE_ANCHOR_KEY}`;
const userKey = (sub: string) => `devcards:u:${sub}:${EXAM_PACE_ANCHOR_KEY}`;
// A remote progress pull has landed for this user on this device (progressSettled.ts).
const settle = (sub: string) => asyncStore.set(`devcards:u:${sub}:${REMOTE_PROGRESS_CURSOR_MS_KEY}`, '1');
const record = (key: string) => JSON.parse(asyncStore.get(key)!);
// Who is signed in, the way auth sets it: the stored key and the storage module's cache together.
const signIn = (sub: string | null) => {
  if (sub) asyncStore.set('devcards:auth:activeUserSub:v1', sub);
  else asyncStore.delete('devcards:auth:activeUserSub:v1');
  setActiveUserSubForStorage(sub);
};

describe('exam pace day-start anchor (U5)', () => {
  beforeEach(() => {
    asyncStore.clear();
    failing.on = false;
    signIn(null);
  });

  it('records the first look of the day and returns it for the rest of that day', async () => {
    expect(await resolveDayStartLearned({ ...goal, learned: 65, nowMs: at(2026, 10, 4, 8) })).toBe(65);
    expect(record(ANON_KEY)).toEqual({ dayKey: '2026-10-04', ...goal, learned: 65 });
    expect(asyncStore.has(EXAM_PACE_ANCHOR_KEY)).toBe(false); // never device-global
    // Learning during the day raises "learned", not the day's start.
    expect(await resolveDayStartLearned({ ...goal, learned: 81, nowMs: at(2026, 10, 4, 20) })).toBe(65);
    expect(record(ANON_KEY).learned).toBe(65);
  });

  it('starts again on a new day, another goal deck or another exam date', async () => {
    await resolveDayStartLearned({ ...goal, learned: 65, nowMs: at(2026, 10, 4) });
    expect(await resolveDayStartLearned({ ...goal, learned: 83, nowMs: at(2026, 10, 5, 7) })).toBe(83);
    expect(await resolveDayStartLearned({ ...goal, deckSlug: 'csharp-basics', learned: 17, nowMs: at(2026, 10, 5, 9) })).toBe(17);
    expect(await resolveDayStartLearned({ deckSlug: 'csharp-basics', examDate: '2026-10-29', learned: 27, nowMs: at(2026, 10, 5, 10) })).toBe(27);
  });

  it('moves the start down when fewer cards are learned than it recorded (progress was reset)', async () => {
    await resolveDayStartLearned({ ...goal, learned: 65, nowMs: at(2026, 10, 4, 8) });
    expect(await resolveDayStartLearned({ ...goal, learned: 0, nowMs: at(2026, 10, 4, 9) })).toBe(0);
    expect(record(ANON_KEY).learned).toBe(0);
  });

  it('keeps one record per account partition: signing in the same day is not counted as today’s work', async () => {
    // A reinstall: onboarding on the anon partition sets the goal, Home's first look records 0 of 371.
    expect(await resolveDayStartLearned({ ...goal, learned: 0, nowMs: at(2026, 10, 4, 9) })).toBe(0);

    // At noon the learner signs in to an account that has 200 learned (its pull has landed).
    signIn('sub-a');
    settle('sub-a');
    const dayStart = await resolveDayStartLearned({ ...goal, learned: 200, nowMs: at(2026, 10, 4, 12) });
    expect(dayStart).toBe(200);
    expect(record(userKey('sub-a'))).toEqual({ dayKey: '2026-10-04', ...goal, learned: 200 });
    expect(record(ANON_KEY).learned).toBe(0); // the anon record is left alone, not reused
    const pace = buildExamPace({ examDate: goal.examDate, totalCards: 371, learnedCards: 200, nowMs: at(2026, 10, 4, 12), learnedAtDayStart: dayStart });
    expect(examPaceLabel(pace)).toBe('≈ 11 cards/day to be ready by Oct 21');

    // 5 learned in the account, sign out (anon: still 0 learned there), sign back in: the account's
    // own record still holds, so the 5 count and nothing else does.
    expect(await resolveDayStartLearned({ ...goal, learned: 205, nowMs: at(2026, 10, 4, 14) })).toBe(200);
    signIn(null);
    expect(await resolveDayStartLearned({ ...goal, learned: 0, nowMs: at(2026, 10, 4, 15) })).toBe(0);
    signIn('sub-a');
    expect(await resolveDayStartLearned({ ...goal, learned: 205, nowMs: at(2026, 10, 4, 16) })).toBe(200);

    // Another account on the same device and day gets its own record.
    signIn('sub-b');
    settle('sub-b');
    expect(await resolveDayStartLearned({ ...goal, learned: 40, nowMs: at(2026, 10, 4, 17) })).toBe(40);
    expect(record(userKey('sub-b')).learned).toBe(40);
    expect(record(userKey('sub-a')).learned).toBe(200);
  });

  it('writes no record for a signed-in partition until its remote progress has landed', async () => {
    signIn('sub-a');
    // Signed in on a new phone; the first pull has not landed, so this device knows 0 learned.
    expect(await resolveDayStartLearned({ ...goal, learned: 0, nowMs: at(2026, 10, 4, 9) })).toBe(0);
    expect(asyncStore.has(userKey('sub-a'))).toBe(false);
    // The pull lands with 200 learned: the first settled look is today's start, not "200 done today".
    settle('sub-a');
    expect(await resolveDayStartLearned({ ...goal, learned: 200, nowMs: at(2026, 10, 4, 10) })).toBe(200);
    expect(record(userKey('sub-a')).learned).toBe(200);
  });

  it('treats a corrupt record as none, and a storage error as the live count', async () => {
    asyncStore.set(ANON_KEY, '{not json');
    expect(await resolveDayStartLearned({ ...goal, learned: 10, nowMs: at(2026, 10, 4) })).toBe(10);
    asyncStore.set(ANON_KEY, JSON.stringify({ dayKey: '2026-10-04', ...goal, learned: -3 }));
    expect(await resolveDayStartLearned({ ...goal, learned: 10, nowMs: at(2026, 10, 4) })).toBe(10);
    asyncStore.set(ANON_KEY, JSON.stringify({ dayKey: '2026-10-04', ...goal, remaining: 300 })); // the old shape
    expect(await resolveDayStartLearned({ ...goal, learned: 10, nowMs: at(2026, 10, 4) })).toBe(10);
    failing.on = true;
    await expect(resolveDayStartLearned({ ...goal, learned: 7, nowMs: at(2026, 10, 4) })).resolves.toBe(7);
  });
});
