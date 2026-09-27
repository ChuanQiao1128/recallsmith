# Y02 — Server round 2 (QA, drafts): fixes per finding

Issue #370, wave r18y-s. Branch `delivery/r18ys/Y02-370`. Every path is relative to the repo root.
All C# tests are in `src_C/Tests/RecallSmith.Lambda.IntegrationTests/` and run against a real Postgres
(Testcontainers). `dotnet test src_C/RecallSmith.Lambda.sln`: 1650 passed, 0 failed.

Migrations 026–032 are applied or merged and are not edited. The one schema change is the new additive,
idempotent migration `src_C/Vpc/Db/Migrations/033_ai_qa_drafts_round2.sql`:

- `ai_qa_items.prompt_version` (nullable), backend-design-12;
- `deck_publishes.qa_snapshot_sha256` (nullable), backend-design-16;
- `ck_ai_drafts_decided` and `ck_ai_drafts_accept` on `ai_drafts`, backend-design-18. Each is added `NOT VALID`
  and validated only when no existing row violates it (otherwise a notice, and a re-run after repair validates it).

Deploy order stays: migrate, then code. Nothing outside `src_C/` and this file was changed.

Contract changes (they differ from `R18-00-contracts.md`; a finding or the brief requires each one):

| Contract item | Was | Now | Finding |
|---|---|---|---|
| §7.2 `ai_qa_runs.prompt_version` at start | `qa-v1`, pinned by core | null until a chunk reports; then the version the Lambda reported (last report wins) | backend-design-12 |
| §7.4 message `promptVersion` | `qa-v1` | `qa-v3` = `QaRuns.PromptVersion`, kept equal to `services/ai-qa/src/ai_qa/prompts.py` `PROMPT_VERSION` by a contract test. The field stays because the Lambda's `parse_message` requires it | backend-design-12 |
| §7.7 results, item hash | a mismatch is logged and applied | a mismatch is logged (`hash_echo_mismatch`) and the item is ignored | cloud-security-resilience-2 |
| §7.7 results, per-item `prompt_version` | — | stored on the item | backend-design-12 |
| §4.3 internal HMAC | one `INTERNAL_SHARED_SECRET` for all internal routes | the AI QA results route uses `INTERNAL_SECRET_AI_QA_RESULTS` and the delivery report route uses `INTERNAL_SECRET_WEBHOOK_REPORT` when set. The shared secret is then refused on those routes. Unset → shared secret (unchanged) | cloud-security-resilience-2 |
| §7.2 `GET /qa/status` | — | `data.limits = { maxCards, dailyUsdCap, spentTodayUsd, reservedTodayUsd }` (cross-wave contract with Y07) | brief |
| §7.2 resolve body | `resolution`, `note` | also an optional `reviewMs` (integer ≥ 0, capped at 30 min) | automation-16 |
| §8.3 accept body / response | — | optional boolean `runQa`; when it is true the response carries `qa: { status, runId, code, message }` | automation-17 |
| §7.10 publish gate 409 `AI_QA_REQUIRED` | code and message | also `error.runId` and `error.qaRun` (the run the gate started or reused) | automation-17 |
| §7.10 publish | the gate at request time only | a gated publish stores `qa_snapshot_sha256`; new 409 `AI_QA_STALE` when the cards change during the request; the Worker fails the job with `AI_QA_STALE` when the cards it would build differ | backend-design-16 |
| ai-agent-6 `AgentClientPolicy` | deck list and read, similarity, draft submit, own draft status, `/health` | exactly the three endpoints `tools/mcp-server/src` calls: `GET /api/v1/admin/decks`, `POST /api/v1/authoring/cards/similar`, `POST /api/v1/authoring/drafts` | brief (cross-wave contract) |

`R18-00-contracts.md` is outside this repository, so it is not edited here. The table above is the change record
for §7.4/§7.6 (and the other sections) that the finding asked for.

---

### backend-design-12

Status: fixed

- core-vpc no longer pins a prompt version on a run. `QaRuns.StartRunAsync` inserts `ai_qa_runs` without
  `prompt_version` (`src_C/Vpc/Qa/QaRuns.cs:209`).
