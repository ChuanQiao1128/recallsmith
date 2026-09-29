# RUNBOOK — RecallSmith / DeveloperCards infra

## 1. Adopt (E01, once)

E01 writes `imports.tf` with 93 `import {}` blocks that adopt every existing production resource
under its current name/id. The only plan is state-only: 93 `importing` entries, all `no-op` except
one provider-side `update` on the RDS instance (`apply_immediately`, `skip_final_snapshot`,
`final_snapshot_identifier` — attributes that never reach `ModifyDBInstance`), plus the root
outputs appearing as `create` because the worker plans against an empty local state. The supervisor
creates the state bucket and applies after merge (see README §5). `imports.tf` stays in `envs/prod`
for the whole wave; deleting it is the first post-wave chore.

## 2. Plan (every issue)

Read-only, `AWS_PROFILE=dev`, never `apply`/`import`. For E01–E05 (prod) and every staging root,
use an empty local state via a gitignored override:

1. Write `infra/envs/prod/backend_override.tf`:
   ```hcl
   terraform {
     backend "local" {
       path = "<absolute path under $TMPDIR>/terraform.tfstate"
     }
   }
   ```
   (Terraform's `_override.tf` merge replaces the `backend` block; the S3 bucket is never contacted.)
2. `terraform -chdir=infra/envs/prod init -input=false -reconfigure`.
3. Supply the Snowflake ExternalId read-only:
   `TF_VAR_snowflake_external_id="$(aws iam get-role --role-name snowflake-recallsmith-s3-role --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text)"`.
4. `terraform -chdir=infra/envs/prod plan -input=false -out=<tag>.tfplan`.
5. `terraform -chdir=infra/envs/prod show -json <tag>.tfplan > <tag>.plan.json`.
6. `python3 infra/scripts/check-plan.py --plan <tag>.plan.json --allow docs/delivery/r16-issues/<TAG>.plan-allow.json` (run from repo root).
7. Remove `infra/envs/prod/backend_override.tf` and the plan files.

From E06 the prod plan reads the real backend read-only (`init -reconfigure` with the committed
`backend.tf`, `plan -lock=false`); the override recipe stays for the staging roots.

## 3. Apply (supervisor only)

`terraform init -reconfigure` with the real backend (no override file), then
`terraform plan -out=<tag>.tfplan`, the allow-list check, `terraform apply <tag>.tfplan`, the
issue's post-apply CLI cleanups, and the second plan (§5).

## 4. Post-apply cleanups

Supervisor CLI after each apply (never a worker, never a file in git): stray log groups, stale
secrets, unattached policies, old Lambda versions / provisioned concurrency / SnapStart, and the
stray aliases are removed by `aws ... delete-*`. E01 itself has no cleanups; nothing in AWS changes.

## 5. Second plan must be empty

After apply the supervisor runs a second `terraform plan` and checks it with no `--allow`; it must
print `PLAN EMPTY` (every entry `no-op`, nothing importing, no effective output change) before the
next issue's worker may reach its verify.

## 6. Drift you will see

- Lambda alias versions move with every `src_C/deploy.sh` run; they are ignored via
  `ignore_changes = [function_version, description]` on each alias and
  `ignore_changes = [..., publish, environment, description]` on each function.
- `engine_version = "17.9"` must be reconciled by hand after an RDS auto-minor upgrade.
- Provisioned concurrency, Lambda versions and SnapStart are not state.
- The ai-qa and webhook-dispatcher SQS event source mappings ignore `enabled` (R18 Y04): a mapping
  stopped by the §7 emergency stop stays stopped across an apply and shows no drift.
- `aws_cognito_user_group.editor.role_arn` names a role that does not exist
  (`developercards-api-role-l4jacdsb`); it stays dangling in E01 (nulling it is E08).
- `imports.tf` stays until the wave ends; blocks are removed only by the issue that destroys an
  adopted resource (E05, E08), never added to.

## 7. Silent-failure alarms (R18 X08)

All on the alerts topic, namespace `DeveloperCards`, `treat_missing_data = notBreaching`. One line
per alarm: what fired, first thing to check.

- `webhook-delivery-failed` — a receiver answered a permanent status (non-2xx other than 408, 429
  and 5xx) or the URL guard rejected the target; the event was acked and is not retried. Open the deliveries list in the console; a 401 usually means
  the receiver's copy of the signing secret is stale (rotate or re-share it), 404/410 a dead URL
  (disable the subscription).
- `webhook-delivery-dead` — a delivery used all five attempts on retryable errors; the message goes
  to developercards-webhook-events-dlq. Recovery (R18 Y01, automation-12, deployed; detail in
  services/webhook-dispatcher/README.md, "Dead deliveries and the DLQ"): fix the receiver, then pick
  **one** of the two for each message, never both, or the receiver gets the event twice (it still
  dedupes on `eventId`):
  - **Redrive** the DLQ back to developercards-webhook-events
    (`aws sqs start-message-move-task --source-arn <DLQ ARN>`): each message is retried with the same
    delivery id (up to five more attempts); the row stays `dead` until one succeeds, then shows
    `delivered`.
  - Press **Redeliver** on each `dead` row in the console (a new delivery id), then purge the DLQ
    (`aws sqs purge-queue --queue-url <developercards-webhook-events-dlq URL>`).
  - **Before any purge**, check that the DLQ holds no unsupported-version messages: search the
    dispatcher's log for `webhook_unsupported_version` over the DLQ's 14-day retention
    (`aws logs filter-log-events --log-group-name /aws/lambda/developercards-webhook-dispatcher --filter-pattern '"webhook_unsupported_version"' --start-time <epoch ms, 14 days ago> --query 'events[].message'`).
    If there are any, never purge: those rows stay `queued` and are never `dead`, so no Redeliver
    or sweep resends them; deploy a dispatcher that speaks that version, then redrive the DLQ as a
    whole (the redrive is correct for the `dead` messages too).
- `webhook-report-failures` — the dispatcher could not post its attempt report to core-vpc, so the
  delivery row is stale. Check core-vpc health and the `/developercards/prod/webhook-report-secret`
  SSM parameter: the dispatcher signs with it, and core-vpc verifies with the copy the last
  `src_C/deploy.sh` put in `INTERNAL_SECRET_WEBHOOK_REPORT`, so a value changed without a core-vpc
  deploy is rejected (403) unless `webhook-report-secret-previous` still holds the old one. Rotate it
  only with services/ai-qa/README.md, "Route-secret rotation".
- `webhook-enqueue-failures` — core-vpc or the worker failed `SendMessage` to
  developercards-webhook-events; the delivery row is kept as `enqueue_failed`, not lost. Fix the queue
  or the send grants (developercards-core-vpc / worker SQS policy), wait 10 minutes, then call
  `POST /api/v1/admin/webhooks/deliveries/sweep` (super_admin JWT, optional body `{"limit": 1..100}`)
  and repeat (10 minutes apart) until the response's `enqueueFailures` is 0
  (docs/delivery/r18-issues/X01-ledger-runbook.md, "Re-send stranded webhook deliveries"). Each
  swept row keeps its delivery id and eventId, so receivers dedupe as usual.
- `ledger-write-failures` — a best-effort automation ledger write was dropped. Check core-vpc / worker
  logs for the ledger error; the business write itself succeeded.
- `ai-qa-enqueue-failures` — a QA run's chunks could not be sent to developercards-ai-qa-jobs; the
  run stays queued until the 2 h reap. Check the queue and developercards-core-vpc-ai-qa-send.
- `ai-qa-error-provider-auth` / `-provider-access-denied` / `-config` — every chunk fails until the
  owner acts: provider key or Bedrock model access (§7.9), the ai-qa environment, or an `AI_MODEL`
  that differs from the model the ai-qa role's `bedrock-mantle:Model` condition allows (identity
  `bedrock_mantle_model_id`). If it cannot be fixed at once, use the ai-qa emergency stop below.
