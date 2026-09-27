# X08 — per-finding ledger

Scope: `infra/` and `docs/delivery/r18-issues/` only. The plan is gated by
`docs/delivery/r18-issues/X08.plan-allow.json` (18 effective entries: 2 route updates, 2 stage
`route_settings` updates, 1 dispatcher policy update, 13 alarm creates). The supervisor applies after
merge; nothing was applied by the worker.

Tests (infra): `X08.verify.sh` step 3 — `terraform fmt -check`, `terraform validate`, the real-backend
read-only plan checked by `infra/scripts/check-plan.py --allow X08.plan-allow.json` (every effective
change listed with its action and, for updates, its changed keys; a stale or unlisted entry fails),
and the plan-shape assertion (both internal routes carry the exact keys, no `/api/internal/` route
key contains `{proxy+}`). On the base tree that assertion fails (`POST /api/internal/webhooks/{proxy+}`
!= `POST /api/internal/webhooks/deliveries/report`), and the allow file's 13 alarm creates and the
policy update are stale there.

### cloud-security-resilience-2

Status: fixed (infra side, as this issue scopes it; the core-vpc half is listed below as a follow-up)

- `infra/modules/api/gateway.tf:42-48` — `internal_webhooks` is now `POST /api/internal/webhooks/deliveries/report`
  and `internal_ai_qa` is `POST /api/internal/ai-qa/results` (auth NONE, same `core_vpc` integration).
  The map keys are unchanged, so both are in-place `route_key` updates at the same addresses.
- `infra/modules/api/gateway.tf:67-68` — the per-route throttles (20/10 on both stages) follow the new keys.
- Effect: `POST /api/internal/webhooks/x/api/internal/entitlements/apply` (and any other path under the
  two old prefixes) no longer matches an unauthenticated route. It falls to `ANY /{proxy+}` and needs
  the console JWT, which restores E00 §4.2 and R18-00 §14 #3 ("the existing 501 stubs stay behind
  the JWT"). The only unauthenticated `/api/internal/*` paths are the two that the dispatcher
  (`handler.py:31 REPORT_PATH`) and ai-qa (`internal_client.py:20 RESULTS_PATH`) actually call.
- Tests: `X08.verify.sh` plan-shape assertion (exact keys at both addresses; no greedy
  `/api/internal/` key remains); `check-plan.py` against `X08.plan-allow.json` (`route_key` is the
  only changed key on each route, `route_settings` the only one on each stage).
- Not in this issue's allowed paths (follow-up for the core-vpc owner): exact path equality instead of
  `EndsWith` for the four `/api/internal/*` handlers in `src_C/Vpc/VpcFunction.cs:390-402`, and a
  method+path signature or per-caller secret in `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs`.
  With exact gateway keys these are defence in depth: the gateway no longer delivers a crafted path
  to core-vpc without a JWT.

### cloud-security-resilience-5

Status: fixed

- `infra/modules/observability/alarms_r18.tf:120` `webhook_report_failures` — WebhookReportFailures
  (Service=webhook-dispatcher) Sum ≥ 1 / 900 s (stale delivery row after a report failure).
- `alarms_r18.tf:103` `webhook_delivery_dead` — WebhookDeliveryAttempts (Service=webhook-dispatcher,
  Outcome=dead) Sum ≥ 1 / 300 s.
- `alarms_r18.tf:185` `ai_qa_fatal_errors` (for_each PROVIDER_AUTH, PROVIDER_ACCESS_DENIED, CONFIG) —
  AiQaErrors (Service=ai-qa, ErrorCode=<code>) Sum ≥ 1 / 300 s each; these are acked and never reach
  the DLQ.
