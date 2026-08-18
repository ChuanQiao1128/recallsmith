# RecallSmith

A spaced-repetition flashcard product for developers: an Expo/React Native app
where people review cards, a React admin console for authoring and publishing
decks, and a .NET Lambda backend on AWS behind API Gateway and PostgreSQL. Card
review events flow onward into Snowflake, where a small analytics pipeline scores
how well each card's stated difficulty matches how people actually perform on it.

This is a personal project, written and maintained by one person.

## 1. What is in this repository

| Directory | Stack | Responsibility | Files |
| --- | --- | --- | --- |
| `frontend/` | React 19, TypeScript, Vite, Tailwind | Admin console: authoring decks and cards, publishing, user administration | 177 |
| `mobile/` | React Native, Expo, TypeScript | The app people actually review cards in | 319 |
| `src_C/` | C# / .NET 8 | Backend. `src_C` is short for "source, C#" — it is the API, not a frontend `src/` | 126 |
| `pg-layer/` | Node.js | AWS Lambda layer packaging the `pg` PostgreSQL driver | 3 |
| `snowflake/` | SQL | Warehouse setup and the marts that model card quality | 4 |
| `docs/` | Markdown | Design notes and refactor plans | 11 |
| `.github/` | YAML | CI workflow | 1 |

File counts are `git ls-files <dir> | wc -l` as of this commit, and
`frontend/tests/rootReadmePaths.test.ts` fails if they drift.

Test counts are deliberately not quoted anywhere here. They change with almost
every commit, and the only honest way to keep such a number true is a check that
runs the suite — which cannot live inside the suite it measures. A number nothing
keeps true is worse than no number: it reads as verified and falsifies in one
command. Run the commands below and read the real output.

`src_C/` is the one directory name that misleads. It is the entire backend:
`Vpc/` holds the Lambdas that sit inside the VPC and talk to PostgreSQL,
`Public/` the ones that do not, `Worker/` an SQS consumer, `Shared/` the common
auth and database helpers, and `Tests/` the integration test project.

## 2. Running it

Prerequisites come from `.github/workflows/ci.yml`: Node 20 and .NET 8.

### Admin console

```bash
cd frontend
npm ci
npm run dev
```

No configuration step: `frontend/.env.development` is committed, so this starts
against the deployed dev API and its Cognito app client. The dev server must stay
on port 5173 — the Cognito callback is registered as
`http://localhost:5173/auth/callback`, and logging in from any other port fails
the callback.

### Mobile app

```bash
cd mobile
npm ci
npx expo start
```

### Tests

```bash
cd frontend && npm ci && npx vitest run
cd mobile   && npm ci && npx vitest run
cd src_C    && dotnet test Tests/RecallSmith.Lambda.IntegrationTests
```

## Deployment

The console is deployed at https://d12pfy1rhi3ekm.cloudfront.net — a private S3
bucket behind CloudFront, reachable only through the distribution (Origin
Access Control; the bucket blocks all public access and its policy names one
distribution ARN). Three things about the setup carry the reasoning:

- **SPA fallback.** S3 answers 403 for keys that do not exist, so CloudFront
  maps 403/404 to `/index.html` with a 200 — that is what makes
  `/decks/cards?deckId=7` a working deep link instead of an error page.
- **Cache split.** Hashed assets ship with `max-age=31536000, immutable`;
  `index.html` ships with `no-cache`. A new build changes the hashes, the
  fresh `index.html` points at them, and the old chunks stop being referenced
  — which is exactly the failure window `ChunkErrorBoundary` exists for.
- **Build-time config.** `frontend/.env.production` is committed and carries
  the deployed callback URLs; Vite's mode-specific files outrank `.env.local`,
  so a developer's local overrides cannot leak into a deploy artifact.

Deploying is two commands from `frontend/`:

```bash
npm run build
aws s3 sync dist s3://recallsmith-console-622994489535 --delete \
  --exclude index.html --cache-control "public,max-age=31536000,immutable"
```

then upload `index.html` with `no-cache` and invalidate the distribution.
CI does not deploy: shipping on green is a decision, not a default, and this
project has exactly one person to make it.

## 3. How one request flows

