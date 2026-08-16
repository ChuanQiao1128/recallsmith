// @vitest-environment jsdom
//
// Characterization tests for the viewRows useMemo in DeckListPage.tsx
// (:620-696) — the ~75 lines that turn either data path into the rows the
// table renders. They had zero coverage before this file: the two existing
// page-level suites both mount with an empty deck list (polling) or assert
// only on status badges (legacy path), so no test has ever exercised the
// status filter, the type filter, the search term, or the manifest-order sort.
//
// ---------------------------------------------------------------------------
// WHAT V1/V2/V3 PIN, AND WHY THEY MUST NOT BE "FIXED"
// ---------------------------------------------------------------------------
// One question — "is this a starter deck?" — is answered at three call sites
// by two different predicates:
//
//   deckListRows.ts, buildViewRows paginated branch, the typeFilter block:
//     isStarterLike(row.deckType, row.tier)
//   deckListRows.ts, buildViewRows legacy branch, the typeFilter block:
//     d.deckType !== 1  /  d.deckType === 1
//   DeckListPage.tsx, the Type cell of the table body:
//     typeBadge(isStarterLike(row.deckType, row.tier) ? 1 : 2)
//
// Deliberately named by symbol rather than by line: these three references are
// the only record of why V2 and V3 must not be "tidied up", and the first
// version of this header cited line numbers that were already stale by the time
// the extraction landed in the same commit.
//
// isStarterLike (deckListPagination.ts:79-85) returns `deckType === 1` when
// deckType is a number, and otherwise falls back to `tier !== 'premium'`. So
// for a deck with deckType null and tier 'free' the two predicates disagree:
//
//   legacy    + type=starter  -> EXCLUDED   (null !== 1)
//   legacy    + type=paid     -> KEPT       (null !== 1, so not === 1)
//   paginated + type=starter  -> KEPT       ('free' !== 'premium')
//   paginated + type=paid     -> EXCLUDED
//   badge, both modes         -> "Starter"
//
// V3 is the sharpest of these: in one render, a row whose Type cell reads
// "Starter" is visible only while the Paid filter is selected. That half of the
// contradiction lives in JSX, so it is observable only through the DOM — a pure
// function test could not see it.
//
// This is an existing defect. These tests pin the CURRENT behaviour on purpose
// and do not repair it; unifying the predicates is a product-semantics decision
// for a human or a later step. If a change makes V2 or V3 go red, the change
// altered what the console shows, whether or not that was the intent.
//
// ---------------------------------------------------------------------------
// WHY deckType: null IS A LEGITIMATE FIXTURE, NOT A FICTION
// ---------------------------------------------------------------------------
// src/types/deck.ts:13 declares `deckType: number`, so the cast below looks
// like an invented state. It is not. normalizeDeck (src/api/authoring.ts:63)
// computes `deckType: toInt(o.deckType, d.deckType)` where `o` is `d` itself
// cast to a record — the candidate and the fallback are the SAME value — and
// toInt (:36-43) accepts only a finite number or a non-empty numeric string,
// returning the fallback otherwise. A null therefore passes through untouched.
// The declared type is lying; the state is production-reachable.
//
// ---------------------------------------------------------------------------
// FIXTURE RULES THIS FILE HOLDS ITSELF TO
// ---------------------------------------------------------------------------
// - Every "row is absent" assertion has a surviving control row in the SAME
//   render, so a page that rendered nothing at all cannot pass.
// - Mode is reached only through the real entry points: signInAsEditor() for
//   legacy, signInAsSuperAdmin() plus a paginated endpoint that answers for
//   paginated. No internal state is forced.
// - Every fixture returns an EMPTY publish-job list. The poll reschedules
//   itself on a timer, and these cases assert exact fetch call counts; an
//   active job would move the cadence onto POLL_ACTIVE_LADDER_MS. Advancing
//   300ms is safe against the idle cadence either way: POLL_IDLE_MS is 30_000
//   and the shortest active rung is 2_000 (src/lib/publishJobsPolling.ts:29,35).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDeckListItem, AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
}));

