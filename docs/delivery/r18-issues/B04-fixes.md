# B04 — fixes ledger (R18B wave P, issue #443)

Automation infra and runbooks: step-failure and tick-heartbeat alarms, async no-retry, notifier
concurrency, cost alarm covers GPT-5.5, emergency stop and operating runbook. Paths: `infra/`,
`docs/runbooks/`, `docs/delivery/r18-issues/` only; the code sides of K2, K3, K4 and K5 land in the
parallel waves (src_C, services).

The infra test is the read-only real-backend `terraform plan` of `infra/envs/prod` checked by
`infra/scripts/check-plan.py` against `docs/delivery/r18-issues/B04.plan-allow.json` (step 3 of
`B04.verify.sh`). On the base tree the plan is empty and that file is missing, so the check fails; with
this branch the plan is exactly the six entries of the allow file (3 to add, 3 to change, 0 to destroy):

| Address | Action | Keys |
|---|---|---|
| `module.observability.aws_cloudwatch_metric_alarm.ai_qa_daily_cost` | update | `metric_query` |
| `module.observability.aws_cloudwatch_metric_alarm.automation_step_failures` | create | |
| `module.observability.aws_cloudwatch_metric_alarm.automation_tick_missing` | update | `alarm_description`, `dimensions`, `metric_name`, `namespace` |
| `module.worker.aws_lambda_function.notifier` | update | `reserved_concurrent_executions` |
| `module.worker.aws_lambda_function_event_invoke_config.notifier_prod` | create | |
| `module.worker.aws_lambda_function_event_invoke_config.source_watcher_prod` | create | |

### cloud-security-resilience-1