Opening a deck in the console calls `fetchDeckById` in
`frontend/src/api/authoring.ts`, which issues
`GET /api/v1/authoring/decks?id=` through the shared axios instance in
`frontend/src/api/http.ts`. That instance attaches the Cognito access token from
`frontend/src/auth/tokenStore.ts` as a bearer header on every request. If that token is
within a minute of expiring it is refreshed first, and the request waits: every
request that arrives during a refresh awaits the same one, so a page that fires
four calls on mount spends the refresh token once rather than four times. Only
when the refresh itself is refused, or when a request that did carry a fresh
token still comes back 401, does the client clear the session and navigate to
`/login` — once per page, however many requests failed together. API Gateway routes the call
to the VPC Lambda, where `HandleAuthoringDecks` in
`src_C/Vpc/Authoring/Decks.cs` checks the caller with `Auth.RequireAdmin`, opens
a connection via `Pg.OpenConnectionOrNullAsync()` and queries PostgreSQL through
`DbUtil.QueryAsync`.

Publishing is the one asynchronous path. `src_C/Vpc/Authoring/Publish.cs` inserts
a row into `deck_publishes` and puts a message on SQS rather than doing the work
inline; `FunctionHandler` in `src_C/Worker/WorkerFunction.cs` consumes that queue
and builds the published content. The console polls the job row for status, which
is why `DeckListPage` has a poller in it.

## 4. Tests and CI

`.github/workflows/ci.yml` runs four jobs on every push, in parallel: `mobile`,
`frontend`, `e2e` and `backend`.

| Command | Result |
| --- | --- |
| `cd frontend && npx vitest run` | All green |
| `cd frontend && npx playwright test` | 2 passed |
| `cd frontend && npx eslint src tests vitest.config.ts` | 0 errors, 1 warning |
| `cd frontend && npm audit --omit=dev --audit-level=high` | found 0 vulnerabilities |
| `cd frontend && npm run build` | `dist/assets/index-*.js` is 282,510 bytes |
| `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` | All green |

Every number above was produced by running that exact command while writing this
file.

Several of the frontend tests exist to check wiring rather than behaviour:
`frontend/tests/hookWiring.test.ts` fails if `src/hooks/index.ts` publishes a hook nothing
calls, and `frontend/tests/consolePlanDoc.test.ts` fails if `docs/console-refactor-plan.md`
cites a test file that does not exist. They were written because this codebase's
recurring failure was code that was present but not wired to anything, which no
compiler reports.

**The console is written in English only, and that is checked rather than
agreed.** It used to be mixed: the route error boundary, the card form's
advisory hints, the new-deck form and three rendered rarity labels were Chinese
while every button, heading and placeholder around them was English. No i18n
framework is installed and none is planned — one language can be stated as a
decision, a mixture cannot be stated as anything —
so `frontend/tests/uiLanguage.test.ts` scans every file under `frontend/src/`
for CJK and fails on the first one, and fires the same detector at sample text
it must catch so a scan that quietly stops working cannot pass. `frontend/tests/`
is deliberately outside that scan: `frontend/tests/deckImport.test.ts` carries
Chinese *card content*, because the product ships zh-CN decks and the importer
has to survive them.

**Every write goes through the data layer, and the layer's defaults are
conservative on purpose.** The six mutations in `frontend/src/hooks/` invalidate
the query keys they change, so the deck list is told when a deck is created,
edited, deleted or published, and a card list is told when a card is written.
The shared client in `frontend/src/api/queryClient.ts` nevertheless defaults to
`staleTime: 0` and no ambient refetching: a global default describes what is
safe for the system as it stands, and a page that can prove caching is safe
there raises it deliberately. The previous defaults were the opposite — a
five-minute window that every hook overrode line by line, so it governed no
behaviour at all while sitting ready for the next hook to inherit.
`frontend/tests/queryClientDefaults.test.tsx` holds the hooks out of restating
those settings, because a hook that repeats them makes the tests that guard the
default pass whatever the default becomes.

**Everything under `frontend/src/pages/` is a route entry, and that is
checked.** Four modules that were not pages — a pagination reducer, a manifest
parser, a row projection and a hook — had accumulated there because each was
"about `DeckListPage`", and a directory name is prose that never fails. They now
live with the five presentational components of the same screen under
`frontend/src/features/deckList/`, and
`frontend/tests/consoleDirectoryLayout.test.ts` fails if `src/pages/` and the
routes in `frontend/src/App.tsx` ever stop naming the same set. The rest of the
convention — `features/` aggregates one domain, `components/ui/` is what two
domains share, `lib/` is pure functions — is written down in
`docs/console-refactor-plan.md` and deliberately not asserted: those are
judgements about what a file is for, and a test that scored them would be
scoring its own guess.

