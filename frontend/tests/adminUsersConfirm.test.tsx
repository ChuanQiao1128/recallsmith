// @vitest-environment jsdom
//
// The one action in this console that asks the user to type something.
//
// "Reset & migrate" DROPs and recreates decks, cards, progress, logs and
// permissions on whichever API the console is pointed at. It sits in the same
// flex row as "Run migrate (no reset)", differing by colour, and until this step
// the only thing between a mis-click and an empty database was a window.confirm
// whose text said "Only use this in DEV" — a sentence, in a button that ships in
// every build.
//
// So the friction here is deliberately higher than anywhere else, and the first
// case below is the one that keeps it *here*. If a later change decides that
// typed confirmation is a good idea generally and puts a phrase gate on the
// plain migrate too, that case goes red. That is the intended outcome: a token
// only buys attention while it is rare, and four of them teach the user to type
// without reading, which is worse than one click because it manufactures the
// appearance of care.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { ApiResult } from '../src/types/api';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

const api = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  listAdminDecks: vi.fn(),
  runMigrate: vi.fn(),
}));

vi.mock('../src/api/admin', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/admin')>();
  return { ...actual, ...api };
});

const { AdminUsersPage } = await import('../src/pages/AdminUsersPage');

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

const RESET_BUTTON = 'Reset & migrate (DEV only)';
const PLAIN_BUTTON = 'Run migrate (no reset)';
/** The dialog's own confirm button, named for the action rather than "Confirm". */
const RESET_CONFIRM = 'Reset & migrate';

async function mountAdmin(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <ConfirmDialogProvider>
        <AdminUsersPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  // The danger zone lives inside a <details>, which renders its contents
  // regardless of open state, so the buttons are queryable without expanding.
  await screen.findByRole('button', { name: RESET_BUTTON }, { timeout: 2000 });
}

function dialog(): HTMLElement {
  return screen.getByRole('alertdialog');
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.listAdminUsers.mockResolvedValue(ok([]));
  api.listAdminDecks.mockResolvedValue(ok([]));
  api.runMigrate.mockResolvedValue(ok({ reset: true }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the plain migration is left alone', () => {
  it('runs straight away, with no dialog and no typing', async () => {
    // The control case for the whole design. "Run migrate (no reset)" is safe
    // for production and additive; making the user confirm it would spend the
    // attention the reset dialog needs.
    await mountAdmin();
    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.runMigrate).toHaveBeenCalledWith(false));
  });
});

describe('the reset asks first', () => {
  it('opens a dialog that says what will be dropped', async () => {
    await mountAdmin();
    await userEvent.click(screen.getByRole('button', { name: RESET_BUTTON }));

    const text = dialog().textContent ?? '';
    expect(text).toContain('DROP');
    // The five tables by name, because "core tables" is the kind of phrase a
    // reader supplies their own meaning for.
    expect(text).toContain('decks / cards / progress / logs / permissions');
    expect(text).toContain('There is no undo.');
    expect(api.runMigrate).not.toHaveBeenCalled();
  });

  it('opens with focus in the input, not on either button', async () => {
    // The gated dialog's opening focus is the input: it is the only thing there
    // is to do, and it is also the control furthest from destroying anything.
    await mountAdmin();
    await userEvent.click(screen.getByRole('button', { name: RESET_BUTTON }));

    const input = within(dialog()).getByRole('textbox');
    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(
      within(dialog()).getByRole('button', { name: RESET_CONFIRM }),
    );
  });

  it('keeps the confirm button disabled until the phrase is exact', async () => {
    await mountAdmin();
    await userEvent.click(screen.getByRole('button', { name: RESET_BUTTON }));

    const confirmBtn = within(dialog()).getByRole('button', {
      name: RESET_CONFIRM,
    }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Close, but not equal. A gate that accepted this would be a spelling test,
    // not a gate.
    await userEvent.type(within(dialog()).getByRole('textbox'), 'reset');
    expect(confirmBtn.disabled).toBe(true);
  });

  it('does not migrate on a wrong phrase, however hard the button is pressed', async () => {
    await mountAdmin();
    await userEvent.click(screen.getByRole('button', { name: RESET_BUTTON }));
    await userEvent.type(within(dialog()).getByRole('textbox'), 'RESETT');
    await userEvent.click(within(dialog()).getByRole('button', { name: RESET_CONFIRM }));

    expect(api.runMigrate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeNull();
  });

  it('migrates with reset once the phrase is right and the button is pressed', async () => {
    await mountAdmin();
    await userEvent.click(screen.getByRole('button', { name: RESET_BUTTON }));
    await userEvent.type(within(dialog()).getByRole('textbox'), 'RESET');
    await userEvent.click(within(dialog()).getByRole('button', { name: RESET_CONFIRM }));

    // `true` is the whole point: the same function is called for both buttons
    // and the flag is what drops the tables.
    await waitFor(() => expect(api.runMigrate).toHaveBeenCalledWith(true));
  });

  it('runs nothing when the answer is no, even with the phrase typed', async () => {
    // Typing the phrase is not consent; pressing the button is. An
    // implementation that ran on input change, or that treated a satisfied
    // phrase as an answer, would pass every case above and fail this one.
    await mountAdmin();
    await userEvent.click(screen.getByRole('button', { name: RESET_BUTTON }));
    await userEvent.type(within(dialog()).getByRole('textbox'), 'RESET');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.runMigrate).not.toHaveBeenCalled();
  });
});
