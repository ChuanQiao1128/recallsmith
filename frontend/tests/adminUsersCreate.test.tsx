// @vitest-environment jsdom
//
// The console mints accounts. What it must never mint is another super_admin.
//
// The group list this form sends is a hard-coded `['editor']` sitting under a
// comment that invites the next reader to change it ("If your backend still
// expects editor_en/editor_zh, change this to..."). One word in that array is
// the difference between an editor and someone who can drop the database, and
// nothing else in the repository looks at it. That is what the second case
// below is for; the rest of the file is about the two ways a create form
// normally wastes an operator's time.
//
// The validation cases assert a *zero-call*, not a message. A page that showed
// "Username is required." and posted anyway would satisfy a message-only
// assertion, and the account would exist.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { AdminUser } from '../src/api/admin';
import { ok, refused } from './support/apiResult';
import { alice, decks, unstubbed } from './support/adminFixtures';
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

const CREATE_BUTTON = 'Create editor';
const NO_SELECTION = 'Select a user from the table to manage permissions.';

/** The user the happy path creates. Not in adminFixtures: only this file has one. */
function carol(): AdminUser {
  return {
    username: 'carol_editor',
    sub: 'carol-sub-0002',
    email: 'carol@example.invalid',
    enabled: true,
    status: 'FORCE_CHANGE_PASSWORD',
    groups: ['editor'],
    deckPermissions: [],
  };
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <ConfirmDialogProvider>
        <AdminUsersPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText('1 user(s)');
}

/** Fill the three inputs by the placeholder text the operator actually sees. */
async function fillForm(username: string, email: string, tempPassword: string): Promise<void> {
  if (username) await userEvent.type(screen.getByPlaceholderText('alice_editor'), username);
  if (email) await userEvent.type(screen.getByPlaceholderText('alice@example.com'), email);
  if (tempPassword) await userEvent.type(screen.getByPlaceholderText('min 8 chars'), tempPassword);
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.listAdminUsers.mockResolvedValue(ok([alice()]));
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

describe('an incomplete form does not reach the server', () => {
  it('refuses an empty username', async () => {
    await mountConsole();
    await fillForm('', 'carol@example.invalid', 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: CREATE_BUTTON }));

    expect(await screen.findByText('Username is required.')).not.toBeNull();
    expect(api.createAdminUser).not.toHaveBeenCalled();
  });

  it('refuses an address with no @ in it', async () => {
    await mountConsole();
    await fillForm('carol_editor', 'carol.example.invalid', 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: CREATE_BUTTON }));

    expect(await screen.findByText('Valid email is required.')).not.toBeNull();
    expect(api.createAdminUser).not.toHaveBeenCalled();
  });

  it('refuses a seven-character temporary password', async () => {
    // Seven, not four: the interesting boundary is the one next to the limit.
    await mountConsole();
    await fillForm('carol_editor', 'carol@example.invalid', 'sup3rse');
    await userEvent.click(screen.getByRole('button', { name: CREATE_BUTTON }));

    expect(await screen.findByText('Temp password must be >= 8 chars.')).not.toBeNull();
    expect(api.createAdminUser).not.toHaveBeenCalled();
  });
});

describe('what a completed form sends', () => {
  it('creates an editor — never a super_admin — and trims what was typed', async () => {
    api.createAdminUser.mockResolvedValue(ok(carol()));

    await mountConsole();
    // Leading and trailing spaces on both text fields. The password is passed
    // through untouched on purpose: trimming a secret silently changes it.
    await fillForm('  carol_editor  ', '  carol@example.invalid  ', 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: CREATE_BUTTON }));

    await waitFor(() =>
      expect(api.createAdminUser).toHaveBeenCalledWith({
        username: 'carol_editor',
        email: 'carol@example.invalid',
        tempPassword: 'sup3rsecret',
        groups: ['editor'],
      }),
    );
  });
});

describe('when the create fails', () => {
  it('says why and leaves the form exactly as it was', async () => {
    api.createAdminUser.mockResolvedValue(
      refused<AdminUser>('USERNAME_EXISTS', 'An account with that username already exists.'),
    );

    await mountConsole();
    await fillForm('carol_editor', 'carol@example.invalid', 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: CREATE_BUTTON }));

    expect(
      await screen.findByText('An account with that username already exists.'),
    ).not.toBeNull();
    expect(screen.queryByText('Success')).toBeNull();

    // Retyping three fields because the server said no is the kind of small
    // insult that makes people paste passwords into a text editor first.
    expect(screen.queryByDisplayValue('carol_editor')).not.toBeNull();
    expect(screen.queryByDisplayValue('carol@example.invalid')).not.toBeNull();
    expect(screen.queryByDisplayValue('sup3rsecret')).not.toBeNull();
  });
});

describe('when the create succeeds', () => {
  it('confirms, clears the form, re-reads the list and opens the new user', async () => {
    api.createAdminUser.mockResolvedValue(ok(carol()));
    // The refresh after a create is a second call, and it is the one that has
    // to see the new account.
    api.listAdminUsers
      .mockResolvedValueOnce(ok([alice()]))
      .mockResolvedValue(ok([alice(), carol()]));

    await mountConsole();
    await fillForm('carol_editor', 'carol@example.invalid', 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: CREATE_BUTTON }));

    expect(await screen.findByText('Created editor: carol_editor.')).not.toBeNull();
    await waitFor(() => expect(api.listAdminUsers).toHaveBeenCalledTimes(2));

    expect(screen.queryByDisplayValue('carol_editor')).toBeNull();
    expect(screen.queryByDisplayValue('carol@example.invalid')).toBeNull();
    expect(screen.queryByDisplayValue('sup3rsecret')).toBeNull();

    // Assigning decks is the next thing anyone does after creating an editor,
    // so the permission panel opens on her rather than on nobody. Twice on the
    // page: once in the table row, once in the panel header.
    await waitFor(() => expect(screen.queryByText(NO_SELECTION)).toBeNull());
    expect(screen.getAllByText('carol@example.invalid')).toHaveLength(2);
  });
});