**Uncaught failures have one funnel, and it is silent until someone points it
at a collector.** `frontend/src/lib/reportError.ts` takes the three ways a
failure escapes the application — a throw outside React, a rejected promise
nobody awaited, and a component throwing during render — and sends one
`navigator.sendBeacon` carrying the build id, the route and the stack. There is
no server collecting these today, so with `VITE_ERROR_REPORT_URL` unset it makes
zero network calls; `frontend/tests/errorReporting.test.tsx` asserts the silence
by counting `sendBeacon` calls, and asserts the same three entry points do send
when the variable is set. The route is `location.pathname` and never the query
string, because `/auth/callback` carries the Cognito authorization code and a
failure there is exactly when a report would fire.

**The console is single-theme, and the two files that disagreed have been
corrected.** `ConfirmDialog` and the `Button` it renders were the only files in
`src/` carrying Tailwind `dark:` variants. `frontend/tailwind.config.js` sets no
`darkMode`, so the default `media` strategy applied and those variants fired on
the OS setting: on a Mac in dark mode the confirmation dialog went dark while
every page behind it stayed white. `frontend/tests/singleTheme.test.ts` fails on
the next `dark:` that appears anywhere under `src/`.

**The console's one hand-rolled cache is scoped to the account that filled it.**
`frontend/src/lib/sessionCache.ts` keys `DeckListPage`'s five-minute deck and
manifest lists by the signed-in user's Cognito `sub`, drops them when
`clearTokens()` ends a session, and drops them again when a deck is deleted or
published. Before that there was one pair of keys per browser and no clearing at
all, so closing the tab and signing in as somebody else painted the previous
account's decks — including ones the new account cannot read — with no request
for any server check to refuse.

**The sign-in chain is tested, which it was not.** Cognito authentication was
the largest untested surface here: the PKCE pair, the callback that turns an
authorization code into a session, and the interceptor that refreshes an
expiring token were all reachable only by signing in by hand.
`frontend/tests/pkceShape.test.ts` pins the challenge against the vector
published in RFC 7636 rather than against a digest it computes for itself — a
locally-derived expectation reproduces the interesting mistakes (standard
base64 instead of base64url, kept padding) instead of catching them.
`frontend/tests/authCallbackPage.test.tsx` drives the callback page with only
`fetch` faked, so its assertions are about the same sessionStorage record the
console reads on the next page load: a `state` this browser did not issue never
reaches the network, a refused exchange leaves no half-written session, and the
destination remembered across the OAuth round trip is re-sanitised on the way
out rather than only on the way in. `frontend/tests/authTokenRefresh.test.ts`
covers the interceptor, including the case a console page produces on every
cold mount — several requests noticing one expired token at the same moment.

**There is a browser smoke suite, and it stubs the API on purpose.**
`frontend/tests/e2e/authoringConsole.spec.ts` runs two Playwright tests against
the real production bundle, served by `vite preview` on port 5173 — the port the
Cognito redirect URI is registered against. One: an unauthenticated visit is
redirected to the login page, and the sign-in button really leaves for the
Cognito authorize URL carrying a `code_challenge` that is the SHA-256 of the
verifier that browser has just stored. Two: a seeded session renders the deck
list and navigates into the cards route, and the `CardListPage` chunk is
fetched for the first time and returns 200 — the failure jsdom is structurally
unable to see, because it has no bundler output to 404 on. The API and Cognito
are stubbed at the network layer with `page.route()`: a full-stack run would
need a real Cognito username and password on a CI runner, and this repository
stores no credentials at all — `frontend/.env.development` is committed
precisely because every value in it is public. `frontend/.env.e2e` builds the
bundle against a `.invalid` Cognito domain, so a mis-stubbed redirect cannot
reach a live service even by accident. The two runners are kept apart by a
single character — `.spec.ts` against `.test.ts` — so
`frontend/tests/runnerSeparation.test.ts` asks each collector what it would
actually collect and fails if the two sets ever meet.

The test files are type-checked, at the same strictness as `src/`.
`frontend/tsconfig.test.json` covers `tests/` and is referenced from
`frontend/tsconfig.json`, so `tsc -b` — and therefore `npm run build` and CI —
compiles every file under `tests/` alongside the app. This was not always
true: `tests/` used to sit outside the `include` of every tsconfig, so a type
error in a test was visible to nothing but ESLint. `frontend/tests/tsconfigTestProject.test.ts`
fails if that reference is removed again, and
`frontend/tests/typeGateFileSet2.test.ts` fails if the set of files the project
resolves to stops matching the files actually on disk — which is how "every
file" stopped being true once before, silently, when an `exclude` glob meant to
skip iCloud conflict copies also swallowed ordinary filenames.

(That sentence used to give a file count. It was wrong by the time anyone read
it, because nothing kept it true. Counts belong in assertions, which recheck
themselves; prose gets the claim that does not expire.)

## 5. Known limitations

