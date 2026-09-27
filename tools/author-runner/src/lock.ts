// Single-instance lock (A00 §11.3 step 1): an O_EXCL file holding { pid, startedAt }.
// A lock whose pid is gone or that is older than three hours is stale and taken over.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export const LOCK_STALE_MS = 3 * 60 * 60 * 1000;

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

function isStale(holder: Holder | null, now: number): boolean {
  if (holder === null || typeof holder.pid !== 'number' || !Number.isInteger(holder.pid) || holder.pid <= 0) return true;
  if (!pidAlive(holder.pid)) return true;
  const started = typeof holder.startedAt === 'string' ? Date.parse(holder.startedAt) : Number.NaN;
  return !Number.isFinite(started) || now - started > LOCK_STALE_MS;
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

/** The lock, or null when another live run holds it. */
export function acquireLock(file: string, now: () => Date = () => new Date()): Lock | null {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let acquired = tryCreate(file, now());
  if (!acquired) {
    if (!isStale(readHolder(file), now().getTime())) return null;
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
