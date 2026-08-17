// @vitest-environment jsdom
//
// The permission editor sends `mode: 'replace'`. Everything below follows from
// that one word.
//
// A replace is not "apply these changes"; it is "this list is now the whole
// truth for this user". Anything the console leaves out of that array is
// revoked, silently, on the server, whether or not the operator meant it — and
// the operator is looking at a filtered table while they press the button. The
// heaviest case in this file is the one where a deck is ticked and then filtered
// out of view: the payload still has to carry it. Building the array from the
// rows currently on screen is a one-word edit (`deckState.decks` ->
// `filteredDecks`) that no other case in this repository notices.
//
// The empty payload is the same argument from the other end. Untick everything
// and the console must send `permissions: []` — not skip the call as a
// "no-op", which would leave the old grants in place while the screen claims
// they are gone, and not fall back to `merge`, which would leave them in place
// while reporting success.
//
// Scoping note: rows are found through the username cell and `closest('tr')`
// rather than by index into getAllByRole. Two users are on screen, both with a
// "Manage" button, and an index would silently follow a reordering.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ok, refused } from './support/apiResult';
import { ALICE_SUB, alice, bob, decks, unstubbed } from './support/adminFixtures';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

const api = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  listAdminDecks: vi.fn(),
  createAdminUser: vi.fn(),
  saveAdminDeckPermissionsBulk: vi.fn(),
  runMigrate: vi.fn(),
}));

vi.mock('../src/api/admin', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/admin')>();
  return { ...actual, ...api };
});

const { AdminUsersPage } = await import('../src/pages/AdminUsersPage');

const SAVE_BUTTON = 'Save permissions';

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <ConfirmDialogProvider>
        <AdminUsersPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText('2 user(s)');
}

/** Open the permission editor on the row whose username cell reads `username`. */
async function manage(username: string): Promise<void> {
  const row = screen.getByText(username).closest('tr');
  if (!row) throw new Error(`no table row for ${username}`);
  await userEvent.click(within(row).getByRole('button', { name: 'Manage' }));
}

function readBox(slug: string): HTMLElement {
  return screen.getByRole('checkbox', { name: `Read permission for ${slug}` });
}

function writeBox(slug: string): HTMLElement {
  return screen.getByRole('checkbox', { name: `Write permission for ${slug}` });
}

/** True iff the accessibility tree reports this box as ticked. */
function isChecked(slug: string, kind: 'Read' | 'Write'): boolean {
  return (
    screen.queryByRole('checkbox', {
      name: `${kind} permission for ${slug}`,
      checked: true,
    }) !== null
  );
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.listAdminUsers.mockResolvedValue(ok([alice(), bob()]));
  api.listAdminDecks.mockResolvedValue(ok(decks()));
  api.createAdminUser.mockImplementation(unstubbed('createAdminUser'));
  api.saveAdminDeckPermissionsBulk.mockImplementation(unstubbed('saveAdminDeckPermissionsBulk'));
  api.runMigrate.mockImplementation(unstubbed('runMigrate'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the write-implies-read rule, as the operator sees it', () => {
  it('ticks Read when Write is ticked', async () => {
    await mountConsole();
    await manage('alice_editor');

    expect(isChecked('d-two', 'Read')).toBe(false);
    await userEvent.click(writeBox('d-two'));

    // Not cosmetic: an editor with write and no read is a state the backend
    // rule ("cards inherit deck permission") has no meaning for.
    expect(isChecked('d-two', 'Read')).toBe(true);
    expect(isChecked('d-two', 'Write')).toBe(true);
  });

  it('unticks Write when Read is taken away', async () => {
    await mountConsole();
    await manage('alice_editor');

    expect(isChecked('d-one', 'Write')).toBe(true);
    await userEvent.click(readBox('d-one'));

    expect(isChecked('d-one', 'Read')).toBe(false);
    expect(isChecked('d-one', 'Write')).toBe(false);
  });
});

describe('filtering the deck table', () => {
  it('does not revoke the decks it hides', async () => {
    api.saveAdminDeckPermissionsBulk.mockResolvedValue(ok({ saved: 2, replace: true }));

    await mountConsole();
    await manage('alice_editor');

    // Grant d-two, then search for d-one so d-two leaves the screen. The
    // operator's search box is a viewport, not an editing gesture.
    await userEvent.click(writeBox('d-two'));
    await userEvent.type(screen.getByPlaceholderText(/Search decks/), 'd-one');
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Write permission for d-two' })).toBeNull(),
    );

    await userEvent.click(screen.getByRole('button', { name: SAVE_BUTTON }));

    // The whole payload, not a `toContain`: with `replace` semantics the decks
    // that are absent are as load-bearing as the ones that are present.
    await waitFor(() =>
      expect(api.saveAdminDeckPermissionsBulk).toHaveBeenCalledWith({
        adminSub: ALICE_SUB,
        mode: 'replace',
        permissions: [
          { deckId: 1, canRead: true, canWrite: true },
          { deckId: 2, canRead: true, canWrite: true },
        ],
      }),
    );
  });
});