- `ai-qa-refusals` — three or more refusals in an hour. Read the refused cards in the run; a spike
  after a prompt or model change means that change should be rolled back.
- `ai-qa-daily-cost` — estimated spend across both providers passed the daily cap in one day. Use
  the ai-qa emergency stop below at once, then look for a run that started just under the cap.
- `webhook-queue-oldest-age` / `ai-qa-queue-oldest-age` — a backlog: the consumer Lambda is not
  draining its queue. Check the event source mapping is enabled and the function's errors/throttles.

### Emergency stop for the SQS consumers (R18 Y04)

The same procedure for developercards-ai-qa (runaway spend, a fatal-error alarm, a provider
incident) and developercards-webhook-dispatcher (a receiver incident, a leaked URL). Detail and
the undo: services/ai-qa/README.md "Emergency stop", services/webhook-dispatcher/README.md
"Emergency stop".

1. **Disable the event source mapping — takes effect at once.** Queued messages stay in the queue
   (retention 4 days) and resume when it is re-enabled.
   - `aws lambda list-event-source-mappings --function-name <function>:prod --query 'EventSourceMappings[].UUID'`
   - `aws lambda update-event-source-mapping --uuid <uuid> --no-enabled`
2. For ai-qa, also stop new runs: `AI_QA_ENABLED=0` in core-vpc's `src_C/env/prod.env.json` and a
   core-vpc deploy. `AI_QA_ENABLED` is **not** an immediate stop: the consumers run a published
   version whose environment is frozen at deploy, so editing the variable on a function changes
   nothing until the next deploy, and on core-vpc it only blocks new runs — chunks already queued
   keep spending until step 1 is done.
