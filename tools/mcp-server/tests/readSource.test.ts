import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunProcess } from '../src/ingest';
import { callTool, connect, makeTestEnv, type TestEnv } from './helpers';

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
    expect(JSON.parse(url.text)).toEqual(INGEST_OUTPUT);
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
});
