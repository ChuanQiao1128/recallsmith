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

describe('asc-release.cjs (source text only)', () => {
  it("defaults the release type to MANUAL", () => {
    expect(ascSource).toContain("releaseType: 'MANUAL'");
    expect(ascSource).not.toContain("releaseType: 'AFTER_APPROVAL'");
    expect(ascSource).toContain('[--release-type MANUAL|AFTER_APPROVAL]');
  });

  it('prints BLOCKED and exits 4 after reading the editable version and before building the plan', () => {
    expect(ascSource).toMatch(/require\('\.\/ascGuard\.cjs'\)/);
    const read = ascSource.indexOf('getEditAppStoreVersionAsync');
    const check = ascSource.indexOf('checkEditableVersion(');
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
});