describe('taking every deck away', () => {
  it('sends an explicit empty replace rather than nothing at all', async () => {
    api.saveAdminDeckPermissionsBulk.mockResolvedValue(ok({ saved: 0, replace: true }));

    await mountConsole();
    await manage('alice_editor');

    await userEvent.click(readBox('d-one'));
    await userEvent.click(screen.getByRole('button', { name: SAVE_BUTTON }));

    await waitFor(() =>
      expect(api.saveAdminDeckPermissionsBulk).toHaveBeenCalledWith({
        adminSub: ALICE_SUB,
        mode: 'replace',
        permissions: [],
      }),
    );
  });
});

describe('when the save fails', () => {
  it('says why, claims nothing, and gives the button back', async () => {
    api.saveAdminDeckPermissionsBulk.mockResolvedValue(
      refused<{ saved: number; replace: boolean }>('DECK_LOCKED', 'Deck 2 is being published.'),
    );

    await mountConsole();
    await manage('alice_editor');
    await userEvent.click(writeBox('d-two'));
    await userEvent.click(screen.getByRole('button', { name: SAVE_BUTTON }));

    expect(await screen.findByText('Deck 2 is being published.')).not.toBeNull();
    expect(screen.queryByText('Saved')).toBeNull();
    // A button stuck reading "Saving..." after a failed save is a page that
    // looks like it is still trying. It is not.
    expect(screen.queryByRole('button', { name: SAVE_BUTTON })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Saving...' })).toBeNull();
  });
});

describe('when the save succeeds', () => {
  it('reports the count the server returned and re-reads the list', async () => {
    // 3, not 0 or 1: a page that printed its own tally of ticked boxes would
    // agree with the server at 0 and at 1 by accident.
    api.saveAdminDeckPermissionsBulk.mockResolvedValue(ok({ saved: 3, replace: true }));

    await mountConsole();
    await manage('alice_editor');
    await userEvent.click(writeBox('d-two'));
    await userEvent.click(screen.getByRole('button', { name: SAVE_BUTTON }));

    expect(await screen.findByText('Saved. (3 deck(s) now assigned)')).not.toBeNull();
    await waitFor(() => expect(api.listAdminUsers).toHaveBeenCalledTimes(2));
  });
});

describe('a user with no sub', () => {
  it('is refused locally rather than saved against an undefined key', async () => {
    await mountConsole();
    await manage('bob_editor');
    await userEvent.click(writeBox('d-two'));
    await userEvent.click(screen.getByRole('button', { name: SAVE_BUTTON }));

    expect(
      await screen.findByText('Selected user has no "sub" attribute. Cannot save permissions.'),
    ).not.toBeNull();
    // The point of the guard: a bulk replace keyed on `undefined` is a write
    // whose target nobody can predict.
    expect(api.saveAdminDeckPermissionsBulk).not.toHaveBeenCalled();
  });
});
