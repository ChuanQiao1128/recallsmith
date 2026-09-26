// @vitest-environment jsdom
//
// What the screen is allowed to claim about a database migration.
//
// tests/adminUsersConfirm.test.tsx covers that the migrate button runs straight
// away with no dialog. This file starts once `runMigrate` is called — the
// in-flight lock, the two landings, and the one sentence the page prints after.
//
// (The "Reset & migrate" button and the `reset` flag it carried are gone as of
// F22/CBE-23: the server ignored the flag, so the success line no longer varies
// on it. The page now prints a single, unconditional "Migration completed.")
//
// Deliberately NOT tested: the `if (dbState.running) return` on the first line
// of runMigrateClick. The button carries `disabled={dbState.running}`, and a
// disabled <button> does not dispatch click at all, so no user gesture can
// reach that line. A case for it would pass no matter what the line said, which
// is the definition of a test with no teeth. What protects the user there is
// the `disabled` attribute, and that is what the first case below asserts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { ApiResult } from '../src/types/api';
import { deferred, ok, refused } from './support/apiResult';
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

type MigrateResult = ApiResult<{ dryRun?: boolean; appliedCount?: number; latestAvailable?: number }>;

const PLAIN_BUTTON = 'Run migrations';

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

/**
 * The migrate button in the danger zone.
 *
 * Found through the <details> element rather than by name so the query does not
 * have to track the label flipping to "Running migrations..." while a migration
 * is in flight.
 */
function dangerZoneButtons(): HTMLElement[] {
  const zone = document.querySelector('details');
  if (!zone) throw new Error('danger zone not on the page');
  return within(zone).getAllByRole('button');
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

describe('while a migration is in flight', () => {
  it('locks the migrate button, and unlocks it when it lands', async () => {
    const pending = deferred<MigrateResult>();
    api.runMigrate.mockReturnValue(pending.promise);

    await mountConsole();
    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    const inFlight = dangerZoneButtons();
    expect(inFlight).toHaveLength(1);
    for (const button of inFlight) expect(button.hasAttribute('disabled')).toBe(true);

    pending.resolve(ok({ appliedCount: 0 }));

    await waitFor(() => {
      for (const button of dangerZoneButtons()) {
        expect(button.hasAttribute('disabled')).toBe(false);
      }
    });
    expect(screen.queryByRole('button', { name: PLAIN_BUTTON })).not.toBeNull();
  });
});

describe('when the migration fails', () => {
  it('shows the server reason, claims no success, and does not re-read anything', async () => {
    api.runMigrate.mockResolvedValue(
      refused<{ dryRun?: boolean; appliedCount?: number; latestAvailable?: number }>('DB_LOCKED', 'advisory lock is held'),
    );

    await mountConsole();
    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    expect(await screen.findByText('advisory lock is held')).not.toBeNull();
    expect(screen.queryByText('Migration completed')).toBeNull();
    for (const button of dangerZoneButtons()) {
      expect(button.hasAttribute('disabled')).toBe(false);
    }

    // Still the one call from mounting. Refreshing after a failed migration
    // would repaint the tables and make the failure look survivable.
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1);
  });
});

describe('when the migration succeeds', () => {
  it('re-reads users and decks, because they may be different rows now', async () => {
    api.runMigrate.mockResolvedValue(ok({ appliedCount: 3 }));

    await mountConsole();
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1);
    expect(api.listAdminDecks).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    expect(await screen.findByText('Migration completed.')).not.toBeNull();
    // The screen must not keep showing rows from before the schema changed
    // under it.
    await waitFor(() => {
      expect(api.listAdminUsers).toHaveBeenCalledTimes(2);
      expect(api.listAdminDecks).toHaveBeenCalledTimes(2);
    });
  });

  it('says only that the migration completed, with no reset suffix', async () => {
    api.runMigrate.mockResolvedValue(ok({ appliedCount: 0 }));

    await mountConsole();
    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    expect(await screen.findByText('Migration completed.')).not.toBeNull();
    expect(screen.queryByText('Migration completed (reset + migrate).')).toBeNull();
    expect(api.runMigrate).toHaveBeenCalledWith();
  });
});
