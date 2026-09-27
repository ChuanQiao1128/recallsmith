import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, clientDraftKey, type DraftCard } from '../src/draftCard';
import {
  callTool,
  connect,
  envelope,
  errorEnvelope,
  makeTestEnv,
  MCQ_CHUNK,
  SAMPLE_CHUNK,
  sampleCard,
  sampleMcqCard,
  sendJson,
  startFakeServer,
  TEST_ACCESS_TOKEN,
  writeValidTokens,
  type FakeHandler,
  type FakeServer,
  type TestEnv,
} from './helpers';

const DECKS_PAGE = {
  items: [
    { id: 7, slug: 'aws-saa-c03-archive', title: 'Old AWS deck' },
    { id: 12, slug: 'aws-saa-c03', title: 'AWS SAA-C03' },
  ],
  nextCursor: null,
  hasMore: false,
};

const SUBMIT_DATA = { batchId: 'b-1', created: [], duplicates: [], rejected: [] };

describe('submit_draft', () => {
  let env: TestEnv;
  let api: FakeServer;
  afterEach(async () => {
    await api?.close();
    env.cleanup();
  });

  async function setup(handler: FakeHandler) {
    api = await startFakeServer(handler);
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    return connect(env.config);
  }

  const happy: FakeHandler = (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/v1/admin/decks')) return sendJson(res, 200, envelope(DECKS_PAGE));
    if (req.method === 'POST' && req.url === '/api/v1/authoring/drafts') return sendJson(res, 200, envelope(SUBMIT_DATA));
    sendJson(res, 404, errorEnvelope('NOT_FOUND', 'no route'));
  };

  it('refuses to submit when any card has a lint issue and makes no request', async () => {
    const client = await setup(happy);
    const { source: _omitted, ...unsourced } = sampleMcqCard();
    const result = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03',
      drafts: [sampleCard(), unsourced, { ...sampleCard(), stableUid: 'sample-qa-topic-09', question: ' ' }],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      'lint failed: sample-mcq-choose-two-03: SOURCE_REQUIRED; sample-qa-topic-09: MISSING_QUESTION',
    );
    expect(api.requests).toEqual([]);
    await client.close();
  });

  it('resolves the deck slug and posts drafts with a clientDraftKey per card', async () => {
    const client = await setup(happy);
    const cards: DraftCard[] = [sampleCard(), sampleMcqCard()];
    const result = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03',
      drafts: cards,
      agent: { model: 'claude-opus-5-5', skillVersion: '1.0.0' },
    });
    expect(result.isError).toBe(false);
    // The API data, plus where each quote was found in the cited source (ai-agent-7).
    expect(JSON.parse(result.text)).toEqual({
      ...SUBMIT_DATA,
      grounding: [
        {
          stableUid: 'sample-qa-topic-02',
          clientDraftKey: clientDraftKey(cards[0] as DraftCard),
          sourceId: 'sid-retrieval',
          url: 'https://example.com/s3/retrieval-options',
          chunkId: 'c0002',
          chunkCharStart: 30,
          chunkCharEnd: 30 + SAMPLE_CHUNK.length,
        },
        {
          stableUid: 'sample-mcq-choose-two-03',
          clientDraftKey: clientDraftKey(cards[1] as DraftCard),
          sourceId: 'sid-encryption',
          url: 'https://example.com/s3/encryption',
          chunkId: 'c0001',
          chunkCharStart: 0,
          chunkCharEnd: MCQ_CHUNK.length,
        },
      ],
    });

    expect(api.requests).toHaveLength(2);
    const [list, post] = api.requests;
    expect(list?.method).toBe('GET');
    expect(list?.url).toBe('/api/v1/admin/decks?q=aws-saa-c03&limit=100');
    expect(list?.headers.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(post?.method).toBe('POST');
    expect(post?.headers.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(post?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(post?.body ?? '')).toEqual({
      deckId: 12,
      agent: { name: 'developercards-mcp', model: 'claude-opus-5-5', skillVersion: '1.0.0' },
      drafts: cards.map((card) => ({ clientDraftKey: clientDraftKey(card), card })),
    });

    // The deck id is cached per process: a second submit skips the lookup.
    const again = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(again.isError).toBe(false);
    expect(api.requests).toHaveLength(3);
    expect(JSON.parse(api.requests[2]?.body ?? '')).toEqual({
      deckId: 12,
      drafts: [{ clientDraftKey: clientDraftKey(sampleCard()), card: sampleCard() }],
    });
    await client.close();
  });

  it('follows nextCursor and reports DECK_NOT_FOUND when no slug matches exactly', async () => {
    const client = await setup((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.searchParams.get('cursor') === null) {
        return sendJson(res, 200, envelope({ items: [{ id: 1, slug: 'aws-saa-c03-old' }], nextCursor: 'p2', hasMore: true }));
      }
      return sendJson(res, 200, envelope({ items: [{ id: 2, slug: 'AWS-SAA-C03-x' }], nextCursor: null, hasMore: false }));
    });
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result).toEqual({ isError: true, text: 'DECK_NOT_FOUND: no deck with slug "aws-saa-c03"' });
    expect(api.requests.map((r) => r.url)).toEqual([
      '/api/v1/admin/decks?q=aws-saa-c03&limit=100',
      '/api/v1/admin/decks?q=aws-saa-c03&limit=100&cursor=p2',
    ]);
    await client.close();
  });

  it('computes clientDraftKey as the sha256 of the canonical card JSON', () => {
    const card: DraftCard = {
      stableUid: 'sample-qa-topic-02',
      difficulty: 1,
      topic: '4.1 Cost-optimized storage',
      question: 'Q',
      explanation: 'A',
      source: { url: 'https://example.com/doc', quote: 'quote' },
    };
    expect(canonicalJson(card)).toBe(
      '{"difficulty":1,"explanation":"A","question":"Q","source":{"quote":"quote","url":"https://example.com/doc"},"stableUid":"sample-qa-topic-02","topic":"4.1 Cost-optimized storage"}',
    );
    expect(clientDraftKey(card)).toBe('c712cdbabd7351f01d4983dc808d0ac16761c05b70f0eb4e2df75fd7ca22c493');
    expect(clientDraftKey({ ...card, codeSnippet: null })).toBe(
      '1589e99311b12ef3a8216cae59fab5d7f29a431bfdade52ffb82ed6cd3b3b4c8',
    );
    // An undefined key is dropped, so it hashes like an absent one.
    expect(clientDraftKey({ ...card, codeSnippet: undefined })).toBe(
      'c712cdbabd7351f01d4983dc808d0ac16761c05b70f0eb4e2df75fd7ca22c493',
    );
  });

  it('tells the user to run login on a 401', async () => {
    const client = await setup((_req, res) => sendJson(res, 401, { message: 'Unauthorized' }));
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "HTTP 401: run `login` (node tools/mcp-server/dist/index.js login); if this repeats right after a login, the API does not accept the console-dev client yet (R18 J06)",
    );
    await client.close();
  });

  it('tells the user to run login when there is no token file, without calling the API', async () => {
    api = await startFakeServer(happy);
    env = makeTestEnv({ apiBase: api.base });
    const client = await connect(env.config);
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith('run `login`')).toBe(true);
    expect(api.requests).toEqual([]);
    await client.close();
  });

  it('surfaces the HTTP status and API error code in a one-line error', async () => {
    const client = await setup((req, res) => {
      if (req.method === 'GET') return sendJson(res, 200, envelope(DECKS_PAGE));
      return sendJson(res, 503, errorEnvelope('SERVER_NOT_READY_REVIEW', 'The review queue\nis not ready'));
    });
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result).toEqual({ isError: true, text: 'HTTP 503 SERVER_NOT_READY_REVIEW: The review queue is not ready' });
    await client.close();
  });

  it('reports a non-envelope failure with the status text', async () => {
    const client = await setup((_req, res) => {
      res.writeHead(502, 'Bad Gateway', { 'Content-Type': 'text/html' });
      res.end('<html>bad gateway</html>');
    });
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result).toEqual({ isError: true, text: 'HTTP 502: Bad Gateway' });
    await client.close();
  });
});
