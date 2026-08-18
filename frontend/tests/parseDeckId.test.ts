// The ?deckId= rule, and the fact that it is now one rule.
//
// There were three, in CardListPage, NewCardPage and EditCardPage, and they
// disagreed about exactly one input: a negative number. Two pages refused it
// before any request went out; the third sent it and showed whatever the server
// said about it. That is a defect you cannot see from inside any one page --
// each is self-consistent -- so half of this file is about the FUNCTION and the
// other half is about there being only one of it.
//
// The scan half is deliberately source-level. A behavioural test can show that
// three pages agree today; only reading the source can show that they agree
// BECAUSE they call the same thing, which is the property that survives the
// next person editing one of them.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseDeckId } from '../src/lib/parseDeckId';

/** The three pages this step rehomed. */
const PAGES = ['CardListPage.tsx', 'NewCardPage.tsx', 'EditCardPage.tsx'];

/**
 * The pages that still answer the question themselves, as an outstanding
 * balance rather than a silence.
 *
 * Both were outside the named scope of this step and are recorded, not fixed —
 * but "recorded" has to mean something a scan can check, or the next reader of
 * the file above concludes the rule has one home when it has three:
 *
 *   DeckImportPage   `!deckId || Number.isNaN(deckId) || deckId <= 0` — the
 *                    strict rule the two card pages just stopped using, so this
 *                    is now the ONLY place in the console where ?deckId=-5 is
 *                    refused without asking the server. That divergence is
 *                    smaller than it was and it is still a divergence.
 *   DeckPreviewPage  `!deckId || Number.isNaN(deckId)` — the same semantics as
 *                    parseDeckId, spelled out by hand. Behaviourally identical
 *                    today, which is exactly what makes it the copy that drifts
 *                    without anyone noticing.
 */
const STILL_INLINE = ['DeckImportPage.tsx', 'DeckPreviewPage.tsx'];

function pageSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/pages/${name}`, import.meta.url)), 'utf8');
}

describe('the ids parseDeckId accepts', () => {
  it('reads an ordinary id', () => {
    expect(parseDeckId('7')).toBe(7);
  });

  it('keeps a negative id, because only the server knows which decks exist', () => {
    // The load-bearing case, and the one the three pages disagreed about. A
    // client that refuses -5 is claiming to know the id space; the server's
    // "Deck -5 does not exist." is the answer the console has always shown on
    // CardListPage, and the two pages that used to say "Missing or invalid
    // deckId." about the identical URL now say it too.
    expect(parseDeckId('-5')).toBe(-5);
  });

  it('keeps a fractional id for the same reason', () => {
    expect(parseDeckId('2.5')).toBe(2.5);
  });
});

describe('the ids parseDeckId refuses', () => {
  it('rejects a missing parameter', () => {
    // useSearchParams().get() returns null for a parameter that is not there.
    expect(parseDeckId(null)).toBeNull();
    expect(parseDeckId(undefined)).toBeNull();
  });

  it('rejects an empty parameter, which Number() reads as 0', () => {
    expect(parseDeckId('')).toBeNull();
    expect(parseDeckId('   ')).toBeNull();
  });

  it('rejects zero itself, which is the same value and the same non-answer', () => {
    expect(parseDeckId('0')).toBeNull();
  });

  it('rejects something that is not a number at all', () => {
    expect(parseDeckId('abc')).toBeNull();
    expect(parseDeckId('7abc')).toBeNull();
  });
});

describe('the rule has exactly one home', () => {
  it('is called by all three pages that read a deckId from the URL', () => {
    const callers = PAGES.filter(name => /\bparseDeckId\s*\(/.test(pageSource(name)));
    expect(callers).toEqual(PAGES);
  });

  it('is not re-derived beside the call in any of them', () => {
    // The exact shape of the two rules that were deleted. Either one reappearing
    // means somebody added a fourth opinion next to the shared one, which is how
    // the three drifted apart the first time.
    const offenders = PAGES.filter(name => {
      const source = pageSource(name);
      return (
        /Number\.isNaN\(\s*numericDeckId\s*\)/.test(source) ||
        /numericDeckId\s*<=\s*0/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });

  it('is still spelled out by hand on exactly the two pages it did not reach', () => {
    // Equality in both directions, like the other censuses here: a third page
    // growing its own copy is new debt, and one of these two adopting
    // parseDeckId means somebody paid debt down and owes this list an edit.
    const inline = [...PAGES, ...STILL_INLINE].filter(name =>
      /const invalidDeckId =[^;]*Number\.isNaN/.test(pageSource(name)),
    );
    expect(inline.sort()).toEqual([...STILL_INLINE].sort());
  });

  it('read real files, so an empty scan cannot pass either half', () => {
    // Both assertions above are satisfied by a source string that is empty (the
    // first would fail, but a typo'd path throwing is a different failure from a
    // silent one, and a future lenient reader would make it silent).
    for (const name of [...PAGES, ...STILL_INLINE]) {
      expect(pageSource(name).length).toBeGreaterThan(1000);
    }
  });
});
