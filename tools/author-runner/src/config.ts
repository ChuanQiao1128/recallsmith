// Runner configuration (A00 §11.2). Every variable is optional; an invalid value
// throws a ConfigError that names the variable and its range. The API settings
// (DC_API_BASE, DC_TOKEN_FILE, DC_REPO_ROOT, …) come from the MCP server's own
// loadConfig, bundled at build time.

import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '../../mcp-server/src/config';

export const RUNNER_VERSION = '1.0.0';

const RUNNER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
  model: string;
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

  const model = env.DC_RUNNER_MODEL === undefined || env.DC_RUNNER_MODEL === '' ? 'opus' : env.DC_RUNNER_MODEL;
  if (model.length > 100 || /\s/.test(model)) {
    throw new ConfigError('DC_RUNNER_MODEL must be 1 to 100 characters with no whitespace');
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
    model,
    claudeBin,
    logDir,
    home,
    lockFile: join(home, 'Library', 'Application Support', 'DeveloperCards', 'author-runner.lock'),
    api,
  };
}
