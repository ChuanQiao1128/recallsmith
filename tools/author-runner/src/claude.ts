// Headless Claude Code (A00 §11.4, §0.9): the exact argument list, the scrubbed
// child environment, the spawn into its own process group with a timeout, and the
// reading of the JSON result. The run uses the owner's Claude subscription login,
// never an API key or a cloud credential, and has no Bash/WebFetch/Edit/Write tool.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import type { RunOutcome } from './api';
import type { RunnerConfig } from './config';

export const CLAUDE_TOOLS = 'Read,Task,Agent,Skill';

export const CLAUDE_ALLOWED_TOOLS =
  'mcp__developercards__read_source,mcp__developercards__find_similar_cards,mcp__developercards__lint_card,mcp__developercards__submit_draft,Task,Agent,Skill,Read(content/decks/FORMAT.md),Read(.claude/skills/author-cards/**)';

export function claudeArgs(prompt: string, model: string, mcpConfigPath: string): string[] {
  return [
    '-p', prompt,
    '--output-format', 'json',
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

export const SCRUBBED_ENV_NAMES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
];

/** The runner env minus the API-key/cloud variables and every AWS_* variable. */
export function scrubEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SCRUBBED_ENV_NAMES.includes(name) || name.startsWith('AWS_')) continue;
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
}

export interface RunClaudeOptions {
  config: Pick<RunnerConfig, 'claudeBin' | 'model' | 'itemTimeoutMs' | 'killGraceMs' | 'api'>;
  prompt: string;
  mcpConfigPath: string;
  stdoutFile: string;
  stderrFile: string;
  baseEnv: Record<string, string | undefined>;
}

function killGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw err;
  }
}

/** Spawns claude in its own process group; on timeout SIGTERM the group, then SIGKILL after the grace period. */
export function runClaude(opts: RunClaudeOptions): Promise<ClaudeRun> {
  const { config } = opts;
  const out = openSync(opts.stdoutFile, 'w', 0o600);
  const err = openSync(opts.stderrFile, 'w', 0o600);
  return new Promise<ClaudeRun>((resolve) => {
    let settled = false;
    let timedOut = false;
    let exited: { code: number | null; signal: string | null } | null = null;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const child = spawn(config.claudeBin, claudeArgs(opts.prompt, config.model, opts.mcpConfigPath), {
      cwd: config.api.repoRoot,
      env: scrubEnv(opts.baseEnv),
      detached: true,
      stdio: ['ignore', out, err],
    });
    closeSync(out);
    closeSync(err);
    const pid = child.pid ?? null;

    const finish = (run: ClaudeRun): void => {
      if (settled) return;
      settled = true;
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      resolve(run);
    };

    child.on('error', (e: NodeJS.ErrnoException) => {
      if (pid === null) {
        finish({ pid, exitCode: null, signal: null, timedOut: false, spawnError: e.code ?? e.message });
      }
    });

    child.on('exit', (code, signal) => {
      exited = { code, signal };
      // After a timeout, wait for the grace timer unless the whole group is already gone.
      if (timedOut && pid !== null && killGroup(pid, 0)) return;
      finish({ pid, exitCode: code, signal, timedOut, spawnError: null });
    });

    if (pid !== null) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killGroup(pid, 'SIGTERM');
        graceTimer = setTimeout(() => {
          if (killGroup(pid, 0)) killGroup(pid, 'SIGKILL');
          if (exited !== null) finish({ pid, exitCode: exited.code, signal: exited.signal, timedOut, spawnError: null });
        }, config.killGraceMs);
      }, config.itemTimeoutMs);
    }
  });
}

export interface ClaudeOutcome {
  outcome: RunOutcome;
  exitCode: number | null;
  numTurns: number | null;
  error: string | null;
  summary: string | null;
}

function oneLine(text: string, max: number): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, max);
}

/** The outcome reported to `complete` for one claude run (A00 §11.3 step 6). */
export function claudeOutcome(run: ClaudeRun, stdout: string, stderr: string): ClaudeOutcome {
  const failed = (error: string, exitCode: number | null): ClaudeOutcome => ({
    outcome: 'failed',
    exitCode,
    numTurns: null,
    error,
    summary: null,
  });
  if (run.spawnError !== null) return failed(`claude could not be started: ${run.spawnError}`, null);
  if (run.timedOut) return failed('timeout', null);
  if (run.exitCode !== 0) {
    const text = oneLine(stderr, 500);
    return failed(text.trim() === '' ? `exit ${run.exitCode ?? run.signal ?? 'unknown'}` : text, run.exitCode);
  }

  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch {
    return failed('claude output is not JSON', 0);
  }
  if (typeof result !== 'object' || result === null) return failed('claude output is not JSON', 0);
  const r = result as { is_error?: unknown; num_turns?: unknown; result?: unknown };
  if (r.is_error !== false) return failed('claude result is_error', 0);

  const numTurns = typeof r.num_turns === 'number' && Number.isInteger(r.num_turns) ? r.num_turns : null;
  let outcome: RunOutcome = 'done';
  let summary: string | null = null;
  const lines = typeof r.result === 'string' ? r.result.split(/\r?\n/).filter((line) => line.trim() !== '') : [];
  const last = lines[lines.length - 1];
  if (last !== undefined) {
    try {
      const parsed: unknown = JSON.parse(last.trim());
      if (typeof parsed === 'object' && parsed !== null) {
        const p = parsed as { outcome?: unknown; notes?: unknown };
        if (p.outcome === 'done' || p.outcome === 'nothing_new') outcome = p.outcome;
        if (typeof p.notes === 'string') summary = p.notes.slice(0, 2000);
      }
    } catch {
      // Not a JSON line: the outcome stays `done` with no summary.
    }
  }
  return { outcome, exitCode: 0, numTurns, error: null, summary };
}
