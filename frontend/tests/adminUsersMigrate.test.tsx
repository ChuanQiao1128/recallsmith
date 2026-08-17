// @vitest-environment jsdom
//
// What the screen is allowed to claim about a database migration.
//
// tests/adminUsersConfirm.test.tsx already covers the gate in front of the
// destructive button: the dialog, the typed phrase, and cancelling. It stops
// the moment `runMigrate` is called. This file starts there — the flight, the
// two landings, and the one sentence the page prints afterwards.
//
// The sentence is the case worth reading twice. `runMigrateClick(true)` asks
// for a reset; the response says whether one happened. Those are different
// facts, and the success line is built from the response (`resp.data?.reset`)
// rather than from the request. An operator who is told "reset + migrate" has
// been told their data is gone; being told that because the console *asked*,
// while the server declined, sends them to restore a backup they did not need
// — or worse, teaches them that the phrase means nothing.
//
// Deliberately NOT tested: the `if (dbState.running) return` on the first line
// of runMigrateClick. Both buttons carry `disabled={dbState.running}`, and a
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

type MigrateResult = ApiResult<{ migrated: boolean; reset: boolean }>;

const RESET_BUTTON = 'Reset & migrate (DEV only)';
const PLAIN_BUTTON = 'Run migrate (no reset)';
const RESET_CONFIRM = 'Reset & migrate';

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
 * Every button in the danger zone.
 *
 * Found through the <details> element rather than by name, because the names
 * change while a migration is in flight — and one of them changes wrongly. Both
 * labels are driven by the same `dbState.running` flag, so a plain migrate
 * makes the *reset* button announce "Running (reset)..." while nothing is being
 * reset. That is recorded, not asserted: pinning the current strings here would
 * make the test go red when someone fixes it, and the claim this case is making
 * is about reachability, not wording.
 */
function dangerZoneButtons(): HTMLElement[] {
  const zone = document.querySelector('details');
  if (!zone) throw new Error('danger zone not on the page');
  return within(zone).getAllByRole('button');
}

/** Walk the whole reset gate: press, type the phrase, confirm. */
async function confirmReset(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: RESET_BUTTON }));
  const dialog = within(screen.getByRole('alertdialog'));
  await userEvent.type(dialog.getByRole('textbox'), 'RESET');
  await userEvent.click(dialog.getByRole('button', { name: RESET_CONFIRM }));
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
  it('locks both migrate buttons, and unlocks them when it lands', async () => {
    const pending = deferred<MigrateResult>();
    api.runMigrate.mockReturnValue(pending.promise);

    await mountConsole();
    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    const inFlight = dangerZoneButtons();
    expect(inFlight).toHaveLength(2);
    for (const button of inFlight) expect(button.hasAttribute('disabled')).toBe(true);

    pending.resolve(ok({ migrated: true, reset: false }));

    await waitFor(() => {
      for (const button of dangerZoneButtons()) {
        expect(button.hasAttribute('disabled')).toBe(false);
      }
    });
    expect(screen.queryByRole('button', { name: PLAIN_BUTTON })).not.toBeNull();
    expect(screen.queryByRole('button', { name: RESET_BUTTON })).not.toBeNull();
  });
});

describe('when the migration fails', () => {
  it('shows the server reason, claims no success, and does not re-read anything', async () => {
    api.runMigrate.mockResolvedValue(
      refused<{ migrated: boolean; reset: boolean }>('DB_LOCKED', 'advisory lock is held'),
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
    api.runMigrate.mockResolvedValue(ok({ migrated: true, reset: false }));

    await mountConsole();
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1);
    expect(api.listAdminDecks).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    expect(await screen.findByText('Migration completed.')).not.toBeNull();
    // The screen must not keep showing rows from before the schema changed
    // under it. After a reset there may be none.
    await waitFor(() => {
      expect(api.listAdminUsers).toHaveBeenCalledTimes(2);
      expect(api.listAdminDecks).toHaveBeenCalledTimes(2);
    });
  });
});

describe('the sentence printed after a reset was requested', () => {
  it('does not say a reset happened when the server says it did not', async () => {
    api.runMigrate.mockResolvedValue(ok({ migrated: true, reset: false }));

    await mountConsole();
    await confirmReset();

    expect(await screen.findByText('Migration completed.')).not.toBeNull();
    expect(screen.queryByText('Migration completed (reset + migrate).')).toBeNull();
    expect(api.runMigrate).toHaveBeenCalledWith(true);
  });

  it('says a reset happened when the server says it did', async () => {
    api.runMigrate.mockResolvedValue(ok({ migrated: true, reset: true }));

    await mountConsole();
    await confirmReset();

    expect(await screen.findByText('Migration completed (reset + migrate).')).not.toBeNull();
    expect(screen.queryByText('Migration completed.')).toBeNull();
  });
});
