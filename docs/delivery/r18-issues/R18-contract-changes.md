# R18 contract changes (fix waves X, Y and Z01)

The R18 interface contract (`R18-00-contracts.md`) lives in the delivery control directory, outside this
repository, and was never edited by the fix waves. Each wave recorded the changes it made in its own ledger
table. This file brings them together in one place inside the repository. Consumers such as the console,
the n8n recipe and the MCP server can read it here, and code and changelog change in the same PR from now on.
Where this file and `R18-00-contracts.md` disagree, this file and the code win.

Line numbers are for the tip of `delivery/r18zs/Z01-385`. The "Source" column names the ledger (under
`docs/delivery/r18-issues/`) with the full reasoning and tests.

## Routes

| Contract item | Was | Now | Code | Source |
|---|---|---|---|---|
| §2 webhook admin | — | new super_admin `POST /api/v1/admin/webhooks/deliveries/sweep` `{limit?}` → `{swept, resent, enqueueFailures, deliveryIds}`; audited `webhook.deliveries.sweep` | `src_C/Vpc/VpcFunction.cs:252-254`, `src_C/Vpc/Integrations/WebhookDeliveries.cs:174` | X01 automation-1 |
| §2 webhook admin list | items `deliveryId … deliveredAt` | adds `enqueuedAt` (null until SQS accepted the hand-off) | `src_C/Vpc/Integrations/WebhookDeliveries.cs:85`, `:111` | Z01 backend-design-21 |
| §2 redeliver | copies the row, source untouched | copies the row; a source that never reached the dispatcher (`enqueue_failed`, or `queued` with 0 attempts, no `enqueued_at`, untouched 10 min) is set `failed` / `superseded by redelivery <newId>` in the same transaction | `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:426-437`, `:479` | Z01 automation-19 |
| §7.2 QA waiver | — | new super_admin `POST /api/v1/authoring/qa/runs/:runId/items/:cardId/waive` `{note}`; run detail items gain `waivedBySub`, `waivedAt`, `waiveNote` | `src_C/Vpc/VpcFunction.cs:307` | X02 ai-agent-16 |
| §7.2 `GET /qa/status` | — | `data.limits = { maxCards, dailyUsdCap, spentTodayUsd, reservedTodayUsd }` | `src_C/Vpc/Qa/QaRuns.cs` (`QaStatus`) | Y02 (brief) |
| §7.2 resolve body | `resolution`, `note` | also optional `reviewMs` (integer ≥ 0, capped at 30 min) | `src_C/Vpc/Qa/QaRuns.cs` | Y02 automation-16 |
| §8.3 accept body / response | — | optional boolean `runQa`; when true the response carries `qa: { status, runId, code, message }` | `src_C/Vpc/Review/Drafts.cs` | Y02 automation-17 |
| internal route dispatch | `EndsWith` suffix match | exact path match | `src_C/Vpc/VpcFunction.cs:399` | X01 cloud-security-resilience-2 |
| §10.3 console-dev token | same groups, only the client differs | core-vpc limits a console-dev token to `GET /api/v1/admin/decks`, `POST /api/v1/authoring/cards/similar`, `POST /api/v1/authoring/drafts`; anything else is 403 `AGENT_CLIENT_FORBIDDEN` | `src_C/Vpc/AgentClientPolicy.cs:15` | X02 / Y02 ai-agent-6 |

## Error codes

| Code | Where | Meaning | Code | Source |
|---|---|---|---|---|
| `AI_QA_STALE` | 409 on publish; Worker job failure | the cards changed between the AI QA gate and the request's re-read (409) or the build (FAILED job). Publish again. Emits gauge `AiQaStale` | `src_C/Shared/RecallSmith.Lambda.Db/PublishSnapshot.cs:22`, `src_C/Vpc/Authoring/Publish.cs:324-327`, `src_C/Worker/Services/PublishJobProcessor.cs:77-79` | Y02 backend-design-16, Z01 backend-design-20 |
| `AI_QA_REQUIRED` (extended) | 409 on publish | also carries `error.runId` and `error.qaRun` (the run the gate started or reused) | `src_C/Vpc/Qa/QaGate.cs` | Y02 automation-17 |
| `AGENT_CLIENT_FORBIDDEN` | 403 | a console-dev token on a route outside the three agent routes | `src_C/Vpc/AgentClientPolicy.cs` | X02 ai-agent-6 |
| `ALL_ITEMS_FAILED` | run `error_code` | every item of a finished run is `error`/`refused`/`skipped`: the run is `failed`, not `done` | `src_C/Vpc/Internal/AiQaResults.cs` (run recompute) | X02 backend-design-5 |

