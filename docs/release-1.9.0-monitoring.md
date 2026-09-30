# Release 1.9.0 (23) — monitoring, privacy and upgrade checklist

Written 2026-09-30 for the R19M wave (contract `M00-contracts.md` §5.6, §9, §10). It tells the owner what
ships in 1.9.0, what to declare in App Privacy, what to add to the privacy policy, how to run Sentry, and how
to test the upgrade on TestFlight. Names only: no DSN, token, org slug or email address appears here; values
are always `<…>` placeholders.

## 1. What ships

- **M01** — Mistake Book: a per-key merge that keeps (sums) counts when a signed-out book is adopted at sign-in, replay-safe adoption, and a clear "No mistakes due today" done state (label + hint). OTA-safe; also published to runtime 1.8.0 from `release/1.8.x`.
- **M02** — Sentry crash and performance reporting in the app (`@sentry/react-native` ~7.2.0, JS init): only on the `production` channel with a DSN, remote kill switch, PII scrubbing, `sendDefaultPii: false`, no replay/screenshots/profiling, DebugMenu status line and "Send test event".
- **M03** — `x-dc-trace-id` header on API calls from the active Sentry trace (only while Sentry is active), and API status/error code/request id as event tags, so a Sentry event can be matched to the core-vpc log line.
- **M04** — Release plumbing: `eas.json` Sentry env (store builds upload source maps, other profiles never), `ios-build.sh` placeholder guard (exit 5), `ota.sh` runtime guard (exit 6), DSN name rule and OTA source-map upload (`SENTRY_UPLOAD=`), `asc-release.cjs` App Review state guard (exit 4) and MANUAL release default, version 1.9.0 (23), store texts, CI `expo export`, this document.
- **M05** — Console (web) errors to Sentry with `@sentry/react` instead of the old beacon, with the same PII scrubbing; DSN read at deploy time.
- **M06** — Content Intelligence live scores ignore `review_stage = 'focus_practice'` events (server only, deploy first).

## 2. App Privacy answers

Update App Store Connect > App Privacy **before** submitting 1.9.0. Today's label says **"Data Not Collected"**
(recorded in `docs/gacha-acquisition-learning-loop-plan.md:430`), which was already inaccurate because the app
has accounts, sync and purchases. Declare:

**Diagnostics (new with Sentry in 1.9.0)** — each: *not linked to the user*, *not used for tracking*, purpose
**App Functionality**:

| Data type | What it is in DeveloperCards |
| --- | --- |
| Crash Data | JS error stack traces and error messages (scrubbed of emails, tokens, signed URL parameters) |
| Performance Data | screen-load and API call timings (20 % of sessions sampled), release health sessions |
| Other Diagnostic Data | device model, OS version, app version, OTA update id/channel, screen names, API status/error code/request id tags |

**Data already collected that the current label omits** — each: *linked to the user*, *not used for tracking*,
purpose **App Functionality**:

| Category | Data type | Why |
| --- | --- | --- |
| Contact Info | Email Address | account sign-in (Cognito) and password reset |
| Identifiers | User ID | the account id that cloud sync and purchases are keyed on |
| Purchases | Purchase History | the Premium subscription state (StoreKit / RevenueCat) |
| Usage Data | Product Interaction | study progress, reviews, wallet and Mistake Book synced to the account |

**Caveat (owner decision, not decided here):** the interim `/client-errors` sink that 1.6.1 and 1.8.0 still use
logs `userSubHash`, an **unsalted** SHA-256 prefix of the Cognito sub (`src_C/Vpc/Runtime/ClientErrors.cs:160`,
`HashSub` `:181-183`). An unsalted hash of a stable id can be re-identified by anyone holding the sub, so
"Other Diagnostic Data – not linked" is accurate **for the Sentry data only**. Either declare Other Diagnostic
Data as *linked* while 1.6.1/1.8.0 clients remain, or schedule the server change that salts or drops that hash
(not part of R19M). Active 1.9.0 builds send their errors to Sentry and no longer post to `/client-errors`.

## 3. Privacy policy paragraph

Add this to the Notion privacy policy (the page the app and the description link) before submitting:

> **Crash and performance diagnostics.** To find and fix problems, the DeveloperCards app (from version 1.9.0)
> and the DeveloperCards console send crash and performance diagnostics to Sentry, a service of
> **Functional Software, Inc.**, which processes them on our behalf as a data processor. The data is stored in
> the Sentry data region we chose when we set up our account (<US or EU>). A report contains: the error's stack
> trace and message, the device model and operating-system version, the app version, the over-the-air update
> id, the names of the screens involved, and performance timings of screen loads and network requests. A report
> does not contain your email address, your name or your account id; we have told Sentry not to store IP
> addresses, and email addresses, tokens and signed links are removed before a report leaves the device.
> Reports are kept for 30 days and then deleted. We can switch reporting off remotely at any time.

## 4. Sentry runbook

**Project settings** (once, per project `developercards-ios` and `developercards-console`, Developer plan):

- Security & Privacy: **Data Scrubber** on (with default scrubbers), **"Prevent Storing of IP Addresses"** on.
- Spike protection on (organization Settings > Spike Protection), so a crash loop cannot use up the monthly quota.

**Alert rules** (email to the owner):

1. Issue alert: "A new issue is created" → email. (When a new issue is created, i.e. a new crash signature.)
2. Issue alert: "The issue is seen more than 20 times in 1 hour" → email (an issue seen > 20 times in 1 h).
3. Release health: a crash-free sessions alert below 99 % for the latest release **if the plan offers metric
   alerts**; the free Developer plan may not, in which case check Releases > Release Health for 1.9.0 once a week.

