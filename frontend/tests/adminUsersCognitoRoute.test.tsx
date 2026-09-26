// @vitest-environment jsdom
//
// The Admin Users page talks to edge-public at /api/v1/admin/cognito/users, not
// to core-vpc's old /api/v1/admin/users (which answered 501 for GET and 404 for
// POST). The live edge-public is Node and its response shape cannot be confirmed
// offline, so src/api/admin.ts normalises three shapes — the documented
// AdminUser, a { users | items } wrapper, and the raw Cognito UserType — and
// surfaces anything else as an explicit "unexpected response" rather than a
// silently empty table.
//
// This file mocks src/api/http (the same seam adminConsoleRequests.test.tsx
// uses) so it can pin the URLs and shapes that leave the browser, below every
// src/api/admin mock the other page tests rely on.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { ApiResult } from '../src/types/api';
import { ok } from './support/apiResult';
import { alice, decks } from './support/adminFixtures';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const { AdminUsersPage } = await import('../src/pages/AdminUsersPage');

const COGNITO_USERS = '/api/v1/admin/cognito/users';
const MIGRATE_PLAIN = '/api/v1/admin/db/migrate';

// The GET /api/v1/admin/cognito/users body each case wants back. Reset in
// beforeEach to the documented AdminUser shape; the wrapper/raw/garbage cases
// reassign it before mounting.
let usersResponse: ApiResult<unknown>;

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
  usersResponse = ok([alice()]);

  httpMock.get.mockImplementation((url: string) => {
    if (url === COGNITO_USERS) return Promise.resolve({ data: usersResponse });
    if (url === '/api/v1/admin/permissions') return Promise.resolve({ data: ok([]) });
    if (url === '/api/v1/authoring/decks') return Promise.resolve({ data: ok(decks()) });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  httpMock.post.mockImplementation((url: string) => {
    if (url === MIGRATE_PLAIN) return Promise.resolve({ data: ok({ appliedCount: 0 }) });
    if (url === COGNITO_USERS) {
      return Promise.resolve({
        data: ok({ username: 'new_editor', email: 'new@example.invalid', groups: ['editor'] }),
      });
    }
    throw new Error(`Unexpected POST ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the admin users route', () => {
  it('lists users from /api/v1/admin/cognito/users', async () => {
    usersResponse = ok([alice()]);

    mount();

    expect(await screen.findByText('alice_editor')).not.toBeNull();
    expect(httpMock.get).toHaveBeenCalledWith(COGNITO_USERS);
    // The dead core-vpc route must never be touched.
    expect(httpMock.get).not.toHaveBeenCalledWith('/api/v1/admin/users');
  });

  it('accepts a users list wrapped as { users: [...] }', async () => {
    usersResponse = ok({ users: [alice()] });

    mount();

    expect(await screen.findByText('alice_editor')).not.toBeNull();
  });

  it('reads the raw Cognito user shape (Username, Attributes, Enabled, UserStatus)', async () => {
    usersResponse = ok([
      {
        Username: 'raw_editor',
        Attributes: [
          { Name: 'sub', Value: 'raw-sub-1' },
          { Name: 'email', Value: 'raw@example.invalid' },
        ],
        Enabled: true,
        UserStatus: 'CONFIRMED',
      },
    ]);

    mount();

    expect(await screen.findByText('raw_editor')).not.toBeNull();
    expect(screen.getByText('raw@example.invalid')).not.toBeNull();
    expect(screen.getByText('CONFIRMED')).not.toBeNull();
  });

  it('says the response was unexpected instead of showing an empty list', async () => {
    usersResponse = ok({ nope: true });

    mount();

    expect(
      await screen.findByText('Unexpected response from /api/v1/admin/cognito/users.'),
    ).not.toBeNull();
    expect(screen.queryByText('No users returned.')).toBeNull();
  });

  it('creates an editor with POST /api/v1/admin/cognito/users', async () => {
    mount();
    await screen.findByText('1 user(s)');

    await userEvent.type(screen.getByPlaceholderText('alice_editor'), 'ed');
    await userEvent.type(screen.getByPlaceholderText('alice@example.com'), 'ed@example.invalid');
    await userEvent.type(screen.getByPlaceholderText('min 8 chars'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create editor' }));

    await waitFor(() => expect(httpMock.post).toHaveBeenCalledWith(COGNITO_USERS, {
      username: 'ed',
      email: 'ed@example.invalid',
      tempPassword: 'password123',
      groups: ['editor'],
    }));
  });

  it('offers no reset button and never sends reset=1', async () => {
    mount();
    await screen.findByText('1 user(s)');

    expect(screen.queryByRole('button', { name: /Reset & migrate/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Run migrations' }));

    await waitFor(() => expect(httpMock.post).toHaveBeenCalledTimes(1));
    const [url] = httpMock.post.mock.calls[0] as [string];
    expect(url).toBe(MIGRATE_PLAIN);
    expect(url).not.toContain('reset=1');
  });

  it('runs migrations with the plain migrate URL', async () => {
    mount();
    await screen.findByText('1 user(s)');

    await userEvent.click(screen.getByRole('button', { name: 'Run migrations' }));

    await waitFor(() => expect(httpMock.post).toHaveBeenCalledTimes(1));
    expect(httpMock.post).toHaveBeenCalledWith(MIGRATE_PLAIN, {});
  });
});
