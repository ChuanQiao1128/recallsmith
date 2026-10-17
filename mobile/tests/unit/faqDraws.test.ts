// 2026-10-17 batch open: the Help FAQ states what the Draw screen does now -- 5 draws to start a
// pack (and at the end of the first lesson), and up to 5 cards opened at once or just 1. The
// numbers are read from the code so the copy cannot drift from it again.
import { describe, expect, it } from 'vitest';

import { FAQ_LIST } from '../../src/content/faq';
import { DECK_BOOTSTRAP_GRANT } from '../../src/features/gacha/rewards/deckWallet';
import { MAX_BATCH_OPEN } from '../../src/features/gacha/draw/drawBatch';

function answer(q: string): string {
  const entry = FAQ_LIST.find((e) => e.q === q);
  expect(entry, q).toBeDefined();
  return entry!.a;
}

describe('Help FAQ, 2026-10-17 batch open', () => {
  it('names the starting draws from DECK_BOOTSTRAP_GRANT, twice', () => {
    const a = answer('How do I earn draws?');
    expect(a).toContain(`Every pack gets ${DECK_BOOTSTRAP_GRANT} draws the first time you open it`);
    expect(a).toContain(`your first lesson ends with ${DECK_BOOTSTRAP_GRANT} draws for its pack`);
    expect(a).not.toContain('3 draws');
  });

  it('describes the batch open and the charge for cards received, with no Open 10', () => {
    const a = answer('When is a rare card guaranteed?');
    expect(a).toContain(
      `Open up to ${MAX_BATCH_OPEN} cards at once, or just 1: you only spend draws for the cards you receive.`,
    );
    const copy = FAQ_LIST.map((e) => `${e.q} ${e.a}`).join('\n');
    expect(copy).not.toMatch(/Open 10|ten cards|10 cards/i);
    // The guarantee sentence is unchanged and agrees with the Draw screen's countdown.
    expect(a).toContain('a rare card is guaranteed within 11 cards');
  });
});
