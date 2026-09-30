// scripts/resolve-sentry-dsn.sh, run under bash with a fake `aws` first on PATH.
//
// Nothing here can reach AWS: the child's environment is built explicitly (a
// temp bin dir holding the fake, then the inherited PATH for bash/grep/env,
// HOME, and this test's own variables), never copied from process.env, so
// neither the owner's credentials nor a VITE_SENTRY_DSN in their shell can leak
// in. The fake appends its argv to a log and prints a value or exits 254.
//
// The DSN reaches the child only through `env`, never inside the `-c` text, and
// the `-c` text prints markers rather than the value, so the "never prints the
// DSN" assertion is about the script and not about this harness.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const RESOLVER = join(FRONTEND, 'scripts', 'resolve-sentry-dsn.sh');
const DSN = 'https://publickey@example.invalid/1';

const SCRIPT = [
  'set -euo pipefail',
  'source "$RESOLVER"',
  'if [ -z "$VITE_SENTRY_DSN" ]; then echo DSN_EMPTY; elif [ "$VITE_SENTRY_DSN" = "${EXPECTED:-}" ]; then echo DSN_MATCH; else echo DSN_OTHER; fi',
  'echo "EXPORTED=$(env | grep -c \'^VITE_SENTRY_DSN=\' || true)"',
].join('\n');

const FAKE_AWS = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$FAKE_AWS_LOG"',
  'if [ -n "${FAKE_AWS_VALUE:-}" ]; then printf \'%s\\n\' "$FAKE_AWS_VALUE"; exit 0; fi',
  'exit 254',
  '',
].join('\n');

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  awsLog: string;
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'resolve-sentry-dsn-'));
  mkdirSync(join(tmp, 'bin'));
  const aws = join(tmp, 'bin', 'aws');
  writeFileSync(aws, FAKE_AWS);
  chmodSync(aws, 0o755);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(vars: Record<string, string>): Run {
  const log = join(tmp, `aws-${Math.random().toString(36).slice(2)}.log`);
  const env: Record<string, string> = {
    PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: tmp,
    RESOLVER,
    FAKE_AWS_LOG: log,
    ...vars,
  };
  const result = spawnSync('bash', ['-c', SCRIPT], { cwd: tmp, env, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    awsLog: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
}

function expectSet(r: Run): void {
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain('DSN_MATCH');
  expect(r.stdout).toContain('VITE_SENTRY_DSN: set\n');
  expect(r.stdout).toContain('EXPORTED=1');
}

function expectUnset(r: Run): void {
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain('DSN_EMPTY');
  expect(r.stdout).toContain('VITE_SENTRY_DSN: unset (Sentry disabled in this build)');
  expect(r.stdout).toContain('EXPORTED=1');
}

const SCENARIOS: Record<string, Record<string, string>> = {
  fromEnv: { VITE_SENTRY_DSN: DSN, EXPECTED: DSN },
  fromSsm: { FAKE_AWS_VALUE: DSN, EXPECTED: DSN },
  blankEnvFallsBackToSsm: { VITE_SENTRY_DSN: '   ', FAKE_AWS_VALUE: DSN, EXPECTED: DSN },
  customParam: { CONSOLE_SENTRY_DSN_PARAM: '/example/other-dsn', FAKE_AWS_VALUE: DSN, EXPECTED: DSN },
  ssmFails: {},
  malformedFromSsm: { FAKE_AWS_VALUE: 'https://publickey@example.invalid/not-a-project' },
  malformedFromEnv: { VITE_SENTRY_DSN: 'http://publickey@example.invalid/1' },
};

describe('resolve-sentry-dsn.sh', () => {
  it('keeps a valid DSN from the environment without calling aws', () => {
    const r = run(SCENARIOS.fromEnv);
    expectSet(r);
    expect(r.awsLog).toBe('');
  });

  it('reads the String parameter from SSM without decryption', () => {
    const r = run(SCENARIOS.fromSsm);
    expectSet(r);
    expect(r.awsLog).toBe(
      'ssm get-parameter --name /developercards/prod/console-sentry-dsn --query Parameter.Value --output text --region ap-southeast-2\n',
    );
    expect(r.awsLog).not.toContain('decryption');

    // A blank environment value counts as unset and falls through to SSM.
    const blank = run(SCENARIOS.blankEnvFallsBackToSsm);
    expectSet(blank);
    expect(blank.awsLog).toContain('ssm get-parameter');

    // The region follows REGION (deploy.sh), then AWS_REGION.
    expect(run({ ...SCENARIOS.fromSsm, REGION: 'us-east-1' }).awsLog).toContain('--region us-east-1');
    expect(run({ ...SCENARIOS.fromSsm, AWS_REGION: 'eu-west-1' }).awsLog).toContain('--region eu-west-1');
  });

  it('honours CONSOLE_SENTRY_DSN_PARAM', () => {
    const r = run(SCENARIOS.customParam);
    expectSet(r);
    expect(r.awsLog).toContain('--name /example/other-dsn ');
    expect(r.awsLog).not.toContain('/developercards/prod/console-sentry-dsn');
  });

  it('leaves the DSN unset and exits 0 when SSM fails', () => {
    const r = run(SCENARIOS.ssmFails);
    expectUnset(r);
    expect(r.awsLog).toContain('ssm get-parameter');
  });

  it('rejects a malformed value', () => {
    const fromSsm = run(SCENARIOS.malformedFromSsm);
    expectUnset(fromSsm);
    expect(fromSsm.stderr).toContain('SSM parameter /developercards/prod/console-sentry-dsn');

    const fromEnv = run(SCENARIOS.malformedFromEnv);
    expectUnset(fromEnv);
    expect(fromEnv.stderr).toContain('environment');
    expect(fromEnv.awsLog).toBe('');
  });

  it('never prints the DSN', () => {
    for (const [name, vars] of Object.entries(SCENARIOS)) {
      const r = run(vars);
      const output = r.stdout + r.stderr;
      expect(output, name).not.toContain('publickey');
      expect(output, name).not.toContain('example.invalid');
    }
  });

  it('deploy.sh sources the resolver before npm run build', () => {
    const lines = readFileSync(join(FRONTEND, 'deploy.sh'), 'utf8').split('\n');
    const source = lines.findIndex(line =>
      /^(source|\.)\s+"?(\$HERE\/)?scripts\/resolve-sentry-dsn\.sh"?\s*$/.test(line),
    );
    const build = lines.findIndex(line => line.trim() === 'npm run build');
    const cd = lines.findIndex(line => line.includes('cd "$HERE"'));

    expect(source, 'deploy.sh does not source scripts/resolve-sentry-dsn.sh').toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(source).toBeLessThan(build);
    // A relative source path only works after deploy.sh has moved into its own directory.
    expect(cd).toBeGreaterThan(-1);
    expect(cd).toBeLessThan(source);
  });
});
