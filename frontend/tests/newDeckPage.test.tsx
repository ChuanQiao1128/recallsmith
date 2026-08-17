// @vitest-environment jsdom
//
// Characterization tests for NewDeckPage. Written and run green against a
// COMPLETELY UNMODIFIED NewDeckPage.tsx.
//
// The fields this page collects and then does not send are a separate file,
// tests/deckFormFieldDrop.test.tsx, because that net is meant to go RED when
// the defect is fixed and this one is not.
//
// TWO MEASURED FACTS ABOUT THIS PAGE'S DOM, both of which decide how it is
// driven below. Neither is guessable from reading the source, and both were
// established with a throwaway probe before any case was written.
//
//   1. Title / Slug / Author have a <label> that is a SIBLING of the <input>
//      with no `for` and no id, so getByLabelText fails on all three ("no form
//      control was found associated to that label"). They are reached by
//      placeholder. The missing association is a real accessibility defect and
//      is recorded, not fixed. Locale and FreeCardCount do carry aria-label and
//      are reached by name.
//
//   2. jsdom RUNS HTML constraint validation. The FreeCardCount box is
//      <input type="number" min={0}>, so with -1 in it a click on Create Deck
//      never reaches handleSubmit at all — no request, and no error message
//      either. Only fireEvent.submit(form) gets past the browser to the
//      page's own check. Every other case clicks the real button, which is
//      also what keeps type="submit" covered.
//
// A THIRD MEASURED FACT, about the Slug box: onChange runs slugify on every
// keystroke, so typing "js-core-basics" one character at a time yields
// "jscorebasics" — each hyphen is stripped as a trailing hyphen before the next
// letter arrives. That is a real defect and it is RECORDED, not pinned: no case
// below asserts it, because writing one would turn a bug into a contract. It
// does dictate mechanism, though. setSlug() uses fireEvent.change, which
// delivers the whole string in one event the way a paste does, and is the only
// way a hyphenated slug can be put in this box at all.
//
// ONE BRANCH, NOT TWO: createDeck is a try/catch returning fail(...) and never
// rejects, so the refusal and the dropped-connection cases render the same
// banner. The page's own catch (-> 'Network error.') is unreachable from the
// api layer and is recorded as dead code.
//
// The mutations these tests are built to fail against:
//
//   1. reordering or deleting any one of the five validation guards — each has
//      its own case asserting createDeck was called ZERO times.
//   2. `!trimmedTitle` -> `!form.title`, which lets "   " through.
//   3. the freeCardCount reset ternary in setDeckType collapsing to `prev
//      .freeCardCount` or to a constant 50.
//   4. slugify losing either its character replacement or its edge stripping.
//   5. handleTitleBlur losing the `!form.slug.trim()` guard, which would
//      overwrite a slug the user typed themselves.
//   6. navigate(-1) on Cancel becoming navigate('/'), which is why the two
//      history entries below are not both '/'.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import { signOut } from './support/consoleSession';
import { deferred, networkFailure, ok, refused } from './support/apiResult';
import { locationText, renderAt } from './support/routerProbe';