// Spread the real module rather than replacing it: DeckListPage also imports
// ADMIN_DECKS_ENDPOINT_MISSING and builds its fallback set from it, and a
// hand-written stub would let that set drift without any test noticing.
vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const AMB = 'amb-null-type';
const CTRL_STARTER = 'ctrl-starter-one';
const CTRL_PAID = 'ctrl-paid-two';

/** No slug may be a substring of another: rowFor() matches on containment. */
const KNOWN_SLUGS = [AMB, CTRL_STARTER, CTRL_PAID, 'ord-a', 'ord-b', 'ord-c', 'ord-d'];

/**
 * The one deck this file is about, held in a single place so the two data
 * paths cannot quietly describe different decks. Note the absent deckType:
 * each projection supplies whatever its own API shape would carry.
 */
const AMBIGUOUS = {
  slug: AMB,
  title: 'Ambiguous Deck',
  tier: 'free',
  totalCards: 5,
} as const;

/** What fetchDecks() would hand the legacy path. See the header on the cast. */
function asLegacyDeck(): Deck {
  return legacyDeck({
    id: 101,
    slug: AMBIGUOUS.slug,
    title: AMBIGUOUS.title,
    tier: AMBIGUOUS.tier as Deck['tier'],
    totalCards: AMBIGUOUS.totalCards,
    deckType: null as unknown as number,
    manifestOrder: 1,
  });
}

/** What fetchAdminDecksPage() would hand the paginated path. */
function asPagedItem(): AdminDeckListItem {
  return {
    slug: AMBIGUOUS.slug,
    title: AMBIGUOUS.title,
    id: 101,
    // normalizeAdminDeckItem (authoring.ts:305) emits null, not undefined,
    // when the server omits deckType.
    deckType: null,
    tier: AMBIGUOUS.tier,
    totalCards: AMBIGUOUS.totalCards,
    latestBuildId: null,
    updatedAtMs: null,
  };
}

function legacyDeck(overrides: Partial<Deck> & Pick<Deck, 'id' | 'slug' | 'title'>): Deck {
  return {
    author: 'tests',
    locale: 'en',
    deckType: 2,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    totalCards: 12,
    ...overrides,
  };
}

/**
 * Three legacy decks with three distinct statuses and three distinct type
 * classifications, sorted by manifestOrder into a fixed order.
 *
 *   ctrl-starter-one  order 0  deckType 1     manifest buildId  -> published
 *   amb-null-type     order 1  deckType null  no manifest entry -> needs_publish
 *   ctrl-paid-two     order 2  deckType 2     0 cards           -> unpublished
 */
function legacyDecks(): Deck[] {
  return [
    // Deliberately NOT in manifestOrder order, so the sort has work to do.
    asLegacyDeck(),
    legacyDeck({
      id: 102,
      slug: CTRL_STARTER,
      title: 'Control Starter',
      deckType: 1,
      tier: 'free',
      totalCards: 12,
      manifestOrder: 0,
    }),
    legacyDeck({
      id: 103,
      slug: CTRL_PAID,
      title: 'Control Paid',
      deckType: 2,
      tier: 'premium',
      totalCards: 0,
      manifestOrder: 2,
    }),
  ];
}

/** Only ctrl-starter-one is in the manifest, and only it carries a buildId. */
function manifestPayload(): Record<string, unknown> {
  return {
    manifest: {
      SchemaVersion: 3,
      Prefix: 'content/v3',
      Decks: [{ Slug: CTRL_STARTER, Title: 'Control Starter', BuildId: 'build-777', TotalCards: 12 }],
    },
  };
}

