import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getAllKeys: vi.fn(async () => Array.from(store.keys())),
    multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, store.get(key) ?? null])),
    multiSet: vi.fn(async (entries: [string, string][]) => {
      for (const [key, value] of entries) store.set(key, value);
    }),
  },
}));

import { formatDateKey } from '../../src/review/model';
import { resetAllReviewSchedules, setActiveUserSubForStorage } from '../../src/review/storage';

describe('resetAllReviewSchedules', () => {
  beforeEach(() => {
    store.clear();
    setActiveUserSubForStorage('user-123');
  });

  it('resets learned cards to today while preserving unlearned cards and clearing daily done count', async () => {
    const now = new Date('2026-04-23T12:00:00.000Z');
    const nowMs = now.getTime();

    store.set(
      'devcards:u:user-123:deck-progress:csharp',
      JSON.stringify([
        { stableUid: 'learned', stage: 2, lastReviewedAt: nowMs - 1000, nextReviewAt: nowMs + 5000 },
        { stableUid: 'new', stage: 0, nextReviewAt: 0 },
      ]),
    );
    store.set(
      'devcards:u:user-123:deck-daily-stats:csharp',
      JSON.stringify({ dateKey: '2026-04-20', plannedCount: 7, doneCount: 5 }),
    );
    store.set(
      'devcards:u:other-user:deck-progress:java',
      JSON.stringify([{ stableUid: 'other', stage: 2, lastReviewedAt: nowMs - 1000, nextReviewAt: nowMs + 9999 }]),
    );

    await resetAllReviewSchedules(now);

    const progress = JSON.parse(store.get('devcards:u:user-123:deck-progress:csharp') ?? '[]');
    const daily = JSON.parse(store.get('devcards:u:user-123:deck-daily-stats:csharp') ?? '{}');
    const otherProgress = JSON.parse(store.get('devcards:u:other-user:deck-progress:java') ?? '[]');

    expect(progress[0].nextReviewAt).toBe(nowMs);
    expect(progress[1].nextReviewAt).toBe(0);
    expect(daily.dateKey).toBe(formatDateKey(now));
    expect(daily.doneCount).toBe(0);
    expect(daily.plannedCount).toBe(7);
    expect(otherProgress[0].nextReviewAt).toBe(nowMs + 9999);
  });
});
