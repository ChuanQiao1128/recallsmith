# M04 notes — release plumbing for 1.9.0 (`release-plumbing-190`, issue #537)

Base: `delivery/r19m-m` with M01–M03 merged. No `eas`, App Store Connect, Sentry, real `ota.sh`/`ios-build.sh`
or `asc-release.cjs` run was made; the scripts ran only inside vitest under fake `eas`/`npx`/`security`.

## Changes (file:line on this branch)

1. `mobile/eas.json` — `SENTRY_DISABLE_AUTO_UPLOAD: "true"` in `development` `:19`, `development-simulator` `:36`,
   `staging` `:51`, `staging-internal-release` `:66`; `production` `:81-83` adds `SENTRY_ALLOW_FAILURE`,
   `SENTRY_ORG: REPLACE_ME_SENTRY_ORG`, `SENTRY_PROJECT: REPLACE_ME_SENTRY_PROJECT`; `release-simulator` gets an
   explicit `ios.env` `:93-98`. Every `"image": "latest"` kept (`:14,31,46,61,76`). No DSN/token key.
2. `mobile/scripts/release/ios-build.sh:11-22` — placeholder guard after the version echo, before the first
   `eas` call: `PROFILE=production` and an empty or `REPLACE_ME_*` org/project ⇒ stderr
   `ios-build: fill SENTRY_ORG/SENTRY_PROJECT in eas.json (production) before a store build`, `exit 5` (also under
   `DRY_RUN=1`). Other profiles are not checked.
3. `mobile/scripts/release/ota.sh`
   - header `:4-17`: dual-runtime rule, the upload, the token rule, the exit codes;
   - `:25` `GE190` (numeric major/minor/patch via `node`);
   - `:26-29` runtime guard before any `eas` call (exit 6);
   - `:30` `EXPO_PUBLIC_SENTRY_DSN` appended to `REQUIRED_NAMES` only when `GE190`;
   - `:34` the "Names only" rule and comment kept;
   - `:48-65` `sentry_prepare`: runtime → org/project (env, else `eas.json` `build.production.ios.env`) →
     token (env, else Keychain `security find-generic-password -s developercards-sentry-auth-token -w`, only when
     `OTA_KEYCHAIN` ≠ `0` and (`[ -t 0 ]` or `OTA_KEYCHAIN=1`); service overridable by `OTA_KEYCHAIN_SERVICE`),
     inside a `set +x` region; prints only `SENTRY_TOKEN_SOURCE=env|keychain`;
   - `:67-79` `DRY_RUN=1`: the existing `DRY: eas update …` line, then (runtime ≥ 1.9.0)
     `DRY: SENTRY_UPLOAD=<ok-planned|skipped-no-project|skipped-no-token>` and, when planned,
     `DRY: npx sentry-expo-upload-sourcemaps dist`; no publish, no `npx`;
   - `:80` the unchanged `eas update` command; `:83-94` upload in a `set +x` region with `SENTRY_ORG`,
     `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` exported to the one `npx sentry-expo-upload-sourcemaps dist` child
     (its stdout goes to stderr so stdout stays machine-readable); failure prints a re-run hint on stderr.
4. `mobile/scripts/release/ascGuard.cjs` (new, pure) — `BLOCKED_EDIT_STATES`, `checkEditableVersion(attrs, target)`
   returns `{ ok: true }` or `{ ok: false, state, reason }` (`state` is an extra field used for the BLOCKED line).
   `mobile/scripts/release/asc-release.cjs` — header `:5` "set the release type"; usage `:13`
   `[--release-type MANUAL|AFTER_APPROVAL]`; exit-code comment `:20` gains `4 version held by App Review`;
   `:24` requires `./ascGuard.cjs`; `:28` (was `:27`) default `releaseType: 'MANUAL'`, nothing else on that line;
   `:93-97` the guard right after the `VERSION(edit)` log and before `const plan = [];`.
