// src/api/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 数据保持新鲜的时间（毫秒）
      staleTime: 5 * 60 * 1000, // 5分钟
      // 缓存数据保留时间
      gcTime: 10 * 60 * 1000, // 10分钟
      // 窗口重新聚焦时自动刷新
      refetchOnWindowFocus: true,
      // 失败时重试次数
      retry: 1,
      // 重试延迟
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // 失败时不自动重试
      retry: false,
    },
  },
});

// 缓存 key 的唯一来源。`as const` 不只是风格：它让 QueryKeys 的成员进入类型，
// 所以删掉一个还有人用的 key 会在 tsc 里报 TS2339 —— noUnusedLocals 看不见
// 对象成员，这是这里唯一会挡住级联死代码的机制。
export const QueryKeys = {
  deck: (id: number) => ['decks', id] as const,
  cards: (deckId: number) => ['cards', deckId] as const,
} as const;
