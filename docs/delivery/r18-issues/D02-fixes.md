# D02 — Automation server round 3b: fixes ledger

Issue #471, wave r18d-s, branch `delivery/r18ds/D02-471`, built on D01 (#470). This is the third fix round of R18A
(contract A00, the R18B K-items, the R18C L-items and the R18D M-items). Every path is under `src_C/`, and line numbers
refer to the branch head.

- No schema change. D02 needs no migration: 034, 035 and D01's 036 are untouched.
- The new tests are in `Tests/RecallSmith.Lambda.IntegrationTests/AutomationRound3bTests.cs`. Each one runs in its
  own scratch database.
- Every test for a fixed finding failed on the base code (`d9979ad`) and passes on the branch head. The pre-035 test
  (backend-design-20) passes on both, because that finding is about missing coverage and the code was already correct.
- The full integration suite passes: `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (2536 passed, 0 failed).

One existing assertion changed, because the finding makes the old behaviour wrong. It is listed under
backend-design-18. No assertion was weakened: the changed test now pins stricter behaviour.

## Findings

### backend-design-19
Status: fixed

One unresolved blockage of a deck is now one exception.

- `Vpc/Automation/AutoPublisher.cs:434-444` (`RouteHumanAsync`): the `publish_blocked` alert is keyed on the anchor
  row, `exception:publish_blocked:<anchorId>`. The anchor is the deck's oldest open publish exception with the same
  reason.
  - `OpenBlockageAnchorAsync` (:454) finds it with `StatusRoutes.OpenHumanPublishSql`: a live `human` row that no
    later `SUCCESS` deck publish resolved.
  - The current row is open itself, so for a new blockage the anchor is the row's own id. The key is then exactly
    A00's per-publishId key, and every existing assertion on `exception:publish_blocked:{publishId}` still holds.
  - A later run into the still-blocked deck gets the same anchor. The notification dedupe then swallows the email
    (and its webhook).
  - A human publish of the deck resolves the old rows, so the next blockage has a new anchor and a new alert. The same
    happens when the reason changes, for example from `DECK_HAS_HUMAN_CHANGES` to `AUTO_PUBLISH_DISABLED`. This
    follows the brief: a human publish or a changed reason resolves the exception.
- Why not merge rows: every evaluation still writes its own `automation_publishes` row and its own
  `auto-publish-human:<id>` ledger row. The Runs tab and the batch summary join rows by `run_id`, so merging the rows
  would have rewritten other runs' history. Only the exception is deduped.
- The backlog side is under automation-25.
- Tests:
  - `AutomationRound3bTests.Evaluate_RepeatedLiveRunsIntoABlockedDeck_RaiseOneAlert_AndOneBacklogItem`: two live runs
    into a deck with a human card edit give one alert, one message and `humanPublishes` = 1. A changed reason raises a
    second alert. A human publish clears the backlog, and the next blockage raises a new alert keyed on its own row.
  - Unchanged and still green: `AutoPublisherTests.Evaluate_HumanOutcome_RaisesPublishBlocked` and
    `AutomationTickTests` (the per-publishId key of a first blockage).

### automation-25
Status: fixed

- `Vpc/Automation/StatusRoutes.cs:380`: `backlog.humanPublishes` is `count(distinct p.deck_id)` over
  `OpenHumanPublishSql`, so it counts decks, not rows.
- `Vpc/Automation/StatusRoutes.cs:383-392`: `humanPublishItems` groups by deck. Each deck is one item, with its newest
  reason and, as `since`, its oldest open row's `updated_at`. Items are ordered oldest first and capped at 20 as
  before (R18C L4).
- The weekly digest reads the same backlog (`AutomationTick.DigestAsync` → `LoadBacklogAsync`), so "N publish(es)
  need you" now counts decks too.
- The per-deck email dedupe is under backend-design-19. The brief suggested keying on the deck's latest SUCCESS job;
  the open-row anchor is equivalent, because a SUCCESS publish is exactly what closes the anchor row.
- Tests:
  - `AutomationRound3bTests.Backlog_CountsDecksNotRows_OneItemPerDeck`: 4 open rows over 2 decks give
    `humanPublishes` = 2, and one item per deck with the newest reason and the oldest `since`.
  - `Evaluate_RepeatedLiveRunsIntoABlockedDeck_RaiseOneAlert_AndOneBacklogItem`
  - Unchanged: `AutomationStatusRoutesTests.Status_Backlog_ListsHumanPublishItems`, whose 26 rows are on 26 decks.

### backend-design-18
Status: fixed

- `Vpc/Automation/DraftDecisions.cs:151-199` (`SweepMissingAsync`): the sweep is repair-only and never automatic.
  - It cannot know the effective mode at submit time, so it cannot apply `OnSubmittedAsync`'s eligibility. It does not
    run `PrecheckAsync` or `EnqueueQaAsync`.
  - Every swept draft is inserted directly as `human` / `ENQUEUE_FAILED`, with
    `reason_detail = DraftDecisions.SweptDetail` ("decision hook lost; decided late by the tick sweep", :202). Its first
    event has `details.swept = true`. A live sweep writes the same `auto-route` ledger row as any live human route.
  - The draft stays `pending` in the review queue, so a person decides it.
  - The console no longer shows the misleading `RUN_NOT_RUNNING` "The run was not running" for a late decision.
- `Vpc/Review/Drafts.cs:80, 202-218` (`ParseAgent`): `agent.runId` is kept only when the submitter is the agent
  client. For any other client the key is dropped, and the rest of the agent block is stored as before. A stored run
  id therefore always means an agent submit. The sweep's join (`agent->>'runId'`, the run's owner) never adopts a
  draft posted through the console or an admin token. Such a draft is a plain review-queue draft with no decision,
  which is what `OnSubmittedAsync` does for it (:59).
- Correction of an earlier claim: C01-fixes.md:91 said "a late decision is never automatic". That was untrue for runs
  still `running`. It is true now for every swept draft.
- Changed existing test, because the finding makes the old behaviour wrong:
  `AutomationRound2Tests.Tick_DraftWhoseSubmitHookWasLost_GetsItsDecisionFromTheSweep`.
  - It asserted that the running run's swept draft reached `qa_queued` and was sent to draft QA. It now asserts
    `human` / `ENQUEUE_FAILED` / `SweptDetail` and that nothing was sent to draft QA.
  - The ended run's swept draft is now `ENQUEUE_FAILED` instead of `RUN_NOT_RUNNING`.
  - The grace-period, other-submitter and idempotency assertions are unchanged.
- New tests:
  - `AutomationRound3bTests.Sweep_DraftSubmittedWhileOff_EndsHumanAndNeverReachesQa`: submitted while off with a
    running run, then the mode flips back to dry_run. The sweep makes the draft human / `ENQUEUE_FAILED`, sends no QA,
    and the draft stays pending.
  - `AutomationRound3bTests.Submit_NonAgentClientWithRunId_DropsTheRunId_AndTheSweepLeavesTheDraftAlone`: the console
    submit stores no `runId`, and after the grace period the tick creates no decision and sends no QA.

### cloud-security-resilience-13
Status: fixed

- `Vpc/Automation/AutomationTick.cs:106-117` (`HandleTick`): a `digest` job no longer returns early when
  `pg_try_advisory_lock` fails. It runs the digest step without the lock and answers `skipped: "locked"` with
  `actions.digest` set.
  - This is option (b) of the finding, in its simplest form: the digest has its own dedupe and no single-flight. It is
    read-only aggregation plus one `automation_notifications` insert deduped on `digest:<UTC date>`
    (`on conflict (dedupe_key) do nothing`), so a concurrent tick cannot double-send it.
  - A failing digest is still named in `failedSteps` and counted in `AutomationStepFailures`.
- `Vpc/Automation/AutomationTick.cs:133-173` (`RunStepsAsync`): a `tickSteps` flag. The tick steps run only while this
  call holds the lock, so they stay single-flight. The lock is released only by the call that took it (:116).
- Test: `AutomationRound3bTests.Digest_WhileATickHoldsTheLock_IsStillSentOnce`. While another session holds the tick
  lock:
  - the digest job answers `locked` with `digest: true`, one `weekly_digest` notification and one message;
  - an expired lease is left alone, so no tick step ran;
  - a repeated digest and a plain tick send nothing more.
  After the lock is released, a tick runs normally.
- Unchanged and still green: `AutomationTickTests.Tick_HeldLock_IsSkippedLocked` and
  `Tick_Digest_EnqueuesWeeklyDigest`.

### backend-design-20
Status: fixed (test coverage; the code was already correct and is unchanged)

- Test: `AutomationRound3bTests.Pre035_ConsolePublishFallsBack_AutomationPublishFails_WorkerSeesNoSettingsChange`. It
  follows the `PublishJobProcessorSchemaTests` pattern on a scratch database migrated to 034, the real pre-035
  schema, and first asserts that `deck_publishes.card_ids` and `deck_updated_at` are absent. It pins:
  - an automation publish (`expectedDeckUpdatedAt` set) propagates `PostgresException` 42703, inserts no job and sends
    nothing (`Vpc/Authoring/Publish.cs:439`, the `expectedDeckUpdatedAt is null` guard);
  - `Publish.StartPublishAsync` for a console actor falls back to the legacy insert, returns `Queued`, inserts a
    `PENDING` job and sends one message;
  - `PublishJobProcessor.DeckSettingsChangedAsync` returns false for that job
    (`Worker/Services/PublishJobProcessor.cs:195-199`).

## Contract

- D02 implements no M-item. M1–M6 are D01's (server side) or other waves'. D02 builds on D01's 036 and changes
  nothing in it.
- R18B K7 / R18C L4 refinement: `backlog.humanPublishes` counts decks with an open publish exception, and
  `humanPublishItems` has one item per deck (`deckId`, `deckSlug`, newest `reason`, oldest `since`). The field names
  and shapes are unchanged.
- A00 §12 `publish_blocked` dedupe: the key keeps its shape, `exception:publish_blocked:<publishId>`. The publishId is
  now the one that opened the deck's unresolved blockage with that reason, so a first blockage keys exactly as before
  and a repeat of it raises nothing.
- A00 §5.1 submit: `agent.runId` is honoured, and stored, only for the agent client.
- A00 §12.6 tick: a `digest` job always runs the digest. `skipped: "locked"` now means only that the tick steps were
  skipped.
