// @vitest-environment jsdom
//
// What the login page is allowed to say, and who gets to choose the words.
//
// The error box on this page is the one piece of UI an attacker can aim text
// at without an account: /login?error=<anything> is a plain link. The old code
// rendered the parameter verbatim, plus error_description after a colon —
// React-escaped, so never XSS, but escaping is beside the point when the
// payload is a sentence. "Your account is locked, call +64..." inside the
// product's own red box reads as the product speaking.
//
// Every stage of the last refactor walked past this line and filed it as a
// copy question. It is an input-handling question: the fix is a closed map
// from known codes to fixed sentences, an unconditional fallback, and a
// description parameter that is never read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { LoginPage } from '../src/pages/LoginPage';
import { AuthProvider } from '../src/auth/AuthContext';
import { signOut } from './support/consoleSession';

const INJECTED = 'Your account is locked, call +64-555-0199 to unlock';

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
  vi.restoreAllMocks();
});

describe('the login error box speaks only its own words', () => {
  it('maps a known code to its fixed sentence', () => {
    mountLogin('?error=missing_code');

    expect(screen.queryByText('Sign-in failed')).not.toBeNull();
    expect(
      screen.queryByText('The sign-in response was incomplete. Please try again.'),
    ).not.toBeNull();
  });

  it('answers an unknown code with the generic sentence, never the code itself', () => {
    mountLogin(`?error=${encodeURIComponent(INJECTED)}`);

    expect(
      screen.queryByText('Something went wrong during sign-in. Please try again.'),
    ).not.toBeNull();
    // The sharp assertion. The injected sentence must not appear anywhere in
    // the document — not in the box, not in an attribute, not partially.
    expect(document.body.textContent).not.toContain('account is locked');
    expect(document.body.textContent).not.toContain('+64-555-0199');
  });

  it('never reads error_description, even next to a known code', () => {
    mountLogin(`?error=access_denied&error_description=${encodeURIComponent(INJECTED)}`);

    expect(screen.queryByText('Sign-in was cancelled before it finished.')).not.toBeNull();
    expect(document.body.textContent).not.toContain('account is locked');
  });

  it('shows no error box at all when there is no error parameter', () => {
    mountLogin('');
    expect(screen.queryByText('Sign-in failed')).toBeNull();
  });
});
