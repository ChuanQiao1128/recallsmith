// @vitest-environment jsdom
//
// Characterization tests for what DeckEditPage SENDS. Loading, normalisation
// and the permission gate are in deckEditPageSave's sibling,
// deckEditPageLoad.test.tsx.
//
// Written and run green against a COMPLETELY UNMODIFIED DeckEditPage.tsx.
//
// WHY toStrictEqual ON A WHOLE LITERAL AND NOT expect.objectContaining.
// Measured, not assumed, and the first version of this note was wrong.
// objectContaining is NOT blind to a key it lists going missing: deleting
// `previewCards` from the payload turns `previewCards: null` into undefined and
// both forms go red. What only the whole literal catches is the payload GROWING
// a field. Adding `author: form.author.trim()` to the object leaves
// objectContaining at 32 passed and takes toStrictEqual to 1 failed.
//
// That is the direction this file has to be sharp in. The known defect on this
// page is fields collected and never sent (see deckFormFieldDrop.test.tsx), so
// the change most likely to arrive here is somebody adding them — and an
// assertion that cannot see a payload grow would wave it through unverified.
// toStrictEqual additionally distinguishes `description: undefined` (a present
// key the api layer skips) from no `description` key at all.
//
// THE CONDITIONAL FIELDS ARE PINNED WITH VALUES THAT ARE PRESENT BUT INVISIBLE.
// The fixture carries eta, retiredAtMs and previewCards while the form is
// live/free, so none of the three controls is on screen. A clean fixture would
// send null for all three whether or not the conditions exist, so those three
// assertions would be blank cheques. Here they are the only thing standing
// between a stale ETA and the database.
//
// ONE BRANCH, NOT TWO: updateDeck never rejects (try/catch + fail() in
// src/api/authoring.ts), so the refusal and the dropped-connection cases below
// take the same path and render the same red box. The page's `catch` is
// reachable from exactly one place — parseNullableInt's throw — and that is
// tested.
//
// The mutations these tests are built to fail against:
//
//   1. dropping any single key from the payload literal.
//   2. `form.availability === 'coming' && form.eta.trim()` -> `form.eta.trim()`,
//      which posts a stale ETA for a live deck.
//   3. `form.availability === 'retired' ? ... : null` -> always parse, same
//      shape for retiredAtMs.
//   4. `effectiveTier(...) === 'premium' ? ... : null` -> always parse, which
//      gives a free deck a preview-card limit.
//   5. moving setSaving(false) out of `finally` and into the success branch:
//      every validation case below asserts the button came back.
//   6. `Math.min(10, count)` -> Math.max, or -> a constant.
//   7. `setLoad(prev => ({ ...prev, deck: res.data ?? prev.deck }))` removed,
//      which leaves the header showing the pre-save title forever.
//   8. `navigate('/')` dropped from the goBackAfter branch, or added to both.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { deferred, networkFailure, ok, refused } from './support/apiResult';
import { locationText, renderAt } from './support/routerProbe';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  updateDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckEditPage } = await import('../src/pages/DeckEditPage');

const DECK_ID = 7;
const REFUSAL_MESSAGE = 'Another editor changed this deck while you were editing.';
const THROWN_MESSAGE = 'socket hang up';
/**
 * The server's answer differs from what was typed. Nothing in the page can
 * compute this string, so an assertion on it cannot be satisfied by copying the
 * implementation — and it pins the rule that the page believes the response
 * rather than its own form.
 */
const SERVER_NORMALISED_TITLE = 'C# Fundamentals [normalised by server]';

/**
 * eta, retiredAtMs and previewCards all carry values while availability is
 * 'live' and the effective tier is free — so all three of their controls are
 * off screen. This is the fixture the payload assertions need.
 */
