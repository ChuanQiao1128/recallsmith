import { spawnSync } from 'node:child_process';

// Linux can refuse to exec a just-written script with ETXTBSY while a process forked by another test
// worker still holds the write descriptor (between its fork and exec). ota.sh hides the fake eas's
// stderr, so that race used to surface as a bogus "missing names" exit 3 on CI. Probe each fake once,
// retrying only on ETXTBSY, before the real run; the probe argument makes the fakes exit silently.
export const PROBE = '__exec_probe__';
export function waitUntilExecutable(file: string) {
  for (let i = 0; i < 50; i++) {
    const r = spawnSync(file, [PROBE], { encoding: 'utf8' });
    if ((r.error as NodeJS.ErrnoException | undefined)?.code !== 'ETXTBSY') return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error(`fake binary still ETXTBSY after 50 probes: ${file}`);
}
