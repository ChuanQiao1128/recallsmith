# RecallSmith admin console

The React admin console: authoring decks and cards, publishing them, and
administering users. It talks to the .NET Lambda backend in `src_C/` through
API Gateway. See the [root README](../README.md) for the rest of the system.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | `tsc -b && vite build` — this is also the type-check step |
| `npm test` | `vitest run` |
| `npm run lint` | `eslint .` — 0 errors, 1 known warning |
| `npm run preview` | Serves an already-built `dist/` |

Two things about type-checking that are easy to get wrong here:

- `npx tsc --noEmit` is **not** a check. `tsconfig.json` is references-only with
  no `include`, so it checks zero files and exits 0 even with a real type error
  in `src/`. Use `npx tsc -b --force`.
- Plain `tsc -b` skips work when an incremental buildinfo is present. `--force`
  reproduces what CI does.

`tests/` is outside the `include` of every tsconfig, so the test files are not
type-checked at all — only ESLint and Vitest's transform read them.

## Environment

`.env.development` is committed, so `npm ci && npm run dev` runs with no
configuration step. Vite loads it automatically by filename, and the five values
in it are public by construction — a dev API Gateway URL, a Cognito app client
id, and localhost redirect/scope settings — all of which are visible in any
shipped browser bundle. No secret is stored in this repository.

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE` | Backend base URL. `VITE_API_BASE_URL` overrides it if set; with neither, requests go same-origin through the Vite dev proxy |
| `VITE_COGNITO_DOMAIN` | Cognito hosted-UI domain |
| `VITE_COGNITO_CLIENT_ID` | Cognito app client id |
| `VITE_COGNITO_REDIRECT_URI` | OAuth callback, `http://localhost:5173/auth/callback` |
| `VITE_COGNITO_LOGOUT_URI` | Where the hosted UI returns after sign-out |
| `VITE_COGNITO_SCOPES` | Requested OAuth scopes |

**The dev port is not negotiable.** The Cognito app client has
`http://localhost:5173/auth/callback` registered as its callback URL, so a dev
server on any other port gets through the login screen and then fails the
callback.

`src/api/contentManifest.ts` also reads `VITE_CONTENT_MANIFEST_URL` (falling back
to `VITE_MANIFEST_URL`). Neither is set in `.env.development`; that feature
reports a "not set" error until one is provided.

## Card reports (`/reports`)

The Reports section lists what learners reported on published cards
(`GET /api/v1/admin/card-reports`), filtered by status (open, resolved, all)
and deck; both filters live in the URL (`/reports?status=all&deckId=7`). Each
row links the card editor (`/decks/cards/edit?deckId=&cardId=`) and resolves in
an inline form (resolution plus an optional note of at most 500 characters,
`POST /api/v1/admin/card-reports/:reportId/resolve`); the row updates at once
and rolls back if the server refuses. Learner notes are shown as plain text and
no reporter is ever shown. A report sent by a learner who was not signed in
(R28 ANONREPORT, `anonymous: true` in the list) has no note and reads "Not
signed in" under its reason; it is resolved like any other. Until the server's card reports migration has run,
the page shows a neutral "not set up on the server yet" callout. The Automation
overview has a "Card reports" tile (open, new in 7 days) when the status
response carries `cardReports`.

## Usage and freshness (`/usage`)

The Usage section shows learner activity from
`GET /api/v1/admin/analytics/usage?days=30`: DAU, WAU and MAU for the latest
complete UTC day with a plain SVG sparkline of DAU, a 30-day table (day, DAU,
reviews, new users, cards learned, D1 and D7 retention; "—" for anything the
server has not computed yet), a per-deck table, the number of excluded accounts
(`ANALYTICS_EXCLUDED_SUBS` on the server) and when the figures were last
computed. Its Freshness section (`/usage#freshness`) lists detected source
changes followed to their publish (`GET /api/v1/admin/automation/freshness`)
with the median minutes to draft, decision and publish. Until the analytics
migration has run, both show a neutral "not set up yet" callout.