/** The paginated mirror of legacyDecks(), in server order (no client sort). */
function pagedItems(): AdminDeckListItem[] {
  return [
    asPagedItem(),
    {
      slug: CTRL_STARTER,
      title: 'Control Starter',
      id: 102,
      deckType: 1,
      tier: 'free',
      totalCards: 12,
      latestBuildId: 'build-777',
      updatedAtMs: null,
    },
    {
      slug: CTRL_PAID,
      title: 'Control Paid',
      id: 103,
      deckType: 2,
      tier: 'premium',
      totalCards: 0,
      latestBuildId: null,
      updatedAtMs: null,
    },
  ];
}

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function page(items: AdminDeckListItem[]): ApiResult<AdminDecksPage> {
  return ok({ items, nextCursor: null, hasMore: false });
}

function noJobs(): ApiResult<PublishJob[]> {
  return ok([]);
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

/**
 * Drain the microtask queue without moving a timer, so the elapsed fake time
 * after mounting is still exactly 0 and the 300ms assertions stay exact.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <DeckListPage />
    </MemoryRouter>,
  );
  await settle();
}

/** The deck table's body. Asserting uniqueness here so a second table added
 *  later fails loudly instead of silently changing what every helper reads. */
function deckTableBody(): HTMLElement {
  const bodies = document.querySelectorAll('tbody');
  expect(bodies).toHaveLength(1);
  return bodies[0] as HTMLElement;
}

/** Visible rows, in render order, identified by slug. The empty-state row
 *  carries no slug and is skipped. */
function visibleSlugs(): string[] {
  const out: string[] = [];
  for (const tr of Array.from(deckTableBody().querySelectorAll('tr'))) {
    const text = tr.textContent ?? '';
    const hit = KNOWN_SLUGS.find(slug => text.includes(slug));
    if (hit) out.push(hit);
  }
  return out;
}

function rowFor(slug: string): HTMLElement {
  const row = Array.from(deckTableBody().querySelectorAll('tr')).find(tr =>
    (tr.textContent ?? '').includes(slug),
  );
  expect(row, `expected a table row for slug "${slug}"`).not.toBeUndefined();
  return row as HTMLElement;
}

/**
 * The Type cell, read positionally (3rd <td>) rather than by text.
 * An unscoped getByText('Starter') would also match the
 * <option value="starter">Starter</option> in the type filter.
 */
function typeCellText(slug: string): string {
  const cells = rowFor(slug).querySelectorAll('td');
  return (cells[2]?.textContent ?? '').trim();
}

/** The `#<manifestOrder ?? '-'>` chip, found by its title attribute (:1043). */
function orderChip(slug: string): string {
  const chip = rowFor(slug).querySelector('[title="Manifest Order"]');
  expect(chip, `expected an order chip on row "${slug}"`).not.toBeNull();
  return (chip?.textContent ?? '').trim();
}

async function selectFilter(label: string, value: string): Promise<void> {
  const select = screen.getByLabelText(label);
  await act(async () => {
    fireEvent.change(select, { target: { value } });
  });
}

async function typeSearch(value: string): Promise<void> {
  const input = screen.getByPlaceholderText('Search by slug or title...');
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

/** Signed in as an editor: the paginated endpoint is never probed (:188). */
async function mountLegacy(): Promise<void> {
  signInAsEditor();
  await mountConsole();
  expect(api.fetchAdminDecksPage).not.toHaveBeenCalled();
}

/** Signed in as a super admin against an endpoint that answers. */
async function mountPaginated(): Promise<void> {
  signInAsSuperAdmin();
  await mountConsole();
  expect(api.fetchDecks).not.toHaveBeenCalled();
}

beforeEach(() => {
  // DeckListPage caches decks and manifest in localStorage for five minutes;
  // an inherited cache would let a case render rows without a request.
  signOut();
  vi.useFakeTimers();
  api.fetchPublishJobs.mockResolvedValue(noJobs());
  api.fetchAdminDecksPage.mockResolvedValue(page(pagedItems()));
  api.fetchDecks.mockResolvedValue(ok(legacyDecks()));
  api.fetchAdminManifest.mockResolvedValue(ok(manifestPayload()));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();

  // React reports "not wrapped in act(...)" and every other rendering
  // complaint through these channels; nothing on these paths should log.
  const errors = consoleError.mock.calls as unknown[][];
  const warns = consoleWarn.mock.calls as unknown[][];
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  expect(errors).toEqual([]);
  expect(warns).toEqual([]);

  vi.clearAllMocks();
  signOut();
});

// ---------------------------------------------------------------------------

describe('viewRows: the starter/paid divergence, pinned not repaired', () => {
  it('V0: the two projections describe the same deck, and neither carries a numeric deckType', () => {
    const legacy = asLegacyDeck();
    const paged = asPagedItem();

    expect(legacy.slug).toBe(paged.slug);
    expect(legacy.title).toBe(paged.title);
    expect(legacy.tier).toBe(paged.tier);
    expect(legacy.totalCards).toBe(paged.totalCards);

    // The whole divergence hangs on isStarterLike's `typeof deckType ===
    // 'number'` test failing. If a projection ever starts carrying a number,
    // V1-V5 would still pass while measuring nothing.
    expect(typeof legacy.deckType).not.toBe('number');
    expect(typeof paged.deckType).not.toBe('number');
  });

  it('V1: legacy, all types — the row is visible and its Type cell reads Starter', async () => {
    await mountLegacy();

    expect(visibleSlugs()).toContain(AMB);
    expect(typeCellText(AMB)).toBe('Starter');
  });

  it('V2: legacy + Starter filter — the row the badge calls Starter is filtered OUT', async () => {
    await mountLegacy();
    await selectFilter('Filter by type', 'starter');

    // Excluded by `d.deckType !== 1` in buildViewRows' legacy typeFilter
    // block, despite the badge in V1.
    expect(visibleSlugs()).not.toContain(AMB);
    // The control proves the filter kept working rather than emptying the table.
    expect(visibleSlugs()).toContain(CTRL_STARTER);
  });

  it('V3: legacy + Paid filter — the row IS visible, and still reads Starter', async () => {
    await mountLegacy();
    await selectFilter('Filter by type', 'paid');

    // The contradiction, inside a single render: this row survives the Paid
    // filter (`d.deckType === 1` is false) while its own Type cell says
    // Starter (isStarterLike falls back to tier !== 'premium').
    expect(visibleSlugs()).toContain(AMB);
    expect(typeCellText(AMB)).toBe('Starter');
    expect(visibleSlugs()).toContain(CTRL_PAID);
  });

  it('V4: paginated + Starter filter — the same deck is KEPT (opposite of V2)', async () => {
    await mountPaginated();
    await selectFilter('Filter by type', 'starter');

    expect(visibleSlugs()).toContain(AMB);
    expect(typeCellText(AMB)).toBe('Starter');
  });

  it('V5: paginated + Paid filter — the same deck is EXCLUDED (opposite of V3)', async () => {
    await mountPaginated();
    await selectFilter('Filter by type', 'paid');

    expect(visibleSlugs()).not.toContain(AMB);
    expect(visibleSlugs()).toContain(CTRL_PAID);
  });
});

describe('viewRows: the search box means two different things', () => {
  it('V6: legacy — q filters client-side at once and issues no request', async () => {
    await mountLegacy();
    expect(visibleSlugs()).toContain(AMB);
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);

    await typeSearch('zzz');

    // No timer advanced: the legacy branch reads `q` directly (:649), not the
    // debounced value, so the table narrows on the keystroke.
    expect(visibleSlugs()).toEqual([]);
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);

    // And past the debounce it still issues nothing: the [debouncedQ] effect
    // early-returns while listModeRef is 'legacy' (:441).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
    expect(api.fetchAdminDecksPage).not.toHaveBeenCalled();
  });

  it('V7: paginated — q does not filter locally; it round-trips after 300ms', async () => {
    await mountPaginated();
    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);

    await typeSearch('zzz');

    // The paginated branch has no q filter at all (:638-646): the server
    // already applied it, so the rows stay put until the new page arrives.
    expect(visibleSlugs()).toContain(AMB);
    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(2);
    expect(api.fetchAdminDecksPage).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'zzz' }));
  });
});

