// @vitest-environment jsdom
//
// The one failure on this page that trying again could not fix.
//
// updateCard sends `expectedVersion`, the optimistic-concurrency token read
// when the page loaded. If somebody else saved in the meantime the server
// answers VERSION_CONFLICT, and the page rendered that refusal in the same
// banner as every other one — beside a Save button that, pressed again, sent
// the identical stale version and failed identically. Forever. The only escape
// was a reload, and a reload is the one action that costs the user the edit
// they were trying to save.
//
// So this is not "show a nicer message". The recovery has three parts and all
// three are asserted below, because any two of them without the third is still
// a dead end:
//
//   1. the version is re-read from the server, so the next attempt can differ;
//   2. the typed text survives, because losing it is what the reload cost;
//   3. the retry sends what is on screen when it is pressed, not a snapshot
//      taken when the failure arrived.
//
// (3) is why the button is inside the form. A button beside the banner could
// only re-send values the page had captured at conflict time — right until the
// user touches a field, and quietly wrong afterwards.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderAt } from './support/routerProbe';
import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { queryClient } from '../src/api/queryClient';
import { ok, refused, networkFailure } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardById: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { EditCardPage } = await import('../src/pages/EditCardPage');

const DECK_ID = 7;
const CARD_ID = 101;

const STALE_MESSAGE = 'This card was changed by someone else.';
const RETRY_LABEL = 'Retry with latest version';

const deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  locale: 'en',
  version: 3,
} as Deck;

function card(version: number, over: Partial<Card> = {}): Card {
  return {
    id: CARD_ID,
    deckId: DECK_ID,
    stableUid: 'cs-volatile-001',
    question: 'What does volatile guarantee?',
    explanation: 'Visibility, not atomicity.',
    realWorldUsage: 'A flag polled from another thread.',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: 2,
    orderInDeck: 10,
    revision: 1,
    version,
    ...over,
  } as Card;
}

/** The Question box, which is the field these cases type into. */
function questionBox(): HTMLTextAreaElement {
  return screen.getByLabelText(/question/i) as HTMLTextAreaElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
}

async function mountLoaded(): Promise<void> {
  // EditCardPage calls useBlocker, so it needs a data router (renderAt).
  renderAt(<EditCardPage />, [`/decks/cards/edit?deckId=${DECK_ID}&cardId=${CARD_ID}`]);
  await screen.findByRole('button', { name: /save changes/i });
}

/** Type over whatever is in the Question box. */
async function retypeQuestion(text: string): Promise<void> {
  await userEvent.clear(questionBox());
  await userEvent.type(questionBox(), text);
}

/** The expectedVersion on the nth updateCard call (1-based). */
function sentVersion(nth: number): unknown {
  return (api.updateCard.mock.calls[nth - 1][0] as { expectedVersion?: unknown }).expectedVersion;
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardById.mockResolvedValue(ok(card(4)));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // The page mounts bare, so useCard/useDeck run on the app singleton. Clearing
  // it keeps one case's cached card from being served to the next.
  queryClient.clear();
  signOut();
});

