// Characterization tests for the manifest normalisation layer.
//
// These twelve functions turn whatever the content manifest actually contains
// into the row shape DeckListPage renders. They are the reason the legacy path
// can survive a server that spells keys in PascalCase, wraps the payload in
// one or two envelopes, and uses null and "absent" to mean different things.
//
// They were written while the functions still lived inside DeckListPage.tsx,
// against the shipped definitions with nothing changed but an `export` keyword
// in front of each one. Adding `export` cannot alter runtime behaviour, so
// every assertion below describes the code as it was before it moved — which
// is the only way a move can afterwards be shown not to have changed anything.
// When the functions moved to src/features/deckList/deckListManifest.ts the import path
// changed and not one character of the assertions did.
//
// Node environment on purpose: nothing here touches a DOM.

import { describe, expect, it } from 'vitest';

import {
  extractDecksArray,
  getDeckStatusFromManifest,
  getManifestTarget,
  parseManifestMeta,
  safeDateTime,
  toManifestDeckLite,
} from '../src/features/deckList/deckListManifest';
import type { Deck } from '../src/types/deck';

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 1,
    slug: 'a-deck',
    title: 'A Deck',
    author: 'tests',
    locale: 'en',
    deckType: 2,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

describe('finding the decks array inside whatever the server sent', () => {
  // Five envelopes are supported because five have been seen. Each case here
  // is one shape that would render an empty console if it stopped being
  // unwrapped, and an empty console is indistinguishable from "no decks yet".
  it('accepts a bare array', () => {
    expect(extractDecksArray([{ slug: 'x' }])).toEqual([{ slug: 'x' }]);
  });

  it('accepts { decks }', () => {
    expect(extractDecksArray({ decks: [{ slug: 'x' }] })).toEqual([{ slug: 'x' }]);
  });

  it('accepts the PascalCase { Decks }', () => {
    expect(extractDecksArray({ Decks: [{ slug: 'x' }] })).toEqual([{ slug: 'x' }]);
  });

  it('unwraps { manifest: { decks } }', () => {
    expect(extractDecksArray({ manifest: { decks: [{ slug: 'x' }] } })).toEqual([{ slug: 'x' }]);
  });

  it('unwraps { data: { manifest: { decks } } }', () => {
    expect(extractDecksArray({ data: { manifest: { decks: [{ slug: 'x' }] } } })).toEqual([
      { slug: 'x' },
    ]);
  });

  it('returns an empty array for anything else rather than throwing', () => {
    // A parse failure upstream hands this a string; a 204 hands it null. The
    // console has to stay standing in both cases.
    expect(extractDecksArray(null)).toEqual([]);
    expect(extractDecksArray('not json')).toEqual([]);
    expect(extractDecksArray({ decks: 'nope' })).toEqual([]);
  });
});

describe('the order the envelopes are peeled in', () => {
  // Order is the whole content of getManifestTarget: with two envelopes
  // present, unwrapping the wrong one first finds a different decks array.
  it('prefers manifest over data', () => {
    const target = getManifestTarget({
      manifest: { prefix: 'from-manifest' },
      data: { prefix: 'from-data' },
    });
    expect(target).toEqual({ prefix: 'from-manifest' });
  });

  it('prefers data.manifest over data itself', () => {
    const target = getManifestTarget({
      data: { manifest: { prefix: 'from-data-manifest' }, prefix: 'from-data' },
    });
    expect(target).toEqual({ prefix: 'from-data-manifest' });
  });

  it('falls through to the payload itself when nothing wraps it', () => {
    expect(getManifestTarget({ prefix: 'bare' })).toEqual({ prefix: 'bare' });
    expect(getManifestTarget(42)).toEqual({});
  });
});

