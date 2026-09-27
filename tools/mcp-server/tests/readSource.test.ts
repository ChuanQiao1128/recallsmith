import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunProcess } from '../src/ingest';
import { CHUNK_TEXT_BUDGET, OUTLINE_PAGE_MAX, PREVIEW_CHARS } from '../src/paging';
import { callTool, connect, ingestDoc, makeTestEnv, type TestEnv } from './helpers';

interface Call {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

const INGEST_OUTPUT = {
  v: 1,
  sourceId: 'abc123',
  kind: 'html',
  title: 'S3 retrieval options',
  url: 'https://example.com/s3/retrieval-options',
  path: null,
  fetchedAt: '2026-09-27T00:00:00Z',
  chunks: [
    {
      id: 'c0001',
      index: 0,
      heading: 'Retrieval',
      page: null,
      text: 'Its standard retrieval finishes in 3 to 5 hours.',
      charStart: 0,
      charEnd: 48,
    },
  ],
};

function recorder(result: { code: number | null; stdout: string; stderr: string }): { calls: Call[]; run: RunProcess } {
  const calls: Call[] = [];
  const run: RunProcess = async (command, args, options) => {
    calls.push({ command, args, env: options.env, timeoutMs: options.timeoutMs });
    return result;
  };
  return { calls, run };
}

describe('read_source', () => {
  let env: TestEnv;
  afterEach(() => env.cleanup());

  it('spawns uv run dc-ingest with the contract arguments', async () => {
    env = makeTestEnv();
    const fake = recorder({ code: 0, stdout: `${JSON.stringify(INGEST_OUTPUT)}\n`, stderr: '' });
    const client = await connect(env.config, fake.run);
    const repoRoot = env.config.repoRoot;

    const url = await callTool(client, 'read_source', {
      source: 'https://example.com/s3/retrieval-options',
      maxChunkChars: 2000,
    });
    expect(url.isError).toBe(false);
    // The default result is the outline, not the chunk text (ai-agent-23).
    const { chunks: _chunks, ...ingestHeader } = INGEST_OUTPUT;
    expect(JSON.parse(url.text)).toEqual({
      ...ingestHeader,
      chunkCount: 1,
      totalChars: 48,
      offset: 0,
      nextOffset: null,
      chunks: [
        { id: 'c0001', index: 0, heading: 'Retrieval', page: null, charStart: 0, charEnd: 48, textChars: 48, preview: INGEST_OUTPUT.chunks[0]?.text },
      ],
    });
    expect(fake.calls[0]?.command).toBe('uv');
    expect(fake.calls[0]?.args).toEqual([
      'run', '--project', `${repoRoot}/tools/ingest`, '--python', '3.12', 'dc-ingest', '--json',
      '--max-chunk-chars', '2000', 'https://example.com/s3/retrieval-options',
    ]);
    expect(fake.calls[0]?.timeoutMs).toBe(120_000);
    expect(fake.calls[0]?.env.PATH?.endsWith('/.local/bin')).toBe(true);

    const file = await callTool(client, 'read_source', {
      source: 'notes/s3.md',
      canonicalUrl: 'https://example.com/s3',
    });
    expect(file.isError).toBe(false);
    expect(fake.calls[1]?.args).toEqual([
      'run', '--project', `${repoRoot}/tools/ingest`, '--python', '3.12', 'dc-ingest', '--json',
      '--canonical-url', 'https://example.com/s3', resolve(process.cwd(), 'notes/s3.md'),
    ]);
    await client.close();
  });

  it('returns an error result when dc-ingest exits non-zero', async () => {
    env = makeTestEnv();
    const fake = recorder({ code: 1, stdout: '', stderr: 'fetching https://example.com/missing\nerror: HTTP 404 Not Found\n\n' });
    const client = await connect(env.config, fake.run);
    const result = await callTool(client, 'read_source', { source: 'https://example.com/missing' });
    expect(result).toEqual({ isError: true, text: 'dc-ingest exited 1: error: HTTP 404 Not Found' });
    await client.close();
  });

  it('rejects unexpected dc-ingest output', async () => {
    env = makeTestEnv();
    const fake = recorder({ code: 0, stdout: '{"v":2,"chunks":[]}', stderr: '' });
    const client = await connect(env.config, fake.run);
    const result = await callTool(client, 'read_source', { source: 'https://example.com/doc' });
    expect(result).toEqual({ isError: true, text: 'dc-ingest returned unexpected output' });
    await client.close();
  });

  it('rejects a non-https URL without spawning', async () => {
    env = makeTestEnv();
    const fake = recorder({ code: 0, stdout: JSON.stringify(INGEST_OUTPUT), stderr: '' });
    const client = await connect(env.config, fake.run);
    for (const source of ['http://example.com/doc', 'file:///etc/hosts', 'ftp://example.com/x']) {
      const result = await callTool(client, 'read_source', { source });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/https/);
    }
    expect(fake.calls).toEqual([]);
    await client.close();
  });

  it('refuses the token file, credential directories and non-document files without spawning', async () => {
    env = makeTestEnv();
    const fake = recorder({ code: 0, stdout: JSON.stringify(INGEST_OUTPUT), stderr: '' });
    const client = await connect(env.config, fake.run);
    const tokenFile = env.config.tokenFile;
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, JSON.stringify({ accessToken: 'FAKE-abc', refreshToken: 'FAKE-def' }));
    const home = process.env.HOME ?? '';

    const refused: Array<[string, RegExp]> = [
      [tokenFile, /only \.pdf, \.html, \.htm, \.md, \.markdown, \.txt files are read/],
      [join(dirname(tokenFile), 'notes.md'), /credential locations are never read/],
      [join(home, '.aws', 'credentials.txt'), /credential locations are never read/],
      [join(home, '.ssh', 'id_ed25519.md'), /credential locations are never read/],
      [join(home, '.config', 'developercards', 'mcp-tokens.txt'), /credential locations are never read/],
      [join(env.dir, 'project', '.env'), /only \.pdf/],
      ['notes/config.json', /only \.pdf/],
    ];
    for (const [source, message] of refused) {
      const result = await callTool(client, 'read_source', { source, canonicalUrl: 'https://example.com/x' });
      expect(result.isError, source).toBe(true);
      expect(result.text).toMatch(/^refused local file /);
      expect(result.text).toMatch(message);
      expect(result.text).not.toContain('FAKE-');
    }

    // A symlink with a document suffix that points at the token file.
    const link = join(env.dir, 'innocent.md');
    symlinkSync(tokenFile, link);
    const viaLink = await callTool(client, 'read_source', { source: link });
    expect(viaLink.isError).toBe(true);
    expect(viaLink.text).toMatch(/refused local file/);
    expect(fake.calls).toEqual([]);
    await client.close();
  });

