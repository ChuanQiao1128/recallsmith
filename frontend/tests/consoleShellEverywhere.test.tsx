// @vitest-environment jsdom
//
// F36. Every authoring page sits inside ConsoleShell, and sign-out is the
// shell's own affair through AuthContext — no page carries a copy of it.
//
// Two of the cases below read source with node:fs rather than the DOM: "renders
// inside ConsoleShell" and "no page carries its own sign-out" are claims about
// every page at once, and a per-page mount would test only the pages someone
// remembered to list. The rest mount the shell (or a page) and assert the
// behaviour the source cannot show: that Sign out actually ends the session, and
// that the shell derives the user pill when a page passes none.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Stubbed before any import that reads import.meta.env at module scope, exactly
// as tests/loginErrorCopy.test.tsx does: authConfig captures these at import and
// AUTH_CONFIGURED must be true here so the context sign-out reaches the hosted
// logout (the jsdom "Not implemented: navigation" notice that produces is
// expected, and is not silenced).
vi.hoisted(() => {
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://auth.login-tests.invalid');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'login-tests-client');
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', 'http://localhost:5173/auth/callback');
  vi.stubEnv('VITE_COGNITO_SCOPES', 'openid email profile');
});

import { ConsoleShell } from '../src/components/console/ConsoleShell';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { getTokens } from '../src/auth/tokenStore';
import { queryClient } from '../src/api/queryClient';
import {
  TEST_ADMIN_EMAIL,
  signInAsEditor,
  signInAsSuperAdmin,
  signOut,
} from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { ok } from './support/apiResult';
import type { Deck } from '../src/types/deck';

const authoring = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...authoring };
});

const { NewCardPage } = await import('../src/pages/NewCardPage');

// vitest runs with cwd = frontend/, so the source tree sits here. (import.meta.url
// is not a file URL under the jsdom environment, so this is read from cwd the way
// tests/consoleBrand.test.tsx does.)
const PAGES_DIR = join(process.cwd(), 'src', 'pages');

/** Every file directly under src/pages/, by basename. */
function pageFiles(): string[] {
  return readdirSync(PAGES_DIR).filter(name => name.endsWith('.tsx'));
}

function readPage(name: string): string {
  return readFileSync(join(PAGES_DIR, name), 'utf8');
}

/** Reads the header pill. ConsoleShell renders exactly one <span> in <header>. */
function userPill(): string {
  return document.querySelector('header span')?.textContent ?? '';
}

function AuthProbe() {
  return <div data-testid="auth-probe">{String(useAuth().isAuthenticated)}</div>;
}

const deck = { id: 7, slug: 'csharp-fundamentals', title: 'C# Fundamentals', version: 3 } as Deck;

beforeEach(() => {
  signOut();
  authoring.fetchDeckById.mockResolvedValue(ok(deck));
  authoring.fetchCardsByDeck.mockResolvedValue(ok([]));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  queryClient.clear();
  signOut();
});

describe('the console shell is everywhere and owns sign-out', () => {
  it('every protected page renders inside ConsoleShell', () => {
    const protectedPages = pageFiles().filter(
      name => name.endsWith('Page.tsx') && name !== 'LoginPage.tsx' && name !== 'AuthCallbackPage.tsx',
    );
    // Anti-vacuity: a wrong directory would find nothing and pass the loop silently.
    expect(protectedPages.length).toBeGreaterThanOrEqual(10);

    for (const name of protectedPages) {
      const source = readPage(name);
      expect(source, `${name} does not render inside ConsoleShell`).toContain('ConsoleShell');
      expect(source, `${name} still builds its own <header>`).not.toContain('<header');
    }
  });

  it('no page carries its own sign-out', () => {
    const pages = pageFiles();
    expect(pages.length).toBeGreaterThanOrEqual(10);

    for (const name of pages) {
      const source = readPage(name);
      expect(source, `${name} still imports buildLogoutUrl`).not.toContain('buildLogoutUrl');
      expect(source, `${name} still clears tokens itself`).not.toContain('clearStoredTokens');
      expect(source, `${name} still defines handleSignOut`).not.toContain('handleSignOut');
    }
  });

  it('Sign out goes through AuthContext and ends the context session', async () => {
    signInAsSuperAdmin();

    render(
      <AuthProvider>
        <MemoryRouter>
          <ConsoleShell title="t">x</ConsoleShell>
          <AuthProbe />
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.getByTestId('auth-probe').textContent).toBe('true');
    expect(getTokens()).not.toBeNull();

    // jsdom prints "Not implemented: navigation" for the logout URL here. That is
    // expected — the real app leaves the page — and is deliberately not silenced.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('false')).not.toBeNull();
    expect(getTokens()).toBeNull();
  });

  it('Sign out still drops the stored session with no AuthProvider above it', () => {
    signInAsSuperAdmin();
    expect(getTokens()).not.toBeNull();

    // No provider on purpose — the way page tests mount pages bare. useSignOut
    // degrades to signOutWithoutProvider, which still clears the tokens.
    render(
      <MemoryRouter>
        <ConsoleShell title="t">x</ConsoleShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(getTokens()).toBeNull();
  });

  it('derives the user label when a page passes none', () => {
    signInAsSuperAdmin();
    render(
      <MemoryRouter>
        <ConsoleShell title="t">x</ConsoleShell>
      </MemoryRouter>,
    );
    expect(userPill()).toBe(`${TEST_ADMIN_EMAIL} · super_admin`);

    cleanup();
    signOut();

    signInAsEditor();
    render(
      <MemoryRouter>
        <ConsoleShell title="t">x</ConsoleShell>
      </MemoryRouter>,
    );
    expect(userPill()).toBe(`${TEST_ADMIN_EMAIL} · editor`);
  });

  it('the new-card page offers Sign out and the console navigation', async () => {
    signInAsSuperAdmin();

    // Mounted the way tests/cardEntryDefects.test.tsx does: a data router (for the
    // page's useBlocker) with the authoring api mocked so the deck loads.
    renderAt(<NewCardPage />, ['/decks/cards/new?deckId=7']);

    // The page's own heading survives inside the shell body.
    expect(await screen.findByRole('heading', { name: 'New Card' })).not.toBeNull();
    // The shell's controls the page never used to have.
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Decks' })).not.toBeNull();
  });
});
