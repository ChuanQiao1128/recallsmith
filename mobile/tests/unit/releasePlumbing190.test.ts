import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBE, waitUntilExecutable } from '../setup/execProbe';

// Each case spawns the real release script plus its node/fake-binary children (about ten
// processes). With the load average above 30 (parallel delivery workers) they took 3-8 s each,
// so vitest's 5 s default timed out cases whose assertions were green.
// The budget is explicit per spawn-heavy suite; every assertion is unchanged.
const SPAWN_TIMEOUT_MS = 30_000;

// 1.9.0 release plumbing (M04): eas.json Sentry env per profile, the version pins (2.0.0 (24) since R24B), the CI
// expo export step and the ios-build.sh placeholder guard. ios-build.sh only ever runs from a temp
// copy with fixture files, a fake eas first on PATH and DRY_RUN=1.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '../..');
const IOS_BUILD = path.join(MOBILE, 'scripts/release/ios-build.sh');
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(MOBILE, f), 'utf8'));

type Profile = { image?: string; ios?: { image?: string; env?: Record<string, string> } };
const eas = readJson('eas.json') as { build: Record<string, Profile> };
const iosEnv = (p: string) => eas.build[p]?.ios?.env ?? {};

// Profiles whose ios.image breaks the rule: production is `latest` or a non-empty pinned image name
// (trimmed), every other profile is `latest`.
function imagePolicyViolations(build: Record<string, Profile>): string[] {
  return Object.entries(build)
    .filter(([name, p]) => {
      const image = p.ios?.image;
      if (typeof image !== 'string') return false;
      if (name === 'production') return image.trim() !== image || image.length === 0;
      return image !== 'latest';
    })
    .map(([name]) => name);
}

describe('eas.json Sentry env (1.9.0)', () => {
  // Supervisor 2026-09-30 (M00 §9.2 #2): the Sentry org/project were created, so production carries the real,
  // non-secret slugs; the placeholder guard itself stays covered by the ios-build.sh cases below.
  it('production uploads source maps, a failed upload only warns, org/project are the real Sentry slugs', () => {
    expect(iosEnv('production')).toMatchObject({
      SENTRY_ALLOW_FAILURE: 'true',
      SENTRY_ORG: 'timeawake-limited',
      SENTRY_PROJECT: 'developercards-mobile',
    });
    expect(iosEnv('production').SENTRY_DISABLE_AUTO_UPLOAD).toBeUndefined();
  });

  it.each(['development', 'development-simulator', 'staging', 'staging-internal-release'])(
    '%s never uploads (SENTRY_DISABLE_AUTO_UPLOAD)',
    (p) => {
      expect(iosEnv(p).SENTRY_DISABLE_AUTO_UPLOAD).toBe('true');
    },
  );

  it('release-simulator carries an explicit env that never uploads', () => {
    expect(iosEnv('release-simulator')).toEqual({
      CLANG_CXX_LANGUAGE_STANDARD: 'c++17',
      CLANG_CXX_LIBRARY: 'libc++',
      EXPO_PUBLIC_ENV: 'production',
      SENTRY_DISABLE_AUTO_UPLOAD: 'true',
    });
  });

  it('holds no DSN or auth-token key anywhere', () => {
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === 'object') {
        for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
          keys.push(k);
          walk(child);
        }
      }
    };
    walk(eas);
    expect(keys.filter((k) => /DSN|AUTH_TOKEN/.test(k))).toEqual([]);
    expect(JSON.stringify(eas)).not.toMatch(/DSN|AUTH_TOKEN/);
  });

  // R19M-REL-4: M00 §9.2 #4 has the supervisor pin build.production.ios.image to build 22's image right
  // before the 1.9.0 build, so production may be `latest` or a non-empty pinned name; the rest stay `latest`.
  it('keeps every non-production EAS image at latest; production is latest or a pinned image name', () => {
    const images = Object.values(eas.build)
      .map((p) => p.ios?.image)
      .filter((i): i is string => typeof i === 'string');
    expect(images.length).toBe(5);
    expect(imagePolicyViolations(eas.build)).toEqual([]);
  });

  it('accepts a pinned production image and refuses a pinned non-production or empty production image', () => {
    const pinned = structuredClone(eas.build);
    pinned.production = { ...pinned.production, ios: { ...pinned.production?.ios, image: 'macos-sequoia-15.6-xcode-26.0' } };
    expect(imagePolicyViolations(pinned)).toEqual([]);
    const staging = structuredClone(eas.build);
    staging.staging = { ...staging.staging, ios: { ...staging.staging?.ios, image: 'macos-sequoia-15.6-xcode-26.0' } };
    expect(imagePolicyViolations(staging)).toEqual(['staging']);
    const empty = structuredClone(eas.build);
    empty.production = { ...empty.production, ios: { ...empty.production?.ios, image: ' ' } };
    expect(imagePolicyViolations(empty)).toEqual(['production']);
  });
});

