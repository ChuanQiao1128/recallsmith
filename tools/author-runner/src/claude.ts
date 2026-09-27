// Headless Claude Code (A00 §11.4, §0.9): the exact argument list, the allowlisted
// child environment, the spawn into its own process group with a timeout and a hard
// settle deadline, and the reading of the stream-json output (the system/init message and
// the final result message). The run uses the owner's Claude subscription login, never an
// API key or a cloud credential (an init message that does not show the subscription, or a
// result that shows a cloud provider, is failed), and has no Bash/WebFetch/Edit/Write tool.
// N3: stdout streams through the runner into the run file, and the system/init message is
// checked as it arrives; a wrong login or a failed MCP server ends the process group before
// the first model turn.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import type { RunOutcome } from './api';
import type { RunnerConfig } from './config';

export const CLAUDE_TOOLS = 'Read,Task,Agent,Skill';

export const CLAUDE_ALLOWED_TOOLS =
  'mcp__developercards__read_source,mcp__developercards__find_similar_cards,mcp__developercards__lint_card,mcp__developercards__submit_draft,Task,Agent,Skill,Read(content/decks/FORMAT.md),Read(.claude/skills/author-cards/**)';

export function claudeArgs(prompt: string, model: string, mcpConfigPath: string): string[] {
  return [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--setting-sources', 'project',
    '--tools', CLAUDE_TOOLS,
    '--allowedTools', CLAUDE_ALLOWED_TOOLS,
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
  ];
}

/**
 * The only variables the claude child gets (ai-agent-10): what Claude Code needs to find its
 * subscription login and tools, the locale, and the DeveloperCards DC_* settings its MCP server reads.
 * Anything else (a provider switch, custom headers, a proxy, a cloud credential) never reaches it.
 */
export const ALLOWED_ENV_NAMES = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM', 'TZ', 'CLAUDE_CONFIG_DIR'];
export const ALLOWED_ENV_PREFIXES = ['LC_', 'DC_'];

/** A second check behind the allowlist: these names and prefixes are dropped even if the allowlist grows. */
export const SCRUBBED_ENV_NAMES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
];
export const SCRUBBED_ENV_PREFIXES = ['AWS_', 'ANTHROPIC_', 'CLAUDE_CODE_USE_'];

/** The runner env reduced to the allowlist, minus the API-key/provider/cloud variables. */
export function scrubEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const allowed = ALLOWED_ENV_NAMES.includes(name) || ALLOWED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
    if (!allowed) continue;
    if (SCRUBBED_ENV_NAMES.includes(name) || SCRUBBED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    out[name] = value;
  }
  return out;
}

/** First line of `<bin> --version`, at most 80 characters; null on any failure. */
export function claudeVersion(bin: string, env: Record<string, string | undefined> = process.env): string | null {
  try {
    const res = spawnSync(bin, ['--version'], { env: scrubEnv(env), encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (res.error !== undefined || res.status !== 0 || typeof res.stdout !== 'string') return null;
    const first = res.stdout.split(/\r?\n/).find((line) => line.trim() !== '');
    return first === undefined ? null : first.trim().slice(0, 80);
  } catch {
    return null;
  }
}

export interface ClaudeRun {
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError: string | null;
  /** N3: why the run was ended at its system/init message, before the first model turn; null or absent otherwise. */
  initAbort?: string | null;
}

export type SignalGroup = (pid: number, signal: NodeJS.Signals | 0) => boolean;

export interface RunClaudeOptions {
  config: Pick<RunnerConfig, 'claudeBin' | 'model' | 'itemTimeoutMs' | 'killGraceMs' | 'killSettleMs' | 'api'>;
  prompt: string;
  mcpConfigPath: string;
  stdoutFile: string;
  stderrFile: string;
  baseEnv: Record<string, string | undefined>;
  /** Sends a signal to the process group (0 probes it); tests replace it to model a group that never empties. */
  signalGroup?: SignalGroup;
}

/**
 * Signals the process group; false when it can no longer be signalled. ESRCH means it is gone; EPERM is
 * what macOS answers for a group that holds only zombies (unreaped MCP, uv or python children), which
 * counts as gone too (ai-agent-18). Any other error is rethrown; runClaude never lets one escape.
 */
export function killGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH' || code === 'EPERM') return false;
    throw err;
  }
}