5. `mobile/app.json:7` `1.9.0`, `:39` buildNumber `"23"` (the M02 plugin moved the brief's `:33` down);
   `mobile/package.json:4` `1.9.0`; `mobile/package-lock.json:3,9` `1.9.0` (hand-edited, nothing else moved).
6. Store texts `mobile/scripts/release/*-1.9.0.txt`: `whats-new` (new, 4 bullets), `description` (identical copy
   of 1.8.0), `keywords`/`promo`/`subtitle` (identical copies), `review-notes` (first line mentions 1.9.0, lines 2+
   verbatim, plus a Sentry/kill-switch paragraph). `README.md` gains the ascGuard, runtime guard, DSN name,
   `SENTRY_UPLOAD`, exit 5/4 rows, an exit-code summary and the 1.9.0 (23) typical run (plan mode only).
7. `.github/workflows/ci.yml:9` job name `mobile (typecheck + vitest + expo export)`; `:37-39` comment +
   `- run: npx expo export --platform ios --output-dir dist-ci` after `npx vitest run`. `mobile/.gitignore` + `dist-ci/`.
8. `docs/release-1.9.0-monitoring.md` (new, five headings as required).
9. `docs/runbooks/secrets-rotation.md` — inventory row `:28` and section `## Sentry auth token` at the end (additions only).
10. Tests: `otaReleaseScript.test.ts` (`ALL_NAMES` `:16` + new `describe` `:192-…` with 13 cases),
    `storeSubscriptionMetadata.test.ts` (new `describe` `:58-…` with the two named cases), new
    `ascReleaseGuard.test.ts`, `releasePlumbing190.test.ts`, `whatsNew190.test.ts`.

## `SENTRY_UPLOAD` states (ota.sh stdout)

`ok` · `failed` (exit still 0) · `skipped-runtime` (runtime < 1.9.0) · `skipped-no-project` (org/project empty or
`REPLACE_ME_*`, decided before any token lookup) · `skipped-no-token`. Under `DRY_RUN=1`: `DRY: SENTRY_UPLOAD=`
`ok-planned` | `skipped-no-project` | `skipped-no-token` (nothing printed for runtime < 1.9.0).

## Exit codes

- `ota.sh`: 0 ok (also on a failed upload) · 2 usage / eas-cli missing or not logged in · 3 missing `EXPO_PUBLIC_*` name(s) (incl. `EXPO_PUBLIC_SENTRY_DSN` for runtime ≥ 1.9.0) · 6 runtime guard.
- `ios-build.sh`: 5 Sentry org/project placeholders (production profile), otherwise unchanged (1, 2).
- `asc-release.cjs`: 0 ok · 1 error · 3 Apple session expired · 4 version held by App Review (`BLOCKED <version> is <state>: <reason>`).

## Local proof

`bash -n` ota.sh/ios-build.sh OK; `node --check` asc-release.cjs/ascGuard.cjs OK;
`EXPO_OFFLINE=1 npx expo export --platform ios --source-maps --output-dir <scratch>` OK, the `.hbc.map` contains
`"debugId"` (output not committed).

## Supervisor follow-up

- The three pre-existing `otaReleaseScript.test.ts` cases run the **real** `scripts/release/ota.sh` against the real
  tree with an inherited environment and only a fake `eas` (no fake `npx`). Today they end in
  `SENTRY_UPLOAD=skipped-no-project` because `eas.json` holds placeholders. Once `eas.json` holds the real
  org/project, a shell that exports `SENTRY_AUTH_TOKEN` would let them reach the real
  `npx sentry-expo-upload-sourcemaps dist`. The verify unsets the three `SENTRY_*` names; the Keychain path is not
  reachable from vitest (stdin is not a TTY and `OTA_KEYCHAIN` is not set unless inherited). A later issue may add a
  fake `npx` to `runOta` (needs an M00 §2.2 exception) — or export `OTA_KEYCHAIN=0` there.
- `ios-build.sh` exits 5 until the placeholders are filled (M00 §9.2 #2); the EAS image is still `latest` (§9.2 #4).
