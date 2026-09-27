import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeArgs, killGroup } from '../src/claude';
import { authorConfigIdOf } from '../src/authorConfig';
import type { RunnerConfig } from '../src/config';
import {
  COMPLETE_ATTEMPTS,
  EXIT_FAILURE,
  EXIT_LOGIN_REQUIRED,
  EXIT_OK,
  USAGE_LIMIT_FALLBACK_MS,
  isPermanentCompleteFailure,
  limitedUntil,
  pendingCompleteDir,
  readRunnerState,
  runOnce,
  runSourceHosts,
  runnerStateFile,
} from '../src/runner';
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
  /** The HTTP status of each `complete` call in turn (0 = the connection is dropped); 200 once used up. */
  completeStatuses?: number[];
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
    } else if (req.url === `${ROUTE}complete` && (script.completeStatuses?.length ?? 0) > 0) {
      const status = script.completeStatuses!.shift()!;
      if (status === 0) res.socket?.destroy();
      else sendJson(res, status, { success: false, data: null, error: { code: status === 409 ? 'RUN_NOT_RUNNING' : 'INTERNAL_ERROR', message: 'no' } });
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
            // ai-agent-21: the item's own host (docs.example.com) gets no implicit pass.
            DC_AUTOMATION_SOURCE_HOSTS: 'docs.aws.amazon.com,aws.amazon.com,platform.claude.com,docs.claude.com,docs.anthropic.com,www.anthropic.com',
            DC_AUTOMATION_AUTHOR_MODEL: 'claude-opus-5-5',
            DC_AUTOMATION_SKILL_VERSION: 'author-cards@1.8.1',
            DC_AUTOMATION_AUTHOR_CONFIG_ID: expect.stringMatching(/^[0-9a-f]{64}$/),
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
      authorConfigId: string;
      authorConfig: Record<string, unknown>;
    };
    expect(meta).toMatchObject({ runId: claimed.runId, itemId: 42, outcome: 'done', usage: { totalCostUsd: 1.25, models: ['claude-opus-5-5'] } });
    expect(meta.authorConfig).toMatchObject({
      model: 'claude-opus-5-5',
      skillVersion: 'author-cards@1.8.1',
      mcpServerSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      claudeVersion: '2.1.283 (Claude Code, test fake)',
      runnerVersion: '1.0.0',
    });
    for (const key of ['skillSha256', 'promptSha256', 'claudeArgsSha256']) expect(meta.authorConfig[key]).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.authorConfig.id).toMatch(/^[0-9a-f]{16}$/);
    const itemStart = s.lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === 'item_start');
    // automation-35: the log carries the gated id the gate card shows, and the local fingerprint apart.
    expect(itemStart?.authorConfigId).toBe(meta.authorConfigId);
    expect(itemStart?.authorConfigId).toMatch(/^[0-9a-f]{64}$/);
    expect(itemStart?.configId).toBe(meta.authorConfig.id);

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
    // M5: the CLI's result subtype and text are kept.
    expect(completeBody(a.api)).toMatchObject({ outcome: 'failed', exitCode: 0, error: 'claude result is_error: error_during_execution: something went wrong' });

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
    expect(completeBody(s.api)).toMatchObject({ outcome: 'failed', error: 'RUNNER_UNAVAILABLE: claude could not be started: ENOENT' });
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
      error: 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: provider model us.anthropic.claude-opus-5-5-v1:0',
    });
  });

  it('completes a blocked agent as failed with AGENT_BLOCKED and a missing outcome line as AGENT_NO_RESULT (L6, ai-agent-13)', async () => {
    const a = await setup({ items: [item()] });
    expect(await runOnce(a.config, { env: a.env('blocked'), log: a.log })).toBe(EXIT_OK);
    expect(completeBody(a.api)).toMatchObject({
      outcome: 'failed',
      exitCode: 0,
      numTurns: 7,
      error: 'AGENT_BLOCKED: read_source refused the page: SOURCE_HOST_NOT_ALLOWED',
      summary: 'could not read the source',
    });
    expect(a.api.requests.at(-1)!.body).toMatchObject({ state: 'error', lastRunOutcome: 'failed' });

    const b = await setup({ items: [item()] });
    await runOnce(b.config, { env: b.env('blocked_result'), log: b.log });
    expect(completeBody(b.api)).toMatchObject({ outcome: 'failed', error: 'AGENT_BLOCKED: the developercards tools are missing' });

    const c = await setup({ items: [item()] });
    await runOnce(c.config, { env: c.env('no_outcome'), log: c.log });
    expect(completeBody(c.api)).toMatchObject({
      outcome: 'failed',
      exitCode: 0,
      error: 'AGENT_NO_RESULT: the final message does not end with the outcome JSON line',
    });

    const d = await setup({ items: [item()] });
    await runOnce(d.config, { env: d.env('mcp_failed'), log: d.log });
    expect(completeBody(d.api)).toMatchObject({ outcome: 'failed', error: 'RUNNER_UNAVAILABLE: the developercards MCP server did not start (failed)' });
  });

  it('fails a run whose system/init message shows an API key or is missing (ai-agent-14)', async () => {
    const a = await setup({ items: [item()] });
    await runOnce(a.config, { env: a.env('api_key'), log: a.log });
    // N3 (ai-agent-23): the run is ended at its init message, so it has no exit code of its own.
    expect(completeBody(a.api)).toMatchObject({
      outcome: 'failed',
      exitCode: null,
      error: 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: apiKeySource /login managed key',
    });
    const b = await setup({ items: [item()] });
    await runOnce(b.config, { env: b.env('no_init'), log: b.log });
    expect(completeBody(b.api)).toMatchObject({
      outcome: 'failed',
      error: 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: no system/init message',
    });
    // The run record keeps what the init message said.
    const c = await setup({ items: [item()] });
    await runOnce(c.config, { env: c.env('done'), log: c.log });
    const runId = String(completeBody(c.api).runId);
    const meta = JSON.parse(readFileSync(join(c.config.logDir, 'runs', `${runId}.meta.json`), 'utf8')) as { usage: Record<string, unknown> };
    expect(meta.usage).toEqual({ totalCostUsd: 1.25, models: ['claude-opus-5-5'], apiKeySource: 'none' });
  });

  it('runs nothing when the MCP server bundle is missing (ai-agent-13)', async () => {
    const s = await setup({ items: [item()] });
    rmSync(join(s.t.repo, 'tools', 'mcp-server', 'dist', 'index.js'));
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_FAILURE);
    expect(routes(s.api)).toEqual(['heartbeat(error)']);
    expect(s.api.requests[0]!.body.lastError).toBe(
      'author config: cannot read tools/mcp-server/dist/index.js in the repo root (build tools/mcp-server)',
    );
    expect(existsSync(s.t.recordFile)).toBe(false);
  });

  it('retries a failed complete, keeps it with the notes, and replays it before the next claim (automation-16)', async () => {
    const claimed = item();
    // One item per launch: this pins the replay at the next launch (the in-run replay has its own test).
    const s = await setup({ items: [claimed], completeStatuses: [503, 0, 500] }, { maxItems: 1 });
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log, sleep })).toBe(EXIT_OK);
    // Three attempts with a growing, jittered backoff between them.
    const completes = s.api.requests.filter((r) => r.url === `${ROUTE}complete`);
    expect(completes).toHaveLength(COMPLETE_ATTEMPTS);
    expect(waits).toHaveLength(COMPLETE_ATTEMPTS - 1);
    expect(waits[0]).toBeGreaterThanOrEqual(1_000);
    expect(waits[0]).toBeLessThanOrEqual(3_000);
    expect(waits[1]).toBeGreaterThanOrEqual(2_000);
    expect(waits[1]).toBeLessThanOrEqual(6_000);
    const sent = completes[0]!.body;
    expect(sent).toMatchObject({ runId: claimed.runId, outcome: 'done', summary: 'two new cards drafted' });
    expect(s.events()).toContain('complete_failed');
    expect(s.events()).toContain('complete_pending');
    expect(s.api.requests.at(-1)!.body).toMatchObject({ state: 'error' });
    expect(String(s.api.requests.at(-1)!.body.lastError)).toMatch(new RegExp(`^complete failed for ${String(claimed.runId)}: HTTP 500`));

    // The request and the agent's notes are kept locally.
    const file = join(pendingCompleteDir(s.config), `${String(claimed.runId)}.json`);
    const kept = JSON.parse(readFileSync(file, 'utf8')) as { itemId: number; request: Record<string, unknown> };
    expect(kept.itemId).toBe(42);
    expect(kept.request).toEqual(sent);

    // The next launch re-sends it before its first claim; the server applies it (or answers replayed).
    s.api.requests.length = 0;
    s.lines.length = 0;
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log, sleep })).toBe(EXIT_OK);
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'complete', 'claim', 'heartbeat(idle)']);
    expect(s.api.requests[1]!.body).toEqual(sent);
    expect(existsSync(file)).toBe(false);
    expect(s.events()).toContain('complete_replayed');
  });

  it('keeps a kept complete after another transient failure and drops one the server refuses for good (automation-16)', async () => {
    const claimed = item();
    const s = await setup({ items: [claimed], completeStatuses: [500, 500, 500] }, { maxItems: 1 });
    const sleep = async () => {};
    await runOnce(s.config, { env: s.env('nothing_new'), log: s.log, sleep });
    const file = join(pendingCompleteDir(s.config), `${String(claimed.runId)}.json`);
    expect(existsSync(file)).toBe(true);

    // Still down on the next launch: the complete stays kept and the run reports the error; the claim still happens.
    const down = await setup({ completeStatuses: [502] });
    const config = { ...down.config, logDir: s.config.logDir, lockFile: s.config.lockFile };
    expect(await runOnce(config, { env: down.env('done'), log: down.log, sleep })).toBe(EXIT_OK);
    expect(routes(down.api)).toEqual(['heartbeat(running)', 'complete', 'claim', 'heartbeat(idle)']);
    expect(existsSync(file)).toBe(true);

    // The run was abandoned meanwhile and the server refuses the outcome (409): dropped, never re-sent.
    const refused = await setup({ completeStatuses: [409] });
    const config2 = { ...refused.config, logDir: s.config.logDir, lockFile: s.config.lockFile };
    expect(await runOnce(config2, { env: refused.env('done'), log: refused.log, sleep })).toBe(EXIT_OK);
    expect(routes(refused.api)).toEqual(['heartbeat(running)', 'complete', 'claim', 'heartbeat(idle)']);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(pendingCompleteDir(s.config))).toEqual([]);

    // A client error is never retried or kept; a network error, 5xx, 401, 408 and 429 are.
    expect(isPermanentCompleteFailure(new Error('HTTP 409 RUN_NOT_RUNNING: x'))).toBe(true);
    expect(isPermanentCompleteFailure(new Error('HTTP 400 VALIDATION_ERROR: x'))).toBe(true);
    for (const m of ['HTTP 500 INTERNAL_ERROR: x', 'HTTP 401: sign in', 'HTTP 429: slow down', 'HTTP 408: x', 'Network error calling /x: reset']) {
      expect(isPermanentCompleteFailure(new Error(m))).toBe(false);
    }
  });

  it('does not retry a complete the server refuses for good (automation-16)', async () => {
    const claimed = item();
    const s = await setup({ items: [claimed], completeStatuses: [409] });
    const waits: number[] = [];
    await runOnce(s.config, { env: s.env('done'), log: s.log, sleep: async (ms) => void waits.push(ms) });
    expect(s.api.requests.filter((r) => r.url === `${ROUTE}complete`)).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(existsSync(join(pendingCompleteDir(s.config), `${String(claimed.runId)}.json`))).toBe(false);
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
    const { acquireLock, lockStaleMs } = await import('../src/lock');
    const held = acquireLock(s.config.lockFile, lockStaleMs(s.config));
    expect(held).not.toBeNull();
    try {
      expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
      expect(s.events()).toEqual(['start', 'locked']);
      expect(s.api.requests).toEqual([]);
    } finally {
      held!.release();
    }
  });

  it('stops the loop on a usage limit: one attempt, no second claim, no claim before the reset (M5, ai-agent-17)', async () => {
    const first = item({ itemId: 1 });
    const second = item({ itemId: 2 });
    const s = await setup({ items: [first, second] }, { maxItems: 3 });
    const started = Date.now();
    expect(await runOnce(s.config, { env: s.env('usage_limit'), log: s.log })).toBe(EXIT_OK);
    // One claim, one complete with RUNNER_UNAVAILABLE and the CLI's text; the second item is never claimed.
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'complete', 'heartbeat(error)']);
    const body = completeBody(s.api);
    expect(body).toMatchObject({ runId: first.runId, outcome: 'failed', exitCode: 1 });
    expect(String(body.error)).toMatch(/^RUNNER_UNAVAILABLE: usage limit: error_during_execution: Claude AI usage limit reached\|\d{10}$/);
    expect(s.api.requests.at(-1)!.body).toMatchObject({ state: 'error', lastError: body.error });
    expect(s.events()).toEqual(expect.arrayContaining(['usage_limited', 'runner_unavailable']));

    // The reset time the CLI named (two hours ahead) is kept.
    const state = readRunnerState(s.config);
    expect(state).not.toBeNull();
    const until = Date.parse((state as { limitedUntil: string }).limitedUntil);
    expect(until).toBeGreaterThan(started + 2 * 60 * 60 * 1000 - 5_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 2 * 60 * 60 * 1000 + 1_000);

    // The next hourly run claims nothing before the reset: an error heartbeat and exit 0.
    s.api.requests.length = 0;
    s.lines.length = 0;
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
    expect(routes(s.api)).toEqual(['heartbeat(error)']);
    expect(String(s.api.requests[0]!.body.lastError)).toMatch(/^RUNNER_UNAVAILABLE: usage limit until /);
    expect(s.events()).toContain('usage_limited');
    expect(existsSync(s.config.lockFile)).toBe(false);

    // After the reset the runner claims again and drops the kept state.
    writeFileSync(runnerStateFile(s.config), JSON.stringify({ limitedUntil: new Date(Date.now() - 1_000).toISOString(), reason: 'x' }));
    s.api.requests.length = 0;
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'complete', 'claim', 'heartbeat(idle)']);
    expect(completeBody(s.api)).toMatchObject({ runId: second.runId, outcome: 'done' });
    expect(existsSync(runnerStateFile(s.config))).toBe(false);
  });

  it('holds a usage limit without a named reset for one hour, and a named one only when plausible', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    expect(limitedUntil(null, now)).toBe(new Date(now.getTime() + USAGE_LIMIT_FALLBACK_MS).toISOString());
    expect(limitedUntil('2026-09-28T13:00:00.000Z', now)).toBe('2026-09-28T13:00:00.000Z');
    // In the past, or further than a weekly cap plus a day: the fallback.
    expect(limitedUntil('2026-09-28T09:00:00.000Z', now)).toBe('2026-09-28T11:00:00.000Z');
    expect(limitedUntil('2026-10-28T09:00:00.000Z', now)).toBe('2026-09-28T11:00:00.000Z');
  });

  it('stops the loop when claude cannot be started and holds the runner (M5, ai-agent-17, N3)', async () => {
    const s = await setup({ items: [item({ itemId: 1 }), item({ itemId: 2 })] }, { maxItems: 3 });
    const config = { ...s.config, claudeBin: join(s.t.dir, 'no-such-claude') };
    expect(await runOnce(config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'complete', 'heartbeat(error)']);
    expect(completeBody(s.api)).toMatchObject({ outcome: 'failed', error: 'RUNNER_UNAVAILABLE: claude could not be started: ENOENT' });
    // N3 (ai-agent-23): a missing claude does not go away by itself, so it is a hold, not a usage limit.
    expect(readRunnerState(s.config)).toMatchObject({ holdUntilCleared: true, reason: 'RUNNER_UNAVAILABLE: claude could not be started: ENOENT', claudeVersion: null });

    // A per-item failure (an agent that is blocked) does not stop the loop.
    const b = await setup({ items: [item({ itemId: 1 }), item({ itemId: 2 })] }, { maxItems: 3 });
    await runOnce(b.config, { env: b.env('blocked'), log: b.log });
    expect(routes(b.api).filter((r) => r === 'claim')).toHaveLength(3);
  });

  it('re-sends a kept complete before the next claim of the same run (automation-16)', async () => {
    const first = item({ itemId: 1 });
    const second = item({ itemId: 2 });
    const s = await setup({ items: [first, second], completeStatuses: [500, 500, 500] }, { maxItems: 3 });
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log, sleep: async () => {} })).toBe(EXIT_OK);
    expect(routes(s.api).filter((r) => r !== 'heartbeat(running)')).toEqual([
      'claim',
      'complete',
      'complete',
      'complete',
      // The replay, while the first run is still within its lease.
      'complete',
      'claim',
      'complete',
      'claim',
      'heartbeat(error)',
    ]);
    const completes = s.api.requests.filter((r) => r.url === `${ROUTE}complete`).map((r) => r.body);
    expect(completes[3]).toEqual(completes[0]);
    expect(completes[3]).toMatchObject({ runId: first.runId, summary: 'two new cards drafted' });
    expect(completes[4]).toMatchObject({ runId: second.runId, outcome: 'done' });
    expect(readdirSync(pendingCompleteDir(s.config))).toEqual([]);
    expect(s.events()).toContain('complete_replayed');
  });

  it('settles a timed-out run and releases the lock when the group probe throws EPERM (ai-agent-18)', async () => {
    const eperm = (pid: number, signal: NodeJS.Signals | 0): boolean => {
      if (signal === 0) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
      return killGroup(pid, signal);
    };
    // The probe in the 'exit' listener (the child dies on SIGTERM) ...
    const a = await setup({ items: [item()] }, { itemTimeoutMs: 800, killGraceMs: 300, killSettleMs: 300 });
    expect(await runOnce(a.config, { env: a.env('hang'), log: a.log, signalGroup: eperm })).toBe(EXIT_OK);
    expect(completeBody(a.api)).toMatchObject({ outcome: 'failed', error: 'timeout', exitCode: null });
    expect(existsSync(a.config.lockFile)).toBe(false);

    // ... and the probe in the grace timer (the child ignores SIGTERM).
    const b = await setup({ items: [item()] }, { itemTimeoutMs: 800, killGraceMs: 300, killSettleMs: 300 });
    try {
      const code = await Promise.race([
        runOnce(b.config, { env: b.env('hang-ignore-term'), log: b.log, signalGroup: eperm }),
        new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 8_000)),
      ]);
      expect(code).toBe(EXIT_OK);
      expect(completeBody(b.api)).toMatchObject({ outcome: 'failed', error: 'timeout' });
      expect(b.api.requests.at(-1)!.body).toMatchObject({ state: 'error', lastError: 'timeout' });
      expect(existsSync(b.config.lockFile)).toBe(false);
    } finally {
      try {
        process.kill(record(b.t).pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }, 20_000);

  it('gives the queue item host no implicit pass to read_source (ai-agent-21)', async () => {
    expect(runSourceHosts(['docs.aws.amazon.com', 'Docs.Example.com', 'docs.aws.amazon.com'])).toEqual(['docs.aws.amazon.com', 'docs.example.com']);
    const feed = item({ url: 'https://blog.third-party.example/post' });
    const s = await setup({ items: [feed] }, { sourceHosts: ['docs.aws.amazon.com'] });
    await runOnce(s.config, { env: s.env('done'), log: s.log });
    const mcp = JSON.parse(readFileSync(join(s.config.logDir, 'runs', `${String(feed.runId)}.mcp.json`), 'utf8')) as {
      mcpServers: { developercards: { env: Record<string, string> } };
    };
    expect(mcp.mcpServers.developercards.env.DC_AUTOMATION_SOURCE_HOSTS).toBe('docs.aws.amazon.com');
    // A host the owner allowlists passes like every other one.
    const allowed = await setup({ items: [feed] }, { sourceHosts: ['docs.aws.amazon.com', 'blog.third-party.example'] });
    await runOnce(allowed.config, { env: allowed.env('done'), log: allowed.log });
    const mcp2 = JSON.parse(readFileSync(join(allowed.config.logDir, 'runs', `${String(feed.runId)}.mcp.json`), 'utf8')) as typeof mcp;
    expect(mcp2.mcpServers.developercards.env.DC_AUTOMATION_SOURCE_HOSTS).toBe('docs.aws.amazon.com,blog.third-party.example');
  });

  it('records the gated authorConfigId in the run meta and passes it to the MCP server (M1, ai-agent-3)', async () => {
    const claimed = item();
    const s = await setup({ items: [claimed] });
    await runOnce(s.config, { env: s.env('done'), log: s.log });
    const runsDir = join(s.config.logDir, 'runs');
    const meta = JSON.parse(readFileSync(join(runsDir, `${String(claimed.runId)}.meta.json`), 'utf8')) as {
      authorConfigId: string;
      authorConfig: { authorConfigId: string; model: string; skillVersion: string; skillSha256: string; promptSha256: string; claudeArgsSha256: string };
    };
    expect(meta.authorConfigId).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.authorConfig.authorConfigId).toBe(meta.authorConfigId);
    expect(authorConfigIdOf(meta.authorConfig)).toBe(meta.authorConfigId);
    const mcp = JSON.parse(readFileSync(join(runsDir, `${String(claimed.runId)}.mcp.json`), 'utf8')) as {
      mcpServers: { developercards: { env: Record<string, string> } };
    };
    expect(mcp.mcpServers.developercards.env.DC_AUTOMATION_AUTHOR_CONFIG_ID).toBe(meta.authorConfigId);
  });
});

