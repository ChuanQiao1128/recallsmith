// @vitest-environment jsdom
//
// Characterization tests for how DeckEditPage GETS to a form: the deckId guard,
// the two fetches, the normalisation of what comes back, and the permission
// gate. Saving is a separate file (deckEditPageSave.test.tsx).
//
// Written and run green against a COMPLETELY UNMODIFIED DeckEditPage.tsx.
//
// ONE BRANCH, NOT TWO. fetchDeckById and fetchCardsByDeck are try/catch
// wrappers in src/api/authoring.ts that return `fail(...)`; they never reject.
// So a business refusal and a dropped connection reach this page as the same
// ApiResult and render the same red box. The page's own try/catch around the
// two awaits — the one that produces 'Network error.' — is therefore
// unreachable from the api layer, and is recorded as dead code rather than
// tested through a mock that rejects.
//
// The mutations these tests are built to fail against:
//
//   1. weakening the deckId guard (dropping `deckId <= 0`, or dropping
//      Number.isFinite). Each case asserts fetchDeckById was called ZERO
//      times, because a guard that renders the error and fires the request
//      anyway passes a text-only assertion — that is the exact shape this
//      repo has hit repeatedly.
//   2. dropping the three-way availability narrowing, or the two-way tier
//      narrowing, letting an off-contract value from the wire ride back out in
//      the PUT body. See the long note above those cases: the tempting
//      assertion (the <select> reads 'live') cannot detect this, because HTML
//      shows the first option when the value matches none.
//   3. `Number(found.deckType ?? 1) || 1` -> `Number(found.deckType ?? 1)`,
//      which infers the premium tier for a starter deck and, separately, makes
//      the deck unsaveable.
//   4. `(cardsRes.data ?? []).length` -> `cardsRes.data.length` (crash) or
//      `cardsRes.data?.length` (renders nothing where 0 belongs).
//   5. promoting the cards-count failure to a whole-page failure, which would
//      take the editable form away because one optional count could not load.
//   6. flipping any single `disabled={!superAdmin}` — there are four of them
//      and each has its own case, so exactly one must go red.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { ApiResult } from '../src/types/api';
import type { Deck, DeckAvailability, DeckTier } from '../src/types/deck';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
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
const REFUSAL_MESSAGE = 'You do not have write access to this deck.';
const THROWN_MESSAGE = 'socket hang up';
const CARDS_REFUSAL = 'Card index is being rebuilt.';

const deck: Deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  author: 'console-tests',
  description: 'Interview prep',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

/**
 * A value the Deck type forbids and the wire can still deliver: the api layer's
 * normalizeDeck does not narrow availability, so this page's own three-way
 * check is the only thing between the server and the <select>. The double
 * assertion is the honest way to spell "this is what JSON handed us"; it is the
 * one cast in this file and it exists to reach a real branch, not to silence an
 * error.
 */
const OFF_CONTRACT_AVAILABILITY = 'archived' as unknown as DeckAvailability;
/** Same idea for tier: the wire can say anything, the union allows two words. */
const OFF_CONTRACT_TIER = 'gold' as unknown as DeckTier;

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

function mount(query = `?deckId=${DECK_ID}`) {
  return renderAt(<DeckEditPage />, [`/decks/edit${query}`]);
}

/** Mount and wait for the form (the deck title in the header block). */
async function mountLoaded(query = `?deckId=${DECK_ID}`): Promise<void> {
  mount(query);
  await screen.findByRole('button', { name: 'Save' });
}

function input(label: string | RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function select(label: string | RegExp): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement;
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card(1), card(2), card(3)]));
  api.updateDeck.mockResolvedValue(ok(deck));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the deckId guard refuses before it asks', () => {
  // Every case here asserts the request count, not only the message. A guard
  // that shows the error and issues the request anyway satisfies a text-only
  // assertion while still hitting the server with garbage.
  const cases: Array<[string, string]> = [
    ['no deckId at all', ''],
    ['a deckId that is not a number', '?deckId=abc'],
    ['deckId=0', '?deckId=0'],
    ['a negative deckId', '?deckId=-3'],
  ];

  for (const [name, query] of cases) {
    it(`rejects ${name} without calling the server`, async () => {
      mount(query);

      expect(await screen.findByText('Missing or invalid deckId.')).not.toBeNull();
      expect(api.fetchDeckById).toHaveBeenCalledTimes(0);
      expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(0);
    });
  }
});