- The results route makes the version the Lambda reports authoritative: `prompt_version = coalesce($4::text, r.prompt_version)`
  (`src_C/Vpc/Internal/AiQaResults.cs`, the run recompute). Each applied item also records the reporting chunk's
  version (`ai_qa_items.prompt_version = coalesce($11::text, prompt_version)`, migration 033). A run whose chunks
  report different versions (a deploy during a run) logs `prompt_version_changed` (`AiQaResults.cs:282`).
- The §7.4 message still has to carry `promptVersion`, because the Lambda rejects a message without it
  (`services/ai-qa/src/ai_qa/handler.py:143`). The value is now `QaRuns.PromptVersion = "qa-v3"` (`QaRuns.cs:30`),
  documented as the expected version only. It no longer triggers `prompt_version_mismatch` on every chunk, so a
  real mismatch stands out again.
- Tests:
  - `AiQaRunsTests.PromptVersion_MatchesTheAiQaLambda` is the cross-service contract. It reads the
    `PROMPT_VERSION` literal from `services/ai-qa/src/ai_qa/prompts.py` and asserts it equals `QaRuns.PromptVersion`.
    Before the fix it failed (qa-v3 ≠ qa-v1).
  - `AiQaResultsTests.Results_PromptVersion_IsTheOneTheLambdaReported`: a run stored with `qa-v1` takes the
    reported `qa-v3` on both the run and the item, and a later report without a version keeps it.
  - `AiQaRunsTests.StartRun_ScopeChanged_EnqueuesChunksOfAtMostFiveCards`: an existing assertion was updated
    because the finding makes the old value wrong. The message now carries `QaRuns.PromptVersion` (was the literal
    `qa-v1`), and the new run's `prompt_version` is null.

### backend-design-6

Status: fixed

- On the kept path (done → error, or done with resolved findings), a new attempt now stores its request id together
  with its usage: `update ai_qa_items set {AccumulateUsageSql}, request_id = $7::text ...`. It also sets
  `state.RequestId = item.RequestId` (`src_C/Vpc/Internal/AiQaResults.cs`, kept branch). An exact replay of that
  report therefore compares equal in `IsNewAttempt` and is not billed again.
- Test: `AiQaResultsTests.Results_KeptItem_ExactReplay_IsBilledOnce` reports done (0.01), then an error with a new
  request id (0.5), then the same error body again: the cost is 0.51 (before the fix it was 1.01). The test then
  adds a third, genuinely new attempt, which is still billed (0.76). The existing
  `Results_DoneItem_IsNeverDowngraded` and `Results_RetriedChunk_AccumulatesItemUsage_ButNotOnExactReplay` are
  unchanged and pass.

### backend-design-15

Status: fixed

- `AiQaResults.AfterCommitAsync` creates one request-scoped budget,
  `using var budget = new CancellationTokenSource(AfterCommitBudget)` (8 s, `AiQaResults.cs:53`, `:322`). It passes
  `budget.Token` to every `WebhookEvents.EnqueueAsync` call (`:353`). `EnqueueAsync` links the per-call 5 s deadline
  to that token. So all the card.flagged sends of one report, up to `MaxItems` = 50 cards, fit in one budget that is
  well under the 30 s gateway timeout.
- Once the budget has fired, each remaining card still gets its delivery rows. They are marked `enqueue_failed` at
  once, with no wait on SQS, and the existing stranded-delivery sweep re-sends them. The webhook is therefore delayed,
  not lost, and the ai-qa Lambda is never pushed into a `report_failed` retry that would re-bill the chunk.
- Test: `AiQaResultsTests.Results_HungWebhookQueue_StaysWithinOneRequestBudget` reports 10 blocker cards with an
  active card.flagged subscription and a send seam that never completes. The budget is shortened to 1 s. The
  report returns 200 in under 4 s, and all 10 deliveries are `enqueue_failed`. Before the fix this took 10 × 5 s.

### backend-design-16

Status: fixed

- The digest is shared by both sides: `src_C/Shared/RecallSmith.Lambda.Db/PublishSnapshot.cs` is a SHA-256 over the
  export columns of every live card, in export order. It normalises the nulls the Worker maps to `""`, 2 or 1.