Status: fixed (B04's side: the runbook; the K2 newest-gate semantics in `AutomationMode.EffectiveAsync` and
its test are the src_C wave's side).

- `infra/RUNBOOK.md` §7 "Emergency stop" (from line 218): new step 0 "Revoke the active eval gate"
  (console Overview → eval-gate card → *Revoke gate*, or `POST /api/v1/admin/automation/eval-gate/<gateId>/revoke`;
  instant: effective live → dry_run, no deploy; K2 makes the newest gate the only one that counts).
- Steps 1 and 2 now say they do **not** stop auto-accept/auto-publish (the runner's complete route and AI QA
  results finalise runs and start publishes without any schedule). The old claim "each step on its own takes
  effect at once" as a full stop is replaced; step 3 (`AUTOMATION_MODE=off` + deploy) is named the only
  complete server-side stop.
- New step 4: stop the local runner with `tools/author-runner/scripts/uninstall.sh` (`DRY_RUN=1` first).
- The undo paragraph: live comes back only with a new passed gate; link to the rollback section of
  `docs/runbooks/automation-operations.md`.
- Test: documentation; `frontend/tests/docsPaths.test.ts` (every cited repository path exists) passes.

### backend-design-3

Status: fixed (B04's side: the K4 alarm; the gauge emission, `failedSteps` and their tests are the src_C and
notifier waves' side).

- `infra/modules/observability/alarms_r18a.tf:113-131`: `aws_cloudwatch_metric_alarm.automation_step_failures`,
  `developercards-${env}-automation-step-failures`, namespace `var.metrics_namespace` (`DeveloperCards`),
  metric `AutomationStepFailures`, no dimensions (the dimensionless `RouteMetrics.EmitGauge` convention,
  exactly as `automation_notify_enqueue_failures` above it), `Sum >= 1` over one 3600 s period,
  `treat_missing_data = notBreaching`, alarm and OK actions on the alerts topic.
- `infra/RUNBOOK.md` alarm list: one line for `automation-step-failures` (what fired, first check).
- Test: the plan check (`automation_step_failures` create in `B04.plan-allow.json`).

### cloud-security-resilience-3

Status: fixed.

- `infra/modules/worker/automation.tf:77-82` `aws_lambda_function_event_invoke_config.notifier_prod` and
  `:138-143` `aws_lambda_function_event_invoke_config.source_watcher_prod`: `qualifier` = the `prod` alias,
  `maximum_retry_attempts = 0`, `maximum_event_age_in_seconds = 900`. 900 s: the watcher runs hourly and the
  tick every 15 minutes, so an async event older than 15 minutes is superseded by the next scheduled run; the
  weekly digest's only queueing risk is throttling, which reserved concurrency 4 removes (below). The config
  applies to async invocations only; the SQS mapping invokes synchronously and keeps its own receive count.
  The Scheduler `retry_policy` values are unchanged (they cover a failed hand-off to Lambda, not a function
  error).
- `infra/RUNBOOK.md` §7 intro documents it.
- Test: the plan check (two creates).

### cloud-security-resilience-4

Status: fixed.

- `infra/modules/worker/automation.tf:49`: notifier `reserved_concurrent_executions` 2 → 4, ESM
  `maximum_concurrency` stays 2. Numbers: the email mapping may hold 2; the tick (every 15 min) and the
  Monday digest (08:00 NZ, which can coincide with a tick) each need 1; async retries are now 0 (above), so no
  retry takes a slot. 2 + 1 + 1 = 4 means no scheduled invocation can throttle an email delivery. The account
  has 951 unreserved concurrent executions of 1000 (read-only `aws lambda get-account-settings`), so 2 more
  reserved is well within the 100-unreserved floor. Not a count cap: it bounds parallel executions only.
- `infra/RUNBOOK.md`: the tick-missing line says "reserved concurrency 4"; the §7 intro gives the arithmetic.
- Test: the plan check (`aws_lambda_function.notifier` update, key `reserved_concurrent_executions` only).

### cloud-security-resilience-5

Status: fixed (K5; the notifier already emits `AutomationTicks` on this base, `services/notifier/src/notifier/emf.py`
`TICKS`, `handler.py` `_handle_job`).

- `infra/modules/observability/alarms_r18a.tf:53-76` `automation_tick_missing`: namespace
  `var.metrics_namespace` (`DeveloperCards`, the notifier's `METRICS_NAMESPACE`), metric `AutomationTicks`,
  dimensions `{ Service = "notifier" }` — exactly what `emf.emit` writes for `tick()` (one dimension set,
  `["Service"]`, `SERVICE = "notifier"`). Threshold, periods and `treat_missing_data = breaching` unchanged;
  `actions_enabled = false` with `ignore_changes = [actions_enabled]` kept as is. The description now names the
  heartbeat.
- `infra/RUNBOOK.md` alarm list updated.
- Test: the plan check (update, keys `alarm_description`, `dimensions`, `metric_name`, `namespace` only;
  `actions_enabled` is not touched).

### automation-8

Status: fixed.

- New `docs/runbooks/automation-operations.md`: the one switch and the keys that shape a rollout; rollout
  off → dry_run → AI QA on → eval gate → two-week dry run → live with `AUTOMATION_AUTO_PUBLISH=0` → auto-publish,
  each with commands and checks; a promotion checklist with numbers (the gate's A00 §15.3 thresholds, a ~50-card
  human spot-check of the jury labels at ≥ 0.95 agreement, ≥ 2 weeks dry run, shadow agreement ≥ 0.95 over ≥ 100
  blinded human-decided would-accept drafts with zero factual-error rejects, `AUTOMATION_DECK_SLUGS` restricted
  to the gated decks `aws-saa-c03,claude-ccdv-f`); one line per exception subkind including `agent_note` (K3);
  how to read each Automation tab; rollback, including undoing an auto-accepted/auto-published card (revoke,
  delete in the console, human publish; the stable id stays reserved so `EXISTING_CARD` prevents re-acceptance).
- Linked from `infra/RUNBOOK.md` §7 (intro and the emergency-stop undo paragraph). The Automation page's mode
  banner is frontend (another wave's root) and is not changed here.
- Test: `frontend/tests/docsPaths.test.ts` passes with the new page (every cited path exists).

### supervisor-1

Status: fixed.

- `infra/modules/observability/alarms_r18.tf:242-244`: the `ai_qa_daily_cost` `metric_query` set is
  `["bedrock", "anthropic", "bedrock-converse"]`, same metric (`AiQaEstimatedCostMicroUsd`,
  `Service = ai-qa`, `Provider = <provider>`, the dimensions `services/ai-qa/src/ai_qa/emf.py` writes), same
  86400 s Sum, same threshold; `SUM(METRICS())` is therefore the total of every ai-qa provider. The query id
  maps `-` to `_` (`cost_bedrock_converse`), because CloudWatch metric-query ids allow no hyphen; the two
  existing ids are unchanged.
- Test: the plan check (`ai_qa_daily_cost` update, key `metric_query` only).

## Contract

- **K2** (runbook side): §7 step 0 relies on "only the newest gate row counts"; the operations runbook states
  that a revoke or a newer failed gate drops live to dry_run and that an older passed gate never takes over.
- **K3** (runbook side): `agent_note` has its own line in the exception list; the Runs tab and batch-summary
  "Agent notes:" line are described.
- **K4**: alarm `developercards-${env}-automation-step-failures` on the dimensionless core gauge
  `AutomationStepFailures` in `DeveloperCards`, Sum ≥ 1 over 3600 s, one period, notBreaching, alerts topic.
  The runbook names the notifier's `tick_steps_failed` warn event (`failedSteps`).
- **K5**: `automation-tick-missing` watches `DeveloperCards` / `AutomationTicks` / `Service = notifier`
  instead of `AWS/Lambda` `Invocations`; its actions-enabled lifecycle is unchanged.
- **K7** (runbook side): the Overview backlog and the Decisions labelling of person-handled `human` decisions
  are described in "Reading the Automation page".
- K1 and K6 are not touched by B04 (the runbook names the reviewer triple `qa-v4-auto` from K1 only as a check).