/**
 * Spawns claude in its own process group; on timeout SIGTERM the group, then SIGKILL after the grace
 * period, and settle at most killSettleMs after that even if the child never exits or a member of the
 * group (an unreaped MCP server, uv or python process) lingers (ai-agent-6). N3: stdout is piped through
 * the runner (and written to the run file as it arrives); its system/init message is checked at once, and
 * one that shows another login or a failed MCP server, or a model turn before any init message, ends the
 * group the same way before the model runs (`initAbort`).
 */
export function runClaude(opts: RunClaudeOptions): Promise<ClaudeRun> {
  const { config } = opts;
  const rawSignalGroup = opts.signalGroup ?? killGroup;
  // Called from the 'exit' listener and the timers, where a throw would crash the runner before it settles
  // (ai-agent-18): a group that cannot be signalled counts as gone.
  const signalGroup = (pid: number, signal: NodeJS.Signals | 0): boolean => {
    try {
      return rawSignalGroup(pid, signal);
    } catch {
      return false;
    }
  };
  const out = openSync(opts.stdoutFile, 'w', 0o600);
  const err = openSync(opts.stderrFile, 'w', 0o600);
  return new Promise<ClaudeRun>((resolve) => {
    let settled = false;
    let timedOut = false;
    let initAbort: string | null = null;
    let terminating = false;
    let exited: { code: number | null; signal: string | null } | null = null;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let settleTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;
    let outOpen = true;
    let stdoutEnded = false;
    let onStdoutEnd: (() => void) | null = null;
    const watch = initWatch();

    const child = spawn(config.claudeBin, claudeArgs(opts.prompt, config.model, opts.mcpConfigPath), {
      cwd: config.api.repoRoot,
      env: scrubEnv(opts.baseEnv),
      detached: true,
      stdio: ['ignore', 'pipe', err],
    });
    closeSync(err);
    const pid = child.pid ?? null;

    const closeOut = (): void => {
      if (!outOpen) return;
      outOpen = false;
      closeSync(out);
    };

    const finish = (run: ClaudeRun): void => {
      if (settled) return;
      settled = true;
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      const done = (): void => {
        if (drainTimer !== undefined) clearTimeout(drainTimer);
        // A lingering group member may still hold the pipe open; what it writes later is not part of the run.
        child.stdout?.destroy();
        closeOut();
        resolve({ ...run, initAbort });
      };
      // The last stdout bytes can arrive after 'exit': wait for the end of the pipe, at most killSettleMs.
      if (stdoutEnded || child.stdout === null) {
        done();
        return;
      }
      onStdoutEnd = done;
      drainTimer = setTimeout(done, config.killSettleMs);
    };

    /** SIGTERM the group, SIGKILL after the grace period, then settle at the latest killSettleMs later. */
    const terminate = (): void => {
      if (terminating || pid === null) return;
      terminating = true;
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      signalGroup(pid, 'SIGTERM');
      graceTimer = setTimeout(() => {
        if (signalGroup(pid, 0)) signalGroup(pid, 'SIGKILL');
        if (exited !== null) {
          finish({ pid, exitCode: exited.code, signal: exited.signal, timedOut, spawnError: null });
          return;
        }
        // The hard ceiling: settle whatever the child and its group do from here on.
        settleTimer = setTimeout(() => {
          finish({ pid, exitCode: exited?.code ?? null, signal: exited?.signal ?? 'SIGKILL', timedOut, spawnError: null });
        }, config.killSettleMs);
      }, config.killGraceMs);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (outOpen) writeSync(out, chunk);
      if (initAbort !== null || settled) return;
      const problem = watch(chunk);
      if (problem !== null) {
        initAbort = problem;
        terminate();
      }
    });
    const ended = (): void => {
      stdoutEnded = true;
      onStdoutEnd?.();
    };
    child.stdout?.on('end', ended);
    child.stdout?.on('close', ended);
    child.stdout?.on('error', ended);

    child.on('error', (e: NodeJS.ErrnoException) => {
      if (pid === null) {
        finish({ pid, exitCode: null, signal: null, timedOut: false, spawnError: e.code ?? e.message });
      }
    });

    child.on('exit', (code, signal) => {
      exited = { code, signal };
      // After a timeout or an init abort, wait for the grace timer unless the whole group is already gone.
      if (terminating && pid !== null && signalGroup(pid, 0)) return;
      finish({ pid, exitCode: code, signal, timedOut, spawnError: null });
    });

    if (pid !== null) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, config.itemTimeoutMs);
    }
  });
}

