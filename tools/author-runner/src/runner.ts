// The `once` flow (A00 §11.3): lock, prune old run files, pin the author configuration,
// heartbeat, then up to DC_RUNNER_MAX_ITEMS times: claim ONE item right before its run (so
// each item gets a fresh lease, ai-agent-2), one headless claude run reported with
// `complete`; an item that is not run is released at once with a failed `complete`
// (automation-7). Final heartbeat. A `complete` is retried with a jittered backoff; one that
// still fails is kept in <logDir>/pending-complete/<runId>.json and re-sent by the next run
// before its first claim, so the run result and the agent's notes are not lost (automation-16).

import { hostname } from 'node:os';
import { join } from 'node:path';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { LOGIN_HINT } from '../../mcp-server/src/api';
import {
  createRunnerApi,
  type ClaimedItem,
  type CompleteRequest,
  type HeartbeatRequest,
  type RunnerApi,
  type RunnerState,
  type RunOutcome,
} from './api';
import { AuthorConfigError, MCP_SERVER_BUNDLE, readAuthorConfig, type AuthorConfig } from './authorConfig';
import { claudeOutcome, claudeUsage, claudeVersion, runClaude, type SignalGroup } from './claude';
import { RUNNER_VERSION, type RunnerConfig } from './config';
import { acquireLock, lockStaleMs } from './lock';
import { loginExpiresAt } from './login';
import { logLine, stdoutSink, type LogEvent, type LogFields, type LogSink } from './logs';
import { readPromptTemplate, renderPrompt } from './prompt';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_LOGIN_REQUIRED = 3;

export const RUNS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Attempts of one `complete` call before it is kept for the next run (automation-16). */
export const COMPLETE_ATTEMPTS = 3;
/** The backoff before the second attempt; it doubles per attempt and is jittered to 50–150 %. */
export const COMPLETE_BACKOFF_MS = 2_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECK_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface RunOnceDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  log?: LogSink;
  /** Tests only: replaces the process-group signal of the claude runs. */
  signalGroup?: SignalGroup;
  /** Tests only: replaces the wait between `complete` attempts. */
  sleep?: (ms: number) => Promise<void>;
}

export interface LastRun {
  runId: string;
  itemId: number;
  outcome: RunOutcome;
  finishedAt: string;
  durationMs: number;
}

export function lastRunFile(config: Pick<RunnerConfig, 'logDir'>): string {
  return join(config.logDir, 'last-run.json');
}

/** The content of <logDir>/last-run.json, or null when it is missing or malformed. */
export function readLastRun(config: Pick<RunnerConfig, 'logDir'>): LastRun | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(lastRunFile(config), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Partial<LastRun>;
    if (typeof p.runId !== 'string' || typeof p.finishedAt !== 'string') return null;
    if (p.outcome !== 'done' && p.outcome !== 'nothing_new' && p.outcome !== 'failed') return null;
    return {
      runId: p.runId,
      itemId: typeof p.itemId === 'number' ? p.itemId : 0,
      outcome: p.outcome,
      finishedAt: p.finishedAt,
      durationMs: typeof p.durationMs === 'number' ? p.durationMs : 0,
    };
  } catch {
    return null;
  }
}

export function pendingCompleteDir(config: Pick<RunnerConfig, 'logDir'>): string {
  return join(config.logDir, 'pending-complete');
}

/**
 * A `complete` the server refused with a client error (a validation error, RUN_NOT_FOUND, a runner
 * mismatch, RUN_NOT_RUNNING with a different outcome): sending it again can never succeed. A network
 * error, a 5xx, 401 (login), 408 and 429 are worth sending again.
 */
