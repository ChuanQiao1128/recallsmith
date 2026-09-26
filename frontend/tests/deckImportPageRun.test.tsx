// @vitest-environment jsdom
//
// DeckImportPage, steps 2 and 3: what the plan looks like on screen, what the
// gate refuses, and what the page actually hands to the batch runner.
//
// WHAT BELONGS IN THIS FILE. Only behaviour a single-line edit to
// DeckImportPage.tsx can break. lib/deckImport.ts decides what a create, an
// update, a conflict and a parse error ARE, and deckImport.test.ts pins that;
// lib/deckImportRunner.ts decides batching, backoff and the exact card bodies,
// and deckImportRunner.test.ts / deckImportBatchRunner.test.ts pin those. So this
// file never asserts issue wording or line numbers, and only asserts the batch
// writer's arguments as far as deckId + stableUid. What is left is the page's
// own: toRows' document-order sort, the three-clause gate, and the call site —
// whether importCardsBatch is handed over, whether onProgress drives the bar,
// whether a failure offers a re-preview rather than replaying stale actions, and
// whether each failure goes through describeFailure.
//
// THE FIXTURE IS THE POINT. In DOC the card that will be UPDATED has its header
// on line 3 and the card that will be CREATED has its header on line 9, while
// the plan is creates-then-updates, so only an assertion on ROW ORDER can see
// toRows' sort.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { deferred, ok, refused } from './support/apiResult';
import { locationText, renderAt } from './support/routerProbe';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  importCardsBatch: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckImportPage } = await import('../src/pages/DeckImportPage');

const DECK_ID = 7;
const DECK_SLUG = 'csharp-backend-fundamentals';
const OTHER_SLUG = 'python-basics';
const STALE_VERSION_MESSAGE = 'Card 101 was modified by someone else.';

