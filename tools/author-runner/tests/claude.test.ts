import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_ALLOWED_TOOLS,
  CLAUDE_TOOLS,
  SCRUBBED_ENV_NAMES,
  claudeArgs,
  claudeOutcome,
  claudeUsage,
  claudeVersion,
  initWatch,
  killGroup,
  readClaudeStream,
  scrubEnv,
  usageLimitResetAt,
  type ClaudeRun,
} from '../src/claude';
import { makeHome } from './helpers';

const exited = (exitCode: number | null): ClaudeRun => ({ pid: 1, exitCode, signal: null, timedOut: false, spawnError: null });

/** The system/init message of `--output-format stream-json --verbose` (ai-agent-14). */
const initLine = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    cwd: '/repo',
    tools: ['Read'],
    mcp_servers: [{ name: 'developercards', status: 'connected' }],
    model: 'claude-opus-5-5',
    apiKeySource: 'none',
    ...extra,
  });
/** A whole stream: the init message (or none), an assistant message and the result message. */
const streamOf = (resultExtra: Record<string, unknown>, init: string | null = initLine()) =>
  [
    init,
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } }),
    JSON.stringify({ type: 'result', is_error: false, num_turns: 1, result: 'x', ...resultExtra }),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

describe('claude invocation', () => {
  it('builds exactly the contract CLAUDE_ARGS', () => {
    expect(claudeArgs('PROMPT TEXT', 'opus', '/tmp/logs/runs/abc.mcp.json')).toEqual([
      '-p',
      'PROMPT TEXT',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'opus',
      '--mcp-config',
      '/tmp/logs/runs/abc.mcp.json',
      '--strict-mcp-config',
      '--setting-sources',
      'project',
      '--tools',
      'Read,Task,Agent,Skill',
      '--allowedTools',
      'mcp__developercards__read_source,mcp__developercards__find_similar_cards,mcp__developercards__lint_card,mcp__developercards__submit_draft,Task,Agent,Skill,Read(content/decks/FORMAT.md),Read(.claude/skills/author-cards/**)',
      '--permission-mode',
      'dontAsk',
      '--no-session-persistence',
    ]);
    expect(CLAUDE_TOOLS).toBe('Read,Task,Agent,Skill');
    const everything = [...claudeArgs('p', 'opus', 'm'), CLAUDE_ALLOWED_TOOLS].join(' ');
    expect(everything).not.toMatch(/dangerously|Bash|WebFetch|Edit|Write/);
  });

  it('removes cloud credentials and API keys from the claude environment', () => {
    const input: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/example',
      DC_API_BASE: 'https://api.example.com',
      DC_RUNNER_MODEL: 'opus',
      UNSET_VALUE: undefined,
    };
    for (const name of SCRUBBED_ENV_NAMES) input[name] = 'PLACEHOLDER-not-a-secret';
    for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_REGION']) {
      input[name] = 'PLACEHOLDER-not-a-secret';
    }
    expect(scrubEnv(input)).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/example',
      DC_API_BASE: 'https://api.example.com',
      DC_RUNNER_MODEL: 'opus',
    });
    expect(SCRUBBED_ENV_NAMES).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
    ]);
  });

  it('passes only allowlisted variables to claude (ai-agent-10)', () => {
    const input: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/example',
      USER: 'example',
      LOGNAME: 'example',
      SHELL: '/bin/zsh',
      TMPDIR: '/tmp/',
      LANG: 'en_AU.UTF-8',
      LC_ALL: 'en_AU.UTF-8',
      TERM: 'xterm',
      TZ: 'Australia/Sydney',
      CLAUDE_CONFIG_DIR: '/Users/example/.claude',
      DC_TOKEN_FILE: '/Users/example/.config/developercards/mcp-tokens.json',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_API_KEY: 'PLACEHOLDER-not-a-secret',
      ANTHROPIC_FOUNDRY_RESOURCE: 'placeholder',
      ANTHROPIC_CUSTOM_HEADERS: 'X-Placeholder: not-a-secret',
      ANTHROPIC_MODEL: 'placeholder',
      CLAUDE_CODE_USE_SOMETHING_NEW: '1',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      NODE_OPTIONS: '--require=/tmp/placeholder.js',
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/placeholder.json',
    };
    expect(Object.keys(scrubEnv(input)).sort()).toEqual(
      ['CLAUDE_CONFIG_DIR', 'DC_TOKEN_FILE', 'HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'TZ', 'USER'].sort(),
    );
  });

  it('reads the cost and the provider signal from the claude stream (ai-agent-10)', () => {
    const models = { 'claude-opus-5-5': {}, 'claude-haiku-4-5-20251001': {} };
    expect(claudeUsage(streamOf({ total_cost_usd: 0.5, modelUsage: models }))).toEqual({
      totalCostUsd: 0.5,
      models: ['claude-haiku-4-5-20251001', 'claude-opus-5-5'],
      apiKeySource: 'none',
      providerSignal: null,
    });
    expect(claudeUsage(streamOf({ modelUsage: { 'global.anthropic.claude-opus-5-5': {} } })).providerSignal).toBe(
      'provider model global.anthropic.claude-opus-5-5',
    );
    expect(claudeUsage(streamOf({ modelUsage: { 'claude-opus-5-5@20260101': {} } })).providerSignal).toBe('provider model claude-opus-5-5@20260101');
    expect(claudeUsage('not json')).toEqual({ totalCostUsd: null, models: [], apiKeySource: null, providerSignal: 'no system/init message' });
  });

  it('reads apiKeySource from the system/init message and fails closed unless it is none (ai-agent-14)', () => {
    // The subscription login: init says apiKeySource "none" and the result has bare model ids.
    expect(claudeUsage(streamOf({ modelUsage: { 'claude-opus-5-5': {} } })).providerSignal).toBeNull();
    // An Anthropic API key with bare model ids (a Console key saved by /login, or the environment variable).
    for (const source of ['/login managed key', 'ANTHROPIC_API_KEY', 'apiKeyHelper', 'user']) {
      const stdout = streamOf({ modelUsage: { 'claude-opus-5-5': {} } }, initLine({ apiKeySource: source }));
      expect(claudeUsage(stdout)).toMatchObject({ apiKeySource: source, providerSignal: `apiKeySource ${source}` });
      expect(claudeOutcome(exited(0), stdout, '')).toMatchObject({
        outcome: 'failed',
        exitCode: 0,
        error: `RUNNER_UNAVAILABLE: claude did not run on the subscription login: apiKeySource ${source}`,
        runnerUnavailable: true,
      });
    }
    // An apiKeySource on the result message only (the old reading) no longer counts: no init message is a failure.
    const noInit = streamOf({ apiKeySource: 'none' }, null);
    expect(claudeOutcome(exited(0), noInit, '')).toMatchObject({
      outcome: 'failed',
      error: 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: no system/init message',
      runnerUnavailable: true,
    });
    const { apiKeySource: _dropped, ...withoutSource } = JSON.parse(initLine()) as Record<string, unknown>;
    expect(claudeOutcome(exited(0), streamOf({}, JSON.stringify(withoutSource)), '')).toMatchObject({
      outcome: 'failed',
      error: 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: no apiKeySource in the system/init message',
    });
    // The last result message counts; non-JSON lines in between are ignored.
    const stream = readClaudeStream(`${initLine()}\nnoise\n${JSON.stringify({ type: 'result', num_turns: 1 })}\n${JSON.stringify({ type: 'result', num_turns: 2 })}`);
    expect(stream.init?.apiKeySource).toBe('none');
    expect(stream.result?.num_turns).toBe(2);
  });

  it('fails a run whose developercards MCP server did not start (ai-agent-13)', () => {
    const ok = JSON.stringify({ outcome: 'nothing_new', submitted: 0, notes: '' });
    expect(claudeOutcome(exited(0), streamOf({ result: ok }, initLine({ mcp_servers: [{ name: 'developercards', status: 'failed' }] })), '')).toMatchObject({
      outcome: 'failed',
      error: 'RUNNER_UNAVAILABLE: the developercards MCP server did not start (failed)',
      runnerUnavailable: true,
    });
    expect(claudeOutcome(exited(0), streamOf({ result: ok }, initLine({ mcp_servers: [] })), '')).toMatchObject({
      outcome: 'failed',
      error: 'RUNNER_UNAVAILABLE: the developercards MCP server is not loaded',
    });
    expect(claudeOutcome(exited(0), streamOf({ result: ok }, initLine({ mcp_servers: [{ name: 'developercards', status: 'pending' }] })), '')).toMatchObject({
      outcome: 'nothing_new',
    });
  });

  it('sends blank notes as no summary and trims the rest (K3)', () => {
    const ok = (notes: string) => streamOf({ result: JSON.stringify({ outcome: 'nothing_new', submitted: 0, notes }) });
    expect(claudeOutcome(exited(0), ok('   '), '').summary).toBeNull();
    expect(claudeOutcome(exited(0), ok(''), '').summary).toBeNull();
    expect(claudeOutcome(exited(0), ok('  card s3-glacier-1 says 12 hours; the page says 3 to 5  '), '').summary).toBe(
      'card s3-glacier-1 says 12 hours; the page says 3 to 5',
    );
  });

  it('reads the version line of the fake claude and null for a missing binary', () => {
    const t = makeHome();
    try {
      expect(claudeVersion(t.claudeBin)).toBe('2.1.283 (Claude Code, test fake)');
      expect(claudeVersion(`${t.dir}/missing-claude`)).toBeNull();
    } finally {
      t.cleanup();
    }
  });

  it('maps a claude result to the complete outcome', () => {
    const ok = (text: unknown, extra: Record<string, unknown> = {}) => streamOf({ num_turns: 3, result: text, ...extra });
    expect(claudeOutcome(exited(0), ok('work\n{"outcome":"nothing_new","submitted":0,"notes":"n"}\n\n'), '')).toEqual({
      outcome: 'nothing_new',
      exitCode: 0,
      numTurns: 3,
      error: null,
      summary: 'n',
      runnerUnavailable: false,
      usageLimit: null,
    });
    expect(claudeOutcome(exited(0), ok(`{"outcome":"done","notes":"${'x'.repeat(2500)}"}`), '').summary).toHaveLength(2000);
    expect(claudeOutcome(exited(1), '', '')).toMatchObject({ outcome: 'failed', exitCode: 1, error: 'exit 1' });
    expect(claudeOutcome({ ...exited(null), timedOut: true }, '', 'x')).toMatchObject({ error: 'timeout', exitCode: null });
    expect(claudeOutcome(exited(0), 'not json', '')).toMatchObject({ outcome: 'failed', error: 'claude output is not JSON' });
    expect(claudeOutcome(exited(0), initLine(), '')).toMatchObject({ outcome: 'failed', error: 'claude output has no result message' });
  });

  it('never counts a missing or unknown final outcome line as a success (L6 AGENT_NO_RESULT)', () => {
    const ok = (text: unknown, extra: Record<string, unknown> = {}) => streamOf({ num_turns: 3, result: text, ...extra });
    expect(claudeOutcome(exited(0), ok('no json line at the end'), '')).toEqual({
      outcome: 'failed',
      exitCode: 0,
      numTurns: 3,
      error: 'AGENT_NO_RESULT: the final message does not end with the outcome JSON line',
      summary: null,
      runnerUnavailable: false,
      usageLimit: null,
    });
    expect(claudeOutcome(exited(0), ok(''), '')).toMatchObject({ outcome: 'failed', error: 'AGENT_NO_RESULT: the final message does not end with the outcome JSON line' });
    expect(claudeOutcome(exited(0), ok(null), '')).toMatchObject({ outcome: 'failed', error: 'AGENT_NO_RESULT: the final message does not end with the outcome JSON line' });
    expect(claudeOutcome(exited(0), ok('[1,2]'), '')).toMatchObject({ outcome: 'failed', error: 'AGENT_NO_RESULT: the final message does not end with the outcome JSON line' });
    expect(claudeOutcome(exited(0), ok('{"outcome":"weird","notes":"hm"}', { num_turns: 2.5 }), '')).toEqual({
      outcome: 'failed',
      exitCode: 0,
      numTurns: null,
      error: 'AGENT_NO_RESULT: the outcome JSON line has no known outcome',
      summary: 'hm',
      runnerUnavailable: false,
      usageLimit: null,
    });
  });

  it('completes a blocked agent as failed with AGENT_BLOCKED and a one-line capped reason (L6)', () => {
    const ok = (line: Record<string, unknown>) => streamOf({ num_turns: 4, result: `read_source was refused.\n${JSON.stringify(line)}` });
    expect(claudeOutcome(exited(0), ok({ outcome: 'blocked', submitted: 0, reason: 'read_source refused:\nSOURCE_HOST_NOT_ALLOWED', notes: 'n' }), '')).toEqual({
      outcome: 'failed',
      exitCode: 0,
      numTurns: 4,
      error: 'AGENT_BLOCKED: read_source refused: SOURCE_HOST_NOT_ALLOWED',
      summary: 'n',
      runnerUnavailable: false,
      usageLimit: null,
    });
    // The L6 spelling {"result":"blocked","reason":...} too.
    expect(claudeOutcome(exited(0), ok({ result: 'blocked', reason: 'no developercards tools' }), '')).toMatchObject({
      outcome: 'failed',
      error: 'AGENT_BLOCKED: no developercards tools',
      summary: null,
      runnerUnavailable: false,
      usageLimit: null,
    });
    // Without a reason the notes explain it; without either a fixed text does.
    expect(claudeOutcome(exited(0), ok({ outcome: 'blocked', notes: 'uv failed' }), '').error).toBe('AGENT_BLOCKED: uv failed');
    expect(claudeOutcome(exited(0), ok({ outcome: 'blocked' }), '').error).toBe('AGENT_BLOCKED: no reason given');
    const long = claudeOutcome(exited(0), ok({ outcome: 'blocked', reason: 'y'.repeat(1000) }), '').error!;
    expect(long).toBe(`AGENT_BLOCKED: ${'y'.repeat(300)}`);
    expect(long.length).toBeLessThanOrEqual(500);
  });
});

