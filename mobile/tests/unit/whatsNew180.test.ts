import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Z07 mobile-19: the 1.8.0 release notes describe the Mistake Book the way it behaves. Since the
// mobile-6 fix, two correct answers on the same day do not count (mistakeBook.ts applyOutcome),
// and the in-app subtitle says "Two correct answers on different days clear a card."
describe('1.8.0 release notes', () => {
  const notes = readFileSync(resolve(__dirname, '../../scripts/release/whats-new-1.8.0.txt'), 'utf8');

  it('says a card leaves the Mistake Book after correct answers on two different days', () => {
    expect(notes).toContain('a card leaves the book once you get it right on two different days.');
    expect(notes).not.toMatch(/twice in a row/i);
  });

  it('fits the App Store What\'s New limit', () => {
    expect(notes.length).toBeLessThanOrEqual(4000);
  });
});
