// src/hooks/index.ts
//
// WHAT THIS FILE IS FOR — read before adding to it.
//
// Nothing in src/ imports this barrel. The two pages that render through hooks
// import the concrete files instead:
//
//   src/pages/CardListPage.tsx -> '../hooks/useDecks', '../hooks/useCards'
//
// so re-exporting here does not put a single byte into any bundle. Verify with:
//
//   grep -rn "from '\.\./hooks'" src/
//
// Its actual role today is to be the index that tests/hookWiring.test.ts reads:
// that ratchet scans this file for hook-shaped exports and fails if any of them
// has no caller. A hook declared under src/hooks/ but missing from this list is
// invisible to the ratchet, which is why tests/hookWiring.test.ts also asserts
// `hooksNotInBarrel` is empty. So the rule is: every hook in this folder gets
// listed here, and every hook listed here has a real caller.
//
// It is NOT a convenience import for pages. Adding a hook here does not wire it
// up to anything, and until 2026-08 this file published 22 hooks of which 19
// had no caller anywhere in the app. Those 19 are now deleted.

export { useDeck } from './useDecks';
export { useCards, useDeleteCard } from './useCards';

// 重新导出 QueryClient
export { queryClient, QueryKeys } from '../api/queryClient';