describe('normalising one manifest deck entry', () => {
  it('drops an entry with no usable slug, because the slug is the join key', () => {
    // Everything downstream is keyed by slug. An entry without one cannot be
    // matched to a deck, and keeping it would put an unjoinable row in the map.
    expect(toManifestDeckLite({ title: 'No slug here' })).toBeNull();
    expect(toManifestDeckLite({ slug: '   ' })).toBeNull();
    expect(toManifestDeckLite('not an object')).toBeNull();
  });

  it('reads PascalCase keys as well as camelCase', () => {
    const lite = toManifestDeckLite({ Slug: 'csharp', Title: 'C#', BuildId: 'b-1' });
    expect(lite?.slug).toBe('csharp');
    expect(lite?.title).toBe('C#');
    expect(lite?.buildId).toBe('b-1');
  });

  it('keeps an explicit null buildId but omits a missing one', () => {
    // Three states, not two: published (a string), explicitly unpublished
    // (null), and unknown (absent). Collapsing null into absent would make
    // "the server says this is not built" indistinguishable from "the server
    // did not mention it".
    const explicitNull = toManifestDeckLite({ slug: 'a', buildId: null });
    expect(explicitNull).not.toBeNull();
    expect('buildId' in (explicitNull as object)).toBe(true);
    expect(explicitNull?.buildId).toBeNull();

    const absent = toManifestDeckLite({ slug: 'a' });
    expect('buildId' in (absent as object)).toBe(false);
  });

  it('trims surrounding whitespace out of the values it keeps', () => {
    const lite = toManifestDeckLite({ slug: '  csharp  ', title: '  C#  ', path: '  p/1  ' });
    expect(lite?.slug).toBe('csharp');
    expect(lite?.title).toBe('C#');
    expect(lite?.path).toBe('p/1');
  });
});

describe('the manifest summary', () => {
  it('counts decks from the array length, not from a field the server sent', () => {
    // A deckCount the server reported and a decks array that disagrees with it
    // would put a wrong number under a correct table.
    const meta = parseManifestMeta({ manifest: { decks: [{}, {}, {}], deckCount: 99 } });
    expect(meta.deckCount).toBe(3);
  });

  it('coerces a numeric string timestamp into a number', () => {
    // JSON from the publisher sends this as a string often enough that a
    // string here would silently break every comparison done against it.
    const meta = parseManifestMeta({ GeneratedAtMs: '1767225600000' });
    expect(meta.generatedAtMs).toBe(1767225600000);
  });

  it('omits deckCount entirely when there is no decks array', () => {
    expect('deckCount' in parseManifestMeta({ prefix: 'p' })).toBe(false);
  });

  it('reads through the same envelopes the deck list does', () => {
    expect(parseManifestMeta({ data: { manifest: { Prefix: 'content/v3' } } }).prefix)
      .toBe('content/v3');
  });
});

describe('deciding whether a deck is published', () => {
  it('treats either a buildId or a path as published', () => {
    expect(getDeckStatusFromManifest(deck(), { slug: 'a', buildId: 'b-1' })).toBe('published');
    expect(getDeckStatusFromManifest(deck(), { slug: 'a', path: 'p/1' })).toBe('published');
  });

  it('is not published when the entry carries neither', () => {
    expect(getDeckStatusFromManifest(deck({ totalCards: 3 }), { slug: 'a', buildId: null }))
      .toBe('needs_publish');
  });

  it('is unpublished, not needs_publish, when there are no cards to publish', () => {
    expect(getDeckStatusFromManifest(deck({ totalCards: 0 }), undefined)).toBe('unpublished');
    expect(getDeckStatusFromManifest(deck({ totalCards: null }), undefined)).toBe('unpublished');
  });

  it('lets an explicit card count of zero win over the deck total', () => {
    // `cardCount ?? deck.totalCards` and `cardCount || deck.totalCards` differ
    // on exactly this input, and only on this input. A deck the caller has
    // counted as empty must not borrow a stale non-zero total from the row.
    expect(getDeckStatusFromManifest(deck({ totalCards: 5 }), undefined, 0)).toBe('unpublished');
    expect(getDeckStatusFromManifest(deck({ totalCards: 0 }), undefined, 5)).toBe('needs_publish');
  });
});

describe('rendering a timestamp that may not be one', () => {
  it('shows a dash for every kind of absent or unparseable value', () => {
    // These four all reach this function from real rows: a column the server
    // omitted, a nulled column, an empty string, and a value that is present
    // but not a date. "Invalid Date" in a table cell is the failure mode.
    expect(safeDateTime(undefined)).toBe('—');
    expect(safeDateTime(null)).toBe('—');
    expect(safeDateTime('')).toBe('—');
    expect(safeDateTime('not a date')).toBe('—');
  });

  it('formats a real timestamp into something other than a dash', () => {
    expect(safeDateTime('2026-01-02T03:04:05Z')).not.toBe('—');
  });
});
