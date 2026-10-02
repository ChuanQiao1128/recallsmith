import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// R24B review fix (F01 w-tests-1): the Draw screen's load-error fallback body
// is only shown when the error card renders without a message, which no load
// path does today (every `setLoadState('error')` sets one). It still ships as
// learner copy, so pin it as source text, plus the old wording it replaced.
const DRAW_SCREEN = resolve(__dirname, '../../src/screens/DrawScreen.tsx');
const DRAW_RESULT_SCREEN = resolve(__dirname, '../../src/screens/DrawResultScreen.tsx');

describe('Draw screen copy', () => {
  it('falls back to the plain-words load-error body', () => {
    const source = readFileSync(DRAW_SCREEN, 'utf8');
    expect(source).toContain("{error ?? 'Unable to load Draw right now.'}");
  });

  it.each([DRAW_SCREEN, DRAW_RESULT_SCREEN])('never brings back the old draw wording in %s', (path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/remaining pulls|draw chamber/i);
  });
});
