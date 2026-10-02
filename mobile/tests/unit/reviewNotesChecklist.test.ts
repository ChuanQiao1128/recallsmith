import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// R25 G02: App Review deletes the demo account when it follows the Delete account path, so the
// review notes for every version after 2.0.0 must name that path (scripts/release/README.md,
// "Review-notes checklist"). 2.0.0 and earlier were submitted before the rule and are left alone.
const RELEASE_DIR = resolve(__dirname, '../../scripts/release');
const README = readFileSync(resolve(RELEASE_DIR, 'README.md'), 'utf8');
const DELETE_PATH = 'Me > Settings > Account > Delete account';

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** review-notes-X.Y.Z.txt files whose version is strictly after 2.0.0. */
function reviewNotesAfter200(files: string[]): { file: string; version: string }[] {
  return files
    .map((f) => /^review-notes-(\d+\.\d+\.\d+)\.txt$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null && compareVersions(m[1], '2.0.0') > 0)
    .map((m) => ({ file: m[0], version: m[1] }));
}

describe('review-notes checklist: Delete account path', () => {
  it('selects only review-notes files for versions after 2.0.0', () => {
    const fixture = [
      'review-notes-1.9.0.txt',
      'review-notes-2.0.0.txt',
      'review-notes-2.0.1.txt',
      'review-notes-2.1.0.txt',
      'review-notes-10.0.0.txt',
      'review-notes-1.10.0.txt',
      'description-2.1.0.txt',
      'review-notes-2.1.txt',
      'review-notes-2.1.0.txt.bak',
    ];
    expect(reviewNotesAfter200(fixture).map((r) => r.version)).toEqual([
      '2.0.1',
      '2.1.0',
      '10.0.0',
    ]);
  });

  it('every review-notes file after 2.0.0 contains "Delete account"', () => {
    const files = reviewNotesAfter200(readdirSync(RELEASE_DIR));
    for (const { file } of files) {
      const text = readFileSync(resolve(RELEASE_DIR, file), 'utf8');
      expect(text, file).toContain('Delete account');
    }
  });

  it('the release README checklist names the Delete account path and the demo-account rebuild', () => {
    expect(README).toContain(DELETE_PATH);
    expect(README).toMatch(/permanently deletes the demo account/);
    expect(README).toMatch(/re-create it after review/);
  });
});