- At request time (`src_C/Vpc/Authoring/Publish.cs:317-328`), when the gate is enforced (`QaGate.IsEnforced()`),
  Publish checks the cards the MCQ and QA gates evaluated. It digests them, re-reads the cards after the gate, and
  refuses with 409 `AI_QA_STALE` if they changed during the request. Otherwise it stores the digest on the job row
  (`deck_publishes.qa_snapshot_sha256`, migration 033; `Publish.cs:379-380`).
- At build time (`src_C/Worker/Services/PublishJobProcessor.cs:74-77`), a job that carries a snapshot is failed with
  `BusinessException("AI_QA_STALE: …")` when the digest of the cards the Worker loaded (the exact rows it would
  build, `SnapshotDigest`, `:161`) differs. That is a business failure: the job is marked FAILED and not retried, and
  the author publishes again so the gate re-checks. `JobRepository.GetJobAsync` reads the column and tolerates a
  pre-033 schema (42703 → no snapshot).
- With the gate off nothing changes: there is no snapshot column in the insert and no check in the Worker.
- Tests (`AiQaPublishSnapshotTests`):
  - `GatedPublish_BuildsTheCardsTheGatePassed`
  - `GatedPublish_CardEditedBeforeTheBuild_FailsAiQaStale`: an edit between the gate and the build means no upload
    and the job is not SUCCESS.
  - `UngatedPublish_StoresNoSnapshot_AndBuildsLiveCards`
  - `Digest_IsTheSameOverThePublishRowsAndTheWorkerCards`: parity of the two sides over MCQ, source, code and
    all-null columns, and sensitivity to a jsonb change.
  - The existing `AiQaPublishGateTests` still pass.

### backend-design-18

Status: fixed

- Migration 033 adds:
  - `ck_ai_drafts_decided`: `(status = 'pending') = (decided_at is null) and (status = 'pending') = (decided_by_sub is null)`
  - `ck_ai_drafts_accept`: `status = 'accepted' or accepted_card_id is null`
- `accepted_card_id` stays nullable for accepted rows (`on delete set null`). Both constraints are added
  `NOT VALID`. Each is then validated in the same file only if no existing row violates it, so the deploy cannot fail
  on a legacy row, and a re-run after a repair validates it.
- Handler side: accept and reject now refuse a token without a subject with 403, before any write
  (`src_C/Vpc/Review/Drafts.cs:469`, `:593`). A decided draft therefore always records its decider, and a missing sub
  cannot surface as a 23514/500.
- Tests (`DraftInvariantsTests`):
  - `Constraints_AcceptTheLifecycleStates`
  - `Constraints_RejectStatesTheStateMachineForbids`: six forbidden inserts plus an ad-hoc reopen update, each 23514
    on the named constraint.
  - `Migration033_IsIdempotent_AndLeavesAViolatedConstraintNotValid`: a scratch database migrated to 032 with an
    inconsistent accepted row. 033 runs twice without error, and `ck_ai_drafts_decided` stays NOT VALID while
    `ck_ai_drafts_accept` is validated. After the row is repaired, re-running 033 validates it.
- One existing test seed had to change because the finding makes the old state invalid:
  `LedgerBackfillTests` inserted `accepted` drafts without `decided_at`/`decided_by_sub`, and now sets both. The test's
  assertions are unchanged.

### automation-16

Status: fixed

- `POST /api/v1/authoring/qa/findings/:findingId/resolve` accepts an optional `reviewMs`: an integer from 0 to
  2147483647, capped at 30 minutes with `Drafts.ReviewMsCap`, and anything else is 400 `VALIDATION_ERROR`
  (`src_C/Vpc/Qa/QaRuns.cs:917`, `ParseResolveBody`).
