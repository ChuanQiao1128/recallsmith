// @vitest-environment jsdom
//
// Who can reach the button that drops the database.
//
// AdminUsersPage's guard is a render-time early return: a session without
// super_admin gets an "Access denied" callout and a way back, and never gets the
// danger zone, the create form, or a single permission checkbox. That is the
// whole claim this file makes, and it is narrower than "the page is gated" on
// purpose — the load effect runs on *both* branches of the guard, so an editor's
// visit still issues both admin requests. Asserting "no request was made" would
// go red, and would go red correctly. What a non-admin can *reach* is the part
// that protects anyone.
//
// The super_admin case at the bottom is not decoration. Without it, a change
// that rendered this page as an empty <div> would satisfy every "is not on the
// screen" assertion above it, and the file would keep passing while the console
// had stopped existing.
//
// Deliberately not asserted here: where signing out goes. That branch turns on
// AUTH_CONFIGURED, which reads .env.local — present on a developer's machine,
// gitignored and therefore absent in CI, while .env.development is not loaded
// under mode=test. A case asserting the destination would reach two different
// verdicts on two machines, which is worse than no case at all.
//
// (On a machine that has .env.local, the sign-out case prints one line of jsdom
// noise — "Not implemented: navigation to another Document" — because the real
// logout URL reaches window.location.assign. It is a virtual-console notice
// rather than a failure, and silencing it would mean replacing a location
// object jsdom deliberately makes non-configurable.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ok } from './support/apiResult';
import { alice, bob, decks, unstubbed } from './support/adminFixtures';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { locationText, renderAt } from './support/routerProbe';
import { getTokens } from '../src/auth/tokenStore';
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

const PLAIN_BUTTON = 'Run migrations';
const CREATE_BUTTON = 'Create editor';

/**
 * Mount the page and let the load effect settle.
 *
 * The `act` flush is doing real work on the denied branch: the effect resolves
 * and calls setState even though the guard returns before any of that state is
 * rendered, and without the flush React reports an update outside act(). It is
 * a flush, not a claim — see the file header.
 */
async function mountConsole(): Promise<void> {
  renderAt(
    <ConfirmDialogProvider>
      <AdminUsersPage />
    </ConfirmDialogProvider>,
    ['/admin/users'],
  );

  await waitFor(() => {
    expect(api.listAdminUsers).toHaveBeenCalled();
    expect(api.listAdminDecks).toHaveBeenCalled();
  });
  await act(async () => {});
}

beforeEach(() => {
  signOut();
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

describe('an editor who reaches the admin console', () => {
  it('is told no, and is shown none of the controls that change other people', async () => {
    signInAsEditor();
    await mountConsole();

    expect(screen.queryByText('Access denied')).not.toBeNull();

    // The migrate button first, because it is the one that touches the database.
    // Then the account factory, then the door to the permission editor.
    expect(screen.queryByRole('button', { name: PLAIN_BUTTON })).toBeNull();
    expect(screen.queryByRole('button', { name: CREATE_BUTTON })).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Manage' })).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('is given a way back to the decks', async () => {
    signInAsEditor();
    await mountConsole();

    await userEvent.click(screen.getByRole('button', { name: 'Back to Decks' }));

    expect(locationText()).toBe('/');
  });
});

describe('a super_admin on the same page', () => {
  it('gets the controls the editor was refused', async () => {
    // The control group. Every assertion above is an absence, and absences are
    // satisfied by a page that renders nothing at all.
    signInAsSuperAdmin();
    await mountConsole();

    expect(screen.queryByText('Access denied')).toBeNull();

    expect(screen.queryByRole('button', { name: PLAIN_BUTTON })).not.toBeNull();
    expect(screen.queryByRole('button', { name: CREATE_BUTTON })).not.toBeNull();

    // The permission boxes are behind picking a user, so reaching them takes
    // the click an editor never gets to make.
    expect(screen.queryAllByRole('button', { name: 'Manage' })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Manage' })[0]);
    // Three decks, read and write apiece.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(6);
  });
});

describe('signing out', () => {
  it('drops the stored session', async () => {
    signInAsSuperAdmin();
    await mountConsole();
    expect(getTokens()).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    // The token is the whole of the session as far as this client is concerned:
    // every super-admin surface is gated on reading it back. Where the browser
    // is sent next is deliberately not asserted — see the file header.
    expect(getTokens()).toBeNull();
  });
});