The console's gate-code list (`frontend/src/lib/qaGate.ts:9`) knows only `AI_QA_REQUIRED` and `AI_QA_BLOCKED`;
adding `AI_QA_STALE` there is the console wave's change (outside `src_C`).

## AI QA results (§7.7) and the publish gate (§7.10)

| Contract item | Was | Now | Code | Source |
|---|---|---|---|---|
| §7.7 ledger dedupe key | `qa:<runId>:<chunk>` | `qa:<runId>:<chunk>:<first 16 hex of SHA-256 over the sorted cardId:newStatus transitions>` | `src_C/Vpc/Internal/AiQaResults.cs:402` | X01 backend-design-1 |
| §7.7 item usage | each report overwrites tokens and cost | a report with a new `requestId` adds; a replay of the same `requestId` keeps the larger value; a kept item still adds a new attempt's usage | `src_C/Vpc/Internal/AiQaResults.cs` (`IsNewAttempt`) | X02 backend-design-6 |
| §7.7 run status | `queued = 0 ⇒ done` | `queued = 0` and no item `done` ⇒ `failed` / `ALL_ITEMS_FAILED` | `src_C/Vpc/Internal/AiQaResults.cs` | X02 backend-design-5 |
| §7.7 hash echo | a mismatch is applied | a mismatch is logged `hash_echo_mismatch` and the item is not applied; counted as `mismatched` (not `ignored`) in the ledger details and the outcome log, gauge `AiQaHashMismatch` once per report | `src_C/Vpc/Internal/AiQaResults.cs:51`, `:156`, `:333` | Y02 cloud-security-resilience-2, Z01 backend-design-20 |
| §7.7 findings of a done item | "replace that item's findings" on a repeated report | a `done` item is final for the run: a later report (a retried chunk's new model sample, or a replay) neither changes its status nor replaces, deletes or renumbers its findings; a new attempt's usage is still billed | `src_C/Vpc/Internal/AiQaResults.cs:167`, `:209` | Z01 backend-design-19 |
| §7.2 / §7.7 `prompt_version` | `qa-v1`, pinned by core at start; "set when null" | null until a chunk reports, then the version the Lambda reported (last report wins); stored per item too (033) | `src_C/Vpc/Internal/AiQaResults.cs` (run recompute) | Y02 backend-design-12 |
| §7.4 message `promptVersion` | `qa-v1` | `qa-v3` = `QaRuns.PromptVersion`, equal to the ai-qa Lambda's `PROMPT_VERSION` (contract test) | `src_C/Vpc/Qa/QaRuns.cs:30` | Y02 backend-design-12 |
| §7.2 daily cap | `spent ≥ cap ⇒ 429` | `spent ≥ cap` or `spent + open reservations + this run's estimate > cap ⇒ 429`, under an advisory lock | `src_C/Vpc/Qa/QaRuns.cs:37` | X02 backend-design-6 |
| §7.10 gate | a `done` item at the current hash | a `done` item, or an owner-waived `error`/`refused` item, at the current hash | `src_C/Vpc/Qa/QaGate.cs` | X02 ai-agent-16 |
| §7.10 publish binding | gate at request time only | a gated publish stores `deck_publishes.qa_snapshot_sha256`; the Worker refuses to build other cards (`AI_QA_STALE`) | `src_C/Shared/RecallSmith.Lambda.Db/PublishSnapshot.cs` | Y02 backend-design-16 |

## Webhooks (§6)

| Contract item | Was | Now | Code | Source |
|---|---|---|---|---|
| §6 delivery status | a `retry` for an inactive subscription stays `retrying` | written as `failed` / `subscription inactive`; `delivered` and `failed` sticky; `dead` sticky except against `delivered` (DLQ redrive); stale attempts ignored | `src_C/Vpc/Internal/WebhookDeliveryReport.cs:173-177` | X01 backend-design-3/-8, Y01 automation-12; full table pinned by Z01 backend-design-23 |
| §6 `webhook_deliveries.enqueued_at` | — | nullable column (032), set when SQS accepts the message | `src_C/Vpc/Db/Migrations/032_webhook_deliveries_enqueued_at.sql`, `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:598` | Y01 backend-design-13 |
| §6 sweep predicate | `enqueue_failed`, or `queued` with 0 attempts | the same **and** `enqueued_at is null`, untouched 10 min, live subscription | `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:467` | Y01 backend-design-13 |
| §6.1 `deck.published` eventId | random per emission | deterministic per publish job (`DerivedEventId("deck.published:<jobId>")`) | `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:260` | Y01 automation-1 |
| §6.3 event body | data, environment, event, eventId, occurredAt | the same five keys, then `schemaVersion: 1` | `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:93-104` | Y01 automation-7 |

## Automation Ledger (§9)

| Contract item | Was | Now | Code | Source |
|---|---|---|---|---|
| §9.3 webhook_notification dedupe | `webhook:<deliveryId>` | `webhook:<eventId>:<subscriptionId>` | `src_C/Vpc/Internal/WebhookDeliveryReport.cs:152` | X01 automation-10 |
| §9.3 draft reject row | only the 4 defect reasons | every reject, `units 0`, `actual_minutes = reviewMs/60000` (capped at 30 min), `details {reason, defect, reviewTimeMeasured, rawReviewMs?}` | `src_C/Vpc/Review/Drafts.cs` | X01 automation-4, Y01 automation-13 |
| §9.4 `GET /ledger` headline | per-row clamp (R18), then per (period, automation, source) (Y01) | `max(0, Σ net)` once per (automation, source) over `[from, to)`, independent of `granularity`; additive `totals.bySource`, `totals.byBaselineSource`, `agentDrafts` | `src_C/Vpc/Ledger/LedgerRoutes.cs:108` | X01 automation-4/-11, Z01 automation-18 |
| §9.4 `GET /ledger` series | clamped per period | `minutesSaved` keeps its meaning and is never negative: `Σ max(0, net)` clamped per (period, automation, source), summed per (period, automation). The additive `netMinutes` is the signed `Σ net` per (period, automation) and may be negative. Σ `netMinutes` per automation over the range is the unclamped net; Σ `minutesSaved` can exceed the headline, which is clamped once over the range | `src_C/Vpc/Ledger/LedgerRoutes.cs:155-156`, `:227-228` | Z01 automation-18 (Z01 briefly sent the signed net as `minutesSaved`); backend-design-24 restored it |
| §9.4 agentDrafts | — | additive `reviewNotMeasured`; `avgReviewMinutes` over values capped at 30 min | `src_C/Vpc/Ledger/LedgerRoutes.cs` | Y01 automation-13 |
| §9.5 backfill heuristic | every deck-minute with ≥ 5 cards | only cards created before `live_since`, never an accepted AI draft | `src_C/Vpc/Ledger/LedgerRoutes.cs` (backfill import) | X01 backend-design-2 |

The console (backend-design-24) draws each bar from `minutesSaved`, so a bar is never negative
(`frontend/src/lib/ledgerView.ts` `ledgerBarHeight` also floors a negative value at 0), shows `netMinutes` in the
bar's title when it differs, and lists it in the chart's data table. The printed "Minutes saved" definition
(`frontend/src/lib/ledgerView.ts:188`) states both grains: the headline once per automation and source over the
selected range, each bar within its period, and net minutes as the same sums without the `max(0, …)`.

## Drafts (§8) and grounding

| Contract item | Was | Now | Code | Source |
|---|---|---|---|---|
| §8.1 draft `card.source` | `{url, quote}`, unknown keys rejected | a draft's source may also carry `grounding = {chunkId: string, sourceId: string, matched: true, quoteChars: int}`. It is validated, kept on `ai_drafts.card` and returned by `GET /drafts/:id`; other grounding keys are dropped. It is stripped on accept, so published cards and deck builds never carry it, and it does not count as an edit | `src_C/Vpc/Review/DraftCard.cs:113`, `:161`, `:204`, `src_C/Vpc/Review/Drafts.cs:513-515` | Z01 (cross-wave contract ai-agent-24) |
| MCP `submit_draft` result | §8.3 `data` | also a `grounding` array for the agent (tool result only) | `tools/mcp-server/src/grounding.ts` | X05, Y06 |

## Migrations

| Migration | Adds | Source |
|---|---|---|
| `src_C/Vpc/Db/Migrations/032_webhook_deliveries_enqueued_at.sql` | `webhook_deliveries.enqueued_at` (nullable, backfilled for reported rows) and a partial index for stranded rows | Y01 backend-design-13 |
| `src_C/Vpc/Db/Migrations/033_ai_qa_drafts_round2.sql` | `ai_drafts` lifecycle CHECK constraints, `ai_qa_items.prompt_version`, `deck_publishes.qa_snapshot_sha256` | Y02 backend-design-12/-16/-18 |

Z01 adds no migration.

## Environment keys and SSM leaves

| Key / leaf | Read by | Meaning | Code | Source |
|---|---|---|---|---|
| `AUTH_AGENT_CLIENT_IDS` | core-vpc | app client ids treated as the local authoring agent (default the console-dev client id) | `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:76`, `src_C/env/prod.env.json` | X02 ai-agent-6 |
| `AI_QA_EST_USD_PER_CARD` | core-vpc | per-card estimate for the daily-cap reservation (default 0.05) | `src_C/Vpc/Qa/QaRuns.cs:37` | X02 backend-design-6 |
| `INTERNAL_SECRET_AI_QA_RESULTS` / SSM `ai-qa-results-secret` | core-vpc | the AI QA results route's own HMAC secret; when set, the shared secret is refused on that route | `src_C/Vpc/Internal/AiQaResults.cs:45`, `src_C/scripts/merge-env.sh:12` | Y02 / Z01 cloud-security-resilience-2 |
| `INTERNAL_SECRET_WEBHOOK_REPORT` / SSM `webhook-report-secret` | core-vpc | the delivery-report route's own HMAC secret | `src_C/Vpc/Internal/WebhookDeliveryReport.cs:29`, `src_C/scripts/merge-env.sh:12` | Y02 / Z01 cloud-security-resilience-2 |
| `INTERNAL_SHARED_SECRET_PREVIOUS` / SSM `internal-shared-secret-previous` | core-vpc | optional; accepted beside `INTERNAL_SHARED_SECRET` while a rotation is in progress. The same `_PREVIOUS` suffix applies to each route secret (`ai-qa-results-secret-previous`, `webhook-report-secret-previous`) | `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:498`, `:531-542`, `src_C/scripts/merge-env.sh:12` | Z01 cloud-security-resilience-11 |
| optional-key cleanup | deploy.sh | the keys above are removed from core-vpc's environment when their leaf is gone | `src_C/scripts/merge-env.sh:17`, `:66`, `src_C/deploy.sh:65` | Z01 cloud-security-resilience-11 |
| skipped leaves | deploy.sh | `webhook-signing-secret`, `anthropic-api-key`, any unmapped `*-previous`, `webhook-signing-secret-sub-<id>[-previous]` never become core env keys and never fail a deploy | `src_C/scripts/merge-env.sh:27` | Y01 cloud-security-resilience-10, Z01 cloud-security-resilience-15 |

## Metrics (namespace `DeveloperCards`, dimensionless gauges)

| Metric | Emitted at | Source |
|---|---|---|
| `LedgerWriteFailures`, `AiQaEnqueueFailures`, `QaGateRefusals` | see `docs/delivery/r18-issues/X01-fixes.md` | X01 |
| `AiQaHashMismatch` | once per results report (0 when none) — `src_C/Vpc/Internal/AiQaResults.cs:333` | Z01 backend-design-20 |
| `AiQaStale` | each `AI_QA_STALE` refusal — `src_C/Vpc/Authoring/Publish.cs:325`, `src_C/Worker/Services/PublishJobProcessor.cs:78` | Z01 backend-design-20 |