- Every resolution, fixed or dismissed, records an `ai_qa_review` ledger row with units 0, outcome `success`,
  `actual_minutes = reviewMs/60000` (null when not measured) and dedupe key `qa-resolve:<findingId>`
  (`QaRuns.cs:798`). Its details are `{ resolution, severity, reviewTimeMeasured, rawReviewMs }`, where `rawReviewMs`
  appears only when clamped. The ledger's per-group clamp now offsets the per-card credit with the human triage time,
  including dismissed false positives. The existing `qa-fix:<id>` defect row for fixed blocker and major findings is
  unchanged.
- The console clock (DeckQaPage sending `reviewMs`, the way ReviewQueuePage does) is in `frontend/`, which is outside
  this issue's allowed paths. The server accepts and records it now, and a resolve without it is recorded as not
  measured. Wiring the page is a follow-up for the console wave.
- Test: `AiQaRunsTests.ResolveFinding_ChargesReviewTime_ForFixedAndDismissed` checks:
  - a dismissed major at 90 s → 1.5 min;
  - a fixed minor at 3 h → 30 min, with `rawReviewMs`;
  - an unmeasured dismiss → null minutes and `reviewTimeMeasured: false`;
  - a negative value → 400, with the finding still open.

### automation-17

Status: fixed

The chain is accept → QA → publish. With `AI_QA_ENABLED` on, nobody has to start QA by hand:

1. **Accept with `runQa: true`** (`src_C/Vpc/Review/Drafts.cs:487`, `:563`). After the accept commits,
   `QaRuns.StartChangedRunAsync` starts a `scope=changed` run for the deck: the new card and any other unreviewed
   change. If the deck already has an open run, it reuses that run, so accepting a batch does not stack runs. The
   response gains `qa: { status: queued | in_progress | nothing_to_review | not_started | disabled, runId, code, message }`.
   The flag is opt-in, and the response is unchanged without it.
2. **Publish refused with `AI_QA_REQUIRED`** (`src_C/Vpc/Qa/QaGate.cs:146-157`). The gate itself starts, or reuses,
   the run that would clear the refusal, and returns `error.runId` and `error.qaRun`, so the console can deep-link to
   it. `AI_QA_BLOCKED` (open blockers) starts nothing, because it needs a human decision.
3. Once the run is `done`, the author publishes again. The gate now passes, and the build is bound to the reviewed
   cards (backend-design-16).

`StartChangedRunAsync` (`src_C/Vpc/Qa/QaRuns.cs:297`) goes through the same checks as a console start, via the new
shared `StartRunAsync` (`:159`; `POST /qa/runs` now calls it too and answers exactly as before):

- stale-run reaping;
- one open run per deck;
- the per-run card cap;
- the daily-cap reservation.

It returns null, and does nothing, when `AI_QA_ENABLED` is off. It never throws, so neither the accept nor the
refusal changes because of it. The optional "publish when QA is clean" flag was not added: a publish stays an
explicit human action.

Tests (`AiQaChainTests`):

- `Accept_RunQa_QueuesAChangedRun_ThenReusesIt`
- `Accept_RunQa_WithAiQaDisabled_StartsNothing`
- `Accept_WithoutRunQa_IsUnchanged_AndRunQaMustBeBoolean`
- `PublishGate_AiQaRequired_StartsTheRun_AndReturnsItsId` (a second publish reuses the run)
- `PublishGate_WithoutQueue_StillRefuses_WithoutARun`

The `AiQaRunsTests` start tests all pass unchanged on the refactored start.

### cloud-security-resilience-2

Status: partially fixed

This closes what core-vpc can close:

- **Per-caller secrets on the verifying side.** There is a new overload `Auth.VerifyInternalSignature(req, callerSecretEnv)`
  (`src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:492-505`):
  - `AiQaResults` verifies `INTERNAL_SECRET_AI_QA_RESULTS` (`src_C/Vpc/Internal/AiQaResults.cs:45`, `:77`).
  - `WebhookDeliveryReport` verifies `INTERNAL_SECRET_WEBHOOK_REPORT` (`src_C/Vpc/Internal/WebhookDeliveryReport.cs`).

  When a route's secret is set, it is the only secret that route accepts: the shared secret and the other route's
  secret are refused. When it is unset, the route keeps the shared secret, so nothing breaks before the new secrets
  are provisioned. The other internal routes (entitlements, subscriptions) are unchanged.
