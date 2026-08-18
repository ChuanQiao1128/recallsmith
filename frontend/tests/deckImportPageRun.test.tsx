// @vitest-environment jsdom
//
// DeckImportPage, steps 2 and 3: what the plan looks like on screen, what the
// gate refuses, and what the page actually hands to the runner.
//
// Written and run green against a COMPLETELY UNMODIFIED DeckImportPage.tsx
// (sha256 769221c451b1d442b4c1d60f13833d8a3aad6d6074c0c889da7c70895c1720cc).
// Sibling file: deckImportPageSource.test.tsx (step 1). Read its header first —
// the userEvent applyAccept trap and the "unreachable catch" ruling are there.
//
// WHAT BELONGS IN THIS FILE. Only behaviour a single-line edit to
// DeckImportPage.tsx can break. lib/deckImport.ts decides what a create, an
// update, a conflict and a parse error ARE, and deckImport.test.ts pins all of
// that; lib/deckImportRunner.ts decides the write order, the partial-failure
// semantics and the exact create/update bodies, and deckImportRunner.test.ts
// pins those (including expectedVersion and the ""-clearing rule at :122/:144).
// So this file never asserts issue wording, never asserts an issue line number,
// and never asserts a createCard/updateCard argument beyond deckId + stableUid.
// What is left is genuinely the page's own:
//
//   * toRows (:69-89) — a private function no library test can see. It
//     interleaves creates and updates back into DOCUMENT order, and the fixture
//     below is built so that order DISAGREES with plan order.
//   * the gate — three independent clauses in `blocked` (:224-230). The page
//     never re-decides what a conflict is; it decides whether the button is dead.
//   * the call site (:232-250) — whether {createCard, updateCard} is handed
//     over at all, whether onProgress is passed, whether a retry re-sends only
//     the failures, and whether each failure goes through describeFailure.
//     describeFailure is thoroughly unit-tested and, until this file, NOTHING
//     proved the page called it. That is the defect shape this repo keeps
//     producing, so it gets an assertion of its own (B11).
//
// THE FIXTURE IS THE POINT. In DOC the card that will be UPDATED has its header
// on line 3 and the card that will be CREATED has its header on line 9, while
// the plan is creates-then-updates. Measured with the sort removed, the rows
// come out [line 9 create, line 3 update] — i.e. the file reads backwards.
// Only an assertion on ROW ORDER can see that; counts and badges cannot.
//
// ASSERTION MECHANICS: no jest-dom (toBeNull / not.toBeNull / toHaveLength /
// toBe), no `as`, DOM handles narrowed with instanceof or thrown. Server-chosen
// strings go in through refused() and come back out as the same value.

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
  createCard: vi.fn(),
  updateCard: vi.fn(),
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
  orderInDeck: 0,
  version: 4,
});