describe('viewRows: the status filter', () => {
  it('V8a: legacy — each status value selects exactly its own decks', async () => {
    await mountLegacy();

    expect(visibleSlugs()).toEqual([CTRL_STARTER, AMB, CTRL_PAID]);

    await selectFilter('Filter by status', 'published');
    expect(visibleSlugs()).toEqual([CTRL_STARTER]);

    await selectFilter('Filter by status', 'needs_publish');
    expect(visibleSlugs()).toEqual([AMB]);

    await selectFilter('Filter by status', 'unpublished');
    expect(visibleSlugs()).toEqual([CTRL_PAID]);

    await selectFilter('Filter by status', 'all');
    expect(visibleSlugs()).toEqual([CTRL_STARTER, AMB, CTRL_PAID]);
  });

  it('V8b: paginated — each status value selects exactly its own decks', async () => {
    await mountPaginated();

    // No client-side sort on this path: server order is render order.
    expect(visibleSlugs()).toEqual([AMB, CTRL_STARTER, CTRL_PAID]);

    await selectFilter('Filter by status', 'published');
    expect(visibleSlugs()).toEqual([CTRL_STARTER]);

    await selectFilter('Filter by status', 'needs_publish');
    expect(visibleSlugs()).toEqual([AMB]);

    await selectFilter('Filter by status', 'unpublished');
    expect(visibleSlugs()).toEqual([CTRL_PAID]);

    await selectFilter('Filter by status', 'all');
    expect(visibleSlugs()).toEqual([AMB, CTRL_STARTER, CTRL_PAID]);
  });
});

