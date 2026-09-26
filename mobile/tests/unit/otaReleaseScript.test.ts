import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OTA = path.resolve(HERE, '../../scripts/release/ota.sh');
const ALL_NAMES = [
  'EXPO_PUBLIC_API_BASE',
  'EXPO_PUBLIC_AWS_REGION',
  'EXPO_PUBLIC_COGNITO_USER_POOL_ID',
  'EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID',
  'EXPO_PUBLIC_RC_IOS_API_KEY',
];

// The fake eas prints values that all contain this marker; ota.sh must never
// surface it, because eas env:list reveals real secret values.
const MARKER = 'secret-value-do-not-print';

// Write a fake `eas` onto PATH so the real CLI is never invoked. It answers the
// three subcommands ota.sh uses: whoami (logged in), env:list (NAME=value lines
// whose value carries the marker, names driven by FAKE_EAS_NAMES), and update
// (records its args + EXPO_PUBLIC_ENV to FAKE_EAS_LOG instead of publishing).
function makeFakeEasDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-fake-eas-'));
  const eas = path.join(dir, 'eas');
  fs.writeFileSync(
    eas,
    [
      '#!/usr/bin/env bash',
      'case "$1" in',
      '  whoami) exit 0 ;;',
      `  env:list) for n in $FAKE_EAS_NAMES; do echo "$n=${MARKER}"; done ;;`,
      '  update)',
      '    echo "$@" >> "$FAKE_EAS_LOG"',
      '    echo "EXPO_PUBLIC_ENV=$EXPO_PUBLIC_ENV" >> "$FAKE_EAS_LOG"',
      '    ;;',
      'esac',
      '',
    ].join('\n'),
  );
  fs.chmodSync(eas, 0o755);
  return dir;
}

function runOta(opts: { names: string[]; dryRun?: boolean }) {
  const dir = makeFakeEasDir();
  const logPath = path.join(dir, 'eas.log');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH ?? ''}`,
    FAKE_EAS_LOG: logPath,
    FAKE_EAS_NAMES: opts.names.join(' '),
  };
  if (opts.dryRun) env.DRY_RUN = '1';
  const res = spawnSync('bash', [OTA, 'test message'], { env, encoding: 'utf8' });
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  return { res, log };
}

describe('ota.sh', () => {
  it('refuses to publish when a required EXPO_PUBLIC name is missing from the production environment', () => {
    const names = ALL_NAMES.filter((n) => n !== 'EXPO_PUBLIC_RC_IOS_API_KEY');
    const { res, log } = runOta({ names });
    expect(res.status).toBe(3);
    expect(res.stderr).toContain('EXPO_PUBLIC_RC_IOS_API_KEY');
    expect(log).not.toContain('update');
  });

  it('publishes to channel production with --environment production and never prints values', () => {
    const { res, log } = runOta({ names: ALL_NAMES });
    expect(res.status).toBe(0);
    expect(log).toContain('--channel production');
    expect(log).toContain('--environment production');
    expect(log).toContain('--platform ios');
    expect(log).toContain('EXPO_PUBLIC_ENV=production');
    expect(`${res.stdout}${res.stderr}`).not.toContain(MARKER);
  });

  it('DRY_RUN=1 checks the names and prints the command without publishing', () => {
    const { res, log } = runOta({ names: ALL_NAMES, dryRun: true });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('DRY: eas update --channel production --environment production');
    expect(log).not.toContain('update');
  });
});
