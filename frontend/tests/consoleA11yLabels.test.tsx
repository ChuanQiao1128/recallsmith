// @vitest-environment jsdom
//
// A screen reader has to be able to name every control this wave touched: the
// new-deck fields, the deck-type radio group, the new-user fields, the deck
// search box, and the Decks / Publish Jobs switcher. getByLabelText and
// getByRole with a name throw when the association is missing, so these cases
// are the association, not a description of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { NewDeckPage } from '../src/pages/NewDeckPage';
import { DeckFilterBar } from '../src/features/deckList/components/DeckFilterBar';
import { DeckConsoleHeader } from '../src/features/deckList/components/DeckConsoleHeader';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { ok } from './support/apiResult';
import { alice, decks, unstubbed } from './support/adminFixtures';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';

const admin = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  listAdminDecks: vi.fn(),
  createAdminUser: vi.fn(),
  saveAdminDeckPermissionsBulk: vi.fn(),
  runMigrate: vi.fn(),
}));

vi.mock('../src/api/admin', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/admin')>();
  return { ...actual, ...admin };
});

const { AdminUsersPage } = await import('../src/pages/AdminUsersPage');

const noop = () => {};

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  admin.listAdminUsers.mockResolvedValue(ok([alice()]));
  admin.listAdminDecks.mockResolvedValue(ok(decks()));
  admin.createAdminUser.mockImplementation(unstubbed('createAdminUser'));
  admin.saveAdminDeckPermissionsBulk.mockImplementation(unstubbed('saveAdminDeckPermissionsBulk'));
  admin.runMigrate.mockImplementation(unstubbed('runMigrate'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('NewDeckPage controls carry names', () => {
  it('reaches every NewDeckPage text field by its label', () => {
    renderAt(<NewDeckPage />, ['/decks/new']);

    expect(screen.getByLabelText(/^Title/)).not.toBeNull();
    expect(screen.getByLabelText(/^Slug/)).not.toBeNull();
    expect(screen.getByLabelText(/^Author/)).not.toBeNull();
    expect(screen.getByLabelText(/^Description/)).not.toBeNull();
    // The version input keeps its aria-label and also gains an associated label.
    expect(screen.getByLabelText('Draft Version').id).toBe('new-deck-version');
  });

  it('groups the deck type radios under an accessible name', () => {
    renderAt(<NewDeckPage />, ['/decks/new']);

    const group = screen.getByRole('radiogroup', { name: 'Deck Type' });
    expect(group).not.toBeNull();
    expect(group.querySelectorAll('input[type="radio"]').length).toBe(2);
  });
});

describe('AdminUsersPage new-user form', () => {
  it('reaches the AdminUsersPage new-user fields by their labels', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <ConfirmDialogProvider>
          <AdminUsersPage />
        </ConfirmDialogProvider>
      </MemoryRouter>,
    );
    await screen.findByText('1 user(s)');

    expect(screen.getByLabelText('Username')).not.toBeNull();
    expect(screen.getByLabelText('Email')).not.toBeNull();
    expect(screen.getByLabelText('Temp password')).not.toBeNull();
  });
});

describe('deck list controls', () => {
  it('gives the deck search box an accessible name', () => {
    render(
      <DeckFilterBar
        q=""
        onSearchChange={noop}
        statusFilter="all"
        onStatusChange={noop}
        typeFilter="all"
        onTypeChange={noop}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Search decks' })).not.toBeNull();
  });

  it('marks the Decks and Publish Jobs switcher as tabs with the active one selected', () => {
    const { rerender } = render(
      <DeckConsoleHeader
        activeTab="decks"
        onSelectTab={noop}
        superAdmin={true}
        publishJobs={[]}
        onRefreshDecks={noop}
        onRefreshJobs={noop}
        onNewDeck={noop}
      />,
    );

    expect(screen.getByRole('tablist')).not.toBeNull();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);
    expect(screen.getByRole('tab', { name: 'Decks' }).getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByRole('tab', { name: /Publish Jobs/ }).getAttribute('aria-selected'),
    ).toBe('false');

    // aria-selected follows the active tab.
    rerender(
      <DeckConsoleHeader
        activeTab="publishJobs"
        onSelectTab={noop}
        superAdmin={true}
        publishJobs={[]}
        onRefreshDecks={noop}
        onRefreshJobs={noop}
        onNewDeck={noop}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Decks' }).getAttribute('aria-selected')).toBe('false');
    expect(
      screen.getByRole('tab', { name: /Publish Jobs/ }).getAttribute('aria-selected'),
    ).toBe('true');
  });
});
