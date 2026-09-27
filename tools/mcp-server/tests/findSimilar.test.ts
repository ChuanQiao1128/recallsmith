import { afterEach, describe, expect, it } from 'vitest';
import {
  callTool,
  connect,
  envelope,
  makeTestEnv,
  sendJson,
  startFakeServer,
  TEST_ACCESS_TOKEN,
  writeValidTokens,
  type FakeServer,
  type TestEnv,
} from './helpers';

const DATA = {
  engine: 'fallback',
  threshold: 0.3,
  matches: [
    {
      cardId: 41,
      deckId: 12,
      deckSlug: 'aws-saa-c03',
      stableUid: 'sample-qa-topic-02',
      question: 'Which S3 storage class keeps cost lowest?',
      similarity: 0.8125,
      likelyDuplicate: true,
    },
  ],
};

describe('find_similar_cards', () => {
  let env: TestEnv;
  let api: FakeServer;
  afterEach(async () => {
    await api.close();
    env.cleanup();
  });

  it('posts the text to /api/v1/authoring/cards/similar and returns data', async () => {
    api = await startFakeServer((_req, res) => sendJson(res, 200, envelope(DATA)));
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    const client = await connect(env.config);

    const result = await callTool(client, 'find_similar_cards', {
      text: 'Which S3 storage class keeps cost lowest?',
      deckSlug: 'aws-saa-c03',
      limit: 3,
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual(DATA);
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.method).toBe('POST');
    expect(api.requests[0]?.url).toBe('/api/v1/authoring/cards/similar');
    expect(api.requests[0]?.headers.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(JSON.parse(api.requests[0]?.body ?? '')).toEqual({
      text: 'Which S3 storage class keeps cost lowest?',
      deckSlug: 'aws-saa-c03',
      limit: 3,
    });

    // Absent optional keys are omitted from the body.
    await callTool(client, 'find_similar_cards', { text: 'only text' });
    expect(api.requests[1]?.body).toBe('{"text":"only text"}');
    await client.close();
  });

  it('reports a network failure as a one-line error', async () => {
    api = await startFakeServer((_req, res) => sendJson(res, 200, envelope(DATA)));
    await api.close();
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    const client = await connect(env.config);
    const result = await callTool(client, 'find_similar_cards', { text: 'anything' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Network error calling \/api\/v1\/authoring\/cards\/similar: /);
    expect(result.text).not.toMatch(/\n/);
    await client.close();
  });
});