- **`tsc --noEmit` is not a check in this repo.** `frontend/tsconfig.json` is
  references-only with no `include`, so it checks zero files and exits 0 with a
  real type error sitting in `src/`. Use `tsc -b`, which is what `npm run build`
  runs and therefore what CI enforces.
- **One known lint warning**, at `frontend/src/pages/DeckListPage.tsx:498`
  (`react-hooks/exhaustive-deps` on the publish-jobs poller). CI does not use
  `--max-warnings 0`, so the bar is 0 errors rather than 0 problems. Fixing it
  means changing polling code that `frontend/tests/deckListPagePolling.test.tsx` pins
  character-for-character.
- **`DeckListPage.tsx` is 723 lines.** Its JSX now lives in five presentational
  components under `frontend/src/features/deckList/components/`, but the page
  still owns deck fetching, the search debounce, the publish-jobs poller and
  both row actions, so it remains the largest file in `src/`. (The five-minute
  localStorage cache moved out to `frontend/src/lib/sessionCache.ts`, which is
  why the count went down rather than up.) An earlier, unused set of five components in a sibling `decks/`
  directory (deleted, no longer in the tree) was not adopted during that split:
  it rendered different markup, and its `DeckTable` called `useNavigate()`
  internally, which `frontend/tests/deckListHookOrder.test.ts` now forbids for
  the components the page does use.
- **One deliberate `window.confirm` remains**, in
  `frontend/src/components/ui/ConfirmDialogContext.ts`. The four confirmations
  that used to call it directly (`CardListPage`, `AdminUsersPage`,
  `DeckListPage` twice) now go through `ConfirmDialogProvider`, mounted in
  `frontend/src/App.tsx` inside the chunk boundary and outside `Suspense`;
  `frontend/tests/confirmWiring.test.tsx` mounts the real `<App/>` and presses a
  real row's Delete button, with `window.confirm` stubbed to throw so the
  fallback cannot pass for the real thing. The fallback itself is what lets page
  tests mount a page with no application shell above it, and it is asserted in
  `frontend/tests/confirmDialogA11y.test.tsx` rather than left implicit.
- **The end-to-end suite does not reach the API.** `npx playwright test` drives
  a real browser against the real built bundle, but the RecallSmith API and the
  Cognito hosted UI are stubbed with `page.route()`, so nothing checks that the
  console and the backend still agree on a payload. The gap is deliberate and
  its reasoning is in §4; it is why those two tests are called smoke tests
  rather than end-to-end coverage. The server side is exercised against a real
  database by `src_C/Tests/RecallSmith.Lambda.IntegrationTests`.
- **An untracked `.env.local` under frontend/ changes what the unit suite sees.**
  It is a copy of the committed `frontend/.env.development`, and vitest loads it
  in mode `test`, so on a developer machine `AUTH_CONFIG` is populated while on
  a CI runner it is empty. No test depends on that today — the ones that need a
  Cognito configuration stub it explicitly — but a new one written against
  whatever happens to be there would pass locally and behave differently in CI.

## 6. Repository map

- `docs/console-refactor-plan.md` — read from disk by
  `frontend/tests/consolePlanDoc.test.ts`, which asserts every test file the plan
  cites exists. Renaming or moving it turns the `frontend` CI job red.
- `frontend/.env.development` — committed on purpose. Every value in it is public
  by construction: the dev API Gateway URL, a Cognito app client id and localhost
  redirect URIs, all of which ship inside any browser bundle anyway. No secret
  lives in this repository.
- `frontend/.env.e2e` — committed for the same reason, and two of its values are
  deliberately not real. `vite build --mode e2e` reads it, and it exists because
  the default production mode loads no env file at all: that bundle has no
  Cognito configuration, so `RequireAuth` waves every route through and the
  smoke tests would be driving an application with its authentication removed.
- `frontend/playwright.config.ts` — one browser, `testDir` pointed at
  `frontend/tests/e2e`, and a `webServer` that builds and previews on port 5173
  with `--strictPort`. The port is not a preference: the Cognito app client
  registers `http://localhost:5173/auth/callback`, so a server that silently
  moved to vite's default 4173 would be serving a different application.
- `pg-layer/` — the `pg` driver packaged as a Lambda layer, so the VPC functions
  do not each bundle their own copy.
- `snowflake/*.csv` — real sample output from `marts.mart_card_quality_daily`,
  exported from the Snowflake UI, kept as evidence the pipeline ran.
- `mobile/scripts/` — a screenshot-quality pipeline that drives the simulator and
  scores screens against `mobile/docs/qa/screen-quality-rubric.md`.

## License

MIT — see [LICENSE](LICENSE).
