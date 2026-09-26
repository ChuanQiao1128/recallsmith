// @vitest-environment jsdom
//
// The unsaved-changes guard, on the data router it requires.
//
// useUnsavedChangesGuard leans on three things a plain <MemoryRouter> cannot
// give it: useBlocker (data router only), the console's confirm dialog, and a
// beforeunload listener. The behaviours below are driven through a small harness
// mounted under createMemoryRouter, and the last two cases exercise the two real
// call sites — CardForm's onDirtyChange and EditCardPage's Cancel — end to end.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Link, Outlet, RouterProvider, createMemoryRouter, useNavigate } from 'react-router-dom';

import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { useUnsavedChangesGuard } from '../src/hooks/useUnsavedChangesGuard';
import { CardForm } from '../src/components/CardForm';
import type { CardFormValues } from '../src/components/CardForm';
import { renderAt } from './support/routerProbe';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ok } from './support/apiResult';
import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { queryClient } from '../src/api/queryClient';

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

const deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  locale: 'en',
  version: 3,
} as Deck;

function card(over: Partial<Card> = {}): Card {
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
    version: 4,
    ...over,
  } as Card;
}

// --- The navigation harness ------------------------------------------------

/** A page that guards `dirty` and offers both a blocked link and a saved exit. */
function Editor({ dirty }: { dirty: boolean }) {
  const guard = useUnsavedChangesGuard(dirty);
  const navigate = useNavigate();
  return (
    <div>
      <span>editor page</span>
      <Link to="/next">leave via link</Link>
      <button
        type="button"
        onClick={() => {
          guard.allowNextNavigation();
          navigate('/next');
        }}
      >
        save and leave
      </button>
    </div>
  );
}

function Target() {
  return <span>target page</span>;
}

/** Editor and Target under a data router, the confirm dialog available to both. */
function renderRoutes(dirty: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ConfirmDialogProvider>
            <Outlet />
          </ConfirmDialogProvider>
        ),
        children: [
          { index: true, element: <Editor dirty={dirty} /> },
          { path: 'next', element: <Target /> },
        ],
      },
    ],
    { initialEntries: ['/'] },
  );
  return render(<RouterProvider router={router} />);
}

/** A harness whose dirtiness is toggled by a button, for the beforeunload case. */
function BeforeUnloadHarness() {
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);
  return (
    <button type="button" onClick={() => setDirty(true)}>
      make dirty
    </button>
  );
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardById.mockResolvedValue(ok(card()));
  api.updateCard.mockResolvedValue(ok(card()));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  queryClient.clear();
  signOut();
});

describe('the unsaved-changes guard', () => {
  it('lets a clean page navigate without asking', async () => {
    const user = userEvent.setup();
    renderRoutes(false);

    await user.click(screen.getByRole('link', { name: /leave via link/i }));

    expect(await screen.findByText('target page')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before an in-app navigation discards unsaved changes', async () => {
    const user = userEvent.setup();
    renderRoutes(true);

    await user.click(screen.getByRole('link', { name: /leave via link/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Discard unsaved changes?')).toBeTruthy();
    // The page it was blocked from leaving is still on screen.
    expect(screen.getByText('editor page')).toBeTruthy();
    expect(screen.queryByText('target page')).toBeNull();
  });

  it('stays on the page when the discard is cancelled', async () => {
    const user = userEvent.setup();
    renderRoutes(true);

    await user.click(screen.getByRole('link', { name: /leave via link/i }));
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByText('editor page')).toBeTruthy();
    expect(screen.queryByText('target page')).toBeNull();
  });

  it('leaves once the discard is confirmed', async () => {
    const user = userEvent.setup();
    renderRoutes(true);

    await user.click(screen.getByRole('link', { name: /leave via link/i }));
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(await screen.findByText('target page')).toBeTruthy();
  });

  it('lets the save navigate away after allowNextNavigation', async () => {
    const user = userEvent.setup();
    renderRoutes(true);

    await user.click(screen.getByRole('button', { name: /save and leave/i }));

    expect(await screen.findByText('target page')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('warns on reload or close only while dirty', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter([{ path: '/', element: <BeforeUnloadHarness /> }], {
      initialEntries: ['/'],
    });
    render(<RouterProvider router={router} />);

    // Clean: no listener registered, so the browser is free to leave.
    const whenClean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(whenClean);
    expect(whenClean.defaultPrevented).toBe(false);

    await user.click(screen.getByRole('button', { name: /make dirty/i }));

    // Dirty: the listener preventDefaults, which is what triggers the prompt.
    const whenDirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(whenDirty);
    expect(whenDirty.defaultPrevented).toBe(true);
  });

  it('CardForm reports dirty when a field changes and clean when it is restored', async () => {
    const onDirtyChange = vi.fn();
    const initialValues: CardFormValues = {
      question: 'Q',
      stableUid: 'cs-x-001',
      explanation: '',
      realWorldUsage: '',
      codeSnippet: '',
      codeLanguage: '',
      difficulty: 2,
      orderInDeck: 10,
      revision: 1,
    };

    render(
      <CardForm
        mode="create"
        deck={deck}
        initialValues={initialValues}
        onSubmit={async () => ({ ok: true })}
        onCancel={() => {}}
        onDirtyChange={onDirtyChange}
      />,
    );

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

    const question = screen.getByLabelText(/question/i);
    fireEvent.change(question, { target: { value: 'Changed' } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    // Back to exactly the mount value, so the form is clean again.
    fireEvent.change(question, { target: { value: 'Q' } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('EditCardPage asks before Cancel throws away an edit', async () => {
    const user = userEvent.setup();

    // Two entries: the card list first, the edit URL last. The memory router
    // starts on the last, so navigate(-1) (what Cancel calls) has somewhere to
    // go and the guard can block that POP.
    renderAt(
      <ConfirmDialogProvider>
        <EditCardPage />
      </ConfirmDialogProvider>,
      [`/decks/cards?deckId=${DECK_ID}`, `/decks/cards/edit?deckId=${DECK_ID}&cardId=${CARD_ID}`],
    );

    const explanation = await screen.findByLabelText(/explanation/i);
    await user.type(explanation, ' and a longer note');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Discard unsaved changes?')).toBeTruthy();
  });

  it('main.tsx mounts the app through a data router', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/main.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('createBrowserRouter(');
    expect(source).toContain('<RouterProvider');
    expect(source).not.toContain('<BrowserRouter');
  });
});
