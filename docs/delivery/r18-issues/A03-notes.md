# A03 — Automatic draft decisions: notes

Issue #408, wave `r18a-s`. Contract: A00 §5, §9.1–§9.5, §12.4, §13, §14. Builds on A01 (migration 034,
`AutomationMode`, `AutomationEnv`) and A02 (`automation_runs` rows created by the runner claim).

## What changed

| File | Change |
|---|---|
| `src_C/Vpc/Automation/AutomationReasons.cs` (new) | `DecisionReasons`, `HumanAction`, `PublishReasons`, `LedgerFailureReasons`, `LedgerOutcome` (A00 §5.9, §6.6). The lists equal the migration 034 CHECKs (`ReasonLists_MatchTheMigrationConstraints` reads them from `pg_constraint`). |
| `src_C/Vpc/Automation/AutomationIds.cs` (new) | `Derived(name)`: the `WebhookEvents.DerivedEventId` algorithm over `"developercards-automation:" + name`. |
| `src_C/Vpc/Review/DraftAcceptance.cs` (new) | `AcceptInTransactionAsync` (`:30`): the accept transaction body moved out of `Drafts.HandleAccept`. |
| `src_C/Vpc/Automation/DraftDecisions.cs` (new) | `OnSubmittedAsync` (`:42`), `EnqueueQaAsync` (`:185`), `DraftContentHashAsync` (`:384`), `OnHumanDecisionAsync` (`:412`), `RouteLedgerEvent` (`:465`), `RaiseExceptionAsync` (`:472`), plus the `TransitionAsync`/`AppendEventAsync` helpers that write a state change and its event in one transaction. |
| `src_C/Vpc/Automation/DraftQaResults.cs` (new) | `ApplyAsync` (A00 §5.4 steps 0–10, one transaction per item, lock order decision → draft → deck), the QA mirror (`MirrorAsync`, `:225`), the after-commit ledger rows / `draft.auto_accepted` webhook / exception hook (`AfterCommitAsync`, `:258`). |
| `src_C/Vpc/Internal/AiQaResults.cs` | `Report`/`ReportItem`/`ReportFinding` are `internal` (`:61-71`), `Report` gains `Target`; `ParseReport` reads the optional `"target"` (`:472`, absent/null/`card` ⇒ card, `draft` ⇒ draft, else 400 `VALIDATION_ERROR` "target must be card or draft"); a draft report is dispatched to `DraftQaResults.ApplyAsync` before the `ai_qa_runs` lookup (`:108-126`), 42P01 ⇒ 503 `SERVER_NOT_READY_AUTOMATION`. The card path is untouched. |
| `src_C/Vpc/Qa/QaRuns.cs` | `SpendTodayAsync` (`:477`) = the old query (now `RunSpendTodayAsync`, `:498`) plus today's decision spend and fresh `qa_queued` reservations, after a `to_regclass` probe (`:482`). `DecimalEnv` became `internal` (`:521`) so the draft enqueue reads the cap exactly like a run start. |
| `src_C/Vpc/Authoring/CardSimilarity.cs` | `FindAsync(conn, query, ct = default, NpgsqlTransaction? tx = null)` (`:48-49`). |
| `src_C/Vpc/Review/Drafts.cs` | `AgentKeys` gains `runId`, `queueItemId` (`:37`, message lists the five names); `Submit` calls `OnSubmittedAsync` after `review.queued` (`:171`); `HandleAccept` calls `DraftAcceptance` (`:513`) and `OnHumanDecisionAsync` after its ledger row (`:539`); `HandleReject` likewise (`:634`); list/detail gain `automation` (`AutomationRowsAsync` `:722`, `AutomationDetailAsync` `:741`, 42P01/42703 ⇒ `automation: null`). |

Tests (new, `[Collection(PostgresCollection.Name)]`): `DraftDecisionsTests` (hosts the shared `AutomationTestKit`),
`DraftQaResultsTests`, `DraftAcceptanceTests`, `AutomationSpendCapTests`. No existing test file changed.

## How the extraction keeps accept responses identical

`AcceptInTransactionAsync` runs the same statements in the same order on the caller's transaction (draft `for update`,
`pending` check, deck `for update`, stored card parse, grounding strip, action, uid check against live and deleted
cards, card insert with `order_in_deck = max + 10` and `revision 1`, draft update with `decided_by_sub = actorSub`,
review event with `actor_sub = actorSub`). A refusal is a `DraftAcceptanceException` whose `Message` is the exact text
the route used to put in the envelope. `HandleAccept` maps `DRAFT_NOT_FOUND` / `DECK_NOT_FOUND` to its unchanged
`DraftNotFound(res)` / `DeckNotFound(res)` (404) and the other two codes to `Helpers.ErrorEnvelope(res, 409, code,
message)`; returning from inside the `await using` transaction rolls it back exactly as the early `return` did before.
Everything after the commit (ledger `draft-accept:<id>`, the `runQa` chain) and the `23505 uq_cards_deck_uid` catch are
unchanged. `DraftAcceptanceTests.HumanAccept_ResponsesAreUnchanged` pins keys, statuses, codes and messages, and the
unchanged `DraftsTests` / `DraftInvariantsTests` still pass.

## The `CardSimilarity` transaction change

The pg_trgm path used to open its own transaction for `set_config('pg_trgm.similarity_threshold', …, true)`, which
throws "A transaction is already in progress" inside the auto-accept transaction. With `tx` null nothing changes
(the method still owns a short transaction and commits it). With `tx` non-null the engine probe, the `set_config` and
the query (or the fallback query) all run on the caller's transaction and no transaction is begun or committed; the
setting then lasts until the caller's transaction ends, which is harmless. `CardSimilarityTests` pass unchanged.

## Decisions taken where the brief was silent

- **Enqueue failure events.** The reservation commits `qa_pending → qa_queued` with its event before the send (the brief
  requires the reservation to count before the send). A failed send is therefore a second state change,
  `qa_queued → qa_pending` (`ENQUEUE_RETRY`, `qa_enqueued_at` cleared) or `qa_queued → human` (`ENQUEUE_FAILED`), with its
  own event, so every state change still has exactly one event. `AI_QA_DAILY_CAP` changes only the reason: no event.
- **Reviewer check** compares (`provider`, `model`, `promptVersion`) of the report with `EffectiveMode.Reviewer` by
  ordinal equality.
- **Ledger "live"** for report outcomes means the effective mode when the item is applied; for the submit-time and
  enqueue routes it is the decision's recorded mode.
- `OnHumanDecisionAsync` probes `to_regclass('public.automation_draft_decisions')` before opening its transaction, so a
  pre-034 database logs one warn and never opens a transaction that would abort.

## Hooks A04 fills

- `DraftDecisions.RaiseExceptionAsync(conn, subkind, dedupeKey, facts, ct)` (`DraftDecisions.cs:472`): A03 only logs
  `{tag:"automation", reason:"exception", subkind, dedupeKey, facts}`. Called for `ai_qa_daily_cap`
  (`exception:ai_qa_daily_cap:<UTC date>`, fact `waiting`) and `qa_provider_error`
  (`exception:qa_provider_error:<code>:<UTC date>`, facts `code`, `draftId`, `runId`). A04 replaces the body with the
  email enqueue and keeps the name and signature.
- `AutomationRuns.TryFinalizeAsync`: the call site is the end of `DraftQaResults.ApplyAsync` (`DraftQaResults.cs:40`,
  marked by a comment), after every item's after-commit work.
- `EnqueueQaAsync` is `internal` and idempotent on state, ready for the tick's `qa_pending` retries (A00 §12.6 step 3).
