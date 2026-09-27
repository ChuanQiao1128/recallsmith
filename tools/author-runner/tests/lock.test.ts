import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCK_STALE_MS, acquireLock } from '../src/lock';

let dir = '';
afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

/** The pid of a process that has already exited. */
function deadPid(): number {
  const res = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(res.stdout);
}

describe('lock', () => {
  it('refuses a held lock and takes over a stale one', () => {
    dir = mkdtempSync(join(tmpdir(), 'dc-runner-lock-'));
    const file = join(dir, 'Application Support', 'DeveloperCards', 'author-runner.lock');

    const first = acquireLock(file);
    expect(first).not.toBeNull();
    const holder = JSON.parse(readFileSync(file, 'utf8')) as { pid: number; startedAt: string };
    expect(holder.pid).toBe(process.pid);
    expect(Number.isFinite(Date.parse(holder.startedAt))).toBe(true);
    expect(acquireLock(file)).toBeNull();
    first!.release();
    expect(existsSync(file)).toBe(false);

    // Stale: the holder's pid is gone.
    writeFileSync(file, JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));
    const second = acquireLock(file);
    expect(second).not.toBeNull();
    second!.release();

    // Stale: a live pid, but older than three hours.
    writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - LOCK_STALE_MS - 60_000).toISOString() }));
    const third = acquireLock(file);
    expect(third).not.toBeNull();

    // release() leaves a lock that another live process holds in place.
    writeFileSync(file, JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString() }));
    third!.release();
    expect(existsSync(file)).toBe(true);
    expect(acquireLock(file)).toBeNull();
  });
});