describe('run-level failures and the CLI error text (M5, ai-agent-17)', () => {
  const errorResult = (subtype: string, text: string) =>
    [initLine(), JSON.stringify({ type: 'result', subtype, is_error: true, num_turns: 1, result: text })].join('\n');

  it('puts the result subtype and the first 300 characters of the result text into a per-item error', () => {
    const long = `line one\nline two ${'z'.repeat(400)}`;
    const nonZero = claudeOutcome(exited(1), errorResult('error_during_execution', long), 'stderr text');
    expect(nonZero).toMatchObject({ outcome: 'failed', exitCode: 1, runnerUnavailable: false, usageLimit: null });
    expect(nonZero.error).toBe(`error_during_execution: ${`line one line two ${'z'.repeat(400)}`.slice(0, 300)}`);
    expect(nonZero.error).not.toMatch(/[\r\n]/);

    expect(claudeOutcome(exited(0), errorResult('error_max_turns', 'Reached the maximum number of turns'), '')).toMatchObject({
      outcome: 'failed',
      exitCode: 0,
      error: 'claude result is_error: error_max_turns: Reached the maximum number of turns',
      runnerUnavailable: false,
    });
    // Without a result message a non-zero exit still reports stderr.
    expect(claudeOutcome(exited(2), '', 'boom\n')).toMatchObject({ error: 'boom ', runnerUnavailable: false });
  });

  it('treats a usage or rate limit in the result text or stderr as run-level and reads its reset time', () => {
    const limited = claudeOutcome(exited(1), errorResult('error_during_execution', 'Claude AI usage limit reached|1790003600'), '');
    expect(limited).toMatchObject({
      outcome: 'failed',
      exitCode: 1,
      runnerUnavailable: true,
      usageLimit: { resetAt: new Date(1_790_003_600_000).toISOString() },
    });
    expect(limited.error).toBe('RUNNER_UNAVAILABLE: usage limit: error_during_execution: Claude AI usage limit reached|1790003600');

    const isError = claudeOutcome(exited(0), errorResult('success', "You've hit your limit · resets 3pm (Europe/Berlin)"), '');
    expect(isError).toMatchObject({ runnerUnavailable: true, usageLimit: { resetAt: null } });
    expect(isError.error).toMatch(/^RUNNER_UNAVAILABLE: usage limit: /);

    const stderr = claudeOutcome(exited(1), '', 'API Error: 429 rate_limit_error: rate limit exceeded');
    expect(stderr).toMatchObject({ runnerUnavailable: true, usageLimit: { resetAt: null } });

    expect(usageLimitResetAt('limit reached, resets at 2026-09-28T15:00:00Z')).toBe('2026-09-28T15:00:00.000Z');
    expect(usageLimitResetAt('no time here')).toBeNull();
  });

  it('treats a claude that cannot start, a non-subscription login and a dead MCP server as run-level', () => {
    const spawn = claudeOutcome({ ...exited(null), pid: null, spawnError: 'ENOENT' }, '', '');
    expect(spawn).toMatchObject({ error: 'RUNNER_UNAVAILABLE: claude could not be started: ENOENT', runnerUnavailable: true, usageLimit: null });
    // A timeout and a blocked agent concern one item only.
    expect(claudeOutcome({ ...exited(null), timedOut: true }, '', '').runnerUnavailable).toBe(false);
    const blocked = streamOf({ result: JSON.stringify({ outcome: 'blocked', reason: 'page is gone' }) });
    expect(claudeOutcome(exited(0), blocked, '').runnerUnavailable).toBe(false);
  });
});

