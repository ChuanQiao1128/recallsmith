# Native app reliability and usability changes — 2026-10-22

Scope: REV-001 through REV-007 of the native App review, plus the earlier account/guest adoption, Home refresh, sign-in error and scheduler state repairs. No content translations are invented. Existing production runtime remains 2.1.0; no native dependencies change.

## Rating lifecycle

| State | Persisted meaning | Event | Result |
|---|---|---|---|
| Visible | Current answer stays on screen | Rate | Capture account and create scoped durable intent |
| Intent saved | Stable event ID/time and planned scheduler result exist | Queue write fails | Keep card, no reward or advance; retry same ID |
| Fact saved | Outbox acknowledged durable storage | Projection fails | Keep intent; same-screen or reopened retry reuses ID |
| Projected | Scoped fresh deck snapshot includes this card's scheduler result | Reward settlement | Existing idempotent ledgers apply; save outcome in intent |
| Complete | Journal can be removed | Advance | Update session UI once |

Illegal: acknowledge completion/reward before a durable event; write a component's stale full-deck snapshot; reuse an already projected old journal as a later real review. On reopen, a loaded projection at/after the journal's review retires that completed intent. Facts can be acknowledged and removed from the outbox independently, so the recovery intent has its own key. Existing reward ledger/wallet multi-key under-grant crash window is unchanged; this patch does not claim an atomic wallet transaction.

Every deck mutation/reconciliation uses a captured-account/deck serializer. Ratings calculate from durable progress; retries replace only their card and preserve a newer remote scheduler group. Sync caches every deck before advancing either cursor; a failed cache/projection retains the old cursor and surfaces an error. Pull diagnostics stay with the originating account. UI confirmation requires a successful pull at/after the latest push.

## UI

Library defaults to My cards, offers actual text/number/UID search, and remembers the status filter per account and deck. Topic/status names are distinct; secondary filters are behind More filters. Translation reads separate no translation from file failure and provide retry while English remains usable. Home keeps existing artwork at a smaller size; study headers allow two title lines and a stable language control.

## Release

Backend supports both schemas during rollout. Before migration048, stage-only legacy events remain supported and model-bearing batches return retryable503 without acknowledgment. Released2.1.0 clients can already include model fields, so their sync can also be deferred in this phase. Do not promote this backend until the administrator is ready to apply048 immediately; a safe error is not evidence of uninterrupted sync. Progress reads return null model for pre048 rows. Apply048 through the existing authenticated administrator migration process after a snapshot, confirm inventory first (do not implicitly approve destructive045), then verify pending count/schema and publish the mobile OTA through scripts/release/ota.sh with environment production. CI/CD deploys no database migrations.

Verification records are retained outside source under qa/developercards-system-qa-2026-10-21/releases/app-optimization-20261022/. Tests use local storage/API fault injection and isolated PostgreSQL, never deliberate production faults. Native visual package has writes blocked and is not production connectivity evidence. Production deployment/readback results must be recorded separately; code/test completion does not close historical real-device QA cases automatically.
