# C04 — Automation infra round 2 (R18C): fixes ledger

Scope: `infra/`, `docs/runbooks/`, `docs/delivery/r18-issues/`. The ai-qa side of L1 (provider
`openai-mantle`, committed `AI_QA_AUTOMATION_*` keys, README) came with C03 (#457) and is not repeated here.

Test for every finding (infra): `C04.verify.sh` step 3 — `terraform fmt -check`, `terraform validate`, and the
read-only real-backend plan checked by `infra/scripts/check-plan.py` against
`docs/delivery/r18-issues/C04.plan-allow.json`. On the untouched base the plan has none of the six listed
changes, so the check fails ("listed address not effective"); with this branch it passes with exactly them:
Plan: 2 to add, 4 to change, 0 to destroy.

| Address | Action | Keys |
|---|---|---|
| module.edge.aws_sesv2_configuration_set.automation | update | suppression_options (`["BOUNCE","COMPLAINT"]` → `[]`) |
| module.edge.aws_sesv2_configuration_set_event_destination.automation_alerts | create | — |
| module.identity.aws_iam_role_policy.ai_qa | update | policy (+ BedrockMantleOpenAiInference) |
| module.observability.aws_cloudwatch_metric_alarm.ai_qa_daily_cost | update | metric_query (+ Provider=openai-mantle) |
| module.observability.aws_cloudwatch_metric_alarm.notify_queue_oldest_age | create | — |
| module.observability.aws_sns_topic_policy.alerts | update | policy (+ SesEventPublish) |

### ai-agent-11

Status: fixed (infra side of L1; the client, env keys and README are C03's side)

- `infra/modules/identity/roles_r18.tf:128-143` — new local `ai_qa_openai_mantle_statements`: Sid
  `BedrockMantleOpenAiInference`, `bedrock-mantle:CreateInference` on
  `arn:aws:bedrock-mantle:<ai_qa_openai_mantle_region>:<account>:project/default`, `StringEquals
  bedrock-mantle:Model = <ai_qa_openai_mantle_model_id>`; present only when both variables are set;
  appended to `developercards-ai-qa-scoped` at `roles_r18.tf:195`. BedrockMantleInference (Claude,
  ap-southeast-2) and the Q02 Converse statements are kept (bedrock-converse stays the fallback).
- `infra/modules/identity/variables.tf:117-135` — `ai_qa_openai_mantle_model_id` (exact `openai.*` id, no
  wildcard) and `ai_qa_openai_mantle_region` (an AWS region name); default `""` = no grant.
- `infra/envs/prod/main.tf:15-19, 79-80` — prod locals `openai.gpt-5.5` / `us-east-1`, equal to
  `AI_QA_AUTOMATION_MODEL` / `AI_QA_AUTOMATION_REGION` in `services/ai-qa/env/prod.env.json`.
- `infra/modules/observability/alarms_r18.tf:243` — `ai-qa-daily-cost` also sums
  `AiQaEstimatedCostMicroUsd{Service=ai-qa, Provider=openai-mantle}` (the provider dimension C03's client
  emits); without it the automation reviewer's spend would be outside the cap alarm.
- `docs/runbooks/automation-operations.md` step 4/5 — transport, data location (card text leaves
  ap-southeast-2 for us-east-1; public study content only), one owner probe per path (openai-mantle and
  bedrock-converse), gate reviewer `openai-mantle` / `openai.gpt-5.5` / `qa-v4-auto`.
- `infra/README.md` §6 — dated C04 line.

Sources: the GPT-5.5 model card (https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html,
read 2026-09-28: bedrock-runtime not supported; bedrock-mantle Responses + Chat Completions under
`/openai/v1`; model id `openai.gpt-5.5`; Geo and Global inference ids not supported; In-Region us-east-1 and
us-east-2; In-Region short-context $5.50 input / $33.00 output per MTok). The AWS Service Authorization
Reference for bedrock-mantle (https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock-mantle.html,
read 2026-09-28): `CreateInference` — "Grants permission to create an inference request", resource type
`project*` (`arn:${Partition}:bedrock-mantle:${Region}:${Account}:project/${ResourceId}`), condition keys
`aws:ResourceTag/${TagKey}`, `bedrock-mantle:Model`, `bedrock-mantle:ServiceTier`. No other action is listed
for inference, so this is the one action Chat Completions needs; the model condition key exists and is used.

IAM simulation (`aws iam simulate-custom-policy`, read-only, on the planned `change.after.policy` of
`module.identity.aws_iam_role_policy.ai_qa`, action `bedrock-mantle:CreateInference`, resource
`arn:aws:bedrock-mantle:<region>:622994489535:project/default`, context `bedrock-mantle:Model`), 2026-09-28:

| Model | Region | Decision |
|---|---|---|
| openai.gpt-5.5 | us-east-1 | allowed |
| openai.gpt-5.5 | us-east-2 | implicitDeny |
| openai.gpt-5.5 | ap-southeast-2 | implicitDeny |
| openai.gpt-5.4 | us-east-1 | implicitDeny |
| anthropic.claude-opus-5 | us-east-1 | implicitDeny |
| anthropic.claude-opus-5 | ap-southeast-2 | allowed (existing BedrockMantleInference, unchanged) |

Also: `openai.gpt-5.5` on `project/other` in us-east-1 → implicitDeny; `bedrock-mantle:CreateFineTuningJob`
in us-east-1 → implicitDeny; `bedrock:InvokeModel` on the `global.openai.gpt-5.5` profile → allowed (Q02
fallback kept).

Tests: `C04.verify.sh` step 3 (plan allow-list: `module.identity.aws_iam_role_policy.ai_qa` update `policy`,
`module.observability.aws_cloudwatch_metric_alarm.ai_qa_daily_cost` update `metric_query`); the IAM
simulation above.

### cloud-security-resilience-10

Status: fixed

- `infra/modules/edge/ses.tf:70-78` — configuration set `developercards-automation`:
  `suppression_options { suppressed_reasons = [] }`, which overrides the account-level suppression list for
  sends through this set. One hard bounce or one complaint no longer silences every later automation email.
- `infra/modules/edge/ses.tf:81-93` — `aws_sesv2_configuration_set_event_destination.automation_alerts`
  (`developercards-automation-alerts`): BOUNCE, COMPLAINT, REJECT, DELIVERY_DELAY → SNS
  `developercards-alerts`, so a delivery problem is visible although SES accepted the send.
- `infra/modules/observability/alerts.tf:39-53` — topic policy Sid `SesEventPublish`: `ses.amazonaws.com`
  may publish only with `aws:SourceAccount` = the account and `aws:SourceArn` = the configuration set's ARN.
- `infra/modules/observability/outputs.tf` `ses_events_topic_arn` (depends on the topic policy) →
  `infra/modules/edge/variables.tf` `automation_events_topic_arn` → `infra/envs/prod/main.tf:131`, so the
  event destination is created only after SES may publish.
- Trade-off (documented in `infra/RUNBOOK.md`, "Suppression and delivery events"): no automatic reputation
  protection for this set; acceptable for one verified sandbox recipient (≤ 200 messages/day), and every
  bounce/complaint now reaches the owner through SNS. The RUNBOOK names the check for the account
  suppression list and the owner-only removal step.

Tests: `C04.verify.sh` step 3 (plan allow-list: configuration set update `suppression_options`, event
destination create, topic policy update `policy`).

### cloud-security-resilience-11

Status: fixed

- `infra/modules/observability/alarms_r18a.tf:20-41` — `aws_cloudwatch_metric_alarm.notify_queue_oldest_age`
  (`developercards-prod-notify-queue-oldest-age`): AWS/SQS ApproximateAgeOfOldestMessage,
  `QueueName = developercards-notify`, Maximum ≥ 1800 s, period 300 s, 1 of 1, notBreaching, alerts topic for
  alarm and OK. A failing message reaches the DLQ after 5 receives × 180 s visibility (< 1800 s), so the alarm
  fires only when nothing consumes the queue.
- `infra/modules/observability/variables.tf` `notify_queue_name`, fed from the new
  `infra/modules/worker/outputs.tf` `notify_queue_name` in `infra/envs/prod/main.tf`.
- `infra/RUNBOOK.md` alarm list — `notify-queue-oldest-age`: check the notify ESM is Enabled.

Tests: `C04.verify.sh` step 3 (plan allow-list: `notify_queue_oldest_age` create).

## Contract

- L1 (infra side): the ai-qa role gains `bedrock-mantle:CreateInference` on the us-east-1 default project,
  restricted by `bedrock-mantle:Model = openai.gpt-5.5` (the only inference action and the documented
  resource/condition keys in list_bedrock-mantle.html); every existing grant is kept. The prod model/region
  come from one pair of locals that must equal the committed `AI_QA_AUTOMATION_MODEL` /
  `AI_QA_AUTOMATION_REGION`. The owner runbook has one probe per path (openai-mantle, bedrock-converse) and
  notes that card text then leaves ap-southeast-2 (public study content only). The cost alarm includes the
  new provider.
- L2–L6: not touched (no infra part).

## Deviations

- `ai-qa-daily-cost` gains Provider=openai-mantle. Not named in the finding, but L1 makes openai-mantle the
  automation reviewer and the alarm is documented as the total of every ai-qa provider (B04).
- No existing test or assertion changed.
