import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ascGuard.cjs is pure, so it is required directly. asc-release.cjs talks to App Store Connect and is
// never required or run here: its default and guard placement are read from the source text.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.resolve(HERE, '../../scripts/release');
const requireCjs = createRequire(import.meta.url);

type GuardResult = { ok: boolean; reason?: string; state?: string };
const guard = requireCjs(path.join(RELEASE_DIR, 'ascGuard.cjs')) as {
  BLOCKED_EDIT_STATES: string[];
  checkEditableVersion: (attrs: Record<string, unknown> | null | undefined, target: string) => GuardResult;
  firstHeldVersion: (
    versions: Array<Record<string, unknown> | null | undefined>,
    target: string,
  ) => GuardResult & { versionString?: string };
};
const ascSource = fs.readFileSync(path.join(RELEASE_DIR, 'asc-release.cjs'), 'utf8');

const BLOCKED = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE'];

describe('ascGuard.checkEditableVersion', () => {
  it('lists exactly the three states App Review holds', () => {
    expect(guard.BLOCKED_EDIT_STATES).toEqual(BLOCKED);
  });

  it.each(BLOCKED)('refuses %s via appVersionState', (state) => {
    const r = guard.checkEditableVersion({ versionString: '1.8.0', appVersionState: state }, '1.9.0');
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
    expect(r.reason?.length).toBeGreaterThan(0);
  });

  it.each(BLOCKED)('refuses %s via appStoreState', (state) => {
    const r = guard.checkEditableVersion({ versionString: '1.8.0', appStoreState: state }, '1.9.0');
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
  });

  it.each(['READY_FOR_SALE', 'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'])('lets %s pass', (state) => {
    expect(guard.checkEditableVersion({ versionString: '1.9.0', appVersionState: state, appStoreState: state }, '1.9.0')).toEqual({ ok: true });
  });

  it('lets a missing editable version (null or undefined) pass', () => {
    expect(guard.checkEditableVersion(null, '1.9.0')).toEqual({ ok: true });
    expect(guard.checkEditableVersion(undefined, '1.9.0')).toEqual({ ok: true });
  });
});

// R19M-REL-2: getEditAppStoreVersionAsync never returns IN_REVIEW or PENDING_*_RELEASE versions (its
// appStoreState filter excludes them), so asc-release.cjs also reads the in-review and pending-release
// versions and runs every non-null one through firstHeldVersion.
describe('ascGuard.firstHeldVersion', () => {
  it('lets no versions at all (all null) pass', () => {
    expect(guard.firstHeldVersion([null, null, undefined], '1.9.0')).toEqual({ ok: true });
    expect(guard.firstHeldVersion([], '1.9.0')).toEqual({ ok: true });
  });

  it('refuses when the edit version is null but 1.8.0 is IN_REVIEW', () => {
    const inReview = { versionString: '1.8.0', appVersionState: 'IN_REVIEW', appStoreState: 'IN_REVIEW' };
    const r = guard.firstHeldVersion([null, inReview, null], '1.9.0');
    expect(r.ok).toBe(false);
    expect(r.state).toBe('IN_REVIEW');
    expect(r.versionString).toBe('1.8.0');
    expect(r.reason?.length).toBeGreaterThan(0);
  });

  it('refuses when the edit version is null but 1.8.0 is PENDING_DEVELOPER_RELEASE', () => {
    const pending = { versionString: '1.8.0', appVersionState: 'PENDING_DEVELOPER_RELEASE', appStoreState: 'PENDING_DEVELOPER_RELEASE' };
    const r = guard.firstHeldVersion([null, null, pending], '1.9.0');
    expect(r.ok).toBe(false);
    expect(r.state).toBe('PENDING_DEVELOPER_RELEASE');
    expect(r.versionString).toBe('1.8.0');
  });

  it('refuses when an editable 1.9.0 exists but 1.8.0 is still in review', () => {
    const edit = { versionString: '1.9.0', appVersionState: 'PREPARE_FOR_SUBMISSION', appStoreState: 'PREPARE_FOR_SUBMISSION' };
    const inReview = { versionString: '1.8.0', appStoreState: 'IN_REVIEW' };
    const r = guard.firstHeldVersion([edit, inReview, null], '1.9.0');
    expect(r.ok).toBe(false);
    expect(r.versionString).toBe('1.8.0');
  });

  it('lets an editable PREPARE_FOR_SUBMISSION version pass when nothing is in review or pending', () => {
    const edit = { versionString: '1.9.0', appVersionState: 'PREPARE_FOR_SUBMISSION', appStoreState: 'PREPARE_FOR_SUBMISSION' };
    expect(guard.firstHeldVersion([edit, null, null], '1.9.0')).toEqual({ ok: true });
  });

  it('agrees with checkEditableVersion for every single version', () => {
    for (const state of [...BLOCKED, 'READY_FOR_SALE', 'PREPARE_FOR_SUBMISSION']) {
      const attrs = { versionString: '1.8.0', appVersionState: state };
      expect(guard.firstHeldVersion([attrs], '1.9.0').ok).toBe(guard.checkEditableVersion(attrs, '1.9.0').ok);
    }
  });
});

describe('asc-release.cjs (source text only)', () => {
  it("defaults the release type to MANUAL", () => {
    expect(ascSource).toContain("releaseType: 'MANUAL'");
    expect(ascSource).not.toContain("releaseType: 'AFTER_APPROVAL'");
    expect(ascSource).toContain('[--release-type MANUAL|AFTER_APPROVAL]');
  });

  it('prints BLOCKED and exits 4 after reading the editable version and before building the plan', () => {
    expect(ascSource).toMatch(/require\('\.\/ascGuard\.cjs'\)/);
    const read = ascSource.indexOf('getEditAppStoreVersionAsync');
    // R19M-REL-2: the guard now runs through firstHeldVersion (which applies checkEditableVersion to
    // each version) so that in-review and pending-release versions are checked too.
    const check = ascSource.indexOf('firstHeldVersion(');
    const blocked = ascSource.indexOf("'BLOCKED '");
    const exit4 = ascSource.indexOf('process.exit(4)');
    const plan = ascSource.indexOf('const plan = [];');
    expect(read).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(-1);
    expect(read).toBeLessThan(check);
    expect(check).toBeLessThan(blocked);
    expect(blocked).toBeLessThan(exit4);
    expect(exit4).toBeLessThan(plan);
  });

  it('also reads the in-review and pending-release versions and guards them before building the plan', () => {
    const inReview = ascSource.indexOf('app.getInReviewAppStoreVersionAsync(');
    const pending = ascSource.indexOf('app.getPendingReleaseAppStoreVersionAsync(');
    const check = ascSource.indexOf('firstHeldVersion(');
    const plan = ascSource.indexOf('const plan = [];');
    expect(inReview).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(-1);
    expect(inReview).toBeLessThan(check);
    expect(pending).toBeLessThan(check);
    expect(check).toBeLessThan(plan);
    expect(ascSource).toMatch(/firstHeldVersion\(\s*\[\s*version\s*,\s*inReview\s*,\s*pending\s*\]/);
  });
});
