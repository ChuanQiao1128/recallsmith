import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests for the authoring console.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDARY, STATED ONCE
 * ---------------------------------------------------------------------------
 * These are FRONTEND end-to-end tests. The browser, the router, the code
 * splitting, the OAuth redirect and the real production bundle are all genuine;
 * the API and the identity provider are stubbed at the network layer with
 * page.route().
 *
 * That line is drawn deliberately, not for convenience. A full-stack E2E would
 * have to sign a real Cognito user in, which means a username and a password
 * living somewhere a CI runner can read them. This repository stores no
 * credentials — `frontend/.env.development` is committed precisely because
 * every value in it is public — and adding the first secret in order to test
 * something is a bad trade: it converts a test suite into an access-control
 * problem, and a leaked one hands over a real user pool. The backend is covered
 * by its own integration tests against a real database, in
 * `src_C/Tests/RecallSmith.Lambda.IntegrationTests`.
 *
 * What is left over is exactly the set of failures jsdom cannot see, and that
 * set is not small: a lazily-loaded route chunk that 404s in the built output,
 * a router that works under MemoryRouter and not under real history, a bundle
 * whose environment variables were never actually baked in, and an OAuth
 * redirect that never leaves. Each of those has shipped in real projects behind
 * a green unit suite.
 */
export default defineConfig({
  // Separate from tests/, whose *.test.ts(x) files belong to vitest. The two
  // runners must never collect each other's files: vitest cannot drive a
  // browser, and Playwright's `test` is a different function from vitest's.
  // tests/runnerSeparation.test.ts asserts the two globs stay disjoint against
  // the files actually on disk, rather than leaving it to this comment.
  testDir: './tests/e2e',
  // Narrower than Playwright's default (which also matches *.test.ts, i.e.
  // every vitest file). Stated so the separation is a property of the config
  // rather than of nobody having put a .test.ts in this directory yet.
  testMatch: '**/*.spec.ts',

  // A smoke suite that is flaky is worse than no smoke suite: it teaches people
  // to re-run rather than to read. No retries, so a failure is a failure.
  retries: 0,
  fullyParallel: true,
  // Refuse to pass a run that only contains skipped or focused tests.
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    // Kept only for a failure. Artefacts are gitignored; see frontend/.gitignore.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // One browser. Chromium is what the console is developed against, and a
  // second engine here would double the CI time to re-check the same two
  // assertions about this application rather than about the engines.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // The BUILT bundle, served by `vite preview` — not the dev server. The dev
    // server transforms modules on demand and would hide the whole class of
    // failure this suite exists for: a chunk that only 404s in dist/, or a
    // define that only lands in a production build.
    //
    // `--mode e2e` loads frontend/.env.e2e; see that file for why the default
    // production mode produces an unauthenticated build.
    //
    // `--strictPort` because 5173 is not a preference. The Cognito app client
    // registers http://localhost:5173/auth/callback as its redirect URI, so a
    // build whose redirect_uri says 5173 while the server sits on 4173 is a
    // different application. Without it, vite silently moves to the next free
    // port and the first spec fails with something that looks unrelated.
    command:
      'npm run build -- --mode e2e && npm run preview -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    // The build is the slow half. A cold `tsc -b` on a CI runner with no
    // incremental cache has been measured in the tens of seconds.
    timeout: 180_000,
  },
});
