# A02 — Privacy review of the anonymous funnel

Issue #639, round r24 wave s. Contract: R24-00 §3. Builds on A01 (#638).

## What changed (files)

| File | Change |
| --- | --- |
| `docs/privacy-anonymous-funnel-2026-10-02.md` | New privacy review covering the fields sent and stored, why there are no ids and no IP, the cohort method and its limits, the 400-day retention, the 30-day API Gateway access log with source IP, the kill switch, the Settings toggle and the production-only channel, the App Privacy mapping, and a privacy-policy paragraph ready to paste. |
| `frontend/tests/docsPaths.test.ts` | `infra` added to `TOP_LEVEL`, so `infra/…` citations in docs/ are now checked against the disk. No existing doc cited a missing infra path. A new `describe` for the review checks three things: the file exists; it cites `AnonFunnel.cs`, migration 043, `gateway.tf` and `api_logs.tf`; and it states Product Interaction, Analytics, Device ID, 400 days, 30 days and "not used for tracking". |

## Surface shipped

Documentation only. No code, route, schema or infra change.

## How it is tested

- Tests first: the new `describe` failed on the base with 3 failures, because the document did not exist.
- `cd frontend && npx vitest run tests/docsPaths.test.ts`: 8 passed.
- Every line range the review cites was checked by hand against the A01 code:
  - `VpcFunction.cs:73-84`: auth is not resolved on this route.
  - `VpcFunction.cs:91-102`: the dispatcher log line.
  - `AnonFunnel.cs:34`: the retention constant.
  - `AnonFunnel.cs:147-151`: the insert.
  - `UsageAnalytics.cs:118`: the retention call.
  - `gateway.tf:3-5`: the access log format.
  - `gateway.tf:192-195` and `gateway.tf:220-223`: the stage log settings.
  - `api_logs.tf:1-4`: 30-day retention.
  - `core_vpc.tf:1-4`: 90-day retention.

## Owner steps

1. In App Store Connect › App Privacy, check that Usage Data › Product Interaction lists **Analytics** as a purpose. If it does not, add it. No new data type is needed and Device ID is not declared (review §8).
2. Paste the paragraph from review §9 into the Notion privacy policy.
3. Turn on `features.anonFunnel.enabled` only after steps 1 and 2 are done, A01's migration 043 has run, and P01's gateway route is applied.

## Deferred / findings

- **`received_at` could link a batch to an IP.** An operator who holds both the access log and the database could match the precise `received_at` (all rows of one batch share it) to a gateway log line, and so to an IP, within the 30 days the access log keeps it. The review states this openly (§6). A later server change could remove the link by storing `received_at` at day precision, or by rounding it. That is outside A02's scope, which is docs only.
- **The mobile sender is not cited by path.** M01's module, and the Settings toggle, are built in parallel in wave m. So the review describes them from contract §3.4 and does not cite a path that does not exist yet. A `paths-not-on-disk` entry would turn false the moment M01 merges.
- The review's statements about mobile behaviour come from the contract: flag default false, toggle default on, production channel only, at most 50 queued events, no token sent. M01's notes should confirm them. If M01 differs, the review needs a follow-up edit.