- **A forged report must know the card content.** The results route no longer applies an item whose
  `contentSha256` differs from the item's stored hash (`AiQaResults.cs:152`): it is logged `hash_echo_mismatch` and
  counted as ignored. A leaked dispatcher credential plus the runId that card.flagged webhooks carry is no longer
  enough to mark an unpublished card `done`. The forger would also need the SHA-256 of that card's unpublished content.
- Tests:
  - `InternalCallerSecretTests.PerCallerSecrets_EachRouteAcceptsOnlyItsOwn`
  - `InternalCallerSecretTests.WithoutCallerSecrets_TheSharedSecretStillSigns`
  - `AiQaResultsTests.Results_CallerSecret_IsTheOnlySecretAccepted`
  - `AiQaResultsTests.Results_HashMismatch_IsNotApplied`: a forged hash marks nothing reviewed and bills nothing,
    while the real hash is still accepted.

Still open, and outside this issue's allowed paths (`src_C/`, `docs/delivery/r18-issues/`):

- Create the SSM leaves `/developercards/prod/ai-qa-results-secret` and `/developercards/prod/webhook-report-secret`.
- Map them to `INTERNAL_SECRET_AI_QA_RESULTS` and `INTERNAL_SECRET_WEBHOOK_REPORT` for core-vpc. The deploy wiring in
  `src_C/scripts/merge-env.sh` was deliberately not changed here, because secret env wiring is off-limits for this
  wave's workers.
- Give each Lambda role read access to only its own leaf, and remove `internal-shared-secret` from both roles
  (`infra/modules/identity/roles_r18.tf:47`, `:127`).
- Point `INTERNAL_SECRET_SSM_NAME` of the dispatcher and ai-qa at their own leaf (`infra/envs/prod/main.tf:147`, `:167`).

Once those are applied, the dispatcher holds no credential that can write AI QA results. Signing `v2` over
`ts.METHOD.path.body` needs the signers in `services/` to change as well, and is left to that follow-up; per-route
secrets already bind each signature to one route.

---

## Cross-wave contracts from the brief

- **`GET /api/v1/authoring/qa/status` `data.limits`.** This implements the shape exactly (`src_C/Vpc/Qa/QaRuns.cs:722`):
  - `maxCards` is `AI_QA_MAX_CARDS`, default 200;
  - `dailyUsdCap` is `AI_QA_DAILY_USD_CAP`, default 10;
  - `spentTodayUsd` is today's UTC reported spend;
  - `reservedTodayUsd` is the unfinished cards of open runs × `AI_QA_EST_USD_PER_CARD`.

  These are the same numbers a start is checked against (`SpendTodayAsync`). Test:
  `AiQaRunsTests.Status_ReportsTheLimitsAStartIsCheckedAgainst`.
- **ai-agent-6: core-vpc's `AgentClientPolicy`.** The policy's only non-deny entries are now exactly the endpoints
  `tools/mcp-server/src` calls (`src_C/Vpc/AgentClientPolicy.cs:21`):
  - `GET /api/v1/admin/decks`
  - `POST /api/v1/authoring/cards/similar`
  - `POST /api/v1/authoring/drafts`

  `/health`, `GET /api/v1/authoring/decks` and `GET /api/v1/authoring/drafts/:id` were dropped: the MCP server never
  calls them. The gateway authorizer split itself is `infra/` and belongs to the infra wave.

  Test: `AgentClientPolicyTests.Allows_ExactlyTheMcpServerEndpoints` reads the MCP server's sources and fails if the
  two ever drift apart. Existing assertions changed because the contract makes the old behaviour wrong:
  - `Allows_Table`: the three dropped routes are now `false`;
  - `AgentClient_McpRoutes_AreAllowed`: reading its own draft is now 403 `AGENT_CLIENT_FORBIDDEN`.

## Verification

- `dotnet test src_C/RecallSmith.Lambda.sln`: 1650 passed, 0 failed (1627 before this issue, plus 23 new tests).
- `bash /Users/qc/.rimv-delivery/r18y-s/briefs/Y02.verify.sh`: `Y02 VERIFY OK`.