3. Do **not** use reserved concurrency 0 for ai-qa: a throttled SQS-triggered function still
   receives messages, and with `maxReceiveCount = 3` (Z03) queued chunks move to the DLQ instead of
   waiting. Disabling the mapping never burns a receive.
4. Before any `terraform plan`/apply while stopped, re-check the mapping state
   (`aws lambda get-event-source-mapping --uuid <uuid> --query State`). Both mappings list
   `enabled` in `ignore_changes`, so an apply leaves a stopped consumer stopped; re-enabling is
   always the explicit `update-event-source-mapping --uuid <uuid> --enabled`.

### Automation schedules and emergency stop (R18A A10)

Three EventBridge Scheduler schedules drive the automation: `developercards-source-watch`
(`rate(1 hour)` → developercards-source-watcher:prod, `{"job":"source-watch"}`, no retry),
`developercards-automation-tick` (`rate(15 minutes)` → developercards-notifier:prod, `{"job":"tick"}`,
2 retries) and `developercards-automation-digest` (`cron(0 8 ? * MON *)` Pacific/Auckland →
developercards-notifier:prod, `{"job":"digest"}`, 2 retries). They invoke the aliases through
developercards-automation-scheduler-role (no Lambda permission). All three are **created DISABLED** and
Terraform ignores `state`, so an apply never enables or re-disables one; the supervisor enables them
only after the code deploy (A00 §19.2 step 6).

The Scheduler invokes asynchronously. Both aliases (`developercards-notifier:prod`,
`developercards-source-watcher:prod`) carry an event invoke config with `maximum_retry_attempts = 0` and
`maximum_event_age_in_seconds = 900` (R18B B04), so a run that raises is not re-run by Lambda: the next
scheduled run covers it. The Scheduler's own retry policy above only retries a delivery the Scheduler could
not hand to Lambda. The notifier's reserved concurrency is 4 = the email mapping's `maximum_concurrency` 2 +
one tick + one digest, so a scheduled run never throttles an email delivery (a throttled SQS delivery still
consumes one of the five receives).

Business operation of the automation (rollout off → dry_run → live, promotion criteria, what to do per
exception email, reading the Automation page, undoing an auto-published card):
[docs/runbooks/automation-operations.md](../docs/runbooks/automation-operations.md).

**Enable / disable a schedule.** `update-schedule` replaces the whole definition, so read it first and
send it back unchanged except for the state:

1. `aws scheduler get-schedule --name <n>` (note `ScheduleExpression`, `ScheduleExpressionTimezone`,
   `FlexibleTimeWindow` and `Target`).
2. `aws scheduler update-schedule --name <n> --schedule-expression '<same>' [--schedule-expression-timezone Pacific/Auckland] --flexible-time-window Mode=OFF --target '<same Target JSON>' --state ENABLED`
   (or `--state DISABLED`).
3. `aws scheduler get-schedule --name <n> --query State` shows the new state.

**After enabling the tick and the source watch**, and once each heartbeat alarm reads `OK` after its first
heartbeat, enable the actions of their heartbeat alarms (they start disabled because the schedules start
disabled; Terraform ignores `actions_enabled`, so no apply ever enables them):
`aws cloudwatch enable-alarm-actions --alarm-names developercards-prod-automation-tick-missing developercards-prod-source-watch-missing`.
When a schedule is disabled on purpose, first run `aws cloudwatch disable-alarm-actions --alarm-names <its alarm>`
(`developercards-automation-tick` → `developercards-prod-automation-tick-missing`, two hours;
`developercards-source-watch` → `developercards-prod-source-watch-missing`, three hours), or it fires.
Re-enable the alarm's actions together with its schedule; a schedule left disabled with its alarm's
actions on is exactly what the alarm reports.

**Upgrading a running system (R18D, 2026-09-28).** Production's schedules were enabled at the R18A/B/C
dry_run deploy, so the step above is behind it, and the D04 apply created
`developercards-prod-source-watch-missing` with its actions **disabled**; Terraform ignores
`actions_enabled` (`alarms_r18a.tf`, `ignore_changes`), so no apply turns them on. Once, in this order
(the pre-round-D watcher emits no `SourceWatchRuns`, and with missing data breaching, actions enabled
before the new watcher runs page within about three hours):

