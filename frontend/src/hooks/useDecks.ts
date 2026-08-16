// src/hooks/useDecks.ts
import { useQuery } from '@tanstack/react-query';
import { fetchDeckById } from '../api/authoring';
import { QueryKeys } from '../api/queryClient';

// 获取单个 Deck
//
// 这里的每一项都是照着「迁移前的 CardListPage 手写 useEffect」逐条抄来的，
// 不是 react-query 的推荐默认值。共享 queryClient 的默认值会在接线的一瞬间
// 塞进四个这个页面今天没有的行为：窗口重新聚焦自动刷新、失败自动重试一次
// （业务拒绝要晚 1 秒才出错误屏）、5 分钟内跳回来不再请求、10 分钟内重新进入
// 直接显示旧数据而不是 Loading 屏。最后两条最危险：NewCardPage / EditCardPage
// 目前直接调裸 API、不失效任何 query 缓存，所以只要 staleTime/gcTime > 0，
// 用户新建完一张卡返回列表页就会看到最长 5-10 分钟的陈旧列表——一个由「优化」
// 引入的真实回归。等这两个页面也走 mutation 失效缓存之后，再考虑放开。
export function useDeck(id: number) {
  return useQuery({
    queryKey: QueryKeys.deck(id),
    queryFn: async () => {
      const res = await fetchDeckById(id);
      // 兜底文案跟着页面走：页面在 !success 且服务端没给 message 时显示的就是
      // 'Deck not found.'，hook 抛别的串会让同一种失败换一套措辞。
      if (!res.success) throw new Error(res.error?.message ?? 'Deck not found.');
      // null 而不是 undefined：react-query 把 undefined 当成 queryFn 写错了，
      // 会用它自己的内部文案覆盖掉页面的 'Deck not found.'。
      return res.data ?? null;
    },
    // 判据抄的是 CardListPage 的 invalidDeckId（!deckId || Number.isNaN）：
    // 只有 0 和 NaN 不发请求。负数和小数照发，因为迁移前就是照发的——
    // deckId=-5 今天会拿到服务端的 404 文案，收紧成 id > 0 会让它变成永远转圈。
    enabled: !Number.isNaN(id) && id !== 0,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    // Same reason as useCards, and the same failure the enabled comment above
    // is already guarding against from the other direction: react-query's
    // default networkMode 'online' parks the query instead of running it when
    // the browser reports offline, so status never leaves 'pending' and the
    // page spins forever. The useEffect this replaced always fired.
    networkMode: 'always',
  });
}
