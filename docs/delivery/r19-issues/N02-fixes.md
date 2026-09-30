# N02 — 1.9.0 release plumbing + docs fixes (issue #551)

Fix round R19N wave M for the R19M review (`r19m-review.json`: 0 blockers, 0 majors, 11 minors in scope here).
Base `delivery/r19n-m` (N01 #550 merged). Nothing here touches the 1.9.0 binary: no change to
`mobile/package.json`, `package-lock.json`, `app.json`, `eas.json`, `mobile/ios`, `mobile/android` or the frozen
files. Every test runs the release scripts only from vitest with fake `eas` / `npx` / `security` first on PATH.

Contract (M00) changes: one **new** exit code, `ios-build.sh` exit 3 (production is missing
`EXPO_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` in the EAS production environment), required by R19M-REL-3.
Existing exit codes, module paths, exported names, env keys and flag keys are unchanged; `ascGuard.cjs` gains
one export (`firstHeldVersion`) and keeps `BLOCKED_EDIT_STATES` / `checkEditableVersion` as they were.

### R19M-REL-1

Status: fixed

- `mobile/tests/unit/otaReleaseScript.test.ts:30-64` `makeFakeEasDir` now also writes fake `npx` and `security`
  (probe line first, log argv to `npx.log` / `security.log`, exit 0), and the fake `eas` logs its argv and keeps
  its stderr in files.
- `:67-74` new `isolatedEnv()` drops every `SENTRY_*`, `OTA_KEYCHAIN*`, `EXPO_PUBLIC_SENTRY_DSN` and `DRY_RUN`
  from the spawned env and sets `OTA_KEYCHAIN=0`; `runOta` (`:88-110`) uses it. The three legacy `it` bodies only
  gained the diagnostic message argument (R19M-REL-7); their assertions are unchanged.
- Tests: `ota.sh > a token and OTA_KEYCHAIN=1 in the shell reach neither npx nor security (DRY_RUN=false|true)`
  (sets `SENTRY_AUTH_TOKEN=fake-sentry-token-not-real` and `OTA_KEYCHAIN=1` in `process.env`, then asserts
  `SENTRY_UPLOAD=skipped-no-token`, empty npx and security logs, no token in the output) and
  `ota.sh > puts fake npx and security first on PATH for the legacy cases`.
- Fail-before evidence: the old helper could not be run with a token, because that would reach the real npx
  upload. Instead, with the fakes in place and the env scrub removed (`...process.env` in place of
  `...isolatedEnv()`), both new cases fail and the diagnostic shows `npx log: sentry-expo-upload-sourcemaps dist`
  — exactly the call the old helper sent to the real npx.

### R19M-REL-2

Status: fixed

- Verified in the installed global eas-cli build of `@expo/apple-utils`
  (`/opt/homebrew/lib/node_modules/eas-cli/node_modules/@expo/apple-utils/build/index.js`): `getInReviewAppStoreVersionAsync`
  (appStoreState `IN_REVIEW`) and `getPendingReleaseAppStoreVersionAsync` (`PENDING_APPLE_RELEASE`,
  `PENDING_DEVELOPER_RELEASE`) exist with the same `{ platform }` signature as `getEditAppStoreVersionAsync`.
- `mobile/scripts/release/ascGuard.cjs:27-39` new pure `firstHeldVersion(versions, target)`: runs
  `checkEditableVersion` on every non-null version attributes object and returns the first refusal plus its
  `versionString`.
- `mobile/scripts/release/asc-release.cjs:93-101` also reads the in-review and pending-release versions and
  runs `firstHeldVersion([version, inReview, pending]…)` before the plan; a refusal prints
  `BLOCKED <versionString> is <state>: <reason>` and exits 4 (the BLOCKED line now names the held version, which
  may be 1.8.0 while no editable version exists). `mobile/scripts/release/README.md:10-11` updated.
- Tests (`mobile/tests/unit/ascReleaseGuard.test.ts`): `ascGuard.firstHeldVersion > …` (6 cases: all null,
  1.8.0 IN_REVIEW with no edit version, 1.8.0 PENDING_DEVELOPER_RELEASE, editable 1.9.0 plus 1.8.0 in review,
  editable PREPARE_FOR_SUBMISSION alone, agreement with `checkEditableVersion`) and
  `asc-release.cjs (source text only) > also reads the in-review and pending-release versions and guards them before building the plan`.
- Updated existing assertion: `prints BLOCKED and exits 4 after reading the editable version and before building
  the plan` now locates the guard call by `firstHeldVersion(` instead of `checkEditableVersion(`, because the
  finding makes a direct single-version call wrong; the ordering assertions are unchanged.
- Note: `PENDING_APPLE_RELEASE` is not in `BLOCKED_EDIT_STATES` (contract list of three states, unchanged), so a
  version in that short automatic-release state still passes.

### R19M-REL-3

Status: fixed

- `mobile/scripts/release/ios-build.sh:26-40`: for `PROFILE=production` (also under `DRY_RUN=1`), after
  `eas whoami`, runs `eas env:list --environment production --format short --non-interactive` with stderr
  discarded, strips ANSI codes, keeps only the name before the first `=` on each line (so a name inside a value
  never counts; ota.sh's `EXPO_PUBLIC_*`-only grep would never match `SENTRY_AUTH_TOKEN`, as the verifier noted),
  and requires `EXPO_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN`. Missing names exit 3 with
  `ios-build: missing name(s) in the EAS production environment: <names> (eas env:create --environment production)`;
  no value is ever printed. Header exit-code list `:4-6` and `mobile/scripts/release/README.md:8,30` updated.
- eas-cli prints `chalk.bold(name)=value` for `--format short` and lists secret variables by name with a masked
  value (`build/commands/env/list.js`, `build/utils/variableUtils.js`), so the secret token name is visible.
- Tests (`mobile/tests/unit/releasePlumbing190.test.ts`, `ios-build.sh EAS production env names`): `exits 3
  naming EXPO_PUBLIC_SENTRY_DSN|SENTRY_AUTH_TOKEN when it is missing …`, `lists both names when neither is set`,
  `a name that only appears inside a value does not count`, `passes with both names present and never prints
  values`, `reads names printed in bold (ANSI codes) and still never prints values`, `a non-production profile
  does not read the production environment`.
- The `runIosBuild` helper's fake `eas` now answers `env:list` (default: both Sentry names present), so the
  existing `passes the guard with example-org/example-project and prints the DRY command` keeps its assertions.

### R19M-REL-4

Status: fixed

- `mobile/tests/unit/releasePlumbing190.test.ts:20-31` new `imagePolicyViolations`: production may be `latest` or
  a non-empty, trimmed pinned image name; every other profile stays `latest`.
- Updated existing assertion (the finding makes the old rule wrong, since M00 §9.2 #4 pins production):
  `keeps every EAS image at latest` became `keeps every non-production EAS image at latest; production is latest
  or a pinned image name` (still requires 5 images). New `accepts a pinned production image and refuses a pinned
  non-production or empty production image` proves a pinned production fixture passes (it failed the old
  `toBe('latest')` rule) while a pinned staging image or an empty production image is refused.
- The pin itself stays with the supervisor before the build (not in this round).

### R19M-REL-7

Status: fixed

- The probe stays. `mobile/tests/setup/execProbe.ts:3-8` comment corrected: ETXTBSY cannot explain the exit-3
  flake (ota.sh execs the same fake for `whoami` first and would exit 2; nothing reopens a fake for writing), the
  cause is still unknown.
- Diagnostics: every ota.sh / ios-build.sh status assertion now passes a message (`expect(status, diag)`) holding
  the status/signal/spawn error, stdout, stderr, and the fakes' argv and stderr logs
  (`otaReleaseScript.test.ts:79-86` `diagnose`, used by `runOta` and `runOtaTree`; `releasePlumbing190.test.ts`
  `runIosBuild` `diag`). The fake `eas` no longer loses its stderr: it starts with `exec 2>> eas.stderr.log`
  (ota.sh's own `2>/dev/null` stays, so real eas output is never shown), and its argv log shows whether
  `env:list` ran at all. No assertion was weakened.
- Evidence the message works: the REL-1 fail-before run above printed the npx log inside the assertion failure.
- Not claimed: a green run is not proof the flake is gone; the next occurrence will now show its cause.

### R19M-TRACE-1

Status: fixed

- `docs/release-1.9.0-monitoring.md:46-55` caveat rewritten: any 1.9.0 build with Sentry inactive (kill switch
  cached or flipped in the same launch, missing DSN, init failure, the window before init settles) falls back to
  `/client-errors`, which logs the unsalted `userSubHash`; "not linked" is tied to the server change that salts or
  drops the hash, not to retiring 1.6.1/1.8.0. `HashSub` range corrected to `:181-185`.

### R19M-TRACE-2

Status: fixed

- `docs/release-1.9.0-monitoring.md:29` now "20 % of screen-load/app-start traces sampled; release-health
  sessions for every launch".
- `:40` now "study progress, reviews (including Mistake Book focus-practice events) and wallet synced to the
  account"; `:42-44` adds that the Mistake Book itself stays on the device.

### R19M-TRACE-3

Status: fixed

- `docs/release-1.9.0-monitoring.md:73-74` names project `developercards-mobile` (and `developercards-console`);
  `developercards-ios` no longer appears.
- `:112-118` "Placeholder fill" marked done in 9c3dd9d; the exit-5 / `skipped-no-project` behaviour is described
  as a regression guard. `:144` (TestFlight matrix) no longer says "after the placeholders … are filled".
- `mobile/scripts/release/README.md:32` stale "after the `REPLACE_ME_SENTRY_*` placeholders … are filled" replaced.

### R19M-REL-5

Status: fixed

- Same edits as R19M-TRACE-3 (duplicate finding): `docs/release-1.9.0-monitoring.md:73-74` project name,
  `:112-118` placeholder paragraph marked done in 9c3dd9d, and the old ":117 after the placeholders" sentence
  (now `:144`) rewritten to require the EAS production variables instead.

### R19M-TRACE-4

Status: fixed

- Doc-only, as the verifier concluded (three of the four raw fetches have no callers; the live one never raises a
  Sentry event). `docs/release-1.9.0-monitoring.md:12` now says the header and `api.*` tags cover sync API calls
  (`apiJson`) and that premium/entitlement calls use plain `fetch` without them; `:159` says "one sync API call's
  (`apiJson`)". No code change (routing those callers through `apiJson` is outside this round's allowed paths).

### M02-R2

Status: fixed

- Doc-only, per the direction (no app code change; the native SDK options stay as they are).
  `docs/release-1.9.0-monitoring.md:73-92`: org-level Security & Privacy settings listed (Require Data Scrubber,
  Require Default Scrubbers, Prevent Storing of IP Addresses, Global Sensitive Fields), the supervisor's
  project-level Advanced Data Scrubbing rules on `developercards-mobile` (mask email addresses in any string;
  remove breadcrumb `http.query` / `http.fragment`), and a "Native-origin events" paragraph: native crashes,
  watchdog terminations and app hangs skip the JS scrubbers, the 25-per-session cap and the offline/timeout drop;
  server-side scrubbing plus spike protection cover them.
- `:135-139` Budget: the cap is "25 JS error events per app session"; spike protection is the only volume guard
  for native events.