- `alarms_r18.tf:203` `ai_qa_refusals` — AiQaRefusals (Service=ai-qa) Sum ≥ 3 / 3600 s.
- `alarms_r18.tf:222` `ai_qa_daily_cost` — metric math `SUM(METRICS())` over AiQaEstimatedCostMicroUsd
  (Service=ai-qa, Provider=bedrock and Provider=anthropic; the emitter's only dimension set,
  contract §7.8), Sum per 86400 s > `ai_qa_daily_cost_cap_micro_usd` (default 10 000 000 = the
  10 USD `AI_QA_DAILY_USD_CAP`, `variables.tf`). Covers the Anthropic-API provider the AWS budget
  cannot see, and a run that started under the cap and overshot it.
- `alarms_r18.tf:255` `webhook_queue_oldest_age` (> 3600 s; the retry schedule 30+120+480+900 s spans
  about 26 min) and `:272` `ai_qa_queue_oldest_age` (> 7200 s; two receives of the 3600 s visibility)
  — ApproximateAgeOfOldestMessage, Maximum / 300 s, the publish-queue precedent (`alarms.tf:135`).
  Queue names come from new worker outputs `webhook_queue_name` / `ai_qa_queue_name`
  (`infra/modules/worker/outputs.tf:61,65`) wired in `infra/envs/prod/main.tf:195,199`.
- Thresholds documented in `infra/README.md` §6 (2026-09-27 X08 row table); runbook `infra/RUNBOOK.md` §7.
- Tests: `check-plan.py` against `X08.plan-allow.json` (each alarm is a listed `create`);
  `terraform validate` (dimension/metric-query shape).

### automation-5

Status: fixed

- `alarms_r18.tf:86` `webhook_delivery_failed` — WebhookDeliveryAttempts (Service=webhook-dispatcher,
  Outcome=failed) Sum ≥ 1 / 300 s: a permanent failure (401 after a secret mismatch, 404, 410, any
  non-2xx other than 408/429/5xx, or `URL_REJECTED`), acked at once, never in the DLQ.
- `alarms_r18.tf:137` `webhook_enqueue_failures` — WebhookEnqueueFailures, **no dimensions**, Sum ≥ 1 /
  300 s. That is exactly what core-vpc/worker emit: `RouteMetrics.EmitGauge` →
  `BuildGaugeLine` writes `Dimensions: [[]]` in namespace `DeveloperCards` (`WebhookEvents.cs:201,208,254`).
- `alarms_r18.tf:120` `webhook_report_failures` — Sum ≥ 1 / 900 s. The finding suggested ≥ 3 and
  cloud-security-resilience-5 suggested ≥ 1 for the same metric; one alarm with the stricter
  threshold, because each report failure is one delivery row left stale.
- METRIC CONTRACT gauges (same no-dimension EmitGauge convention): `alarms_r18.tf:153`
  `ledger_write_failures` (LedgerWriteFailures) and `:169` `ai_qa_enqueue_failures`
  (AiQaEnqueueFailures), Sum ≥ 1 / 300 s each. `QaGateRefusals` is informational and gets no alarm.
- Outcome values (webhook-dispatcher `emf.py OUTCOMES`, `handler.py:215-220`): `delivered`; `retry`
  (retryable, attempt < 5); `failed` = **permanent** (non-retryable) failure, acked; `dead` = **gave
  up** after the last (5th) retryable attempt, left for the DLQ. The two alarms use `failed` and
  `dead` respectively.
- Runbook: one line per alarm in `infra/RUNBOOK.md` §7 (the dispatcher README is under `services/`,
  outside this issue's allowed paths).
- Tests: `check-plan.py` against `X08.plan-allow.json`; `terraform validate`.

### Rotation read grant (Specific direction, not an audit finding)

- `infra/modules/identity/roles_r18.tf:41-47` — policy `developercards-webhook-dispatcher-scoped`
  SsmRead gains `ssm:GetParameter` on `/developercards/prod/webhook-signing-secret-previous`, which the
  X03 dispatcher reads during a signing-secret rotation (`settings.previous_secret_name`). The
  parameter is not created by Terraform. Test: `check-plan.py` (`policy` is the only changed key).
