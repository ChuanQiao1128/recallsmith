// @vitest-environment jsdom
import { AxiosHeaders } from 'axios';
import { readStoredTokens } from '../src/auth/tokenStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareReleaseAction } from '../src/lib/contentRelease';
import { releaseFixture } from './support/contentReleaseFixtures';
import { signInAsEditor, signInAsSuperAdmin, signOut, TEST_EDITOR_SUB } from './support/consoleSession';
import { ok } from './support/apiResult';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/api/http', () => ({ http }));
const { fetchReleaseAction, fetchReleaseSnapshot, fetchReleaseCards, sendReleaseAction } = await import('../src/api/contentRelease');
beforeEach(() => { vi.clearAllMocks(); signOut(); signInAsEditor(); });
describe('normal authenticated Console release API', () => {
  it('uses only fixed release read routes for deck 15', async () => {
    http.get.mockResolvedValue({ data: ok({}) });
    await fetchReleaseSnapshot(TEST_EDITOR_SUB); await fetchReleaseAction('release', 'import', TEST_EDITOR_SUB);
    expect(http.get.mock.calls).toEqual([
      ['/api/v1/authoring/release/snapshot', { params: { deckId: 15 }, transformRequest: [expect.any(Function)] }],
      ['/api/v1/authoring/release/actions', { params: { deckId: 15, releaseId: 'release', actionId: 'import' }, transformRequest: [expect.any(Function)] }],
    ]);
  });
  it('sends exact persisted bytes through the existing client; uncertain 503 is not queued or retried', async () => {
    const { session } = releaseFixture(); const action = prepareReleaseAction(session, 'import', 'import');
    http.post.mockRejectedValue({ isAxiosError: true, response: { status: 503, data: { success: false, data: null, error: { code: 'PUBLISH_DISPATCH_UNCONFIRMED', message: 'Committed; delivery unknown.' }, traceId: 't' } } });
    const result = await sendReleaseAction(action, TEST_EDITOR_SUB);
    expect(result.success).toBe(false);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post.mock.calls[0]).toEqual(['/api/v1/authoring/cards/import', action.payload, { headers: { 'Content-Type': 'application/json' }, timeout: 29_000, transformRequest: [expect.any(Function)] }]);
  });
});

describe('subject guard at HTTP dispatch after shared authentication', () => {
  it('preserves bytes for the owner and rejects a new subject immediately before dispatch', async () => {
    const { session } = releaseFixture(); const action = prepareReleaseAction(session, 'import', 'import');
    http.post.mockResolvedValue({ data: ok({}) });
    await sendReleaseAction(action, TEST_EDITOR_SUB);
    const guard = http.post.mock.calls[0][2].transformRequest[0];
    expect(guard(action.payload, new AxiosHeaders({ Authorization: `Bearer ${readStoredTokens()!.accessToken}` }))).toBe(action.payload);
    signInAsSuperAdmin();
    expect(() => guard(action.payload)).toThrow(/subject changed/);
  });
  it('guards snapshot and action query dispatch too', async () => {
    http.get.mockResolvedValue({ data: ok({}) });
    await fetchReleaseSnapshot(TEST_EDITOR_SUB); await fetchReleaseAction('release', 'import', TEST_EDITOR_SUB);
    signInAsSuperAdmin();
    for (const call of http.get.mock.calls) expect(() => call[1].transformRequest[0](undefined)).toThrow(/subject changed/);
  });
});

describe('axios execution order', () => {
  it('blocks transport if the account switches during an async request interceptor', async () => {
    const { session } = releaseFixture(); const action = prepareReleaseAction(session, 'import', 'import');
    http.post.mockResolvedValue({ data: ok({}) });
    await sendReleaseAction(action, TEST_EDITOR_SUB);
    const transformRequest = http.post.mock.calls[0][2].transformRequest;
    const { default: axios } = await import('axios'); const adapter = vi.fn();
    const client = axios.create({ adapter });
    client.interceptors.request.use(async config => { await Promise.resolve(); signInAsSuperAdmin(); return config; });
    await expect(client.post('/synthetic-no-network', action.payload, { transformRequest })).rejects.toThrow(/subject changed/);
    expect(adapter).not.toHaveBeenCalled();
  });
});

describe('subject-isolated full release readback', () => {
  it('fetches every page through fixed deck-15 routes and retains exact raw display data', async () => {
    const { cards } = releaseFixture();
    http.get.mockResolvedValueOnce({ data: ok({ items: cards.slice(0, 200), hasMore: true, nextCursor: 'page-2' }) }).mockResolvedValueOnce({ data: ok({ items: cards.slice(200), hasMore: false, nextCursor: null }) });
    const result = await fetchReleaseCards(TEST_EDITOR_SUB);
    expect(result.data).toEqual(cards);
    expect(http.get.mock.calls).toEqual([
      ['/api/v1/authoring/cards/page', { params: { deckId: 15, limit: 200 }, transformRequest: [expect.any(Function)] }],
      ['/api/v1/authoring/cards/page', { params: { deckId: 15, limit: 200, cursor: 'page-2' }, transformRequest: [expect.any(Function)] }],
    ]);
  });
  it('does not fetch another page or return partial data after an identity switch', async () => {
    const { cards } = releaseFixture();
    http.get.mockImplementationOnce(async () => { signInAsSuperAdmin(); return { data: ok({ items: cards.slice(0, 200), hasMore: true, nextCursor: 'page-2' }) }; });
    const result = await fetchReleaseCards(TEST_EDITOR_SUB);
    expect(result.success).toBe(false); expect(result.data).toBeNull(); expect(http.get).toHaveBeenCalledTimes(1);
  });
  it.each(['missingCursor', 'repeatedCursor', 'refused'])('fails closed on %s instead of accepting a truncated readback', async kind => {
    http.get.mockResolvedValueOnce({ data: ok({ items: [], hasMore: true, nextCursor: kind === 'missingCursor' ? null : 'repeat' }) });
    http.get.mockResolvedValueOnce({ data: kind === 'refused' ? { success: false, data: null, error: { code: 'DENIED', message: 'Denied' } } : ok({ items: [], hasMore: true, nextCursor: 'repeat' }) });
    const result = await fetchReleaseCards(TEST_EDITOR_SUB);
    expect(result.success).toBe(false); expect(result.data).toBeNull();
  });
});

describe('actual dispatched bearer ownership (F03 residual)', () => {
  it.each(['missing', 'opaque', 'malformed', 'missingSubject', 'foreign'] as const)('rejects %s actual Authorization with the current owner still signed in', async kind => {
    const { session } = releaseFixture(); const action = prepareReleaseAction(session, 'import', 'import');
    http.post.mockResolvedValue({ data: ok({}) }); await sendReleaseAction(action, TEST_EDITOR_SUB);
    const guard = http.post.mock.calls[0][2].transformRequest[0];
    let authorization: string | undefined;
    if (kind === 'opaque') authorization = 'Bearer opaque';
    if (kind === 'malformed') authorization = 'Bearer e30.invalid.signature';
    if (kind === 'missingSubject') authorization = 'Bearer e30.e30.signature';
    if (kind === 'foreign') { signInAsSuperAdmin(); authorization = `Bearer ${readStoredTokens()!.accessToken}`; signInAsEditor(); }
    const headers = new AxiosHeaders();
    if (authorization !== undefined) headers.set('Authorization', authorization);
    expect(() => guard(action.payload, headers)).toThrow(/bearer subject/);
  });
});
