// submit_draft inside an automation run (contract A00 §11.6): the local runner passes
// DC_AUTOMATION_* to the server, which then always sends the run id in the agent block
// and refuses any other deck. Loopback fakes only.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { automationRunFrom, createServer } from '../src/server';
import {
  callTool,
  envelope,
  errorEnvelope,
  fakeIngest,
  makeTestEnv,
  SAMPLE_SOURCES,
  sampleCard,
  sendJson,
  startFakeServer,
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

const RUN_ID = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';
const AUTOMATION_ENV = {
  DC_AUTOMATION_RUN_ID: RUN_ID,
  DC_AUTOMATION_QUEUE_ITEM_ID: '42',
  DC_AUTOMATION_DECK_SLUG: 'aws-saa-c03',
};

const happy: FakeHandler = (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/api/v1/admin/decks')) return sendJson(res, 200, envelope(DECKS_PAGE));
  if (req.method === 'POST' && req.url === '/api/v1/authoring/drafts') return sendJson(res, 200, envelope(SUBMIT_DATA));
  sendJson(res, 404, errorEnvelope('NOT_FOUND', 'no route'));
};

describe('submit_draft in an automation run', () => {
  let env: TestEnv;
  let api: FakeServer;
  let warnings: string[];
  afterEach(async () => {
    await api?.close();
    env.cleanup();
  });

  /** Like helpers.connect, but with the automation variables and a recorded warn. */
  async function setup(automationEnv: Record<string, string | undefined>): Promise<Client> {
    api = await startFakeServer(happy);
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    warnings = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      config: env.config,
      runProcess: fakeIngest(SAMPLE_SOURCES).run,
      env: automationEnv,
      warn: (line) => warnings.push(line),
    });
    await server.connect(serverTransport);
    const client = new Client({ name: 'dc-mcp-test', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  function postedAgent(): unknown {
    const post = api.requests.find((req) => req.method === 'POST' && req.url === '/api/v1/authoring/drafts');
    expect(post).toBeDefined();
    const body = JSON.parse(post?.body ?? '') as Record<string, unknown>;
    return body.agent;
  }

  function postedBody(): Record<string, unknown> {
    const post = api.requests.find((req) => req.method === 'POST' && req.url === '/api/v1/authoring/drafts');
    return JSON.parse(post?.body ?? '{}') as Record<string, unknown>;
  }

  it('sends runId and queueItemId in the agent block inside an automation run', async () => {
    const client = await setup(AUTOMATION_ENV);
    const result = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03',
      drafts: [sampleCard()],
      agent: { model: 'claude-opus-5-5', skillVersion: 'author-cards@1.8.1' },
    });
    expect(result.isError).toBe(false);
    expect(postedAgent()).toEqual({
      name: 'developercards-mcp',
      model: 'claude-opus-5-5',
      skillVersion: 'author-cards@1.8.1',
      runId: RUN_ID.toLowerCase(),
      queueItemId: '42',
    });
    expect(Object.keys(postedAgent() as object)).toEqual(['name', 'model', 'skillVersion', 'runId', 'queueItemId']);
    expect(warnings).toEqual([]);
    await client.close();
  });

  it('sends unknown model and skillVersion when the tool call has no agent', async () => {
    const client = await setup(AUTOMATION_ENV);
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result.isError).toBe(false);
    expect(postedAgent()).toEqual({
      name: 'developercards-mcp',
      model: 'unknown',
      skillVersion: 'unknown',
      runId: RUN_ID.toLowerCase(),
      queueItemId: '42',
    });
    await client.close();
  });

  it('omits queueItemId when the queue item id is not a positive integer, with one warning', async () => {
    const client = await setup({ ...AUTOMATION_ENV, DC_AUTOMATION_QUEUE_ITEM_ID: '0' });
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result.isError).toBe(false);
    expect(postedAgent()).toEqual({ name: 'developercards-mcp', model: 'unknown', skillVersion: 'unknown', runId: RUN_ID.toLowerCase() });
    expect(warnings).toEqual(['developercards-mcp: DC_AUTOMATION_QUEUE_ITEM_ID is not a positive integer; ignored']);
    await client.close();
  });

  it('refuses a different deckSlug with AUTOMATION_DECK_MISMATCH and makes no request', async () => {
    const client = await setup(AUTOMATION_ENV);
    const result = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03-archive',
      drafts: [sampleCard()],
      agent: { model: 'claude-opus-5-5', skillVersion: 'author-cards@1.8.1' },
    });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith('AUTOMATION_DECK_MISMATCH: this automation run drafts for deck')).toBe(true);
    expect(result.text).toBe('AUTOMATION_DECK_MISMATCH: this automation run drafts for deck aws-saa-c03');
    expect(api.requests).toEqual([]);
    await client.close();
  });

  it('ignores a run id that is not a uuid with one warning', async () => {
    const client = await setup({ DC_AUTOMATION_RUN_ID: 'not-a-uuid', DC_AUTOMATION_QUEUE_ITEM_ID: '42' });
    const result = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03',
      drafts: [sampleCard()],
      agent: { model: 'claude-opus-5-5', skillVersion: 'author-cards@1.8.1' },
    });
    expect(result.isError).toBe(false);
    expect(warnings).toEqual(['developercards-mcp: DC_AUTOMATION_RUN_ID is not a uuid; automation run ignored']);
    expect(postedAgent()).toEqual({ name: 'developercards-mcp', model: 'claude-opus-5-5', skillVersion: 'author-cards@1.8.1' });
    await client.close();
  });

  it('keeps the agent block unchanged outside an automation run', async () => {
    const client = await setup({});
    const without = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(without.isError).toBe(false);
    expect('agent' in postedBody()).toBe(false);

    api.requests.length = 0;
    const withAgent = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03',
      drafts: [sampleCard()],
      agent: { model: 'claude-opus-5-5', skillVersion: '1.0.0' },
    });
    expect(withAgent.isError).toBe(false);
    expect(postedAgent()).toEqual({ name: 'developercards-mcp', model: 'claude-opus-5-5', skillVersion: '1.0.0' });
    expect(warnings).toEqual([]);
    await client.close();
  });
});

