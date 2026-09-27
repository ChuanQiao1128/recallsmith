import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeArgs, killGroup } from '../src/claude';
import type { RunnerConfig } from '../src/config';
import { EXIT_FAILURE, EXIT_LOGIN_REQUIRED, EXIT_OK, runOnce } from '../src/runner';
import {
  envelope,
  makeHome,
  runnerConfig,
  sendJson,
  startFakeApi,
  writeTokenFile,
  type FakeApi,
  type RecordedRequest,
  type TestHome,
} from './helpers';

const ROUTE = '/api/v1/authoring/automation/runner/';
const HEARTBEAT_KEYS = [
  'claudeVersion',
  'host',
  'lastError',
  'lastRunAt',
  'lastRunId',
  'lastRunOutcome',
  'loginExpiresAt',
  'runnerId',
  'runnerVersion',
  'state',
];
const COMPLETE_KEYS = ['durationMs', 'error', 'exitCode', 'numTurns', 'outcome', 'runId', 'runnerId', 'summary'];

let cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    itemId: 42,
    runId: randomUUID(),
    kind: 'feed_item',
    url: 'https://docs.example.com/whats-new/feature',
    deckId: 7,
    deckSlug: 'aws-lambda',
    title: 'A new feature',
    sectionHint: null,
    note: null,
    attempts: 1,
    leaseExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    maxCards: 5,
    ...overrides,
  };
}

interface ApiScript {
  effectiveMode?: string;
  /** The queue: each claim hands out the next `max` items, as the server does. */
  items?: Array<Record<string, unknown>>;
  /** When set, each claimed item's lease ends this long after its claim (like the server's lease). */
  leaseMs?: number;
  heartbeatStatus?: number;
  claimFails?: boolean;
}

function handler(script: ApiScript) {
  return (req: RecordedRequest, res: ServerResponse): void => {
    if (req.url === `${ROUTE}heartbeat`) {
      if (script.heartbeatStatus !== undefined) {
        sendJson(res, script.heartbeatStatus, { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'no' } });
        return;
      }
      sendJson(
        res,
        200,
        envelope({
          mode: script.effectiveMode ?? 'dry_run',
          effectiveMode: script.effectiveMode ?? 'dry_run',
          liveBlockedReason: null,
          serverTime: new Date().toISOString(),
          queue: { queued: 1, due: 1 },
          pollAfterSeconds: 3600,
        }),
      );
    } else if (req.url === `${ROUTE}claim` && script.claimFails === true) {
      sendJson(res, 500, { success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'boom' } });
    } else if (req.url === `${ROUTE}claim`) {
      const queue = script.items ?? [];
      const max = typeof req.body.max === 'number' ? req.body.max : 1;
      const items = queue.splice(0, max).map((it) =>
        script.leaseMs === undefined ? it : { ...it, leaseExpiresAt: new Date(Date.now() + script.leaseMs).toISOString() },
      );
      sendJson(res, 200, envelope({ mode: 'dry_run', effectiveMode: 'dry_run', items }));
    } else if (req.url === `${ROUTE}complete`) {
      sendJson(
        res,
        200,
        envelope({
          runId: req.body.runId,
          runStatus: req.body.outcome === 'failed' ? 'failed' : 'completed',
          itemStatus: 'done',
          decisions: { total: 0, pending: 0 },
          replayed: false,
        }),
      );
    } else {
      sendJson(res, 404, { success: false, data: null, error: { code: 'NOT_FOUND', message: 'no route' } });
    }
  };
}

