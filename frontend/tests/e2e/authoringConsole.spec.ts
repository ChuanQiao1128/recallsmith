// Browser smoke tests for the authoring console.
//
// ---------------------------------------------------------------------------
// THE BOUNDARY THIS SUITE DRAWS, AND WHY
// ---------------------------------------------------------------------------
// Real: a real Chromium, the real production bundle served by `vite preview`,
// real history-based routing, real code splitting, real WebCrypto, and the real
// OAuth redirect leaving the page.
//
// Stubbed at the network layer with page.route(): the RecallSmith API and the
// Cognito authorize endpoint.
//
// The API is stubbed because the alternative is not "a better test", it is a
// different and worse repository. A full-stack end-to-end run has to sign a
// real Cognito user in, and that means a username and a password stored
// somewhere a CI runner can read. This repository holds no credentials at all —
// `frontend/.env.development` is committed precisely because every value in it
// is public — and introducing the first secret in order to test something turns
// a test suite into an access-control problem whose worst day is a leaked user
// pool. The server side is covered against a real database by
// `src_C/Tests/RecallSmith.Lambda.IntegrationTests`, which is where that
// coverage belongs.
//
// What remains is exactly the set of failures the 740-test vitest suite is
// structurally unable to see, because jsdom has no bundler, no network stack
// and no navigation:
//
//   - a lazily-loaded route chunk that is missing or 404s in the BUILT output
//   - environment variables that never actually made it into the bundle
//   - a redirect that composes correctly and then does not leave
//   - `crypto.subtle` behaving differently from the polyfilled shim in tests
//
// Every one of those is invisible to a green unit run and obvious within one
// second of opening the app.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS NOT A *.test.ts
// ---------------------------------------------------------------------------
// vitest collects `tests/**/*.test.ts(x)` and Playwright collects
// `tests/e2e/**/*.spec.ts`. The two sets are disjoint by extension, and
// `tests/runnerSeparation.test.ts` asserts that against the files on disk
// rather than trusting this paragraph — vitest cannot drive a browser, and a
// vitest run that swallowed this file would fail on the import alone.

import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';

/** Matches frontend/.env.e2e, which is what the bundle under test was built with. */
const COGNITO_DOMAIN = 'https://auth.e2e.invalid';
const CLIENT_ID = 'e2e-client-id';
const REDIRECT_URI = 'http://localhost:5173/auth/callback';

const TOKEN_KEY = 'devcards:tokens';
const PKCE_VERIFIER_KEY = 'devcards:pkce:verifier';
const PKCE_STATE_KEY = 'devcards:pkce:state';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An ApiResult<T> envelope, the shape src/types/api.ts declares. */
function ok<T>(data: T): string {
  return JSON.stringify({ success: true, data, error: null, traceId: 'e2e' });
}

const DECK = {
  id: 42,
  slug: 'e2e-smoke-deck',
  title: 'E2E Smoke Deck',
  author: 'Playwright',
  description: 'Every byte of this deck came from page.route().',
  locale: 'en',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  isDeleted: 0,
  tier: 'free',
  availability: 'live',
  manifestOrder: 1,
  totalCards: 1,
  previewCards: 0,
  contentVersion: '1.0.0',
};

const CARD = {
  id: 900,
  deckId: DECK.id,
  stableUid: 'card_e2e_smoke',
  question: 'Which layer does this smoke test actually exercise?',
  explanation: 'The built bundle, in a real browser.',
  difficulty: 2,
  orderInDeck: 1,
  version: 1,
  isDeleted: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const MANIFEST = {
  schemaVersion: 2,
  generatedAtMs: 1767225600000,
  decks: [{ slug: DECK.slug, version: '1.0.0', totalCards: 1, order: 1, tier: 'free', availability: 'live' }],
};

/**
 * A signed-in editor, written the way tests/support/consoleSession.ts writes
 * one: a syntactically valid unsigned JWT, because the console only reads
 * claims and never verifies a signature.
 *
 * `editor` rather than `super_admin` on purpose — that is the group that keeps
 * DeckListPage on its legacy full-list path, which is the plain
 * GET /authoring/decks this test wants to observe rather than the cursor-paged
 * admin endpoint.
 */
function fakeJwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  return `${segment({ alg: 'none', typ: 'JWT' })}.${segment(claims)}.signature-not-verified-by-the-client`;
}

