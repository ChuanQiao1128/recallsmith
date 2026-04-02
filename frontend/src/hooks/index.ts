// src/hooks/index.ts
// 统一导出所有自定义 Hooks

// React Query 相关 Hooks
export { useDecks, useDeck, useCreateDeck, useUpdateDeck, useDeleteDeck } from './useDecks';
export { useCards, useCreateCard, useUpdateCard, useDeleteCard } from './useCards';
export { useManifest, useRebuildManifest } from './useManifest';
export { useDashboard } from './useDashboard';

// 通用自定义 Hooks（面试重点展示）
export { useLocalStorage } from './useLocalStorage';
export { useDebounce, useDebouncedCallback } from './useDebounce';
export { useAsync } from './useAsync';
export { usePrevious, usePreviousDistinct, useHistory } from './usePrevious';
export { useIntersectionObserver, useInfiniteScroll, useCountUp } from './useIntersectionObserver';

// 重新导出 QueryClient
export { queryClient, QueryKeys } from '../api/queryClient';