  it('passes the repo root and token file to dc-ingest so it applies the same roots', async () => {
    env = makeTestEnv();
    const fake = recorder({ code: 0, stdout: JSON.stringify(INGEST_OUTPUT), stderr: '' });
    const client = await connect(env.config, fake.run);
    const result = await callTool(client, 'read_source', { source: 'https://example.com/s3/retrieval-options' });
    expect(result.isError).toBe(false);
    expect(fake.calls[0]?.env.DC_REPO_ROOT).toBe(env.config.repoRoot);
    expect(fake.calls[0]?.env.DC_TOKEN_FILE).toBe(env.config.tokenFile);
    await client.close();
  });

  describe('paging (ai-agent-23)', () => {
    // 250 chunks of 3500 characters: about 875,000 characters of text, far past one MCP tool result.
    const LONG_URL = 'https://docs.example.com/whitepaper';
    const longText = (i: number) => `Section ${i} says: ${'x'.repeat(3500 - `Section ${i} says: `.length)}`;
    const longDoc = ingestDoc(LONG_URL, { sourceId: 'sid-long', chunks: Array.from({ length: 250 }, (_, i) => longText(i + 1)) });

    async function setup() {
      env = makeTestEnv();
      const fake = recorder({ code: 0, stdout: JSON.stringify(longDoc), stderr: '' });
      return { fake, client: await connect(env.config, fake.run) };
    }

    it('returns an outline page with previews instead of every chunk text', async () => {
      const { client } = await setup();
      const first = await callTool(client, 'read_source', { source: LONG_URL });
      expect(first.isError).toBe(false);
      expect(first.text.length).toBeLessThan(60_000);
      const page = JSON.parse(first.text);
      expect(page).toMatchObject({ sourceId: 'sid-long', url: LONG_URL, chunkCount: 250, totalChars: 250 * 3500, offset: 0, nextOffset: OUTLINE_PAGE_MAX });
      expect(page.chunks).toHaveLength(OUTLINE_PAGE_MAX);
      expect(page.chunks[0]).toEqual({
        id: 'c0001', index: 0, heading: null, page: null, charStart: 0, charEnd: 3500, textChars: 3500,
        preview: `${longText(1).slice(0, PREVIEW_CHARS)}…`,
      });
      expect(page.chunks[0]).not.toHaveProperty('text');

      const last = JSON.parse((await callTool(client, 'read_source', { source: LONG_URL, offset: 200, limit: 100 })).text);
      expect(last).toMatchObject({ offset: 200, nextOffset: null });
      expect(last.chunks.map((c: { id: string }) => c.id)).toEqual(Array.from({ length: 50 }, (_, i) => `c${String(i + 201).padStart(4, '0')}`));

      const small = JSON.parse((await callTool(client, 'read_source', { source: LONG_URL, offset: 10, limit: 5 })).text);
      expect(small).toMatchObject({ offset: 10, nextOffset: 15 });
      expect(small.chunks).toHaveLength(5);

      const tooMany = await callTool(client, 'read_source', { source: LONG_URL, limit: OUTLINE_PAGE_MAX + 1 });
      expect(tooMany.isError).toBe(true);
      await client.close();
    });

    it('returns full chunk text by id within the per-call budget and reuses the read', async () => {
      const { client, fake } = await setup();
      await callTool(client, 'read_source', { source: LONG_URL });
      const read = await callTool(client, 'read_source', { source: LONG_URL, chunkIds: ['c0120', 'c0003', 'c0003'] });
      expect(read.isError).toBe(false);
      const body = JSON.parse(read.text);
      expect(body).toMatchObject({ sourceId: 'sid-long', chunkCount: 250, remainingChunkIds: [] });
      expect(body.chunks.map((c: { id: string; text: string }) => [c.id, c.text])).toEqual([
        ['c0120', longText(120)],
        ['c0003', longText(3)],
      ]);
      expect(body.chunks[0]).toMatchObject({ index: 119, charStart: 119 * 3502, charEnd: 119 * 3502 + 3500 });

      // 20 ids of 3500 characters each exceed the budget: the rest comes back as remainingChunkIds.
      const ids = Array.from({ length: 20 }, (_, i) => `c${String(i + 1).padStart(4, '0')}`);
      const capped = JSON.parse((await callTool(client, 'read_source', { source: LONG_URL, chunkIds: ids })).text);
      const fit = Math.floor(CHUNK_TEXT_BUDGET / 3500);
      expect(capped.chunks).toHaveLength(fit);
      expect(capped.remainingChunkIds).toEqual(ids.slice(fit));

      // Pages and chunk reads after the first call do not run dc-ingest again.
      expect(fake.calls).toHaveLength(1);
      // A new first page reads the source again.
      await callTool(client, 'read_source', { source: LONG_URL });
      expect(fake.calls).toHaveLength(2);
      await client.close();
    });

    it('refuses unknown chunk ids and chunkIds combined with offset/limit', async () => {
      const { client, fake } = await setup();
      const unknown = await callTool(client, 'read_source', { source: LONG_URL, chunkIds: ['c0001', 'c9999'] });
      expect(unknown).toEqual({ isError: true, text: 'UNKNOWN_CHUNK_ID: c9999 (this source has chunks c0001..c0250)' });
      // Without an earlier read the chunk read ingests the source once.
      expect(fake.calls).toHaveLength(1);
      const both = await callTool(client, 'read_source', { source: LONG_URL, chunkIds: ['c0001'], offset: 0 });
      expect(both).toEqual({ isError: true, text: 'pass either chunkIds or offset/limit, not both' });
      await client.close();
    });

    it('describes the paging contract', async () => {
      env = makeTestEnv();
      const client = await connect(env.config);
      const { tools } = await client.listTools();
      const description = tools.find((t) => t.name === 'read_source')?.description ?? '';
      for (const phrase of [/offset/, /nextOffset/, /chunkIds/, /remainingChunkIds/, /preview/, new RegExp(String(CHUNK_TEXT_BUDGET))]) {
        expect(description).toMatch(phrase);
      }
      await client.close();
    });
  });
});
