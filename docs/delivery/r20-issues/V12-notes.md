# V12 notes: AI QA dashboard row and per-provider p95 latency alarms

Issue #566, contract R20-00 §8 (Infra) and facts-infra.md §3. Code only: nothing was planned or
applied, and no AWS call was made.

## What changed

| File | Change |
|---|---|
| `infra/modules/observability/dashboard.tf` | Eight new entries in `local.dashboard_widgets`: a text header "AI QA" at y=54 and seven metric widgets from y=56. |
| `infra/modules/observability/alarms_r20.tf` (new) | `local.ai_qa_providers` and the `for_each` alarm `aws_cloudwatch_metric_alarm.ai_qa_latency_p95`. |
| `infra/modules/observability/tests/ai_qa_r20.tftest.hcl` (new) | Offline `terraform test` for both. |
| `docs/delivery/r20-issues/V12.plan-allow.json` (new) | Allow file for `infra/scripts/check-plan.py --allow`. |
| `infra/README.md` | §6 change-log entry for V12, with the alarm table row and the runbook text. |

## Surface shipped

**Dashboard `developercards-prod`.** All widgets read namespace `var.metrics_namespace`
(DeveloperCards) with `Service = ai-qa`:

| y | x=0 (w 12, h 6) | x=12 (w 12, h 6) |
|---|---|---|
| 54 | text "AI QA …" (w 24, h 2) | |
| 56 | AI QA cards reviewed by Provider: SEARCH `AiQaCardsReviewed` over `{ns,Provider,Service}`, Sum 300 | AI QA tokens by Provider (input / output / cache read): three SEARCH lines for `AiQaInputTokens`, `AiQaOutputTokens` and `AiQaCacheReadTokens`, Sum 300 |
| 62 | AI QA estimated cost per day (USD): hidden `AiQaEstimatedCostMicroUsd` per provider, Sum, period 86400; visible `FILL(cost_<p>, 0) / 1000000` per provider and the total | AI QA latency p50 / p95 by Provider: `AiQaLatency` p50 and p95 for each of the four providers, with a 120 000 ms annotation |
| 68 | AI QA errors by ErrorCode: SEARCH `AiQaErrors` over `{ns,ErrorCode,Service}`, Sum 300 | AI QA findings by Severity: `AiQaFindings` for blocker, major and minor, Sum |
| 74 | AI QA refusals: `AiQaRefusals`, Sum 3600, with a 3 / h annotation (the existing alarm) | |

**Alarms.** `module.observability.aws_cloudwatch_metric_alarm.ai_qa_latency_p95["<provider>"]`:
- One alarm per provider: `bedrock`, `anthropic`, `bedrock-converse` and `openai-mantle`.
- Name: `developercards-prod-ai-qa-latency-p95-<provider>`.
- Metric: `AiQaLatency`, `extended_statistic = "p95"`, dimensions `{ Service = "ai-qa", Provider = <provider> }`.
- Fires when the value is `GreaterThanThreshold` 120000 (ms), period 3600, 1 of 1 datapoints.
- `treat_missing_data = "notBreaching"`.
- `alarm_actions` and `ok_actions` both go to `aws_sns_topic.alerts.arn`.

The header comment follows the X08 convention: it names the emitter and dimensions and points to
infra/README.md §6.

**Plan allow file.** The dashboard is listed as `update` with keys `["dashboard_body"]`, and each of
the four alarm instances as `create`.

## How it is tested

- `infra/modules/observability/tests/ai_qa_r20.tftest.hcl` uses `mock_provider "aws"` and pins the
  alerts topic ARN with `override_resource`. Nothing reaches AWS and no credentials are needed.
  - Run `ai_qa_latency_p95_alarm_per_provider`: checks the exact set of for_each keys, every
    alarm argument listed above, and that `statistic` is unset.
  - Run `ai_qa_dashboard_row`: decodes `dashboard_body` and checks:
    - one "AI QA" header at y=54
    - the exact set of seven widget titles at y ≥ 56
    - no two widgets in the row overlap
    - the latency widget has p50 and p95 lines for every provider
    - the cost widget has four `AiQaEstimatedCostMicroUsd` Sum/86400 lines and a `/ 1000000` expression
- Both runs failed on the base (commit aa78ce2: undeclared resource, missing widgets). The test
  also caught a real bug during implementation: `flatten` had collapsed the latency metric rows
  into one list.

Commands, all passing:

```
terraform fmt -check -recursive infra
terraform -chdir=infra/envs/prod init -backend=false -input=false -lockfile=readonly
terraform -chdir=infra/envs/prod validate
terraform -chdir=infra/modules/observability init -backend=false -input=false
terraform -chdir=infra/modules/observability test
```

The last two were run on a scratch copy of the module. `init` there writes a
`.terraform.lock.hcl` into the module directory, which is not gitignored and should not be
committed.

## Owner steps

1. Supervisor: `terraform plan`, then `check-plan.py --allow docs/delivery/r20-issues/V12.plan-allow.json`,
   then apply (R20-00 §9 step 6). Expect exactly one dashboard update and four alarm creates.
2. None of the new alarms or widgets has data until ai-qa calls a model. `AI_QA_ENABLED=0` today,
   so they stay OK / empty.

## Deviations and deferred items

- **Runbook location.** The scope allows a root `RUNBOOK.md`, which does not exist. The alarm
  runbook lives in `infra/RUNBOOK.md` §7, which is outside the scope regex. The V12 runbook line
  and the alarm table row therefore went into the infra/README.md §6 V12 entry, and the alarm
  header comment points there. Deferred: move that line into infra/RUNBOOK.md §7 in a round whose
  scope includes it.
- **Provider list.** `local.ai_qa_providers` is new. `ai_qa_daily_cost` in alarms_r18.tf keeps its
  own inline list of the same four values; it was not refactored, to stay inside the issue.
- **Chunk timeout.** The 120 s threshold is per card and includes the second reviewer. There is
  no alarm on the 600 s Lambda timeout per chunk beyond the existing ai-qa Lambda Errors alarm.