/**
 * N3: reads stdout chunks as they arrive and answers, once, why the run must end before its first model
 * turn: the system/init message shows another login than the subscription or a developercards MCP server
 * that failed or is missing, or a model message comes before any init message. Null while there is nothing
 * to object to (other `system` messages, such as hook output, may come before init).
 */
export function initWatch(): (chunk: Buffer | string) => string | null {
  let buffer = '';
  let decided = false;
  return (chunk) => {
    if (decided) return null;
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line === '') continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message !== 'object' || message === null || Array.isArray(message)) continue;
      const m = message as Record<string, unknown>;
      if (m.type === 'system' && m.subtype === 'init') {
        decided = true;
        return initProblem(m);
      }
      if (m.type !== 'system') {
        decided = true;
        return `${NOT_ON_SUBSCRIPTION}: no system/init message`;
      }
    }
    return null;
  };
}

export interface ClaudeOutcome {
  outcome: RunOutcome;
  exitCode: number | null;
  numTurns: number | null;
  error: string | null;
  summary: string | null;
  /**
   * M5: the failure affects every item (claude cannot start, not on the subscription, the MCP server did not
   * start, a usage or rate limit), so the runner stops its loop; `error` then starts with RUNNER_UNAVAILABLE.
   */
  runnerUnavailable: boolean;
  /** Set when the CLI reported a usage or rate limit: the reset time it named, or null when it named none. */
  usageLimit: { resetAt: string | null } | null;
  /**
   * N3: a run-level cause that does not go away by itself (claude cannot be started, not on the subscription,
   * the MCP server failed or is missing); the runner keeps a local hold that the owner clears. Absent otherwise.
   */
  holdUntilCleared?: true;
}

function oneLine(text: string, max: number): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, max);
}

/** The two messages of a stream-json run the runner reads (ai-agent-14). */
export interface ClaudeStream {
  /** Whether any line of stdout is a JSON object. */
  anyJson: boolean;
  /** The `system`/`init` message: it carries `apiKeySource` and the MCP server status. */
  init: Record<string, unknown> | null;
  /** The last `result` message: cost, model usage, `is_error`, `num_turns` and the final text. */
  result: Record<string, unknown> | null;
}

/** Reads the system/init message and the last result message from `--output-format stream-json --verbose` stdout. */
export function readClaudeStream(stdout: string): ClaudeStream {
  const stream: ClaudeStream = { anyJson: false, init: null, result: null };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    stream.anyJson = true;
    const message = parsed as Record<string, unknown>;
    if (message.type === 'system' && message.subtype === 'init' && stream.init === null) stream.init = message;
    else if (message.type === 'result') stream.result = message;
  }
  return stream;
}

/** What the CLI's stream says about the account and spend of a run (ai-agent-10, ai-agent-14). */
export interface ClaudeUsage {
  totalCostUsd: number | null;
  models: string[];
  apiKeySource: string | null;
  /** Why the run did not demonstrably use the subscription login; null when it did. */
  providerSignal: string | null;
}

/** The init message's `apiKeySource` of a run on the owner's Claude subscription login (no API key of any kind). */
export const SUBSCRIPTION_API_KEY_SOURCE = 'none';

// Bedrock model ids carry an `anthropic.` segment or an ARN, Vertex ids an `@version`; subscription ids are bare.
const PROVIDER_MODEL_RE = /(^|\.)anthropic\.|^arn:|@/;

export function claudeUsage(stdout: string): ClaudeUsage {
  const usage: ClaudeUsage = { totalCostUsd: null, models: [], apiKeySource: null, providerSignal: null };
  const { init, result } = readClaudeStream(stdout);
  if (result !== null) {
    if (typeof result.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd)) usage.totalCostUsd = result.total_cost_usd;
    if (typeof result.modelUsage === 'object' && result.modelUsage !== null) {
      usage.models = Object.keys(result.modelUsage).map((m) => m.slice(0, 200)).sort();
    }
  }
  if (init !== null && typeof init.apiKeySource === 'string') usage.apiKeySource = init.apiKeySource.slice(0, 50);

  // Fail closed: only an init message that says `apiKeySource: "none"` shows the subscription login.
  if (init === null) {
    usage.providerSignal = 'no system/init message';
  } else if (usage.apiKeySource === null) {
    usage.providerSignal = 'no apiKeySource in the system/init message';
  } else if (usage.apiKeySource !== SUBSCRIPTION_API_KEY_SOURCE) {
    usage.providerSignal = `apiKeySource ${usage.apiKeySource}`;
  } else {
    const provider = usage.models.find((m) => PROVIDER_MODEL_RE.test(m));
    if (provider !== undefined) usage.providerSignal = `provider model ${provider}`;
  }
  return usage;
}