Between By deck and Freshness, the "Funnel (anonymous installs)" section reads
`GET /api/v1/admin/analytics/funnel?days=90` (anonymous counts only, no user or
device id): every funnel step (first open, goal chosen, starter started and
completed, first pack opened, returned day 1 and day 7, sign-up started and
completed) with its count, the conversion from first open and a plain SVG bar;
the last 12 cohort weeks (newest first, each step as "count (share of that
week's first opens)"); and by deck the goal, starter and first-pack steps,
converted from goal chosen. The conversions are computed in
`src/lib/funnelView.ts`. The client reads exactly the shape the server sends
(`overall.counts`, `weeks[].weekStart`/`counts`, `byDeck[].deckSlug`/`counts`,
counts keyed by the snake_case event names); any other shape is an error, never
an empty funnel. Only `503 NOT_READY` (no funnel migration) gets a neutral
callout; every other error, a 404 included, shows the server message. An empty
window says no anonymous install has been counted yet.

Related, all optional and hidden when the server does not send them (except
the Semantic duplicates panel, which always shows on the AI QA page):

- Automation overview: a "Freshness" tile (median time to publish, n, link to
  `/usage#freshness`) and "Needs review" in Watched sources.
- Automation Watch tab: per change, the affected cards (question linked to the
  editor, "Quote missing" badge) and a "Needs review" badge; a "Recent release
  notes" section lists new feed items with the cards they may touch.
- AI QA page: a "Semantic duplicates" panel (card pairs at cosine ≥ 0.90 from
  `GET /api/v1/admin/decks/:deckId/semantic-duplicates`, plus the embeddings
  status). Without pgvector the server answers `VECTOR_NOT_READY` and the
  panel lists the owner steps: install the extension, re-run the migration,
  push embeddings with `dc-evals embed-cards --deck <slug> --push`. On a
  server that predates these routes (404 "Route not found") the panel shows a
  neutral "not on this server yet" callout instead of an error.
- Automation ledger: a baseline with enough measured reviews shows "Suggested
  from N reviews: X min"; a super_admin's "Use as measured" pre-fills the edit
  form, and Save is the existing baseline PUT.

## Deployment

`./deploy.sh` is the whole deploy as one command: it runs `npm run build`, syncs
the hashed assets under `dist/` to the console bucket as immutable
(`public,max-age=31536000,immutable`), uploads `dist/index.html` last with
`no-cache`, invalidates the CloudFront distribution, then reads `index.html` back
from the live URL and compares its hash against the built one. Knobs, all read
from the environment: `DRY_RUN=1` builds and prints the commands without touching
AWS (not even the SSM lookup of the Sentry DSN, unless `CONSOLE_SENTRY_DSN_PARAM` is
set explicitly); `AWS_PROFILE` (default `devcards-deploy`, see below) picks the credentials; `CONSOLE_BUCKET` and
`CONSOLE_DISTRIBUTION_ID` override the bucket and distribution defaults.

Production deploys run in CD (`.github/workflows/cd.yml`, `infra/RUNBOOK.md` §12): a
build job without AWS credentials runs `npm run build` with `VITE_SENTRY_DSN` from the
repository variable `CONSOLE_SENTRY_DSN`, and the approved deploy job runs
`PREBUILT=1 ./deploy.sh`, which ships `dist/` as built (no build, no npm) after
`scripts/check-bundle-dsn.sh` has confirmed the bundle carries the DSN the SSM parameter
holds. Run from a laptop (not `DRY_RUN`), `deploy.sh` first requires a clean tree at
`origin/main` with green CI (`../scripts/deploy-preflight.sh`; `BREAK_GLASS=1` overrides).
`AWS_PROFILE` defaults to `devcards-deploy` only when the environment carries no
credentials of its own.

The sync keeps old chunks on purpose — it no longer deletes what is not in the
new build. A tab opened before a deploy still points at the previous
`index.html`, and its next navigation asks for a hashed chunk from that older
build; because CloudFront rewrites a missing object to `index.html` (200), a
deleted chunk would come back as HTML and break the lazy import instead of
loading. Leaving the old assets in place lets those open tabs finish loading
until they reload.

### Error reporting (Sentry)

`deploy.sh` sources `scripts/resolve-sentry-dsn.sh` right before `npm run build`.
The resolver takes `VITE_SENTRY_DSN` from the environment when it is set, and
otherwise reads the SSM **String** parameter
`/developercards/prod/console-sentry-dsn` (override the name with
`CONSOLE_SENTRY_DSN_PARAM`), read without decryption. A value that does not look
like a DSN is dropped with a warning. It prints only `VITE_SENTRY_DSN: set` or
`VITE_SENTRY_DSN: unset (Sentry disabled in this build)`, never the value, and
never fails the deploy. With no DSN the build has no active Sentry code path: the
SDK is never loaded and nothing leaves the browser.

- `VITE_SENTRY_ENVIRONMENT` (optional) is the Sentry environment; default
  `production`.
- `VITE_BUILD_ID` (default: the 12-character commit, set by the resolver) becomes
  the release `console@<id>`.
- The SDK is loaded lazily, in its own chunk, after the page has decided to use
  it: the first-load and eager budgets in `tests/bundleFirstLoad.test.ts` have no
  room for it.
- What is sent: uncaught window errors and unhandled rejections (Sentry's own
  handlers), render errors from `ChunkErrorBoundary`, and performance spans at
  `tracesSampleRate 0.05`. Each report carries the tags `console.source` and
  `console.route` (the pathname only).
- What is scrubbed before sending (`src/lib/sentryScrub.ts`): bearer tokens, JWTs
  and email addresses in any text; query strings and fragments of every URL
  (the Cognito `code` on `/auth/callback`, signed CloudFront URLs); the `user`,
  request cookies, query string and body; credential- or email-named keys at any
  depth; console breadcrumbs.
- `sendDefaultPii: false`; no session replay, no feedback widget, no profiling.
- No trace propagation to the API (`tracePropagationTargets: []`): the API's
  CORS `allow_headers` does not list `sentry-trace` or `baggage`.

Creating the parameter is a supervisor step, not part of `deploy.sh`: an SSM
parameter of type String named `/developercards/prod/console-sentry-dsn`, in the
deploy region, holding the console project's DSN. Afterwards
`CONSOLE_SENTRY_DSN_PARAM=/developercards/prod/console-sentry-dsn DRY_RUN=1 ./deploy.sh`
should print `VITE_SENTRY_DSN: set` (a plain `DRY_RUN=1` makes no AWS call, so it
reads no parameter).

Sentry project settings the owner turns on: the server-side Data Scrubber,
"Prevent Storing of IP Addresses", spike protection, and Allowed Domains set to
the console origin.

The console has an enforced Content-Security-Policy (R29 HARDEN), set by its
CloudFront response headers policy from
`infra/modules/edge/security_headers.json` (`infra/RUNBOOK.md` §16). Its
`connect-src` names the DSN's ingest origin
(`https://o4511427425599488.ingest.us.sentry.io`): a DSN from another Sentry
organisation needs that entry changed first, or every report is blocked. The
Playwright smoke serves the build with the same headers
(`scripts/serve-with-headers.mjs`) and `tests/e2e/cspGuard.ts` fails any test
whose page reports a CSP violation, so a dependency that would load a script,
style, font or host the policy does not allow fails CI first.

### Pruning old assets

Because nothing is deleted on deploy, `assets/` grows over time and must be
pruned by hand. Delete only keys under `assets/` whose `LastModified` is **older
than 7 days** *and* that are **not** in the current build's `dist/assets/`.
`aws s3 sync` only re-uploads files whose size or timestamp changed, so an
unchanged chunk keeps its original `LastModified` while the live `index.html`
still references it — age alone is not enough, or the prune would delete a live
file.

The read-first procedure (fill in the ISO date for 7 days ago):

```sh
# 1. List candidate keys: everything under assets/ older than 7 days.
aws s3api list-objects-v2 --bucket "$CONSOLE_BUCKET" --prefix assets/ \
  --query "Contents[?LastModified<='2026-09-20T00:00:00Z'].Key" --output text \
  | tr '\t' '\n' > /tmp/prune-candidates.txt

# 2. Remove from that list every name present in the build that is live now.
for f in $(ls dist/assets); do
  grep -v -- "$f" /tmp/prune-candidates.txt > /tmp/prune-keep.txt \
    && mv /tmp/prune-keep.txt /tmp/prune-candidates.txt
done

# 3. Review the remaining list, then delete each key by hand.
cat /tmp/prune-candidates.txt
while read -r key; do aws s3 rm "s3://$CONSOLE_BUCKET/$key"; done < /tmp/prune-candidates.txt
```

Run this by hand at most monthly, after a deploy, never from `deploy.sh`.
