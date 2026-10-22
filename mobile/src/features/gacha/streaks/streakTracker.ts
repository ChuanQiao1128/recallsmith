import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserScopedKey } from '../../../review/storage';

const STREAK_SNAPSHOT_KEY = 'recallsmith:streaks:snapshot:v1';
// Snapshot and receipts commit together. Unscoped historical totals have no
// reliable owner, so they are retained but never claimed by a new account.
type StreakRecord = StreakSnapshot & { appliedSessions: Record<string, true> };
const writes = new Map<string, Promise<unknown>>();

async function withRecord<T>(key: string, update: () => Promise<T>): Promise<T> {
  const previous = writes.get(key) ?? Promise.resolve();
  const run = previous.then(update, update);
  writes.set(key, run);
  try { return await run; }
  finally { if (writes.get(key) === run) writes.delete(key); }
}

async function readRecord(key: string): Promise<StreakRecord> {
  const raw = await AsyncStorage.getItem(key);
  const parsed = raw ? JSON.parse(raw) : null;
  const appliedSessions: Record<string, true> = Object.create(null);
  if (parsed?.appliedSessions && typeof parsed.appliedSessions === 'object') {
    for (const [id, applied] of Object.entries(parsed.appliedSessions)) {
      if (applied === true) appliedSessions[id] = true;
    }
  }
  return { ...normalizeSnapshot(parsed), appliedSessions };
}

export type StreakSnapshot = {
  currentDailyStreak: number;
  longestDailyStreak: number;
  weekCompletedDays: number;
  totalQualifiedSessions: number;
  lastQualifiedDateKey: string | null;
  currentWeekKey: string | null;
};

export type ApplySessionStreakResult = {
  applied: boolean;
  before: StreakSnapshot;
  after: StreakSnapshot;
  countedToday: boolean;
};

const EMPTY_SNAPSHOT: StreakSnapshot = {
  currentDailyStreak: 0,
  longestDailyStreak: 0,
  weekCompletedDays: 0,
  totalQualifiedSessions: 0,
  lastQualifiedDateKey: null,
  currentWeekKey: null,
};

function formatDateKeyLocal(now: Date): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getPreviousDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() - 1);
  return formatDateKeyLocal(date);
}

function getWeekKey(now: Date): string {
  const date = new Date(now.getTime());
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  const y = date.getFullYear();
  const start = new Date(y, 0, 1);
  const days = Math.floor((date.getTime() - start.getTime()) / 86400000);
  const week = Math.floor((days + start.getDay()) / 7) + 1;
  return `${y}-W${String(week).padStart(2, '0')}`;
}

function normalizeSnapshot(raw: unknown): StreakSnapshot {
  if (!raw || typeof raw !== 'object') return EMPTY_SNAPSHOT;
  const snapshot = raw as Partial<StreakSnapshot>;
  return {
    currentDailyStreak: Number.isFinite(snapshot.currentDailyStreak) ? Math.max(0, Number(snapshot.currentDailyStreak)) : 0,
    longestDailyStreak: Number.isFinite(snapshot.longestDailyStreak) ? Math.max(0, Number(snapshot.longestDailyStreak)) : 0,
    weekCompletedDays: Number.isFinite(snapshot.weekCompletedDays) ? Math.max(0, Number(snapshot.weekCompletedDays)) : 0,
    totalQualifiedSessions: Number.isFinite(snapshot.totalQualifiedSessions) ? Math.max(0, Number(snapshot.totalQualifiedSessions)) : 0,
    lastQualifiedDateKey: typeof snapshot.lastQualifiedDateKey === 'string' ? snapshot.lastQualifiedDateKey : null,
    currentWeekKey: typeof snapshot.currentWeekKey === 'string' ? snapshot.currentWeekKey : null,
  };
}

export async function loadStreakSnapshot(): Promise<StreakSnapshot> {
  try {
    return normalizeSnapshot(await readRecord(await getUserScopedKey(STREAK_SNAPSHOT_KEY)));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export async function saveStreakSnapshot(snapshot: StreakSnapshot): Promise<StreakSnapshot> {
  const key = await getUserScopedKey(STREAK_SNAPSHOT_KEY);
  return withRecord(key, async () => {
    const record = await readRecord(key);
    const normalized = normalizeSnapshot(snapshot);
    await AsyncStorage.setItem(key, JSON.stringify({ ...normalized, appliedSessions: record.appliedSessions }));
    return normalized;
  });
}

export async function applySessionStreak(args: { sessionId: string; earned: boolean; now?: Date }): Promise<ApplySessionStreakResult> {
  const now = args.now ?? new Date();
  const dateKey = formatDateKeyLocal(now);
  const weekKey = getWeekKey(now);
  // Resolve before queueing: a delayed completion still belongs to its caller.
  const key = await getUserScopedKey(STREAK_SNAPSHOT_KEY);
  return withRecord(key, async () => {
    const record = await readRecord(key);
    const before = normalizeSnapshot(record);
    if (Object.prototype.hasOwnProperty.call(record.appliedSessions, args.sessionId)) {
      return { applied: false, before, after: before, countedToday: before.lastQualifiedDateKey === dateKey };
    }

    let after = before;

    if (args.earned) {
      const countedToday = before.lastQualifiedDateKey === dateKey;
      const totalQualifiedSessions = before.totalQualifiedSessions + 1;

      if (countedToday) {
        after = {
          ...before,
          totalQualifiedSessions,
        };
      } else {
        const currentDailyStreak = before.lastQualifiedDateKey === getPreviousDateKey(dateKey) ? before.currentDailyStreak + 1 : 1;
        const weekCompletedDays = before.currentWeekKey === weekKey ? before.weekCompletedDays + 1 : 1;
        after = {
          currentDailyStreak,
          longestDailyStreak: Math.max(before.longestDailyStreak, currentDailyStreak),
          weekCompletedDays,
          totalQualifiedSessions,
          lastQualifiedDateKey: dateKey,
          currentWeekKey: weekKey,
        };
      }
    }

    await AsyncStorage.setItem(key, JSON.stringify({
      ...after,
      appliedSessions: { ...record.appliedSessions, [args.sessionId]: true },
    }));
    return { applied: true, before, after, countedToday: after.lastQualifiedDateKey === dateKey };
  });
}
