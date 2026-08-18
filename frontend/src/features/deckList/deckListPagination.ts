// src/features/deckList/deckListPagination.ts
// Pure state helpers for DeckListPage's keyset pagination over
// GET /api/v1/admin/decks. Deliberately React-free so the logic is
// unit-testable; the frontend currently has no test runner configured
// (gates are build + lint only), so if vitest is ever added, start here.

import type { AdminDeckListItem, AdminDecksPage } from '../../api/authoring';

export type DeckStatus = 'published' | 'needs_publish' | 'unpublished';

export const DECKS_PAGE_SIZE = 50;

export interface DeckPageListState {
  items: AdminDeckListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const emptyDeckPageListState: DeckPageListState = {
  items: [],
  nextCursor: null,
  hasMore: false,
};

/**
 * Merge a fetched page into the current list state.
 * - mode 'reset' replaces the list (initial load / new search / refresh).
 * - mode 'append' adds the next page, de-duplicating by slug so a row that
 *   moved across the page boundary between requests cannot render twice.
 * - hasMore is only honoured when the server also returned a usable cursor,
 *   so a buggy `hasMore: true` without a cursor cannot cause a request loop.
 */
export function applyDecksPage(
  prev: DeckPageListState,
  page: AdminDecksPage,
  mode: 'reset' | 'append',
): DeckPageListState {
  const base = mode === 'reset' ? [] : prev.items;
  const seen = new Set(base.map(item => item.slug));
  const incoming = (page.items ?? []).filter(item => {
    if (!item.slug || seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
  const nextCursor =
    typeof page.nextCursor === 'string' && page.nextCursor.length > 0 ? page.nextCursor : null;
  return {
    items: base.concat(incoming),
    nextCursor,
    hasMore: page.hasMore === true && nextCursor !== null,
  };
}

/** Remove a deck (e.g. after soft-delete) without refetching the whole list. */
export function removeDeckBySlug(state: DeckPageListState, slug: string): DeckPageListState {
  return { ...state, items: state.items.filter(item => item.slug !== slug) };
}

/**
 * Publish status for a paginated admin deck row. Unlike the legacy path this
 * needs no full-manifest fetch: `latestBuildId` (latest SUCCESS publish) means
 * published; otherwise cards present means it still needs a publish.
 */
export function derivePagedDeckStatus(
  item: Pick<AdminDeckListItem, 'latestBuildId' | 'totalCards'>,
): DeckStatus {
  if (typeof item.latestBuildId === 'string' && item.latestBuildId.trim().length > 0) {
    return 'published';
  }
  if ((item.totalCards ?? 0) > 0) return 'needs_publish';
  return 'unpublished';
}

/**
 * Starter/Paid classification for the type badge and type filter.
 * Legacy rows carry a numeric deckType (1 = Starter); paginated rows may only
 * carry tier, so fall back to tier ('premium' = Paid) when deckType is unknown.
 */
export function isStarterLike(
  deckType: number | null | undefined,
  tier: string | null | undefined,
): boolean {
  if (typeof deckType === 'number') return deckType === 1;
  return tier !== 'premium';
}
