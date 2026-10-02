# Privacy review — anonymous install funnel (2026-10-02)

Round r24, issue A02 (#639). Contract: R24-00 §3. This reviews the server A01 shipped
(`src_C/Vpc/Analytics/AnonFunnel.cs`, `src_C/Vpc/Db/Migrations/043_anon_funnel_events.sql`) and the mobile
sender M01 builds to the same contract (§3.4). The owner reads it before turning on the remote flag
`features.anonFunnel.enabled`, and checks the App Privacy answers and the privacy policy against §5 and §8.

Summary: the funnel stores **no identifier of any kind**. A stored row says "some install, whose first open was on
day C, reached step E on day D", plus the platform and app version. It fits the App Privacy answers the owner
already gives for 1.9.0 (`docs/release-1.9.0-monitoring.md` §2) and needs no Device ID declaration. The one
place an IP address is recorded is the API Gateway access log, which records it for **every** route, this one
included, for 30 days (§6).

## 1. Exactly what is sent

One request is `POST /api/v1/public/events` with a JSON body of at most 8192 bytes:

```json
{ "platform": "ios", "appVersion": "1.9.0",
  "events": [ { "event": "goal_chosen", "cohortDay": "2026-10-01", "eventDay": "2026-10-02", "deckSlug": "aws-saa-c03" } ] }
```

| Field | Values | Notes |
| --- | --- | --- |
| `platform` | `ios` or `android` | batch field |
| `appVersion` | `^\d+\.\d+\.\d+$`, at most 20 characters | batch field, the store version, not the OTA update id |
| `events` | an array of at most 20 events | |
| `event` | `first_open`, `goal_chosen`, `starter_started`, `starter_completed`, `first_pack_opened`, `returned_day_1`, `returned_day_7`, `signup_started`, `signup_completed` | each sent at most once per install (local flags) |
| `cohortDay` | `YYYY-MM-DD`, the local date of the install's first open | a calendar day, no time |
| `eventDay` | `YYYY-MM-DD`, the local date the step happened | a calendar day, no time |
| `deckSlug` | null, `aws-saa-c03`, `claude-ccdv-f` or `csharp-basics` | only meaningful on goal/starter/first-pack steps |

Nothing else is in the body: no user id, account id, email, device id, install id, advertising id, vendor id,
push token, locale, time zone, free text or card content. The request carries **no Authorization header** (§3.4:
the app's API client sends no token for this call). If one is sent anyway, the server never reads it: the
dispatcher does not resolve auth for this path (`src_C/Vpc/VpcFunction.cs:73-84`) and the handler takes no auth
context (`src_C/Vpc/Analytics/AnonFunnel.cs:87-91`), so a signed-in caller is never linked to the events, and no
`users` row is created.

What the transport itself carries (not in the body, not stored by the funnel): the source IP address and the
`User-Agent` header, which API Gateway puts in its access log (§6).

## 2. Exactly what is stored

Table `anon_funnel_events` (`src_C/Vpc/Db/Migrations/043_anon_funnel_events.sql`), one row per accepted event:

| Column | Source |
| --- | --- |
| `id` | bigserial, a row counter; it identifies a row, not an install |
| `event` | `event`, checked against the nine names |
| `cohort_day` | `cohortDay` |
| `event_day` | `eventDay` |
| `deck_slug` | `deckSlug` (null when absent) |
| `platform` | `platform` |
| `app_version` | `appVersion` |
| `received_at` | server time of the insert (`now()`), the clock of the retention delete |

The insert (`src_C/Vpc/Analytics/AnonFunnel.cs:147-151`) writes only those columns. Invalid events are dropped
and only counted (`rejected` in the response). The body is never logged; the handler's only log lines are the
budget warning (no request data) and the retention outcome (a row count). The core-vpc dispatcher line for the
request holds the trace id, method, path and a null user (`src_C/Vpc/VpcFunction.cs:91-102`) — no IP, no body —
and is kept 90 days like every other core-vpc line (`infra/modules/api/core_vpc.tf:1-4`).

## 3. Why there is no user, device or install id, and no IP

- **The question does not need one.** The funnel answers "of the installs that first opened in week W, how many
  reached each step?". That is a count per (cohort, step). An id would only add the ability to follow one
  person, which is a non-goal (R24-00 §8: no per-user funnel paths, no IDFA/ATT, no device id).
- **An install id is still an identifier.** A random per-install UUID is a stable, unique id for a device's app
  install; Apple's App Privacy definitions treat it as "Device ID" (or "User ID" if tied to an account), which
  would change the label and invite linking it to the account later. Leaving it out keeps the data unlinkable by
  construction, not by policy.
- **"At most once per install" replaces de-duplication.** The app keeps local flags (`sent`), so each install
  contributes at most one row per step. The server does not need to recognise repeat senders.
- **No IP in the table.** The handler never reads the source IP and the table has no column for it. Rate
  limiting is a per-container request budget (120 requests per 60 s), not per IP, so there is no IP-keyed state
  either. The gateway's own access log is the only exception and is covered in §6.
- **Days, not timestamps, from the app.** `cohortDay` and `eventDay` are calendar dates, so the app sends no
  time of day.

## 4. How funnels are computed, and what that cannot answer

The admin read (`GET /api/v1/admin/analytics/funnel?days=90`, admin only) groups rows by ISO week of
`cohort_day` (Monday) and counts each event; the conversion of a step is its count divided by the `first_open`
count of the same cohort, rounded to 4 decimals (null when there is no `first_open`). It also counts the
goal/starter/first-pack steps by `deck_slug`.

Because every install sends each step at most once and stamps it with its own cohort day, "count of step E in
cohort W" / "count of `first_open` in cohort W" estimates the share of that week's installs that reached E.

What it **cannot** answer, by design:

- **Per-person paths.** It cannot say whether the installs that completed the starter are the same ones that
  chose a goal, or in which order one install did things. Step counts can even exceed an earlier step's count
  (an install that skipped a step, or a lost `first_open`).
- **Time between steps for one install.** Only per-step `event_day` distributions are available, not the delay
  of any single install.
- **Who** anything is: the funnel cannot be joined to accounts, purchases, reviews or Sentry data.
- **Exact install numbers.** Uninstall/reinstall starts a new cohort; installs that never reach the network, or
  that turned the toggle off, or ran with the flag off, are missing; test installs cannot be excluded on the
  server (M01 sends only from the production channel).
- **Cause.** A drop between two steps says where installs stop, not why.

## 5. Retention

Rows are deleted 400 days after `received_at` (`src_C/Vpc/Analytics/AnonFunnel.cs:34`) by the daily
`analytics_daily` automation step, which runs the delete after a computed daily rollup
(`src_C/Vpc/Analytics/UsageAnalytics.cs:118`). 400 days keeps a full year of weekly cohorts plus their
`returned_day_7` step for year-on-year comparison. The ingest also rejects days outside [today − 400, today + 1],
so nothing older than the retention window can be written.

## 6. API Gateway access logs record the source IP for every route

The HTTP API's access-log format includes `"ip":"$context.identity.sourceIp"` and the `userAgent`
(`infra/modules/api/gateway.tf:3-5`), and both stages (`$default` and `dev`) write it
(`infra/modules/api/gateway.tf:192-195`, `infra/modules/api/gateway.tf:220-223`). The log group keeps it for
30 days (`infra/modules/observability/api_logs.tf:1-4`). This applies to **every route**, the funnel ingest
included; it is not new with the funnel and it is not something the funnel can switch off for one route.

What this means for the funnel:

- A gateway line holds IP, request time, route, status and user agent — **not** the body, so it does not say
  which events were sent.
- An operator with access to both the access log and the database could, within those 30 days, line up a
  request's time with the `received_at` of the rows it inserted (all rows of one batch share one `received_at`).
  That would tie an IP address to the handful of steps in one batch. It needs deliberate effort and AWS access;
  no code does it, and nothing in the console exposes `received_at`.
- After 30 days the access log line is gone and the rows can no longer be tied to an IP by any means.

The privacy policy paragraph (§8) states this plainly rather than claiming "we never see your IP".

## 7. Turning it off

- **Remote kill switch.** `features.anonFunnel.enabled` in the remote config the app reads
  (`mobile/src/config/remoteConfig.ts`). It defaults to **false in code**: nothing is sent until the owner sets it
  to `true`, and setting it back to `false` stops sending. Queued events stay on the device (at most 50) and are
  not sent while the flag is off.
- **Settings toggle.** Settings › Privacy › "Share anonymous usage counts", on by default. Turning it off stops
  all sending from that install. Because nothing identifies the install, data already sent cannot be found or
  deleted per person; it ages out after 400 days (§5).
- **Production channel only.** Like Sentry (`mobile/src/telemetry/sentryPolicy.ts:31`), the app sends only from
  the `production` update channel, so development and preview builds never write rows.
- **Server side.** Until migration 043 runs the ingest answers `503 NOT_READY`; until the gateway route from P01
  is applied, the catch-all route requires a console token, so an anonymous call from the app is refused at the
  gateway.

## 8. App Privacy mapping

App Store Connect › App Privacy, as already declared for 1.9.0 (`docs/release-1.9.0-monitoring.md` §2):

| Category › Data type | Linked to the user | Used for tracking | Purposes |
| --- | --- | --- | --- |
| Usage Data › Product Interaction | (as declared today) | No | App Functionality, **Analytics** |

- The funnel is **Usage Data › Product Interaction** (which app steps were reached), used for **Analytics**.
  It is not linked to the user and **not used for tracking**: no identifier is stored and nothing is shared with
  a third party, data broker or ad network.
- It is **covered by the current answers** as long as Product Interaction lists **Analytics** among its purposes.
  If today's entry lists only App Functionality, add Analytics there; no new data type is needed. The existing
  entry stays "linked" because of the synced study progress; the funnel does not change that.
- **No Device ID.** No device id, install id, IDFA or IDFV is collected, so "Identifiers › Device ID" is not
  declared for the funnel.
- **No tracking, no ATT prompt.** Nothing is combined with other companies' data or used for advertising.
- Diagnostics (Sentry) answers are unchanged.

## 9. Privacy-policy paragraph (ready to paste)

Add this to the Notion privacy policy page the app links to, before the remote flag is turned on:

> **Anonymous usage counts.** To learn which parts of first-time setup work, the DeveloperCards app can send a
> small set of anonymous usage counts: that the app was opened for the first time, that a study goal was chosen,
> that a starter set was started or finished, that a first card pack was opened, that the app was opened again
> one day and seven days after the first open, and that sign-up was started or finished. Each count carries only
> the date of the first open, the date of the step, the deck chosen (where it applies), the platform and the app
> version. It contains no account id, email address, device id, install id or advertising id, and it is never
> linked to your account, even when you are signed in, so we cannot tell which counts came from you. We keep
> these counts for 400 days and then delete them. Like every request to our servers, the request that carries
> them passes through Amazon Web Services' API Gateway, which records the sending IP address and the app's user-agent string in
> an access log that is deleted after 30 days; we do not store the IP address with the counts. The counts are
> not used for advertising or tracking and are not shared. You can turn them off at any time in the app under
> Settings › Privacy › "Share anonymous usage counts".