// R24B R01: 2.0.0 (24) replaces the 1.9.0 (23) pins; the photo-library text drops "pull" (contract §1).
describe('version 2.0.0 (24)', () => {
  it('app.json is 2.0.0 build 24 with the Sentry plugin and the appVersion runtime policy', () => {
    const app = readJson('app.json').expo;
    expect(app.version).toBe('2.0.0');
    expect(app.ios.buildNumber).toBe('24');
    expect(app.runtimeVersion.policy).toBe('appVersion');
    expect(JSON.stringify(app.plugins)).toContain('@sentry/react-native/expo');
  });

  it('package.json and the lockfile root say 2.0.0', () => {
    expect(readJson('package.json').version).toBe('2.0.0');
    const lock = readJson('package-lock.json');
    expect(lock.version).toBe('2.0.0');
    expect(lock.packages[''].version).toBe('2.0.0');
  });

  it('the photo-library permission text says "a card image", not "a pull card image"', () => {
    const text = readJson('app.json').expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription;
    expect(text).toBe(
      'DeveloperCards saves a card image to your photo library when you choose Save Image in the share sheet.',
    );
    expect(text).not.toMatch(/\bpulls?\b/i);
  });
});

describe('CI mobile job', () => {
  it('ci.yml runs npx expo export --platform ios after vitest in the mobile job', () => {
    const ci = fs.readFileSync(path.resolve(MOBILE, '../.github/workflows/ci.yml'), 'utf8');
    const start = ci.indexOf('\n  mobile:');
    const end = ci.indexOf('\n  frontend:');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const job = ci.slice(start, end);
    expect(job).toContain('npx expo export --platform ios');
    expect(job.indexOf('npx vitest run')).toBeLessThan(job.indexOf('npx expo export --platform ios'));
  });
});

// The fake eas prints NAME=value lines whose value carries this marker; ios-build.sh must never
// surface it, because eas env:list reveals real secret values.
const MARKER = 'secret-value-do-not-print';
const SENTRY_NAMES = ['EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN'];
const OTHER_NAMES = ['EXPO_PUBLIC_API_BASE', 'EXPO_PUBLIC_RC_IOS_API_KEY'];

function runIosBuild(opts: { org: string; project: string; profile?: string; names?: string[]; bold?: boolean }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-build-tree-'));
  const mobile = path.join(root, 'mobile');
  const release = path.join(mobile, 'scripts', 'release');
  fs.mkdirSync(release, { recursive: true });
  fs.copyFileSync(IOS_BUILD, path.join(release, 'ios-build.sh'));
  fs.writeFileSync(path.join(mobile, 'app.json'), JSON.stringify({ expo: { version: '1.9.0', ios: { buildNumber: '23' } } }));
  fs.writeFileSync(
    path.join(mobile, 'eas.json'),
    JSON.stringify({ build: { production: { ios: { env: { SENTRY_ALLOW_FAILURE: 'true', SENTRY_ORG: opts.org, SENTRY_PROJECT: opts.project } } } } }),
  );
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const easLog = path.join(root, 'eas.log');
  const easErr = path.join(root, 'eas.stderr.log');
  // The fake keeps its own stderr in eas.stderr.log (ios-build.sh may discard it) so a failure shows why.
  fs.writeFileSync(
    path.join(bin, 'eas'),
    [
      '#!/usr/bin/env bash',
      `[ "$1" = ${PROBE} ] && exit 0`,
      `exec 2>> "${easErr}"`,
      `echo "$@" >> "${easLog}"`,
      'case "$1" in',
      '  env:list)',
      '    for n in $FAKE_EAS_NAMES; do',
      // eas-cli prints chalk.bold(name)=value; with colour forced the name carries ANSI codes.
      `      if [ -n "\${FAKE_EAS_BOLD:-}" ]; then printf '\\033[1m%s\\033[22m=%s\\n' "$n" "${MARKER}"; else echo "$n=${MARKER}"; fi`,
      '    done ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  );
  fs.chmodSync(path.join(bin, 'eas'), 0o755);
  waitUntilExecutable(path.join(bin, 'eas'));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('SENTRY_') || k === 'EXPO_PUBLIC_SENTRY_DSN') delete env[k];
  env.PATH = `${bin}:${process.env.PATH ?? ''}`;
  env.DRY_RUN = '1';
  env.FAKE_EAS_NAMES = (opts.names ?? [...OTHER_NAMES, ...SENTRY_NAMES]).join(' ');
  if (opts.bold) env.FAKE_EAS_BOLD = '1';
  const args = [path.join(release, 'ios-build.sh')];
  if (opts.profile) args.push(opts.profile);
  const res = spawnSync('bash', args, { env, encoding: 'utf8' });
  const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const log = read(easLog);
  // Printed by a failing status assertion: the script's output plus the fake's argv and stderr logs.
  const diag = [
    `status=${String(res.status)} signal=${String(res.signal)} error=${String(res.error ?? '')}`,
    `stdout:\n${res.stdout}`,
    `stderr:\n${res.stderr}`,
    `eas argv log:\n${log}`,
    `eas stderr log:\n${read(easErr)}`,
  ].join('\n');
  return { res, log, diag };
}

describe('ios-build.sh Sentry placeholder guard', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('exits 5 with the fill message while production org/project are placeholders (DRY_RUN=1)', () => {
    const { res, log, diag } = runIosBuild({ org: 'REPLACE_ME_SENTRY_ORG', project: 'REPLACE_ME_SENTRY_PROJECT' });
    expect(res.status, diag).toBe(5);
    expect(res.stderr).toContain('ios-build: fill SENTRY_ORG/SENTRY_PROJECT in eas.json (production) before a store build');
    expect(log).toBe('');
  });

  it('exits 5 when only one of org/project is filled or one is empty', () => {
    const a = runIosBuild({ org: 'example-org', project: 'REPLACE_ME_SENTRY_PROJECT' });
    expect(a.res.status, a.diag).toBe(5);
    const b = runIosBuild({ org: '', project: 'example-project' });
    expect(b.res.status, b.diag).toBe(5);
  });

  it('passes the guard with example-org/example-project and prints the DRY command', () => {
    const { res, diag } = runIosBuild({ org: 'example-org', project: 'example-project' });
    expect(res.status, diag).toBe(0);
    expect(res.stdout).toContain('DRY: eas build --platform ios --profile production');
  });

  it('does not apply the guard to a non-production profile', () => {
    const { res, diag } = runIosBuild({ org: 'REPLACE_ME_SENTRY_ORG', project: 'REPLACE_ME_SENTRY_PROJECT', profile: 'staging' });
    expect(res.status, diag).toBe(0);
    expect(res.stdout).toContain('DRY: eas build --platform ios --profile staging');
  });
});