const deck: Deck = {
  id: DECK_ID,
  slug: DECK_SLUG,
  title: 'C# Backend Fundamentals',
  author: 'console-tests',
  description: 'Interview prep',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

/**
 * Document order fights plan order on purpose: the UPDATE is on line 3, the
 * CREATE is on line 9, and planImport emits creates before updates.
 */
function body(slug: string): string {
  return [
    `# deck: ${slug}`, //            1
    '', //                           2
    '## cs-a-001 | d2', //           3   -> update (explanation differs)
    'Q:', //                         4
    'Alpha question', //             5
    'A:', //                         6
    'Alpha answer v2', //            7
    '', //                           8
    '## cs-b-002 | d3', //           9   -> create (no such uid on the server)
    'Q:', //                        10
    'Beta question', //             11
    'A:', //                        12
    'Beta answer', //               13
    '', //                          14
  ].join('\n');
}

const DOC = body(DECK_SLUG);
const DOC_WRONG_DECK = body(OTHER_SLUG);

/** One good card plus two structurally broken ones: 2 parse errors, 1 action. */
const DOC_TWO_PROBLEMS = [
  `# deck: ${DECK_SLUG}`, //   1
  '', //                       2
  '## cs-b-002 | d3', //       3   -> a perfectly good create
  'Q:', //                     4
  'Beta question', //          5
  'A:', //                     6
  'Beta answer', //            7
  '', //                       8
  '## cs-c-003 | d1', //       9   -> no A: section
  'Q:', //                    10
  'Gamma question', //        11
  '', //                      12
  '## cs-d-004 | d1', //      13   -> no Q: section
  'A:', //                    14
  'Delta answer', //          15
  '', //                      16
].join('\n');

/** Same shape, one broken card, so the singular wording is held too. */
const DOC_ONE_PROBLEM = [
  `# deck: ${DECK_SLUG}`,
  '',
  '## cs-b-002 | d3',
  'Q:',
  'Beta question',
  'A:',
  'Beta answer',
  '',
  '## cs-c-003 | d1',
  'Q:',
  'Gamma question',
  '',
].join('\n');

function serverCard(over: Partial<Card> & Pick<Card, 'id' | 'stableUid'>): Card {
  return {
    deckId: DECK_ID,
    question: '',
    explanation: '',
    difficulty: 0,
    orderInDeck: 0,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

/** cs-a-001 as the server has it: same question, older answer -> one update. */
const A_STALE = serverCard({
  id: 101,
  stableUid: 'cs-a-001',
  question: 'Alpha question',
  explanation: 'Alpha answer v1',
  difficulty: 2,
  orderInDeck: 5,
  version: 4,
});

/** cs-a-001 already identical to the document. */
const A_MATCHING = serverCard({
  id: 101,
  stableUid: 'cs-a-001',
  question: 'Alpha question',
  explanation: 'Alpha answer v2',
  difficulty: 2,
  orderInDeck: 5,
  version: 4,
});

/** cs-b-002 already identical to the document. */
const B_MATCHING = serverCard({
  id: 102,
  stableUid: 'cs-b-002',
  question: 'Beta question',
  explanation: 'Beta answer',
  difficulty: 3,
  orderInDeck: 10,
  version: 1,
});

/** cs-b-002 exists but is soft deleted: creating it again would collide. */
const B_SOFT_DELETED = serverCard({
  id: 103,
  stableUid: 'cs-b-002',
  question: 'Beta question',
  explanation: 'Beta answer',
  difficulty: 3,
  orderInDeck: 10,
  version: 1,
  isDeleted: 1,
});

// ---------------------------- handles ----------------------------

function sourceBox(): HTMLTextAreaElement {
  const el = document.querySelector('textarea');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('no textarea on the page');
  return el;
}

/** Found by shape, not by label, so a plural bug cannot break the lookup. */
function importButton(): HTMLButtonElement {
  const el = screen.getByRole('button', { name: /^Import \d+ card/ });
  if (!(el instanceof HTMLButtonElement)) throw new Error('import control is not a button');
  return el;
}

/** The badge row containing `anchor`, read left to right as the user sees it. */
function badgeStrip(anchor: string): string[] {
  const label = screen.getByText(anchor);
  const strip = label.parentElement?.parentElement;
  if (!(strip instanceof HTMLElement)) throw new Error(`no badge strip around "${anchor}"`);
  return Array.from(strip.children).map(c => c.textContent ?? '');
}

/** [line, stableUid, action] per rendered row, in the order they are painted. */
function rowSummaries(): string[][] {
  return Array.from(document.querySelectorAll('tbody tr')).map(tr => {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent ?? '');
    return [cells[0], cells[1], cells[4]];
  });
}

function writes(): number {
  return api.importCardsBatch.mock.calls.length;
}

/** The stableUids of the cards sent in batch `n`, sorted so order is not asserted here. */
function batchUids(n = 0): string[] {
  const arg = api.importCardsBatch.mock.calls[n][0] as { cards: Array<{ stableUid: string }> };
  return arg.cards.map(c => c.stableUid).sort();
}

async function toPreview(
  user: ReturnType<typeof userEvent.setup>,
  doc: string,
  existing: Card[],
): Promise<void> {
  api.fetchCardsByDeck.mockResolvedValue(ok(existing));
  renderAt(<DeckImportPage />, [`/decks/import?deckId=${DECK_ID}`]);
  await screen.findByText('1 · Source');
  await user.click(sourceBox());
  await user.paste(doc);
  await user.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('2 · Preview');
}

beforeEach(() => {
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([A_STALE]));
  api.importCardsBatch.mockResolvedValue(ok({ created: 1, updated: 1, unchanged: 0 }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ------------------------------------------------------------------
// B1 - B4 — projecting the plan onto the screen
// ------------------------------------------------------------------

describe('the preview table', () => {
  it('reads in document order, not in the order the writes will happen', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_STALE]);

    expect(rowSummaries()).toEqual([
      ['3', 'cs-a-001', 'update'],
      ['9', 'cs-b-002', 'create'],
    ]);
  });

  it('counts the five outcomes and how many cards were parsed', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_STALE]);

    expect(badgeStrip('parse errors')).toEqual([
      '1create',
      '1update',
      '0unchanged',
      '0conflict',
      '0parse errors',
    ]);
    expect(screen.queryByText('2 parsed')).not.toBeNull();
  });

  it('shows the rarity mix of the whole document, including cards nothing will happen to', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_MATCHING, B_MATCHING]);

    expect(screen.queryByText('Rarity Distribution')).not.toBeNull();
    expect(screen.queryByText('Total: 2 cards')).not.toBeNull();

    expect(screen.queryByText('Common: 0 (0%)')).not.toBeNull();
    expect(screen.queryByText('Rare: 1 (50%)')).not.toBeNull();
    expect(screen.queryByText('Epic: 1 (50%)')).not.toBeNull();
  });

  it('re-reads the deck when asked to refresh the reconciliation', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_STALE]);
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Refresh reconciliation' }));

    await waitFor(() => expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(2));
  });
});

// ------------------------------------------------------------------
// B5 - B8 — the gate
// ------------------------------------------------------------------