- [ ] Deploy source-watcher with the round-D (D03) code (`DRY_RUN=1 services/deploy-python-lambda.sh source-watcher`, then without `DRY_RUN=1`).
- [ ] After the next hourly run, confirm one heartbeat:
      `aws cloudwatch get-metric-statistics --namespace DeveloperCards --metric-name SourceWatchRuns --dimensions Name=Service,Value=source-watcher --start-time <UTC now − 2 h> --end-time <UTC now> --period 3600 --statistics Sum`
      shows `Sum` ≥ 1, or the alarm's `StateValue` (`aws cloudwatch describe-alarms --alarm-names developercards-prod-source-watch-missing`) is `OK`, not `INSUFFICIENT_DATA` or `ALARM`.
- [ ] `aws cloudwatch enable-alarm-actions --alarm-names developercards-prod-source-watch-missing`
      (the tick alarm, `developercards-prod-automation-tick-missing`, had its actions enabled with the schedules; check
      `ActionsEnabled` of both with `describe-alarms`).

The business-side checklist is in docs/runbooks/automation-operations.md, "Upgrading a running system".
The R18E–R18G upgrade (core, then ai-qa before any live switch, the Mac tool rebuild and a new gate)
is in the same file, "Upgrading to R18E–R18G".

**Post-apply secret step** (supervisor, once after the A10 apply; A00 §1.3): the two callback
secrets are created as `PLACEHOLDER-set-by-supervisor`. Set each to a random 32-byte hex value:
`aws ssm put-parameter --overwrite --type SecureString --name /developercards/prod/source-watch-secret --value "$(openssl rand -hex 32)"`
and the same for `/developercards/prod/notifier-secret`. core-vpc picks them up as
`INTERNAL_SECRET_SOURCE_WATCH` / `INTERNAL_SECRET_NOTIFIER` on its next `src_C/deploy.sh`; the
Lambdas read them at cold start. Rotate them like the other route secrets (the `-previous` leaves).

Alarms (all on the alerts topic; one line each — what fired, first check):

- `notify-dlq-nonempty` — an email message failed five receives and sits in developercards-notify-dlq.
  Read the notifier's log for the message id; fix the cause (SES, the recipient parameter, core-vpc's
  report route), then redrive the DLQ (`aws sqs start-message-move-task --source-arn <DLQ ARN>`).
- `notify-queue-oldest-age` — a message has waited on developercards-notify for 30 minutes or more: the
  email consumer is not draining the queue. Check the notify ESM is Enabled
  (`aws lambda list-event-source-mappings --function-name developercards-notifier:prod --query 'EventSourceMappings[].[UUID,State]'`;
  re-enable a mapping left stopped by emergency-stop step 2), then the notifier's throttles. Queued emails
  expire after 4 days and core does not re-send them (K6).
- `notifier-errors` — the notifier function raised (tick, digest or an SQS record). Check
  `/aws/lambda/developercards-notifier` for the traceback, then `notifier-secret` and core-vpc health.
- `source-watcher-errors` — a source-watch run raised. Check `/aws/lambda/developercards-source-watcher`,
  `source-watch-secret` and the targets route (`POST /api/internal/source-watch/targets`). A run killed
  mid-target (timeout, out of memory) logs no error line of its own: the last `observe_start` event before
  the error names the `targetId` it was working on; deactivate or fix that target in the Watch tab.