describe('a save that lost a version race', () => {
  it('re-reads the card and retries with the version the server is holding', async () => {
    await mountLoaded();

    // Ordering matters and it is the mechanism under test: the re-read happens
    // DURING the failed save, not after it, so the newer version has to be what
    // the server is already answering by the time Save is pressed.
    api.fetchCardById.mockResolvedValue(ok(card(9)));
    api.updateCard.mockResolvedValueOnce(refused<Card>('VERSION_CONFLICT', STALE_MESSAGE));

    await userEvent.click(saveButton());
    expect(await screen.findByText(new RegExp(STALE_MESSAGE))).not.toBeNull();
    // The version read when the page loaded, which is the one that lost.
    expect(sentVersion(1)).toBe(4);

    api.updateCard.mockResolvedValueOnce(refused<Card>('VERSION_CONFLICT', STALE_MESSAGE));
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(2));

    // Without the re-read this is 4 again, which is the original bug in one
    // number: the same rejected request, sent forever.
    expect(sentVersion(2)).toBe(9);
  });

  it('keeps the text the user had typed', async () => {
    await mountLoaded();

    // The re-read answers with a card whose question is different, and the form
    // must NOT adopt it: the point of the recovery is that the edit survives.
    // Reloading was always available and always cost exactly this.
    api.fetchCardById.mockResolvedValue(ok(card(9, { question: 'Somebody else rewrote it' })));
    api.updateCard.mockResolvedValue(refused<Card>('VERSION_CONFLICT', STALE_MESSAGE));

    await retypeQuestion('My unsaved rewrite');
    await userEvent.click(saveButton());
    await screen.findByText(new RegExp(STALE_MESSAGE));

    expect(questionBox().value).toBe('My unsaved rewrite');
    expect(screen.queryByDisplayValue('Somebody else rewrote it')).toBeNull();
  });

  it('offers the retry button, and it sends what is on screen when it is pressed', async () => {
    await mountLoaded();

    api.fetchCardById.mockResolvedValue(ok(card(9)));
    api.updateCard.mockResolvedValueOnce(refused<Card>('VERSION_CONFLICT', STALE_MESSAGE));

    await retypeQuestion('First rewrite');
    await userEvent.click(saveButton());
    await screen.findByText(new RegExp(STALE_MESSAGE));

    api.updateCard.mockResolvedValueOnce(ok(card(10)));

    // Edited AFTER the conflict was reported. A recovery button that replayed a
    // snapshot taken when the banner appeared would send "First rewrite" here,
    // and would look correct in every test that did not type twice.
    await retypeQuestion('Second rewrite');
    await userEvent.click(screen.getByRole('button', { name: RETRY_LABEL }));

    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(2));
    const secondCall = api.updateCard.mock.calls[1][0] as { question?: string };
    expect(secondCall.question).toBe('Second rewrite');
    expect(sentVersion(2)).toBe(9);
  });

  it('leaves the page for the card list once the retry is accepted', async () => {
    await mountLoaded();

    api.fetchCardById.mockResolvedValue(ok(card(9)));
    api.updateCard.mockResolvedValueOnce(refused<Card>('VERSION_CONFLICT', STALE_MESSAGE));

    await userEvent.click(saveButton());
    await screen.findByRole('button', { name: RETRY_LABEL });

    api.updateCard.mockResolvedValueOnce(ok(card(10)));

    await userEvent.click(screen.getByRole('button', { name: RETRY_LABEL }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull());
  });
});

describe('a conflict this console cannot recover from', () => {
  it('says to reload and offers no button, when the re-read fails too', async () => {
    await mountLoaded();

    // The reread is the next fetchCardById, and it does not come back.
    api.updateCard.mockResolvedValue(refused<Card>('VERSION_CONFLICT', STALE_MESSAGE));
    api.fetchCardById.mockResolvedValue(networkFailure<Card>('Network error.'));
    await userEvent.click(saveButton());

    expect(await screen.findByText(/could not read the current version/i)).not.toBeNull();
    // No newer version was obtained, so a retry would send the rejected one
    // again. Offering the button here is the bug in a friendlier costume.
    expect(screen.queryByRole('button', { name: RETRY_LABEL })).toBeNull();
  });
});

describe('every other refusal', () => {
  it('is shown as it always was, with no retry button and no extra request', async () => {
    api.updateCard.mockResolvedValue(refused<Card>('VALIDATION_FAILED', 'Question is too long.'));
    await mountLoaded();

    const readsBefore = api.fetchCardById.mock.calls.length;
    await userEvent.click(saveButton());

    expect(await screen.findByText('Question is too long.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: RETRY_LABEL })).toBeNull();
    // The re-read belongs to the conflict path alone. Firing it for every
    // refusal would double the request count on the page's busiest failure.
    expect(api.fetchCardById.mock.calls.length).toBe(readsBefore);
  });
});
