// @vitest-environment jsdom
//
// The migrate button runs straight away — no dialog, no typing.
//
// There used to be a second, red "Reset & migrate (DEV only)" button behind a
// typed-phrase confirmation. It is gone (F22/CBE-23): the server ignored the
// reset flag and ran an ordinary migrate, so the friction guarded nothing and
// only taught the operator to distrust confirmations. What remains is a single
// additive migrate, and this file pins that it does not sprout a gate: pressing
// "Run migrations" opens no dialog and calls straight through.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

const PLAIN_BUTTON = 'Run migrations';

async function mountAdmin(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <ConfirmDialogProvider>
        <AdminUsersPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  // The danger zone lives inside a <details>, which renders its contents
  // regardless of open state, so the button is queryable without expanding.
  await screen.findByRole('button', { name: PLAIN_BUTTON }, { timeout: 2000 });
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.listAdminUsers.mockResolvedValue(ok([]));
  api.listAdminDecks.mockResolvedValue(ok([]));
  api.runMigrate.mockResolvedValue(ok({ appliedCount: 0 }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the migration is left alone', () => {
  it('runs straight away, with no dialog and no typing', async () => {
    // "Run migrations" is safe for production and additive; making the user
    // confirm it would spend attention on a request that only ever adds.
    await mountAdmin();
    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.runMigrate).toHaveBeenCalledWith());
  });
});
