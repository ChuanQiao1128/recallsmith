// src/app/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,                 // 失败重试 1 次
      staleTime: 30_000,        // 30s 内视为新鲜
      gcTime: 5 * 60_000,       // 5 分钟垃圾回收
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,                 // 变更默认不重试
    },
  },
});