// @vitest-environment jsdom
//
// What actually leaves the browser when the console's two most destructive
// buttons are pressed.
//
// Every other AdminUsersPage file mocks src/api/admin, which is the right seam
// for "what does the operator see" but stops one call short of the thing that
// matters here. `runMigrate(true)` and `runMigrate(false)` differ by a boolean
// at that seam; they differ by `?reset=1` on the wire, and the translation
// happens in src/api/admin.ts, below every one of those mocks. A page test can
// prove the console handed `true` down. It cannot prove `true` still means
// "drop the tables" by the time the request is built, or that `false` does not.
//
// The two mutations that justify this file, both measured rather than imagined:
//
//   const qs = reset ? '?reset=1' : ''   ->   const qs = ''
//     the reset case here goes red; adminUsersConfirm's seven cases and all of
//     adminUsersMigrate stay green. The typed-confirmation gate, the dialog, the
//     phrase — all still working, all now guarding a request that resets
//     nothing.
//
//   const qs = reset ? '?reset=1' : ''   ->   const qs = '?reset=1'
//     the plain case here goes red; the same twelve cases stay green. The button
//     the page's own hint calls "safe for prod" starts DROPping production.
//
// Mock depth, and why it is a safety property rather than a preference:
// .env.local and the committed .env.development both set VITE_API_BASE to a real
// https origin, src/api/http.ts builds an axios instance from it, and jsdom's
// XHR will happily send. What stops `POST /api/v1/admin/db/migrate?reset=1` from
// reaching a live deployment today is a 401, not a decision. So this file
// replaces src/api/http entirely. src/api/admin.ts imports exactly three things
// — ../types/api (types only), ./http, and axios (for isAxiosError) — which
// makes http its only way out; with the module mocked, an outbound request is
// not merely unlikely, it has nowhere to go. The first case below checks that
// premise instead of trusting it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ok } from './support/apiResult';
import { ALICE_SUB, alice, decks } from './support/adminFixtures';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

// Imported after the mock is registered, and imported at all so the premise
// above can be asserted rather than asserted-by-comment.
const { http } = await import('../src/api/http');
const { AdminUsersPage } = await import('../src/pages/AdminUsersPage');

// Resolved with node:path rather than the `new URL(..., import.meta.url)` idiom
// the node-environment test files use. Vite rewrites that idiom as an asset
// reference, and under jsdom the rewritten form resolves against the document's
// http://localhost base — it yields "http://localhost:3000/src/api/admin.ts",
// and fileURLToPath then rejects it for not being a file: URL. Measured, after
// this file failed to collect at all.
const ADMIN_API_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '../src/api/admin.ts');

const MIGRATE_PLAIN = '/api/v1/admin/db/migrate';
const MIGRATE_RESET = '/api/v1/admin/db/migrate?reset=1';
const PERMISSIONS_BULK = '/api/v1/admin/permissions/bulk';

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

async function openResetDialog(): Promise<ReturnType<typeof within>> {
  await userEvent.click(screen.getByRole('button', { name: RESET_BUTTON }));
  return within(screen.getByRole('alertdialog'));
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();

  httpMock.get.mockImplementation((url: string) => {
    if (url === '/api/v1/admin/users') return Promise.resolve({ data: ok([alice()]) });
    if (url === '/api/v1/admin/permissions') {
      return Promise.resolve({
        data: ok([
          {
            adminSub: ALICE_SUB,
            deckId: 1,
            deckSlug: 'd-one',
            deckTitle: 'Deck One',
            locale: 'en',
            canRead: true,
            canWrite: true,
          },
        ]),
      });
    }
    if (url === '/api/v1/authoring/decks') return Promise.resolve({ data: ok(decks()) });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  // No default success. A POST this file did not arrange for is a POST it does
  // not know about, and the page surfaces the message where a case can see it.
  httpMock.post.mockImplementation((url: string) => {
    throw new Error(`Unexpected POST ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the seam this file relies on', () => {
  it('is the module the api layer imports, replaced by a mock', () => {
    expect(vi.isMockFunction(http.post)).toBe(true);
    expect(vi.isMockFunction(http.get)).toBe(true);
  });

  it('is the only way src/api/admin.ts can reach the network', () => {
    // If a future edit reaches for http.put or http.delete, the spies above stop
    // being a complete seal and this goes red rather than letting a real request
    // out of a test run.
    const methods = [...readFileSync(ADMIN_API_SOURCE, 'utf8').matchAll(/\bhttp\.([a-z]+)/g)].map(
      match => match[1],
    );
    expect(methods.length).toBeGreaterThan(0);
    expect([...new Set(methods)].sort()).toEqual(['get', 'post']);
  });
});

describe('the reset button', () => {
  it('sends exactly one request, and it is the one that carries reset=1', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ migrated: true, reset: true }) });

    await mountConsole();
    const dialog = await openResetDialog();
    await userEvent.type(dialog.getByRole('textbox'), 'RESET');
    await userEvent.click(dialog.getByRole('button', { name: RESET_CONFIRM }));

    await waitFor(() => expect(httpMock.post).toHaveBeenCalledTimes(1));
    expect(httpMock.post).toHaveBeenCalledWith(MIGRATE_RESET, {});
  });
});

describe('the button the page calls safe for prod', () => {
  it('sends the migrate URL with nothing appended to it', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ migrated: true, reset: false }) });

    await mountConsole();
    await userEvent.click(screen.getByRole('button', { name: PLAIN_BUTTON }));

    await waitFor(() => expect(httpMock.post).toHaveBeenCalledTimes(1));
    // The whole string, not `not.toContain('reset')`: a negative match passes
    // for '/api/v1/admin/db/migrat' too, and for any other endpoint entirely.
    expect(httpMock.post).toHaveBeenCalledWith(MIGRATE_PLAIN, {});
  });
});

describe('cancelling the reset dialog', () => {
  it('puts nothing on the wire at all', async () => {
    await mountConsole();
    const dialog = await openResetDialog();
    await userEvent.type(dialog.getByRole('textbox'), 'RESET');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // Stronger than "runMigrate was not called": nothing was built, nothing was
    // sent, and no server had to decide whether to honour it.
    expect(httpMock.post).not.toHaveBeenCalled();
  });
});

describe('taking every deck permission away', () => {
  it('sends a replace with an empty list, keyed on the user sub', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ saved: 0, replace: true }) });

    await mountConsole();
    const row = screen.getByText('alice_editor').closest('tr');
    if (!row) throw new Error('no table row for alice_editor');
    await userEvent.click(within(row).getByRole('button', { name: 'Manage' }));

    await userEvent.click(screen.getByRole('checkbox', { name: 'Read permission for d-one' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));

    await waitFor(() => expect(httpMock.post).toHaveBeenCalledTimes(1));
    // The body, in full. An empty `permissions` under `replace` is the request
    // that revokes everything; the same array under `merge`, or a request that
    // was never sent, leaves the grants exactly where they were while the page
    // says "Saved".
    expect(httpMock.post).toHaveBeenCalledWith(PERMISSIONS_BULK, {
      adminSub: ALICE_SUB,
      mode: 'replace',
      permissions: [],
    });
  });
});
