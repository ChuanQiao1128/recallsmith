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

import { EXAM_PACE_ANCHOR_KEY, resolveDayStartRemaining } from '../../src/features/goal/examPaceAnchor';

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();
const goal = { deckSlug: 'aws-saa-c03', examDate: '2026-10-22' };

describe('exam pace day-start anchor (U5)', () => {
  beforeEach(() => {
    asyncStore.clear();
    failing.on = false;
  });

  it('records the first look of the day and returns it for the rest of that day', async () => {
    expect(await resolveDayStartRemaining({ ...goal, remaining: 306, nowMs: at(2026, 10, 4, 8) })).toBe(306);
    expect(JSON.parse(asyncStore.get(EXAM_PACE_ANCHOR_KEY)!)).toEqual({ dayKey: '2026-10-04', ...goal, remaining: 306 });
    // Learning during the day lowers "remaining", not the day's start.
    expect(await resolveDayStartRemaining({ ...goal, remaining: 290, nowMs: at(2026, 10, 4, 20) })).toBe(306);
    expect(JSON.parse(asyncStore.get(EXAM_PACE_ANCHOR_KEY)!).remaining).toBe(306);
  });

  it('starts again on a new day, another goal deck or another exam date', async () => {
    await resolveDayStartRemaining({ ...goal, remaining: 306, nowMs: at(2026, 10, 4) });
    expect(await resolveDayStartRemaining({ ...goal, remaining: 288, nowMs: at(2026, 10, 5, 7) })).toBe(288);
    expect(await resolveDayStartRemaining({ ...goal, deckSlug: 'csharp-basics', remaining: 200, nowMs: at(2026, 10, 5, 9) })).toBe(200);
    expect(await resolveDayStartRemaining({ deckSlug: 'csharp-basics', examDate: '2026-10-29', remaining: 190, nowMs: at(2026, 10, 5, 10) })).toBe(190);
  });

  it('moves the start up when more is left than it recorded (the deck grew)', async () => {
    await resolveDayStartRemaining({ ...goal, remaining: 306, nowMs: at(2026, 10, 4, 8) });
    expect(await resolveDayStartRemaining({ ...goal, remaining: 330, nowMs: at(2026, 10, 4, 9) })).toBe(330);
    expect(JSON.parse(asyncStore.get(EXAM_PACE_ANCHOR_KEY)!).remaining).toBe(330);
  });

  it('treats a corrupt record as none, and a storage error as the live count', async () => {
    asyncStore.set(EXAM_PACE_ANCHOR_KEY, '{not json');
    expect(await resolveDayStartRemaining({ ...goal, remaining: 10, nowMs: at(2026, 10, 4) })).toBe(10);
    asyncStore.set(EXAM_PACE_ANCHOR_KEY, JSON.stringify({ dayKey: '2026-10-04', ...goal, remaining: -3 }));
    expect(await resolveDayStartRemaining({ ...goal, remaining: 10, nowMs: at(2026, 10, 4) })).toBe(10);
    failing.on = true;
    await expect(resolveDayStartRemaining({ ...goal, remaining: 7, nowMs: at(2026, 10, 4) })).resolves.toBe(7);
  });
});
