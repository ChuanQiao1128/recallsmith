# A04 — Auto-publish, the automation tick and email notifications: notes

Issue #409, wave `r18a-s`. Contract: A00 §0, §3, §4, §6, §8.1, §8.4 rows 6–10, §8.6, §12.2, §12.4–§12.6, §13, §14, §18,
§20. Builds on A01 (migration 034, `AutomationMode`, `AutomationEnv`, `Auth.VerifyInternalSignatureStrict`), A02
(`RunnerRoutes`, the `// R18A — automation` block) and A03 (`DraftDecisions`, `DraftQaResults`, `AutomationReasons`).

## What changed

| File | Change |
|---|---|
| `src_C/Vpc/Authoring/Publish.cs` | `PublishStart` record and `StartPublishAsync` (A00 §6.4); the console handler keeps auth, mode, queue config, body, permission and the preview, and maps the result back (`StartResponse`). The deck read / slug / cards / premium config moved into a private `LoadDeckAsync` shared by the preview and the publish path. |
| `src_C/Vpc/Qa/QaGate.cs` | `EvaluatePublishRefusalAsync` returns the refusal as data (`PublishRefusal`: status, code, message, chained run); `RefusalResponse` renders it. `EvaluatePublishAsync` keeps its signature and now calls the two. |
| `src_C/Vpc/Ledger/LedgerRoutes.cs` | `ComputeAsync(conn, from, to, granularity)` returns the object `HandleLedger` passed to `res.Ok`; `HandleLedger` keeps parsing/validation and wraps the call in the same `MapError`. The SQL and the object literals are unchanged (the body sits in a bare block to keep the diff to the moved lines). |
| `src_C/Vpc/Automation/AutomationRuns.cs` (new) | `TryFinalizeAsync` (A00 §6.1). |
| `src_C/Vpc/Automation/AutoPublisher.cs` (new) | `EvaluateAsync`, `ReevaluateAsync`, `ReconcileAsync`, pure `CheckPendingChangeSet` (A00 §6.2, §6.3, §6.5). |
| `src_C/Vpc/Automation/EmailTemplates.cs` (new) | Pure renderers: `Subject`, `Footer`, `Exception`, `BatchSummary`, `WeeklyDigest`, `SourceChanged`, `Test`, plus the data records. |
| `src_C/Vpc/Automation/Notifications.cs` (new) | Email log + SQS hand-off, `RaiseExceptionAsync`, `ResendAsync`, the report route and the three console routes. |
| `src_C/Vpc/Automation/AutomationTick.cs` (new) | `POST /api/internal/automation/tick` (A00 §12.6). |
| `src_C/Vpc/Automation/RunnerRoutes.cs` | `AfterCompleteAsync` body: `runner_run_failed`, `queue_item_failed`, `TryFinalizeAsync`. |
| `src_C/Vpc/Automation/DraftDecisions.cs` | `RaiseExceptionAsync` delegates to `Notifications.RaiseExceptionAsync`. |
| `src_C/Vpc/Automation/DraftQaResults.cs` | `ApplyAsync` finalises every distinct run it touched after its items. |
| `src_C/Vpc/VpcFunction.cs`, `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` | Brief change 9/10, literals verbatim (`…/notifications/test` before the list and the template). |

Tests (new, `[Collection(PostgresCollection.Name)]` except the pure `EmailTemplatesTests`): `AutoPublisherTests` (hosts the
shared `A04Kit`), `AutomationTickTests`, `AutomationNotificationsTests`, `EmailTemplatesTests`, `PublishExtractionTests`.
No existing test file changed.

## Why every existing publish response is identical