- `source-watch-missing` (R18D M6) — the source-watcher emitted no `SourceWatchRuns` heartbeat
  (`DeveloperCards`, `Service = source-watcher`; one per `{"job":"source-watch"}` invocation, emitted
  before any other work, also when there is nothing to watch) for three hours (actions enabled only once
  the schedules are and the alarm is `OK`; on a system whose schedules were already enabled, see "Upgrading a
  running system (R18D)" above). The hourly watch stopped: cited-source changes are no longer detected. Check
  `developercards-source-watch` is ENABLED (for example left DISABLED after emergency-stop step 1), the
  scheduler role's `developercards-automation-scheduler-invoke` policy on the
  `developercards-source-watcher:prod` alias, and the function's throttles (reserved concurrency 1).
- `automation-tick-missing` — the notifier emitted no `AutomationTicks` heartbeat (`DeveloperCards`,
  `Service = notifier`; one per tick invocation, whatever core answers) for two hours (actions enabled
  only once the schedules are). Email deliveries do not emit it, so they cannot hide a stopped tick. Check
  `developercards-automation-tick` is ENABLED, the scheduler role's `developercards-automation-scheduler-invoke`
  policy, and the notifier's throttles (reserved concurrency 4).
- `notification-failures` — the notifier could not deliver an email (`Service = notifier`). Check SES
  sending status and the configuration set, and the notifier log for the failure code.
- `automation-notify-enqueue-failures` — core-vpc failed `SendMessage` to developercards-notify. Check the
  queue exists, `AUTOMATION_NOTIFY_QUEUE_URL` in core-vpc's environment and the grant
  developercards-core-vpc-notify-send.
- `automation-step-failures` — core-vpc swallowed an automation failure (`AutomationStepFailures` ≥ 1 in an
  hour): a tick step, run finalisation, publish evaluation/reconcile or a draft-QA after-commit hook. The
  tick still answers 200, so this is the only signal. Search core-vpc's log for `tick_step_failed` and the
  other `warn` events of that hour (the notifier's `tick_steps_failed` event names the tick's `failedSteps`).
  A step failing every tick stops batch summaries or publishes; fix the cause and redeploy core-vpc.

**Emergency stop** (runaway automation, a bad auto-accept or auto-publish, a mail incident, a
source-watch loop). Do the steps that apply, in this order; each takes effect on its own:

0. **Revoke the active eval gate** (instant: effective `live` → `dry_run` on the next request, no deploy).
   Console → Automation → Overview → eval-gate card → *Revoke gate* (super_admin), or
   `POST /api/v1/admin/automation/eval-gate/<gateId>/revoke`. Only the newest gate row counts (R18B K2):
   a revoked or failed newest gate never falls back to an older passed one, so one revoke stops every new
   auto-accept and auto-publish. Drafting, QA and emails continue as a dry run. This is the first step for
   anything that auto-accepts or auto-publishes.
1. Disable the three schedules with the recipe above: `developercards-source-watch`,
   `developercards-automation-tick`, `developercards-automation-digest` (and first disable the actions of
   the tick-missing and source-watch-missing alarms). This stops the source watch, the tick (reconcile,
   batch summaries, runner checks) and the digest. It does **not** stop auto-accept or auto-publish: the runner's complete route
   (`POST /api/v1/authoring/automation/runner/complete` → run finalisation) and AI QA results for drafts both finalise runs
   and start publishes without any schedule. Use step 0 or 3 for that.
2. Stop the email consumer: `aws lambda list-event-source-mappings --function-name developercards-notifier:prod --query 'EventSourceMappings[].UUID'`,
   then `aws lambda update-event-source-mapping --uuid <uuid> --no-enabled`. Queued emails stay in
   developercards-notify (4 days) and resume on `--enabled`; the mapping ignores `enabled` in Terraform.
   Like step 1, this does not stop auto-publish.
3. Stop the automation in core-vpc: set `AUTOMATION_MODE=off` in `src_C/env/prod.env.json` and deploy
   core-vpc (`ENV=prod ./src_C/deploy.sh`). The only step that stops every server-side automation path
   (it needs a deploy, so it is not instant).
4. Stop the local runner on the owner's Mac: `tools/author-runner/scripts/uninstall.sh` (`DRY_RUN=1` first
   prints what it would do). No new authoring runs are claimed; reinstall later with
   `tools/author-runner/scripts/install.sh`.

Undo in reverse order; re-enable the schedules (and the two heartbeat alarms' actions) only after core-vpc
runs with the intended mode, and restore
`live` only by recording a new passed eval gate (a revoked gate stays revoked). To undo a card that was
auto-accepted or auto-published, see "Rollback" in
[docs/runbooks/automation-operations.md](../docs/runbooks/automation-operations.md).

### SES for automation emails (R18A A11)

The notifier sends from `DeveloperCards Automation <automation@developercards.app>` through the SES
domain identity `developercards.app` (Easy DKIM, RSA 2048, three `*._domainkey` CNAMEs), the custom
MAIL FROM `mail.developercards.app` (MX `10 feedback-smtp.ap-southeast-2.amazonses.com` + SPF TXT),
DMARC `v=DMARC1; p=none; adkim=r; aspf=r` (no `rua`: no mailbox exists) and the configuration set
`developercards-automation`. The recipient is `var.alert_email` (sensitive, never printed): Terraform
writes it to the SecureString `/developercards/prod/notify-recipient` and creates it as an SES email
identity. The notifier's only SES grant is `developercards-notifier-ses-send` (`ses:SendEmail` on the
domain identity, the recipient identity and the configuration set, `ses:FromAddress` =
`automation@developercards.app`).

**After the apply** (supervisor + owner, A00 §1.3):

1. SES emails a verification link to the owner alert address; the owner clicks it (the link expires
   after 24 h — if missed, the supervisor re-sends it from the SES console, never by CLI in a worker).