describe('while the deck is on its way', () => {
  it('shows the loading screen and nothing else', async () => {
    const d = deferred<ApiResult<Deck>>();
    api.fetchDeckById.mockReturnValue(d.promise);

    mount();

    expect(screen.queryByText('Loading deck…')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    d.resolve(ok(deck));
    await screen.findByRole('button', { name: 'Save' });
  });
});

describe('a deck that will not load', () => {
  it('shows the refusal in the wording the server chose', async () => {
    api.fetchDeckById.mockResolvedValue(refused<Deck>('FORBIDDEN', REFUSAL_MESSAGE));
    mount();

    expect(await screen.findByText('Failed to load deck')).not.toBeNull();
    expect(screen.queryByText(REFUSAL_MESSAGE)).not.toBeNull();
    // The cards fetch is downstream of a successful deck fetch.
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(0);
  });

  it('falls back to its own wording when the server sent no message', async () => {
    api.fetchDeckById.mockResolvedValue({
      success: false,
      data: null,
      error: null,
      traceId: 't',
    } as ApiResult<Deck>);
    mount();

    expect(await screen.findByText('Failed to load deck.')).not.toBeNull();
  });

  it('treats success:true with a null body as a failure', async () => {
    api.fetchDeckById.mockResolvedValue({
      success: true,
      data: null,
      error: null,
      traceId: 't',
    } as ApiResult<Deck>);
    mount();

    expect(await screen.findByText('Failed to load deck.')).not.toBeNull();
  });

  it('renders a thrown request through the same box (recorded, not a second path)', async () => {
    api.fetchDeckById.mockResolvedValue(networkFailure<Deck>(THROWN_MESSAGE));
    mount();

    expect(await screen.findByText('Failed to load deck')).not.toBeNull();
    expect(screen.queryByText(THROWN_MESSAGE)).not.toBeNull();
  });

  it('sends Back to the deck list', async () => {
    api.fetchDeckById.mockResolvedValue(refused<Deck>('FORBIDDEN', REFUSAL_MESSAGE));
    mount();

    await screen.findByText('Failed to load deck');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(locationText()).toBe('/');
  });
});

describe('the form is filled from the server, and narrowed on the way in', () => {
  it('copies the plain fields through unchanged', async () => {
    await mountLoaded();

    expect(input('Slug *').value).toBe('csharp-fundamentals');
    expect(input('Title *').value).toBe('C# Fundamentals');
    expect(input('Author *').value).toBe('console-tests');
    expect(input('Locale').value).toBe('en-US');
    expect(input(/^Draft Version/).value).toBe('3');
  });

  // WHY THESE THREE ASSERT THROUGH THE PAYLOAD AND NOT THROUGH select.value.
  //
  // The obvious test — load a deck with availability 'archived' and assert the
  // <select> reads 'live' — has no teeth, and that was measured rather than
  // guessed. HTML's selectedness algorithm gives a single-line <select> whose
  // value matches no <option> its FIRST option instead. So the select reads
  // 'live' whether the page narrowed the value or handed 'archived' straight
  // through; likewise Tier reads '' and Deck Type reads '1' for free. All three
  // assertions were written that way first, all three survived the mutation
  // that deletes the narrowing, and all three were rewritten.
  //
  // What actually distinguishes the two worlds is what leaves the page: an
  // un-narrowed value is invisible on screen and still lands in the PUT body.

  it('narrows an availability the type does not allow before sending it back', async () => {
    api.fetchDeckById.mockResolvedValue(ok({ ...deck, availability: OFF_CONTRACT_AVAILABILITY }));
    await mountLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(api.updateDeck.mock.calls[0][1].availability).toBe('live');
  });

  it('narrows a tier the type does not allow into Auto before sending it back', async () => {
    api.fetchDeckById.mockResolvedValue(ok({ ...deck, tier: OFF_CONTRACT_TIER }));
    await mountLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    // '' means "infer from deckType", and the payload spells that as null.
    expect(api.updateDeck.mock.calls[0][1].tier).toBeNull();
  });

  it('turns deckType 0 into Starter, which decides the effective tier', async () => {
    // deckType is never sent to the server, so the payload cannot be the
    // oracle here. effectiveTier can: 0 is not 1, so an un-normalised 0 infers
    // premium and opens the Preview Cards field that a starter deck must not
    // have.
    api.fetchDeckById.mockResolvedValue(ok({ ...deck, deckType: 0, tier: '' as unknown as null }));
    await mountLoaded();

    expect(select(/^Tier/).closest('label')?.textContent).toContain('Effective tier: free');
    expect(screen.queryByLabelText('Preview Cards (premium)')).toBeNull();
  });

  it('accepts a save on a deck whose deckType arrived as 0', async () => {
    // The other half of the same fallback: onSave rejects deckType <= 0 with
    // 'deckType must be a valid number.', so without `|| 1` this deck could be
    // loaded and never saved.
    api.fetchDeckById.mockResolvedValue(ok({ ...deck, deckType: 0 }));
    await mountLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('deckType must be a valid number.')).toBeNull();
  });

  it('supplies defaults for the nullable text fields', async () => {
    api.fetchDeckById.mockResolvedValue(
      ok({ ...deck, description: null, locale: null as unknown as string, version: null as unknown as number }),
    );
    await mountLoaded();

    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('');
    expect(input('Locale').value).toBe('en-US');
    expect(input(/^Draft Version/).value).toBe('1');
  });

  it('leaves the numeric manifest fields empty when the deck has no value', async () => {
    await mountLoaded();

    // '' and '0' mean different things downstream (parseNullableInt turns the
    // first into null and the second into 0), so an absent value must not
    // become a zero.
    expect(input('Manifest Order').value).toBe('');
    expect(input('Total Cards (full)').value).toBe('');
  });

  it('only offers the ETA field when availability is coming', async () => {
    await mountLoaded();
    expect(screen.queryByLabelText('ETA (coming only)')).toBeNull();

    await userEvent.selectOptions(select('Availability *'), 'coming');
    expect(screen.queryByLabelText('ETA (coming only)')).not.toBeNull();
  });

  it('only offers Preview Cards when the effective tier is premium', async () => {
    await mountLoaded();
    // deckType 1 with tier '' infers free.
    expect(screen.queryByLabelText('Preview Cards (premium)')).toBeNull();

    await userEvent.selectOptions(select(/^Tier/), 'premium');
    expect(screen.queryByLabelText('Preview Cards (premium)')).not.toBeNull();
  });

  it('only offers Retired At when availability is retired', async () => {
    await mountLoaded();
    expect(screen.queryByLabelText('Retired At (ms)')).toBeNull();

    await userEvent.selectOptions(select('Availability *'), 'retired');
    expect(screen.queryByLabelText('Retired At (ms)')).not.toBeNull();
  });
});