describe('the gate on the import button', () => {
  it('refuses a document written for a different deck, and names both decks', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC_WRONG_DECK, [A_STALE]);

    const banner = screen.getByText(/This document targets deck/);
    expect(within(banner).queryByText(OTHER_SLUG)).not.toBeNull();
    expect(within(banner).queryByText(DECK_SLUG)).not.toBeNull();

    expect(importButton().disabled).toBe(true);
    await user.click(importButton());
    expect(writes()).toBe(0);
  });

  it('refuses a document with problems in it, and says how many', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC_TWO_PROBLEMS, []);

    expect(screen.queryByText('2 problems in the document')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(badgeStrip('parse errors')[4]).toBe('2parse errors');

    expect(importButton().disabled).toBe(true);
    await user.click(importButton());
    expect(writes()).toBe(0);
  });

  it('says "1 problem" when there is exactly one', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC_ONE_PROBLEM, []);

    expect(screen.queryByText('1 problem in the document')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('refuses a document that collides with a deleted card', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_STALE, B_SOFT_DELETED]);

    expect(badgeStrip('parse errors')).toEqual([
      '0create',
      '1update',
      '0unchanged',
      '1conflict',
      '0parse errors',
    ]);

    expect(importButton().disabled).toBe(true);
    await user.click(importButton());
    expect(writes()).toBe(0);
  });

  it('offers nothing to do when the document already matches the deck', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_MATCHING, B_MATCHING]);

    expect(importButton().textContent).toBe('Import 0 cards');
    expect(importButton().disabled).toBe(true);
    expect(screen.queryByText('Everything in this document already matches the deck.')).not.toBeNull();
  });
});

// ------------------------------------------------------------------
// B9 - B12 — the call site
// ------------------------------------------------------------------

describe('executing the plan', () => {
  it('sends the whole plan as one batch and says it finished', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_STALE]);

    await user.click(importButton());

    expect(await screen.findByText('All planned writes succeeded.')).not.toBeNull();
    expect(api.importCardsBatch).toHaveBeenCalledTimes(1);
    const arg = api.importCardsBatch.mock.calls[0][0] as { deckId: number };
    expect(arg.deckId).toBe(DECK_ID);
    expect(batchUids()).toEqual(['cs-a-001', 'cs-b-002']);
    expect(badgeStrip('created').slice(0, 3)).toEqual(['1created', '1updated', '0failed']);

    expect(screen.queryByText(/step 3 of 3 · execute/)).not.toBeNull();
    expect(screen.queryByText('Finished')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull();
  });

  it('shows the bar moving while the batch is in flight, then the final count', async () => {
    // With onProgress removed the bar would sit at "0 / 2" and jump to Finished,
    // so the observation that matters is taken WHILE the batch is outstanding.
    const user = userEvent.setup();
    const pending = deferred<unknown>();
    api.importCardsBatch.mockReturnValue(pending.promise);

    await toPreview(user, DOC, [A_STALE]);
    await user.click(importButton());

    await waitFor(() => expect(screen.queryByText('Writing cards...')).not.toBeNull());
    expect(screen.queryByText('0 / 2')).not.toBeNull();

    pending.resolve(ok({ created: 1, updated: 1, unchanged: 0 }));

    expect(await screen.findByText('2 / 2')).not.toBeNull();
    expect(screen.queryByText('Finished')).not.toBeNull();
  });

  it('explains a refused batch in full, hint included', async () => {
    // Three facts in one line: which card, what the server said, and the tail that
    // only describeFailure adds. A refused batch rolls back, so every card in it
    // is reported.
    const user = userEvent.setup();
    api.importCardsBatch.mockResolvedValue(refused('VERSION_CONFLICT', STALE_VERSION_MESSAGE));

    await toPreview(user, DOC, [A_STALE]);
    await user.click(importButton());

    expect(await screen.findByText('2 cards failed')).not.toBeNull();
    const uid = screen.getByText('cs-a-001');
    const line = uid.parentElement;
    if (!(line instanceof HTMLElement)) throw new Error('failure line has no container');
    expect(line.textContent).toBe(
      `cs-a-001: ${STALE_VERSION_MESSAGE} Re-run the preview to refresh the reconciliation before retrying.`,
    );
  });

  it('offers a re-preview after a failure rather than replaying stale actions', async () => {
    // Replaces the old "retry only what failed": the batch endpoint is planned
    // against fresh server state, never replayed with the plan-time versions.
    const user = userEvent.setup();
    api.importCardsBatch.mockResolvedValue(refused('VERSION_CONFLICT', STALE_VERSION_MESSAGE));

    await toPreview(user, DOC, [A_STALE]);
    await user.click(importButton());
    await screen.findByText('2 cards failed');
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Re-run the preview' }));

    // Re-preview re-reads the deck instead of re-sending the failed batch.
    await waitFor(() => expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(2));
    expect(api.importCardsBatch).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------------
// B13 - B14 — getting back out
// ------------------------------------------------------------------

describe('after a run', () => {
  it('starts over without throwing away the document that was typed', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_STALE]);
    await user.click(importButton());
    await screen.findByText('All planned writes succeeded.');

    await user.click(screen.getByRole('button', { name: 'Start over' }));

    expect(screen.queryByText('1 · Source')).not.toBeNull();
    expect(sourceBox().value).toBe(DOC);
  });

  it('leads back to the cards of the deck that was imported into', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_STALE]);
    await user.click(importButton());
    await screen.findByText('All planned writes succeeded.');

    await user.click(screen.getByRole('link', { name: 'Back to cards →' }));

    expect(locationText()).toBe(`/decks/cards?deckId=${DECK_ID}`);
  });
});
