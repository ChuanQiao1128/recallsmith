import type { AxiosRequestHeaders } from 'axios';
import { http } from './http';
import { readSessionUser } from '../auth/sessionUser';
import { apiResultFromError, failResult } from './httpFailure';
import type { Card } from '../types/card';
import type { ApiResult } from '../types/api';
import type { ReleaseAction, ReleaseActions, ReleaseSnapshot } from '../types/contentRelease';

function assertCurrentSubject(ownerSubject: string) {
  const active = readSessionUser();
  if (!ownerSubject || active?.sub !== ownerSubject || !active.groups.some(group => group === 'editor' || group === 'super_admin')) throw new Error('Signed-in subject changed before release request.');
}

// Check the actual bearer attached by shared auth; current stored identity alone can race.
function subjectGuard(ownerSubject: string) {
  return (data: unknown, headers: AxiosRequestHeaders) => {
    assertCurrentSubject(ownerSubject);
    const authorization = headers.get('Authorization');
    let bearerSubject: unknown;
    try {
      const bearer = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
      if (bearer) {
        const payload = bearer[1].split('.')[1];
        const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
        bearerSubject = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')))?.sub;
      }
    } catch { /* Malformed/missing bearer claims fail closed without exposing credentials. */ }
    // The server remains the signature/authorization authority; this is local owner isolation.
    if (bearerSubject !== ownerSubject) throw new Error('Request bearer subject does not match the release journal owner.');
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
      assertCurrentSubject(ownerSubject);
      const params: Record<string, unknown> = { deckId: 15, limit: 200, ...(cursor === null ? {} : { cursor }) };
      const result = (await http.get<ApiResult<{ items: Card[]; hasMore: boolean; nextCursor: string | null }>>('/api/v1/authoring/cards/page', { params, transformRequest: [guard] })).data;
      assertCurrentSubject(ownerSubject);
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