async function setup(script: ApiScript, overrides: Partial<RunnerConfig> = {}, withToken = true) {
  const t: TestHome = makeHome();
  cleanups.push(t.cleanup);
  const api: FakeApi = await startFakeApi(handler(script));
  cleanups.push(api.close);
  if (withToken) writeTokenFile(t.tokenFile);
  const config = runnerConfig(t, api.base, overrides);
  const lines: string[] = [];
  const events = () => lines.map((l) => (JSON.parse(l) as { event: string }).event);
  const env = (mode: string, extra: Record<string, string> = {}) => ({
    ...process.env,
    DC_TEST_FAKE_CLAUDE_MODE: mode,
    DC_TEST_FAKE_CLAUDE_RECORD: t.recordFile,
    AWS_ACCESS_KEY_ID: 'PLACEHOLDER-not-a-secret',
    AWS_SECRET_ACCESS_KEY: 'PLACEHOLDER-not-a-secret',
    AWS_PROFILE: 'PLACEHOLDER-not-a-secret',
    ANTHROPIC_API_KEY: 'PLACEHOLDER-not-a-secret',
    ANTHROPIC_AUTH_TOKEN: 'PLACEHOLDER-not-a-secret',
    ANTHROPIC_BASE_URL: 'PLACEHOLDER-not-a-secret',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_USE_FOUNDRY: '1',
    ANTHROPIC_FOUNDRY_API_KEY: 'PLACEHOLDER-not-a-secret',
    ANTHROPIC_CUSTOM_HEADERS: 'X-Placeholder: not-a-secret',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    NODE_OPTIONS: '--require=/tmp/placeholder.js',
    ...extra,
  });
  return { t, api, config, lines, events, env, log: (line: string) => lines.push(line) };
}

function routes(api: FakeApi): string[] {
  return api.requests.map((r) => `${r.url.slice(ROUTE.length)}${r.body.state ? `(${String(r.body.state)})` : ''}`);
}

function record(t: TestHome): { argv: string[]; pid: number; childPid: number | null; cwd: string; envNames: string[] } {
  return JSON.parse(readFileSync(t.recordFile, 'utf8'));
}

function completeBody(api: FakeApi): Record<string, unknown> {
  const req = api.requests.find((r) => r.url === `${ROUTE}complete`);
  expect(req).toBeDefined();
  return req!.body;
}

