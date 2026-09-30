# Release scripts (iOS binary → App Store review, unattended)

Written 2026-09-20 for the 1.6.0 train (`docs/release-1.6-ship-runbook-2026-09-20.md`). Every script
has a dry-run mode and prints the evidence the runbook asks for (build id, submission id, ASC states).

| script | does | auth it uses |
|---|---|---|
| `ios-build.sh [profile]` | `eas build --platform ios --non-interactive --json --wait`; prints build id + artifact URL. For `production` it exits 5 (also under `DRY_RUN=1`) while `eas.json` `build.production.ios.env.SENTRY_ORG`/`SENTRY_PROJECT` is empty or still a `REPLACE_ME_*` placeholder | EAS login (`eas whoami`) + EAS-managed signing |
| `ios-submit.sh [profile]` | `eas submit --platform ios --latest --non-interactive --wait`; uploads the newest finished build to App Store Connect | the App Store Connect API key stored on EAS (`[Expo] EAS Submit`) |
| `asc-release.cjs` | with the local Apple session (`~/.app-store/auth`, refreshed by `eas credentials`): wait for processing, ensure the App Store version, set What's New, attach the build, set the release type (default `MANUAL` since 1.9.0; pass `--release-type AFTER_APPROVAL` to release on approval), and with `--submit` create + submit the review submission. Exits 4 with `BLOCKED <version> is <state>: <reason>` (plan mode included, before any mutation) when the editable, in-review or pending-release version is held by App Review | `@expo/apple-utils` from the global `eas-cli` install |
| `ascGuard.cjs` | pure checks `asc-release.cjs` runs on the editable, in-review and pending-release versions (`firstHeldVersion`; the edit read alone never returns `IN_REVIEW` or `PENDING_*_RELEASE`): `WAITING_FOR_REVIEW`, `IN_REVIEW` or `PENDING_DEVELOPER_RELEASE` in `appVersionState` or `appStoreState` refuses a rename or re-attach (exit 4) | — |
| `whats-new-1.6.0.txt` | the en-US What's New text `asc-release.cjs` pushes | — |
| `description-<v>.txt`, `review-notes-<v>.txt` | the en-US description (`--description`) and the App Review Information notes (`--review-notes`) | — |
| `ota.sh "<message>"` | `eas update --channel production --environment production`; first verifies every required `EXPO_PUBLIC_*` name exists in the EAS production environment (names only, never values), then publishes. `DRY_RUN=1` checks the names and prints the command without publishing | EAS login (`eas whoami`) |
| `ota.sh` runtime guard | exits 6 before any `eas` call when the runtime (`app.json` version) is below 1.9.0 but `package.json` depends on `@sentry/react-native` (that runtime has no RNSentry native module): publish runtime-1.8.0 OTAs from `release/1.8.x`, runtime-1.9.0 OTAs from `main` | — |
| `ota.sh` DSN name rule | for runtime ≥ 1.9.0 `EXPO_PUBLIC_SENTRY_DSN` joins the required names (missing ⇒ exit 3); a runtime-1.8.0 OTA does not need it | — |
| `ota.sh` source maps | after a successful publish prints one line `SENTRY_UPLOAD=<value>`: `ok` (`npx sentry-expo-upload-sourcemaps dist` succeeded), `failed` (stderr shows the re-run command; still exit 0, the update is live), `skipped-runtime` (runtime < 1.9.0), `skipped-no-project` (`SENTRY_ORG`/`SENTRY_PROJECT` empty or `REPLACE_ME_*`, checked before any token lookup), `skipped-no-token`. `DRY_RUN=1` prints `DRY: SENTRY_UPLOAD=ok-planned` or the skipped reason | `SENTRY_AUTH_TOKEN` from the environment, else the macOS Keychain item `developercards-sentry-auth-token` (only on a terminal or with `OTA_KEYCHAIN=1`; `OTA_KEYCHAIN=0` disables it); `SENTRY_TOKEN_SOURCE=env\|keychain` is printed, never the value |

Nothing here reads or prints a secret: EAS holds the signing assets and the ASC API key; the Apple session
cookie is read by `@expo/apple-utils` itself. If `asc-release.cjs` exits 3 the Apple session expired —
run `eas credentials --platform ios` once (password from Keychain + 2FA) and re-run.

Subscription metadata rule (App Review rejected 1.8.0 (22) on 2026-09-29 under Guideline 3.1.2(c)): every
description must link the Terms of Use (EULA) and the Privacy Policy, the review notes say where the paywall is,
and `tests/unit/storeSubscriptionMetadata.test.ts` checks both for every `description-*.txt` from 1.8.0 on.

Always publish OTAs through `ota.sh`; a bare `eas update` without `--environment production` ships empty `EXPO_PUBLIC_*` values.

Exit codes: `ota.sh` 0 ok · 2 usage / eas-cli missing or not logged in · 3 missing `EXPO_PUBLIC_*` name(s) · 6 runtime guard;
`ios-build.sh` 5 Sentry org/project placeholders; `asc-release.cjs` 0 ok · 1 error · 3 Apple session expired · 4 version held by App Review.

Typical run for 1.9.0 (23) (from `mobile/`, after the `REPLACE_ME_SENTRY_*` placeholders in `eas.json` are filled):

```bash
DRY_RUN=1 scripts/release/ios-build.sh production
scripts/release/ios-build.sh production
scripts/release/ios-submit.sh production
node scripts/release/asc-release.cjs --version 1.9.0 --build 23 --wait-build \
  --whats-new scripts/release/whats-new-1.9.0.txt --description scripts/release/description-1.9.0.txt \
  --keywords scripts/release/keywords-1.9.0.txt --promo scripts/release/promo-1.9.0.txt \
  --subtitle scripts/release/subtitle-1.9.0.txt --review-notes scripts/release/review-notes-1.9.0.txt
```

The last command is the plan (prints `releaseType=MANUAL`); the owner adds `--apply`, then `--submit`, and releases the
approved version by hand.

Add `DRY_RUN=1` (shell scripts) or omit `--apply` (node script) to see the plan without touching anything.
