# X02 — Server hardening: fixes per finding

Issue #354, wave r18x-s. Branch `delivery/r18xs/X02-354`, built on X01 (#353). Every path is relative to the
repo root. All tests are in `src_C/Tests/RecallSmith.Lambda.IntegrationTests/` and run against a real Postgres
(Testcontainers). `dotnet test src_C/RecallSmith.Lambda.sln`: 1619 passed, 0 failed.

Migrations 026–031 have not been applied anywhere yet, so migration 031 is edited in place (additive and
idempotent: three `alter table ai_qa_items add column if not exists`). No migration 032 was added.

Contract changes (they differ from `R18-00-contracts.md`, and a finding requires each one):

| Contract item | Was | Now | Finding |
|---|---|---|---|
| §7.2 daily cap | `today's sum ≥ cap ⇒ 429` | `spent ≥ cap` **or** `spent + open-run reservation + this run's estimate > cap ⇒ 429`, serialized by an advisory lock; new env `AI_QA_EST_USD_PER_CARD` (default 0.05) | backend-design-6, cloud-security-resilience-3, ai-agent-8 |
| §7.7 item usage | each report overwrites tokens and `estimated_cost_usd` | a report with a new `requestId` adds to them; a replay of the same `requestId` keeps the larger value; a kept (never-downgraded) item still adds a new attempt's usage | backend-design-6, cloud-security-resilience-3 |
| §7.7 run status (contract line 757) | `queued = 0 ⇒ done`, `error_code` cleared | `queued = 0` and no item `done` ⇒ `failed` / `ALL_ITEMS_FAILED`; otherwise as before | backend-design-5 |
| §7.2 routes | — | new super_admin `POST /api/v1/authoring/qa/runs/:runId/items/:cardId/waive` `{note}`; run detail items gain `waivedBySub`, `waivedAt`, `waiveNote` | ai-agent-16 |
| §7.10 publish gate | a `done` item at the current hash | a `done` item, **or an owner-waived `error`/`refused` item**, at the current hash | ai-agent-16 |
| §10.3 console-dev | "same groups — only the client differs" | same pool, MFA and groups, but core-vpc limits a console-dev token to deck list/read, card similarity, draft submit and its own drafts; everything else is 403 `AGENT_CLIENT_FORBIDDEN`; new env `AUTH_AGENT_CLIENT_IDS` (default the console-dev client id) | ai-agent-6 |

New env keys, both in `src_C/env/prod.env.json`: `AUTH_AGENT_CLIENT_IDS=5au94igdq00nipsst7spsqepb7` (the
console-dev client id, already public in `infra/README.md`; not a secret) and `AI_QA_EST_USD_PER_CARD=0.05`.
Both have code defaults equal to those values, so a Lambda without them behaves the same.

## Metric contract (namespace `DeveloperCards`)

Unchanged by X02 and as X01 recorded it (`docs/delivery/r18-issues/X01-fixes.md`): `LedgerWriteFailures`,
`AiQaEnqueueFailures` and `QaGateRefusals` go through `RouteMetrics.EmitGauge(name, 1)` without dimensions,
like `WebhookEnqueueFailures`. The QA waiver's ledger row goes through `AutomationLedger.RecordAsync`, so a
dropped write is counted by `LedgerWriteFailures`. webhook-dispatcher `WebhookDeliveryAttempts`, dimension
`Outcome`: `delivered`, `retry`, `failed` (permanent, non-retryable) and `dead` (give-up after the last
attempt), plus `WebhookReportFailures`. ai-qa keeps `AiQaErrors` and `AiQaRefusals`.

## Findings

### backend-design-5

Status: fixed

- `src_C/Vpc/Internal/AiQaResults.cs:216-222`: the run recompute counts `reviewed` (items `done`, :229). When
  no item is queued and none was reviewed (every item `error`, `refused` or `skipped`, e.g. the fail-fast
  PROVIDER_AUTH/CONFIG path or DISABLED), the run becomes `status = 'failed'`, `error_code = 'ALL_ITEMS_FAILED'`,
  with `finished_at` set once. A later retry that reviews a card moves the run to `done` and clears the code.
  The results response's `runStatus` reports `failed` accordingly. Runs with at least one reviewed card behave
  as before (`done`, `errorCount` shows the rest).
- Test: `AiQaResultsTests.Results_AllItemsFailed_MarksRunFailedWithAllItemsFailed` (all PROVIDER_AUTH/REFUSAL,
  all skipped/DISABLED, then a retry turning it into `done`).

### backend-design-6

Status: fixed

- Projected cap: `src_C/Vpc/Qa/QaRuns.cs:146-168`. `AI_QA_EST_USD_PER_CARD` (default `0.05`, :30, :41) prices
  each card; inside the insert transaction, after `pg_advisory_xact_lock` (:159), `SpendTodayAsync` (:370)
  returns today's reported spend and the unfinished cards (`card_count - cards_done`) of open, non-stale runs;
  the start is refused with 429 `AI_QA_DAILY_CAP` when `spent ≥ cap` or
  `spent + openCards × perCard + cards × perCard > cap` (:163). Equal to the cap is allowed.
