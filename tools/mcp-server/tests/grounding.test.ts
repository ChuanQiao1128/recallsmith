import { afterEach, describe, expect, it } from 'vitest';
import type { DraftCard } from '../src/draftCard';
import { groundQuote, SourceStore } from '../src/grounding';
import {
  callTool,
  connect,
  envelope,
  errorEnvelope,
  fakeIngest,
  ingestDoc,
  makeTestEnv,
  SAMPLE_CHUNK,
  SAMPLE_SOURCES,
  sampleCard,
  sendJson,
  startFakeServer,
  writeValidTokens,
  type FakeServer,
  type TestEnv,
} from './helpers';

const DECKS_PAGE = { items: [{ id: 12, slug: 'aws-saa-c03', title: 'AWS SAA-C03' }], nextCursor: null, hasMore: false };
const SUBMIT_DATA = { batchId: 'b-1', created: [], duplicates: [], rejected: [] };

function withSource(url: string, quote: string, uid = 'sample-qa-topic-02'): DraftCard {
  return { ...sampleCard(), stableUid: uid, source: { url, quote } };
}

describe('submit_draft citation grounding', () => {
  let env: TestEnv;
  let api: FakeServer;
  afterEach(async () => {
    await api?.close();
    env.cleanup();
  });

  async function setup(docs = SAMPLE_SOURCES) {
    api = await startFakeServer((req, res) => {
      if (req.method === 'GET') return sendJson(res, 200, envelope(DECKS_PAGE));
      if (req.method === 'POST') return sendJson(res, 200, envelope(SUBMIT_DATA));
      sendJson(res, 404, errorEnvelope('NOT_FOUND', 'no route'));
    });
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    const ingest = fakeIngest(docs);
    return { client: await connect(env.config, ingest.run), ingest };
  }

  it('refuses a quote that is not in any chunk of the cited source, before any API call', async () => {
    const { client } = await setup();
    const url = 'https://example.com/s3/retrieval-options';
    const read = await callTool(client, 'read_source', { source: url });
    expect(read.isError).toBe(false);

    const invented = withSource(url, 'standard retrieval finishes in 1 to 2 minutes');
    const spliced = withSource(url, 'S3 storage classes overview. S3 Glacier Flexible Retrieval', 'spliced-02');
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [invented, spliced] });
    expect(result).toEqual({
      isError: true,
      text: 'grounding failed: sample-qa-topic-02: SOURCE_QUOTE_NOT_IN_CHUNK; spliced-02: SOURCE_QUOTE_NOT_IN_CHUNK',
    });
    expect(api.requests).toEqual([]);
    await client.close();
  });

  it('refuses a source url that read_source never returned and cannot read now', async () => {
    const { client, ingest } = await setup();
    const card = withSource('https://example.com/not-ingested', 'standard retrieval finishes in 3 to 5 hours');
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [card] });
    expect(result).toEqual({
      isError: true,
      text: 'grounding failed: sample-qa-topic-02: SOURCE_NOT_INGESTED (call read_source on https://example.com/not-ingested first)',
    });
    // One re-read of the url through the same ingest path, which fails here.
    expect(ingest.calls.map((args) => args[args.length - 1])).toEqual(['https://example.com/not-ingested']);
    expect(api.requests).toEqual([]);
    await client.close();
  });

  it('accepts a local file read with canonicalUrl, matching the quote whitespace-insensitively', async () => {
    const canonical = 'https://docs.example.com/s3/retrieval';
    const localDoc = ingestDoc(canonical, { sourceId: 'sid-local', chunks: [SAMPLE_CHUNK] });
    api = await startFakeServer((req, res) =>
      sendJson(res, 200, envelope(req.method === 'GET' ? DECKS_PAGE : SUBMIT_DATA)),
    );
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    const calls: string[][] = [];
    const client = await connect(env.config, async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: JSON.stringify(localDoc), stderr: '' };
    });

    const read = await callTool(client, 'read_source', { source: 'sources/s3-retrieval.pdf', canonicalUrl: canonical });
    expect(read.isError).toBe(false);
    const card = withSource(canonical, 'Retrieval   is priced for archives read once or twice a year.\n  Its standard');
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [card] });
    expect(result.text).not.toMatch(/failed/);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text).grounding).toMatchObject([{ sourceId: 'sid-local', url: canonical, chunkId: 'c0001' }]);
    expect(calls).toHaveLength(1); // no re-read: the remembered document was used
    expect(api.requests.map((r) => r.method)).toEqual(['GET', 'POST']);
    await client.close();
  });

  it('checks the quote case-sensitively and only against the cited source', async () => {
    const { client } = await setup();
    const upper = withSource('https://example.com/s3/retrieval-options', 'STANDARD RETRIEVAL finishes in 3 to 5 hours');
    const wrongDoc = withSource('https://example.com/s3/encryption', 'standard retrieval finishes in 3 to 5 hours', 'wrong-doc-01');
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [upper, wrongDoc] });
    expect(result.text).toBe(
      'grounding failed: sample-qa-topic-02: SOURCE_QUOTE_NOT_IN_CHUNK; wrong-doc-01: SOURCE_QUOTE_NOT_IN_CHUNK',
    );
    expect(api.requests).toEqual([]);
    await client.close();
  });
});

describe('SourceStore', () => {
  it('keeps the newest document per url, skips url-less results and evicts the oldest', () => {
    const store = new SourceStore(2);
    expect(store.remember({ v: 1, sourceId: 's', url: null, chunks: [] })).toBeUndefined();
    expect(store.remember({ v: 1, sourceId: 's', url: 'https://a', chunks: [{ id: 'c0001' }] })).toBeUndefined();
    store.remember(ingestDoc('https://a', { sourceId: 'a1', chunks: ['old text'] }));
    store.remember(ingestDoc('https://a', { sourceId: 'a2', chunks: ['new text'] }));
    store.remember(ingestDoc('https://b', { sourceId: 'b1', chunks: ['b text'] }));
    expect(store.get('https://a')?.sourceId).toBe('a2');
    store.remember(ingestDoc('https://c', { sourceId: 'c1', chunks: ['c text'] }));
    expect(store.get('https://a')).toBeUndefined();
    expect(store.get(' https://b ')?.sourceId).toBe('b1');

    const b = store.get('https://b');
    expect(b && groundQuote(b, '  b\n text ')).toMatchObject({ ok: true, chunk: { id: 'c0001' } });
    expect(b && groundQuote(b, '   ')).toEqual({ ok: false, code: 'SOURCE_QUOTE_NOT_IN_CHUNK' });
  });
});
