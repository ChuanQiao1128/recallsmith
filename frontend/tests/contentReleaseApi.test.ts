import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareReleaseAction } from '../src/lib/contentRelease';
import { releaseFixture } from './support/contentReleaseFixtures';
import { ok } from './support/apiResult';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/api/http', () => ({ http }));
const { fetchReleaseAction, fetchReleaseSnapshot, sendReleaseAction } = await import('../src/api/contentRelease');
beforeEach(() => vi.clearAllMocks());
describe('normal authenticated Console release API', () => {
  it('uses only fixed release read routes for deck 15', async () => {
    http.get.mockResolvedValue({ data: ok({}) });
    await fetchReleaseSnapshot(); await fetchReleaseAction('release', 'import');
    expect(http.get.mock.calls).toEqual([
      ['/api/v1/authoring/release/snapshot', { params: { deckId: 15 } }],
      ['/api/v1/authoring/release/actions', { params: { deckId: 15, releaseId: 'release', actionId: 'import' } }],
    ]);
  });
  it('sends exact persisted bytes through the existing client; uncertain 503 is not queued or retried', async () => {
    const { session } = releaseFixture(); const action = prepareReleaseAction(session, 'import', 'import');
    http.post.mockRejectedValue({ isAxiosError: true, response: { status: 503, data: { success: false, data: null, error: { code: 'PUBLISH_DISPATCH_UNCONFIRMED', message: 'Committed; delivery unknown.' }, traceId: 't' } } });
    const result = await sendReleaseAction(action);
    expect(result.success).toBe(false);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post.mock.calls[0]).toEqual(['/api/v1/authoring/cards/import', action.payload, { headers: { 'Content-Type': 'application/json' }, timeout: 29_000 }]);
  });
});
