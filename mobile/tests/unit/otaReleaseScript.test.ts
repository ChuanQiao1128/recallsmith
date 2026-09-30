import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBE, waitUntilExecutable } from '../setup/execProbe';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OTA = path.resolve(HERE, '../../scripts/release/ota.sh');
const ALL_NAMES = [
  'EXPO_PUBLIC_API_BASE',
  'EXPO_PUBLIC_AWS_REGION',
  'EXPO_PUBLIC_COGNITO_USER_POOL_ID',
  'EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID',
  'EXPO_PUBLIC_RC_IOS_API_KEY',
  'EXPO_PUBLIC_SENTRY_DSN',
];

// The fake eas prints values that all contain this marker; ota.sh must never
// surface it, because eas env:list reveals real secret values.
const MARKER = 'secret-value-do-not-print';

// Legacy cases run the real ota.sh in the real mobile/ tree, whose eas.json carries the real Sentry slugs, so
// every external binary the script can reach is faked (R19M-REL-1): `eas` answers the three subcommands
// ota.sh uses: whoami (logged in), env:list (NAME=value lines whose value carries the marker, names driven
// by FAKE_EAS_NAMES), and update (records its args + EXPO_PUBLIC_ENV to FAKE_EAS_LOG instead of
// publishing); `npx` and `security` only log their argv. Every fake appends its argv to its own log and
// keeps its stderr in a file, so an unexpected status can be diagnosed (R19M-REL-7).
function makeFakeEasDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-fake-eas-'));
  const eas = path.join(dir, 'eas');
  fs.writeFileSync(
    eas,
    [
      '#!/usr/bin/env bash',
      `[ "$1" = ${PROBE} ] && exit 0`,
      `exec 2>> "${path.join(dir, 'eas.stderr.log')}"`,
      `echo "$@" >> "${path.join(dir, 'eas.argv.log')}"`,
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
  waitUntilExecutable(eas);
  for (const name of ['npx', 'security']) {
    const file = path.join(dir, name);
    fs.writeFileSync(
      file,
      ['#!/usr/bin/env bash', `[ "$1" = ${PROBE} ] && exit 0`, `echo "$*" >> "${path.join(dir, `${name}.log`)}"`, 'exit 0', ''].join('\n'),
    );
    fs.chmodSync(file, 0o755);
    waitUntilExecutable(file);
  }
  return dir;
}

// Every SENTRY_* name, OTA_KEYCHAIN*, EXPO_PUBLIC_SENTRY_DSN and DRY_RUN from the developer's shell is
// dropped, and OTA_KEYCHAIN=0 keeps ota.sh away from the Keychain even when stdin is a terminal.
function isolatedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('SENTRY_') || k.startsWith('OTA_KEYCHAIN') || k === 'EXPO_PUBLIC_SENTRY_DSN' || k === 'DRY_RUN') delete env[k];
  }
  env.OTA_KEYCHAIN = '0';
  return env;
}

const readLog = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

// Printed by a failing status assertion: the script's output and every fake's argv/stderr log.
function diagnose(res: ReturnType<typeof spawnSync>, logs: Record<string, string>): string {
  return [
    `status=${String(res.status)} signal=${String(res.signal)} error=${String(res.error ?? '')}`,
    `stdout:\n${String(res.stdout)}`,
    `stderr:\n${String(res.stderr)}`,
    ...Object.entries(logs).map(([name, text]) => `${name}:\n${text}`),
  ].join('\n');
}

function runOta(opts: { names: string[]; dryRun?: boolean }) {
  const dir = makeFakeEasDir();
  const logPath = path.join(dir, 'eas.log');
  const env: NodeJS.ProcessEnv = {
    ...isolatedEnv(),
    PATH: `${dir}:${process.env.PATH ?? ''}`,
    FAKE_EAS_LOG: logPath,
    FAKE_EAS_NAMES: opts.names.join(' '),
  };
  if (opts.dryRun) env.DRY_RUN = '1';
  const res = spawnSync('bash', [OTA, 'test message'], { env, encoding: 'utf8' });
  const log = readLog(logPath);
  const npx = readLog(path.join(dir, 'npx.log'));
  const security = readLog(path.join(dir, 'security.log'));
  const diag = diagnose(res, {
    'eas update log': log,
    'eas argv log': readLog(path.join(dir, 'eas.argv.log')),
    'eas stderr log': readLog(path.join(dir, 'eas.stderr.log')),
    'npx log': npx,
    'security log': security,
  });
  return { res, log, npx, security, diag };
}