function editorSession(): string {
  const token = fakeJwt({
    sub: 'e2e-editor-sub',
    email: 'e2e@example.invalid',
    'cognito:username': 'e2e-editor',
    'cognito:groups': ['editor'],
  });

  return JSON.stringify({
    accessToken: token,
    idToken: token,
    tokenType: 'Bearer',
    expiresIn: 24 * 60 * 60,
    // Well clear of tokenStore's 30s skew and of http.ts's 60s refresh lead, so
    // nothing in this run can decide the session needs refreshing — there is no
    // token endpoint stubbed, and a surprise refresh would look like a bug in
    // the page instead of a bug in the fixture.
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });
}

/**
 * Answer every /api/v1/ call from memory, and record what was asked for.
 *
 * The returned array is asserted on: a page that served its list from a stale
 * localStorage cache instead of the network would render identically and would
 * leave this empty. Anything unrecognised is answered with an empty success so
 * the page cannot hang, and is recorded under `unexpected` so it fails loudly
 * rather than passing quietly.
 */
async function stubApi(page: Page): Promise<{ seen: string[]; unexpected: string[] }> {
  const seen: string[] = [];
  const unexpected: string[] = [];

  await page.route('**/api/v1/**', (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const body = (payload: string) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: payload });

    seen.push(`${path}${url.search}`);

    if (path === '/api/v1/authoring/decks') return body(ok([DECK]));
    if (path === '/api/v1/admin/manifest') return body(ok(MANIFEST));
    if (path === '/api/v1/authoring/cards/page')
      return body(ok({ items: [CARD], nextCursor: null, hasMore: false }));
    if (path === '/api/v1/authoring/cards') return body(ok([CARD]));
    if (path === '/api/v1/authoring/publish/jobs') return body(ok([]));

    unexpected.push(`${path}${url.search}`);
    return body(ok(null));
  });

  return { seen, unexpected };
}

// ---------------------------------------------------------------------------
// Smoke 1 — a cold, unauthenticated visit really starts PKCE
// ---------------------------------------------------------------------------

test('an unauthenticated visit lands on login and the button starts a real PKCE redirect', async ({
  page,
}) => {
  // Cognito is answered by a stub page rather than by the network, so the
  // redirect genuinely commits — the browser really ends up on the authorize
  // URL — while nothing leaves this machine.
  //
  // The first version aborted the route instead. Chromium commits an ERROR
  // DOCUMENT for an aborted navigation, whose origin is opaque, and the
  // sessionStorage read below then fails with a SecurityError rather than
  // returning the PKCE pair. Answering it and coming back is both the truer
  // simulation and the one that leaves the storage readable.
  const authorizeCalls: string[] = [];
  await page.route(`${COGNITO_DOMAIN}/**`, route => {
    authorizeCalls.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>Cognito stub</title><p>Hosted UI stands here.',
    });
  });

  await page.goto('/');

  // RequireAuth turned the protected front door into a redirect that remembers
  // where the visitor was going. This is real history navigation, not
  // MemoryRouter.
  await expect(page).toHaveURL('http://localhost:5173/login?next=%2F');

  const signIn = page.getByRole('button', { name: 'Continue with Cognito' });
  // Enabled only when AUTH_CONFIGURED is true, which is true only if
  // frontend/.env.e2e actually reached the bundle. A build with no Cognito
  // configuration renders this disabled next to an "Auth is not configured"
  // notice, and both smoke tests would otherwise be driving an application
  // with its authentication removed.
  await expect(signIn).toBeEnabled();
  await expect(page.getByText('Auth is not configured')).toHaveCount(0);

  await signIn.click();

  // The browser is now AT the authorize URL, not merely composing one. This is
  // the assertion jsdom cannot make at all: it refuses the navigation and logs
  // "Not implemented: navigation to another Document", which is visible in
  // every vitest run of this repository.
  await page.waitForURL(url => url.href.startsWith(`${COGNITO_DOMAIN}/oauth2/authorize`));
  const authorizeUrl = new URL(page.url());

  expect(authorizeCalls).toHaveLength(1);

  const params = authorizeUrl.searchParams;
  expect(params.get('response_type')).toBe('code');
  expect(params.get('client_id')).toBe(CLIENT_ID);
  // The port is the assertion. The Cognito app client registers exactly this
  // redirect URI, so a preview server that had drifted to vite's default 4173
  // would produce a bundle-and-server pair that can never complete a sign-in.
  expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
  expect(params.get('scope')).toBe('openid email profile');
  expect(params.get('code_challenge_method')).toBe('S256');

  // What the browser kept for the second leg of the exchange. Read after
  // returning to the app's own origin: sessionStorage is partitioned per tab
  // AND per origin, so it is unreachable while the document is the stub above,
  // and it survives the round trip exactly as it has to survive the real one.
  await page.goto('/login');
  const storage = await page.evaluate(
    ([verifierKey, stateKey]) => ({
      verifier: sessionStorage.getItem(verifierKey),
      state: sessionStorage.getItem(stateKey),
    }),
    [PKCE_VERIFIER_KEY, PKCE_STATE_KEY],
  );

  expect(storage.verifier).toBeTruthy();
  expect(storage.state).toBeTruthy();

  // The two halves are actually connected. tests/pkceShape.test.ts pins the
  // ALGORITHM against the RFC 7636 published vector; what this adds is that the
  // challenge in the outgoing URL is the digest of the verifier THIS browser
  // stored, computed here by node's crypto rather than by the code under test.
  const expectedChallenge = createHash('sha256')
    .update(storage.verifier!, 'ascii')
    .digest('base64url');
  expect(params.get('code_challenge')).toBe(expectedChallenge);

  expect(params.get('state')).toBe(storage.state);

  // The verifier is the secret half. It belongs in the token request body, and
  // nowhere in a URL that is about to be written to a redirect chain.
  expect(authorizeUrl.href).not.toContain(storage.verifier!);
  expect(params.get('code_verifier')).toBeNull();
});

