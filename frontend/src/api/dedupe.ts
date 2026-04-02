// src/api/dedupe.ts
// 请求去重：避免相同请求在短时间内重复发出

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest<unknown>>();
const DEFAULT_TTL = 100; // 100ms 内相同请求共用同一个 promise

/**
 * 对异步请求进行去重
 * @param key 请求唯一标识
 * @param fetcher 实际请求函数
 * @param ttl 去重时间窗口（毫秒）
 */
export function dedupeRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = DEFAULT_TTL
): Promise<T> {
  const now = Date.now();
  const pending = pendingRequests.get(key);

  // 如果有进行中的请求且在 TTL 内，直接返回
  if (pending && now - pending.timestamp < ttl) {
    return pending.promise as Promise<T>;
  }

  // 创建新请求
  const promise = fetcher().finally(() => {
    // 完成后延迟清理（给其他并行调用机会复用）
    setTimeout(() => {
      const current = pendingRequests.get(key);
      if (current?.promise === promise) {
        pendingRequests.delete(key);
      }
    }, ttl);
  });

  pendingRequests.set(key, { promise, timestamp: now });
  return promise;
}

/**
 * 手动清除指定请求的去重缓存
 */
export function clearDedupe(key?: string) {
  if (key) {
    pendingRequests.delete(key);
  } else {
    pendingRequests.clear();
  }
}

// 常用请求的 key 生成器
export const DedupeKeys = {
  decks: () => 'decks:list',
  deck: (id: number) => `deck:${id}`,
  cards: (deckId: number) => `cards:deck:${deckId}`,
  manifest: () => 'manifest:admin',
  publishJobs: () => 'publish:jobs',
} as const;
