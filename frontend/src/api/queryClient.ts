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

// Query keys 定义 - 统一管理缓存 key
export const QueryKeys = {
  decks: () => ['decks'] as const,
  deck: (id: number) => ['decks', id] as const,
  cards: (deckId: number) => ['cards', deckId] as const,
  manifest: () => ['manifest'] as const,
  permissions: () => ['permissions'] as const,
  publishJobs: () => ['publishJobs'] as const,
} as const;