describe('the card count is a separate, optional request', () => {
  it('shows its own loading line while the deck form is already up', async () => {
    const d = deferred<ApiResult<Card[]>>();
    api.fetchCardsByDeck.mockReturnValue(d.promise);

    await mountLoaded();

    expect(screen.queryByText('Loading cards…')).not.toBeNull();
    d.resolve(ok([card(1), card(2), card(3)]));
    await waitFor(() => expect(document.body.textContent).toContain('count = 3'));
  });

  it('counts the cards the server actually returned', async () => {
    await mountLoaded();

    await waitFor(() => expect(document.body.textContent).toContain('count = 3'));
  });

  it('reads a success with a null body as zero rather than crashing', async () => {
    api.fetchCardsByDeck.mockResolvedValue({
      success: true,
      data: null,
      error: null,
      traceId: 't',
    } as ApiResult<Card[]>);
    await mountLoaded();

    await waitFor(() => expect(document.body.textContent).toContain('count = 0'));
  });

  it('keeps the form editable when only the count failed', async () => {
    api.fetchCardsByDeck.mockResolvedValue(refused<Card[]>('CARDS_UNAVAILABLE', CARDS_REFUSAL));
    await mountLoaded();

    await screen.findByText(CARDS_REFUSAL);

    // The distinction that matters: a failed optional count is NOT a failed
    // page. The red "Failed to load deck" screen must not appear, and the form
    // must still be usable.
    expect(screen.queryByText('Failed to load deck')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeNull();
    await userEvent.type(input('Title *'), '!');
    expect(input('Title *').value).toBe('C# Fundamentals!');

    // Recorded: the amber branch replaces the whole count block, so the
    // super-admin "Apply to totalCards" shortcut disappears with it.
    expect(screen.queryByRole('button', { name: 'Apply to totalCards' })).toBeNull();
  });
});

describe('what an editor may touch', () => {
  beforeEach(() => {
    signOut();
    signInAsEditor();
  });

  it('locks the slug, because it is the progress key', async () => {
    await mountLoaded();
    expect(input('Slug *').disabled).toBe(true);
  });

  it('leaves the ordinary content fields open', async () => {
    await mountLoaded();

    expect(input('Title *').disabled).toBe(false);
    expect(input('Author *').disabled).toBe(false);
    expect(input('Locale').disabled).toBe(false);
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).disabled).toBe(false);
    expect(select('Deck Type').disabled).toBe(false);
    expect(input(/^Draft Version/).disabled).toBe(false);
  });

  it('locks availability', async () => {
    await mountLoaded();
    expect(select('Availability *').disabled).toBe(true);
  });

  it('locks tier', async () => {
    await mountLoaded();
    expect(select(/^Tier/).disabled).toBe(true);
  });

  it('locks the manifest order', async () => {
    await mountLoaded();
    expect(input('Manifest Order').disabled).toBe(true);
  });

  it('locks the total card count', async () => {
    await mountLoaded();
    expect(input('Total Cards (full)').disabled).toBe(true);
  });

  it('does not offer the Apply to totalCards shortcut', async () => {
    await mountLoaded();
    await waitFor(() => expect(document.body.textContent).toContain('count = 3'));

    expect(screen.queryByRole('button', { name: 'Apply to totalCards' })).toBeNull();
  });

  it('says why the manifest block is read-only', async () => {
    await mountLoaded();
    expect(screen.queryByText('super_admin only')).not.toBeNull();
  });

  it('still offers Save, because the content fields are editable', async () => {
    await mountLoaded();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Save & Back' })).not.toBeNull();
  });
});