describe('killGroup (ai-agent-18)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers false for a group that is gone (ESRCH) or holds only zombies (EPERM on macOS)', () => {
    for (const code of ['ESRCH', 'EPERM']) {
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error(`kill ${code}`), { code });
      });
      expect(killGroup(4242, 0)).toBe(false);
      expect(killGroup(4242, 'SIGKILL')).toBe(false);
      vi.restoreAllMocks();
    }
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill EINVAL'), { code: 'EINVAL' });
    });
    expect(() => killGroup(4242, 0)).toThrow('kill EINVAL');
  });
});

describe('the provider check on every outcome and at the init message (N3, ai-agent-23)', () => {
  const apiKeyInit = initLine({ apiKeySource: '/login managed key' });
  const errorResult = (init: string | null) =>
    [init, JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 1, result: 'rate limit on the source page' })]
      .filter((line): line is string => line !== null)
      .join('\n');

  it('holds a timed-out, an error and a failed run whose init message shows another login or a failed MCP server', () => {
    const apiKey = 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: apiKeySource /login managed key';
    // A timeout is no longer an ordinary item failure when the stream shows an API key.
    expect(claudeOutcome({ ...exited(null), timedOut: true }, apiKeyInit, '')).toMatchObject({
      outcome: 'failed',
      exitCode: null,
      error: apiKey,
      runnerUnavailable: true,
      holdUntilCleared: true,
      usageLimit: null,
    });
    // is_error: neither an ordinary failure nor a usage limit (the text says "rate limit").
    expect(claudeOutcome(exited(0), errorResult(apiKeyInit), '')).toMatchObject({ error: apiKey, runnerUnavailable: true, holdUntilCleared: true, usageLimit: null });
    // A non-zero exit.
    expect(claudeOutcome(exited(1), errorResult(apiKeyInit), '')).toMatchObject({ error: apiKey, exitCode: 1, holdUntilCleared: true });
    // A model turn with no init message at all, and a failed MCP server on a timeout.
    expect(claudeOutcome(exited(0), errorResult(null), '')).toMatchObject({
      error: 'RUNNER_UNAVAILABLE: claude did not run on the subscription login: no system/init message',
      holdUntilCleared: true,
    });
    const mcpFailed = initLine({ mcp_servers: [{ name: 'developercards', status: 'failed' }] });
    expect(claudeOutcome({ ...exited(null), timedOut: true }, mcpFailed, '')).toMatchObject({
      error: 'RUNNER_UNAVAILABLE: the developercards MCP server did not start (failed)',
      holdUntilCleared: true,
    });
    // A success on a cloud provider model and a claude that cannot be started hold too.
    expect(claudeOutcome(exited(0), streamOf({ modelUsage: { 'us.anthropic.claude-opus-5-5-v1:0': {} } }), '')).toMatchObject({ holdUntilCleared: true });
    expect(claudeOutcome({ ...exited(null), pid: null, spawnError: 'ENOENT' }, '', '')).toMatchObject({ holdUntilCleared: true });
    // The verdict taken at the init message wins, and such a run has no exit code of its own.
    expect(claudeOutcome({ ...exited(143), initAbort: 'the developercards MCP server is not loaded' }, initLine(), '')).toMatchObject({
      outcome: 'failed',
      exitCode: null,
      error: 'RUNNER_UNAVAILABLE: the developercards MCP server is not loaded',
      holdUntilCleared: true,
    });
  });

  it('keeps per-item failures and usage limits off the hold', () => {
    // A timeout before any output never reached a model turn: an ordinary item failure.
    expect(claudeOutcome({ ...exited(null), timedOut: true }, '', '')).toEqual({
      outcome: 'failed',
      exitCode: null,
      numTurns: null,
      error: 'timeout',
      summary: null,
      runnerUnavailable: false,
      usageLimit: null,
    });
    expect(claudeOutcome({ ...exited(null), timedOut: true }, initLine(), '')).toMatchObject({ error: 'timeout', runnerUnavailable: false });
    expect(claudeOutcome(exited(0), errorResult(initLine()), '')).not.toHaveProperty('holdUntilCleared');
    const limited = claudeOutcome(exited(1), [initLine(), JSON.stringify({ type: 'result', is_error: true, result: 'Claude AI usage limit reached|1790003600' })].join('\n'), '');
    expect(limited).toMatchObject({ runnerUnavailable: true, usageLimit: { resetAt: new Date(1_790_003_600_000).toISOString() } });
    expect(limited).not.toHaveProperty('holdUntilCleared');
    expect(claudeOutcome(exited(2), '', 'boom')).not.toHaveProperty('holdUntilCleared');
  });

  it('judges the init message as it arrives, across chunk boundaries', () => {
    const watch = initWatch();
    const line = `${apiKeyInit}\n`;
    expect(watch(line.slice(0, 40))).toBeNull();
    expect(watch(line.slice(40))).toBe('claude did not run on the subscription login: apiKeySource /login managed key');
    // It answers once.
    expect(watch(`${JSON.stringify({ type: 'assistant' })}\n`)).toBeNull();

    const ok = initWatch();
    // Other system messages (hook output) and noise may come first; a good init message ends the watch.
    expect(ok(`noise\n${JSON.stringify({ type: 'system', subtype: 'hook_response' })}\n`)).toBeNull();
    expect(ok(`${initLine()}\n`)).toBeNull();
    expect(ok(`${apiKeyInit}\n`)).toBeNull();

    expect(initWatch()(`${JSON.stringify({ type: 'assistant' })}\n`)).toBe('claude did not run on the subscription login: no system/init message');
    const { apiKeySource: _dropped, ...noSource } = JSON.parse(initLine()) as Record<string, unknown>;
    expect(initWatch()(`${JSON.stringify(noSource)}\n`)).toBe('claude did not run on the subscription login: no apiKeySource in the system/init message');
    expect(initWatch()(`${initLine({ mcp_servers: [{ name: 'developercards', status: 'failed' }] })}\n`)).toBe(
      'the developercards MCP server did not start (failed)',
    );
    expect(initWatch()(`${initLine({ mcp_servers: [] })}\n`)).toBe('the developercards MCP server is not loaded');
    // A server Claude Code is still connecting is not a failure (ai-agent-13).
    expect(initWatch()(`${initLine({ mcp_servers: [{ name: 'developercards', status: 'pending' }] })}\n`)).toBeNull();
  });
});