describe('viewRows: manifest order', () => {
  it('V9a: legacy — a missing order sorts last as 999999 and its chip reads #-', async () => {
    // Four decks in an order the sort has to undo, covering all four states a
    // manifestOrder can be in.
    api.fetchDecks.mockResolvedValue(
      ok([
        legacyDeck({ id: 201, slug: 'ord-b', title: 'Order Two', manifestOrder: 2 }),
        legacyDeck({ id: 202, slug: 'ord-a', title: 'Order Zero', manifestOrder: 0 }),
        legacyDeck({ id: 203, slug: 'ord-c', title: 'Order Null', manifestOrder: null }),
        // No manifestOrder key at all — a different shape from null, and the
        // typeof check at :676 is what makes them land in the same bucket.
        legacyDeck({ id: 204, slug: 'ord-d', title: 'Order Absent' }),
      ]),
    );

    await mountLegacy();

    // 0 before 2; null and absent both become 999999 and hold their input
    // order, because Array.prototype.sort is stable.
    expect(visibleSlugs()).toEqual(['ord-a', 'ord-b', 'ord-c', 'ord-d']);

    expect(orderChip('ord-a')).toBe('#0');
    expect(orderChip('ord-b')).toBe('#2');
    expect(orderChip('ord-c')).toBe('#-');
    expect(orderChip('ord-d')).toBe('#-');
  });

  it('V9b: paginated — manifestOrder is hard-coded null, so every chip reads #-', async () => {
    await mountPaginated();

    // buildViewRows' paginated branch sets manifestOrder: null unconditionally
    // on this path, so the
    // column is decoration in paginated mode no matter what the server sent.
    for (const slug of [AMB, CTRL_STARTER, CTRL_PAID]) {
      expect(orderChip(slug)).toBe('#-');
    }
  });
});