export const MCP_SERVER_NAME = 'developercards';

/** The error text of a run that did not demonstrably use the subscription login. */
export const NOT_ON_SUBSCRIPTION = 'claude did not run on the subscription login';

/**
 * N3: why a system/init message shows that the run must not go on: its `apiKeySource` is missing or not the
 * subscription's, or the developercards MCP server is missing or did not start; null when neither.
 */
export function initProblem(init: Record<string, unknown>): string | null {
  if (typeof init.apiKeySource !== 'string') return `${NOT_ON_SUBSCRIPTION}: no apiKeySource in the system/init message`;
  if (init.apiKeySource !== SUBSCRIPTION_API_KEY_SOURCE) return `${NOT_ON_SUBSCRIPTION}: apiKeySource ${init.apiKeySource.slice(0, 50)}`;
  return mcpServerProblem(init);
}

/**
 * Why the init message shows that the developercards MCP server is missing or did not start (`failed`, `needs-auth`,
 * `disabled`, …); null when it is `connected` or still `pending`, or when the message has no server list at all.
 */
function mcpServerProblem(init: Record<string, unknown>): string | null {
  if (!Array.isArray(init.mcp_servers)) return null;
  const entry = (init.mcp_servers as unknown[]).find(
    (s): s is { name: unknown; status?: unknown } => typeof s === 'object' && s !== null && (s as { name?: unknown }).name === MCP_SERVER_NAME,
  );
  if (entry === undefined) return `the ${MCP_SERVER_NAME} MCP server is not loaded`;
  if (entry.status !== 'connected' && entry.status !== 'pending') return `the ${MCP_SERVER_NAME} MCP server did not start (${oneLine(String(entry.status), 40)})`;
  return null;
}

/** L6: the error of a run whose agent reported that it could not do the task. */
export const AGENT_BLOCKED = 'AGENT_BLOCKED';
/** L6: the error of a run whose final message has no valid outcome line; never a success. */
export const AGENT_NO_RESULT = 'AGENT_NO_RESULT';
const BLOCKED_REASON_MAX = 300;
/** M5: the error prefix of a run that failed for a reason that affects every item. */
export const RUNNER_UNAVAILABLE = 'RUNNER_UNAVAILABLE';
/** M5: the characters of the CLI result text kept in a per-item error. */
const RESULT_TEXT_MAX = 300;

/** What the CLI prints when the subscription's usage limit or a rate limit is hit (ai-agent-17). */
export const USAGE_LIMIT_RE = /usage limit|limit reached|rate.?limit|resets? /i;

/** The last result message's subtype and the first 300 characters of its text, on one line (M5). */
function resultDetail(r: Record<string, unknown>): string {
  const subtype = typeof r.subtype === 'string' && r.subtype.trim() !== '' ? oneLine(r.subtype, 60).trim() : 'result';
  const text = typeof r.result === 'string' ? oneLine(r.result, RESULT_TEXT_MAX).trim() : '';
  return text === '' ? subtype : `${subtype}: ${text}`;
}

/**
 * The reset time a usage-limit text names, as an ISO string: the `|<epoch seconds>` suffix of
 * "Claude AI usage limit reached|1790000000", or an ISO 8601 timestamp; null when it names none.
 */
export function usageLimitResetAt(text: string): string | null {
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch !== null) return new Date(Number(epoch[1]) * 1000).toISOString();
  const iso = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/.exec(text);
  if (iso !== null && Number.isFinite(Date.parse(iso[0]))) return new Date(Date.parse(iso[0])).toISOString();
  return null;
}

