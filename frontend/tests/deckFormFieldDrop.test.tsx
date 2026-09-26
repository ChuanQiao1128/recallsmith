// @vitest-environment jsdom
//
// The full request each deck form sends, now that the fields it collects reach
// the wire. This file used to pin the DEFECT — locale, deckType, version and (on
// edit) author collected, validated, and then dropped from the request — with
// toStrictEqual literals that named exactly what was missing. The defect is
// fixed, so the file is flipped: the same toStrictEqual literals now name the
// COMPLETE request, and they go red if a field goes missing again OR if the
// payload grows one nobody meant to send.
//
//   D1  NewDeckPage sends slug, title, author, description, locale, deckType and
//       an integer draft version. A Paid deck also saves its free card count as
//       previewCards through a follow-up PUT, because Decks.cs POST ignores it.
//
//   D2  DeckEditPage sends author, locale, deckType and version alongside the
//       ten manifest fields it already sent.
//
// WHY toStrictEqual AND NOT expect.objectContaining: a per-key assertion is
// satisfied by a payload that grew three other fields nobody meant to send. The
// whole literal states the complete request, so it is red for a field appearing
// as well as for one going missing (measured; see deckEditPageSave.test.tsx's
// header note).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { queryClient } from '../src/api/queryClient';
import { ok, refused } from './support/apiResult';
import { locationText, renderAt } from './support/routerProbe';

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
  // DeckEditPage mounts bare on the app singleton; clear it between cases.
  queryClient.clear();
  signOut();
});

describe('D1 NewDeckPage sends every field it collects', () => {
  const titleBox = () => screen.getByPlaceholderText('JavaScript Core Basics') as HTMLInputElement;
  const slugBox = () => screen.getByPlaceholderText('js-core-basics') as HTMLInputElement;
  const authorBox = () => screen.getByLabelText(/^Author/) as HTMLInputElement;
  const versionBox = () => screen.getByLabelText('Draft Version') as HTMLInputElement;
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
    fireEvent.change(versionBox(), { target: { value: '9' } });
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
    expect(versionBox().value).toBe('9');
  });

  it('sends every field the new-deck form collects', async () => {
    await fillEverything();
    await userEvent.click(screen.getByRole('button', { name: 'Create Deck' }));

    await waitFor(() => expect(api.createDeck).toHaveBeenCalledTimes(1));
    // The full request, in one literal. locale ('zh-CN'), deckType (2) and the
    // integer draft version (9) are the three the page used to drop; the draft
    // version is the semver field's replacement, an int because decks.version is.
    expect(api.createDeck.mock.calls[0][0]).toStrictEqual({
      slug: 'js-core-basics',
      title: 'JavaScript Core Basics',
      author: 'Leo',
      description: 'Core concepts',
      locale: 'zh-CN',
      deckType: 2,
      version: 9,
    });
  });

  it('saves the free card count of a Paid deck as previewCards right after creating it', async () => {
    await fillEverything();
    await userEvent.click(screen.getByRole('button', { name: 'Create Deck' }));

    // Decks.cs POST ignores previewCards, so the collected count reaches the row
    // only through this follow-up PUT once the create returns the new id.
    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(api.updateDeck.mock.calls[0][0]).toBe(deck.id);
    expect(api.updateDeck.mock.calls[0][1]).toStrictEqual({ previewCards: 7 });
  });

  it('stays on the page and says so when the free card count cannot be saved', async () => {
    api.updateDeck.mockResolvedValue(refused<Deck>('CONFLICT', 'preview write refused'));
    await fillEverything();
    await userEvent.click(screen.getByRole('button', { name: 'Create Deck' }));

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    // The deck exists, so the message must say so and point at the Edit page
    // rather than pretend the whole create failed.
    expect(
      await screen.findByText(
        content => content.startsWith('Deck created, but the free card count was not saved'),
      ),
    ).not.toBeNull();
    expect(locationText()).toBe('/decks/new');
  });
});

describe('D2 DeckEditPage sends the four fields it used to drop', () => {
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

  it('sends author, locale, deckType and version on save', async () => {
    await mountAndEdit();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    // The complete PUT body: the four keys that used to vanish, plus the ten
    // this page already sent. deckType 2 makes the effective tier premium, which
    // is why previewCards is parsed at all — and it is null because the box is
    // empty, not because the key was dropped.
    expect(api.updateDeck.mock.calls[0][1]).toStrictEqual({
      slug: 'csharp-fundamentals',
      title: 'C# Fundamentals',
      author: 'Leo',
      description: 'Interview prep',
      locale: 'zh-CN',
      deckType: 2,
      version: 9,
      manifestOrder: 4,
      availability: 'live',
      tier: null,
      eta: null,
      retiredAtMs: null,
      totalCards: 120,
      previewCards: null,
    });
  });

  it('still blocks the save on an empty author', async () => {
    // author is required and now also sent — the asymmetry the old file pinned
    // (required but inert) is gone, but the required check stays.
    renderAt(<DeckEditPage />, [`/decks/edit?deckId=${DECK_ID}`]);
    await screen.findByRole('button', { name: 'Save' });

    await userEvent.clear(screen.getByLabelText('Author *'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('slug / title / author are required.')).not.toBeNull();
    expect(api.updateDeck).toHaveBeenCalledTimes(0);
  });
});