- Retry accounting: `src_C/Vpc/Internal/AiQaResults.cs:129-171`, :266-282. Item tokens and cost now add up
  across attempts when the report's `requestId` differs from the stored one (a retried chunk re-reviews the
  card), including on items whose outcome is kept (done → error, or done with resolved findings). An exact
  replay (the Lambda's one POST retry, same `requestId`) takes the larger value, so it never double-counts.
  The run's `estimated_cost_usd`, which the cap reads, is the sum of those items.
- Tests: `AiQaRunsTests.StartRun_DailyCap_ReservesThisRunAndOpenRuns` (boundary: just under / exactly at
  the cap, and a second deck on top of an open run), `AiQaRunsTests.StartRun_ConcurrentStartsOnTwoDecks_SeeEachOthersReservation`,
  `AiQaResultsTests.Results_RetriedChunk_AccumulatesItemUsage_ButNotOnExactReplay`.
- Existing tests updated because the finding makes the old behaviour wrong:
  `AiQaResultsTests.Results_DoneItem_IsNeverDowngraded` asserted that the run cost is unchanged after a
  billed retry of a done card; it now asserts the retry's cost is added (0.51) and keeps every other
  never-downgraded assertion. `AiQaRunsTests.StartRun_DailyCapReached_Returns429` sets
  `AI_QA_EST_USD_PER_CARD=0` so it still checks the reported-spend boundary alone (the reservation boundary
  has its own test).

### backend-design-7

Status: fixed

- `src_C/Vpc/Authoring/CardSimilarity.cs:108-170`: `BuildPgTrgmQuery` filters with `c.question % $1` (an
  operator the gin_trgm_ops index of `029_pg_trgm.sql` serves) plus the unchanged
  `similarity(c.question, $1) >= $n`, and `PgTrgmRowsAsync` runs it in a short transaction after
  `set_config('pg_trgm.similarity_threshold', <threshold>, true)` (transaction-scoped, so a pooled
  connection never keeps it). pg_trgm's `%` compares the float4 score with the double GUC exactly as the
  explicit predicate does, so rows and scores stay identical to the in-process fallback. A threshold of 0
  (every card matches, including cards with no shared trigram and so absent from the index) keeps the plain
  predicate (:125). The no-pg_trgm path (fallback engine, 42883 fallback) is unchanged. The index in 029 stays.
- Tests: `CardSimilarityTests.PgTrgmQuery_FiltersThroughTheTrigramIndex` (EXPLAIN shows a Bitmap Index Scan on
  `idx_cards_question_trgm` with `Index Cond: (question % …)`; with the old predicate the index can at best be
  read whole, never as a condition), `CardSimilarityTests.Similar_ThresholdEqualToAScore_MatchesInBothEngines`
  (threshold exactly equal to each card's score: identical results in both engines); the existing
  `Similar_FallbackEngine_MatchesPgTrgmEngine` and `TrigramParityTests` still pass.
- Note: whether the planner chooses the index depends on table size (at a few thousand cards a scan is still
  cheaper and Postgres picks it); the fix makes the index usable, the planner decides when it pays.

### backend-design-9

Status: fixed

- Tests only (the code paths already existed): `DraftsTests.Accept_Concurrently_ExactlyOneWins` (two concurrent
  accepts: one 200, one 409 `DRAFT_NOT_PENDING`, one card, one accept event),
  `DraftsTests.Submit_SameClientDraftKeyConcurrently_CreatesOneDraft` (two concurrent submits with one
  `clientDraftKey`: one created, one duplicate naming the same draft, one row, one submitted event),
  `AiQaRunsTests.StartRun_ConcurrentStartsOnOneDeck_OneRunAndOneInProgress` (two concurrent starts on one deck:
  one 200, one 409 `AI_QA_RUN_IN_PROGRESS`, one run row). All use `Task.WhenAll` with the fixture's PG_MAX=8.

### cloud-security-resilience-3

Status: partially fixed

- Reservation at admission, accumulated per-item cost and parallel starts across decks: fixed as described
  under backend-design-6 (`src_C/Vpc/Qa/QaRuns.cs:146-168`, :370; `src_C/Vpc/Internal/AiQaResults.cs:129-171`).
  The advisory lock (:159) makes concurrent starts on different decks see each other's reservations.
- Not done: a mid-flight stop (results route answering `stop: true` and the Lambda filling remaining cards with
  a CAP code). The Lambda is `services/ai-qa`, outside this issue's allowed paths, and a server-only flag it
  ignores would change nothing. With the reservation, a run can only exceed its own estimate by the difference
  between real and estimated per-card cost; `AI_QA_EST_USD_PER_CARD` is the knob to raise if real spend runs
  higher.
- Tests: those listed under backend-design-6.

### ai-agent-6

Status: fixed

- `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:24-40` (`AuthContext.IsAgentClient`), :60-100
  (`AuthOptions.AgentClientIds` from `AUTH_AGENT_CLIENT_IDS`, default the console-dev client id, fail closed
  when unset or blank), :431 (a token whose `client_id`/`aud` is an agent client is flagged, on both the
  in-process and the API Gateway claims path).
- `src_C/Vpc/AgentClientPolicy.cs`: the allowlist — `GET /api/v1/admin/decks`, `GET /api/v1/authoring/decks`,
  `POST /api/v1/authoring/cards/similar`, `POST /api/v1/authoring/drafts`, `GET /api/v1/authoring/drafts/:draftId`
  (and `GET /health`). `src_C/Vpc/VpcFunction.cs:106` applies it before any route; everything else (accept,
  reject, draft list, publish, QA runs/status/resolve/waive, webhooks, ledger, admin/db, permissions, card and
  deck writes, rollback, manifest) answers 403 `AGENT_CLIENT_FORBIDDEN` and logs one warn line without claim
  values. `src_C/Vpc/Review/Drafts.cs:406`: an agent token reads only drafts its own subject submitted (404
  otherwise). The SPA client is unchanged. `src_C/env/prod.env.json` sets `AUTH_AGENT_CLIENT_IDS`.
- Tests: `AgentClientPolicyTests.AgentClient_HumanDecisionAndWriteRoutes_Are403AgentClientForbidden` (24 routes),
  `AgentClientPolicyTests.SpaClient_SameRoutes_AreNotAgentForbidden`, `AgentClientPolicyTests.AgentClient_McpRoutes_AreAllowed`
  (deck list, similarity, submit, own draft 200, another subject's draft 404, SPA still reads it, agent accept
  denied), `AgentClientPolicyTests.AgentClient_GatewayVerifiedClaims_AreRestrictedToo`,
  `AgentClientPolicyTests.Parse_AgentClientIds_DefaultToConsoleDev`, `AgentClientPolicyTests.Allows_Table`.
  The existing `AdminConsoleBindingTests` all pass unchanged.
- Out of scope, noted: the edge-public prefixes (`/api/v1/admin/cognito/*`, `/api/v1/ai/*`,
  `/api/v1/billing/*`) are served by edge-public, which contract §0.4 makes untouchable; the console authorizer
  admits console-dev tokens there. Local console development (`npm run dev` with the console-dev client) now
  gets the same authoring-only surface against this API.

### ai-agent-8

Status: fixed

- Fixed by the reservation described under backend-design-6: `src_C/Vpc/Qa/QaRuns.cs:146-168` reserves
  `cards × AI_QA_EST_USD_PER_CARD` for the run being started plus the unfinished cards of every open
  (queued/running, not stale) run, on any deck, against `AI_QA_DAILY_USD_CAP`, and the advisory lock stops
  parallel starts from all passing while spend is still 0. The 429 message spells out spent, reserved,
  estimate and cap. (The console's pre-run estimate is a frontend change, outside this issue's paths.)
- Tests: `AiQaRunsTests.StartRun_DailyCap_ReservesThisRunAndOpenRuns`,
  `AiQaRunsTests.StartRun_ConcurrentStartsOnTwoDecks_SeeEachOthersReservation`.

### ai-agent-16

Status: fixed

- `src_C/Vpc/Qa/QaRuns.cs:691-790` (`HandleWaiveItem`, routed at `src_C/Vpc/VpcFunction.cs:307`, labelled in
  `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs`): super_admin-only
  `POST /api/v1/authoring/qa/runs/:runId/items/:cardId/waive` with a required `note` (1..500). Only `error` or
  `refused` items can be waived (409 `AI_QA_ITEM_NOT_WAIVABLE`), once (409 `AI_QA_ITEM_ALREADY_WAIVED`); it
  records `waived_by_sub`, `waived_at`, `waive_note` on the item and an `ai_qa_review` ledger row
  (`units 0`, `outcome failure`, dedupe `qa-waive:<runId>:<cardId>`, details with the status, error code and
  note). The run detail returns the waiver fields so the console can show refused/waived items apart.
- `src_C/Vpc/Qa/QaGate.cs:110`: the publish gate (and `scope=changed`, and `GET /qa/status`) counts a waived
  `error`/`refused` item as reviewed **at that item's content hash only**; editing the card needs a new review.
- `src_C/Vpc/Db/Migrations/031_ai_qa.sql:57-61`: the three nullable columns (edited in place, idempotent).
- The console UI that lists refused items separately is a frontend change outside this issue's paths; the API
  it needs is here.
- Test: `AiQaRunsTests.WaiveItem_RefusedCard_CountsAsReviewedAtItsHashOnly` (status before/after, editor 403,
  blank note 400, done item 409, unknown item 404, second waive 409, ledger row, run detail fields, edit
  re-blocks).
