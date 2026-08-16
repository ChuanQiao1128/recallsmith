import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCardsByDeck, deleteCard } from '../api/authoring';
import { QueryKeys } from '../api/queryClient';
import type { Card } from '../types/card';

// 配置项与 useDeck 逐条一致，理由见 useDecks.ts 里 useDeck 上方那段注释：
// 全都是照着迁移前 CardListPage 的手写 useEffect 抄的，不是 react-query 的默认值。
export function useCards(deckId: number) {
  return useQuery({
    queryKey: QueryKeys.cards(deckId),
    queryFn: async () => {
      const res = await fetchCardsByDeck(deckId);
      // 'Failed to load cards.' 是页面今天的原文；hook 原来抛的是
      // 'Failed to fetch cards'，接线后会把用户看到的措辞悄悄换掉。
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to load cards.');
      return res.data ?? [];
    },
    enabled: !Number.isNaN(deckId) && deckId !== 0,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    // 唯一一条在手写 useEffect 里没有对应物的配置。react-query 默认 networkMode
    // 'online'：离线时根本不调 queryFn，query 停在 fetchStatus 'paused' 而 status
    // 仍是 'pending'；页面读的是 isPending，于是渲染成一个永不结束的 spinner。
    // 'always' 让请求照发照失败，错误屏才出得来。
    networkMode: 'always',
  });
}

export function useDeleteCard() {
  const queryClient = useQueryClient();

  return useMutation({
    // 这里刻意不在 !success 时 throw。
    //
    // throw 会把「服务端理解了这次请求并拒绝」和「请求根本没回来」压平进同一个
    // Error 通道，而这两者给用户的建议是相反的：前者可以放心重试、什么都没变；
    // 后者必须先重载再动手，因为写入可能已经落库了。原样返回 ApiResult 是保住
    // 这条分流唯一的写法，网络异常仍然自然 reject，落到调用方的 catch 里。
    mutationFn: async ({ cardId, deckId }: { cardId: number; deckId: number }) => {
      const result = await deleteCard(cardId);
      return { result, cardId, deckId };
    },
    onSuccess: ({ result, cardId, deckId }) => {
      // mutationFn 不再 throw，所以 onSuccess 也会在「服务端拒绝」时被调用。
      if (!result.success) return;

      // 就地移除，而不是 invalidateQueries。失效会立刻重新拉一次列表，把刚
      // 删掉的那一行按服务器的下一次回答放回屏幕上；页面今天的语义是
      // cards.filter(c => c.id !== cardId)，setQueryData 与它逐字一致，也不会
      // 为了确认一件已经确认过的事再发一个请求。
      queryClient.setQueryData<Card[]>(QueryKeys.cards(deckId), prev =>
        prev === undefined ? prev : prev.filter(c => c.id !== cardId),
      );
    },
  });
}