- Same order of work: deck read (404 `res.NotFound("Deck not found")`, 400 `DECK_DELETED`), `Validation.RequireSlug`
  (a `ValidationError` still propagates to the handler's `VALIDATION_ERROR` catch), `CardsSql`, premium bucket check,
  preview return (preview mode never reaches `StartPublishAsync`), MCQ gate + `RecordGateDefectAsync`, AI QA gate,
  snapshot, resume, insert, send.
- A refusal is carried as `(HttpStatus, Code, Message, ErrorExtras)` and rendered by the same helper as before:
  404 ⇒ `res.NotFound`, 400 ⇒ `res.BadRequest`, a chained QA run (`ErrorExtras` is the `QaRuns.ChainedRun`) ⇒
  `QaGate.RefusalResponse` (the exact `res.Raw` body with `error.runId`/`error.qaRun`), everything else ⇒
  `Helpers.ErrorEnvelope` (which is also what `Helpers.ConfigError` and the old non-chained QA refusals used).
- `queued` ⇒ `{ mode = "async", jobId }`; `resumed` ⇒ `{ mode = "async", jobId, note = "Resumed existing job" }`.
- The SQS body keeps its keys and order (`jobId, deckId, adminSub, note`; `adminSub` = the actor), the log lines keep
  their fields, `23505` on `uq_deck_publishes_active` and an SQS failure (after `FAILED`) still propagate to the
  handler's catches (409 `PUBLISH_IN_PROGRESS` / 500).
- `PublishMcqGateTests`, `AiQaPublishGateTests`, `AiQaPublishSnapshotTests`, `PublishEnqueueResilienceTests`,
  `PublishScopeAndLiveBuildTests`, `DecksLiveBuildIdTests` and `AutomationLedgerTests` pass unchanged;
  `PublishExtractionTests.ConsolePublish_ResponsesAreUnchanged` pins envelopes/keys/messages of every branch and
  `LedgerCompute_MatchesTheLedgerRoute` compares the route's `data` with `ComputeAsync` byte for byte.

## Email subjects and facts as implemented (A00 §12.4)

Subject = `[DeveloperCards] ` + `(dry run) ` (dry_run only) + the text below, capped at 200 characters (the
`automation_notifications` CHECK). `Summary` = the text below (≤ 300). Facts are the dictionary keys callers pass; every
fact is repeated as a `key: value` line under `DETAILS`.

| subkind | subject text | facts | raised by |
|---|---|---|---|
| `runner_stalled` | `Action needed: authoring runner <runnerId> silent since <since>` | `runnerId`, `since`, `loginExpiresAt`, `lastRunId`, `lastRunAt`, `queued` | tick step 9 |
| `runner_login_expiring` | `Action needed: runner login expires in <days> day(s)` | `runnerId`, `days`, `loginExpiresAt` | tick step 9 |
| `runner_run_failed` | `Action needed: authoring run failed for <host><path ≤60>` | `runId`, `itemId`, `url`, `error` | `RunnerRoutes.AfterCompleteAsync` |
| `queue_item_failed` | `Action needed: queue item <itemId> failed 3 times` | `itemId`, `url`, `lastError` | `AfterCompleteAsync`, tick step 2 |
| `qa_provider_error` | `Action needed: AI QA reviewer error <code>` | `code`, `draftId`, `runId` | `DraftQaResults` (via `DraftDecisions.RaiseExceptionAsync`) |
| `ai_qa_daily_cap` | `AI QA daily cap reached; <waiting> draft(s) waiting` | `waiting` | `DraftDecisions.EnqueueQaAsync` |
| `publish_blocked` | `Action needed: publish <deckSlug> (<reason>)` | `publishId`, `deckId`, `deckSlug`, `reason`, `reasonDetail`, `runId` | `AutoPublisher` human outcome |
| `publish_failed` | `Action needed: auto-publish of <deckSlug> failed` | `jobId`, `deckId`, `deckSlug`, `error` | `AutoPublisher.ReconcileAsync` |
| `eval_gate_missing` | `AUTOMATION_MODE=live is blocked: no passed eval gate` | – | tick step 10 |
| `watch_failing` | `Source watch failing: <url>` | `targetId`, `eventId`, `url`, `errorCode` | A05 |
| `source_gone` | `Cited source gone: <url>` | `targetId`, `eventId`, `url`, `citingCards` | A05 |

Batch summary `Batch <first 8 of runId> <deckSlug>: <a> auto-accepted, <h> need you, <publish>` where `<publish>` is
`no publish` (no publish row), `publish needs you` / `publish would need you` (any `human`), `would publish`
(dry_run), `published`, `publishing`, else `publish waiting`. Digest `Weekly automation digest <from>–<to>: <hoursSaved> h saved`
with `<from>` = UTC today − 7 and `<to>` = UTC today − 1 (the inclusive days of the `[today − 7, today)` window).
Source `Source changed: <host><path ≤60> — <n> card(s) re-checked, <f> flagged`. Test `Test email`.

The `automation.exception` webhook `refs` carries only `runId`, `draftId`, `deckId`, `targetId`, `jobId` facts
(`draftId`/`deckId`/`targetId` as numbers when they parse).

## The `SourceEventsAsync` hook for A05

`AutomationTick.SourceEventsAsync` is step 8. A04 implements `started` ⇒ `done` (every `recheck_run_ids` entry is an
`ai_qa_runs` row in `done`/`failed`) and the `source_changed` email for `done`/`unavailable` events without a
notification. A05 adds the retry of `waiting` events (and `unavailable` after 24 h) at the top of that method and
counts them in `Actions.RechecksStarted` (a property, 0 until then).

## Interpretations of §6 / §12

- **Evaluation row.** `EvaluateAsync` first appends the run's card ids to the deck's open row (one `update … returning`),
  else inserts a `waiting` row and handles the `uq_automation_publishes_open` race by re-selecting; then it runs the
  checks and updates that row (guarded by `state = 'waiting'`). An open row that is already `publishing` only gets the
  card ids appended (the tick reconciles it). The row's `mode` follows the effective mode of the latest evaluation.
- **Checks 1–6** read in one `REPEATABLE READ` transaction, so the deck, the change set, the owned hashes and the
  `CardsSql` rows whose digest becomes `expectedSnapshot` are one consistent snapshot. `T` missing (no
  `deck_publishes` row for `live_build_id`) makes check 5 fail (`'-infinity'`, the QaGate rule).
- **`expectedSnapshot`** is compared right after `StartPublishAsync` reads the cards, before the gates, so a stale
  automation publish neither records an MCQ ledger defect nor starts a chained QA run.
- **Refusal mapping in check 9.** `AI_QA_STALE` counts `attempts`; the 3rd stale refusal ends `human` / `AI_QA_STALE`.
  A 404 from the publish path (deck vanished) maps to `DECK_DELETED`; an unexpected code or an exception (SQS failure,
  validation) ends `human` / `PUBLISH_FAILED` with the message as detail; a `23505` on `uq_deck_publishes_active` is
  `waiting` / `PUBLISH_IN_PROGRESS`. The `PUBLISH_WAIT_TIMEOUT` rule (120 min since the row's `created_at`) is applied
  whenever an evaluation ends `waiting` / `PUBLISH_IN_PROGRESS`.
- **Ledger rows** follow the row's mode (`live` only). The dedupe keys are exactly A00 §14's.
- **Email sends.** `attempts` counts real SQS sends; an empty queue URL records `enqueue_failed` /
  `NOTIFY_NOT_CONFIGURED` without an attempt. The resend (tick step 11) takes `enqueue_failed` rows and `queued` rows
  not touched for 15 minutes (`updated_at`), fewer than 5 attempts, oldest first. The report route never moves a `sent`
  row; a later `sent` report after `failed` (a notifier retry that succeeded) is applied.
- **Tick.** A missing 034 answers 503 in every mode (probe of `automation_runs` before the mode). Mode is checked
  before the lock. Each step runs inside a guard that logs and continues on a non-schema error, so one failing step
  never blocks the others; the budget is checked before each step. The `source_changed` emails are counted in
  `actions.summaries` (no dedicated key exists in the §12.6 response). `digest` is `true` when this call created the
  digest row.
- **Batch summary.** Sent in the current effective mode; the `automation.batch_completed` webhook is emitted only when
  the notification row is new, so a replayed step never emits twice. `summary_notification_id` is set either way.
- **Runner health.** `days` = whole days left (floor, ≥ 0). No runner row at all and a `queued` item older than 24 h
  raises `runner_stalled` for runnerId `none` with `since` = that item's `created_at`.
- **Test email** is marked `(dry run)` when the effective mode is `dry_run` (the §12.2 rule applies to every email);
  in `off` it is unmarked.