**Kill switch.** Set `"features": { "sentry": { "enabled": false } }` (`features.sentry.enabled:false`) in
`recallsmith-config.json` (the GitHub remote config the app reads). It takes effect on the **next cold start**
(the value is read from the last-good cached config before init); an app that is already running and fetches
the new config **closes the Sentry client in the same launch**. Set it back to `true` to resume.

**Auth token.** One Sentry **organization auth token** limited to release and source-map upload. It is stored as
the EAS `production` environment variable `SENTRY_AUTH_TOKEN` (visibility **secret**) for EAS Build, and in the
owner's macOS Keychain (generic password service `developercards-sentry-auth-token`) for local OTAs, which
`ota.sh` reads when no token is exported. Never put it in `mobile/.env.local` (the checkout is iCloud-synced),
a shell profile, git or a note. Rotation and leak steps: `docs/runbooks/secrets-rotation.md` > "Sentry auth token".

**Placeholder fill (supervisor, once, M00 §9.2 #2).** `mobile/eas.json` ships `SENTRY_ORG: REPLACE_ME_SENTRY_ORG`
and `SENTRY_PROJECT: REPLACE_ME_SENTRY_PROJECT` in `build.production.ios.env`. `ios-build.sh` refuses a store
build (exit 5) and `ota.sh` reports `SENTRY_UPLOAD=skipped-no-project` until both are replaced with the real
org and project slugs in one commit on `main`. The DSN (`EXPO_PUBLIC_SENTRY_DSN`, plaintext) and the token are
EAS environment variables, never `eas.json` values.

**Source maps.** Store builds upload them from EAS Build (`SENTRY_ALLOW_FAILURE=true` turns an upload failure into
a warning, never a failed paid build); every other profile sets `SENTRY_DISABLE_AUTO_UPLOAD=true`. An OTA from
`ota.sh` uploads its own maps after publishing and prints `SENTRY_UPLOAD=ok|failed|skipped-runtime|skipped-no-project|skipped-no-token`;
on `failed` the update is live and stderr shows the re-run command
(`cd mobile && SENTRY_ORG=<org> SENTRY_PROJECT=<project> npx sentry-expo-upload-sourcemaps dist` with the token
exported from the Keychain).

**Dual-runtime OTA rule (M00 §9.4, binding once 1.9.0 ships).** JS hotfixes for runtime 1.8.0 are committed to
`release/1.8.x` and published from a `release/1.8.x` checkout; hotfixes for runtime 1.9.0 go to `main` and are
published from `main` (with source maps). A fix needed by both is cherry-picked both ways only if it imports
nothing Sentry-related. `ota.sh` enforces the dangerous half: a tree that depends on `@sentry/react-native` refuses
to publish for a runtime below 1.9.0 (exit 6), and runtime 1.9.0 requires `EXPO_PUBLIC_SENTRY_DSN` in the EAS
production environment (exit 3 when missing). Runtime 1.6.1 has no OTA branch; retiring it means raising
`minSupportedVersion` in the remote config, which hard-blocks those users (owner decision).

**Budget (M00 §10, Sentry free Developer plan).** 5k errors/month org-wide (expected well under 1k), 5M spans
(mobile traces sample rate 0.2, console 0.05), no Session Replay, no screenshots or view hierarchy, no profiling,
one user, 30-day lookback. Guards: at most 25 error events per app session, offline/timeout errors dropped,
spike protection, the kill switch. Upgrade to the Team plan (USD 26/month) only if errors exceed 5k/month or
metric alerts are wanted.

## 5. TestFlight upgrade matrix

Run on the one production build **1.9.0 (23)** after the placeholders and EAS variables are filled. For each row,
check that **study progress**, **wallet** (pulls/coins), **Mistake Book entries and their counts**, and the
**sign-in state** survive, and that expo-updates discards the runtime-1.8.0 OTA cleanly (no crash, no stale bundle).

| # | Start state | Action | Extra check |
| --- | --- | --- | --- |
| 1 | 1.8.0 (22) from the App Store, **without** the runtime-1.8.0 OTA | install 1.9.0 over it | first run of the signed-out Mistake Book adoption: counts are summed, not replaced |
| 2 | 1.8.0 (22) **with** the runtime-1.8.0 OTA applied | install 1.9.0 over it | the OTA is dropped; Settings shows 1.9.0 (23) |
| 3 | 1.6.1 | install 1.9.0 over it | progress and wallet migrate; sign-in kept |
| 4 | fresh install of 1.9.0, signed out | study, collect mistakes, then sign in | Mistake Book entries and counts kept after sign-in; "No mistakes due today" once all are answered today |

Then, on any of these devices: Settings > tap the version label 7 times > DebugMenu shows **`Sentry: active`**;
**Send test event** shows `Sent: <id>`, and the event arrives in Sentry symbolicated (readable file/line) with
tags `ota.update_id=embedded` and `ota.channel=production`. One API call's `x-dc-trace-id` appears as
`upstreamTraceId` in the core-vpc logs. Finally, `node mobile/scripts/release/asc-release.cjs --version 1.9.0 --build 23 …`
(plan mode) prints `releaseType=MANUAL`.

<!-- paths-not-on-disk
     Named above only to say the Sentry token must never be stored there; it deliberately does not exist
     (rule: frontend/tests/docsPaths.test.ts).
- mobile/.env.local
-->
