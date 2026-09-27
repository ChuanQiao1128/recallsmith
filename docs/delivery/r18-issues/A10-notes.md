# A10 — infra-automation notes

## Plan

Read-only mode (b) plan against the committed backend (`-lock=false`, 2026-09-28):
`Plan: 35 to add, 2 to change, 0 to destroy.` — `check-plan.py --allow docs/delivery/r18-issues/A10.plan-allow.json --summary`:
`PLAN OK 37`, `SUMMARY imports=0 no-op=212 create=35 update=2 delete=0 replace=0 outputs=0`.
The two updates are `module.api.aws_apigatewayv2_stage.default` / `.dev`, keys `["route_settings"]` only
(the seven new throttles; every existing route setting unchanged).

## IAM simulation

`aws iam simulate-custom-policy` on the planned `change.after.policy` documents (A10 verify, 2026-09-28); all 21 as expected.

| Policy | Action | Resource | Decision |
|---|---|---|---|
| notifier | `sqs:ReceiveMessage` | `developercards-notify` | allowed |
| notifier | `sqs:ChangeMessageVisibility` | `developercards-notify` | allowed |
| notifier | `ssm:GetParameter` | `…/parameter/developercards/prod/notifier-secret` | allowed |
| notifier | `ssm:GetParameter` | `…/parameter/developercards/prod/notifier-secret-previous` | allowed |
| notifier | `ssm:GetParameter` | `…/parameter/developercards/prod/notify-recipient` | allowed |
| source_watcher | `ssm:GetParameter` | `…/parameter/developercards/prod/source-watch-secret` | allowed |
| source_watcher | `ssm:GetParameter` | `…/parameter/developercards/prod/source-watch-secret-previous` | allowed |
| automation_scheduler | `lambda:InvokeFunction` | `function:developercards-source-watcher:prod` | allowed |
| automation_scheduler | `lambda:InvokeFunction` | `function:developercards-notifier:prod` | allowed |
| core_vpc_notify_send | `sqs:SendMessage` | `developercards-notify` | allowed |
| notifier | `ssm:GetParameter` | `…/parameter/developercards/prod/pg-password` | implicitDeny |
| notifier | `ssm:GetParameter` | `…/parameter/developercards/prod/internal-shared-secret` | implicitDeny |
| notifier | `ssm:GetParametersByPath` | `…/parameter/developercards/prod` | implicitDeny |
| notifier | `sqs:ReceiveMessage` | `developercards-ai-qa-jobs` | implicitDeny |
| notifier | `ses:SendEmail` | `identity/developercards.app` | implicitDeny |
| source_watcher | `sqs:SendMessage` | `developercards-notify` | implicitDeny |
| source_watcher | `bedrock:InvokeModel` | `*` | implicitDeny |
| source_watcher | `ssm:GetParameter` | `…/parameter/developercards/prod/notifier-secret` | implicitDeny |
| automation_scheduler | `lambda:InvokeFunction` | `function:core-vpc:prod` | implicitDeny |
| automation_scheduler | `lambda:InvokeFunction` | `function:developercards-notifier (unqualified)` | implicitDeny |
| core_vpc_notify_send | `sqs:ReceiveMessage` | `developercards-notify` | implicitDeny |

The three trust policies were checked from the plan: notifier and source-watcher trust only `lambda.amazonaws.com`
(`Sid = LambdaAssume`); the scheduler role trusts only `scheduler.amazonaws.com` with `StringEquals aws:SourceAccount = 622994489535`.

## Decisions

- Routes: the seven keys go after `agent_drafts_submit` in two blocks (four HMAC callbacks, three runner calls), each after a blank line and a comment, so every existing route line is byte-identical; `terraform fmt` realigned only the `route_throttles` block. The comment block above `routes` ("attached ONLY to the exact route keys the MCP server calls") is left unchanged because existing lines may not change; the new runner comment names the author runner instead.
- The ESM, alias and function shapes copy `ai_qa.tf` exactly; the notify queue's visibility 180 s is 3 × the notifier's 60 s timeout.
- `automation_tick_missing` keeps `alarm_actions`/`ok_actions` on the alerts topic with `actions_enabled = false`, so enabling actions later (RUNBOOK §7) needs no Terraform change.
- `check-agent-routes.py`: the variable `mcp_calls` became `client_calls` and the first docstring line (also argparse's description) says "agent clients"; logic is otherwise unchanged. `tools/author-runner/src` absent or not a directory ⇒ only the MCP files. On this P branch the real repo fails the script (three runner routes with no client and no AgentClientPolicy entries) until the release merge, as A00 §17.2 expects.
- `merge-env.sh`: a comment says "the deploy" rather than naming the deploy script, because the verify rejects a `*deploy*.sh` name in added non-Markdown lines.
- The plan's no-op count is 212 (the brief's base read said 214); the effective changes are exactly the 37 allow-listed addresses.

## Follow-ups

- `ai_qa_daily_cost` provider gap (supervisor): the backstop alarm `ai_qa_daily_cost`
  (`infra/modules/observability/alarms_r18.tf:222-252`) sums `AiQaEstimatedCostMicroUsd` only for
  `Provider = bedrock` and `anthropic`, so spend by the automation reviewer (`bedrock-converse`, A07) is not in it.
  core-vpc's `AI_QA_DAILY_USD_CAP` (A00 §9.5) still limits that spend. Changing the alarm is outside the A00 §17.2
  allow-list, so A10 leaves it as it is; a later issue should add a `Provider = bedrock-converse` term to the sum.
