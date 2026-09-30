# N01 — 1.9.0 Sentry fixes (R19N, wave M)

Fix round for the R19M review findings M02-R1, M02-R3 and M02-R4. Every code fix was preceded by a test that
failed on the base tree (`delivery/r19n-m` @ a29652a: 13 failing cases before the fix, all green after).
No OTA-unsafe file, dependency or frozen file was touched.

Contract note (M00 §3.2, §3.4 #4, §9.3 #3): module paths, exported names, env keys, flag keys and exit codes are
unchanged. Three contract statements are refined by these findings and should be read as amended:
- §3.2 `no-dsn` now also covers a DSN that fails the shape check (not only an absent or blank one), and
  `init-failed` also covers "init returned but the client has no parsed DSN".
- §3.4 #4 keeps the `initialScope` tags literal exactly and additionally calls `Sentry.setTags` with the same tags.
- §3 `buildOtaTags` / §9.3 #3: `ota.update_id` is `embedded` whenever `isEmbeddedLaunch === true`.
The contract file itself lives outside the repository and outside this issue's allowed paths, so it was not edited.

### M02-R1

Status: fixed

- `mobile/src/telemetry/sentryPolicy.ts:26` adds `SENTRY_DSN_SHAPE` (`^https://[^@\s/]+@[^/\s]+/\d+$`);
  `decideSentry` (`sentryPolicy.ts:32`) returns `'no-dsn'` when the trimmed DSN fails it, so the interim
  `/client-errors` reporter stays in charge. A valid DSN with surrounding whitespace still passes (trimmed).
- `mobile/src/telemetry/observability.ts:174-192`: after `Sentry.init` returns, `!Sentry.getClient()?.getDsn()`
  (or a throwing `getClient`) is treated as `'init-failed'`: the client is closed best-effort, the interim handlers
  are installed, and `captureException` / `sendTestEvent` report inactive, so `clientErrorReporter` POSTs again.
- `mobile/tests/setup/sentry.ts`: the SDK stand-in gains `getClient` (default: a client with a parsed DSN) and `setTags`.
- Tests:
  - `tests/unit/sentryPolicy.test.ts` › decideSentry › `treats a malformed DSN (%s) as no-dsn (M02-R1)` (surrounding
    quotes, missing public key, missing project id, http scheme, space inside) and
    `accepts a valid DSN with whitespace around it after trim (M02-R1)`.
  - `tests/unit/observability.test.ts` › inactive reasons › `'init-failed': %s after init falls back to the interim
    handlers (M02-R1)` (no client, client without a parsed DSN, throwing getClient), and three new `no-dsn` rows in
    `%s: no init, interim installed exactly once` (quoted DSN, missing key, missing project id).

### M02-R3

Status: fixed

- `mobile/src/telemetry/observability.ts:138,155`: the OTA tags are built once (`otaTags`) and still passed as
  `initialScope: { tags: otaTags }` (contract literal kept).
- `mobile/src/telemetry/observability.ts:194-200`: after a successful init with a parsed DSN, `Sentry.setTags(otaTags)`
  writes the same tags through the isolation scope, which @sentry/react-native syncs to native, so native crash
  events carry `ota.*` and `app.env` as searchable tags. A throw there is swallowed and does not change the status.
- Tests: `tests/unit/observability.test.ts` › active path ›
  `also sets the OTA tags through setTags after init so native crash events carry them (M02-R3)` and
  `stays active when setTags throws after a successful init (M02-R3)`.

### M02-R4

Status: fixed

- `mobile/src/telemetry/sentryPolicy.ts:209-215`: `buildOtaTags` sets `ota.update_id` to `embedded` whenever
  `isEmbeddedLaunch === true` (expo-updates reports the embedded update's UUID as `updateId` on an embedded launch);
  otherwise the trimmed id, `embedded` for a null/blank id, `unknown` without an updates module. `ota.is_embedded`
  is unchanged.
- `docs/release-1.9.0-monitoring.md` §5: the TestFlight check now expects `ota.update_id=embedded`,
  `ota.is_embedded=true` and `ota.channel=production`, and says why.
- Existing assertions were not changed (the old fixtures still hold under the new rule); a new case was added.
- Test: `tests/unit/sentryPolicy.test.ts` › buildOtaTags ›
  `reports 'embedded' when the launch is embedded even though expo-updates gives the embedded update's UUID (M02-R4)`.

### Documentation (supervisor facts)

- `docs/release-1.9.0-monitoring.md` §4 records the project-level Advanced Data Scrubbing rules on
  `developercards-mobile` (mask email addresses in any string; remove breadcrumb `http.query` / `http.fragment`).
  No Sentry call was made.