const api = vi.hoisted(() => ({
  createDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { NewDeckPage } = await import('../src/pages/NewDeckPage');

const REFUSAL_MESSAGE = 'A deck with that slug already exists.';
const THROWN_MESSAGE = 'socket hang up';

/**
 * The previous entry is deliberately NOT '/'. Cancel calls navigate(-1) and the
 * Back link goes to '/', and with '/' as the previous entry those two would be
 * indistinguishable — a Cancel rewired to navigate('/') would stay green.
 */
const PREVIOUS_PAGE = '/decks?page=3';

const createdDeck: Deck = {
  id: 42,
  slug: 'js-core-basics',
  title: 'JavaScript Core Basics',
  author: 'RecallSmith Team',
  locale: 'en-US',
  deckType: 1,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function mount() {
  return renderAt(<NewDeckPage />, [PREVIOUS_PAGE, '/decks/new']);
}

const titleBox = () => screen.getByPlaceholderText('JavaScript Core Basics') as HTMLInputElement;
const slugBox = () => screen.getByPlaceholderText('js-core-basics') as HTMLInputElement;
const authorBox = () => screen.getByPlaceholderText('RecallSmith Team') as HTMLInputElement;
const versionBox = () => screen.getByPlaceholderText('1.0.0') as HTMLInputElement;
const freeCardBox = () => screen.getByLabelText('Free Card Count') as HTMLInputElement;

/** See the header note: a paste, because typing eats the hyphens. */
function setSlug(value: string): void {
  fireEvent.change(slugBox(), { target: { value } });
}

function starterRadio(): HTMLInputElement {
  return screen.getAllByRole('radio')[0] as HTMLInputElement;
}

function paidRadio(): HTMLInputElement {
  return screen.getAllByRole('radio')[1] as HTMLInputElement;
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^(Create Deck|Creating\.\.\.)$/ }) as HTMLButtonElement;
}

/** Fill the four required boxes with values that pass every guard. */
function fillValid(): void {
  fireEvent.change(titleBox(), { target: { value: 'JavaScript Core Basics' } });
  setSlug('js-core-basics');
  fireEvent.change(authorBox(), { target: { value: 'RecallSmith Team' } });
  fireEvent.change(versionBox(), { target: { value: '1.0.0' } });
}

/** The browser's own submit, bypassing constraint validation. See header. */
function submitPastConstraintValidation(): void {
  const form = document.querySelector('form');
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

beforeEach(() => {
  signOut();
  api.createDeck.mockResolvedValue(ok(createdDeck));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the form a user is handed', () => {
  it('starts with an author, a locale and a content version already filled in', async () => {
    mount();

    expect(titleBox().value).toBe('');
    expect(slugBox().value).toBe('');
    expect(authorBox().value).toBe('RecallSmith Team');
    expect(versionBox().value).toBe('1.0.0');
    expect((screen.getByLabelText('Locale') as HTMLSelectElement).value).toBe('en-US');
  });

  it('starts on Starter, which derives IsFreeStarter and hides the preview count', async () => {
    mount();

    expect(starterRadio().checked).toBe(true);
    expect(paidRadio().checked).toBe(false);
    expect(screen.queryByText('true')).not.toBeNull();
    // Starter decks are free in full, so there is no number to enter.
    expect(screen.queryByLabelText('Free Card Count')).toBeNull();
    expect(screen.queryByText('Auto (all cards)')).not.toBeNull();
  });

  it('swaps the derived flag and reveals the preview count on Paid', async () => {
    mount();
    await userEvent.click(paidRadio());

    expect(screen.queryByText('false')).not.toBeNull();
    expect(freeCardBox().value).toBe('50');
    expect(screen.queryByText('Auto (all cards)')).toBeNull();
  });
});

describe('switching back to Paid repairs an impossible preview count', () => {
  // The `Number.isFinite(prev.freeCardCount) && prev.freeCardCount >= 0`
  // ternary in setDeckType has exactly one reachable route to its else branch:
  // put a negative number in while on Paid, leave for Starter, come back.
  // Without these two cases that branch is dead code that nothing exercises.
  it('resets a negative count to fifty', async () => {
    mount();
    await userEvent.click(paidRadio());
    fireEvent.change(freeCardBox(), { target: { value: '-1' } });
    expect(freeCardBox().value).toBe('-1');

    await userEvent.click(starterRadio());
    await userEvent.click(paidRadio());

    expect(freeCardBox().value).toBe('50');
  });

  it('keeps a count that was already valid', async () => {
    // The other half: a reset that fired unconditionally would also say 50
    // here, and the case above alone cannot tell the two apart.
    mount();
    await userEvent.click(paidRadio());
    fireEvent.change(freeCardBox(), { target: { value: '7' } });

    await userEvent.click(starterRadio());
    await userEvent.click(paidRadio());

    expect(freeCardBox().value).toBe('7');
  });
});

describe('the slug the title suggests', () => {
  it('fills an empty slug on blur, stripping punctuation from both ends', async () => {
    mount();
    fireEvent.change(titleBox(), { target: { value: '¡Hello, World!' } });
    fireEvent.blur(titleBox());

    // Leading '¡' and trailing '!' both become '-' and are then stripped; the
    // ', ' in the middle collapses to a single '-'. A slugify that lost its
    // edge-stripping would give '-hello-world-'.
    expect(slugBox().value).toBe('hello-world');
  });

  it('does not overwrite a slug the user typed', async () => {
    mount();
    setSlug('my-own-slug');
    fireEvent.change(titleBox(), { target: { value: 'Completely Different Title' } });
    fireEvent.blur(titleBox());

    expect(slugBox().value).toBe('my-own-slug');
  });

  it('does nothing when the title is empty', async () => {
    mount();
    fireEvent.change(titleBox(), { target: { value: '   ' } });
    fireEvent.blur(titleBox());

    expect(slugBox().value).toBe('');
  });
});

describe('the five guards, in the order they fire', () => {
  it('asks for a title first, even when the slug is missing too', async () => {
    // Both are empty. Only the ORDER of the guards decides which message
    // appears, so this is the case that pins it.
    mount();
    await userEvent.click(submitButton());

    expect(await screen.findByText('Title is required.')).not.toBeNull();
    expect(screen.queryByText('Slug is required.')).toBeNull();
    expect(api.createDeck).toHaveBeenCalledTimes(0);
  });

  it('rejects a title of pure whitespace', async () => {
    mount();
    fireEvent.change(titleBox(), { target: { value: '   ' } });
    await userEvent.click(submitButton());

    expect(await screen.findByText('Title is required.')).not.toBeNull();
    expect(api.createDeck).toHaveBeenCalledTimes(0);
  });

  it('asks for a slug once the title is there', async () => {
    mount();
    fireEvent.change(titleBox(), { target: { value: 'JavaScript Core Basics' } });
    await userEvent.click(submitButton());

    expect(await screen.findByText('Slug is required.')).not.toBeNull();
    expect(api.createDeck).toHaveBeenCalledTimes(0);
  });

  it('asks for an author once the slug is there', async () => {
    mount();
    fireEvent.change(titleBox(), { target: { value: 'JavaScript Core Basics' } });
    setSlug('js-core-basics');
    fireEvent.change(authorBox(), { target: { value: '' } });
    await userEvent.click(submitButton());

    expect(await screen.findByText('Author is required.')).not.toBeNull();
    expect(api.createDeck).toHaveBeenCalledTimes(0);
  });

  it('asks for a content version once the author is there', async () => {
    mount();
    fillValid();
    fireEvent.change(versionBox(), { target: { value: '' } });
    await userEvent.click(submitButton());

    expect(await screen.findByText('Content version is required.')).not.toBeNull();
    expect(api.createDeck).toHaveBeenCalledTimes(0);
  });

  it('rejects a content version that is not semver', async () => {
    mount();
    fillValid();
    fireEvent.change(versionBox(), { target: { value: '1.0' } });
    await userEvent.click(submitButton());

    expect(await screen.findByText('Content version must be semver like 1.0.0')).not.toBeNull();
    expect(api.createDeck).toHaveBeenCalledTimes(0);
  });

  it('accepts the semver forms the regex allows', async () => {
    mount();
    fillValid();
    fireEvent.change(versionBox(), { target: { value: '2.10.3-alpha.1' } });
    await userEvent.click(submitButton());

    await waitFor(() => expect(api.createDeck).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Content version must be semver like 1.0.0')).toBeNull();
  });

  it('rejects a negative preview count on a Paid deck', async () => {
    mount();
    fillValid();
    await userEvent.click(paidRadio());
    fireEvent.change(freeCardBox(), { target: { value: '-1' } });

    // See the header: the click never reaches the page, so this one case uses
    // the form's own submit event.
    submitPastConstraintValidation();

    expect(await screen.findByText('Free card count must be a non-negative number.')).not.toBeNull();
    expect(api.createDeck).toHaveBeenCalledTimes(0);
  });

  it('does not check the preview count on a Starter deck', async () => {
    // The guard is inside `if (!isStarter)`. A Starter deck carrying a negative
    // count from an earlier Paid selection must still submit.
    mount();
    fillValid();
    await userEvent.click(paidRadio());
    fireEvent.change(freeCardBox(), { target: { value: '-1' } });
    await userEvent.click(starterRadio());
    await userEvent.click(submitButton());

    await waitFor(() => expect(api.createDeck).toHaveBeenCalledTimes(1));
  });
});

describe('a deck the server created', () => {
  it('is requested exactly once, and then the page leaves', async () => {
    mount();
    fillValid();
    await userEvent.click(submitButton());

    await waitFor(() => expect(api.createDeck).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(locationText()).toBe('/'));
  });

  it('sends the trimmed values', async () => {
    mount();
    fireEvent.change(titleBox(), { target: { value: '  JavaScript Core Basics  ' } });
    setSlug('js-core-basics');
    fireEvent.change(authorBox(), { target: { value: '  RecallSmith Team  ' } });
    fireEvent.change(versionBox(), { target: { value: '1.0.0' } });
    await userEvent.click(submitButton());

    await waitFor(() => expect(api.createDeck).toHaveBeenCalledTimes(1));
    expect(api.createDeck.mock.calls[0][0].title).toBe('JavaScript Core Basics');
    expect(api.createDeck.mock.calls[0][0].author).toBe('RecallSmith Team');
  });
});

describe('a deck the server would not create', () => {
  it('shows the refusal in the wording the server chose, and stays put', async () => {
    api.createDeck.mockResolvedValue(refused<Deck>('SLUG_TAKEN', REFUSAL_MESSAGE));
    mount();
    fillValid();
    await userEvent.click(submitButton());

    expect(await screen.findByText(REFUSAL_MESSAGE)).not.toBeNull();
    expect(locationText()).toBe('/decks/new');
  });

  it('falls back to its own wording when the server sent no message', async () => {
    api.createDeck.mockResolvedValue({ success: false, data: null, error: null, traceId: 't' } as ApiResult<Deck>);
    mount();
    fillValid();
    await userEvent.click(submitButton());

    expect(await screen.findByText('Create deck failed.')).not.toBeNull();
  });

  it('renders a thrown request through the same banner (recorded, not a second path)', async () => {
    api.createDeck.mockResolvedValue(networkFailure<Deck>(THROWN_MESSAGE));
    mount();
    fillValid();
    await userEvent.click(submitButton());

    expect(await screen.findByText(THROWN_MESSAGE)).not.toBeNull();
  });

  it('gives the button back so the user can try again', async () => {
    api.createDeck.mockResolvedValue(refused<Deck>('SLUG_TAKEN', REFUSAL_MESSAGE));
    mount();
    fillValid();
    await userEvent.click(submitButton());

    await screen.findByText(REFUSAL_MESSAGE);
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().textContent).toBe('Create Deck');
  });

  it('leaves nothing behind when success:true arrives with a null body', async () => {
    // createDeck's own contract turns that into a failure before the page sees
    // it, so the page navigates away on `result.success` alone. Pinned as
    // today's behaviour: the page trusts the flag, not the body.
    api.createDeck.mockResolvedValue({ success: true, data: null, error: null, traceId: 't' } as ApiResult<Deck>);
    mount();
    fillValid();
    await userEvent.click(submitButton());

    await waitFor(() => expect(locationText()).toBe('/'));
  });
});

describe('while the request is in flight', () => {
  it('locks the button and renames it', async () => {
    const d = deferred<ApiResult<Deck>>();
    api.createDeck.mockReturnValue(d.promise);
    mount();
    fillValid();
    await userEvent.click(submitButton());

    await waitFor(() => expect(submitButton().textContent).toBe('Creating...'));
    expect(submitButton().disabled).toBe(true);

    d.resolve(ok(createdDeck));
    await waitFor(() => expect(locationText()).toBe('/'));
  });
});

describe('the two ways out', () => {
  it('sends Cancel back through history, not to a fixed path', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(locationText()).toBe(PREVIOUS_PAGE);
  });

  it('sends Back to list to the deck list', async () => {
    mount();
    await userEvent.click(screen.getByRole('link', { name: '← Back to list' }));

    expect(locationText()).toBe('/');
  });
});