export function isPermanentCompleteFailure(err: unknown): boolean {
  const match = /^HTTP (\d{3})\b/.exec(err instanceof Error ? err.message : String(err));
  if (match === null) return false;
  const status = Number(match[1]);
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

interface PendingComplete {
  savedAt: string;
  itemId: number | null;
  request: CompleteRequest;
}

function readPending(file: string): PendingComplete | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Partial<PendingComplete>;
    const r = p.request;
    if (typeof r !== 'object' || r === null || typeof r.runId !== 'string' || !UUID_RE.test(r.runId)) return null;
    if (r.outcome !== 'done' && r.outcome !== 'nothing_new' && r.outcome !== 'failed') return null;
    return { savedAt: typeof p.savedAt === 'string' ? p.savedAt : '', itemId: typeof p.itemId === 'number' ? p.itemId : null, request: r };
  } catch {
    return null;
  }
}

/** A failure that means the owner must sign in again (no token file, refresh failed, or HTTP 401). */
export function isLoginFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith(LOGIN_HINT) || message.startsWith('HTTP 401');
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/[\r\n]+/g, ' ');
}

function pruneRuns(runsDir: string, now: Date): void {
  mkdirSync(runsDir, { recursive: true, mode: 0o700 });
  const cutoff = now.getTime() - RUNS_RETENTION_MS;
  for (const name of readdirSync(runsDir)) {
    const path = join(runsDir, name);
    try {
      const st = lstatSync(path);
      if (st.isFile() && st.mtimeMs < cutoff) rmSync(path, { force: true });
    } catch {
      // A file that vanished or cannot be read is left alone.
    }
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The read_source hosts of one run: the queue item's own host first, then the configured documentation hosts. */
export function runSourceHosts(itemUrl: string, configured: readonly string[]): string[] {
  const hosts: string[] = [];
  try {
    hosts.push(new URL(itemUrl).hostname.toLowerCase());
  } catch {
    // invalidItem already refused a url that does not parse.
  }
  for (const host of configured) if (!hosts.includes(host)) hosts.push(host);
  return hosts;
}

/** Why an item cannot be run safely, or null when every field used in a path or prompt is valid. */
function invalidItem(item: ClaimedItem): string | null {
  if (typeof item !== 'object' || item === null) return 'item is not an object';
  if (typeof item.runId !== 'string' || !UUID_RE.test(item.runId)) return 'invalid runId';
  if (typeof item.itemId !== 'number' || !Number.isInteger(item.itemId) || item.itemId <= 0) return 'invalid itemId';
  if (typeof item.deckSlug !== 'string' || !DECK_SLUG_RE.test(item.deckSlug)) return 'invalid deckSlug';
  if (typeof item.url !== 'string' || !item.url.startsWith('https://')) return 'invalid url';
  if (typeof item.leaseExpiresAt !== 'string' || !Number.isFinite(Date.parse(item.leaseExpiresAt))) return 'invalid leaseExpiresAt';
  return null;
}

export async function runOnce(config: RunnerConfig, deps: RunOnceDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const sink = deps.log ?? stdoutSink;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = (level: 'info' | 'warn' | 'error', event: LogEvent, fields?: LogFields): void =>
    logLine(sink, now, level, event, config.runnerId, fields);

  log('info', 'start');
  const lock = acquireLock(config.lockFile, lockStaleMs(config), now);
  if (lock === null) {
    log('info', 'locked');
    return EXIT_OK;
  }

  const api: RunnerApi = createRunnerApi(config.api);
  const status: Omit<HeartbeatRequest, 'state' | 'lastError'> = {
    runnerId: config.runnerId,
    host: hostname().slice(0, 64) || null,
    runnerVersion: RUNNER_VERSION,
    claudeVersion: null,
    loginExpiresAt: null,
    lastRunId: null,
    lastRunAt: null,
    lastRunOutcome: null,
  };
  const heartbeat = (state: RunnerState, extra: Partial<HeartbeatRequest> = {}) =>
    api.heartbeat({ ...status, state, lastError: null, ...extra });
  const bestEffortError = async (lastError: string): Promise<void> => {
    try {
      await heartbeat('error', { lastError: lastError.slice(0, 500) });
    } catch (err) {
      log('warn', 'heartbeat_failed', { error: errorMessage(err) });
    }
  };
  /** A heartbeat or claim that failed: exit 3 when the owner must sign in again, else exit 1 with an error heartbeat. */
  const apiFailure = async (err: unknown): Promise<number> => {
    if (isLoginFailure(err)) {
      log('error', 'login_required', { error: errorMessage(err) });
      return EXIT_LOGIN_REQUIRED;
    }
    log('error', 'api_error', { error: errorMessage(err) });
    await bestEffortError(errorMessage(err));
    return EXIT_FAILURE;
  };

  try {
    const runsDir = join(config.logDir, 'runs');
    pruneRuns(runsDir, now());
    // A kept complete older than the runs retention is long past its lease; the server has requeued its item.
    pruneRuns(pendingCompleteDir(config), now());

    status.loginExpiresAt = loginExpiresAt(config.api.tokenFile);
    status.claudeVersion = claudeVersion(config.claudeBin, env);
    const previous = readLastRun(config);
    if (previous !== null) {
      status.lastRunId = previous.runId;
      status.lastRunAt = previous.finishedAt;
      status.lastRunOutcome = previous.outcome;
    }

    // Pin the author configuration before any claim: a checkout the runner cannot pin runs nothing.
    const template = readPromptTemplate();
    let author: AuthorConfig;
    try {
      author = readAuthorConfig({
        repoRoot: config.api.repoRoot,
        model: config.model,
        promptTemplate: template,
        claudeVersion: status.claudeVersion,
        runnerVersion: RUNNER_VERSION,
      });
    } catch (err) {
      if (!(err instanceof AuthorConfigError)) throw err;
      log('error', 'author_config_error', { error: err.message });
      await bestEffortError(`author config: ${err.message}`);
      return EXIT_FAILURE;
    }

    const pendingDir = pendingCompleteDir(config);
    const pendingFile = (runId: string): string => join(pendingDir, `${runId}.json`);

    /**
     * Sends one `complete`, up to COMPLETE_ATTEMPTS times with a jittered backoff. When every attempt fails
     * with an error worth retrying, the request (with the agent's notes) is kept for the next run
     * (automation-16). Returns the error of a call that did not reach the server, or null.
     */
    const sendComplete = async (request: CompleteRequest, itemId: number | undefined): Promise<string | null> => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= COMPLETE_ATTEMPTS; attempt += 1) {
        try {
          await api.complete(request);
          return null;
        } catch (err) {
          lastErr = err;
          if (isPermanentCompleteFailure(err)) break;
          if (attempt < COMPLETE_ATTEMPTS) await sleep(COMPLETE_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random()));
        }
      }
      const error = errorMessage(lastErr);
      log('error', 'complete_failed', { runId: request.runId, itemId, error });
      if (!isPermanentCompleteFailure(lastErr)) {
        mkdirSync(pendingDir, { recursive: true, mode: 0o700 });
        const pending: PendingComplete = { savedAt: now().toISOString(), itemId: itemId ?? null, request };
        writeFileSync(pendingFile(request.runId), `${JSON.stringify(pending)}\n`, { mode: 0o600 });
        log('warn', 'complete_pending', { runId: request.runId, itemId });
      }
      return error;
    };

    /**
     * Re-sends every kept `complete` once, before the first claim; one that still fails stays for the next run.
     * Returns the error of the last one that failed, or null.
     */
    const replayPending = async (): Promise<string | null> => {
      let failure: string | null = null;
      let names: string[];
      try {
        names = readdirSync(pendingDir).filter((name) => name.endsWith('.json')).sort();
      } catch {
        return null;
      }
      for (const name of names) {
        const file = join(pendingDir, name);
        const pending = readPending(file);
        if (pending === null || name !== `${pending.request.runId}.json`) {
          rmSync(file, { force: true });
          continue;
        }
        const { request } = pending;
        const itemId = pending.itemId ?? undefined;
        try {
          const res = await api.complete(request);
          rmSync(file, { force: true });
          log('info', 'complete_replayed', { runId: request.runId, itemId, outcome: request.outcome, replayed: res.replayed === true });
        } catch (err) {
          if (isPermanentCompleteFailure(err)) {
            rmSync(file, { force: true });
            log('warn', 'complete_failed', { runId: request.runId, itemId, error: `dropped kept complete: ${errorMessage(err)}` });
          } else {
            failure = `complete failed for ${request.runId}: ${errorMessage(err)}`;
            log('error', 'complete_failed', { runId: request.runId, itemId, error: errorMessage(err) });
          }
        }
      }
      return failure;
    };

    let effectiveMode: string;
    try {
      effectiveMode = (await heartbeat('running')).effectiveMode;
    } catch (err) {
      return await apiFailure(err);
    }
    // Before any claim, also when the mode is off: the kept result and notes reach the server first.
    let lastError: string | null = await replayPending();
    if (effectiveMode === 'off') {
      log('info', 'mode_off');
      try {
        if (lastError === null) await heartbeat('idle');
        else await heartbeat('error', { lastError: lastError.slice(0, 500) });
      } catch (err) {
        return await apiFailure(err);
      }
      return EXIT_OK;
    }

    /** Hands a claimed item back at once instead of leaving it claimed until its lease lapses (automation-7). */
    const release = async (runId: string, itemId: number | undefined, reason: string): Promise<void> => {
      lastError = reason;
      const failure = await sendComplete(
        {
          runnerId: config.runnerId,
          runId,
          outcome: 'failed',
          exitCode: null,
          durationMs: 0,
          numTurns: null,
          error: reason.slice(0, 500),
          summary: null,
        },
        itemId,
      );
      if (failure !== null) lastError = `complete failed for ${runId}: ${failure}`;
    };

    for (let n = 0; n < config.maxItems; n += 1) {
      // One item per claim, right before its run, so its lease starts when its claude run starts.
      let item: ClaimedItem | undefined;
      try {
        const claimed = await api.claim({ runnerId: config.runnerId, max: 1, leaseMinutes: config.leaseMinutes });
        item = claimed.effectiveMode === 'off' || !Array.isArray(claimed.items) ? undefined : claimed.items[0];
      } catch (err) {
        return await apiFailure(err);
      }
      if (item === undefined) {
        if (n > 0) break;
        log('info', 'no_items');
        await heartbeat('idle');
        return EXIT_OK;
      }
      log('info', 'claimed');

      const invalid = invalidItem(item);
      if (invalid !== null) {
        const itemId = typeof item?.itemId === 'number' && Number.isInteger(item.itemId) ? item.itemId : undefined;
        log('warn', 'bad_item', { itemId, error: invalid });
        const runId = typeof item?.runId === 'string' && UUID_RE.test(item.runId) ? item.runId : null;
        if (runId !== null) await release(runId, itemId, `not run: ${invalid}`);
        else lastError = `not run: ${invalid}`;
        continue;
      }
      const { runId, itemId, deckSlug } = item;
      if (now().getTime() + config.itemTimeoutMs > Date.parse(item.leaseExpiresAt)) {
        // The server granted a lease shorter than one item; every later claim would be short too.
        log('warn', 'lease_short', { runId, itemId });
        await release(runId, itemId, 'not run: lease_short (the lease ends before the item timeout)');
        break;
      }

      log('info', 'item_start', { runId, itemId, authorConfigId: author.id });
      const started = now().getTime();
      const startedAt = now().toISOString();
      const mcpConfigPath = join(runsDir, `${runId}.mcp.json`);
      const mcpConfig = {
        mcpServers: {
          developercards: {
            command: process.execPath,
            args: [join(config.api.repoRoot, MCP_SERVER_BUNDLE)],
            env: {
              DC_AUTOMATION_RUN_ID: runId,
              DC_AUTOMATION_QUEUE_ITEM_ID: String(itemId),
              DC_AUTOMATION_DECK_SLUG: deckSlug,
              DC_AUTOMATION_SOURCE_HOSTS: runSourceHosts(item.url, config.sourceHosts).join(','),
              DC_AUTOMATION_AUTHOR_MODEL: author.model,
              DC_AUTOMATION_SKILL_VERSION: author.skillVersion,
            },
          },
        },
      };
      writeFileSync(mcpConfigPath, `${JSON.stringify(mcpConfig, null, 2)}\n`, { mode: 0o600 });
      const prompt = renderPrompt(template, { ...item, skillVersion: author.skillVersion });
      writeFileSync(join(runsDir, `${runId}.prompt.md`), prompt, { mode: 0o600 });
      const metaFile = join(runsDir, `${runId}.meta.json`);
      writeFileSync(metaFile, `${JSON.stringify({ runId, itemId, startedAt, authorConfig: author }, null, 2)}\n`, { mode: 0o600 });

      let inFlight: Promise<void> = Promise.resolve();
      const ticker = setInterval(() => {
        inFlight = inFlight.then(async () => {
          try {
            await heartbeat('running', { lastRunId: runId });
          } catch (err) {
            log('warn', 'heartbeat_failed', { runId, itemId, error: errorMessage(err) });
          }
        });
      }, config.heartbeatIntervalMs);

      const stdoutFile = join(runsDir, `${runId}.json`);
      const stderrFile = join(runsDir, `${runId}.stderr.log`);
      let run;
      try {
        run = await runClaude({ config, prompt, mcpConfigPath, stdoutFile, stderrFile, baseEnv: env, signalGroup: deps.signalGroup });
      } finally {
        clearInterval(ticker);
        await inFlight;
      }
      const stdout = readText(stdoutFile);
      const result = claudeOutcome(run, stdout, readText(stderrFile));
      const usage = claudeUsage(stdout);
      const durationMs = Math.max(0, now().getTime() - started);
      if (result.outcome === 'failed') lastError = result.error ?? 'failed';

      const completeFailure = await sendComplete(
        {
          runnerId: config.runnerId,
          runId,
          outcome: result.outcome,
          exitCode: result.exitCode,
          durationMs,
          numTurns: result.numTurns,
          error: result.error === null ? null : result.error.slice(0, 500),
          summary: result.summary,
        },
        itemId,
      );
      if (completeFailure !== null) lastError = `complete failed for ${runId}: ${completeFailure}`;

      const finishedAt = now().toISOString();
      // The local record of the run: the pinned author configuration and what the CLI reported it used.
      const meta = {
        runId,
        itemId,
        startedAt,
        finishedAt,
        outcome: result.outcome,
        authorConfig: author,
        usage: { totalCostUsd: usage.totalCostUsd, models: usage.models, apiKeySource: usage.apiKeySource },
      };
      writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
      const lastRun: LastRun = { runId, itemId, outcome: result.outcome, finishedAt, durationMs };
      writeFileSync(lastRunFile(config), `${JSON.stringify(lastRun)}\n`, { mode: 0o600 });
      status.lastRunId = runId;
      status.lastRunAt = finishedAt;
      status.lastRunOutcome = result.outcome;
      log(result.outcome === 'failed' ? 'warn' : 'info', 'item_done', {
        runId,
        itemId,
        outcome: result.outcome,
        durationMs,
        costUsd: usage.totalCostUsd ?? undefined,
        error: result.error ?? undefined,
      });
    }

    try {
      if (lastError !== null) await heartbeat('error', { lastError: lastError.slice(0, 500) });
      else await heartbeat('idle');
    } catch (err) {
      log('warn', 'heartbeat_failed', { error: errorMessage(err) });
    }
    log('info', 'finish');
    return EXIT_OK;
  } catch (err) {
    log('error', 'unexpected_error', { error: errorMessage(err) });
    await bestEffortError(errorMessage(err));
    return EXIT_FAILURE;
  } finally {
    lock.release();
  }
}