describe('the API surface', () => {
  it('adds no API call literal under src', () => {
    // The regex of AgentClientPolicyTests, which pins the agent client's API surface.
    const re = /'(GET|POST)'\s*,\s*[`'](\/api\/[^`'?$]+)/g;
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const files = (readdirSync(srcDir, { recursive: true }) as string[]).filter((name) => name.endsWith('.ts'));
    const calls = new Set<string>();
    for (const name of files) {
      for (const match of readFileSync(join(srcDir, name), 'utf8').matchAll(re)) calls.add(`${match[1]} ${match[2]}`);
    }
    expect([...calls].sort()).toEqual(['GET /api/v1/admin/decks', 'POST /api/v1/authoring/cards/similar', 'POST /api/v1/authoring/drafts']);
  });
});

describe('automationRunFrom', () => {
  it('reads nothing from an empty environment and never warns', () => {
    const warnings: string[] = [];
    expect(automationRunFrom({ DC_AUTOMATION_RUN_ID: '  ', DC_AUTOMATION_DECK_SLUG: '' }, (line) => warnings.push(line))).toEqual({
      runId: null,
      queueItemId: null,
      deckSlug: null,
    });
    expect(warnings).toEqual([]);
  });

  it('trims every value and lowercases the run id', () => {
    const warnings: string[] = [];
    const run = automationRunFrom(
      { DC_AUTOMATION_RUN_ID: ` ${RUN_ID} `, DC_AUTOMATION_QUEUE_ITEM_ID: ' 9223372036854775807 ', DC_AUTOMATION_DECK_SLUG: ' aws-saa-c03 ' },
      (line) => warnings.push(line),
    );
    expect(run).toEqual({ runId: RUN_ID.toLowerCase(), queueItemId: '9223372036854775807', deckSlug: 'aws-saa-c03' });
    expect(warnings).toEqual([]);
  });
});
