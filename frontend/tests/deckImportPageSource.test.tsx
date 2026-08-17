// @vitest-environment jsdom
//
// DeckImportPage, step 1: getting a document into the page at all.
//
// Written and run green against a COMPLETELY UNMODIFIED DeckImportPage.tsx
// (sha256 769221c451b1d442b4c1d60f13833d8a3aad6d6074c0c889da7c70895c1720cc).
// Before this file and its sibling deckImportPageRun.test.tsx, no test in the
// repository imported this page. deckImport.test.ts and deckImportRunner.test.ts
// cover the libraries underneath it; cardRuleDivergence.test.tsx renders CardForm
// and only mentions this page in a prose comment.
//
// WHAT BELONGS IN THIS FILE. Only behaviour a single-line edit to
// DeckImportPage.tsx can break. Anything that needs an edit to lib/deckImport.ts
// or lib/deckImportRunner.ts to go red is already guarded one layer down, and a
// copy here would buy line coverage and nothing else. So there is no assertion
// on issue wording or issue line numbers (deckImport.test.ts:116-244 pins those
// verbatim) — this file only ever counts problems and checks the gate.
//
// ------------------------------------------------------------------
// THE TRAP THAT SILENTLY EMPTIES THE REJECTION CASE (measured twice)
// ------------------------------------------------------------------
// jsdom 29 has no DataTransfer (`typeof DataTransfer === 'undefined'`, measured)
// and no way to build a FileList, so the "construct a drop payload" route does
// not exist here. userEvent.upload builds the FileList-shaped object itself and
// dispatches input+change, which enters through the page's real
// `onChange={e => handleFile(e.target.files?.[0] ?? null)}` — the wiring under
// test. handleFile is not exported, so calling it directly is both impossible
// and would skip that line.
//
// But `upload` filters candidates against the input's `accept` attribute by
// default, and this page's input carries accept=".md,.txt,...". Uploading
// notes.png therefore fires NO change event at all, the page's own
// "Only .md and .txt files are accepted." never appears, and a rejection test
// degenerates into asserting that nothing happened — permanently green.
// Measured: with the default setup the message did not appear; with
// `userEvent.setup({ applyAccept: false })` it did.
//
// applyAccept:false is also the MORE faithful simulation. In a real browser
// `accept` only pre-filters the file dialog; the user can still switch to
// "All Files" and pick anything, which is the entire reason the page carries its
// own extension check. Every case below that feeds this page a bad file uses
// the lenient setup, and says so at the call site.
//
// ------------------------------------------------------------------
// TWO BRANCHES DELIBERATELY NOT TESTED
// ------------------------------------------------------------------
// DeckImportPage.tsx:143-150 and :212-214 are catch blocks that produce
// 'Network error.'. They are unreachable through the real api layer:
// src/api/authoring.ts:128-148 (fetchDeckById) and :364-379 (fetchCardsByDeck)
// each wrap their call in try/catch and `return fail(toApiErrorMessage(err))`,
// so the page receives a RESOLVED ApiResult and never a rejection. Pointing a
// mock at a rejected promise would manufacture a state the application cannot
// enter and report dead-code coverage as behaviour coverage.
// tests/deckEditPageLoad.test.tsx made the same call on the same shape. Failure
// cases here therefore use networkFailure(), which is resolved and carries code
// NETWORK_ERROR — exactly what the api layer hands up.
//
// ------------------------------------------------------------------
// ASSERTION MECHANICS
// ------------------------------------------------------------------
// Do NOT use getByDisplayValue for the source document. RTL's default
// normalizer collapses whitespace, so a multi-line document never matches:
// measured, queryByDisplayValue(DOC) returned null against a page whose
// textarea.value was byte-identical to DOC. Read textarea.value after narrowing
// with instanceof instead.
//
// Strings the server chose are passed in through refused()/networkFailure() and
// asserted as the same value, never against a fallback the page hard-codes. The
// one exception is the fallback case itself (A5), where the fallback IS the
// behaviour under test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { deferred, networkFailure, ok, refused } from './support/apiResult';
import { renderAt } from './support/routerProbe';

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
const DECK_REFUSAL = 'You may not read this deck.';
const DROPPED_CONNECTION = 'socket hang up';
const CARDS_REFUSAL = 'The card index is being rebuilt; try again in a minute.';

