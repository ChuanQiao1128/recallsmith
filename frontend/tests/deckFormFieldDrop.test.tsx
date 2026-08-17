// @vitest-environment jsdom
//
// Two defects of one shape, on the two deck forms: fields that are collected,
// rendered, kept in state, and — on three of them — VALIDATED, and then never
// put into the request. The control works. The field does not.
//
//   D1  NewDeckPage keeps locale, deckType, contentVersion and freeCardCount in
//       NewDeckForm. contentVersion is required and must parse as semver;
//       freeCardCount is required to be non-negative on a Paid deck. A user who
//       fails either of those checks is stopped and made to fix it. The call
//       that follows is createDeck({ slug, title, author, description }) — all
//       four fields are dropped on the floor, the semver they were forced to
//       correct included.
//
//   D2  DeckEditPage keeps author, locale, deckType and version, and author is
//       one of the three fields whose emptiness aborts the save with
//       'slug / title / author are required.'. The PUT body contains none of
//       the four. Editing the author of a deck therefore does nothing at all,
//       while clearing it still blocks the save.
//
// PROVENANCE, AND HOW THIS FILE DIFFERS FROM THE OTHER FOUR.
// The other four nets in this batch pin behaviour that must survive: they are
// meant to stay green through any refactor. This one is the opposite. It pins
// behaviour that is WRONG, so that the defect cannot be quietly re-introduced
// or quietly half-fixed, and so the size of the fix is written down. When
// somebody wires these fields through to the API, THIS FILE WILL GO RED. That
// is the point of it, and it is not a regression — the red assertions below are
// the checklist for the fix. Same convention as tests/cardEntryDefects.test.tsx.
//
// WHY toStrictEqual AND NOT a set of `expect(payload().locale).toBeUndefined()`
// lines: a per-key absence assertion is satisfied by a payload that grew three
// other fields nobody meant to send. The whole literal states the complete
// request, so it is red for a field appearing as well as for one going missing.
// That property was measured (see deckEditPageSave.test.tsx's header note):
// adding a field leaves expect.objectContaining green and takes toStrictEqual
// red.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ok } from './support/apiResult';
import { renderAt } from './support/routerProbe';

