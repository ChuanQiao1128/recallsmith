import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli';
import { makeHome, sendJson, startFakeApi, writeTokenFile } from './helpers';

let cleanups: Array<() => unknown> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

async function status(env: Record<string, string>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });
  const code = await main(['status'], env);
  vi.restoreAllMocks();
  return { code, out: chunks.join('') };
}

describe('status', () => {
  it('prints status without a network call', async () => {
    const t = makeHome();
    cleanups.push(t.cleanup);
    const api = await startFakeApi((_req, res) => sendJson(res, 500, {}));
    cleanups.push(api.close);
    const env = {
      HOME: t.home,
      DC_API_BASE: api.base,
      DC_TOKEN_FILE: t.tokenFile,
      DC_RUNNER_ID: 'test-runner',
      DC_RUNNER_CLAUDE_BIN: t.claudeBin,
      DC_TEST_FAKE_CLAUDE_RECORD: t.recordFile,
    };

    const missing = await status(env);
    expect(missing.code).toBe(0);
    expect(missing.out.endsWith('\n')).toBe(true);
    expect(missing.out.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(missing.out)).toEqual({
      runnerId: 'test-runner',
      loginExpiresAt: null,
      loginExpiresInDays: null,
      tokenFile: 'missing',
      lastLocalRun: null,
    });

    const signIn = Math.floor(Date.now() / 1000) - 10 * 86_400;
    writeTokenFile(t.tokenFile, { auth_time: signIn });
    const lastRun = {
      runId: '6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
      itemId: 9,
      outcome: 'nothing_new',
      finishedAt: '2026-09-27T10:00:00.000Z',
      durationMs: 1234,
    };
    const logDir = join(t.home, 'Library', 'Logs', 'DeveloperCards');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'last-run.json'), JSON.stringify(lastRun));

    const present = await status(env);
    const parsed = JSON.parse(present.out) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      runnerId: 'test-runner',
      loginExpiresAt: new Date((signIn + 30 * 86_400) * 1000).toISOString(),
      tokenFile: 'present',
      lastLocalRun: lastRun,
    });
    expect(parsed.loginExpiresInDays).toBeCloseTo(20, 0);
    expect(String(parsed.loginExpiresInDays)).toMatch(/^\d+(\.\d)?$/);
    expect(present.out).not.toContain(t.tokenFile);
    expect(present.out).not.toContain('PLACEHOLDER');
    expect(present.out).not.toContain(readFileSync(t.tokenFile, 'utf8').slice(0, 40));

    expect(api.requests).toEqual([]);
    expect(existsSync(t.recordFile)).toBe(false);
  });
});
