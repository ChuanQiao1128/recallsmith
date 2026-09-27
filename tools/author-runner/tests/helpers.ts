// Test helpers: a loopback fake API, a temp HOME, a copied fake claude and a token file.
// Nothing here touches the network beyond 127.0.0.1 or runs the real claude.

import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveTokens } from '../../mcp-server/src/auth/tokens';
import { loadRunnerConfig, type RunnerConfig } from '../src/config';

export const FAKE_CLAUDE_SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');

/** A stand-in for tools/mcp-server/dist/tool-surface.json (N4). */
export const TEST_TOOL_SURFACE = {
  constants: { SOURCE_QUOTE_MIN_CHARS: 40, SOURCE_QUOTE_MIN_WORDS: 6 },
  server: { name: 'developercards', version: '1.8.0' },
  tools: ['submit_draft', 'read_source', 'lint_card', 'find_similar_cards'].map((name) => ({
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    name,
  })),
};

export interface RecordedRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

export type Handler = (req: RecordedRequest, res: ServerResponse) => void;

export interface FakeApi {
  base: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startFakeApi(handler: Handler): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function envelope(data: unknown): unknown {
  return { success: true, data, error: null, traceId: 'trace-test', version: 'v1' };
}

export function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** A JWT-shaped string (unsigned) with the given payload. */
export function fakeJwt(payload: Record<string, unknown>): string {
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.PLACEHOLDER-signature`;
}

export function writeTokenFile(file: string, idPayload: Record<string, unknown> = { auth_time: 1_790_000_000 }): void {
  saveTokens(file, {
    accessToken: 'PLACEHOLDER-access-not-a-secret',
    idToken: fakeJwt(idPayload),
    refreshToken: 'PLACEHOLDER-refresh-not-a-secret',
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
}

export interface TestHome {
  dir: string;
  home: string;
  repo: string;
  tokenFile: string;
  claudeBin: string;
  recordFile: string;
  cleanup(): void;
}

/** A temp HOME, a temp repo root, a token-file path (not written) and an executable copy of the fake claude. */
export function makeHome(): TestHome {
  const dir = mkdtempSync(join(tmpdir(), 'dc-runner-test-'));
  const home = join(dir, 'home');
  const repo = join(dir, 'repo');
  const bin = join(dir, 'bin');
  for (const d of [home, repo, bin]) mkdirSync(d, { recursive: true });
  // The runner pins the skill version from SKILL.md before it claims anything.
  const skillDir = join(repo, '.claude', 'skills', 'author-cards');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# Author cards (test)\n\nSkill version: `author-cards@1.8.1`.\n');
  // ... and the MCP server bundle the run's MCP config starts (a stand-in; the fake claude never starts it).
  const mcpDist = join(repo, 'tools', 'mcp-server', 'dist');
  mkdirSync(mcpDist, { recursive: true });
  writeFileSync(join(mcpDist, 'index.js'), '// test stand-in for the MCP server bundle\n');
  // ... and the tool surface its build lists next to it (N4).
  writeFileSync(join(mcpDist, 'tool-surface.json'), `${JSON.stringify(TEST_TOOL_SURFACE)}\n`);
  const claudeBin = join(bin, 'claude');
  copyFileSync(FAKE_CLAUDE_SOURCE, claudeBin);
  chmodSync(claudeBin, 0o755);
  return {
    dir,
    home,
    repo,
    tokenFile: join(dir, 'config', 'mcp-tokens.json'),
    claudeBin,
    recordFile: join(dir, 'claude-record.json'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function runnerConfig(t: TestHome, apiBase: string, overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  const config = loadRunnerConfig({
    HOME: t.home,
    DC_API_BASE: apiBase,
    DC_TOKEN_FILE: t.tokenFile,
    DC_REPO_ROOT: t.repo,
    DC_RUNNER_ID: 'test-runner',
    DC_RUNNER_CLAUDE_BIN: t.claudeBin,
  });
  return { ...config, ...overrides };
}