2. Wait until both identities are verified (DKIM takes minutes up to 72 h):
   - `aws sesv2 get-email-identity --email-identity developercards.app --query '{dkim:DkimAttributes.Status,sending:VerifiedForSendingStatus,mailFrom:MailFromAttributes.MailFromDomainStatus}'`
     must show `dkim` = `SUCCESS`, `sending` = `true` (and `mailFrom` = `SUCCESS`).
   - `aws sesv2 list-email-identities --query 'EmailIdentities[].[IdentityType,VerificationStatus]'`
     shows the EMAIL_ADDRESS identity as `SUCCESS` (the listing prints the address: run it only in
     a private terminal, never in a log or an issue).
3. Only then send the first test email (the automation tick/digest path, A00 §19.2).
4. A second `terraform plan` is empty.

**Sandbox.** The account is in the SES sandbox (`aws sesv2 get-account` → `ProductionAccessEnabled`
`false`): mail goes only to verified identities, at most 200 messages per 24 h and 1 per second.
That fits the single owner recipient. Production access is an optional owner request in the SES
console; nothing here depends on it.

**Errors in the notifier's email log** (`/aws/lambda/developercards-notifier`):

- `MessageRejected` — SES refused the message: the recipient identity is not verified yet (sandbox),
  the domain identity is not verified for sending, or the sending quota is used up. Check step 2.
- `MailFromDomainNotVerifiedException` — the MAIL FROM MX/SPF records for `mail.developercards.app`
  are missing or not yet seen by SES; `behavior_on_mx_failure = USE_DEFAULT_VALUE` normally falls back
  to `amazonses.com`, so this points to a changed record or attribute (re-plan; do not edit the zone by hand).
- `AccessDeniedException` — the send was outside `developercards-notifier-ses-send`: a different
  From address, a configuration set other than `developercards-automation`, or a recipient identity
  that no longer matches the grant (after an `alert_email` change, before the apply).

**Suppression and delivery events (R18C).** The configuration set `developercards-automation` inherits the
account-level suppression list (BOUNCE, COMPLAINT): the aws provider cannot hold an empty per-set override
(SES stores it as "no override"), so none is declared. A hard bounce or a "spam" click on an alert would
therefore put the owner address on the suppression list, after which SES accepts later sends (the notifier
logs `sent`) but delivers nothing. That is never silent: the event destination
`developercards-automation-alerts` publishes every `BOUNCE`, `COMPLAINT`, `REJECT` and `DELIVERY_DELAY`
event to the alerts topic (`developercards-alerts`, Sid `SesEventPublish`, only this configuration set),
and SNS email delivery does not depend on the SES suppression list. On such an event: fix the mailbox or
filter first (a complaint means an alert was marked as spam), then check the suppression list
(`aws sesv2 get-suppressed-destination --email-address <owner address>` in a private terminal); if listed,
the owner removes it in the SES console (Suppression list → remove), never from a worker.

**Changing `alert_email`.** One apply changes, together, the `notify-recipient` SSM value, the SES
recipient identity (the old one is destroyed, a new one created, and SES sends a new verification
link to the new address) and the recipient ARN in `developercards-notifier-ses-send`. Emails fail
with `MessageRejected` until the owner clicks the new link. The plan shows every changed value as
`(sensitive value)`; never print the plan JSON.

## 8. Traces, SLOs and the synthetic check (R18H)

### Find a trace from a log line and back

Three correlation fields appear on log and EMF lines (H00 §3.3):

- `traceId` — the API Gateway request id, **unchanged** (the same value the client sees in the envelope).
- `xrayTraceId` — the X-Ray root of this invocation (`1-xxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx`), taken from
  `_X_AMZN_TRACE_ID`; omitted when the function runs without a trace.
- `upstreamTraceId` — the X-Ray root of the producer: the SQS `AWSTraceHeader` attribute on consumers, or
  the `x-dc-trace-id` header that the Python services send on their HMAC callbacks to core.

From a log line to the trace: copy its `xrayTraceId` (or `upstreamTraceId`) and run a Logs Insights query
across the seven traced log groups `/aws/lambda/core-vpc`, `/aws/lambda/worker-lambda`,
`/aws/lambda/developercards-ai-qa`, `/aws/lambda/developercards-webhook-dispatcher`,
`/aws/lambda/developercards-notifier`, `/aws/lambda/developercards-source-watcher` and
`/aws/lambda/developercards-synthetic-check`:

```
fields @timestamp, tag, traceId, xrayTraceId, upstreamTraceId
| filter xrayTraceId = "<id>" or upstreamTraceId = "<id>"
| sort @timestamp asc
```

The result lists the producer and every consumer of the same request. Then open the trace itself:

- `aws xray batch-get-traces --trace-ids <id>` — the segments (`AWS::Lambda` and `AWS::Lambda::Function`
  with init and invocation timing).
