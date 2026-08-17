// @vitest-environment jsdom
//
// "We could not read the user list" and "there are no users" are different
// sentences, and this console has one row of table markup for both.
//
// The failure mode this file exists for is an administrator opening the page,
// seeing a clean empty table, and concluding the accounts are gone — or, on the
// permission editor next door, that an editor has no access when in fact the
// answer never arrived. So every failure case below asserts two things: that
// the server's own wording is on the screen, and that "No users returned." is
// NOT. The second half is the one that matters.
//
// Honest about the teeth: the business-refusal case and the network-failure
// case share a single mutation. Replacing `usersRes.error?.message ?? '...'`
// with the bare fallback turns both red together, so they are not two
// independent guards on the message. They are kept apart anyway because the two
// shapes reach the page by different routes — a 200 carrying success:false, and
// a thrown request the api layer converts to NETWORK_ERROR — and a change that
// handled only one of them is exactly the kind that looks fine in review. What
// they independently pin, and what no other case here covers, is the half about
// not degrading into the empty state.
//
// Not modelled: a rejected promise. src/api/admin.ts wraps every call in
// try/catch and returns `fail(...)`, so the page cannot observe one; loadAll's
// own catch is unreachable through the real api layer. Inventing a fifth shape
// would be testing a state the system cannot enter. See tests/support/apiResult.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { AdminUser } from '../src/api/admin';
import type { ApiResult } from '../src/types/api';
import { deferred, networkFailure, ok, refused } from './support/apiResult';
import { alice, bob, decks, unstubbed } from './support/adminFixtures';
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

const EMPTY_ROW = 'No users returned.';

function mount(): void {
  render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <ConfirmDialogProvider>
        <AdminUsersPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.listAdminDecks.mockResolvedValue(ok(decks()));
  api.listAdminUsers.mockImplementation(unstubbed('listAdminUsers'));
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

describe('while the user list is in flight', () => {
  it('says it is loading, and shows no table until the answer arrives', async () => {
    const pending = deferred<ApiResult<AdminUser[]>>();
    api.listAdminUsers.mockReturnValue(pending.promise);

    mount();

    expect(await screen.findByText('Loading users...')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('alice_editor')).toBeNull();

    pending.resolve(ok([alice(), bob()]));

    expect(await screen.findByText('alice_editor')).not.toBeNull();
    expect(screen.queryByText('Loading users...')).toBeNull();
    expect(screen.queryByRole('table')).not.toBeNull();
  });
});

describe('when the server refuses the user list', () => {
  it('shows the sentence the server chose, not an empty table', async () => {
    api.listAdminUsers.mockResolvedValue(
      refused<AdminUser[]>('FORBIDDEN', 'deck service says no'),
    );

    mount();

    // The server's own wording, because the page hard-coding "Failed to load
    // users." over the top of it hides the one piece of information that tells
    // an operator what to do next.
    expect(await screen.findByText('deck service says no')).not.toBeNull();
    expect(screen.queryByText(EMPTY_ROW)).toBeNull();
  });
});

describe('when the request never got an answer', () => {
  it('still says so, rather than reporting an empty console', async () => {
    api.listAdminUsers.mockResolvedValue(networkFailure<AdminUser[]>('socket hang up'));

    mount();

    expect(await screen.findByText('socket hang up')).not.toBeNull();
    expect(screen.queryByText(EMPTY_ROW)).toBeNull();
  });
});

describe('when there really are no users', () => {
  it('says so, with no error anywhere on the page', async () => {
    api.listAdminUsers.mockResolvedValue(ok<AdminUser[]>([]));

    mount();

    expect(await screen.findByText(EMPTY_ROW)).not.toBeNull();
    expect(screen.queryByText('0 user(s)')).not.toBeNull();
    expect(screen.queryByText('Failed to load users')).toBeNull();
  });
});

describe('searching the user list', () => {
  it('hides the rows that do not match, and counts what is left', async () => {
    api.listAdminUsers.mockResolvedValue(ok([alice(), bob()]));

    mount();
    expect(await screen.findByText('2 user(s)')).not.toBeNull();
    expect(screen.queryByText('bob_editor')).not.toBeNull();

    await userEvent.type(screen.getByPlaceholderText(/Search users/), 'alice');

    await waitFor(() => expect(screen.queryByText('bob_editor')).toBeNull());
    expect(screen.queryByText('alice_editor')).not.toBeNull();
    expect(screen.queryByText('1 user(s)')).not.toBeNull();
  });
});