// ---------------------------------------------------------------------------
// Smoke 2 — a session renders the console, and a route chunk really loads
// ---------------------------------------------------------------------------

test('a signed-in console renders decks and navigates into a lazily-loaded route', async ({
  page,
}) => {
  const api = await stubApi(page);

  // Every script the browser fetched, with its status. This is the measurement
  // jsdom cannot make: it has no bundler output to 404 on.
  const scripts: { url: string; status: number }[] = [];
  page.on('response', response => {
    if (response.url().endsWith('.js')) {
      scripts.push({ url: response.url(), status: response.status() });
    }
  });

  // Anything the app logged as an error, so a chunk that failed to parse or a
  // React error boundary firing cannot pass silently.
  const consoleErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(String(error)));

  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [TOKEN_KEY, editorSession()],
  );

  await page.goto('/');

  // Not redirected to /login: the seeded session is a session the real
  // tokenStore accepts.
  await expect(page).toHaveURL('http://localhost:5173/');

  const deckRow = page.getByRole('row', { name: /E2E Smoke Deck/ });
  await expect(deckRow).toBeVisible();
  await expect(page.getByText(DECK.slug)).toBeVisible();

  // The rows came from the stubbed network, not from a leftover cache.
  expect(api.seen).toContain('/api/v1/authoring/decks');
  expect(api.seen).toContain('/api/v1/admin/manifest');

  const cardsChunkLoadedBefore = scripts.some(s => /CardListPage-.*\.js$/.test(s.url));
  // Code splitting is real, not aspirational: the cards page is not in the
  // first-load closure. If this were already true the assertion after the click
  // would be measuring nothing.
  expect(cardsChunkLoadedBefore).toBe(false);

  await deckRow.getByRole('button', { name: 'Cards', exact: true }).click();

  await expect(page).toHaveURL(`http://localhost:5173/decks/cards?deckId=${DECK.id}`);

  // The route rendered its own content rather than ChunkErrorBoundary's
  // fallback, which is what a chunk that 404s produces.
  await expect(page.getByText(CARD.question)).toBeVisible();
  await expect(page.getByText('This page did not finish loading')).toHaveCount(0);

  const cardsChunk = scripts.filter(s => /CardListPage-.*\.js$/.test(s.url));
  expect(cardsChunk.length).toBeGreaterThan(0);
  // 200, not merely "requested". A dev server rewrites a missing asset to
  // index.html and answers 200 with HTML; `vite preview` serving the real dist/
  // is what makes this status meaningful.
  expect(cardsChunk.every(s => s.status === 200)).toBe(true);

  expect(api.seen).toContain(`/api/v1/authoring/cards/page?deckId=${DECK.id}&limit=200`);
  expect(api.unexpected).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
