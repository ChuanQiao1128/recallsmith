import { spawnSync } from 'node:child_process';

// Probe each fake once, retrying only on ETXTBSY, before the real run; the probe argument makes the fakes
// exit silently. This is a cheap guard, not the explanation of the CI exit-3 flake (run 36673253161):
// ota.sh execs the same fake for `eas whoami` before `eas env:list` and exits 2 if that fails, and nothing
// reopens a fake for writing afterwards, so ETXTBSY cannot empty env:list (R19M-REL-7). The cause is still
// unknown; the ota.sh/ios-build.sh tests therefore print stdout, stderr and every fake's argv and stderr
// logs when a status is unexpected, so the next occurrence carries its own diagnosis.
export const PROBE = '__exec_probe__';
export function waitUntilExecutable(file: string) {
  for (let i = 0; i < 50; i++) {
    const r = spawnSync(file, [PROBE], { encoding: 'utf8' });
    if ((r.error as NodeJS.ErrnoException | undefined)?.code !== 'ETXTBSY') return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error(`fake binary still ETXTBSY after 50 probes: ${file}`);
}