const deck: Deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  author: 'console-tests',
  description: 'Interview prep',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  tier: null,
  availability: 'live',
  eta: 'Jan 2026',
  manifestOrder: 4,
  totalCards: 120,
  previewCards: 25,
  retiredAtMs: 1767225600000,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function card(id: number): Card {
  return {
    id,
    deckId: DECK_ID,
    stableUid: `card-${id}`,
    question: `Question ${id}`,
    difficulty: 2,
    orderInDeck: id,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

async function mountLoaded(over: Partial<Deck> = {}): Promise<void> {
  api.fetchDeckById.mockResolvedValue(ok({ ...deck, ...over }));
  renderAt(<DeckEditPage />, [`/decks/edit?deckId=${DECK_ID}`]);
  await screen.findByRole('button', { name: 'Save' });
}

function input(label: string | RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function select(label: string | RegExp): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^(Save|Saving…)$/ }) as HTMLButtonElement;
}

async function clickSave(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
}

/** The second argument updateDeck was called with, i.e. the PUT body. */
function payload(): Record<string, unknown> {
  return api.updateDeck.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchCardsByDeck.mockResolvedValue(ok([card(1), card(2), card(3)]));
  api.updateDeck.mockResolvedValue(ok({ ...deck, title: SERVER_NORMALISED_TITLE }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the body of the PUT, in full', () => {
  it('sends exactly these fourteen fields and no others', async () => {
    await mountLoaded();
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(api.updateDeck.mock.calls[0][0]).toBe(DECK_ID);
    expect(payload()).toStrictEqual({
      slug: 'csharp-fundamentals',
      title: 'C# Fundamentals',
      // author, locale and version travel now: the base fields buildDeckBody
      // carries that this page used to collect and drop.
      author: 'console-tests',
      description: 'Interview prep',
      locale: 'en-US',
      deckType: 1,
      version: 3,
      manifestOrder: 4,
      availability: 'live',
      tier: null,
      // The three below all have a value in the fixture and no control on
      // screen. They are null because the page checks the condition, not
      // because the deck had nothing to send.
      eta: null,
      retiredAtMs: null,
      previewCards: null,
      totalCards: 120,
    });
  });

  it('sends an emptied description as an empty string', async () => {
    await mountLoaded();
    await userEvent.clear(screen.getByLabelText('Description'));
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    // '' is a present key, so the column is actually cleared. Dropping it (the
    // old `|| undefined`) left the old text in the row — a clear that did
    // nothing. This is the same rule deckImportRunner already follows.
    expect(payload().description).toBe('');
    expect('description' in payload()).toBe(true);
  });

  it('trims slug, title and description on the way out', async () => {
    await mountLoaded({ slug: '  spaced-slug  ', title: '  Spaced Title  ', description: '  Spaced  ' });
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(payload().slug).toBe('spaced-slug');
    expect(payload().title).toBe('Spaced Title');
    expect(payload().description).toBe('Spaced');
  });
});

describe('the three conditional fields, once their condition is true', () => {
  it('sends the ETA once availability is coming', async () => {
    await mountLoaded();
    await userEvent.selectOptions(select('Availability *'), 'coming');
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    // Same fixture value as the null case above; only the condition changed.
    expect(payload().eta).toBe('Jan 2026');
    expect(payload().retiredAtMs).toBeNull();
  });

  it('sends nothing for an ETA that is only whitespace', async () => {
    await mountLoaded({ eta: '   ' });
    await userEvent.selectOptions(select('Availability *'), 'coming');
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(payload().eta).toBeNull();
  });

  it('sends retiredAtMs once availability is retired', async () => {
    await mountLoaded();
    await userEvent.selectOptions(select('Availability *'), 'retired');
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(payload().retiredAtMs).toBe(1767225600000);
    expect(payload().eta).toBeNull();
  });

  it('sends previewCards once the effective tier is premium', async () => {
    await mountLoaded();
    await userEvent.selectOptions(select(/^Tier/), 'premium');
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(payload().previewCards).toBe(25);
    expect(payload().tier).toBe('premium');
  });

  it('infers premium from deckType alone, with tier left on Auto', async () => {
    await mountLoaded({ deckType: 2 });
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    // tier stays null — the page does not write its inference back — but the
    // inference still decides whether previewCards travels.
    expect(payload().tier).toBeNull();
    expect(payload().previewCards).toBe(25);
  });
});

describe('parseNullableInt, through the Manifest Order box', () => {
  it('refuses a value that is not a number, and sends nothing', async () => {
    await mountLoaded();
    await userEvent.clear(input('Manifest Order'));
    await userEvent.type(input('Manifest Order'), 'abc');
    await clickSave();

    // The one throw on this page that is actually reachable.
    expect(await screen.findByText('Must be a valid number.')).not.toBeNull();
    expect(api.updateDeck).toHaveBeenCalledTimes(0);
  });

  it('accepts a padded number', async () => {
    await mountLoaded({ manifestOrder: null });
    await userEvent.type(input('Manifest Order'), '  12  ');
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(payload().manifestOrder).toBe(12);
  });

  it('reads a box holding only spaces as empty, not as zero', async () => {
    // This is the case the `.trim()` in parseNullableInt actually buys, and it
    // was found by mutation: deleting the trim leaves the padded case above
    // green, because Number('  12  ') is already 12. What breaks without it is
    // this one — '   ' is truthy, so the empty check is skipped and Number('   ')
    // returns 0. The deck would silently get manifestOrder 0 instead of null.
    await mountLoaded({ manifestOrder: null });
    await userEvent.type(input('Manifest Order'), '   ');
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(payload().manifestOrder).toBeNull();
  });

  it('turns an empty box into null, not into zero', async () => {
    await mountLoaded();
    await userEvent.clear(input('Manifest Order'));
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(payload().manifestOrder).toBeNull();
  });

  it('truncates a decimal towards zero rather than rounding', async () => {
    await mountLoaded({ manifestOrder: null });
    await userEvent.type(input('Manifest Order'), '12.7');
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    // 12, not 13: Math.trunc, not Math.round. Rounding would give 13 here.
    expect(payload().manifestOrder).toBe(12);
  });
});

describe('the three required fields', () => {
  const blanks: Array<[string, string]> = [
    ['slug', 'Slug *'],
    ['title', 'Title *'],
    ['author', 'Author *'],
  ];

  for (const [name, label] of blanks) {
    it(`refuses an empty ${name}, sends nothing, and gives the button back`, async () => {
      await mountLoaded();
      await userEvent.clear(input(label));
      await clickSave();

      expect(await screen.findByText('slug / title / author are required.')).not.toBeNull();
      expect(api.updateDeck).toHaveBeenCalledTimes(0);
      // setSaving(false) lives in `finally`. Moved into the success branch, the
      // form would be permanently locked after one validation failure — which
      // is a worse bug than the one being reported.
      expect(saveButton().disabled).toBe(false);
      expect(saveButton().textContent).toBe('Save');
    });
  }

  it('treats a field of pure whitespace as empty', async () => {
    await mountLoaded();
    await userEvent.clear(input('Title *'));
    await userEvent.type(input('Title *'), '   ');
    await clickSave();

    expect(await screen.findByText('slug / title / author are required.')).not.toBeNull();
    expect(api.updateDeck).toHaveBeenCalledTimes(0);
  });

  it('validates author even though author is never sent', async () => {
    await mountLoaded();
    await userEvent.clear(input('Author *'));
    await clickSave();

    // Recorded as a defect, and pinned here so the asymmetry is visible: author
    // blocks the save and then does not appear in the body at all.
    expect(await screen.findByText('slug / title / author are required.')).not.toBeNull();
    expect(api.updateDeck).toHaveBeenCalledTimes(0);
  });
});

describe('a save the server accepted', () => {
  it('takes the server copy of the deck, not the local form', async () => {
    await mountLoaded();
    await userEvent.clear(input('Title *'));
    await userEvent.type(input('Title *'), 'Whatever I Typed');
    await clickSave();

    // The header reads the loaded deck; the input still holds what was typed.
    // Only a page that writes the response back can satisfy both at once.
    expect(await screen.findByText(SERVER_NORMALISED_TITLE)).not.toBeNull();
    expect(input('Title *').value).toBe('Whatever I Typed');
  });

  it('says so', async () => {
    await mountLoaded();
    await clickSave();

    expect(await screen.findByText('Saved.')).not.toBeNull();
  });

  it('stays on the page for Save', async () => {
    await mountLoaded();
    await clickSave();

    await screen.findByText('Saved.');
    expect(locationText()).toBe(`/decks/edit?deckId=${DECK_ID}`);
  });

  it('goes back to the list for Save & Back', async () => {
    await mountLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Save & Back' }));

    await waitFor(() => expect(locationText()).toBe('/'));
    expect(api.updateDeck).toHaveBeenCalledTimes(1);
  });
});

describe('a save the server would not take', () => {
  it('shows the refusal in the wording the server chose', async () => {
    api.updateDeck.mockResolvedValue(refused<Deck>('CONFLICT', REFUSAL_MESSAGE));
    await mountLoaded();
    await clickSave();

    expect(await screen.findByText(REFUSAL_MESSAGE)).not.toBeNull();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('falls back to its own wording when the server sent no message', async () => {
    api.updateDeck.mockResolvedValue({ success: false, data: null, error: null, traceId: 't' } as ApiResult<Deck>);
    await mountLoaded();
    await clickSave();

    expect(await screen.findByText('Save failed.')).not.toBeNull();
  });

  it('treats success:true with a null body as a failure', async () => {
    api.updateDeck.mockResolvedValue({ success: true, data: null, error: null, traceId: 't' } as ApiResult<Deck>);
    await mountLoaded();
    await clickSave();

    expect(await screen.findByText('Save failed.')).not.toBeNull();
  });

  it('renders a thrown request through the same box (recorded, not a second path)', async () => {
    api.updateDeck.mockResolvedValue(networkFailure<Deck>(THROWN_MESSAGE));
    await mountLoaded();
    await clickSave();

    expect(await screen.findByText(THROWN_MESSAGE)).not.toBeNull();
  });

  it('gives the buttons back afterwards', async () => {
    api.updateDeck.mockResolvedValue(refused<Deck>('CONFLICT', REFUSAL_MESSAGE));
    await mountLoaded();
    await clickSave();

    await screen.findByText(REFUSAL_MESSAGE);
    expect(saveButton().disabled).toBe(false);
  });
});

describe('while the save is in flight', () => {
  it('locks both buttons and renames them', async () => {
    const d = deferred<ApiResult<Deck>>();
    api.updateDeck.mockReturnValue(d.promise);
    await mountLoaded();
    await clickSave();

    const buttons = screen.getAllByRole('button', { name: 'Saving…' });
    expect(buttons).toHaveLength(2);
    expect(buttons.every(b => (b as HTMLButtonElement).disabled)).toBe(true);

    d.resolve(ok({ ...deck, title: SERVER_NORMALISED_TITLE }));
    await screen.findByText('Saved.');
    expect(saveButton().disabled).toBe(false);
  });
});

describe('Apply to totalCards', () => {
  // previewCards is only on screen for a premium deck, so these run premium.
  async function applyWith(cards: Card[]): Promise<void> {
    api.fetchCardsByDeck.mockResolvedValue(ok(cards));
    await mountLoaded({ tier: 'premium' });
    await waitFor(() => expect(document.body.textContent).toContain(`count = ${cards.length}`));
    await userEvent.click(screen.getByRole('button', { name: 'Apply to totalCards' }));
  }

  it('copies the count and caps the preview at ten', async () => {
    await applyWith(Array.from({ length: 25 }, (_, i) => card(i + 1)));

    expect(input('Total Cards (full)').value).toBe('25');
    // 10, not 25: Math.max would give 25 here, and a hard-coded 10 would give
    // 10 in the next case too.
    expect(input('Preview Cards (premium)').value).toBe('10');
  });

  it('uses the count itself when the deck is smaller than the cap', async () => {
    await applyWith([card(1), card(2), card(3)]);

    expect(input('Total Cards (full)').value).toBe('3');
    expect(input('Preview Cards (premium)').value).toBe('3');
  });

  it('writes zeroes for an empty deck rather than leaving the boxes alone', async () => {
    await applyWith([]);

    expect(input('Total Cards (full)').value).toBe('0');
    expect(input('Preview Cards (premium)').value).toBe('0');
  });

  it('reaches the payload once applied', async () => {
    await applyWith(Array.from({ length: 25 }, (_, i) => card(i + 1)));
    await clickSave();

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(payload().totalCards).toBe(25);
    expect(payload().previewCards).toBe(10);
  });
});
