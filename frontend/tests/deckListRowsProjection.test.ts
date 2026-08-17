// Field-by-field cover for the half of buildViewRows the page-level tests miss.
//
// deckListViewRows.test.tsx drives this module through a mounted DeckListPage
// and asserts which rows survive and in what order. That is a real net over the
// filtering and the sorting, and twenty single-kill mutations show it has teeth.
// It says almost nothing about the projection — the object literal each branch
// builds per row. Those tests read the table, and the table renders four of the
// ten fields; the rest reach the DOM as attributes, as a React key, or not at
// all.
//
// Measured, not assumed: with the page-level suite alone, `cardCount: 999`,
// `updatedAt: null`, `title: 'MUTANT'` and `id: null` in the paginated branch
// each leave all 205 tests green. A module whose filtering is nailed down and
// whose output shape is not is half a net, and the half that is missing is the
// half the next edit lands in.
//
// So this file calls buildViewRows directly. No jsdom, no mount, no mocks: the
// unit under test is a pure function and the cheapest honest witness for "what
// exactly does it return" is to look at what it returns.

import { describe, expect, it } from 'vitest';

import { buildViewRows } from '../src/pages/deckListRows';
import type { BuildViewRowsInput, ConsoleDeckRow } from '../src/pages/deckListRows';
import type { Deck } from '../src/types/deck';
import type { AdminDeckListItem } from '../src/api/authoring';

/** Only the two filters are neutral here; each case supplies its own rows. */
function input(over: Partial<BuildViewRowsInput>): BuildViewRowsInput {
  return {
    listMode: 'paginated',
    pagedItems: [],
    decks: [],
    manifestBySlug: {},
    q: '',
    statusFilter: 'all',
    typeFilter: 'all',
    ...over,
  };
}

/**
 * Asserting the whole object rather than field by field is the point.
 * toEqual on the complete row fails when a field is dropped, renamed or
 * silently added, which per-field expects cannot see.
 */
function onlyRow(rows: ConsoleDeckRow[]): ConsoleDeckRow {
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('the paginated branch projects every field of the server item', () => {
  const item = {
    id: 42,
    slug: 'csharp-fundamentals',
    title: 'C# Fundamentals',
    deckType: 1,
    tier: 'free',
    totalCards: 118,
    updatedAtMs: 1_760_000_000_000,
  } as AdminDeckListItem;

  it('carries all ten fields across, and invents none', () => {
    const row = onlyRow(buildViewRows(input({ pagedItems: [item] })));

    expect(row).toEqual({
      // The React key on this path is the slug, not the id: a paginated item
      // is not guaranteed to carry an id at all, which is why resolveDeckId
      // exists.
      key: 'csharp-fundamentals',
      id: 42,
      slug: 'csharp-fundamentals',
      title: 'C# Fundamentals',
      deckType: 1,
      tier: 'free',
      // Always null on this path: manifest ordering is a legacy-only concept,
      // because the server already ordered the page.
      manifestOrder: null,
      cardCount: 118,
      status: row.status,
      updatedAt: 1_760_000_000_000,
    } satisfies ConsoleDeckRow);
  });

  it('falls back per field when the server omits things, rather than dropping the row', () => {
    const sparse = { slug: 'sparse-deck' } as AdminDeckListItem;
    const row = onlyRow(buildViewRows(input({ pagedItems: [sparse] })));

    // A row with no id still renders; the page resolves the id on demand when
    // someone clicks it. Turning any of these into a thrown error or a skipped
    // row would empty the console for a deck the server was happy to list.
    expect(row.id).toBeNull();
    expect(row.title).toBe('');
    expect(row.deckType).toBeNull();
    expect(row.tier).toBeNull();
    expect(row.cardCount).toBe(0);
    expect(row.updatedAt).toBeNull();
    expect(row.key).toBe('sparse-deck');
  });

  it('keeps the fields of each row with that row when several come back', () => {
    const second = { ...item, id: 43, slug: 'sql-basics', title: 'SQL Basics', totalCards: 7 };
    const rows = buildViewRows(input({ pagedItems: [item, second as AdminDeckListItem] }));

    // Guards the transposition bug a projection rewrite can introduce without
    // changing the row count: right fields, wrong row.
    expect(rows.map(r => [r.slug, r.cardCount, r.id])).toEqual([
      ['csharp-fundamentals', 118, 42],
      ['sql-basics', 7, 43],
    ]);
  });
});

describe('the legacy branch projects every field of the deck', () => {
  const deck = {
    id: 42,
    slug: 'csharp-fundamentals',
    title: 'C# Fundamentals',
    deckType: 1,
    tier: 'free',
    totalCards: 118,
    manifestOrder: 3,
    updatedAt: '2026-02-01T00:00:00.000Z',
  } as unknown as Deck;

  function legacy(over: Partial<Deck> = {}) {
    return buildViewRows(
      input({ listMode: 'legacy', decks: [{ ...deck, ...over } as Deck] }),
    );
  }

  it('carries all ten fields across, and invents none', () => {
    const row = onlyRow(legacy());

    expect(row).toEqual({
      // The key differs from the paginated path on purpose: a legacy deck
      // always has an id, and it is stringified because React keys are strings.
      key: '42',
      id: 42,
      slug: 'csharp-fundamentals',
      title: 'C# Fundamentals',
      deckType: 1,
      tier: 'free',
      manifestOrder: 3,
      cardCount: 118,
      status: row.status,
      updatedAt: '2026-02-01T00:00:00.000Z',
    } satisfies ConsoleDeckRow);
  });

  it('falls back to createdAt when a deck was never updated', () => {
    const row = onlyRow(
      legacy({ updatedAt: undefined, createdAt: '2026-01-01T00:00:00.000Z' } as Partial<Deck>),
    );

    // Dropping this fallback shows an empty date cell for every deck nobody has
    // edited yet, which is most of them right after an import.
    expect(row.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('coerces the loose fields the legacy endpoint is allowed to send', () => {
    const row = onlyRow(
      legacy({
        id: '42' as unknown as number,
        slug: undefined,
        title: undefined,
        deckType: '1' as unknown as number,
        manifestOrder: '3' as unknown as number,
      } as Partial<Deck>),
    );

    // Number('42') is finite, so a string id still yields a usable number.
    expect(row.id).toBe(42);
    expect(row.slug).toBe('');
    expect(row.title).toBe('');
    // These two check the *type*, not the value: a string that looks like a
    // number is rejected rather than coerced, because both feed comparisons
    // (`deckType !== 1`, numeric sort) where '1' would behave differently.
    expect(row.deckType).toBeNull();
    expect(row.manifestOrder).toBeNull();
  });

  it('reports no id when the deck carries one that is not a number', () => {
    const row = onlyRow(legacy({ id: 'not-a-number' as unknown as number }));

    expect(row.id).toBeNull();
    // The key is still derived from the raw value, so two unusable ids do not
    // collapse into one React key.
    expect(row.key).toBe('not-a-number');
  });

  it('keeps the fields of each row with that row when several come back', () => {
    const rows = buildViewRows(
      input({
        listMode: 'legacy',
        decks: [
          deck,
          { ...deck, id: 43, slug: 'sql-basics', title: 'SQL Basics', totalCards: 7, manifestOrder: 1 } as Deck,
        ],
      }),
    );

    // Ordered by manifestOrder, so this also states that sorting moves whole
    // rows rather than reshuffling fields between them.
    expect(rows.map(r => [r.slug, r.cardCount, r.id])).toEqual([
      ['sql-basics', 7, 43],
      ['csharp-fundamentals', 118, 42],
    ]);
  });
});