describe('runOnce', () => {
  it('runs one claimed item end to end against the loopback API', async () => {
    const claimed = item();
    const s = await setup({ items: [claimed] });
    const code = await runOnce(s.config, { env: s.env('done'), log: s.log });
    expect(code).toBe(EXIT_OK);

    // One item per claim (ai-agent-2): the second claim finds the queue empty.
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'complete', 'claim', 'heartbeat(idle)']);
    for (const r of s.api.requests) expect(r.method).toBe('POST');

    const [first, claim, , , last] = s.api.requests;
    expect(Object.keys(first!.body).sort()).toEqual(HEARTBEAT_KEYS);
    expect(first!.body).toMatchObject({ runnerId: 'test-runner', runnerVersion: '1.0.0', state: 'running', lastError: null });
    expect(first!.body.claudeVersion).toBe('2.1.283 (Claude Code, test fake)');
    expect(first!.body.loginExpiresAt).toBe(new Date((1_790_000_000 + 30 * 86_400) * 1000).toISOString());
    expect(claim!.body).toEqual({ runnerId: 'test-runner', max: 1, leaseMinutes: 90 });
    expect(Object.keys(last!.body).sort()).toEqual(HEARTBEAT_KEYS);
    expect(last!.body).toMatchObject({ state: 'idle', lastRunId: claimed.runId, lastRunOutcome: 'done', lastError: null });

    const complete = completeBody(s.api);
    expect(Object.keys(complete).sort()).toEqual(COMPLETE_KEYS);
    expect(complete).toMatchObject({
      runnerId: 'test-runner',
      runId: claimed.runId,
      outcome: 'done',
      exitCode: 0,
      numTurns: 7,
      error: null,
      summary: 'two new cards drafted',
    });
    expect(typeof complete.durationMs).toBe('number');

    const runsDir = join(s.config.logDir, 'runs');
    const mcpPath = join(runsDir, `${String(claimed.runId)}.mcp.json`);
    expect(JSON.parse(readFileSync(mcpPath, 'utf8'))).toEqual({
      mcpServers: {
        developercards: {
          command: process.execPath,
          args: [`${s.t.repo}/tools/mcp-server/dist/index.js`],
          env: {
            DC_AUTOMATION_RUN_ID: claimed.runId,
            DC_AUTOMATION_QUEUE_ITEM_ID: '42',
            DC_AUTOMATION_DECK_SLUG: 'aws-lambda',
            DC_AUTOMATION_SOURCE_HOSTS:
              'docs.example.com,docs.aws.amazon.com,aws.amazon.com,platform.claude.com,docs.claude.com,docs.anthropic.com,www.anthropic.com',
            DC_AUTOMATION_AUTHOR_MODEL: 'claude-opus-5-5',
            DC_AUTOMATION_SKILL_VERSION: 'author-cards@1.8.1',
          },
        },
      },
    });
    const prompt = readFileSync(join(runsDir, `${String(claimed.runId)}.prompt.md`), 'utf8');
    expect(prompt).toContain('https://docs.example.com/whats-new/feature');

    const rec = record(s.t);
    expect(prompt).toContain('skillVersion: "author-cards@1.8.1"');
    expect(rec.argv).toEqual(claudeArgs(prompt, 'claude-opus-5-5', mcpPath));
    expect(rec.envNames.filter((n) => n.startsWith('AWS_') || n.startsWith('ANTHROPIC_'))).toEqual([]);
    expect(rec.envNames).not.toContain('CLAUDE_CODE_USE_BEDROCK');
    expect(rec.envNames).not.toContain('CLAUDE_CODE_USE_VERTEX');
    expect(rec.envNames).toContain('PATH');
    // ai-agent-10: an allowlisted environment; provider switches, custom headers and proxies never pass.
    for (const name of ['CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_CUSTOM_HEADERS', 'HTTPS_PROXY', 'NODE_OPTIONS']) {
      expect(rec.envNames).not.toContain(name);
    }
    expect(rec.envNames.every((n) => /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|LANG|TERM|TZ|CLAUDE_CONFIG_DIR|LC_.*|DC_.*|__CF_USER_TEXT_ENCODING)$/.test(n))).toBe(true);

    // ai-agent-3: the pinned author configuration and the CLI's reported usage are recorded per run.
    const meta = JSON.parse(readFileSync(join(runsDir, `${String(claimed.runId)}.meta.json`), 'utf8')) as {
      authorConfig: Record<string, unknown>;
    };
    expect(meta).toMatchObject({ runId: claimed.runId, itemId: 42, outcome: 'done', usage: { totalCostUsd: 1.25, models: ['claude-opus-5-5'] } });
    expect(meta.authorConfig).toMatchObject({
      model: 'claude-opus-5-5',
      skillVersion: 'author-cards@1.8.1',
      mcpServerSha256: null,
      claudeVersion: '2.1.283 (Claude Code, test fake)',
      runnerVersion: '1.0.0',
    });
    for (const key of ['skillSha256', 'promptSha256', 'claudeArgsSha256']) expect(meta.authorConfig[key]).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.authorConfig.id).toMatch(/^[0-9a-f]{16}$/);
    const itemStart = s.lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === 'item_start');
    expect(itemStart?.authorConfigId).toBe(meta.authorConfig.id);

    expect(JSON.parse(readFileSync(join(s.config.logDir, 'last-run.json'), 'utf8'))).toMatchObject({
      runId: claimed.runId,
      itemId: 42,
      outcome: 'done',
    });
    expect(s.events()).toEqual(['start', 'claimed', 'item_start', 'item_done', 'finish']);
    for (const line of s.lines) expect(line).not.toContain('PLACEHOLDER');
    expect(existsSync(s.config.lockFile)).toBe(false);
  });

  it('exits 3 without claiming when the login is missing', async () => {
    const missing = await setup({ items: [item()] }, {}, false);
    expect(await runOnce(missing.config, { env: missing.env('done'), log: missing.log })).toBe(EXIT_LOGIN_REQUIRED);
    expect(missing.api.requests).toEqual([]);
    expect(missing.lines.join('\n')).toContain('"event":"login_required"');
    expect(existsSync(missing.t.recordFile)).toBe(false);

    const rejected = await setup({ items: [item()], heartbeatStatus: 401 });
    expect(await runOnce(rejected.config, { env: rejected.env('done'), log: rejected.log })).toBe(EXIT_LOGIN_REQUIRED);
    expect(routes(rejected.api)).toEqual(['heartbeat(running)']);
    expect(rejected.events()).toContain('login_required');
    expect(existsSync(rejected.config.lockFile)).toBe(false);
  });

  it('stops after the heartbeat when the effective mode is off', async () => {
    const s = await setup({ effectiveMode: 'off', items: [item()] });
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'heartbeat(idle)']);
    expect(s.events()).toContain('mode_off');
    expect(existsSync(s.t.recordFile)).toBe(false);
  });

  it('logs no_items and goes idle when nothing is claimed', async () => {
    const s = await setup({ items: [] });
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'heartbeat(idle)']);
    expect(s.events()).toContain('no_items');
  });

  it('reports an API error as exit 1 with a best-effort error heartbeat', async () => {
    const s = await setup({ claimFails: true });
    const code = await runOnce(s.config, { env: s.env('done'), log: s.log });
    expect(code).toBe(EXIT_FAILURE);
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'heartbeat(error)']);
    expect(s.api.requests[2]!.body.lastError).toBe('HTTP 500 INTERNAL_ERROR: boom');
    expect(s.events()).toContain('api_error');
  });

  it('reports a timed-out claude run as failed and kills its process group', async () => {
    const s = await setup({ items: [item()] }, { itemTimeoutMs: 1500, killGraceMs: 500 });
    expect(await runOnce(s.config, { env: s.env('hang-ignore-term'), log: s.log })).toBe(EXIT_OK);
    expect(completeBody(s.api)).toMatchObject({ outcome: 'failed', error: 'timeout', exitCode: null, numTurns: null });
    const { pid } = record(s.t);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (err) {
      alive = (err as NodeJS.ErrnoException).code !== 'ESRCH';
    }
    expect(alive).toBe(false);
    const last = s.api.requests[s.api.requests.length - 1]!;
    expect(last.body).toMatchObject({ state: 'error', lastError: 'timeout', lastRunOutcome: 'failed' });
  });

  it('reports a non-zero claude exit as failed with the first 500 characters of stderr', async () => {
    const s = await setup({ items: [item()] });
    expect(await runOnce(s.config, { env: s.env('fail'), log: s.log })).toBe(EXIT_OK);
    const body = completeBody(s.api);
    const line = 'fake claude failure line with some detail ';
    const expected = `${line.repeat(8)} ${line.repeat(12)}`.slice(0, 500);
    expect(body).toMatchObject({ outcome: 'failed', exitCode: 2, error: expected });
    expect((body.error as string).length).toBe(500);
    expect(body.error).not.toMatch(/[\r\n]/);
  });

  it('reports is_error and non-JSON output as failed', async () => {
    const a = await setup({ items: [item()] });
    await runOnce(a.config, { env: a.env('is_error'), log: a.log });
    expect(completeBody(a.api)).toMatchObject({ outcome: 'failed', exitCode: 0, error: 'claude result is_error' });

    const b = await setup({ items: [item()] });
    await runOnce(b.config, { env: b.env('garbage'), log: b.log });
    expect(completeBody(b.api)).toMatchObject({ outcome: 'failed', exitCode: 0, error: 'claude output is not JSON' });

    const c = await setup({ items: [item()] });
    await runOnce(c.config, { env: c.env('nothing_new'), log: c.log });
    expect(completeBody(c.api)).toMatchObject({ outcome: 'nothing_new', exitCode: 0, summary: 'deck already covers the page' });
  });

  it('reports a claude that cannot be started as failed', async () => {
    const s = await setup({ items: [item()] });
    const config = { ...s.config, claudeBin: join(s.t.dir, 'no-such-claude') };
    expect(await runOnce(config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
    expect(completeBody(s.api)).toMatchObject({ outcome: 'failed', error: 'claude could not be started: ENOENT' });
  });

  it('releases invalid items and a short-lease item at once instead of leaving them claimed (automation-7)', async () => {
    const badSlug = item({ deckSlug: '../x' });
    const badUrl = item({ url: 'http://docs.example.com/' });
    const badId = item({ itemId: -1 });
    const short = item();
    const s = await setup(
      { items: [item({ runId: '../../etc' }), badSlug, badUrl, badId] },
      { maxItems: 5 },
    );
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
    // A run id that is not a uuid cannot be reported; every other skipped item is handed back with complete.
    const completes = s.api.requests.filter((r) => r.url === `${ROUTE}complete`).map((r) => r.body);
    expect(completes.map((b) => [b.runId, b.outcome, b.error])).toEqual([
      [badSlug.runId, 'failed', 'not run: invalid deckSlug'],
      [badUrl.runId, 'failed', 'not run: invalid url'],
      [badId.runId, 'failed', 'not run: invalid itemId'],
    ]);
    for (const b of completes) expect(b).toMatchObject({ exitCode: null, durationMs: 0, numTurns: null, summary: null });
    expect(s.events().filter((e) => e === 'bad_item')).toHaveLength(4);
    expect(existsSync(s.t.recordFile)).toBe(false);
    expect(s.api.requests[s.api.requests.length - 1]!.body).toMatchObject({ state: 'error', lastError: 'not run: invalid itemId' });

    // A lease shorter than one item is released and ends the run: every later claim would be short too.
    const t = await setup({ items: [short, item()], leaseMs: 60_000 });
    expect(await runOnce(t.config, { env: t.env('done'), log: t.log })).toBe(EXIT_OK);
    expect(routes(t.api)).toEqual(['heartbeat(running)', 'claim', 'complete', 'heartbeat(error)']);
    expect(completeBody(t.api)).toMatchObject({
      runId: short.runId,
      outcome: 'failed',
      error: 'not run: lease_short (the lease ends before the item timeout)',
    });
    expect(t.events()).toContain('lease_short');
    expect(existsSync(t.t.recordFile)).toBe(false);
  });

  it('claims each item right before its run, so a third item after two slow ones still runs (ai-agent-2)', async () => {
    const items = [item({ itemId: 1 }), item({ itemId: 2 }), item({ itemId: 3 })];
    // Each lease covers one item (timeout 1.5 s) but not three items of 1 s each in a row.
    const s = await setup({ items: [...items], leaseMs: 2_500 }, { itemTimeoutMs: 1_500, maxItems: 3 });
    expect(await runOnce(s.config, { env: s.env('done', { DC_TEST_FAKE_CLAUDE_DELAY_MS: '1000' }), log: s.log })).toBe(EXIT_OK);
    expect(routes(s.api).filter((r) => r !== 'heartbeat(running)')).toEqual([
      'claim',
      'complete',
      'claim',
      'complete',
      'claim',
      'complete',
      'heartbeat(idle)',
    ]);
    for (const r of s.api.requests.filter((q) => q.url === `${ROUTE}claim`)) expect(r.body.max).toBe(1);
    const completes = s.api.requests.filter((r) => r.url === `${ROUTE}complete`).map((r) => r.body);
    expect(completes.map((b) => [b.runId, b.outcome])).toEqual(items.map((it) => [it.runId, 'done']));
    expect(s.events()).not.toContain('lease_short');
  }, 20_000);

  it('settles a timed-out run even when its process group never empties (ai-agent-6)', async () => {
    const s = await setup({ items: [item()] }, { itemTimeoutMs: 800, killGraceMs: 300, killSettleMs: 300 });
    // A group member that never goes away (an unreaped or stuck MCP/uv child): the probe always says alive.
    const probes: Array<NodeJS.Signals | 0> = [];
    const stuck = (pid: number, signal: NodeJS.Signals | 0): boolean => {
      probes.push(signal);
      return signal === 0 ? true : killGroup(pid, signal) || true;
    };
    const started = Date.now();
    const code = await Promise.race([
      runOnce(s.config, { env: s.env('hang-ignore-term'), log: s.log, signalGroup: stuck }),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 8_000)),
    ]);
    expect(code).toBe(EXIT_OK);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(completeBody(s.api)).toMatchObject({ outcome: 'failed', error: 'timeout', exitCode: null });
    expect(probes).toEqual(expect.arrayContaining(['SIGTERM', 0, 'SIGKILL']));
    expect(existsSync(s.config.lockFile)).toBe(false);
  }, 15_000);

  it('kills a SIGTERM-ignoring child in the claude process group and settles (ai-agent-6)', async () => {
    const s = await setup({ items: [item()] }, { itemTimeoutMs: 1_000, killGraceMs: 300, killSettleMs: 300 });
    expect(await runOnce(s.config, { env: s.env('hang-ignore-term-child'), log: s.log })).toBe(EXIT_OK);
    expect(completeBody(s.api)).toMatchObject({ outcome: 'failed', error: 'timeout' });
    const { pid, childPid } = record(s.t);
    expect(childPid).not.toBeNull();
    for (const p of [pid, childPid!]) {
      let alive = true;
      try {
        process.kill(p, 0);
      } catch (err) {
        alive = (err as NodeJS.ErrnoException).code !== 'ESRCH';
      }
      expect(alive).toBe(false);
    }
  }, 15_000);

  it('fails a run whose result shows a cloud provider instead of the subscription (ai-agent-10)', async () => {
    const s = await setup({ items: [item()] });
    expect(await runOnce(s.config, { env: s.env('provider'), log: s.log })).toBe(EXIT_OK);
    expect(completeBody(s.api)).toMatchObject({
      outcome: 'failed',
      exitCode: 0,
      error: 'claude did not run on the subscription login: provider model us.anthropic.claude-opus-5-5-v1:0',
    });
  });

  it('runs nothing when the author configuration cannot be pinned (ai-agent-3)', async () => {
    const s = await setup({ items: [item()] });
    rmSync(join(s.t.repo, '.claude'), { recursive: true, force: true });
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_FAILURE);
    expect(routes(s.api)).toEqual(['heartbeat(error)']);
    expect(s.api.requests[0]!.body.lastError).toBe('author config: cannot read .claude/skills/author-cards/SKILL.md in the repo root');
    expect(s.events()).toContain('author_config_error');
    expect(existsSync(s.t.recordFile)).toBe(false);
  });

  it('sends a heartbeat while claude runs', async () => {
    const claimed = item();
    const s = await setup({ items: [claimed] }, { heartbeatIntervalMs: 200 });
    expect(await runOnce(s.config, { env: s.env('done', { DC_TEST_FAKE_CLAUDE_DELAY_MS: '1200' }), log: s.log })).toBe(EXIT_OK);
    const order = routes(s.api);
    const claimAt = order.indexOf('claim');
    const completeAt = order.indexOf('complete');
    const during = s.api.requests.slice(claimAt + 1, completeAt);
    expect(during.length).toBeGreaterThanOrEqual(1);
    for (const r of during) {
      expect(r.url).toBe(`${ROUTE}heartbeat`);
      expect(r.body).toMatchObject({ state: 'running', lastRunId: claimed.runId });
    }
  });

  it('logs locked and exits 0 when another run holds the lock', async () => {
    const s = await setup({ items: [item()] });
    const { acquireLock } = await import('../src/lock');
    const held = acquireLock(s.config.lockFile);
    expect(held).not.toBeNull();
    try {
      expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
      expect(s.events()).toEqual(['start', 'locked']);
      expect(s.api.requests).toEqual([]);
    } finally {
      held!.release();
    }
  });
});