describe('ota.sh', () => {
  it('refuses to publish when a required EXPO_PUBLIC name is missing from the production environment', () => {
    const names = ALL_NAMES.filter((n) => n !== 'EXPO_PUBLIC_RC_IOS_API_KEY');
    const { res, log, diag } = runOta({ names });
    expect(res.status, diag).toBe(3);
    expect(res.stderr).toContain('EXPO_PUBLIC_RC_IOS_API_KEY');
    expect(log).not.toContain('update');
  });

  it('publishes to channel production with --environment production and never prints values', () => {
    const { res, log, diag } = runOta({ names: ALL_NAMES });
    expect(res.status, diag).toBe(0);
    expect(log).toContain('--channel production');
    expect(log).toContain('--environment production');
    expect(log).toContain('--platform ios');
    expect(log).toContain('EXPO_PUBLIC_ENV=production');
    expect(`${res.stdout}${res.stderr}`).not.toContain(MARKER);
  });

  it('DRY_RUN=1 checks the names and prints the command without publishing', () => {
    const { res, log, diag } = runOta({ names: ALL_NAMES, dryRun: true });
    expect(res.status, diag).toBe(0);
    expect(res.stdout).toContain('DRY: eas update --channel production --environment production');
    expect(log).not.toContain('update');
  });

  // R19M-REL-1: the real tree's eas.json names the real Sentry org/project, so a token or OTA_KEYCHAIN=1
  // exported in the developer's shell used to reach the real Keychain and the real source-map upload.
  it.each([false, true])('a token and OTA_KEYCHAIN=1 in the shell reach neither npx nor security (DRY_RUN=%s)', (dryRun) => {
    const saved = { token: process.env.SENTRY_AUTH_TOKEN, keychain: process.env.OTA_KEYCHAIN };
    process.env.SENTRY_AUTH_TOKEN = 'fake-sentry-token-not-real';
    process.env.OTA_KEYCHAIN = '1';
    try {
      const { res, npx, security, diag } = runOta({ names: ALL_NAMES, dryRun });
      expect(res.status, diag).toBe(0);
      expect(res.stdout, diag).toContain(dryRun ? 'DRY: SENTRY_UPLOAD=skipped-no-token' : 'SENTRY_UPLOAD=skipped-no-token');
      expect(res.stdout).not.toContain('SENTRY_TOKEN_SOURCE');
      expect(npx).toBe('');
      expect(security).toBe('');
      expect(`${res.stdout}${res.stderr}`).not.toContain('fake-sentry-token-not-real');
    } finally {
      if (saved.token === undefined) delete process.env.SENTRY_AUTH_TOKEN;
      else process.env.SENTRY_AUTH_TOKEN = saved.token;
      if (saved.keychain === undefined) delete process.env.OTA_KEYCHAIN;
      else process.env.OTA_KEYCHAIN = saved.keychain;
    }
  });

  it('puts fake npx and security first on PATH for the legacy cases', () => {
    const dir = makeFakeEasDir();
    for (const name of ['eas', 'npx', 'security']) {
      const r = spawnSync('bash', ['-c', `command -v ${name}`], { env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` }, encoding: 'utf8' });
      expect(r.stdout.trim()).toBe(path.join(dir, name));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 1.9.0 release plumbing (M04): runtime guard, DSN name rule and the Sentry source-map upload.
// Each case copies ota.sh into a temp mobile/scripts/release/ tree with fixture app.json,
// package.json and eas.json, and puts fake eas, npx and security binaries first on PATH, so the
// real CLIs and the real Keychain are never touched. The env starts from process.env with every
// SENTRY_* name, EXPO_PUBLIC_SENTRY_DSN, OTA_KEYCHAIN* and DRY_RUN removed.

type TreeOpts = {
  version: string;
  sentryDependency?: boolean;
  org?: string;
  project?: string;
  names: string[];
  env?: Record<string, string>;
  npxExit?: number;
};

function writeExecutable(file: string, lines: string[]) {
  const [shebang, ...rest] = lines;
  fs.writeFileSync(file, [shebang, `[ "$1" = ${PROBE} ] && exit 0`, ...rest, ''].join('\n'));
  fs.chmodSync(file, 0o755);
  waitUntilExecutable(file);
}

function runOtaTree(opts: TreeOpts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-tree-'));
  const mobile = path.join(root, 'mobile');
  const release = path.join(mobile, 'scripts', 'release');
  fs.mkdirSync(release, { recursive: true });
  fs.copyFileSync(OTA, path.join(release, 'ota.sh'));
  fs.writeFileSync(
    path.join(mobile, 'app.json'),
    JSON.stringify({ expo: { version: opts.version, runtimeVersion: { policy: 'appVersion' } } }),
  );
  const dependencies: Record<string, string> = { expo: '~54.0.0' };
  if (opts.sentryDependency) dependencies['@sentry/react-native'] = '~7.2.0';
  fs.writeFileSync(path.join(mobile, 'package.json'), JSON.stringify({ name: 'mobile', version: opts.version, dependencies }));
  fs.writeFileSync(
    path.join(mobile, 'eas.json'),
    JSON.stringify({
      build: {
        production: {
          ios: {
            env: {
              EXPO_PUBLIC_ENV: 'production',
              SENTRY_ALLOW_FAILURE: 'true',
              SENTRY_ORG: opts.org ?? 'REPLACE_ME_SENTRY_ORG',
              SENTRY_PROJECT: opts.project ?? 'REPLACE_ME_SENTRY_PROJECT',
            },
          },
        },
      },
    }),
  );

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const easLog = path.join(root, 'eas.log');
  const npxLog = path.join(root, 'npx.log');
  const securityLog = path.join(root, 'security.log');
  const easErr = path.join(root, 'eas.stderr.log');
  writeExecutable(path.join(bin, 'eas'), [
    '#!/usr/bin/env bash',
    `exec 2>> "${easErr}"`,
    `echo "$@" >> "${easLog}"`,
    'case "$1" in',
    '  whoami) exit 0 ;;',
    `  env:list) for n in $FAKE_EAS_NAMES; do echo "$n=${MARKER}"; done ;;`,
    '  update) exit 0 ;;',
    'esac',
  ]);
  // Records its argv, SENTRY_ORG/SENTRY_PROJECT and only whether a token is set (never the value).
  writeExecutable(path.join(bin, 'npx'), [
    '#!/usr/bin/env bash',
    `echo "argv=$*" >> "${npxLog}"`,
    `echo "org=\${SENTRY_ORG:-} project=\${SENTRY_PROJECT:-}" >> "${npxLog}"`,
    `if [ -n "\${SENTRY_AUTH_TOKEN:-}" ]; then echo "token=set" >> "${npxLog}"; else echo "token=unset" >> "${npxLog}"; fi`,
    `exit ${opts.npxExit ?? 0}`,
  ]);
  writeExecutable(path.join(bin, 'security'), [
    '#!/usr/bin/env bash',
    `echo "$*" >> "${securityLog}"`,
    'if [ "$*" = "find-generic-password -s developercards-sentry-auth-token -w" ]; then',
    "  echo 'fake-sentry-token-not-real'",
    '  exit 0',
    'fi',
    'exit 44',
  ]);

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('SENTRY_') || k.startsWith('OTA_KEYCHAIN') || k === 'EXPO_PUBLIC_SENTRY_DSN' || k === 'DRY_RUN') delete env[k];
  }
  env.PATH = `${bin}:${process.env.PATH ?? ''}`;
  env.FAKE_EAS_NAMES = opts.names.join(' ');
  Object.assign(env, opts.env ?? {});

  const res = spawnSync('bash', [path.join(release, 'ota.sh'), 'test message'], { env, encoding: 'utf8' });
  const out = `${res.stdout}${res.stderr}`;
  const logs = { eas: readLog(easLog), npx: readLog(npxLog), security: readLog(securityLog) };
  const diag = diagnose(res, {
    'eas argv log': logs.eas,
    'eas stderr log': readLog(easErr),
    'npx log': logs.npx,
    'security log': logs.security,
  });
  return { res, out, ...logs, diag };
}

const NAMES_180 = ALL_NAMES.filter((n) => n !== 'EXPO_PUBLIC_SENTRY_DSN');

describe('ota.sh 1.9.0 release plumbing', () => {
  it('runtime 1.9.0 without EXPO_PUBLIC_SENTRY_DSN refuses to publish (exit 3)', () => {
    const r = runOtaTree({ version: '1.9.0', sentryDependency: true, names: NAMES_180 });
    expect(r.res.status, r.diag).toBe(3);
    expect(r.res.stderr).toContain('EXPO_PUBLIC_SENTRY_DSN');
    expect(r.eas).not.toContain('update');
    expect(r.npx).toBe('');
  });

  it('runtime 1.8.0 without the DSN name publishes and skips the upload (skipped-runtime)', () => {
    const r = runOtaTree({ version: '1.8.0', names: NAMES_180, env: { SENTRY_AUTH_TOKEN: 'fake-sentry-token-not-real' } });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.eas).toContain('update --channel production --environment production --platform ios');
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=skipped-runtime');
    expect(r.npx).toBe('');
    expect(r.out).not.toContain('fake-sentry-token-not-real');
  });

  it('runtime 1.8.0 with @sentry/react-native in dependencies exits 6 before any eas call', () => {
    const r = runOtaTree({ version: '1.8.0', sentryDependency: true, names: ALL_NAMES });
    expect(r.res.status, r.diag).toBe(6);
    expect(r.res.stderr).toContain('ota: runtime 1.8.0 has no RNSentry native module; publish runtime-1.8.0 OTAs from its release branch');
    expect(r.eas).not.toContain('update');
    expect(r.eas).toBe('');
  });

  it('1.9.0 with a token and example-org/example-project uploads the source maps (SENTRY_UPLOAD=ok)', () => {
    const r = runOtaTree({
      version: '1.9.0',
      sentryDependency: true,
      org: 'example-org',
      project: 'example-project',
      names: ALL_NAMES,
      env: { SENTRY_AUTH_TOKEN: 'fake-sentry-token-not-real' },
    });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.eas).toContain('update --channel production');
    expect(r.npx).toContain('argv=sentry-expo-upload-sourcemaps dist');
    expect(r.npx).toContain('org=example-org project=example-project');
    expect(r.npx).toContain('token=set');
    expect(r.res.stdout).toContain('SENTRY_TOKEN_SOURCE=env');
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=ok');
    expect(r.security).toBe('');
    expect(r.out).not.toContain('fake-sentry-token-not-real');
    expect(r.out).not.toContain(MARKER);
  });

  it('SENTRY_ORG/SENTRY_PROJECT from the environment win over the eas.json placeholders', () => {
    const r = runOtaTree({
      version: '1.9.0',
      sentryDependency: true,
      names: ALL_NAMES,
      env: { SENTRY_AUTH_TOKEN: 'fake-sentry-token-not-real', SENTRY_ORG: 'example-org', SENTRY_PROJECT: 'example-project' },
    });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.npx).toContain('org=example-org project=example-project');
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=ok');
    expect(r.out).not.toContain('fake-sentry-token-not-real');
  });

  it('1.9.0 without a token publishes and reports skipped-no-token', () => {
    const r = runOtaTree({ version: '1.9.0', sentryDependency: true, org: 'example-org', project: 'example-project', names: ALL_NAMES });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.eas).toContain('update --channel production');
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=skipped-no-token');
    expect(r.npx).toBe('');
  });

  it('placeholders report skipped-no-project before any token lookup (security never called)', () => {
    const r = runOtaTree({ version: '1.9.0', sentryDependency: true, names: ALL_NAMES, env: { OTA_KEYCHAIN: '1' } });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=skipped-no-project');
    expect(r.security).toBe('');
    expect(r.npx).toBe('');
  });

  it('OTA_KEYCHAIN=1 without an env token reads the Keychain item and uploads (SENTRY_TOKEN_SOURCE=keychain)', () => {
    const r = runOtaTree({
      version: '1.9.0',
      sentryDependency: true,
      org: 'example-org',
      project: 'example-project',
      names: ALL_NAMES,
      env: { OTA_KEYCHAIN: '1' },
    });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.security.trim()).toBe('find-generic-password -s developercards-sentry-auth-token -w');
    expect(r.npx).toContain('argv=sentry-expo-upload-sourcemaps dist');
    expect(r.npx).toContain('token=set');
    expect(r.res.stdout).toContain('SENTRY_TOKEN_SOURCE=keychain');
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=ok');
    expect(r.out).not.toContain('fake-sentry-token-not-real');
  });

  it('OTA_KEYCHAIN=0 never calls security and reports skipped-no-token', () => {
    const r = runOtaTree({
      version: '1.9.0',
      sentryDependency: true,
      org: 'example-org',
      project: 'example-project',
      names: ALL_NAMES,
      env: { OTA_KEYCHAIN: '0' },
    });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.security).toBe('');
    expect(r.npx).toBe('');
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=skipped-no-token');
  });

  it('without OTA_KEYCHAIN a spawned run (stdin not a TTY) never calls security', () => {
    const r = runOtaTree({ version: '1.9.0', sentryDependency: true, org: 'example-org', project: 'example-project', names: ALL_NAMES });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.security).toBe('');
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=skipped-no-token');
  });

  it('a failing upload reports SENTRY_UPLOAD=failed with a re-run hint and still exits 0', () => {
    const r = runOtaTree({
      version: '1.9.0',
      sentryDependency: true,
      org: 'example-org',
      project: 'example-project',
      names: ALL_NAMES,
      env: { SENTRY_AUTH_TOKEN: 'fake-sentry-token-not-real' },
      npxExit: 1,
    });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.res.stdout).toContain('SENTRY_UPLOAD=failed');
    expect(r.res.stderr).toContain('npx sentry-expo-upload-sourcemaps dist');
    expect(r.out).not.toContain('fake-sentry-token-not-real');
  });

  it('DRY_RUN=1 never calls update or npx and prints the planned upload', () => {
    const r = runOtaTree({
      version: '1.9.0',
      sentryDependency: true,
      org: 'example-org',
      project: 'example-project',
      names: ALL_NAMES,
      env: { SENTRY_AUTH_TOKEN: 'fake-sentry-token-not-real', DRY_RUN: '1' },
    });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.res.stdout).toContain('DRY: eas update --channel production --environment production');
    expect(r.res.stdout).toContain('DRY: SENTRY_UPLOAD=ok-planned');
    expect(r.res.stdout).toContain('DRY: npx sentry-expo-upload-sourcemaps dist');
    expect(r.eas).not.toContain('update');
    expect(r.npx).toBe('');
    expect(r.out).not.toContain('fake-sentry-token-not-real');
  });

  it('DRY_RUN=1 with placeholders plans skipped-no-project', () => {
    const r = runOtaTree({ version: '1.9.0', sentryDependency: true, names: ALL_NAMES, env: { DRY_RUN: '1' } });
    expect(r.res.status, r.diag).toBe(0);
    expect(r.res.stdout).toContain('DRY: SENTRY_UPLOAD=skipped-no-project');
    expect(r.res.stdout).not.toContain('DRY: npx');
    expect(r.eas).not.toContain('update');
    expect(r.npx).toBe('');
  });
});
