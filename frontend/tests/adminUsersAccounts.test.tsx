// @vitest-environment jsdom
//
// The console no longer makes accounts. It says so, and it still lets an
// operator give an account decks.
//
// edge-public, the Lambda behind the old list/create form, was retired on
// 2026-10-04 (R27 EDGE). Console accounts are now listed, created, disabled and
// deleted by the owner with the aws cognito-idp commands in infra/RUNBOOK.md §13.
// Two things follow, and this file pins both:
//
// 1. The page tells the operator where account management went, and offers no
//    form that looks like it could still create one. A create form with nothing
//    behind it is worse than none: it fails at the moment someone needs it.
// 2. An account that holds no deck permission yet (a new editor) is reached by
//    pasting its Cognito sub. core-vpc stores whatever string it is given, so a
//    malformed sub is refused locally — a grant keyed on a typo is a grant
//    nobody can see or use, and it would never show up as an error.
//
// The validation case asserts a *zero-call*, not only a message: a page that
// showed the error and saved anyway would satisfy a message-only assertion.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ok } from './support/apiResult';
import { ALICE_SUB, alice, decks, unstubbed } from './support/adminFixtures';
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

/** A sub that holds nothing yet: the new editor the owner just created with the CLI. */
const CAROL_SUB = '7d1e9a40-5b3c-4f2e-8a6d-00000000ca01';

const NO_SELECTION = 'Open an account by its sub, or pick one from the table, to manage its permissions.';

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <ConfirmDialogProvider>
        <AdminUsersPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText('1 account(s)');
}

async function openSub(text: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('Cognito sub'), text);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
}

function isChecked(slug: string, kind: 'Read' | 'Write'): boolean {
  return screen.queryByRole('checkbox', { name: `${kind} permission for ${slug}`, checked: true }) !== null;
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.listAdminPermissionHolders.mockResolvedValue(ok([alice()]));
  api.listAdminDecks.mockResolvedValue(ok(decks()));
  api.saveAdminDeckPermissionsBulk.mockImplementation(unstubbed('saveAdminDeckPermissionsBulk'));
  api.runMigrate.mockImplementation(unstubbed('runMigrate'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('where account management went', () => {
  it('says the accounts are managed with the AWS CLI, and where the commands are', async () => {
    await mountConsole();

    expect(screen.queryByText('Console accounts are managed with the AWS CLI')).not.toBeNull();
    expect(screen.queryByText('infra/RUNBOOK.md')).not.toBeNull();
    expect(screen.queryByText('aws cognito-idp')).not.toBeNull();
  });

  it('offers no create form any more', async () => {
    await mountConsole();

    expect(screen.queryByRole('button', { name: 'Create editor' })).toBeNull();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByLabelText('Temp password')).toBeNull();
  });
});

describe('opening an account by its Cognito sub', () => {
  it('refuses something that is not a sub, and saves nothing', async () => {
    await mountConsole();
    await openSub('alice_editor');

    expect(await screen.findByText('Not a Cognito sub')).not.toBeNull();
    // Nothing opened: no draft to save against a key nobody can predict.
    expect(screen.queryByText(NO_SELECTION)).not.toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(api.saveAdminDeckPermissionsBulk).not.toHaveBeenCalled();
  });

  it('opens a new account with nothing ticked, and saves the grant under its sub', async () => {
    api.saveAdminDeckPermissionsBulk.mockResolvedValue(ok({ saved: 1, replace: true }));

    await mountConsole();
    await openSub(CAROL_SUB);

    await waitFor(() => expect(screen.queryByText(NO_SELECTION)).toBeNull());
    expect(screen.queryByText(CAROL_SUB)).not.toBeNull();
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Write permission for d-two' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));

    await waitFor(() =>
      expect(api.saveAdminDeckPermissionsBulk).toHaveBeenCalledWith({
        adminSub: CAROL_SUB,
        mode: 'replace',
        permissions: [{ deckId: 2, canRead: true, canWrite: true }],
      }),
    );
  });

  it('opens an account already in the table on its current grants, whatever the spacing and case', async () => {
    await mountConsole();
    // Pasted from a terminal: surrounding spaces, and upper case from a tool that prints it so.
    await userEvent.type(screen.getByLabelText('Cognito sub'), `  ${ALICE_SUB.toUpperCase()}  {Enter}`);

    await waitFor(() => expect(screen.queryByText(NO_SELECTION)).toBeNull());
    // alice arrives with read+write on d-one; a fresh empty draft would show neither.
    expect(isChecked('d-one', 'Read')).toBe(true);
    expect(isChecked('d-one', 'Write')).toBe(true);
    expect(screen.queryByText('Not a Cognito sub')).toBeNull();
  });
});