- `aws xray get-trace-summaries --start-time <epoch-10min> --end-time <epoch-now> --filter-expression 'service("core-vpc")'`
  — the recent traces of one function; take an id from it and run the Logs Insights query above to go
  back from the trace to the log lines.

Limits:

- HTTP APIs do not support X-Ray, so a request trace starts at the Lambda; `edge-public` is **not** traced.
- A function traces only from its first version published after H05: published versions freeze the tracing
  mode, so a `prod` alias on an older version still shows no traces until the next deploy.
- core-vpc and worker-lambda run in the VPC without an X-Ray interface endpoint. Lambda's own trace daemon
  (`169.254.79.129:2000`) sits on the Lambda host, so the function segments are expected without one. If
  the `AWS::Lambda::Function` segments of those two are missing, record it in the H05 notes; the endpoint
  (≈ USD 14.60/month) is an owner decision (H00 §3.6), and the log correlation above still works.

### The SLO table

All three SLOs use a rolling **28-day** window; error budget = 1 − target; burn rate = (bad / total) /
(1 − target). Fast burn ≥ **14.4** spends 2 % of the budget in 1 hour; slow burn ≥ **6** spends ≈ 5 % in 6
hours. Minimum-event guards stop one bad request from paging at 13–124 requests a day.

| SLO | SLI | Target | Window |
|---|---|---|---|
| api-availability | app API requests (API Gateway `Count`) without a `5xx` | 99.5 % | 28 days |
| sync-latency | requests to `POST /api/v1/sync/push`, `GET /api/v1/sync/progress`, `POST /api/v1/draw-state/sync` served in ≤ 2000 ms (EMF `Latency` `PR(:2000)` weighted by `SampleCount`) | 95 % | 28 days |
| publish-success | publish jobs that end in success (`PublishJobsSucceeded` vs `PublishJobsFailed`) | 95 % | 28 days |

| Alarm | Means | Pages | First three things to check |
|---|---|---|---|
| `developercards-prod-slo-api-availability-fast-burn` | composite: the 1-hour **and** 5-minute availability burn are both ≥ 14.4 | yes | 1. API Gateway 5xx by route on the dashboard; 2. core-vpc errors / throttles (`developercards-prod-core-vpc-errors`, `-core-vpc-throttles`); 3. recent deploys (`aws lambda list-aliases --function-name core-vpc`) |
| `developercards-prod-slo-api-availability-slow-burn` | 6-hour availability burn ≥ 6 (≥ 30 requests, ≥ 3 5xx) | yes | same three as the fast burn; also RDS CPU / connections |
| `developercards-prod-slo-api-availability-burn-1h` | child: 1-hour burn ≥ 14.4 (≥ 10 requests, ≥ 2 5xx) | never | only read as part of the composite |
| `developercards-prod-slo-api-availability-burn-5m` | child: 5-minute burn ≥ 14.4 | never | only read as part of the composite |
| `developercards-prod-slo-sync-latency-fast-burn` | composite: the 1-hour **and** 5-minute sync-latency burn are both ≥ 14.4 (≥ 72 % of sync requests slower than 2 s) | yes | 1. `Latency p95 by Route (top 10)` on the dashboard; 2. core-vpc cold starts (`Init Duration` in REPORT lines) and memory; 3. RDS CPU (`developercards-prod-rds-cpu`) |
| `developercards-prod-slo-sync-latency-slow-burn` | 6-hour sync-latency burn ≥ 6 (≥ 12 requests, ≥ 30 % slow) | yes | same three as the fast burn |
| `developercards-prod-slo-sync-latency-burn-1h` | child: 1-hour burn ≥ 14.4 (≥ 6 requests) | never | only read as part of the composite |
| `developercards-prod-slo-sync-latency-burn-5m` | child: 5-minute burn ≥ 14.4 | never | only read as part of the composite |
| `developercards-prod-slo-publish-success-fast-burn` | 1-hour publish burn ≥ 14.4 (≥ 2 failed jobs) | yes | 1. worker logs `Job marked as FAILED` in `/aws/lambda/worker-lambda`; 2. the publish DLQ (`developercards-prod-dlq-nonempty`); 3. `developercards-prod-worker-errors` |
| `developercards-prod-slo-publish-success-slow-burn` | 6-hour publish burn ≥ 6 (≥ 2 failed jobs) | yes | same three as the fast burn |
| `developercards-prod-synthetic-check-failing` | two consecutive synthetic runs failed or did not run | yes (once enabled) | the synthetic check subsection below |