describe('what a super admin may touch', () => {
  it('unlocks every field the editor could not reach', async () => {
    await mountLoaded();

    expect(input('Slug *').disabled).toBe(false);
    expect(select('Availability *').disabled).toBe(false);
    expect(select(/^Tier/).disabled).toBe(false);
    expect(input('Manifest Order').disabled).toBe(false);
    expect(input('Total Cards (full)').disabled).toBe(false);
  });

  it('offers the Apply to totalCards shortcut and drops the read-only badge', async () => {
    await mountLoaded();
    await waitFor(() => expect(document.body.textContent).toContain('count = 3'));

    expect(screen.queryByRole('button', { name: 'Apply to totalCards' })).not.toBeNull();
    expect(screen.queryByText('super_admin only')).toBeNull();
  });

  it('offers the Now shortcut only beside a retired deck', async () => {
    await mountLoaded();
    expect(screen.queryByRole('button', { name: 'Now' })).toBeNull();

    await userEvent.selectOptions(select('Availability *'), 'retired');
    expect(screen.queryByRole('button', { name: 'Now' })).not.toBeNull();
  });
});

describe('the two header links', () => {
  it('sends View Cards to the card list for this deck', async () => {
    await mountLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'View Cards' }));

    // The id comes from the loaded deck, not from the query string, so a deck
    // whose canonical id differs from the URL still lands correctly.
    expect(locationText()).toBe(`/decks/cards?deckId=${DECK_ID}`);
  });

  it('sends Back to the deck list', async () => {
    await mountLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(locationText()).toBe('/');
  });
});