describe('run-level hold (N3, ai-agent-23)', () => {
  const STALL = { DC_TEST_FAKE_CLAUDE_STALL_MS: '20000' };

  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code !== 'ESRCH';
    }
  }

  /** The kinds of the stream-json messages kept in a run's stdout file. */
  function streamKinds(config: RunnerConfig, runId: unknown): string[] {
    return readFileSync(join(config.logDir, 'runs', `${String(runId)}.json`), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const m = JSON.parse(line) as { type: string; subtype?: string };
        return m.subtype === undefined ? m.type : `${m.type}/${m.subtype}`;
      });
  }

  it('ends an API-key run at its init message, before the first model turn, and claims nothing until the hold is cleared', async () => {
    const first = item({ itemId: 1 });
    const second = item({ itemId: 2 });
    const queue = [first, second];
    const s = await setup({ items: queue }, { maxItems: 3 });
    const started = Date.now();
    expect(await runOnce(s.config, { env: s.env('api_key', STALL), log: s.log })).toBe(EXIT_OK);
    // Killed at once: long before the fake would have written its model turn and result.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(streamKinds(s.config, first.runId)).toEqual(['system/init']);
    expect(isAlive(record(s.t).pid)).toBe(false);
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'complete', 'heartbeat(error)']);
    expect(completeBody(s.api)).toMatchObject({
      runId: first.runId,
      outcome: 'failed',
      exitCode: null,
      numTurns: null,
      error: 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: apiKeySource /login managed key',
    });
    expect(s.events()).toEqual(expect.arrayContaining(['runner_held', 'runner_unavailable']));
    expect(readRunnerState(s.config)).toMatchObject({
      holdUntilCleared: true,
      reason: 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: apiKeySource /login managed key',
      claudeVersion: '2.1.283 (Claude Code, test fake)',
    });

    // The next hourly runs claim nothing: an error heartbeat that names the hold, and the second item stays queued.
    for (let run = 0; run < 2; run += 1) {
      s.api.requests.length = 0;
      s.lines.length = 0;
      rmSync(s.t.recordFile, { force: true });
      expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
      expect(routes(s.api)).toEqual(['heartbeat(error)']);
      expect(String(s.api.requests[0]!.body.lastError)).toMatch(/^RUNNER_UNAVAILABLE: held since \S+ until the owner clears .*runner-state\.json: RUNNER_UNAVAILABLE: claude did not run/);
      expect(s.events()).toContain('runner_held');
      expect(existsSync(s.t.recordFile)).toBe(false);
      expect(queue).toEqual([second]);
    }

    // The owner fixes the login and deletes the file: the runner claims again.
    rmSync(runnerStateFile(s.config));
    s.api.requests.length = 0;
    expect(await runOnce(s.config, { env: s.env('done'), log: s.log })).toBe(EXIT_OK);
    expect(completeBody(s.api)).toMatchObject({ runId: second.runId, outcome: 'done' });
  }, 30_000);

  it('ends a run whose MCP server failed, or whose model turn comes before any init message, and holds', async () => {
    for (const [mode, error] of [
      ['mcp_failed', 'RUNNER_UNAVAILABLE: the developercards MCP server did not start (failed)'],
      ['no_init', 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: no system/init message'],
    ] as const) {
      const claimed = item();
      const s = await setup({ items: [claimed, item({ itemId: 2 })] }, { maxItems: 3 });
      const started = Date.now();
      expect(await runOnce(s.config, { env: s.env(mode, STALL), log: s.log })).toBe(EXIT_OK);
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(streamKinds(s.config, claimed.runId)).toEqual([mode === 'no_init' ? 'assistant' : 'system/init']);
      expect(streamKinds(s.config, claimed.runId)).not.toContain('result');
      expect(isAlive(record(s.t).pid)).toBe(false);
      expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'complete', 'heartbeat(error)']);
      expect(completeBody(s.api)).toMatchObject({ outcome: 'failed', exitCode: null, error });
      expect(readRunnerState(s.config)).toMatchObject({ holdUntilCleared: true, reason: error });
      s.api.requests.length = 0;
      await runOnce(s.config, { env: s.env('done'), log: s.log });
      expect(routes(s.api)).toEqual(['heartbeat(error)']);
    }
  }, 40_000);

  it('clears the hold by itself only when the CLI or the author configuration changes', async () => {
    const s = await setup({ items: [item({ itemId: 1 }), item({ itemId: 2 }), item({ itemId: 3 })] }, { maxItems: 1 });
    await runOnce(s.config, { env: s.env('api_key'), log: s.log });
    expect(readRunnerState(s.config)).toMatchObject({ holdUntilCleared: true });

    // A Claude Code update: another --version line, so the hold is dropped and the next item is claimed.
    s.api.requests.length = 0;
    s.lines.length = 0;
    expect(await runOnce(s.config, { env: s.env('api_key', { DC_TEST_FAKE_CLAUDE_VERSION: '2.2.0 (Claude Code, test fake)' }), log: s.log })).toBe(EXIT_OK);
    expect(s.events()).toContain('hold_cleared');
    expect(routes(s.api)).toEqual(['heartbeat(running)', 'claim', 'complete', 'heartbeat(error)']);
    // Still an API key: held again, now under the new CLI version.
    expect(readRunnerState(s.config)).toMatchObject({ holdUntilCleared: true, claudeVersion: '2.2.0 (Claude Code, test fake)' });

    // A changed author configuration (an edited skill) clears it too.
    writeFileSync(join(s.t.repo, '.claude', 'skills', 'author-cards', 'checklist.md'), 'new rule\n');
    s.api.requests.length = 0;
    expect(await runOnce(s.config, { env: s.env('done', { DC_TEST_FAKE_CLAUDE_VERSION: '2.2.0 (Claude Code, test fake)' }), log: s.log })).toBe(EXIT_OK);
    expect(completeBody(s.api)).toMatchObject({ outcome: 'done' });
    expect(existsSync(runnerStateFile(s.config))).toBe(false);
  }, 30_000);

  it('keeps a per-item failure and a usage limit off the hold', async () => {
    const a = await setup({ items: [item()] });
    await runOnce(a.config, { env: a.env('is_error'), log: a.log });
    expect(existsSync(runnerStateFile(a.config))).toBe(false);
    const b = await setup({ items: [item()] });
    await runOnce(b.config, { env: b.env('usage_limit'), log: b.log });
    expect(readRunnerState(b.config)).toMatchObject({ limitedUntil: expect.any(String) });
    expect(readRunnerState(b.config)).not.toHaveProperty('holdUntilCleared');
  });
});