const api = vi.hoisted(() => ({
  createDeck: vi.fn(),
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  updateDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { NewDeckPage } = await import('../src/pages/NewDeckPage');
const { DeckEditPage } = await import('../src/pages/DeckEditPage');

const DECK_ID = 7;

const deck: Deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  author: 'original-author',
  description: 'Interview prep',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  tier: null,
  availability: 'live',
  manifestOrder: 4,
  totalCards: 120,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const oneCard: Card = {
  id: 1,
  deckId: DECK_ID,
  stableUid: 'card-1',
  question: 'Question 1',
  difficulty: 2,
  orderInDeck: 1,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.createDeck.mockResolvedValue(ok(deck));
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([oneCard]));
  api.updateDeck.mockResolvedValue(ok(deck));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('D1 NewDeckPage collects four fields it never sends', () => {
  const titleBox = () => screen.getByPlaceholderText('JavaScript Core Basics') as HTMLInputElement;
  const slugBox = () => screen.getByPlaceholderText('js-core-basics') as HTMLInputElement;
  const authorBox = () => screen.getByPlaceholderText('RecallSmith Team') as HTMLInputElement;
  const versionBox = () => screen.getByPlaceholderText('1.0.0') as HTMLInputElement;
  const localeBox = () => screen.getByLabelText('Locale') as HTMLSelectElement;

  /** Fill the form with a value in every box that is NOT the default. */
  async function fillEverything(): Promise<void> {
    renderAt(<NewDeckPage />, ['/decks/new']);
    fireEvent.change(titleBox(), { target: { value: 'JavaScript Core Basics' } });
    // change, not type: the slug box slugifies on every keystroke, so typed
    // hyphens are eaten. Recorded separately; here it is only mechanism.
    fireEvent.change(slugBox(), { target: { value: 'js-core-basics' } });
    fireEvent.change(authorBox(), { target: { value: 'Leo' } });
    fireEvent.change(screen.getByPlaceholderText('A deck for core interview concepts...'), {
      target: { value: 'Core concepts' },
    });
    await userEvent.selectOptions(localeBox(), 'zh-CN');
    await userEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.change(screen.getByLabelText('Free Card Count'), { target: { value: '7' } });
    fireEvent.change(versionBox(), { target: { value: '9.9.9' } });
  }

  it('shows all four fields working: they take input and the screen agrees', async () => {
    await fillEverything();

    // The positive half. Without it, the assertion below could be satisfied by
    // controls that are broken, read-only or absent, and the defect would be
    // mis-stated as "the fields do not work" rather than "the fields work and
    // the request ignores them".
    expect(localeBox().value).toBe('zh-CN');
    expect((screen.getAllByRole('radio')[1] as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('false')).not.toBeNull(); // IsFreeStarter, derived from deckType
    expect((screen.getByLabelText('Free Card Count') as HTMLInputElement).value).toBe('7');
    expect(versionBox().value).toBe('9.9.9');
  });

  it('sends only slug, title, author and description', async () => {
    await fillEverything();
    await userEvent.click(screen.getByRole('button', { name: 'Create Deck' }));

    await waitFor(() => expect(api.createDeck).toHaveBeenCalledTimes(1));
    // WHEN THIS GOES RED, READ IT AS THE FIX LANDING, NOT AS A BREAKAGE.
    // The four missing keys are locale ('zh-CN'), deckType (2),
    // contentVersion ('9.9.9') and freeCardCount (7) — every one of them a
    // value the user chose on this screen, and two of them values the page
    // refused to submit until they were valid.
    expect(api.createDeck.mock.calls[0][0]).toStrictEqual({
      slug: 'js-core-basics',
      title: 'JavaScript Core Basics',
      author: 'Leo',
      description: 'Core concepts',
    });
  });
});

describe('D2 DeckEditPage collects four fields it never sends', () => {
  async function mountAndEdit(): Promise<void> {
    renderAt(<DeckEditPage />, [`/decks/edit?deckId=${DECK_ID}`]);
    await screen.findByRole('button', { name: 'Save' });

    await userEvent.clear(screen.getByLabelText('Author *'));
    await userEvent.type(screen.getByLabelText('Author *'), 'Leo');
    await userEvent.clear(screen.getByLabelText('Locale'));
    await userEvent.type(screen.getByLabelText('Locale'), 'zh-CN');
    await userEvent.selectOptions(screen.getByLabelText('Deck Type'), '2');
    await userEvent.clear(screen.getByLabelText(/^Draft Version/));
    await userEvent.type(screen.getByLabelText(/^Draft Version/), '9');
  }

  it('shows all four fields working: they take input and the screen agrees', async () => {
    await mountAndEdit();

    expect((screen.getByLabelText('Author *') as HTMLInputElement).value).toBe('Leo');
    expect((screen.getByLabelText('Locale') as HTMLInputElement).value).toBe('zh-CN');
    expect((screen.getByLabelText('Deck Type') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText(/^Draft Version/) as HTMLInputElement).value).toBe('9');
  });

  it('sends a body with none of the four in it', async () => {
    await mountAndEdit();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    // WHEN THIS GOES RED, READ IT AS THE FIX LANDING, NOT AS A BREAKAGE.
    // author, locale, deckType and version are all absent. deckType is not
    // entirely inert — it feeds effectiveTier, which is why previewCards turned
    // into a number here — but the value itself never reaches the database, so
    // the next load resets the control to 1 and the edit is silently discarded.
    expect(api.updateDeck.mock.calls[0][1]).toStrictEqual({
      slug: 'csharp-fundamentals',
      title: 'C# Fundamentals',
      description: 'Interview prep',
      manifestOrder: 4,
      availability: 'live',
      tier: null,
      eta: null,
      retiredAtMs: null,
      totalCards: 120,
      previewCards: null,
    });
  });

  it('still blocks the save on an author it is not going to send', async () => {
    // The sharpest statement of D2: the field is required and inert at once.
    renderAt(<DeckEditPage />, [`/decks/edit?deckId=${DECK_ID}`]);
    await screen.findByRole('button', { name: 'Save' });

    await userEvent.clear(screen.getByLabelText('Author *'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('slug / title / author are required.')).not.toBeNull();
    expect(api.updateDeck).toHaveBeenCalledTimes(0);
  });
});
