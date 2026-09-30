import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.resolve(HERE, '../../scripts/release');
const read = (f: string) => fs.readFileSync(path.join(RELEASE_DIR, f), 'utf8').trim();
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

describe('1.9.0 store texts', () => {
  it("What's New stays within 4000 characters and describes the reports and the Mistake Book fixes", () => {
    const text = read('whats-new-1.9.0.txt');
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('crash and performance reports');
    expect(text).toMatch(/no account data/i);
    expect(text).toMatch(/email address/i);
    expect(text).toMatch(/Mistake Book/);
    expect(text).toContain('No mistakes due today');
    expect(text.toLowerCase()).not.toContain('twice in a row');
    expect(text).not.toMatch(EMAIL);
  });

  it.each([
    ['description-1.9.0.txt', 4000],
    ['keywords-1.9.0.txt', 100],
    ['promo-1.9.0.txt', 170],
    ['subtitle-1.9.0.txt', 30],
    ['review-notes-1.9.0.txt', 4000],
  ] as const)('%s is non-empty, within %i characters and has no email address', (file, limit) => {
    const text = read(file);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(limit);
    expect(text).not.toMatch(EMAIL);
  });

  it('keeps every 1.8.0 description line in the 1.9.0 description', () => {
    const d9 = read('description-1.9.0.txt');
    for (const line of read('description-1.8.0.txt').split('\n').map((l) => l.trim()).filter(Boolean)) {
      expect(d9).toContain(line);
    }
  });

  it('keeps the 1.8.0 review notes (lines 2+) and adds the Sentry paragraph', () => {
    const r9 = read('review-notes-1.9.0.txt');
    const lines = read('review-notes-1.8.0.txt').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(1)) expect(r9).toContain(line);
    expect(r9).toContain('Sentry');
    expect(r9).toMatch(/kill switch/);
  });
});