const deck: Deck = {
  id: DECK_ID,
  slug: 'csharp-backend-fundamentals',
  title: 'C# Backend Fundamentals',
  author: 'console-tests',
  description: 'Interview prep',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

/** Two cards, deliberately short: this file never inspects the plan. */
const DOC = [
  '# deck: csharp-backend-fundamentals',
  '',
  '## cs-a-001 | d2',
  'Q:',
  'Alpha question',
  'A:',
  'Alpha answer',
  '',
].join('\n');

const existingCards: Card[] = [];

function mount(query = `?deckId=${DECK_ID}`) {
  return renderAt(<DeckImportPage />, [`/decks/import${query}`]);
}

function fileInput(): HTMLInputElement {
  const el = document.querySelector('input[type="file"]');
  if (!(el instanceof HTMLInputElement)) throw new Error('no file input on the page');
  return el;
}

function sourceBox(): HTMLTextAreaElement {
  const el = document.querySelector('textarea');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('no textarea on the page');
  return el;
}

function previewButton(): HTMLButtonElement {
  const el = screen.getByRole('button', { name: /Preview import|Reading deck/ });
  if (!(el instanceof HTMLButtonElement)) throw new Error('preview control is not a button');
  return el;
}

function md(name: string, body = DOC): File {
  return new File([body], name, { type: 'text/markdown' });
}

beforeEach(() => {
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok(existingCards));
  api.createCard.mockResolvedValue(ok(null));
  api.updateCard.mockResolvedValue(ok(null));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------
// A1 / A2 — the deckId guard
// ------------------------------------------------------------------

describe('a deckId the page will not accept', () => {
  // Every case asserts the CALL COUNT, not only the message. A guard that
  // renders the error and issues the request anyway satisfies a text-only
  // assertion, and this repo has shipped that shape more than once — the
  // sibling AdminUsersPage still does exactly that with its access gate.
  const cases: Array<[string, string]> = [
    ['no deckId in the query at all', ''],
    ['a deckId that is not a number', '?deckId=abc'],
    ['deckId=0', '?deckId=0'],
    ['a negative deckId', '?deckId=-3'],
  ];

  for (const [name, query] of cases) {
    it(`refuses ${name} without asking the server`, async () => {
      mount(query);

      expect(await screen.findByText('Missing or invalid deckId.')).not.toBeNull();
      expect(api.fetchDeckById).toHaveBeenCalledTimes(0);
      expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(0);
    });
  }

  it('still offers a way out of the dead end', async () => {
    mount('?deckId=0');

    await screen.findByText('Missing or invalid deckId.');
    const back = screen.getByRole('link', { name: '← Back to Decks' });
    expect(back.getAttribute('href')).toBe('/');
  });
});

describe('CHARACTERIZATION (records a defect, does not endorse it): deckIds that are not whole numbers', () => {
  // The guard is `!deckId || Number.isNaN(deckId) || deckId <= 0`, so a
  // fractional, exponent-notation or infinite deckId sails through and is sent
  // to the server as-is. The sibling page DeckEditPage uses Number.isFinite and
  // refuses the same inputs, so the console disagrees with itself about what a
  // deck id is.
  //
  // The fix is Number.isInteger (or at minimum Number.isFinite) in the guard on
  // DeckImportPage.tsx:105. THE FRACTION AND INFINITY CASES WILL GO RED WHEN
  // SOMEONE APPLIES IT, AND THAT IS THE INTENDED ALARM, not a regression: they
  // exist so the behaviour cannot change silently. Same precedent as
  // cardRuleDivergence.test.tsx and deckFormFieldDrop.test.tsx.
  //
  // The exponent case is different and is here to keep the record straight:
  // Number('1e3') is 1000, a perfectly ordinary integer, so it survives both
  // guards. Measured — with Number.isInteger patched in, the fraction and
  // Infinity cases went red and this one stayed green. It documents that the
  // query string, not the guard, is where "1e3" stops being surprising.
  const leaky: Array<[string, string, number]> = [
    ['a fraction', '?deckId=7.5', 7.5],
    ['exponent notation', '?deckId=1e3', 1000],
    ['Infinity', '?deckId=Infinity', Number.POSITIVE_INFINITY],
  ];

  for (const [name, query, sent] of leaky) {
    it(`today lets ${name} through to the server`, async () => {
      mount(query);

      await waitFor(() => expect(api.fetchDeckById).toHaveBeenCalledTimes(1));
      expect(api.fetchDeckById).toHaveBeenCalledWith(sent);
      expect(screen.queryByText('Missing or invalid deckId.')).toBeNull();
    });
  }
});

// ------------------------------------------------------------------
// A3 - A6 — the three ways loading a deck can end
// ------------------------------------------------------------------

describe('while the deck is on its way', () => {
  it('says it is loading, and offers nothing to type into yet', async () => {
    const d = deferred<unknown>();
    api.fetchDeckById.mockReturnValue(d.promise);

    mount();

    expect(screen.queryByText('Loading deck...')).not.toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    d.resolve(ok(deck));
    await screen.findByText('1 · Source');
  });
});

describe('a deck that will not load', () => {
  it('shows the sentence the server chose, not a guess of its own', async () => {
    api.fetchDeckById.mockResolvedValue(refused('FORBIDDEN', DECK_REFUSAL));

    mount();

    expect(await screen.findByText('Failed to load deck')).not.toBeNull();
    expect(screen.queryByText(DECK_REFUSAL)).not.toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports a dropped connection in the same place, in its own words', async () => {
    // Shares a mutation with the case above (both die when the page replaces
    // `result.error?.message ?? ...` with a constant). Reported as a shared
    // tooth: the pair is one guard on "print what you were told", and separate
    // only in that each proves its own ApiResult shape reaches the same screen.
    api.fetchDeckById.mockResolvedValue(networkFailure(DROPPED_CONNECTION));

    mount();

    expect(await screen.findByText('Failed to load deck')).not.toBeNull();
    expect(screen.queryByText(DROPPED_CONNECTION)).not.toBeNull();
  });

  it('treats success with an empty body as "not found" rather than an empty editor', async () => {
    // The one place this file asserts a string the page hard-codes: here the
    // fallback IS the behaviour, because the server sent no message to print.
    api.fetchDeckById.mockResolvedValue(ok(null));

    mount();

    expect(await screen.findByText('Deck not found.')).not.toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });
});

// ------------------------------------------------------------------
// A7 - A11 — turning a File into text
// ------------------------------------------------------------------

describe('loading a document from a file', () => {
  it('puts the file contents in the box and names the file it came from', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('1 · Source');

    await user.upload(fileInput(), md('deck.md'));

    await waitFor(() => expect(sourceBox().value).toBe(DOC));
    expect(screen.queryByText('deck.md')).not.toBeNull();
  });

  it('refuses a file it cannot read, keeps the box empty, and resets the picker', async () => {
    // applyAccept:false — see the header. With the default setup the browser
    // filter swallows notes.png, no change event fires, and this case would
    // pass while asserting nothing.
    const user = userEvent.setup({ applyAccept: false });
    mount();
    await screen.findByText('1 · Source');

    await user.upload(fileInput(), new File(['not markdown'], 'notes.png', { type: 'image/png' }));

    expect(await screen.findByText('Only .md and .txt files are accepted.')).not.toBeNull();
    expect(sourceBox().value).toBe('');
    // The picker must be cleared, or choosing the SAME wrong file again fires
    // no change event and the page looks like it silently accepted it.
    expect(fileInput().files).toHaveLength(0);
    expect(fileInput().value).toBe('');
  });

  it('does not wipe a document already loaded when the next pick is rejected', async () => {
    const good = userEvent.setup();
    const lenient = userEvent.setup({ applyAccept: false });
    mount();
    await screen.findByText('1 · Source');

    await good.upload(fileInput(), md('deck.md'));
    await waitFor(() => expect(sourceBox().value).toBe(DOC));

    await lenient.upload(fileInput(), new File(['x'], 'notes.png', { type: 'image/png' }));

    expect(await screen.findByText('Only .md and .txt files are accepted.')).not.toBeNull();
    expect(sourceBox().value).toBe(DOC);
    expect(screen.queryByText('deck.md')).not.toBeNull();
  });

  it('says so when the file cannot be read, instead of loading nothing quietly', async () => {
    // The one global stub in this file. A real FileReader in jsdom always
    // succeeds on an in-memory File, so the failure path is unreachable
    // otherwise — unlike the api-layer catch blocks above, this branch IS
    // reachable in a browser (a file deleted or unshared between the pick and
    // the read), so it is worth holding.
    class FailingFileReader {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result: string | null = null;
      readAsText(): void {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', FailingFileReader);

    const user = userEvent.setup();
    mount();
    await screen.findByText('1 · Source');

    await user.upload(fileInput(), md('deck.md'));

    expect(await screen.findByText('Could not read that file.')).not.toBeNull();
    expect(sourceBox().value).toBe('');
    expect(screen.queryByText('deck.md')).toBeNull();
  });

  it('drops the file name once the text has been edited by hand', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('1 · Source');

    await user.upload(fileInput(), md('deck.md'));
    await waitFor(() => expect(screen.queryByText('deck.md')).not.toBeNull());

    await user.type(sourceBox(), 'x');

    expect(screen.queryByText('deck.md')).toBeNull();
  });

  // DELIBERATELY ABSENT: a case for the null half of
  // `e.target.files?.[0] ?? null` (the `if (!file) return` guard at :162).
  //
  // Two versions were written and both were thrown away, and the reason is
  // worth leaving here so the next person does not write a third.
  //
  // The first uploaded a good file and then fired a second change event to
  // stand for "the operator cancelled the dialog". Worthless: fireEvent does
  // not clear input.files, so the page received the SAME File again and never
  // reached the null branch at all. The mutation that deletes the guard left it
  // green, which is how the emptiness was found rather than assumed.
  //
  // The second dispatched change on a freshly mounted page, whose file input
  // does carry an empty FileList (measured: length 0, not null). That really
  // does reach handleFile(null), and with the guard deleted it really does
  // throw "Cannot read properties of null (reading 'name')" — the TypeError was
  // observed in the run. It STILL passed: React 19 reports an error thrown in
  // an event handler and leaves the tree standing, so every assertion available
  // ("the box is still empty", "no message appeared") holds either way. A case
  // that cannot go red is not a test.
  //
  // The branch is defensive code with no modern-browser path to it — Chrome and
  // Firefox fire no change event when a file dialog is cancelled — so it is
  // recorded here instead of being covered by something that only looks like
  // coverage.
});

// ------------------------------------------------------------------
// A12 - A14 — leaving step 1
// ------------------------------------------------------------------

describe('the preview button', () => {
  const blank: Array<[string, string]> = [
    ['an untouched page', ''],
    ['a document of nothing but whitespace', '   \n  '],
  ];

  for (const [name, body] of blank) {
    it(`is dead on ${name}, and asks the server nothing when clicked`, async () => {
      const user = userEvent.setup();
      mount();
      await screen.findByText('1 · Source');

      if (body) fireEvent.change(sourceBox(), { target: { value: body } });

      expect(previewButton().disabled).toBe(true);
      await user.click(previewButton());
      expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(0);
    });
  }

  it('names what it is doing while the deck is being re-read, and locks itself', async () => {
    const user = userEvent.setup();
    const d = deferred<unknown>();
    api.fetchCardsByDeck.mockReturnValue(d.promise);

    mount();
    await screen.findByText('1 · Source');
    await user.click(sourceBox());
    await user.paste(DOC);
    await user.click(previewButton());

    expect(screen.queryByRole('button', { name: 'Reading deck...' })).not.toBeNull();
    expect(previewButton().disabled).toBe(true);

    d.resolve(ok(existingCards));

    expect(await screen.findByText('2 · Preview')).not.toBeNull();
  });

  it('keeps the operator on the source step when the deck contents will not load', async () => {
    // The important half is the STEP, not the message. A page that shows the
    // error and walks on to step 2 anyway would reconcile the document against
    // an empty card list and offer to create every card in it.
    const user = userEvent.setup();
    api.fetchCardsByDeck.mockResolvedValue(refused('UNAVAILABLE', CARDS_REFUSAL));

    mount();
    await screen.findByText('1 · Source');
    await user.click(sourceBox());
    await user.paste(DOC);
    await user.click(previewButton());

    expect(await screen.findByText(CARDS_REFUSAL)).not.toBeNull();
    expect(screen.queryByText(/step 1 of 3 · source/)).not.toBeNull();
    expect(screen.queryByText('2 · Preview')).toBeNull();
    expect(screen.queryByText('Cards in this document')).toBeNull();
  });
});
