// mobile/src/sync/progressQueue.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'devcards:sync:progressQueue:v1';
const MAX_EVENTS = 5000;

// 你真正要上送给后端的事件结构（progressAfter 直接带上）
export type ProgressEvent = {
  eventId: string;

  deckSlug: string;
  deckVersion?: string | null;

  stableUid: string;

  // 1..4 (again/hard/good/easy)
  rating: number;

  reviewedAtMs: number;

  // 直接把“本次保存后的进度”带上去（后端不用复刻算法）
  progressAfter?: any;

  // 可选：给 Phase 3 用（更新卡片提示）
  lastSeenRevision?: number | null;
};

async function loadQueue(): Promise<ProgressEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ProgressEvent[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(q: ProgressEvent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // ignore
  }
}

export async function enqueueProgressEvent(ev: ProgressEvent): Promise<void> {
  const q = await loadQueue();

  // 防重复：eventId 已存在就不加
  if (q.some((x) => x?.eventId === ev.eventId)) return;

  q.push(ev);

  // 简单保护：最多保留 MAX_EVENTS 条，防止 AsyncStorage 无限膨胀
  const trimmed = q.length > MAX_EVENTS ? q.slice(q.length - MAX_EVENTS) : q;

  await saveQueue(trimmed);
}

export async function peekProgressEvents(limit: number): Promise<ProgressEvent[]> {
  const q = await loadQueue();
  const n = Math.max(0, Math.min(limit || 0, q.length));
  return q.slice(0, n);
}

export async function removeProgressEventsById(ids: string[]): Promise<void> {
  const set = new Set((ids || []).filter(Boolean));
  if (set.size === 0) return;

  const q = await loadQueue();
  const next = q.filter((x) => !set.has(x.eventId));
  await saveQueue(next);
}

export async function progressQueueSize(): Promise<number> {
  const q = await loadQueue();
  return q.length;
}

export async function clearProgressQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {}
}