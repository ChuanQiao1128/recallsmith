// The root README points at real files by path. This checks the paths resolve.
//
// Same reasoning as consolePlanDoc.test.ts, applied to the file a stranger reads
// first: a README that names `src_C/Worker/WorkerFunction.cs` stays exactly as
// convincing after that file is renamed or moved, and nothing else in the
// toolchain reads prose. The paths are the half of a README that can be checked
// mechanically, so they are.
//
// It deliberately does not check the surrounding claims — only that each cited
// path is on disk, which is the weakest thing that can still fail.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const README = fileURLToPath(new URL('../../README.md', import.meta.url));

// No `snowflake`: the folder was deleted when the warehouse path was retired on
// 2026-10-02, and the README now only describes that retirement in prose.
const TOP_LEVEL = ['frontend', 'mobile', 'src_C', 'pg-layer', 'docs', '.github'];

/** Every backticked repo-relative path the README mentions, deduplicated. */
function citedPaths(markdown: string): string[] {
  const pattern = new RegExp('`((?:' + TOP_LEVEL.join('|') + ')/[A-Za-z0-9._/-]+)`', 'g');
  const matches = [...markdown.matchAll(pattern)].map(m => m[1]);
  return [...new Set(matches)].sort();
}

describe('the root README', () => {
  it('is on disk', () => {
    expect(existsSync(README)).toBe(true);
  });

  it('only cites repository paths that exist', () => {
    const cited = citedPaths(readFileSync(README, 'utf8'));

    // Hardcoded, and NOT derived from `cited` — a floor computed from the thing
    // it is checking passes vacuously the moment the regex stops matching, which
    // is the exact bug hookWiring.test.ts records for its own barrel assertion.
    expect(cited.length).toBeGreaterThanOrEqual(12);

    const missing = cited.filter(path => !existsSync(new URL(path, `file://${REPO_ROOT}`)));
    expect(missing).toEqual([]);
  });

  it('records that Snowflake was retired, and the folder is really gone', () => {
    // The README used to describe a Snowflake pipeline and a snowflake/ folder.
    // Both were retired on 2026-10-02; a README still selling them would be the
    // kind of confident, stale claim this file exists to catch.
    const markdown = readFileSync(README, 'utf8');

    expect(existsSync(`${REPO_ROOT}snowflake`)).toBe(false);
    expect(markdown).not.toMatch(/`snowflake\//);
    expect(markdown).toMatch(/Snowflake[^\n]*retired[^\n]*2026-10-02|2026-10-02[^\n]*retired[^\n]*Snowflake/);
  });

  it('explains the retirement in §1, and leaves the outbox table to migration 045', () => {
    // The intro sentence carries the date as well, so the date alone does not
    // prove the explanation is still there. This finds the §1 paragraph and
    // asks for its reasons.
    const markdown = readFileSync(README, 'utf8');
    const paragraph = markdown.split(/\n\s*\n/).find(p => p.startsWith('Snowflake was retired on 2026-10-02')) ?? '';

    for (const reason of ['trial', 'analytics_daily', 'unsalted']) {
      expect(paragraph, reason).toContain(reason);
    }

    // The table and its rows stay in production until the owner runs 045, so
    // the sentence about the outbox table has to say that, not that it is gone.
    const outboxSentences = paragraph.replace(/\s+/g, ' ').split(/(?<=\.) /).filter(s => s.includes('outbox table'));
    expect(outboxSentences.length).toBeGreaterThanOrEqual(1);
    for (const sentence of outboxSentences) {
      expect(sentence).toContain('migration 045');
    }
  });

  it('only calls code retired that is really gone', () => {
    // §1 says the outbox publisher, the snapshot import and the console's
    // Content Intelligence page were retired in R26; bring one back and the
    // README is wrong again.
    for (const path of [
      'src_C/Vpc/Analytics/OutboxPublisher.cs',
      'src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs',
      'src_C/Vpc/Authoring/ContentIntelligence.cs',
      'frontend/src/pages/ContentIntelligencePage.tsx',
    ]) {
      expect(existsSync(`${REPO_ROOT}${path}`), path).toBe(false);
    }
  });

  it('ships a LICENSE with no unfilled template fields', () => {
    const license = fileURLToPath(new URL('../../LICENSE', import.meta.url));
    expect(existsSync(license)).toBe(true);
    expect(readFileSync(license, 'utf8')).not.toMatch(/YOUR NAME|\[year\]|\[fullname\]|<name>/);
  });
});

// The file-count column that used to sit in the same table is gone, and so is the
// assertion that guarded it. It never caught a defect. It failed four times on
// count drift alone -- three of those in CI, the last one leaving main red for
// twenty days -- because `git ls-files` reads the index, so any commit that adds
// a file without restaging the README breaks a check that was only ever
// restating what git already knows.
//
// The paths above are kept for the opposite reason: a README naming a file that
// no longer exists is wrong in a way nothing else in the toolchain would catch.
// That check has a job. Counting files was arithmetic with a maintenance bill.