/** cs-a-001 already identical to the document. */
const A_MATCHING = serverCard({
  id: 101,
  stableUid: 'cs-a-001',
  question: 'Alpha question',
  explanation: 'Alpha answer v2',
  difficulty: 2,
  orderInDeck: 0,
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
  return api.createCard.mock.calls.length + api.updateCard.mock.calls.length;
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
  api.createCard.mockResolvedValue(ok(B_MATCHING));
  api.updateCard.mockResolvedValue(ok(A_MATCHING));
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
    // The only assertion in the repository that can see toRows' sort. The plan
    // is [create cs-b-002, update cs-a-001]; the document is the other way
    // round. See the fixture note at the top.
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
    // Everything here is already on the server, so the write set is empty. The
    // distribution must still describe the two cards in the document — it
    // answers "what did I paste", not "what is about to change".
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_MATCHING, B_MATCHING]);

    expect(screen.queryByText('Rarity Distribution')).not.toBeNull();
    expect(screen.queryByText('Total: 2 cards')).not.toBeNull();

    // The per-tier lines, which are the mix this case is named after; the two
    // assertions above only prove the panel mounted. They are also the only
    // rendered assertion on the rarity labels themselves, which were '普通' /
    // '稀有' / '史诗' sitting inside an otherwise English panel. The label is
    // read straight from RARITY_MAP, so this fails if that map goes back to
    // carrying two spellings of one label and the wrong one is rendered.
    expect(screen.queryByText('Common: 0 (0%)')).not.toBeNull();
    expect(screen.queryByText('Rare: 1 (50%)')).not.toBeNull();
    expect(screen.queryByText('Epic: 1 (50%)')).not.toBeNull();
  });

  it('re-reads the deck when asked to refresh the reconciliation', async () => {
    // Deliberately worded as "the page asks again", not "a second request goes
    // out". In production fetchCardsByDeck is wrapped in dedupeRequest
    // (src/api/authoring.ts:365) and the module mock here replaces the whole
    // function, dedupe included — so this file cannot and does not claim
    // anything about what reaches the network.
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
  // Three independent clauses in `blocked`. Each fixture trips exactly one of
  // them and leaves the other two clean, so removing one clause must turn
  // exactly one of these cases red. Verified: deleting the slug clause reddened
  // only the wrong-deck case, the parse clause only the problems case, the
  // conflict clause only the deleted-card case. Each fixture also carries at
  // least one real action, or the button would stay disabled on the
  // `actions.length === 0` clause and the mutation would be invisible.
  //
  // HONEST ABOUT `expect(writes()).toBe(0)`: under every gate mutation run, the
  // `.disabled` assertion is the one that fails first, so the write count is
  // never the unique killer — a disabled button does not dispatch a click, so
  // no mutation can leave the attribute set and still write. It is kept because
  // it states the CONSEQUENCE the operator cares about rather than the
  // mechanism, and it would survive a rewrite of the gate to aria-disabled or
  // to a guard inside the handler. It is a second sentence, not a second tooth.

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
    // cs-b-002 exists on the server in a soft-deleted state, so creating it
    // would mint a second row for a uid that already exists. The page does not
    // re-decide that (planImport does); it decides the button is dead.
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
  it('creates the new card, updates the changed one, and says it finished', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC, [A_STALE]);

    await user.click(importButton());

    expect(await screen.findByText('All planned writes succeeded.')).not.toBeNull();
    expect(api.createCard).toHaveBeenCalledTimes(1);
    expect(api.createCard).toHaveBeenCalledWith(
      expect.objectContaining({ deckId: DECK_ID, stableUid: 'cs-b-002' }),
    );
    expect(api.updateCard).toHaveBeenCalledTimes(1);
    expect(api.updateCard).toHaveBeenCalledWith(
      expect.objectContaining({ deckId: DECK_ID, stableUid: 'cs-a-001' }),
    );

    expect(screen.queryByText(/step 3 of 3 · execute/)).not.toBeNull();
    expect(screen.queryByText('Finished')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull();
  });

  it('counts the writes off one by one while they are in flight', async () => {
    // The middle reading is the whole case. Measured with the onProgress
    // argument removed, the bar sits at "0 / 2" for the entire run and then
    // jumps straight to Finished, so only an assertion taken WHILE the second
    // write is outstanding can see it.
    const user = userEvent.setup();
    const pending = deferred<unknown>();
    api.updateCard.mockReturnValue(pending.promise);

    await toPreview(user, DOC, [A_STALE]);
    await user.click(importButton());

    await waitFor(() => expect(screen.queryByText('1 / 2')).not.toBeNull());
    expect(screen.queryByText('Writing cards...')).not.toBeNull();

    pending.resolve(ok(A_MATCHING));

    expect(await screen.findByText('2 / 2')).not.toBeNull();
    expect(screen.queryByText('Finished')).not.toBeNull();
  });

  it('explains a refused write in full, hint included', async () => {
    // Three facts in one line: which card, what the server said, and the tail
    // that only describeFailure adds. Until this case nothing anywhere proved
    // the page routed its failures through describeFailure at all.
    const user = userEvent.setup();
    api.updateCard.mockResolvedValue(refused('VERSION_CONFLICT', STALE_VERSION_MESSAGE));

    await toPreview(user, DOC, [A_STALE]);
    await user.click(importButton());

    expect(await screen.findByText('1 card failed')).not.toBeNull();
    const uid = screen.getByText('cs-a-001');
    const line = uid.parentElement;
    if (!(line instanceof HTMLElement)) throw new Error('failure line has no container');
    expect(line.textContent).toBe(
      `cs-a-001: ${STALE_VERSION_MESSAGE} Re-run the preview to refresh the reconciliation before retrying.`,
    );
  });

  it('retries only what failed, and reports the retry rather than the whole run', async () => {
    const user = userEvent.setup();
    api.updateCard.mockResolvedValue(refused('VERSION_CONFLICT', STALE_VERSION_MESSAGE));

    await toPreview(user, DOC, [A_STALE]);
    await user.click(importButton());
    await screen.findByText('1 card failed');
    expect(api.createCard).toHaveBeenCalledTimes(1);

    api.updateCard.mockResolvedValue(ok(A_MATCHING));
    await user.click(screen.getByRole('button', { name: 'Retry 1 failed' }));

    expect(await screen.findByText('All planned writes succeeded.')).not.toBeNull();
    // The card that already succeeded must NOT be written a second time.
    expect(api.createCard).toHaveBeenCalledTimes(1);
    expect(api.updateCard).toHaveBeenCalledTimes(2);
    expect(api.updateCard).toHaveBeenLastCalledWith(
      expect.objectContaining({ deckId: DECK_ID, stableUid: 'cs-a-001' }),
    );
    expect(badgeStrip('created').slice(0, 3)).toEqual(['0created', '1updated', '0failed']);
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