// R19M-REL-3: a production build (DRY_RUN included) needs the EXPO_PUBLIC_SENTRY_DSN and SENTRY_AUTH_TOKEN
// names in the EAS production environment; otherwise Sentry never initialises and SENTRY_ALLOW_FAILURE
// turns the tokenless dSYM/source-map upload into a warning. The check reads names only.
describe('ios-build.sh EAS production env names', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it.each(SENTRY_NAMES)('exits 3 naming %s when it is missing from the production environment (DRY_RUN=1)', (name) => {
    const names = [...OTHER_NAMES, ...SENTRY_NAMES.filter((n) => n !== name)];
    const { res, log, diag } = runIosBuild({ org: 'example-org', project: 'example-project', names });
    expect(res.status, diag).toBe(3);
    expect(res.stderr).toContain(`ios-build: missing name(s) in the EAS production environment: ${name}`);
    expect(log).toContain('env:list --environment production --format short');
    expect(log).not.toContain('build');
    expect(res.stdout).not.toContain('DRY: eas build');
    expect(`${res.stdout}${res.stderr}`).not.toContain(MARKER);
  });

  it('lists both names when neither is set', () => {
    const { res, diag } = runIosBuild({ org: 'example-org', project: 'example-project', names: OTHER_NAMES });
    expect(res.status, diag).toBe(3);
    expect(res.stderr).toContain('ios-build: missing name(s) in the EAS production environment: EXPO_PUBLIC_SENTRY_DSN SENTRY_AUTH_TOKEN');
    expect(`${res.stdout}${res.stderr}`).not.toContain(MARKER);
  });

  it('a name that only appears inside a value does not count', () => {
    const { res, diag } = runIosBuild({
      org: 'example-org',
      project: 'example-project',
      names: [...OTHER_NAMES, 'EXPO_PUBLIC_SENTRY_DSN', 'OTHER_NOTE=SENTRY_AUTH_TOKEN'],
    });
    expect(res.status, diag).toBe(3);
    expect(res.stderr).toContain('SENTRY_AUTH_TOKEN');
  });

  it('passes with both names present and never prints values', () => {
    const { res, log, diag } = runIosBuild({ org: 'example-org', project: 'example-project' });
    expect(res.status, diag).toBe(0);
    expect(log).toContain('env:list --environment production --format short');
    expect(res.stdout).toContain('DRY: eas build --platform ios --profile production');
    expect(`${res.stdout}${res.stderr}`).not.toContain(MARKER);
  });

  it('reads names printed in bold (ANSI codes) and still never prints values', () => {
    const ok = runIosBuild({ org: 'example-org', project: 'example-project', bold: true });
    expect(ok.res.status, ok.diag).toBe(0);
    const missing = runIosBuild({ org: 'example-org', project: 'example-project', names: [...OTHER_NAMES, 'SENTRY_AUTH_TOKEN'], bold: true });
    expect(missing.res.status, missing.diag).toBe(3);
    expect(missing.res.stderr).toContain('missing name(s) in the EAS production environment: EXPO_PUBLIC_SENTRY_DSN');
    expect(`${missing.res.stdout}${missing.res.stderr}`).not.toContain(MARKER);
  });

  it('a non-production profile does not read the production environment', () => {
    const { res, log, diag } = runIosBuild({ org: 'example-org', project: 'example-project', profile: 'staging', names: [] });
    expect(res.status, diag).toBe(0);
    expect(log).not.toContain('env:list');
  });
});
