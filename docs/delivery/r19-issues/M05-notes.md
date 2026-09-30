# M05 — Console errors to Sentry (issue #538) — worker notes

## Files

- `frontend/package.json:16` — one added dependency, `"@sentry/react": "^10.75.3"`; `frontend/package-lock.json` — the same `npm install` (107 added lines, `@sentry/*` entries only).
- `frontend/src/lib/sentry.ts` (new) — the gate and the sink. `CONSOLE_SENTRY_PENDING_MAX = 20` (`:45`), `loadConsoleSentry` (`:73`, the only place the SDK and the scrubbers are imported, both as destructured top-level `await import(...)`), the `init({...})` call (`:78`), `initConsoleSentry` (`:102`), `isConsoleSentryActive` (`:119`), `whenConsoleSentryReady` (`:124`), `captureConsoleError` (`:129`). `clip` moved here from `reportError.ts`.
- `frontend/src/lib/sentryScrub.ts` (new, no imports) — `scrubString` (`:34`, the four M00 §3.3 rows in order), `stripQuery` (`:43`), `scrubEvent` (`:82`), `scrubBreadcrumb` (`:105`).
- `frontend/src/lib/reportError.ts` — header rewritten; `endpoint()`, `buildId()`, `route()`, `clip()` and the beacon transport removed; `ErrorSource` (`:43`), `reportError` (`:53`, now `return captureConsoleError(...)`), `installErrorReporting` (`:69`, attaches nothing and returns one stable no-op while Sentry is active; otherwise the two listeners exactly as before).
- `frontend/src/main.tsx:10` import, `:19` `initConsoleSentry();` right before `installErrorReporting();` (`:20`); comment above updated. Nothing else changed.
- `frontend/scripts/resolve-sentry-dsn.sh` (new, 45 lines) — sourced by `deploy.sh`; no `exit`/`return`/`set -x`; every variable read as `${NAME:-}`; temp variables prefixed `__rsd_` and unset afterwards.
- `frontend/deploy.sh:9-10` usage comment lines, `:18-19` comment + `source scripts/resolve-sentry-dsn.sh` after `CONSOLE_URL=` and before `npm run build`. Additive only.
- `frontend/README.md:73` — new `### Error reporting (Sentry)` subsection inside `## Deployment`, before `### Pruning old assets`.
- Tests: `frontend/tests/consoleSentry.test.ts` (8), `frontend/tests/sentryScrub.test.ts` (10: the 9 binding titles plus `caps the copy at depth 10`), `frontend/tests/resolveSentryDsn.test.ts` (7), rewritten `frontend/tests/errorReporting.test.tsx` (9, M00 §2.2 #4).

## Dependency

- Installed `@sentry/react` **10.75.3** (`npm install @sentry/react@^10`, 2026-09-30).
- Lockfile packages added (all 10.75.3 except conventions): `@sentry/react`, `@sentry/browser`, `@sentry/browser-utils`, `@sentry/core`, `@sentry/conventions` (0.16.0), `@sentry/feedback`, `@sentry/replay`, `@sentry/replay-canvas`. No other package added, removed or re-versioned; no devDependency change; no `overrides`.
- `npm audit --omit=dev --audit-level=high`: `found 0 vulnerabilities`.

## Bundle budget

Measured with the same walk as `tests/bundleFirstLoad.test.ts` (entry + modulepreload + stylesheets + static-import closure; eager adds the `DeckListPage` prefetch), `NODE_ENV=production npx vite build`, no `VITE_SENTRY_DSN`:

| | before (base `6ce7d3e`) | after | budget |
|---|---|---|---|
| first-load closure | 370,862 B | 371,717 B (+855) | 377,000 B |
| eager closure (login page) | 482,045 B | 482,900 B (+855) | 484,000 B |

- Lazy SDK chunk (the only chunk containing `__SENTRY__`): **149,113 B** (verify cap 200,000 B). Lazy `sentryScrub` chunk: 1,546 B.
- No "but also statically imported" warning; `bundleFirstLoad.test.ts` unchanged and green.
- Eager headroom after M05: 1,100 B. Any further entry-side growth needs care.

## Behaviour without a DSN

- `initConsoleSentry()` reads `import.meta.env.VITE_SENTRY_DSN`, which is blank/undefined, returns `false` and never calls `loadConsoleSentry`, so neither dynamic import runs: the SDK chunk is never fetched. `captureConsoleError` returns `false` before touching anything; `installErrorReporting()` attaches the two listeners, which call a funnel that returns `false`.
- Proven by `consoleSentry.test.ts` "stays off with a blank DSN: no init, reportError false, no network" (DSN unset and `'   '`; zero calls on the SDK mock, a `fetch` stub, `XMLHttpRequest.prototype.send` and a `navigator.sendBeacon` stub) and by `errorReporting.test.tsx` "with no DSN nothing is sent from any entry point" (window error, rejection and a boundary render all produce zero SDK and zero transport calls).
- The DSN-less production build contains no `example.invalid`; a build with the test DSN does (checked by the verify).

## Follow-ups outside M05 scope

Stale text that still describes the removed beacon (not edited, outside the allowed paths):

- root `README.md:204-214` — the "one funnel … `navigator.sendBeacon` … `VITE_ERROR_REPORT_URL`" paragraph.
- `.github/workflows/ci.yml:89-97` — comment says `VITE_BUILD_ID` is attached to every report `reportError.ts` sends; it is now the Sentry release `console@<id>`.
- `frontend/.env.e2e:38-40` — comment on `VITE_ERROR_REPORT_URL`, which nothing reads any more.
- `frontend/README.md:28-53` — the `## Environment` table (above `## Deployment`) does not list `VITE_SENTRY_DSN` / `VITE_SENTRY_ENVIRONMENT`.

Supervisor / owner steps (M00 §9.2 #3):

- Create the SSM String parameter `/developercards/prod/console-sentry-dsn` (deploy region `ap-southeast-2`) holding the console project's DSN; then `DRY_RUN=1 frontend/deploy.sh` must print `VITE_SENTRY_DSN: set`.
- Sentry project settings: Allowed Domains = the console origin; Data Scrubber on; "Prevent Storing of IP Addresses"; spike protection.
- A future Content-Security-Policy needs `connect-src` to include the DSN's ingest origin.

## Interpretations of M00 §6

- **Lazy load** (brief Context → Bundle budget): `initConsoleSentry()` decides synchronously and returns `boolean`; `Sentry.init` runs when the chunk arrives. M00's "init inside try/catch (a throw ⇒ inactive)" is the `.catch` on the loader promise, which also covers a failed chunk load. Reports made while loading are queued (max 20) with their report-time route and flushed once after `init`.
- **Scrubber row 1** is written `/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi`, i.e. M00's literal without the `\/` inside the character class: `no-useless-escape` (an error in the frontend ESLint config) rejects the escaped form, and the two match exactly the same strings. Rows 2–4 are verbatim.
- **`release`** is added with a conditional spread (`...(id ? { release: \`console@${id}\` } : {})`) so the key is absent, not `undefined`, when `VITE_BUILD_ID` is blank.
- **URL fields** (`url`, `http.url`, `from`, `to` under breadcrumb data, span data and contexts, and `request.url`) go through `stripQuery` and then `scrubString`, so an email or token in a path segment is still redacted. Other strings go through `scrubString` only.
- **Depth cap**: objects and arrays nested 10 levels below the event become `'[depth]'`.
- **The active-path uninstall** is a stable no-op: calling it does not reset the module state, so a later `installErrorReporting()` still attaches nothing while Sentry owns the global handlers.