Paging: the two composites, the two request slow-burn alarms, the two publish alarms and the synthetic
alarm (7 alarms). The four children (`…-burn-1h`, `…-burn-5m` of api-availability and sync-latency) never
page; they have no actions and exist only to feed the composites. The publish alarms stay
`INSUFFICIENT_DATA` / `OK` until the H02 worker gauges ship (missing data is not breaching).

Replaced and kept:

- `developercards-prod-api-5xx` was replaced by api-availability: same two metrics, but its
  `IF(count > 20, …)` guard per 5 minutes never evaluated at this traffic.
- `developercards-prod-core-vpc-duration-p95` was replaced by sync-latency: it flapped 6 times on
  2026-09-28 on cold starts and did not measure what the app waits for.
- Kept on purpose: `developercards-prod-core-vpc-errors` (scheduled `/internal/*` invocations never pass
  API Gateway, so availability cannot see them), `developercards-prod-worker-errors` and
  `developercards-prod-dlq-nonempty` (crash and timeout paths that emit no publish gauge).

### Error-budget policy

- The dashboard section "SLOs (R18H)" shows the budget remaining over 28 days per SLO.
- Budget remaining **< 25 %** on any SLO ⇒ reliability work comes before feature work until the budget
  recovers above 25 %.
- Review the sync-latency target after 28 days of data at **512 MB** (core-vpc moved from 128 MB on
  2026-09-29; the 95 % ≤ 2000 ms target was chosen on 128 MB data), due 2026-10-27.

### Synthetic check

`developercards-synthetic-check` runs every 15 minutes (schedule `developercards-synthetic-check`, input
`{"job":"synthetic-check"}`) and runs five checks in order: `api-health` (`GET /health`), `cdn-manifest`
(the app's content manifest), `cdn-deck` (the first public live deck, SHA-256 checked), `console-index`
(the console's HTML) and `api-auth-guard` (`GET /api/v1/me` without a token must be exactly 401). It emits
`SyntheticCheckSuccess` (1 when all five pass) and `SyntheticCheckLatency`; the EMF line lists the failed
checks with a code:

| Code | Meaning |
|---|---|
| `HTTP_STATUS` | unexpected status (including any redirect) |
| `TIMEOUT` | no answer within `CHECK_TIMEOUT_SECONDS` |
| `NETWORK` | DNS, TLS or connection failure |
| `BAD_BODY` | the body is not the expected JSON / HTML |
| `HASH_MISMATCH` | the deck's SHA-256 differs from the manifest |
| `TOO_LARGE` | body over the size cap (1 MiB manifest, 5 MiB deck) |
| `NO_PUBLIC_DECK` | the manifest failed or lists no public live deck |
| `CONFIG` | a base URL in the environment is not `https://` |
| `ERROR` | an unexpected exception inside the check |

One supervised run (after a deploy, or to confirm a fix):
`aws lambda invoke --function-name developercards-synthetic-check:prod --payload '{"job":"synthetic-check"}' --cli-binary-format raw-in-base64-out /dev/stdout`
⇒ `{"ok": true, "failed": []}`.

Enable / disable the schedule with the §7 recipe (`update-schedule` replaces the whole definition;
Terraform ignores `state`):

1. `aws scheduler get-schedule --name developercards-synthetic-check`
2. `aws scheduler update-schedule --name developercards-synthetic-check --schedule-expression 'rate(15 minutes)' --flexible-time-window Mode=OFF --target '<same Target JSON>' --state ENABLED`
   (or `--state DISABLED`)

After two good scheduled runs (≥ 30 minutes with `SyntheticCheckSuccess = 1`):
`aws cloudwatch enable-alarm-actions --alarm-names developercards-prod-synthetic-check-failing`.

Silence it during a planned outage:
`aws cloudwatch disable-alarm-actions --alarm-names developercards-prod-synthetic-check-failing`, and
afterwards `aws cloudwatch enable-alarm-actions --alarm-names developercards-prod-synthetic-check-failing`.
Terraform ignores `actions_enabled` on this alarm, so neither step causes drift.

### Rollback (H00 §8.2 step 8)

- **Tracing:** revert H05's `tracing_config` lines, apply, and redeploy so new versions carry
  `PassThrough`; or, quicker, `aws lambda update-function-configuration --function-name <fn> --tracing-config Mode=PassThrough`
  and then revert in Terraform so the next plan is empty.
- **Synthetic check:** disable the schedule (`--state DISABLED` above) and the alarm actions
  (`disable-alarm-actions` above).
- **SLOs:** revert H06; the apply removes the ten SLO alarms and restores `developercards-prod-api-5xx`
  and `developercards-prod-core-vpc-duration-p95`.

No rollback changes any data.

Cost: ≈ USD 4.80/month for the whole R18H release (H00 §9; H06's alarms ≈ USD 3.40 of it).
