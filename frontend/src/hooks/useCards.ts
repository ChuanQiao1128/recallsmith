// src/hooks/useCards.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  fetchCardsByDeck, 
  createCard, 
  updateCard, 
  deleteCard 
} from '../api/authoring';
import { QueryKeys } from '../api/queryClient';

// 获取 Deck 的所有 Cards
export function useCards(deckId: number) {
  return useQuery({
    queryKey: QueryKeys.cards(deckId),
    queryFn: async () => {
      const res = await fetchCardsByDeck(deckId);
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to fetch cards');
      return res.data ?? [];
    },
    enabled: Number.isFinite(deckId) && deckId > 0,
  });
}

// 创建 Card
export function useCreateCard() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: {
      deckId: number;
      question: string;
      explanation?: string;
      codeSnippet?: string;
      codeLanguage?: string;
      difficulty?: number;
      orderInDeck?: number;
      stableUid?: string;
      realWorldUsage?: string;
    }) => {
      const res = await createCard(params);
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to create card');
      return res.data;
    },
    onSuccess: (data, variables) => {
      if (data) {
        queryClient.invalidateQueries({ queryKey: QueryKeys.cards(variables.deckId) });
        queryClient.invalidateQueries({ queryKey: QueryKeys.deck(variables.deckId) });
      }
    },
  });
}

// 更新 Card
export function useUpdateCard() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: {
      id: number;
      deckId: number;
      question?: string;
      explanation?: string;
      codeSnippet?: string;
      codeLanguage?: string;
      difficulty?: number;
      orderInDeck?: number;
      stableUid?: string;
      expectedVersion?: number;
    }) => {
      const res = await updateCard(params);
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to update card');
      return res.data;
    },
    onSuccess: (data, variables) => {
      if (data) {
        queryClient.invalidateQueries({ queryKey: QueryKeys.cards(variables.deckId) });
      }
    },
  });
}

// 删除 Card
export function useDeleteCard() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ cardId, deckId }: { cardId: number; deckId: number }) => {
      const res = await deleteCard(cardId);
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to delete card');
      return { cardId, deckId };
    },
    onSuccess: ({ deckId }) => {
      queryClient.invalidateQueries({ queryKey: QueryKeys.cards(deckId) });
      queryClient.invalidateQueries({ queryKey: QueryKeys.deck(deckId) });
    },
  });
}
