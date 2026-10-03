// @vitest-environment jsdom
//
// "We could not read the deck permissions" and "no account holds one" are
// different sentences, and this console has one row of table markup for both.
//
// The failure mode this file exists for is an administrator opening the page,
// seeing a clean empty table, and concluding the grants are gone — or, on the
// permission editor next door, that an editor has no access when in fact the
// answer never arrived. So every failure case below asserts two things: that
// the server's own wording is on the screen, and that the empty-table sentence
// is NOT. The second half is the one that matters.
//
// (Since edge-public was retired on 2026-10-04 the table lists the Cognito subs
// that hold deck permissions, from core-vpc's GET /api/v1/admin/permissions; the
// console no longer reads the Cognito pool.)
//
// Honest about the teeth: the business-refusal case and the network-failure
// case share a single mutation. Replacing `holdersRes.error?.message ?? '...'`
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

import type { AdminPermissionHolder } from '../src/api/admin';
import type { ApiResult } from '../src/types/api';
import { deferred, networkFailure, ok, refused } from './support/apiResult';
import { ALICE_SUB, BOB_SUB, alice, bob, decks, unstubbed } from './support/adminFixtures';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

const api = vi.hoisted(() => ({
  listAdminPermissionHolders: vi.fn(),
  listAdminDecks: vi.fn(),
  saveAdminDeckPermissionsBulk: vi.fn(),
  runMigrate: vi.fn(),
}));

vi.mock('../src/api/admin', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/admin')>();
  return { ...actual, ...api };
});

const { AdminUsersPage } = await import('../src/pages/AdminUsersPage');

const EMPTY_ROW = 'No account holds a deck permission.';

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
  api.listAdminPermissionHolders.mockImplementation(unstubbed('listAdminPermissionHolders'));
  api.saveAdminDeckPermissionsBulk.mockImplementation(unstubbed('saveAdminDeckPermissionsBulk'));
  api.runMigrate.mockImplementation(unstubbed('runMigrate'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('while the account list is in flight', () => {
  it('says it is loading, and shows no table until the answer arrives', async () => {
    const pending = deferred<ApiResult<AdminPermissionHolder[]>>();
    api.listAdminPermissionHolders.mockReturnValue(pending.promise);

    mount();

    expect(await screen.findByText('Loading accounts...')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(ALICE_SUB)).toBeNull();

    pending.resolve(ok([alice(), bob()]));

    expect(await screen.findByText(ALICE_SUB)).not.toBeNull();
    expect(screen.queryByText('Loading accounts...')).toBeNull();
    expect(screen.queryByRole('table')).not.toBeNull();
  });
});

describe('when the server refuses the deck permissions', () => {
  it('shows the sentence the server chose, not an empty table', async () => {
    api.listAdminPermissionHolders.mockResolvedValue(
      refused<AdminPermissionHolder[]>('FORBIDDEN', 'deck service says no'),
    );

    mount();

    // The server's own wording, because the page hard-coding a fallback over
    // the top of it hides the one piece of information that tells an operator
    // what to do next.
    expect(await screen.findByText('deck service says no')).not.toBeNull();
    expect(screen.queryByText(EMPTY_ROW)).toBeNull();
  });
});

describe('when the request never got an answer', () => {
  it('still says so, rather than reporting an empty console', async () => {
    api.listAdminPermissionHolders.mockResolvedValue(
      networkFailure<AdminPermissionHolder[]>('socket hang up'),
    );

    mount();

    expect(await screen.findByText('socket hang up')).not.toBeNull();
    expect(screen.queryByText(EMPTY_ROW)).toBeNull();
  });
});

describe('when no account holds a deck permission', () => {
  it('says so, with no error anywhere on the page', async () => {
    api.listAdminPermissionHolders.mockResolvedValue(ok<AdminPermissionHolder[]>([]));

    mount();

    expect(await screen.findByText(EMPTY_ROW)).not.toBeNull();
    expect(screen.queryByText('0 account(s)')).not.toBeNull();
    expect(screen.queryByText('Failed to load deck permissions')).toBeNull();
  });
});

describe('searching the account list', () => {
  it('hides the rows that do not match, and counts what is left', async () => {
    api.listAdminPermissionHolders.mockResolvedValue(ok([alice(), bob()]));

    mount();
    expect(await screen.findByText('2 account(s)')).not.toBeNull();
    expect(screen.queryByText(BOB_SUB)).not.toBeNull();

    await userEvent.type(screen.getByPlaceholderText(/Search accounts/), 'a11ce');

    await waitFor(() => expect(screen.queryByText(BOB_SUB)).toBeNull());
    expect(screen.queryByText(ALICE_SUB)).not.toBeNull();
    expect(screen.queryByText('1 account(s)')).not.toBeNull();
  });
});
