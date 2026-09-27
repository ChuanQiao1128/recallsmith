import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRunnerConfig } from '../src/config';
import { LOCK_GRACE_MS, LOCK_ITEM_OVERHEAD_MS, acquireLock, lockStaleMs } from '../src/lock';

let dir = '';
afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

/** The pid of a process that has already exited. */
function deadPid(): number {
  const res = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(res.stdout);
}

const DEFAULT_STALE_MS = lockStaleMs({ maxItems: 3, itemTimeoutMs: 45 * 60_000, killGraceMs: 30_000, killSettleMs: 5_000 });

describe('lock', () => {
  it('refuses a held lock and takes over a stale one', () => {
    dir = mkdtempSync(join(tmpdir(), 'dc-runner-lock-'));
    const file = join(dir, 'Application Support', 'DeveloperCards', 'author-runner.lock');

    const first = acquireLock(file, DEFAULT_STALE_MS);
    expect(first).not.toBeNull();
    const holder = JSON.parse(readFileSync(file, 'utf8')) as { pid: number; startedAt: string };
    expect(holder.pid).toBe(process.pid);
    expect(Number.isFinite(Date.parse(holder.startedAt))).toBe(true);
    expect(acquireLock(file, DEFAULT_STALE_MS)).toBeNull();
    first!.release();
    expect(existsSync(file)).toBe(false);

    // Stale: the holder's pid is gone.
    writeFileSync(file, JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));
    const second = acquireLock(file, DEFAULT_STALE_MS);
    expect(second).not.toBeNull();
    second!.release();

    // Stale: a live pid, but older than the longest run the configuration allows (a reused pid).
    writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - DEFAULT_STALE_MS - 60_000).toISOString() }));
    const third = acquireLock(file, DEFAULT_STALE_MS);
    expect(third).not.toBeNull();

    // release() leaves a lock that another live process holds in place.
    writeFileSync(file, JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString() }));
    third!.release();
    expect(existsSync(file)).toBe(true);
    expect(acquireLock(file, DEFAULT_STALE_MS)).toBeNull();
  });

  it('derives the staleness of a live lock from the longest configured run, not a fixed 3 hours (ai-agent-16)', () => {
    // The longest configuration: 5 items of 120 minutes each.
    const longest = loadRunnerConfig({ HOME: tmpdir(), DC_RUNNER_MAX_ITEMS: '5', DC_RUNNER_ITEM_TIMEOUT_MINUTES: '120', DC_RUNNER_LEASE_MINUTES: '240' });
    const staleMs = lockStaleMs(longest);
    expect(staleMs).toBe(5 * (120 * 60_000 + 30_000 + 5_000 + LOCK_ITEM_OVERHEAD_MS) + LOCK_GRACE_MS);
    expect(staleMs).toBeGreaterThan(5 * 120 * 60_000);
    // Every configuration covers its own worst case of maxItems claude runs up to their kill deadlines.
    const defaults = loadRunnerConfig({ HOME: tmpdir() });
    expect(lockStaleMs(defaults)).toBe(DEFAULT_STALE_MS);
    expect(DEFAULT_STALE_MS).toBeGreaterThan(defaults.maxItems * (defaults.itemTimeoutMs + defaults.killGraceMs + defaults.killSettleMs));

    dir = mkdtempSync(join(tmpdir(), 'dc-runner-lock-'));
    const file = join(dir, 'author-runner.lock');
    const now = new Date('2026-09-28T12:00:00.000Z');
    const holdLive = (ageMs: number) =>
      writeFileSync(file, JSON.stringify({ pid: process.ppid, startedAt: new Date(now.getTime() - ageMs).toISOString() }));

    // A live run 3 hours and 1 minute in (the old fixed limit) still holds the lock.
    holdLive(3 * 60 * 60_000 + 60_000);
    expect(acquireLock(file, staleMs, () => now)).toBeNull();
    // Exactly at the boundary it still holds; one millisecond past it the lock is taken over.
    holdLive(staleMs);
    expect(acquireLock(file, staleMs, () => now)).toBeNull();
    holdLive(staleMs + 1);
    const taken = acquireLock(file, staleMs, () => now);
    expect(taken).not.toBeNull();
    taken!.release();
    expect(existsSync(file)).toBe(false);
  });
});
