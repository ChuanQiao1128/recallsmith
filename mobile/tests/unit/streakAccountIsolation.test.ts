import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => store.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
} }));
import { setActiveUserSubForStorage } from '../../src/review/storage';
import { applySessionStreak, loadStreakSnapshot } from '../../src/features/gacha/streaks/streakTracker';

const base = 'recallsmith:streaks:snapshot:v1';
const complete = (sessionId: string) => applySessionStreak({ sessionId, earned: true, now: new Date(2026, 9, 22, 12) });

describe('account-scoped learning statistics', () => {
  beforeEach(() => {
    store.clear();
    vi.mocked(AsyncStorage.setItem).mockClear();
    setActiveUserSubForStorage('a');
  });

  it('isolates A, B and guest, including their session receipts', async () => {
    await complete('same-session');
    expect((await complete('same-session')).applied).toBe(false);
    setActiveUserSubForStorage('b');
    expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(0);
    await complete('same-session');
    await complete('b-second');
    setActiveUserSubForStorage(null);
    expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(0);
    await complete('guest-session');
    setActiveUserSubForStorage('a');
    expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(1);
    setActiveUserSubForStorage('b');
    expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(2);
  });

  it('does not assign ownerless legacy totals to the first account or guest', async () => {
    store.set(base, JSON.stringify({ totalQualifiedSessions: 10, currentDailyStreak: 3 }));
    for (const owner of ['a', 'b', null]) {
      setActiveUserSubForStorage(owner);
      expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(0);
    }
    expect(store.has(base)).toBe(true);
  });

  it('serializes concurrent completions and duplicate deliveries', async () => {
    const results = await Promise.all([complete('one'), complete('two'), complete('one')]);
    expect(results.filter(result => result.applied)).toHaveLength(2);
    const snapshot = await loadStreakSnapshot();
    expect(snapshot.totalQualifiedSessions).toBe(2);
    expect(snapshot.currentDailyStreak).toBe(1);
  });

  it('commits the snapshot and receipt together and retries a failed write once', async () => {
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(complete('retry')).rejects.toThrow('disk unavailable');
    expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(0);
    await complete('retry');
    expect((await complete('retry')).applied).toBe(false);
    const record = JSON.parse(store.get(`devcards:u:a:${base}`)!);
    expect(record.totalQualifiedSessions).toBe(1);
    expect(record.appliedSessions).toEqual({ retry: true });
    expect([...store.keys()].filter(key => key.includes('streaks:'))).toHaveLength(1);
  });

  it('keeps a queued completion in its initiating account after switching', async () => {
    const pending = complete('late-a');
    setActiveUserSubForStorage('b');
    await pending;
    expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(0);
    setActiveUserSubForStorage('a');
    expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(1);
  });

  it('does not overwrite existing statistics when their storage read fails', async () => {
    await complete('first');
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('read failed'));
    await expect(complete('second')).rejects.toThrow('read failed');
    expect((await loadStreakSnapshot()).totalQualifiedSessions).toBe(1);
  });
});
