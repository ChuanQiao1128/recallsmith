import { http } from './http';
import { apiResultFromError } from './httpFailure';
import type { ApiResult } from '../types/api';
import type { ReleaseAction, ReleaseActions, ReleaseSnapshot } from '../types/contentRelease';

export async function fetchReleaseSnapshot(): Promise<ApiResult<ReleaseSnapshot>> {
  try {
    return (await http.get<ApiResult<ReleaseSnapshot>>('/api/v1/authoring/release/snapshot', { params: { deckId: 15 } })).data;
  } catch (error) { return apiResultFromError(error); }
}

export async function fetchReleaseAction(releaseId: string, actionId: string): Promise<ApiResult<ReleaseActions>> {
  try {
    return (await http.get<ApiResult<ReleaseActions>>('/api/v1/authoring/release/actions', { params: { deckId: 15, releaseId, actionId } })).data;
  } catch (error) { return apiResultFromError(error); }
}

/** Uses only the ordinary Console client. No automatic retry of an uncertain write. */
export async function sendReleaseAction(action: ReleaseAction): Promise<ApiResult<Record<string, unknown>>> {
  const route = { import: '/api/v1/authoring/cards/import', review: '/api/v1/authoring/release/review', publish: '/api/v1/authoring/publish' }[action.kind];
  try {
    return (await http.post<ApiResult<Record<string, unknown>>>(route, action.payload, { headers: { 'Content-Type': 'application/json' }, timeout: 29_000 })).data;
  } catch (error) { return apiResultFromError(error); }
}