/** The outcome reported to `complete` for one claude run (A00 §11.3 step 6, L6). */
export function claudeOutcome(run: ClaudeRun, stdout: string, stderr: string): ClaudeOutcome {
  const failed = (error: string, exitCode: number | null, numTurns: number | null = null, summary: string | null = null): ClaudeOutcome => ({
    outcome: 'failed',
    exitCode,
    numTurns,
    error,
    summary,
    runnerUnavailable: false,
    usageLimit: null,
  });
  // M5: a cause that affects every item; the runner stops its loop instead of claiming the next item.
  const unavailable = (why: string, exitCode: number | null, usageLimit: ClaudeOutcome['usageLimit'] = null): ClaudeOutcome => ({
    ...failed(`${RUNNER_UNAVAILABLE}: ${oneLine(why, 400).trim()}`, exitCode),
    runnerUnavailable: true,
    usageLimit,
  });
  /** A usage or rate limit named in the CLI's result text or stderr, else null. */
  const limitFailure = (detail: string, exitCode: number | null): ClaudeOutcome | null => {
    const texts = [detail, stderr];
    const hit = texts.find((text) => USAGE_LIMIT_RE.test(text));
    if (hit === undefined) return null;
    const resetAt = texts.map(usageLimitResetAt).find((at) => at !== null) ?? null;
    return unavailable(`usage limit: ${oneLine(hit, RESULT_TEXT_MAX).trim()}`, exitCode, { resetAt });
  };

  // N3: a cause the next run would hit again; the runner holds until the owner clears it.
  const held = (why: string, exitCode: number | null): ClaudeOutcome => ({ ...unavailable(why, exitCode), holdUntilCleared: true });

  if (run.spawnError !== null) return held(`claude could not be started: ${run.spawnError}`, null);
  const stream = readClaudeStream(stdout);
  // N3: the login and the MCP server are checked on every outcome (a timeout, an error result, a success),
  // first the verdict taken when the init message arrived, then the whole stream. A run that printed no
  // JSON at all never reached a model turn, so there is nothing to judge; it fails on its own terms below.
  // A run ended at its init message has no exit code of its own: the runner stopped it.
  if (run.initAbort !== undefined && run.initAbort !== null) return held(run.initAbort, null);
  if (stream.anyJson) {
    const { providerSignal } = claudeUsage(stdout);
    const exitCode = run.timedOut ? null : run.exitCode;
    if (providerSignal !== null) return held(`${NOT_ON_SUBSCRIPTION}: ${providerSignal}`, exitCode);
    const mcpProblem = stream.init === null ? null : mcpServerProblem(stream.init);
    if (mcpProblem !== null) return held(mcpProblem, exitCode);
  }
  if (run.timedOut) return failed('timeout', null);

  const r = stream.result;
  if (run.exitCode !== 0) {
    // With stream-json the CLI's own error text is in the result message; stderr is the fallback.
    const detail = r === null ? '' : resultDetail(r);
    const limited = limitFailure(detail, run.exitCode);
    if (limited !== null) return limited;
    if (detail !== '') return failed(detail, run.exitCode);
    const text = oneLine(stderr, 500);
    return failed(text.trim() === '' ? `exit ${run.exitCode ?? run.signal ?? 'unknown'}` : text, run.exitCode);
  }

  if (!stream.anyJson) return failed('claude output is not JSON', 0);
  if (r === null) return failed('claude output has no result message', 0);
  if (r.is_error !== false) {
    const detail = resultDetail(r);
    return limitFailure(detail, 0) ?? failed(`claude result is_error: ${detail}`, 0);
  }

  const numTurns = typeof r.num_turns === 'number' && Number.isInteger(r.num_turns) ? r.num_turns : null;
  const lines = typeof r.result === 'string' ? r.result.split(/\r?\n/).filter((line) => line.trim() !== '') : [];
  const last = lines[lines.length - 1];
  let parsed: unknown = null;
  if (last !== undefined) {
    try {
      parsed = JSON.parse(last.trim());
    } catch {
      parsed = null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failed(`${AGENT_NO_RESULT}: the final message does not end with the outcome JSON line`, 0, numTurns);
  }
  const p = parsed as { outcome?: unknown; result?: unknown; reason?: unknown; notes?: unknown };
  // K3: the notes are the run summary the owner reads (console Runs tab, email); blank means none.
  const summary = typeof p.notes === 'string' && p.notes.trim() !== '' ? p.notes.trim().slice(0, 2000) : null;
  // The prompt asks for `outcome`; L6 also names the blocked line `{"result":"blocked","reason":...}`.
  const value = p.outcome ?? p.result;
  if (value === 'blocked') {
    const why = typeof p.reason === 'string' && p.reason.trim() !== '' ? p.reason : (summary ?? 'no reason given');
    return failed(`${AGENT_BLOCKED}: ${oneLine(why, BLOCKED_REASON_MAX).trim()}`, 0, numTurns, summary);
  }
  if (value !== 'done' && value !== 'nothing_new') {
    return failed(`${AGENT_NO_RESULT}: the outcome JSON line has no known outcome`, 0, numTurns, summary);
  }
  return { outcome: value, exitCode: 0, numTurns, error: null, summary, runnerUnavailable: false, usageLimit: null };
}
