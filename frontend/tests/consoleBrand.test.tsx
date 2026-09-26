// @vitest-environment jsdom
//
// The console has one name, one default deck author, and one honest answer for
// a session that has ended. This file pins all three, plus the per-route tab
// title that lib/brand.ts computes.
//
// The env stub below is the same one tests/loginErrorCopy.test.tsx documents:
// authConfig reads import.meta.env at module scope, and locally a .env.local
// supplies these while CI has nothing, so without the stub AUTH_CONFIGURED (and
// the login page's configuration block) would answer differently on the two
// machines. Stubbed in vi.hoisted so it is in place before authConfig imports.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COGNITO_ENV: Record<string, string> = {
  VITE_COGNITO_DOMAIN: 'https://auth.login-tests.invalid',
  VITE_COGNITO_CLIENT_ID: 'login-tests-client',
  VITE_COGNITO_REDIRECT_URI: 'http://localhost:5173/auth/callback',
  VITE_COGNITO_SCOPES: 'openid email profile',
};

function stubCognitoEnv(): void {
  for (const [key, value] of Object.entries(COGNITO_ENV)) vi.stubEnv(key, value);
}

vi.hoisted(() => {
  // Inlined rather than shared: vi.hoisted runs before the imports above exist.
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://auth.login-tests.invalid');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'login-tests-client');
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', 'http://localhost:5173/auth/callback');
  vi.stubEnv('VITE_COGNITO_SCOPES', 'openid email profile');
});

import App from '../src/App';
import { LoginPage } from '../src/pages/LoginPage';
import { NewDeckPage } from '../src/pages/NewDeckPage';
import { CONSOLE_NAME, documentTitleFor } from '../src/lib/brand';
import { AuthProvider } from '../src/auth/AuthContext';
import { makeTestQueryClient } from './support/queryTestClient';
import { signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const INDEX_HTML = fileURLToPath(new URL('../index.html', import.meta.url));

/** Every .ts/.tsx/.css file under src/, as absolute paths. */
function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSource(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function mountLogin(search: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  signOut();
});

afterEach(() => {
  cleanup();
  // The DEV stub the configuration-visibility case sets must not leak; clearing
  // everything and re-applying the Cognito stubs keeps a configured auth for the
  // next case (AUTH_CONFIG was captured at import, so this is belt-and-braces).
  vi.unstubAllEnvs();
  stubCognitoEnv();
  vi.restoreAllMocks();
});

describe('one console name', () => {
  it('names the console DeveloperCards Console and never RecallSmith in src or index.html', () => {
    expect(CONSOLE_NAME).toBe('DeveloperCards Console');

    const files = walkSource(SRC);
    // Anti-vacuity: a bad glob that found nothing would pass this loop silently.
    expect(files.length).toBeGreaterThan(20);

    const offenders = files.filter(f => readFileSync(f, 'utf8').includes('RecallSmith'));
    expect(offenders).toEqual([]);
    expect(readFileSync(INDEX_HTML, 'utf8')).not.toContain('RecallSmith');
  });

  it('gives every route its own document title', () => {
    expect(documentTitleFor('/login')).toBe('Sign in · DeveloperCards Console');
    expect(documentTitleFor('/auth/callback')).toBe('Signing in · DeveloperCards Console');
    expect(documentTitleFor('/')).toBe('Decks · DeveloperCards Console');
    expect(documentTitleFor('/decks/new')).toBe('New deck · DeveloperCards Console');
    expect(documentTitleFor('/decks/edit')).toBe('Edit deck · DeveloperCards Console');
    expect(documentTitleFor('/decks/preview')).toBe('Deck preview · DeveloperCards Console');
    expect(documentTitleFor('/decks/cards')).toBe('Cards · DeveloperCards Console');
    expect(documentTitleFor('/decks/cards/new')).toBe('New card · DeveloperCards Console');
    expect(documentTitleFor('/decks/cards/edit')).toBe('Edit card · DeveloperCards Console');
    expect(documentTitleFor('/decks/cards/import')).toBe('Import cards · DeveloperCards Console');
    expect(documentTitleFor('/admin/users')).toBe('Users & permissions · DeveloperCards Console');
    expect(documentTitleFor('/content-intelligence')).toBe('Content intelligence · DeveloperCards Console');
    // A trailing slash names the same page.
    expect(documentTitleFor('/decks/new/')).toBe('New deck · DeveloperCards Console');
    // Anything unknown falls back to the console name alone.
    expect(documentTitleFor('/nowhere')).toBe('DeveloperCards Console');
  });

  it('App sets document.title from the current route', async () => {
    render(
      <QueryClientProvider client={makeTestQueryClient()}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/login']}>
            <App />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.title).toBe('Sign in · DeveloperCards Console'));
  });

  it('defaults a new deck author to DeveloperCards', () => {
    renderAt(<NewDeckPage />, ['/decks/new']);
    expect((screen.getByLabelText(/^Author/) as HTMLInputElement).value).toBe('DeveloperCards');
  });
});

describe('honest login copy', () => {
  it('tells a user whose session expired to sign in again instead of reporting a failed sign-in', () => {
    mountLogin('?error=session_expired');

    expect(screen.queryByText('Session ended')).not.toBeNull();
    expect(
      screen.queryByText('Your session expired. Sign in again to pick up where you left off.'),
    ).not.toBeNull();
    expect(screen.queryByText('Sign-in failed')).toBeNull();
  });

  it('treats an unauthorized redirect as an ended session too', () => {
    mountLogin('?error=unauthorized');

    expect(screen.queryByText('Session ended')).not.toBeNull();
    expect(
      screen.queryByText('Your session is no longer valid. Sign in again to continue.'),
    ).not.toBeNull();
    expect(screen.queryByText('Sign-in failed')).toBeNull();
  });

  it('hides the Cognito configuration outside development', () => {
    vi.stubEnv('DEV', false);
    const outside = mountLogin('');
    expect(screen.queryByText(/ClientId:/)).toBeNull();
    outside.unmount();

    // Back in development (the runner's default), the developer aid returns.
    vi.stubEnv('DEV', true);
    mountLogin('');
    expect(screen.queryByText(/ClientId:/)).not.toBeNull();
  });

  it('offers no Back to Home link and names the button Sign in', () => {
    mountLogin('');

    expect(screen.queryByText(/Back to Home/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue with Cognito' })).toBeNull();
  });
});
