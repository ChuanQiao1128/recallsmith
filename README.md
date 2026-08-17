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
| `frontend/` | React 19, TypeScript, Vite, Tailwind | Admin console: authoring decks and cards, publishing, user administration | 112 |
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

## 3. How one request flows

Opening a deck in the console calls `fetchDeckById` in
`frontend/src/api/authoring.ts`, which issues
`GET /api/v1/authoring/decks?id=` through the shared axios instance in
`frontend/src/api/http.ts`. That instance attaches the Cognito access token from
`frontend/src/auth/tokenStore.ts` as a bearer header on every request, and on a 401 it
clears the stored tokens and redirects to `/login`. API Gateway routes the call
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

`.github/workflows/ci.yml` runs three jobs on every push: `mobile`, `frontend`
and `backend`.

| Command | Result |
| --- | --- |
| `cd frontend && npx vitest run` | All green |
| `cd frontend && npx eslint src tests vitest.config.ts` | 0 errors, 1 warning |
| `cd frontend && npm run build` | `dist/assets/index-*.js` ≈ 274 kB |
| `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` | All green |

Every number above was produced by running that exact command while writing this
file.

Several of the frontend tests exist to check wiring rather than behaviour:
`frontend/tests/hookWiring.test.ts` fails if `src/hooks/index.ts` publishes a hook nothing
calls, and `frontend/tests/consolePlanDoc.test.ts` fails if `docs/console-refactor-plan.md`
cites a test file that does not exist. They were written because this codebase's
recurring failure was code that was present but not wired to anything, which no
compiler reports.

## 5. Known limitations

- **The test files are not type-checked.** `tests/` is outside the `include` of
  every tsconfig — `frontend/tsconfig.app.json` covers `src/`,
  `frontend/tsconfig.node.json` covers `vite.config.ts` — so all 31 frontend test files are read only by ESLint and
  Vitest's own transform. A type error in a test does not fail the build.
- **`tsc --noEmit` is not a check in this repo.** `frontend/tsconfig.json` is
  references-only with no `include`, so it checks zero files and exits 0 with a
  real type error sitting in `src/`. Use `tsc -b --force`.
- **One known lint warning**, at `frontend/src/pages/DeckListPage.tsx:590`
  (`react-hooks/exhaustive-deps` on the publish-jobs poller). CI does not use
  `--max-warnings 0`, so the bar is 0 errors rather than 0 problems. Fixing it
  means changing polling code that `frontend/tests/deckListPagePolling.test.tsx` pins
  character-for-character.
- **`DeckListPage.tsx` is 1094 lines** and does filtering, table rendering, stats
  and publish polling in one component. The pieces it would split into already
  exist under `frontend/src/components/decks/`, unused.
- **Four confirmation dialogs still use the browser's `window.confirm`**
  (`CardListPage`, `AdminUsersPage`, `DeckListPage` twice). A `ConfirmDialog`
  component exists under `frontend/src/components/ui/` and is not wired to them.
- **The console has no automated end-to-end test.** Nothing exercises a real
  browser against a real API; the frontend suite runs against mocked HTTP.

## 6. Repository map

- `docs/console-refactor-plan.md` — read from disk by
  `frontend/tests/consolePlanDoc.test.ts`, which asserts every test file the plan
  cites exists. Renaming or moving it turns the `frontend` CI job red.
- `frontend/.env.development` — committed on purpose. Every value in it is public
  by construction: the dev API Gateway URL, a Cognito app client id and localhost
  redirect URIs, all of which ship inside any browser bundle anyway. No secret
  lives in this repository.
- `pg-layer/` — the `pg` driver packaged as a Lambda layer, so the VPC functions
  do not each bundle their own copy.
- `snowflake/*.csv` — real sample output from `marts.mart_card_quality_daily`,
  exported from the Snowflake UI, kept as evidence the pipeline ran.
- `mobile/scripts/` — a screenshot-quality pipeline that drives the simulator and
  scores screens against `mobile/docs/qa/screen-quality-rubric.md`.

## License

MIT — see [LICENSE](LICENSE).
