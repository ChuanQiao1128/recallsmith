import { http } from './http';
import { readSessionUser } from '../auth/sessionUser';
import { apiResultFromError, failResult } from './httpFailure';
import type { Card } from '../types/card';
import type { ApiResult } from '../types/api';
import type { ReleaseAction, ReleaseActions, ReleaseSnapshot } from '../types/contentRelease';

// Runs after the shared async auth interceptor, immediately before HTTP dispatch.
function subjectGuard(ownerSubject: string) {
  return (data: unknown) => {
    const active = readSessionUser();
    if (!ownerSubject || active?.sub !== ownerSubject || !active.groups.some(group => group === 'editor' || group === 'super_admin')) throw new Error('Signed-in subject changed before release request.');
    return data;
  };
}

export async function fetchReleaseSnapshot(ownerSubject: string): Promise<ApiResult<ReleaseSnapshot>> {
  try {
    return (await http.get<ApiResult<ReleaseSnapshot>>('/api/v1/authoring/release/snapshot', { params: { deckId: 15 }, transformRequest: [subjectGuard(ownerSubject)] })).data;
  } catch (error) { return apiResultFromError(error); }
}

export async function fetchReleaseAction(releaseId: string, actionId: string, ownerSubject: string): Promise<ApiResult<ReleaseActions>> {
  try {
    return (await http.get<ApiResult<ReleaseActions>>('/api/v1/authoring/release/actions', { params: { deckId: 15, releaseId, actionId }, transformRequest: [subjectGuard(ownerSubject)] })).data;
  } catch (error) { return apiResultFromError(error); }
}

/** Scoped paging avoids the shared deck-only dedupe and checks identity between every page. */
export async function fetchReleaseCards(ownerSubject: string): Promise<ApiResult<Card[]>> {
  const guard = subjectGuard(ownerSubject);
  try {
    const cards: Card[] = []; const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      guard(undefined);
      const params: Record<string, unknown> = { deckId: 15, limit: 200, ...(cursor === null ? {} : { cursor }) };
      const result = (await http.get<ApiResult<{ items: Card[]; hasMore: boolean; nextCursor: string | null }>>('/api/v1/authoring/cards/page', { params, transformRequest: [guard] })).data;
      guard(undefined);
      if (!result.success) return { ...result, data: null };
      if (!result.data || !Array.isArray(result.data.items) || typeof result.data.hasMore !== 'boolean') return failResult('Invalid release card page.', 'PAGING_ERROR');
      cards.push(...result.data.items);
      if (result.data.hasMore === false) return { ...result, data: cards };
      const next = result.data.nextCursor;
      if (typeof next !== 'string' || !next || cursors.has(next)) return failResult('The card list did not finish paging.', 'PAGING_ERROR');
      cursors.add(next); cursor = next;
    }
    return failResult('The card list did not finish paging.', 'PAGING_ERROR');
  } catch (error) { return apiResultFromError(error); }
}

/** Uses only the ordinary Console client. No automatic retry of an uncertain write. */
export async function sendReleaseAction(action: ReleaseAction, ownerSubject: string): Promise<ApiResult<Record<string, unknown>>> {
  const route = { import: '/api/v1/authoring/cards/import', review: '/api/v1/authoring/release/review', publish: '/api/v1/authoring/publish' }[action.kind];
  try {
    return (await http.post<ApiResult<Record<string, unknown>>>(route, action.payload, { headers: { 'Content-Type': 'application/json' }, timeout: 29_000, transformRequest: [subjectGuard(ownerSubject)] })).data;
  } catch (error) { return apiResultFromError(error); }
}
