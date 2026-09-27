// The `once` flow (A00 §11.3): lock, prune old run files, heartbeat, claim, one
// headless claude run per claimed item (each reported with `complete`), final heartbeat.

import { hostname } from 'node:os';
import { join } from 'node:path';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { LOGIN_HINT } from '../../mcp-server/src/api';
import { createRunnerApi, type ClaimedItem, type HeartbeatRequest, type RunnerApi, type RunnerState, type RunOutcome } from './api';
import { claudeOutcome, claudeVersion, runClaude } from './claude';
import { RUNNER_VERSION, type RunnerConfig } from './config';
import { acquireLock } from './lock';
import { loginExpiresAt } from './login';
import { logLine, stdoutSink, type LogEvent, type LogFields, type LogSink } from './logs';
import { readPromptTemplate, renderPrompt } from './prompt';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_LOGIN_REQUIRED = 3;

export const RUNS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECK_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface RunOnceDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  log?: LogSink;
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
  const log = (level: 'info' | 'warn' | 'error', event: LogEvent, fields?: LogFields): void =>
    logLine(sink, now, level, event, config.runnerId, fields);

  log('info', 'start');
  const lock = acquireLock(config.lockFile, now);
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

  try {
    const runsDir = join(config.logDir, 'runs');
    pruneRuns(runsDir, now());

    status.loginExpiresAt = loginExpiresAt(config.api.tokenFile);
    status.claudeVersion = claudeVersion(config.claudeBin, env);
    const previous = readLastRun(config);
    if (previous !== null) {
      status.lastRunId = previous.runId;
      status.lastRunAt = previous.finishedAt;
      status.lastRunOutcome = previous.outcome;
    }

    let items: ClaimedItem[];
    try {
      const hb = await heartbeat('running');
      if (hb.effectiveMode === 'off') {
        log('info', 'mode_off');
        await heartbeat('idle');
        return EXIT_OK;
      }
      const claimed = await api.claim({ runnerId: config.runnerId, max: config.maxItems, leaseMinutes: config.leaseMinutes });
      items = claimed.effectiveMode === 'off' || !Array.isArray(claimed.items) ? [] : claimed.items;
    } catch (err) {
      if (isLoginFailure(err)) {
        log('error', 'login_required', { error: errorMessage(err) });
        return EXIT_LOGIN_REQUIRED;
      }
      log('error', 'api_error', { error: errorMessage(err) });
      await bestEffortError(errorMessage(err));
      return EXIT_FAILURE;
    }

    if (items.length === 0) {
      log('info', 'no_items');
      await heartbeat('idle');
      return EXIT_OK;
    }
    log('info', 'claimed');

    const template = readPromptTemplate();
    let lastError: string | null = null;

    for (const item of items) {
      const invalid = invalidItem(item);
      if (invalid !== null) {
        const itemId = typeof item?.itemId === 'number' && Number.isInteger(item.itemId) ? item.itemId : undefined;
        log('warn', 'bad_item', { itemId, error: invalid });
        continue;
      }
      const { runId, itemId, deckSlug } = item;
      if (now().getTime() + config.itemTimeoutMs > Date.parse(item.leaseExpiresAt)) {
        log('warn', 'lease_short', { runId, itemId });
        continue;
      }

      log('info', 'item_start', { runId, itemId });
      const started = now().getTime();
      const mcpConfigPath = join(runsDir, `${runId}.mcp.json`);
      const mcpConfig = {
        mcpServers: {
          developercards: {
            command: process.execPath,
            args: [join(config.api.repoRoot, 'tools', 'mcp-server', 'dist', 'index.js')],
            env: {
              DC_AUTOMATION_RUN_ID: runId,
              DC_AUTOMATION_QUEUE_ITEM_ID: String(itemId),
              DC_AUTOMATION_DECK_SLUG: deckSlug,
            },
          },
        },
      };
      writeFileSync(mcpConfigPath, `${JSON.stringify(mcpConfig, null, 2)}\n`, { mode: 0o600 });
      const prompt = renderPrompt(template, item);
      writeFileSync(join(runsDir, `${runId}.prompt.md`), prompt, { mode: 0o600 });

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
        run = await runClaude({ config, prompt, mcpConfigPath, stdoutFile, stderrFile, baseEnv: env });
      } finally {
        clearInterval(ticker);
        await inFlight;
      }
      const result = claudeOutcome(run, readText(stdoutFile), readText(stderrFile));
      const durationMs = Math.max(0, now().getTime() - started);
      if (result.outcome === 'failed') lastError = result.error ?? 'failed';

      try {
        await api.complete({
          runnerId: config.runnerId,
          runId,
          outcome: result.outcome,
          exitCode: result.exitCode,
          durationMs,
          numTurns: result.numTurns,
          error: result.error === null ? null : result.error.slice(0, 500),
          summary: result.summary,
        });
      } catch (err) {
        lastError = `complete failed for ${runId}: ${errorMessage(err)}`;
        log('error', 'complete_failed', { runId, itemId, error: errorMessage(err) });
      }

      const finishedAt = now().toISOString();
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
