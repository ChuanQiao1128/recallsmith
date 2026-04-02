// src/hooks/useDecks.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  fetchDecks, 
  fetchDeckById, 
  createDeck, 
  updateDeck, 
  deleteDeck 
} from '../api/authoring';
import { QueryKeys } from '../api/queryClient';
import type { DeckAvailability, DeckTier } from '../types/deck';

// 获取所有 Decks
export function useDecks() {
  return useQuery({
    queryKey: QueryKeys.decks(),
    queryFn: async () => {
      const res = await fetchDecks();
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to fetch decks');
      return res.data ?? [];
    },
  });
}

// 获取单个 Deck
export function useDeck(id: number) {
  return useQuery({
    queryKey: QueryKeys.deck(id),
    queryFn: async () => {
      const res = await fetchDeckById(id);
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to fetch deck');
      return res.data;
    },
    // 只有在 id 有效时才查询
    enabled: Number.isFinite(id) && id > 0,
  });
}

// 创建 Deck
export function useCreateDeck() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: { 
      title: string; 
      slug?: string; 
      description?: string;
      author?: string;
    }) => {
      const res = await createDeck(params);
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to create deck');
      return res.data;
    },
    // 成功后刷新 decks 列表
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QueryKeys.decks() });
    },
  });
}

// 更新 Deck
export function useUpdateDeck() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: {
      id: number;
      title?: string;
      slug?: string;
      description?: string;
      manifestOrder?: number | null;
      availability?: DeckAvailability | null;
      tier?: DeckTier | null;
      eta?: string | null;
      retiredAtMs?: number | null;
      totalCards?: number | null;
      previewCards?: number | null;
    }) => {
      const res = await updateDeck(params.id, params);
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to update deck');
      return res.data;
    },
    // 成功后刷新相关缓存
    onSuccess: (data) => {
      if (data) {
        queryClient.invalidateQueries({ queryKey: QueryKeys.deck(data.id) });
        queryClient.invalidateQueries({ queryKey: QueryKeys.decks() });
      }
    },
  });
}

// 删除 Deck
export function useDeleteDeck() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await deleteDeck(id);
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to delete deck');
      return id;
    },
    // 成功后刷新 decks 列表
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: QueryKeys.decks() });
      queryClient.removeQueries({ queryKey: QueryKeys.deck(deletedId) });
    },
  });
}
