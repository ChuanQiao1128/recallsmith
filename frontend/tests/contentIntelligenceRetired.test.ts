// R26 C01 (2026-10-02): Snowflake was retired, and with it the warehouse that
// fed the Content Intelligence page. The server drops
// GET /api/v1/authoring/content-intelligence (R26 S01), so the console must not
// offer a page that can only fail: no page module, no route, no title, no nav
// section and no api client for it. Usage and per-card numbers live on the
// Usage and Reports pages, which read the Postgres rollups.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as authoring from '../src/api/authoring';
import { CONSOLE_NAME, documentTitleFor } from '../src/lib/brand';
import { CONSOLE_NAV } from '../src/components/console/consoleNav';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${path}/`);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('the retired Content Intelligence page', () => {
  it('has no page module', () => {
    expect(existsSync(`${SRC}pages/ContentIntelligencePage.tsx`)).toBe(false);
  });

  it('has no route title and no console nav section', () => {
    expect(documentTitleFor('/content-intelligence')).toBe(CONSOLE_NAME);
    expect(Object.keys(CONSOLE_NAV)).not.toContain('contentIntelligenceHref');
  });

  it('has no api client function', () => {
    expect(Object.keys(authoring)).not.toContain('fetchContentIntelligence');
  });

  it('is referenced nowhere under src/', () => {
    const files = sourceFiles(SRC);
    // Anti-vacuity: the walk reaches the console's pages and api modules.
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/content-intelligence|ContentIntelligence|contentIntelligence/);
    }
  });
});
