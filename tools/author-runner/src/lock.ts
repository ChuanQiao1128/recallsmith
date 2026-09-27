// Single-instance lock (A00 §11.3 step 1): an O_EXCL file holding { pid, startedAt }.
// A lock whose pid is gone is stale and taken over. A lock whose pid is alive is stale only
// once it is older than the longest run the configuration allows (ai-agent-16), which only
// guards against a reused pid: a live run is never taken over.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RunnerConfig } from './config';

/** Per item, besides the claude time limit and its kill deadlines: the claim, the complete (with its retries) and the heartbeats. */
export const LOCK_ITEM_OVERHEAD_MS = 60_000;
/** Once per run: the prune, the pinning, the first and last heartbeats and the replay of pending completes. */
export const LOCK_GRACE_MS = 30 * 60_000;

/** The longest a run of this configuration can hold the lock; a live holder is taken over only after this. */
export function lockStaleMs(config: Pick<RunnerConfig, 'maxItems' | 'itemTimeoutMs' | 'killGraceMs' | 'killSettleMs'>): number {
  return config.maxItems * (config.itemTimeoutMs + config.killGraceMs + config.killSettleMs + LOCK_ITEM_OVERHEAD_MS) + LOCK_GRACE_MS;
}

export interface Lock {
  release(): void;
}

interface Holder {
  pid?: unknown;
  startedAt?: unknown;
}

function readHolder(file: string): Holder | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Holder) : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function isStale(holder: Holder | null, now: number, staleMs: number): boolean {
  if (holder === null || typeof holder.pid !== 'number' || !Number.isInteger(holder.pid) || holder.pid <= 0) return true;
  if (!pidAlive(holder.pid)) return true;
  const started = typeof holder.startedAt === 'string' ? Date.parse(holder.startedAt) : Number.NaN;
  return !Number.isFinite(started) || now - started > staleMs;
}

function tryCreate(file: string, now: Date): boolean {
  let fd: number;
  try {
    fd = openSync(file, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: now.toISOString() }));
  } finally {
    closeSync(fd);
  }
  return true;
}

/** The lock, or null when another live run holds it; `staleMs` is lockStaleMs of the runner configuration. */
export function acquireLock(file: string, staleMs: number, now: () => Date = () => new Date()): Lock | null {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let acquired = tryCreate(file, now());
  if (!acquired) {
    if (!isStale(readHolder(file), now().getTime(), staleMs)) return null;
    rmSync(file, { force: true });
    acquired = tryCreate(file, now());
  }
  if (!acquired) return null;
  return {
    release() {
      const holder = readHolder(file);
      if (holder !== null && holder.pid === process.pid) rmSync(file, { force: true });
    },
  };
}
