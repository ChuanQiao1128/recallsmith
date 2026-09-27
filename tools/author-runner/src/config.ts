// Runner configuration (A00 §11.2). Every variable is optional; an invalid value
// throws a ConfigError that names the variable and its range. The API settings
// (DC_API_BASE, DC_TOKEN_FILE, DC_REPO_ROOT, …) come from the MCP server's own
// loadConfig, bundled at build time.

import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AUTOMATION_SOURCE_HOSTS, loadConfig, parseHostList, type Config } from '../../mcp-server/src/config';

export const RUNNER_VERSION = '1.0.0';

const RUNNER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The pinned authoring model (ai-agent-3): a full model id, never a floating alias. */
export const DEFAULT_RUNNER_MODEL = 'claude-opus-5-5';

/** Claude Code model aliases that resolve to whatever model is newest, so they are refused. */
export const FLOATING_MODEL_ALIASES = ['default', 'best', 'opus', 'sonnet', 'haiku', 'opusplan', 'fable'];

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface RunnerConfig {
  runnerId: string;
  maxItems: number;
  leaseMinutes: number;
  itemTimeoutMinutes: number;
  itemTimeoutMs: number;
  heartbeatIntervalMs: number;
  killGraceMs: number;
  /** After the SIGKILL, the run settles at the latest this much later, whatever the process group does (ai-agent-6). */
  killSettleMs: number;
  model: string;
  /** The documentation hosts read_source may fetch in a run, besides the queue item's own host (ai-agent-1). */
  sourceHosts: string[];
  claudeBin: string;
  logDir: string;
  home: string;
  lockFile: string;
  api: Config;
}

export function defaultRunnerId(host: string): string {
  const id = host
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return RUNNER_ID_RE.test(id) ? id : 'mac';
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function intInRange(env: Record<string, string | undefined>, name: string, min: number, max: number, fallback: number): number {
  const raw = nonEmpty(env[name]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer from ${min} to ${max}`);
  }
  return n;
}

export function loadRunnerConfig(env: Record<string, string | undefined> = process.env): RunnerConfig {
  const home = nonEmpty(env.HOME) ?? homedir();

  const idRaw = nonEmpty(env.DC_RUNNER_ID);
  if (idRaw !== undefined && !RUNNER_ID_RE.test(idRaw)) {
    throw new ConfigError('DC_RUNNER_ID must match ^[a-z0-9][a-z0-9-]{0,63}$ (1 to 64 characters)');
  }
  const runnerId = idRaw ?? defaultRunnerId(hostname());

  const maxItems = intInRange(env, 'DC_RUNNER_MAX_ITEMS', 1, 5, 3);
  const leaseMinutes = intInRange(env, 'DC_RUNNER_LEASE_MINUTES', 15, 240, 90);
  const itemTimeoutMinutes = intInRange(env, 'DC_RUNNER_ITEM_TIMEOUT_MINUTES', 5, 120, 45);
  // Items are claimed one at a time, right before each run, so one lease must cover one full item (ai-agent-2).
  if (itemTimeoutMinutes + 1 > leaseMinutes) {
    throw new ConfigError('DC_RUNNER_ITEM_TIMEOUT_MINUTES + 1 must not exceed DC_RUNNER_LEASE_MINUTES');
  }

  const model = env.DC_RUNNER_MODEL === undefined || env.DC_RUNNER_MODEL === '' ? DEFAULT_RUNNER_MODEL : env.DC_RUNNER_MODEL;
  if (model.length > 100 || /\s/.test(model)) {
    throw new ConfigError('DC_RUNNER_MODEL must be 1 to 100 characters with no whitespace');
  }
  if (FLOATING_MODEL_ALIASES.includes(model.toLowerCase().replace(/\[.*\]$/, ''))) {
    throw new ConfigError(`DC_RUNNER_MODEL must be a full model id such as ${DEFAULT_RUNNER_MODEL}, not the floating alias ${model}`);
  }

  const sourceHosts = parseHostList(env.DC_RUNNER_SOURCE_HOSTS);
  if (sourceHosts.some((host) => !HOST_RE.test(host))) {
    throw new ConfigError('DC_RUNNER_SOURCE_HOSTS must be a comma list of host names');
  }

  const claudeBin = nonEmpty(env.DC_RUNNER_CLAUDE_BIN) ?? 'claude';
  const logDir = nonEmpty(env.DC_RUNNER_LOG_DIR) ?? join(home, 'Library', 'Logs', 'DeveloperCards');

  let api: Config;
  try {
    api = loadConfig({ ...env, HOME: home });
  } catch (err) {
    throw new ConfigError(err instanceof Error ? err.message : String(err));
  }

  return {
    runnerId,
    maxItems,
    leaseMinutes,
    itemTimeoutMinutes,
    itemTimeoutMs: itemTimeoutMinutes * 60_000,
    heartbeatIntervalMs: 300_000,
    killGraceMs: 30_000,
    killSettleMs: 5_000,
    model,
    sourceHosts: sourceHosts.length > 0 ? sourceHosts : [...DEFAULT_AUTOMATION_SOURCE_HOSTS],
    claudeBin,
    logDir,
    home,
    lockFile: join(home, 'Library', 'Application Support', 'DeveloperCards', 'author-runner.lock'),
    api,
  };
}
