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

**Routine changes no longer need this section: they are planned, gated and applied in GitHub (§15), after one
approval.** A worker writes the change and its allow-list and never plans with credentials. What follows is the
local recipe for break-glass changes (§15 Break-glass) and for a supervisor reproducing a pipeline failure.

Read-only, `AWS_PROFILE=dev` (after the §10 cutover: `devcards-admin`), never `apply`/`import`. For E01–E05 (prod) and every staging root,
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
3. Export `TF_VAR_alert_email` (or use a gitignored `prod.auto.tfvars`). The Snowflake ExternalId
   step is gone: the Snowflake role was retired in R26 P03 (2026-10-02).
4. `terraform -chdir=infra/envs/prod plan -input=false -out=<tag>.tfplan`.
5. `terraform -chdir=infra/envs/prod show -json <tag>.tfplan > <tag>.plan.json`.
6. `python3 infra/scripts/check-plan.py --plan <tag>.plan.json --allow docs/delivery/r16-issues/<TAG>.plan-allow.json` (run from repo root).
7. Remove `infra/envs/prod/backend_override.tf` and the plan files.

From E06 the prod plan reads the real backend read-only (`init -reconfigure` with the committed
`backend.tf`, `plan -lock=false`); the override recipe stays for the staging roots.

## 3. Apply (supervisor only)

Routine applies run in `.github/workflows/terraform.yml` behind the owner's approval in the `infra-prod`
environment (§15). This local apply, with `devcards-admin` (MFA), is for break-glass only: `module.operators`, the
audit trail, imports, state surgery, an apply the pipeline left half-done (§15 Break-glass).

`terraform init -reconfigure` with the real backend (no override file), then
`terraform plan -out=<tag>.tfplan`, the allow-list check, `terraform apply <tag>.tfplan`, the
issue's post-apply CLI cleanups, and the second plan (§5).

Release gates come first: for R26 P03 the core-vpc R26 build must already be the prod alias target (§9).

## 4. Post-apply cleanups

Supervisor CLI after each apply (never a worker, never a file in git): stray log groups, stale
secrets, unattached policies, old Lambda versions / provisioned concurrency / SnapStart, and the
stray aliases are removed by `aws ... delete-*`. E01 itself has no cleanups; nothing in AWS changes.

## 5. Second plan must be empty

After apply the supervisor (or the pipeline's apply job, §15) runs a second `terraform plan` and checks it with no `--allow`; it must
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
3. Stop the automation in core-vpc: `AUTOMATION_MODE=off` in `src_C/env/prod.env.json`, deployed to core-vpc.
   The only step that stops every server-side automation path (it needs a deploy, so it is not instant).
   Two ways (§12):
   - **Normal:** merge `AUTOMATION_MODE=off` to `main` and approve the CD run (its plan lists `backend` and says
     "environment files changed"), or Actions → CD → Run workflow with `targets` = `backend`.
   - **Fastest (break-glass, owner's MFA):** edit the file and run `BREAK_GLASS=1 ENV=prod ./src_C/deploy.sh` (the
     edit dirties the tree, so the local preflight refuses without `BREAK_GLASS=1`). Then merge the same change to
     `main` **before approving any CD run whose plan lists `backend`**: CD deploys `main`'s `prod.env.json` over the
     live value, so an unmerged `off` is turned back on by the next backend deploy.
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

### User-facing refusals (R28 MONITOR)

Three alarms on the alerts topic for requests users are refused (user-perspective review 2026-10-04, G4),
`treat_missing_data = notBreaching` (no traffic is not an outage; `developercards-prod-synthetic-check-failing`
covers that). The HTTP API publishes no throttle metric (a throttled request is one more `4xx`) and cannot leave a
caller out of `AWS/ApiGateway` `4xx` / `Count`, so they read log metric filters
(`infra/modules/observability/alarms_r28.tf`; namespace `DeveloperCards`, no dimensions, 1 per matching line):

| Metric | Log group | Counts |
|---|---|---|
| `ApiUserRequests` | `/aws/apigateway/developercards-api` | the app's and the console's requests: every access-log line except the synthetic check (`userAgent` `DeveloperCards-Synthetic/*`: its token-less `GET /api/v1/me` and `/api/v1/sync/progress` are 8 of the API's 4xx every hour by design), the unmatched routes `ANY /{proxy+}` and `$default` (scanners and retired paths: 99 of their 106 requests in the 14 days to 2026-10-04 were 4xx) and the server-to-server callbacks `POST /api/internal/*`, `GET`/`POST /api/v1/internal/*`, `POST /webhooks/*` and the author runner's `POST /api/v1/authoring/automation/runner/*` (5–15 an hour since 2026-10-01, against 43 app and console requests in those 79 hours; `local.api_non_user_routes`, kept equal to `gateway.tf`'s routes by `infra/scripts/tests/test_r28_monitor.py`) |
| `ApiUser4xx` | the same | the same lines with a `4xx` status |
| `Api429Responses` | the same | every `429`, any caller (the probe too), any route |
| `CoreVpcAuthRejects` | `/aws/lambda/core-vpc` | core-vpc's warn lines `{"level":"warn","tag":"auth","reason":…,"traceId","method","path"}`: from `Auth.cs`, a bearer core-vpc verified itself (a route without a JWT authorizer, a direct invoke) and rejected, or an admin-group token that failed the console binding; from `AgentClientPolicy.cs`, the local agent's token on a route outside its allow-list (`agent_client_forbidden`, 403). The info line for a non-JWT bearer is not counted |

Both stages write to the access log group and its line carries no stage, so `dev` counts too (1 request in the week
to 2026-10-04). Reading the API access log needs `devcards-admin` (the read-only role is denied it by design);
core-vpc's log is readable with `devcards-ro`.

- `api-4xx-rate` — in three hours at least half of the app's and console's API requests got a 4xx (guards: ≥ 5
  requests and ≥ 5 4xx in the window). An authorizer, CORS or client change that refuses users. Users send a few
  requests a day, in bursts (43 in the 79 hours from 2026-10-01, in 7 of them), so the window is three hours and the
  guard 5: a refusal of every app request shows once 5 of them arrive, and a single refused request never pages
  (the R28 review, F1, found the first version, hourly with ≥ 10 requests and the callbacks counted, could not see
  it). Replayed read-only over 2026-09-22 12:00 – 2026-10-04 07:00 UTC from the route metrics (the probe as
  `GET /health` and the 4xx of `GET /api/v1/me`), as rolling three-hour sums: it would have fired once, at
  2026-09-26, in ALARM from 07:00 to about 11:00 UTC (at most 25 of 35 refused: the console's CORS preflights answered
  401), and in no other window.
  After a fix it returns to OK within three hours. First, which routes and statuses (Logs Insights,
  `/aws/apigateway/developercards-api`, the three hours before the alarm):
  ```
  filter status like /^4/ and userAgent not like /^DeveloperCards-Synthetic/ and routeKey != "ANY /{proxy+}" and routeKey != "$default" and routeKey not like /^POST \/api\/internal\// and routeKey not like /^(GET|POST) \/api\/v1\/internal\// and routeKey not like /^POST \/webhooks\// and routeKey not like /^POST \/api\/v1\/authoring\/automation\/runner\//
  | stats count(*) as n by routeKey, status, authorizerError, ip
  | sort n desc
  ```
  401 with an `authorizerError` on the JWT routes: the authorizers (issuer and audience in
  `infra/modules/api/gateway.tf`, the pools; the `cognito-console` / `cognito-mobile` synthetic checks); 403
  answered by core-vpc: an app policy (`AgentClientPolicy`, the console binding); all from one `ip`: one broken
  client (a signed-out session retrying), not a release; acknowledge and watch it clear. Then what changed last:
  the newest Terraform apply (Actions → Terraform), CD deploy (Actions → CD) or OTA.
- `api-429` — at least 3 responses were 429 in 15 minutes. Either a gateway throttle (`integrationLatency` is `-`:
  core-vpc was never invoked) or an app limit core-vpc answered (`AI_QA_DAILY_CAP`, `REPORT_DAILY_LIMIT`, the
  anonymous-funnel budget). Logs Insights: `filter status = "429" | fields routeKey, integrationLatency, userAgent | sort @timestamp desc | limit 50`.
  Compare with `aws apigatewayv2 get-stage --api-id ktbq1sie2c --stage-name '$default' --query '{d:DefaultRouteSettings,r:RouteSettings}'`
  and `route_throttles` / the stage default (200 rps, burst 400) in `gateway.tf`. A limit of 0 throttles every
  request (the 2026-09-23 incident): revert the change that wrote it.
- `core-vpc-auth-rejects` — core-vpc rejected at least 10 bearer tokens in 15 minutes (none in the 14 days to
  2026-10-04). `aws logs filter-log-events --log-group-name /aws/lambda/core-vpc --filter-pattern '{ ($.tag = "auth") && ($.level = "warn") }' --start-time <epoch ms> --query 'events[].message'`
  and count by `reason`: `jwks_unavailable` — core-vpc cannot fetch a pool's JWKS (the `cognito-*` synthetic
  checks, Cognito's health in ap-southeast-2, core-vpc's egress); `expired`, `invalid`, `issuer`, `alg`, `kid`,
  `unknown_kid`, `token_use` on one `path` — forged or stale tokens sent to a route without an authorizer (a scan;
  nothing is granted: the request is anonymous and gets 401); `admin_issuer` / `admin_client` — an admin-group
  token from the mobile pool or an app client missing from `AUTH_CONSOLE_CLIENT_IDS` (`src_C/env/prod.env.json`);
  `agent_client_forbidden` (`src_C/Vpc/AgentClientPolicy.cs`, 403) — the local agent's token (the MCP server or the
  author runner) called a route outside its six allowed ones: a new tool or runner call that the policy and the
  gateway's agent routes were not extended for (compare `path` with `AllowedSuffixes`; extend both together), or
  something on the owner's machine using the token on disk (check the machine, then revoke the agent sessions in the
  console pool); `unverified_jwt_enabled` — must never appear in production: `AUTH_ALLOW_UNVERIFIED=1` with
  `API_ENV` not `production`; fix core-vpc's environment and redeploy at once.

A fourth R28 alarm, `developercards-prod-synthetic-remote-config-failing`, is the synthetic check's: §8.

Cost ≤ USD 1.30/month: the four filters are free, their custom metrics up to USD 0.30 each, prorated by the hours
they carry data (`ApiUserRequests` and `ApiUser4xx` only in hours with app or console traffic, `Api429Responses` and
`CoreVpcAuthRejects` normally none), the three alarms USD 0.40 (the rate alarm reads two metrics), and the
api-availability 6-hour and 30-minute children one more metric each (USD 0.20). The remote-config alarm (USD 0.10)
and its metric (USD 0.30) are counted in `services/synthetic-check/README.md`.

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

- HTTP APIs do not support X-Ray, so a request trace starts at the Lambda. (`edge-public`, never traced, was retired
  on 2026-10-04: §14.)
- A function traces only from its first version published after H05: published versions freeze the tracing
  mode, so a `prod` alias on an older version still shows no traces until the next deploy.
- core-vpc and worker-lambda run in the VPC without an X-Ray interface endpoint. Lambda's own trace daemon
  (`169.254.79.129:2000`) sits on the Lambda host, so the function segments are expected without one. If
  the `AWS::Lambda::Function` segments of those two are missing, record it in the H05 notes; the endpoint
  (≈ USD 14.60/month) is an owner decision (H00 §3.6), and the log correlation above still works.

### The SLO table

All three SLOs use a rolling **28-day** window; error budget = 1 − target; burn rate = (bad / total) /
(1 − target). Fast burn ≥ **14.4** spends 2 % of the budget in 1 hour; slow burn ≥ **6** spends ≈ 5 % in 6
hours. Minimum-event guards stop one bad request from paging at 13–124 requests a day. Both burns are
multi-window (SRE workbook): fast = 1 h AND 5 min, slow = 6 h AND 30 min, so an alarm clears within about
5 / 30 minutes of recovery instead of staying in ALARM for the whole long window.

| SLO | SLI | Target | Window |
|---|---|---|---|
| api-availability | app API requests (API Gateway `Count`) without a `5xx`. The slow burn and the budget leave out the synthetic check's own requests (`GET /health`, and the `4xx` of `GET /api/v1/me` and of `ANY /api/v1/sync/{proxy+}`, which are the token-less probes' 401s) through the detailed route metrics; the fast burn counts every request. Scheduled `/api/internal/*` callbacks that pass the gateway are counted. | 99.5 % | 28 days |
| sync-latency | requests to `POST /api/v1/sync/push`, `GET /api/v1/sync/progress`, `POST /api/v1/draw-state/sync` served in ≤ 2000 ms (EMF `Latency` `PR(:2000)` weighted by `SampleCount`). This is **handler latency**: RouteMetrics times the core-vpc dispatch, so Lambda init / cold start is not in it. | 95 % | 28 days |
| publish-success | publish jobs that end in success (`PublishJobsSucceeded` vs `PublishJobsFailed`) | 95 % | 28 days |

The synthetic check sends 12 API requests an hour (4 × `GET /health`, 4 × `GET /api/v1/me` → 401, and since R28
MONITOR 4 × `GET /api/v1/sync/progress` → 401). Counted as traffic, they would be most of the availability
denominator at 13–124 real requests a day, and the budget would read ≈ 100 % whatever users saw. That is why the
slow burn and the budget subtract them. The 1-hour fast-burn guard is ≥ **24** requests (≥ 16 before R28),
twice the probes' 12, so the probes alone never meet it and are at most half of the hour it measures
(`slo_probe_api_requests_per_hour` in `slo_r18h.tf`; `services/synthetic-check/tests/test_infra_contract.py`
fails when the probe's API checks and these numbers drift apart). A synthetic-only outage in a quiet hour (the
probe's own requests 5xx) therefore
pages through `developercards-prod-synthetic-check-failing` (≈ 30 minutes), which is the alarm built for the
"no real traffic" case, and not through the SLO alarms.

**Dormant at 2026-09 traffic** (replayed read-only on 2026-09-29 over the data since 2026-09-21): the sync
routes saw 14 requests in total, at most 6 in one hour and 10 in 6 hours, so the sync guards (≥ 6 per hour, ≥
12 per 6 hours) are almost never met. No publish job ran, so the publish guard (≥ 2 failed jobs) is never met.
Those alarms stay `OK` / `INSUFFICIENT_DATA` at this volume: a sync latency regression is visible only on the
dashboard (`Latency p95 by Route (top 10)`, `Sync latency burn rate (1 h)`) and in `SyntheticCheckLatency`.
The deleted `core-vpc-duration-p95` was just as dormant (≥ 10 invocations in each of 3 five-minute periods),
so no paging coverage was lost. For api-availability, requests other than the probes reached ≥ 8 in an hour
(the fast guard) in 7 of 183 hours, and ≥ 30 in 6 hours (the slow guard) in 41 of 183 windows: the fast burn
is rare but live, the slow burn is live.

| Alarm | Means | Pages | First three things to check |
|---|---|---|---|
| `developercards-prod-slo-api-availability-fast-burn` | composite: the 1-hour **and** 5-minute availability burn are both ≥ 14.4 | yes | 1. `API 5xx by route (top 10)` on the dashboard (or run `SEARCH('{AWS/ApiGateway,ApiId,Method,Resource,Stage} MetricName="5xx" ApiId="ktbq1sie2c" Stage="$default"', 'Sum', 300)` in the metrics console); 2. core-vpc errors / throttles (`developercards-prod-core-vpc-errors`, `-core-vpc-throttles`); 3. recent deploys (`aws lambda list-aliases --function-name core-vpc`) |
| `developercards-prod-slo-api-availability-slow-burn` | composite: the 6-hour **and** 30-minute availability burn, synthetic check excluded, are both ≥ 6; actions suppressed while the fast burn is in ALARM and 30 minutes after | yes | same three as the fast burn; also RDS CPU / connections |
| `developercards-prod-slo-api-availability-burn-1h` | child: 1-hour burn ≥ 14.4 (≥ 24 requests, ≥ 2 5xx; all requests) | never | only read as part of the composite |
| `developercards-prod-slo-api-availability-burn-5m` | child: 5-minute burn ≥ 14.4 | never | only read as part of the composite |
| `developercards-prod-slo-api-availability-burn-6h` | child: 6-hour burn ≥ 6 (≥ 30 requests, ≥ 3 5xx; synthetic check excluded) | never | only read as part of the composite |
| `developercards-prod-slo-api-availability-burn-30m` | child: 30-minute burn ≥ 6 (synthetic check excluded) | never | only read as part of the composite |
| `developercards-prod-slo-sync-latency-fast-burn` | composite: the 1-hour **and** 5-minute sync-latency burn are both ≥ 14.4 (≥ 72 % of sync requests slower than 2 s). **Dormant at 2026-09 traffic**: needs ≥ 6 sync requests in an hour | yes (dormant) | 1. `Latency p95 by Route (top 10)` on the dashboard; 2. core-vpc cold starts (`Init Duration` in REPORT lines; not in this SLI) and memory; 3. RDS CPU (`developercards-prod-rds-cpu`) |
| `developercards-prod-slo-sync-latency-slow-burn` | composite: the 6-hour **and** 30-minute sync-latency burn are both ≥ 6 (≥ 30 % slow); suppressed while the fast burn pages. **Dormant at 2026-09 traffic**: needs ≥ 12 sync requests in 6 hours | yes (dormant) | same three as the fast burn |
| `developercards-prod-slo-sync-latency-burn-1h` | child: 1-hour burn ≥ 14.4 (≥ 6 requests); dormant at 2026-09 traffic | never | only read as part of the composite |
| `developercards-prod-slo-sync-latency-burn-5m` | child: 5-minute burn ≥ 14.4 | never | only read as part of the composite |
| `developercards-prod-slo-sync-latency-burn-6h` | child: 6-hour burn ≥ 6 (≥ 12 requests); dormant at 2026-09 traffic | never | only read as part of the composite |
| `developercards-prod-slo-sync-latency-burn-30m` | child: 30-minute burn ≥ 6 | never | only read as part of the composite |
| `developercards-prod-slo-publish-success-fast-burn` | 1-hour publish burn ≥ 14.4 (≥ 2 failed jobs). **Dormant at 2026-09 traffic**: no publish job ran | yes (dormant) | 1. worker logs `Job marked as FAILED` in `/aws/lambda/worker-lambda`; 2. the publish DLQ (`developercards-prod-dlq-nonempty`); 3. `developercards-prod-worker-errors` |
| `developercards-prod-slo-publish-success-slow-burn` | composite: the 6-hour (≥ 2 failed jobs) **and** 30-minute (≥ 1 failed job) publish burn are both ≥ 6; suppressed while the fast burn pages. **Dormant at 2026-09 traffic** | yes (dormant) | same three as the fast burn |
| `developercards-prod-slo-publish-success-burn-6h` | child: 6-hour burn ≥ 6 (≥ 2 failed jobs); dormant at 2026-09 traffic | never | only read as part of the composite |
| `developercards-prod-slo-publish-success-burn-30m` | child: 30-minute burn ≥ 6 (≥ 1 failed job) | never | only read as part of the composite |
| `developercards-prod-synthetic-check-failing` | two consecutive synthetic runs failed or did not run (every check except `remote-config`) | yes (once enabled) | the synthetic check subsection below |
| `developercards-prod-synthetic-remote-config-failing` | `remote-config` failed in two consecutive runs (R28 review F2; missing data not breaching) | yes | the synthetic check subsection below, `remote-config` |

Paging: the two fast-burn composites, the three slow-burn composites, the publish fast burn and the two
synthetic alarms (8 alarms). The ten children (`…-burn-1h`, `…-burn-5m`, `…-burn-6h`, `…-burn-30m`) never
page; they have no actions and exist only to feed the composites. The publish alarms stay
`INSUFFICIENT_DATA` / `OK` until a publish job runs (missing data is not breaching).

One incident, one page: each slow-burn composite names its SLO's fast burn as its actions suppressor
(`extension_period` 30 minutes, `wait_period` 5 minutes). While the fast burn is in ALARM, and for 30 minutes
after it clears, the slow burn changes state without notifying. If the slow burn is still in ALARM when the
suppression ends, it notifies then. A slow burn with no fast burn notifies after at most the 5-minute wait.
After recovery a slow burn clears when its 30-minute child clears (≤ 30 minutes), not after 6 hours; the 6-hour
child may stay in ALARM up to 6 hours, which is expected and silent.

Replaced and kept:

- `developercards-prod-api-5xx` was replaced by api-availability: same two metrics, but its
  `IF(count > 20, …)` guard per 5 minutes never evaluated at this traffic.
- `developercards-prod-core-vpc-duration-p95` was replaced by sync-latency: it flapped 6 times on
  2026-09-28 on cold starts, and it measured every core-vpc invocation, including the scheduled
  `/internal/*` calls, not only the app's sync requests. The new SLI is handler latency of those three
  routes; neither metric includes Lambda init (`AWS/Lambda Duration` excludes `Init Duration` too).
- Kept on purpose: `developercards-prod-core-vpc-errors` (scheduled `/internal/*` invocations never pass
  API Gateway, so availability cannot see them), `developercards-prod-worker-errors` and
  `developercards-prod-dlq-nonempty` (crash and timeout paths that emit no publish gauge).
- A database outage is not visible to the synthetic check (`GET /health` answers before any DB access). It
  pages through `developercards-prod-notifier-errors`: the 15-minute automation tick touches the DB, core
  answers 500, the notifier raises, and the alarm fires on one Lambda error in 5 minutes (≈ 22 minutes
  worst case; I02 notes, `services/synthetic-check/README.md`).

### Error-budget policy

- The dashboard section "SLOs (R18H)" shows the budget remaining over 28 days per SLO, and beside it the
  number of events in the window. A budget reads **100 %** until its window holds its minimum N, chosen so
  that one bad event costs at most 10 % of the budget (N = 10 / budget):

  | SLO | Minimum N in 28 days | Events at 2026-09 traffic |
  |---|---|---|
  | api-availability | 2,000 requests, synthetic check excluded | ≈ 320 (since 2026-09-21) |
  | sync-latency | 200 sync requests | 14 |
  | publish-success | 200 publish jobs | 0 |

  Below N the widget's 100 % means "not enough events to measure", not "no errors". Read the event count
  and the burn-rate widgets instead. Without the guard, sync would read −42.9 % from 1 slow request out of 14
  (measured at 128 MB).
- Above N, budget remaining **< 25 %** on any SLO ⇒ reliability work comes before feature work until the
  budget recovers above 25 %. Below N the policy does not apply.
- Review the sync-latency target after 28 days of data at **512 MB** (core-vpc moved from 128 MB on
  2026-09-29; the 95 % ≤ 2000 ms target was chosen on 128 MB data), due 2026-10-27. In the same review,
  check whether the sync guards (≥ 6 per hour, ≥ 12 per 6 hours) and the three budget minimums are ever met,
  and lower them or accept the SLOs as dashboard-only.
- After a release, expect each budget to show its real value, or 100 % below N. Do not expect ~100 %: at
  2026-09 volume every budget is below N. The 128 MB slow sync request leaves the sync window on 2026-10-25.

### Synthetic check

`developercards-synthetic-check` runs every 15 minutes (schedule `developercards-synthetic-check`, input
`{"job":"synthetic-check"}`) and runs nine checks in order: `api-health` (`GET /health`), `cdn-manifest`
(the app's content manifest), `cdn-deck` (the first public live deck, SHA-256 checked), `console-index`
(the console's HTML), `api-auth-guard` (`GET /api/v1/me` without a token must be exactly 401) and, since R28
MONITOR (2026-10-04; no account, no new IAM, every URL public): `api-sync-guard` (`GET /api/v1/sync/progress`
without a token must be exactly 401: the app's sync route is served and guarded), `remote-config` (the
document the app reads at every cold start, `mobile/App.tsx` `REMOTE_CONFIG_URL` on raw.githubusercontent.com:
200, JSON and the schema rules in `services/synthetic-check/README.md`), `cognito-console` and `cognito-mobile`
(each pool's OIDC discovery document names its own issuer and JWKS URL, and the JWKS holds an RS256 signing
key). It emits `SyntheticCheckSuccess` (1 when every check except `remote-config` passes),
`SyntheticRemoteConfigSuccess` (1 when `remote-config` passes; R28 review F2) and `SyntheticCheckLatency`; the EMF
line lists every failed check with a code, and the R28 checks with a `detail` (a rule id such as `ios.updateUrl`,
`features.paywall.hidden`, `discovery`, `jwks.rs256`; never a value from the response).

`remote-config` is **advisory**: a third party serves the document and the app keeps its last good copy, so it is
not in `SyntheticCheckSuccess`, nor in the run's `ok` / `failed` (the CD smoke), and pages only through its own
alarm `developercards-prod-synthetic-remote-config-failing` (two consecutive failed runs, missing data not
breaching). Before the review it was in `SyntheticCheckSuccess`: a GitHub raw incident or a document breaking a
rule would have held `developercards-prod-synthetic-check-failing` in ALARM, and a real API, CDN, console or
Cognito outage meanwhile would have sent no new notification.

| Code | Meaning |
|---|---|
| `HTTP_STATUS` | unexpected status (including any redirect) |
| `TIMEOUT` | no answer within `CHECK_TIMEOUT_SECONDS` |
| `NETWORK` | DNS, TLS or connection failure |
| `BAD_BODY` | the body is not the expected JSON / HTML |
| `HASH_MISMATCH` | the deck's SHA-256 differs from the manifest |
| `TOO_LARGE` | body over the size cap (1 MiB manifest, 5 MiB deck, 64 KiB remote config and Cognito documents) |
| `NO_PUBLIC_DECK` | the manifest failed or lists no public live deck |
| `CONFIG` | a base URL in the environment is not `https://` |
| `ERROR` | an unexpected exception inside the check |

First checks for the R28 checks:

- `api-sync-guard` `HTTP_STATUS` with status 200 or 403: the sync route lost its JWT authorizer (gateway.tf
  `routes.sync`), every caller reaches core-vpc. 429: a throttle (`developercards-prod-api-429` fires too). 5xx:
  the API is down (`api-health` fails too).
- `remote-config` (alarm `developercards-prod-synthetic-remote-config-failing`) `BAD_BODY`: open the document
  (`curl -s https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json`),
  fix the field the `detail` names in the config repository (`ios.minSupportedVersion`: 1–3 dot-separated
  numbers; `ios.updateUrl`: only `https://apps.apple.com/…`; `latestVersion` is never compared, the app does not
  use it). An `updateUrl` that is not the App Store, or a change nobody made, is a security incident: check the
  config repository's history first. `HTTP_STATUS` / `NETWORK` / `TIMEOUT`: GitHub raw is unreachable; the app
  keeps its last good copy, so this is not a user outage by itself (githubstatus.com). To silence it through a
  long GitHub incident: `aws cloudwatch disable-alarm-actions --alarm-names developercards-prod-synthetic-remote-config-failing`
  and `enable-alarm-actions` afterwards (Terraform ignores `actions_enabled` on it, so no drift).
- `cognito-console` / `cognito-mobile`: `detail` `discovery` or `jwks` with a transport code is a Cognito
  regional problem (AWS Health Dashboard, ap-southeast-2): users cannot sign in. `discovery.issuer` /
  `discovery.jwks_uri` / `jwks.*`: the pool answers something unexpected; check the pool still exists
  (`aws cognito-idp describe-user-pool --user-pool-id <pool id>`) and that `COGNITO_*_ISSUER` in
  `services/synthetic-check/env/prod.env.json` names it.

One supervised run (after a deploy, or to confirm a fix):
`aws lambda invoke --function-name developercards-synthetic-check:prod --payload '{"job":"synthetic-check"}' --cli-binary-format raw-in-base64-out /dev/stdout`
⇒ `{"ok": true, "failed": [], "advisoryFailed": []}` (`advisoryFailed: ["remote-config"]` with `ok` true is the
remote-config alarm's case, not an outage).

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

- **Tracing:** live traffic runs on the `prod` alias of a published version, and a published version keeps
  the tracing mode it was published with. Changing `$LATEST` alone (`update-function-configuration
  --tracing-config Mode=PassThrough`) does **not** change live traffic. Either:
  - quickest: move the alias back with the `ROLLBACK` line the deploy printed (`aws lambda update-alias
    --function-name <fn> --name prod --function-version <previous>`). That version predates `Active` tracing,
    but it also rolls back the code shipped with it; or
  - keep the code: revert H05's `tracing_config` lines and apply (`$LATEST` becomes `PassThrough`), then
    redeploy (`ENV=prod ./src_C/deploy.sh` for core-vpc and worker-lambda, `services/deploy-python-lambda.sh`
    for the Python services). The deploy publishes a new version and moves `prod` to it. By hand, the same is
    `aws lambda publish-version --function-name <fn>` and then
    `aws lambda update-alias --function-name <fn> --name prod --function-version <new>`.

  Either way, finish with the Terraform revert so the next plan is empty.
- **core-vpc after R26:** moving the alias back is limited once migration 045 has run; see "Rollback of core-vpc
  (R26)" in §9 before using the `ROLLBACK` line.
- **Synthetic check:** disable the schedule (`--state DISABLED` above) and the alarm actions
  (`disable-alarm-actions` above).
- **SLOs:** revert H06 and I03; the apply removes the sixteen SLO alarms and restores
  `developercards-prod-api-5xx` and `developercards-prod-core-vpc-duration-p95`. To undo only I03 (single-window
  slow burn, probes counted, unguarded budgets), revert I03; the `moved` blocks go with it, and the apply
  replaces the three `…-burn-6h` children with the three single `…-slow-burn` metric alarms again.

No rollback changes any data.

Cost: ≈ USD 4.80/month for the whole R18H release (H00 §9; H06's alarms ≈ USD 3.40 of it), plus ≈ USD
3.10/month for I03: three 30-minute children (api 5 + sync 6 + publish 2 = 13 alarm-metrics, USD 1.30), the api
6-hour child going from 2 to 5 metrics (USD 0.30), and three slow-burn composites (3 × USD 0.50). The
dashboard widget is free.

## 9. R26: Snowflake and the analytics outbox retired

R26 S01 removes the outbox publisher and the content-intelligence import from core-vpc and adds migration 045
(drops `analytics_event_outbox` and the two `content_intelligence_*` tables). R26 P03 removes the Snowflake IAM role,
the outbox alarm and widget, and the `core-vpc/analytics/*` object grant from the core-vpc role. The Terraform plan
looks the same whatever build is live, so `check-plan.py` cannot catch a wrong order; these steps are the gate.

1. **Deploy order: the core-vpc R26 build first, then the P03 terraform apply.** The pre-R26 build still writes
   `analytics/raw/` (OutboxPublisher) and reads `analytics/marts/` (content-intelligence import); after P03's IAM
   change those calls get S3 AccessDenied. Before `terraform apply`, confirm the prod alias runs a build that
   contains S01 (read-only; do not call the old publish route as a probe, on a pre-R26 build it publishes):
   ```bash
   v="$(aws lambda get-alias --function-name core-vpc --name prod --query FunctionVersion --output text)"
   sha="$(aws lambda get-function-configuration --function-name core-vpc --qualifier "$v" \
     --query Description --output text | awk '{print $NF}')"
   git merge-base --is-ancestor 66644472 "$sha" && echo "S01 is live: P03 may apply"
   ```
   No `S01 is live` line (including a `nogit` description): stop, deploy core-vpc (`ENV=prod ./src_C/deploy.sh`)
   and check again.
2. Plan and gate P03 as in §2/§3 with `docs/delivery/r26-issues/P03.plan-allow.json`, apply, second plan (§5).
3. **Migration 045 is the owner's step.** Migrate stops before a destructive migration unless
   `confirmDestructive=<version>` is passed (the version the dryRun shows): the owner runs
   `POST /api/v1/admin/db/migrate?confirmDestructive=<045 version>` through `scripts/invoke-as-admin.sh`, only after
   the deployed R26 build has been smoke-tested in prod. A plain migrate call applies the additive migrations before
   045 and reports it as `blockedBy`.
4. **Roll forward only once 045 has run.** Never move the core-vpc prod alias to a pre-R26 version: its ingest still
   inserts into `analytics_event_outbox`, which 045 dropped, so signed-in sync pushes fail. Fix forward with a new
   deploy instead.

Status 2026-10-02: the core-vpc R26 build is live (version 74, commit c0f3ac7), P03 is applied, and the owner ran
045 (`confirmDestructive=45`). From here core-vpc rolls forward only: never move `prod` to version 73 or earlier.
From this date `src_C/deploy.sh` prints a `ROLLBACK:` line (the alias version it replaced) after each alias move.

### Rollback of core-vpc (R26)

- Before 045 has run: the `ROLLBACK` line from the deploy (alias back to the previous version) is safe only while
  P03 is not applied. The core-vpc R26 build is deployed first and P03 applies after it, so once P03 is applied a
  pre-R26 version gets S3 AccessDenied on `analytics/raw/` and `analytics/marts/`; roll back P03 (revert and apply)
  before moving the alias, or fix forward.
- After 045 has run: roll forward only. No pre-R26 version may become the prod alias target, because its ingest
  inserts into the dropped `analytics_event_outbox`. There is no recreate script; deploy a fixed build instead.
- Migrate never drops anything on its own: it stops before a destructive migration unless
  `confirmDestructive=<version>` names that migration's version.

## 10. Operator identities (enterprise audit SEC-01, 2026-10-03)

The static key (user `devcards-admin`, profile `dev`) used to carry AdministratorAccess for the owner, every
deploy and every agent. `infra/modules/operators` splits that into three roles; `~/.aws/config` has one profile
per role, each with `source_profile = dev`:

| Profile | Role | MFA | Who | Can |
|---|---|---|---|---|
| `devcards-ro` | `devcards-agent-readonly` | no | Claude sessions, workflow and DDW workers, investigations | AWS ReadOnlyAccess **minus** SSM/KMS decrypt, Secrets Manager, Lambda configuration (its environment holds the injected secrets), S3 object reads (tfstate, user content, CloudTrail), Cognito user records, RDS logs, SQS receive |
| `devcards-deploy` | `devcards-deployer` | **yes** (since #740) | break-glass only: `src_C/deploy.sh`, `services/deploy-python-lambda.sh`, `frontend/deploy.sh`, `site/deploy.sh`, `scripts/rollback.sh`, `infra/scripts/rds-snapshot.sh` (all default to it) | update / publish / re-alias core-vpc, worker-lambda and the five `developercards-*` Python functions; read `/developercards` SSM through KMS-via-SSM; sync the console and site buckets and invalidate their two distributions; pre-migration DB snapshot. Not: newsapp, IAM, `lambda:InvokeFunction` (so not `scripts/smoke.sh`: use `devcards-admin`), tfstate, content buckets |
| `devcards-admin` | `devcards-admin-mfa` | **yes** | the owner; Terraform; `scripts/invoke-as-admin.sh`; break-glass | AdministratorAccess, 1-hour session |

```
profile                      add to ~/.aws/config
[profile devcards-ro]        role_arn = arn:aws:iam::622994489535:role/devcards-agent-readonly
                             source_profile = dev, role_session_name = agent-readonly, region = ap-southeast-2
[profile devcards-deploy]    role_arn = arn:aws:iam::622994489535:role/devcards-deployer
                             source_profile = dev, mfa_serial = arn:aws:iam::622994489535:mfa/TimeAwakeAdmin
                             duration_seconds = 3600, role_session_name = deploy-breakglass, region = ap-southeast-2
[profile devcards-admin]     role_arn = arn:aws:iam::622994489535:role/devcards-admin-mfa
                             source_profile = dev, mfa_serial = arn:aws:iam::622994489535:mfa/TimeAwakeAdmin
                             duration_seconds = 3600, role_session_name = owner-admin, region = ap-southeast-2
```

CloudTrail now names the actor: `assumed-role/developercards-gha-prod/<run>` is a CD deploy, `assumed-role/devcards-deployer/deploy-breakglass` a local one,
`assumed-role/devcards-agent-readonly/agent-readonly` an agent, `assumed-role/devcards-admin-mfa/owner-admin` the owner.

**Terraform after the cutover.** Even `plan` needs `devcards-admin`: it reads the tfstate object and refreshes Lambda
configuration, both denied to `devcards-ro` by design. The owner types the MFA code once: `aws sts get-caller-identity --profile devcards-admin`.
The CLI caches the 1-hour session; Terraform (which cannot prompt for MFA) then runs with
`eval "$(aws configure export-credentials --profile devcards-admin --format env)"` in the same shell. Since §15 this is
the break-glass path: routine applies run in GitHub, and the owner's approval of the `infra-prod` environment is the
approval step instead of the MFA code. The plan allow-list (§2–§5) is the same in both.

**Cutover (owner present).** 1) Owner: `aws sts get-caller-identity --profile devcards-admin` (enter the code).
2) `infra/scripts/operator-cutover.sh` (preflight) then `CONFIRM=1 infra/scripts/operator-cutover.sh`: attaches
`devcards-operator-base` (assume the three roles, see own user), detaches AmazonEC2FullAccess / AmazonS3FullAccess,
removes the user from `admins`, and proves `dev` alone is now denied. Rollback is the printed
`aws iam add-user-to-group --profile devcards-admin --user-name devcards-admin --group-name admins`.

**What this does not stop (review of PR #736, 2026-10-03).** The roles bind whoever *chooses* a profile, and every
agent on the deploy Mac runs as the same macOS user that can read `~/.aws/credentials` and the CLI's role-session
cache. Since #740 both roles that can change production (`devcards-deployer`, `devcards-admin-mfa`) need the owner's
MFA, sessions last one hour, and normal deploys run in GitHub Actions (§12) with no laptop credential at all. What is
left: while an owner session is cached, a process of the same user could use it; clear `~/.aws/cli/cache` after
break-glass or Terraform work. The full close is a separate OS user or sandbox for agents.

**Owner-only, console:** rotate the key (create the new key, update `~/.aws/credentials [dev]`, deactivate the old one,
delete it after a week of `GetAccessKeyLastUsed` silence). Later (enterprise phase): IAM Identity Center for people and
GitHub OIDC for CI deploys remove the static key entirely.

## 11. .NET 10 runtime for core-vpc and worker-lambda (2026-10)

AWS deprecates the Lambda `dotnet8` runtime on 2026-11-10 (security patches stop); `dotnet10` is supported
to 2028-11-14. Both C# functions move together with the code: the projects target net10.0, so a net10 zip
and the `dotnet10` runtime have to arrive in the same published version.

1. **Deploy with SDK 10.** `ENV=prod ./src_C/deploy.sh` needs the .NET 10 SDK on PATH (`src_C/global.json`
   pins it; `package_lambda_zip.sh` stops first and prints how to set `DOTNET_ROOT`/`PATH` otherwise). To
   check a zip by hand: `unzip -p src_C/dist/vpc.zip RecallSmith.Lambda.runtimeconfig.json` must show
   `"tfm": "net10.0"`.
2. **What the deploy does.** After the code update and the CodeSha256 check it sets the function's runtime to
   `${LAMBDA_RUNTIME:-dotnet10}` (`update-function-configuration --runtime`, then `wait function-updated`),
   on the `INJECT_ENV=1` and `INJECT_ENV=0` paths alike, and only then publishes the version and moves `prod`.
   It prints the `ROLLBACK:` line as soon as the alias has moved, then verifies the alias's CodeSha256 and
   `Runtime`. Between the code update and the runtime update, `$LATEST` is net10 code on dotnet8; nothing
   user-visible runs `$LATEST` (API Gateway calls `core-vpc:prod`, the publish-jobs event source mapping
   calls `worker-lambda:prod`).
3. **Terraform.** `runtime = "dotnet10"` is in both modules. Deploy first: the plan then shows no runtime
   change. Applied before the deploy, it puts the old net8 code on dotnet10 in `$LATEST` only, which serves
   no traffic; the next `deploy.sh` replaces the code before it publishes. Do not publish a version by hand
   in between.
4. **Rollback.** A published version keeps the runtime it was published with, so the `ROLLBACK:` line (alias
   back to the previous version) restores dotnet8 together with the old code. §9 still applies to core-vpc:
   never move `prod` to version 73 or earlier. Treat a rollback to a dotnet8 version as a stopgap: that runtime
   gets no security patches after 2026-11-10, so fix forward on dotnet10.
5. **Next time.** CI job `infra` runs `python3 infra/scripts/check-lambda-runtimes.py`, which fails 90 days
   before any runtime in `infra/**/*.tf` reaches its AWS deprecation date (nodejs24.x is next, 2028-04-30).
   Update its date table from the AWS lambda-runtimes page when it fires.

## 12. CD pipeline (GitHub OIDC) (enterprise audit SDLC-03, 2026-10-03)

Production is deployed by `.github/workflows/cd.yml`, behind the owner's approval, with short-lived credentials from
GitHub OIDC. No deploy credential is needed on the laptop: `devcards-deploy` becomes break-glass and requires the
owner's MFA.

### Flow

A push to a branch runs CI (the nine checks the ruleset requires; a pushed tag runs no CI). When CI **succeeds** on a
push to `main` in this repository, CD starts (`workflow_run`; a pull request, a fork or a red CI never starts it):

1. **plan** (no AWS). Runs `main`'s own scripts (it checks out `github.sha`, `main`'s tip; the commit CI ran for is
   only diffed). First, inline in `cd.yml`, that commit must be on the `main` branch (an ancestor of
   `refs/remotes/origin/main`): `workflow_run` reports a tag push with the tag's name as the branch, so a tag named
   `main` would otherwise pass for a push to main. Then `scripts/cd/plan.sh decide`: if `main` has moved on and its
   tip's CI is already green, the run deploys the tip instead (runs can reach the queue out of order, see Queueing);
   otherwise it warns which newer commits wait for their own run. Which targets changed between the commit of the
   last successful *full* CD deployment and that commit. Nothing to deploy: the run ends here, with no approval
   request. The run summary lists the commit, the base, the targets, any changed environment file
   (`src_C/env/*.env.json`, `services/*/env/*.env.json`: their values replace the live ones) and the changed paths.
2. **build** (no AWS credentials). The Lambda zips with the .NET 10 SDK (`DRY_RUN=1 src_C/deploy.sh`), the console
   (`npm ci && npm run build`, Sentry DSN from the repository variable `CONSOLE_SENTRY_DSN`), each changed Python
   service (`DRY_RUN=1 services/deploy-python-lambda.sh <svc>`: its tests, then the hash-verified build), a
   `SHA256SUMS` manifest over those files and `TARGETS` (`scripts/cd/artifact.sh stage`). Artifact `cd-build-<sha>`,
   kept 30 days. The site has no build: it is not in the artifact (see step 3).
3. **deploy** (environment `production`: **waits for the owner's approval**). Then, in one job:
   refuse a stale plan (`plan.sh still-current`: no CD deployment since the plan, see Re-runs) → verify the artifact
   against the manifest sha256 the build job passed (not read from the artifact store): every file matches, the files
   are **exactly** the ones the targets need, the console tarball holds only files and directories under `dist/`
   (it is unpacked into a fresh directory first) → assume `arn:aws:iam::622994489535:role/developercards-gha-prod`
   (its trust accepts only `repo:ChuanQiao1128/recallsmith:environment:production`; session
   `gha-cd-<run id>-<attempt>`, which is how CloudTrail names it) → preflight (identity; the console bundle carries
   the DSN SSM holds) → **baseline smoke** (`scripts/smoke.sh` before any change; never fails the job) →
   **restore point** (`scripts/cd/restore-point.sh record`: every prod alias about to move, the console's
   `index.html`, the site bucket) → deploy in order: backend (`PREBUILT=1 ENV=prod src_C/deploy.sh`), Python services
   (`PREBUILT=1 services/deploy-python-lambda.sh <svc>`), console (`PREBUILT=1 frontend/deploy.sh`), site
   (`site/deploy.sh`, from this job's own checkout of the plan's commit: the build job runs third-party code, so files
   that need no build are never taken from it) → **smoke** against the baseline → on any new failure or a cancel,
   **automatic rollback** → job summary. Smoke and rollback are steps of the approved job on purpose: a second job
   naming `production` would wait for a second approval.

`PREBUILT=1` makes each script ship the verified bytes as they are; none of them builds in the deploy job.
`src_C/deploy.sh` registers every decrypted SSM value (and every live environment value that is not a committed key)
with `::add-mask::` before anything can print it (this repository and its Actions logs are public), passes the
environment to Lambda in a 0600 file rather than on the command line, and on an environment update error prints only
the AWS error code: Lambda's message for an environment over 4 KB quotes every value.

### Approving

GitHub notifies the owner (the environment's only required reviewer). Open the run (Actions → CD, or the e-mail /
GitHub mobile notification), read the **plan** summary (commit, targets, environment files, changed paths) and the
**build** summary (`SHA256SUMS`), then **Review deployments → production → Approve and deploy** (or **Reject**). A
pending approval waits up to 30 days. Rejecting deploys nothing; the changes stay in the next run's plan. The
environment must not have "Prevent self-review" on: the owner both merges and approves.

### What deploys when

| Changed path (since the last full deployment) | Target | Deployed by |
|---|---|---|
| `src_C/**` except `src_C/Tests/**` (not in a zip) and `*.md` | `backend` = core-vpc + worker-lambda | `src_C/deploy.sh` |
| `services/<svc>/**` except `tests/**` and `*.md`; svc = ai-qa, notifier, source-watcher, synthetic-check, webhook-dispatcher | `<svc>` | `services/deploy-python-lambda.sh` |
| `frontend/**` except `frontend/tests/**` and `*.md` | `console` | `frontend/deploy.sh` |
| `site/**` | `site` | `site/deploy.sh` |
| everything else: `docs/`, `infra/`, `mobile/`, `tools/`, `.github/`, `scripts/`, … | nothing | no deploy job, no approval request |

"Since the last full deployment", not "in this push": a run that was rejected, rolled back, or cancelled while
queued leaves its changes in the next run's plan. A full deployment is marked by the environment URL the deploy job
sets on success, `https://github.com/ChuanQiao1128/recallsmith/commit/<sha>#cd-full`; a run with an explicit target
list sets `#cd-partial` and a manual rollback `#cd-rollback`, and neither becomes the next base. A record counts only
when GitHub Actions made the deployment and its first success status came from a successful `deploy (production)` or
`rollback (production)` job of `cd.yml` on `main` (checked through the Actions API), so a status posted with a token
cannot stop or redirect CD. With no full deployment on record (the **first run**) every target deploys: backend, the
five Python services, console and site, under one approval. A commit older than the last deployment (CI finishing out
of order, a re-run of an old CI run) deploys nothing older: CD never deploys backwards.

### Re-runs

- **Re-run all jobs** plans again from scratch: it deploys `main`'s green tip if anything changed since the last full
  deployment, and nothing older than production.
- **Re-run failed jobs** (or re-running the deploy or rollback job alone) reuses the first attempt's plan and
  build. The job's first step (`plan.sh still-current`) compares the newest successful CD deployment with the one
  the plan saw; if any deployment (full, partial or rollback) succeeded since, it refuses before any credential and
  changes nothing: use **Re-run all jobs**. Re-running a failed deploy right away (a transient smoke failure, nothing
  deployed since) goes ahead.
- After a rollback marked `incomplete`, finish it by hand first: a re-run records the half-restored state as its
  restore point.

### Smoke

`scripts/smoke.sh`, up to 3 attempts per check 15 s apart: (1) `GET https://api.developercards.app/health` → 200 and
`"ok": true`; (2) `aws lambda invoke --function-name developercards-synthetic-check:prod --payload
'{"job":"synthetic-check"}'` → `"ok": true` and `"failed": []` (api-health, cdn-manifest, cdn-deck, console-index,
api-auth-guard, api-sync-guard, cognito-console, cognito-mobile; §8). The advisory `remote-config` check is reported
in `advisoryFailed` and never fails the smoke: a deploy of this repository cannot change that document, and GitHub
raw being down must not roll a good deploy back. The CD role may invoke only that alias.

The deploy job runs it twice: once **before** the restore point (the baseline, never fails the job; a red baseline is
a warning on the run) and once after the deploy with `SMOKE_BASELINE`. After the deploy a check fails (and rolls
back) only on something that **newly** fails: `health`, or a synthetic check name, that passed in the baseline. A
check failing the same way before and after is `TOLERATED` (a red cdn-deck caused by published content, or the very
outage the deploy is meant to fix, no longer rolls every deploy back). Both tables are in the job summary.

Locally (after a break-glass deploy) `devcards-deploy` cannot invoke the synthetic check: run
`AWS_PROFILE=devcards-admin scripts/smoke.sh` (MFA). With an identity that gets AccessDenied it reports the check
`SKIPPED` and exits 3 (`SMOKE INCOMPLETE`), not a failure: do not roll back on that.

### Automatic rollback

On a failed or cancelled deploy or smoke, `scripts/cd/restore-point.sh restore` (with freshly assumed credentials)
puts back exactly what moved since the restore point, then the job fails:

- each Lambda prod alias whose version changed goes back through `scripts/rollback.sh` (target version checked
  Active/Successful first, alias re-read after); an alias that was on `$LATEST` goes to the version
  `lambda-release.sh` froze the live code into, never to `$LATEST` (the summary names that version too);
- the console's `index.html` is uploaded again and its ETag read back (the old hashed assets were never deleted, so
  that is the whole old console);
- the site bucket: every recorded object uploaded again (`cp --recursive`; a `sync` would skip a changed file of the
  same size), objects the deploy added removed, and the listing (key, ETag) read back and compared;
- then, last, the CloudFront invalidations of both distributions are created and waited for. Any failed command is a
  `FAILED` line.

The summary says `rollback: restored`, `incomplete`, or `not needed` (the job stopped before the restore point was
recorded: a stale plan, the artifact, the credentials or the preflight; nothing in production changed). On
`incomplete`, finish by hand from the `FAILED` lines. Not rolled back: `$LATEST` code and environment (nothing serves
`$LATEST`), the database (CD runs no migration), and anything a Python service already did while it ran.

**Cancel or timeout.** A timeout (45 minutes from the approval) is a cancellation, and GitHub force-stops a cancelled
job about 5 minutes after the cancel. The rollback therefore restores every alias and bucket first, prints its state
as an annotation (`rollback in progress: …`) before the CloudFront part, and on a cancel creates the invalidations
without waiting for them. A job killed mid-rollback leaves that annotation: check each item it does not list as
restored, and the invalidation ids it printed (`aws cloudfront get-invalidation`).

### Manual rollback

- **CD:** Actions → CD → Run workflow (from `main`), `rollback_target` = vpc / worker / ai-qa / notifier /
  source-watcher / synthetic-check / webhook-dispatcher, `rollback_version` = the version (a deploy's job summary has
  "before this run" for each alias; or `aws lambda list-versions-by-function --function-name <fn>`). It waits for the
  same approval, and refuses (like the deploy job) when a CD deployment succeeded after its plan.
- **Break-glass, local:** `aws sts get-caller-identity --profile devcards-deploy` (MFA code), then
  `scripts/rollback.sh vpc 75` (`DRY_RUN=1` prints first).

`scripts/rollback.sh` refuses core-vpc versions below 74 (§9: roll forward only). A rollback is not a deployment
base, and the next push redeploys the function only when its files change. To put `main` back without a change, Run
workflow with `targets` set to that target (e.g. `backend`). Console or site: revert on `main` and let CD deploy it,
or break-glass with the old build, `gh run download <run id> -n cd-build-<sha>`, then
`tar -xzf frontend/console-dist.tgz -C frontend && BREAK_GLASS=1 PREBUILT=1 frontend/deploy.sh` (the site:
`git checkout <old sha> -- site && BREAK_GLASS=1 site/deploy.sh`).

### Manual deploy

Actions → CD → Run workflow from `main`; `targets` = `changed` (default: the plan above), `all`, or a list such as
`backend console`. It deploys `main`'s head and only when all nine required jobs succeeded on it, read from the push
run of `ci.yml` on `main` through the Actions API (not from check runs, which any token with `checks: write` can
create under any name). A dispatch from any other branch is refused.

### Queueing

One `production` lane for whole runs: a run waits while another (including one waiting for approval) is in flight,
and GitHub keeps one queued run. A newly queued run replaces (cancels) the pending one whatever commit either
carries, so CI runs that finish out of order, or a CI re-run of an old commit, can leave the older commit's run
queued. Its plan then deploys `main`'s tip when the tip's CI is green, so nothing merged is left behind; when the tip
is not green yet it deploys its own commit and warns which newer commits wait (their CI finishing queues their run).
A run that will not deploy (CI failed, a pull request) never takes that slot. Consequences: a manual rollback waits
behind a deploy that waits for approval (reject that deploy first), and a push landing while a rollback is queued
replaces it (run it again, or use the local rollback).

### Break-glass local deploy

For an outage that cannot wait for CI. `devcards-deploy` now needs the owner's MFA (Setup step 2). Enter the code once
with `aws sts get-caller-identity --profile devcards-deploy`; the CLI caches the session for the scripts, which keep
defaulting to that profile when the environment has no credentials of its own. `AWS_PROFILE` or exported credentials
(`eval "$(aws configure export-credentials --profile <p> --format env)"`) always win.

All four deploy scripts, `src_C/deploy.sh`, `services/deploy-python-lambda.sh`, `frontend/deploy.sh` and
`site/deploy.sh`, first run `scripts/deploy-preflight.sh`: the working tree is clean (untracked files count), `HEAD`
is `origin/main` after a fetch, and the nine required jobs succeeded on it in the push run of `ci.yml` (`gh api`,
logged-in `gh` needed). Otherwise they refuse; `BREAK_GLASS=1` turns the refusal into a loud warning and deploys
(`services/deploy-python-lambda.sh` still refuses uncommitted changes under `services/<svc>`). `DRY_RUN=1` never needs
it, and a dry run makes no AWS call at all. A local deploy is not a CD deployment, so CD's next plan still counts
those changes and redeploys `main`'s version of them (same code, one more version; for a local-only change such as
`AUTOMATION_MODE=off`, `main`'s value: merge it first, §7 emergency stop step 3). Merge the fix to `main` afterwards.
Smoke it with `AWS_PROFILE=devcards-admin scripts/smoke.sh` (`devcards-deploy` cannot invoke the synthetic check).

### Setup (supervisor and owner, once)

Steps 1–5 were done on 2026-10-03/04: #740 applied, `mfa_serial` in the profile, environment `production`, tag
ruleset 24415242, variable `CONSOLE_SENTRY_DSN` (read from the live console bundle). Step 6 follows the first deploy.

1. Terraform (supervisor, local with MFA, separate change): the GitHub OIDC provider and role
   `developercards-gha-prod` (the deployer policy plus `lambda:InvokeFunction` on `developercards-synthetic-check:prod`),
   and MFA on `devcards-deployer`.
2. Owner, in the same change window as step 1's MFA condition (or before it): add
   `mfa_serial = arn:aws:iam::622994489535:mfa/TimeAwakeAdmin` under `[profile devcards-deploy]` in `~/.aws/config`
   (§10), then check with `aws sts get-caller-identity --profile devcards-deploy` (it asks for the code). Without it
   every local deploy, `scripts/rollback.sh` and `infra/scripts/rds-snapshot.sh` gets AccessDenied on AssumeRole.
3. GitHub environment `production`: required reviewer ChuanQiao1128, deployment branches `main` only, "Prevent
   self-review" off.
4. GitHub tag ruleset (defence in depth for the on-main check in the plan job): block creating or updating a tag
   named `main` (or restrict tag creation to the owner).
5. Repository variable (not a secret: the DSN is public in the bundle) `CONSOLE_SENTRY_DSN` = the SSM String
   `/developercards/prod/console-sentry-dsn`:
   `gh variable set CONSOLE_SENTRY_DSN --repo ChuanQiao1128/recallsmith --body "$(aws ssm get-parameter --profile devcards-admin --name /developercards/prod/console-sentry-dsn --query Parameter.Value --output text)"`.
   Change both together: the deploy stops before any change when the bundle lacks the DSN SSM holds.
6. After the first deploy, check its record carries the marker:
   `gh api "repos/ChuanQiao1128/recallsmith/deployments?environment=production" --jq '.[0].id'`, then
   `gh api repos/ChuanQiao1128/recallsmith/deployments/<id>/statuses --jq '.[].environment_url'` must show
   `…/commit/<sha>#cd-full`. Without it every run deploys every target (safe, but noisy).

### Not covered

- **Terraform**: its own workflow, `.github/workflows/terraform.yml`, behind the `infra-prod` approval (§15); the
  break-glass changes listed there stay local, behind the owner's MFA (§2–§5).
- **Mobile**: OTA updates and App Store / Play binaries stay owner-driven.
- **Console accounts**: the owner's `aws cognito-idp` commands (§14); edge-public, which served them, was retired on
  2026-10-04.
- **Database migrations**: the console's Migrate button or `scripts/invoke-as-admin.sh` (owner). CD takes no RDS
  snapshot because it migrates nothing; snapshot before migrating, as before.
- **Staging**: there is none yet. The smoke runs against production right after the deploy (against a baseline taken
  just before it), and the restore point is the safety net.

Tests: `scripts/tests/cd-scripts.test.sh` (CI job `infra`) runs every script here against fake `aws`, `gh` and
`curl`.

## 13. Database restore (enterprise audit DR-01, drilled 2026-10-04)

**Drill (quarterly, and after any RDS/engine change).** The owner enters MFA (`aws sts get-caller-identity --profile
devcards-admin`), then `infra/scripts/dr-restore-drill.sh` (preflight) and `CONFIRM=1 infra/scripts/dr-restore-drill.sh`.
It restores `developercards` to its latest restorable time into `dc-dr-drill-<stamp>` (same subnets and SGs), runs a
throwaway copy of the live core-vpc build against it, compares the applied migrations and the live decks/card totals
with production, writes `docs/ops/dr-restore-drill-<date>.md`, and deletes both throwaways in an EXIT trap. About
30 minutes, about US$0.03. First run: `docs/ops/dr-restore-drill-2026-10-04.md` — PASS, restore 26 min, measured
restore-point lag 8 min.

**Real incident (data loss or corruption).**
1. Stop writes that would make it worse: the §7 kill switch for automation; for a bad deploy, roll the aliases back (§12).
2. Pick the restore point: just before the damage (`--restore-time <UTC>`), or the latest restorable time for an
   instance loss. Restore it beside production, exactly as the drill's step 1 does but with that time, and verify it
   the drill's way (`CONFIRM=1` stops at its trap, so for an incident run the commands from the script by hand and
   skip the cleanup).
3. Cut over without touching any configuration: the endpoint name comes from the instance identifier. Rename
   production out of the way (`modify-db-instance --db-instance-identifier developercards
   --new-db-instance-identifier developercards-damaged-<date> --apply-immediately`), then rename the restored
   instance to `developercards`. core-vpc and worker reconnect on the next connection (their `PGHOST` is unchanged).
   Re-enable deletion protection and the 14-day backup retention on the new `developercards`; Terraform's next plan
   shows any other drift.
4. Keep `developercards-damaged-<date>` until the incident is closed; delete it (final snapshot) only with the owner.
5. Write the postmortem in `docs/ops/`.

## 14. Console admin accounts (after edge-public, 2026-10-04)

The console no longer lists, creates, disables or deletes console accounts. That went through the `edge-public`
Lambda (`ANY /api/v1/admin/cognito/{proxy+}`), which was retired on 2026-10-04 (R27 EDGE; owner decision, enterprise
audit SDLC-05 / ENT-01): 8 invocations in its life, none after 2025-12-25, source never in the repo. Its source and
review are in `archive/edge-public-2025-12-28/README.md`. The console's Users & permissions page (`/admin/users`)
still edits deck permissions (core-vpc, keyed by the account's Cognito `sub`) and runs migrations.

The owner manages accounts with the commands below, under the owner's MFA session (§10). They do what edge-public did,
with its defaults: new accounts go into `editor` only, the email is marked verified, and Cognito sends no invitation.

### Setup (once per shell)

```bash
aws sts get-caller-identity --profile devcards-admin   # type the MFA code; the session lasts 1 hour
POOL=ap-southeast-2_4Vf8uCXKt                          # console pool, var.console_pool_id in infra/envs/prod/variables.tf
```

The profile carries `region = ap-southeast-2` (§10). The pool signs in by email (`username_attributes = ["email"]`), so
every `--username` below is the account's email address.

### List

What the old page showed: the members of `super_admin` and `editor`, with email, sub, enabled and status.

```bash
for g in super_admin editor; do
  echo "== $g"
  aws cognito-idp list-users-in-group --profile devcards-admin --user-pool-id "$POOL" --group-name "$g" \
    --query 'Users[].[Attributes[?Name==`email`]|[0].Value, Attributes[?Name==`sub`]|[0].Value, Enabled, UserStatus]' \
    --output table
done
```

Every account, including one in no group, and the groups of one account:

```bash
aws cognito-idp list-users --profile devcards-admin --user-pool-id "$POOL" \
  --query 'Users[].[Attributes[?Name==`email`]|[0].Value, Attributes[?Name==`sub`]|[0].Value, Enabled, UserStatus]' \
  --output table
aws cognito-idp admin-list-groups-for-user --profile devcards-admin --user-pool-id "$POOL" --username "$EMAIL" \
  --query 'Groups[].GroupName'
```

### Create an editor

```bash
EMAIL=new.editor@example.com
read -rs TEMP   # the temporary password, typed without echo and kept out of shell history
aws cognito-idp admin-create-user --profile devcards-admin --user-pool-id "$POOL" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --temporary-password "$TEMP" --message-action SUPPRESS
aws cognito-idp admin-add-user-to-group --profile devcards-admin --user-pool-id "$POOL" \
  --username "$EMAIL" --group-name editor
aws cognito-idp admin-get-user --profile devcards-admin --user-pool-id "$POOL" --username "$EMAIL" \
  --query 'UserAttributes[?Name==`sub`].Value' --output text   # the sub, for deck permissions
unset TEMP
```

- The temporary password must meet the pool policy (8+ characters with upper case, lower case, a number and a symbol)
  and expires after 7 days. Hand it over out of band. At first sign-in the editor sets a new password and an
  authenticator app (the pool requires TOTP MFA).
- To have Cognito generate the password and email the invitation instead, leave out `--temporary-password` and
  `--message-action SUPPRESS` (the pool sends with the Cognito default sender, 50 emails a day).
- `super_admin` can drop the database from the console. edge-public refused to create one; add a `super_admin` only
  as a deliberate owner decision: `aws cognito-idp admin-add-user-to-group ... --group-name super_admin`.
- Then give decks: console → Users & permissions → Open an account → paste the sub → tick → Save permissions.

### Disable

```bash
aws cognito-idp admin-user-global-sign-out --profile devcards-admin --user-pool-id "$POOL" --username "$EMAIL"
aws cognito-idp admin-disable-user --profile devcards-admin --user-pool-id "$POOL" --username "$EMAIL"
```

The account can no longer sign in or refresh. An ID or access token it already holds still passes the API Gateway
JWT authorizers and core-vpc until it expires (1 hour, the SPA client's token validity): neither checks revocation.
Undo with `aws cognito-idp admin-enable-user` (same arguments).

### Delete

1. Remove its deck permissions first: console → Users & permissions → open its sub → untick every deck → Save
   permissions (an empty replace). The rows are keyed by sub and outlive the account.
2. Disable it (above), then:

```bash
aws cognito-idp admin-delete-user --profile devcards-admin --user-pool-id "$POOL" --username "$EMAIL"
```

Irreversible: an account created again with the same email gets a new sub. (edge-public never implemented delete;
its route answered 501.)

### One-time check after the retirement

List every account (above) and confirm each one is expected. Until E08 (2026-09-26) edge-public's routes had no
authorizer and the function accepted an unsigned token's `cognito:groups` claim, so for that period anyone could
have created an editor. Metrics show no invocation after 2025-12-25; the eight earlier ones cannot be attributed.

### Retirement procedure (order)

1. **Deploy the console first.** Merge the change; CD (§12) deploys `console` (the page without the Cognito calls)
   and `backend` (core-vpc: the retired route labels left RouteMetrics) after the owner's approval. Check the live
   console: Users & permissions shows "Console accounts are managed with the AWS CLI", and the browser's network
   panel shows no request to `/api/v1/admin/cognito/`. Until the routes go, an old console tab still reaches
   edge-public; after, it gets core-vpc's 404.
2. Optional, while the function still exists: record its environment for a rollback (pool id, group lists and a
   flag, no secret): `aws lambda get-function-configuration --profile devcards-admin --function-name edge-public
   --query Environment.Variables`.
3. Plan and gate as in §2/§3 with `docs/delivery/r27-issues/EDGE.plan-allow.json`: expect `PLAN OK 16`, 15 deletes
   (six routes, the integration, three invoke permissions, the function, the role, its inline policy, the logs
   policy and its attachment) and one `forget` (`module.api.aws_cloudwatch_log_group.edge_public`). The forget comes
   from the `removed` block in `infra/modules/api/edge_public.tf` (`lifecycle { destroy = false }`): the log group
   leaves the state and stays in AWS. `check-plan.py` reads `forget` since this change; an older copy stops with
   exit 2 ("unknown action set").
4. `terraform apply`, then the second plan must be empty (§5).
5. Verify:

```bash
aws lambda get-function --profile devcards-admin --function-name edge-public            # ResourceNotFoundException
aws iam get-role --profile devcards-admin --role-name edge-public-role-zezx326f         # NoSuchEntity
aws apigatewayv2 get-routes --profile devcards-admin --api-id ktbq1sie2c \
  --query 'Items[?contains(RouteKey, `cognito`) || contains(RouteKey, `/ai/`) || contains(RouteKey, `billing`)].RouteKey'  # []
aws logs describe-log-groups --profile devcards-admin --log-group-name-prefix /aws/lambda/edge-public \
  --query 'logGroups[].logGroupName'                                                    # still there
```

6. The one-time account check (above).

Nothing to clean up afterwards. The log group keeps its 30-day retention; on 2026-10-04 it held 0 stored bytes (the
events had already expired; stream names remain). Deleting it later is an owner decision, by hand.

### Rollback

- **Before the apply** (console deployed, edge-public still there): revert the change and let CD deploy the console;
  the old page works again.
- **After the apply**:
  1. `git revert` the change. The revert brings back 16 import blocks in `infra/envs/prod/imports.tf`; 15 of their
     objects no longer exist and Terraform refuses to import a missing object, so delete those 15 and keep only
     `module.api.aws_cloudwatch_log_group.edge_public` (the group still exists and is adopted again, not created).
  2. Plan, check, apply: it creates the role and its policies, the function (from `infra/bootstrap/placeholder.zip`),
     the integration, the three invoke permissions and the six routes (the three `ANY` routes keep the console JWT
     authorizer, which is what makes the code's unverified-token fallback unreachable).
  3. Put the archived code back. The rebuilt zip has the same dependency versions (from the lockfile) but not the
     original CodeSha256:

```bash
D="$(mktemp -d)"; ARCH=archive/edge-public-2025-12-28
cp -R "$ARCH/src" "$D/" && cp "$ARCH/package.json.archived" "$D/package.json" && cp "$ARCH/package-lock.json.archived" "$D/package-lock.json"
(cd "$D" && npm ci --omit=dev && zip -qr edge-public.zip src package.json package-lock.json node_modules)
aws lambda update-function-code --profile devcards-admin --function-name edge-public --zip-file "fileb://$D/edge-public.zip"
aws lambda wait function-updated --profile devcards-admin --function-name edge-public
aws lambda update-function-configuration --profile devcards-admin --function-name edge-public --environment \
  '{"Variables":{"COGNITO_USER_POOL_ID":"ap-southeast-2_4Vf8uCXKt","ADMIN_GROUPS":"[\"super_admin\",\"editor\"]","DEFAULT_NEW_ADMIN_GROUPS":"[\"editor\"]","COGNITO_SUPPRESS_INVITE":"true"}}'
```

  The values are the code's defaults; use the ones recorded in step 2 of the procedure if they differ. Terraform
  ignores the function's code and environment (`ignore_changes`), so neither shows in a later plan.
  4. The reverted console reaches edge-public again once CD has deployed it.

## 15. Terraform pipeline (GitHub, infra-prod) (2026-10-04)

Routine Terraform changes reach production through `.github/workflows/terraform.yml`. The one human action is the
owner's approval tap in GitHub; nobody types an MFA code and nothing runs on the laptop. The local MFA path (§2–§5)
stays for the break-glass changes listed below.

### Flow

```
PR (change + its allow-list) -> CI, no AWS -> auto-merge -> push to main -> select, no AWS -> approval tap
  -> apply (infra-prod): plan -> guard -> allow-list gate -> apply the saved plan -> second plan must be empty
```

1. **Pull request.** The Terraform change and its allow-list, `docs/delivery/<round>/<TAG>.plan-allow.json` (one
   per change; a release pull request that brings several changes brings each one's file), in the shape §2 uses:
   `changes` maps each address to an action (`create`, `update`, `delete`, `replace`, `forget`) or to
   `{"action": "update", "keys": [...]}`; `outputs` lists the root outputs that change; `tags_only_updates` admits
   unlisted tag-only updates. A change that should plan nothing still carries one, with
   `"changes": {}`. The worker writes the list from the change itself (what it must do); it does not plan with
   credentials. The pipeline's plan is the check: when the two differ, nothing is applied and the run names the
   addresses that differ. Any allow file a push adds or edits becomes that push's list, so leave the allow files of
   changes already applied alone (a typo fix in an old `_note` would make the next run check the plan against that
   old list).
2. **CI** (`ci.yml`, no AWS, required). Job `infra`: `terraform fmt -check`, offline `init -backend=false` and
   `validate`, and `python3 infra/scripts/tf-pipeline.py pr-check --base origin/main` on every run except a push to
   `main` (a branch push reports a check of the same name for the same commit as its pull request, so it runs the
   rule too): a pull request that changes a plan-affecting file under `infra/` (anything but `*.md`,
   `infra/scripts/`, Terraform tests, `*.tfvars.example`, `infra/.gitignore`) adds or changes at least one allow
   file; every one has the right shape and a plain path (`A-Z a-z 0-9 . _ / -`), and together they do not contradict
   each other (see step 4). An allow file that lists a break-glass address passes with a warning. `pr-check` also
   runs `preflight`, which fails the pull request on code the pipeline will never run: a provider other than
   `hashicorp/aws` in `infra/envs/prod/.terraform.lock.hcl`, a provisioner, an `aws_lambda_invocation` (data,
   ephemeral or resource), an `action` block, a `*.tf.json` file, a module from outside the repository. Merged, any
   of these would stop every later run. Job `python` runs the unit tests of the pipeline's decisions
   (`infra/scripts/tests/test_tf_pipeline.py`). The rule lives in `ci.yml` because only its nine checks gate
   auto-merge; a path-filtered workflow cannot be a required check.
3. **Auto-merge** when the nine checks pass.
4. **select** (`terraform.yml`, no AWS). Starts on a push to `main` that changed a plan-affecting file or an allow
   file (`on.push.paths`; a RUNBOOK edit starts nothing). The commit must be on `main`; a commit older than the last
   one the pipeline applied is refused (`tf-pipeline.py stale`, below); `preflight` runs again. It picks the allow
   files the push added or changed (`git diff -z <before>..<after>`, so a non-ASCII file name is read as it is):
   usually one; several when a release merges several changes (release/r25, #711, brought P02 and F05 in one push),
   and then the plan must match their union (`tf-pipeline.py combine`: two updates of one address allow the union of
   their keys, a create or replace absorbs an update of the same resource, any other overlap is a conflict); none
   means the apply passes only if the plan is empty. An allow file that lists a break-glass address or
   `expect_imports`, a path with a character other than `A-Z a-z 0-9 . _ / -`, or files that conflict, stop the run
   here, before any approval request. Its summary lists the entries: that is what the approval applies.
5. **Approval.** GitHub notifies the owner (the only required reviewer of `infra-prod`). Open the run (Actions →
   Terraform, or the e-mail / GitHub mobile notification), read the **select** summary, then **Review deployments →
   infra-prod → Approve and deploy** (or **Reject**). Rejecting applies nothing: the change stays on `main`, and the
   next run's plan shows it without its allow file and refuses (revert it, or re-run this run later).
6. **apply (infra-prod).** Before any credential: the on-main, stale and preflight checks again, and the
   environment secret `TF_VAR_ALERT_EMAIL` is present. Then it assumes
   `arn:aws:iam::622994489535:role/developercards-gha-infra` through GitHub OIDC (the role trusts only `repo:ChuanQiao1128/recallsmith:environment:infra-prod`; session
   `gha-tf-<run id>-<attempt>`, which is how CloudTrail names it), runs `terraform init` with the real backend,
   `plan -lock-timeout=10m -out=<file>`, `show -json`, then
   - `tf-pipeline.py guard`: refuses any effective change in `module.operators` and any move into or out of it
     (`moved` blocks), a change to a resource type the role is denied (IAM users, keys, groups, MFA devices, identity
     providers, CloudTrail, organizations, account), to the CloudTrail or state bucket, an IAM role whose trust
     policy would name anything but an AWS service, an IAM policy (inline, managed, or a policy document read at
     apply time) that grants an IAM role or policy write (`iam:CreateRole`, `PutRolePolicy`, `AttachRolePolicy`,
     `UpdateAssumeRolePolicy`, `CreatePolicyVersion`, ..., including through `*`, `iam:*` or `iam:Put*`), or
     `sts:AssumeRole` / `iam:PassRole` on every resource, or uses `NotAction`; an attachment of AdministratorAccess,
     IAMFullAccess or PowerUserAccess; configuration that runs code (provisioners, `aws_lambda_invocation`); and any
     import. A policy whose JSON is known only at apply (it names an ARN the same plan creates) cannot be read: the
     guard names it in a `::warning::UNCHECKED` line and lets it through (What it does not stop, below);
   - `check-plan.py --allow <the combined allow-list>` (or without `--allow` when there is none: the plan must be
     empty);
   - `terraform apply <the saved plan>`: exactly what was gated, never a fresh plan;
   - a second plan checked with `check-plan.py` and no allow file: it must print `PLAN EMPTY` (§5).
   When the first plan is already empty (an allow file with `"changes": {}`), nothing is applied and there is no
   second plan. If Terraform could not write the state at the end of an apply, it leaves `errored.tfstate` on the
   runner; the job pushes it (`terraform state push`, which refuses an older serial or another lineage; never
   `-force`), or, when the push is refused, keeps it as `s3://recallsmith-tfstate-622994489535/recovery/errored-<run
   id>-<attempt>.tfstate` (never an artifact: the state holds values). The job summary has the commit, the allow
   files, the address / action / changed-keys table, and the results of the guard, the gate, the apply, the second
   plan and any state recovery.

Public logs: nothing prints a plan, a value or state. Terraform runs with `-no-color` into files under
`$RUNNER_TEMP/tf`, never uploaded and deleted at the end of the job (the plan JSON holds Lambda environments and
state values). The log shows only `check-plan.py` and `tf-pipeline.py` lines: addresses, actions, changed key names,
counts. After a Terraform error, `tf-pipeline.py diagnose` prints one line per error, `ERROR <first words> | <address>
| <AWS operation> | <HTTP status> | <error code>`, never the message (an AWS message can quote values). For the full
text, reproduce the plan locally (§2, `devcards-admin`).

`workflow_dispatch` (Actions → Terraform → Run workflow, from `main`) runs **plan only (infra-prod)**: the same plan,
checked as an empty plan, as a drift report (addresses only). It needs an approval too: the role trusts nothing but
`infra-prod`.

### When a run stops

| What the run says | What happened | What to do |
|---|---|---|
| `select`: `… is listed with conflicting actions in A and B` | two changes in one push say different things about one address | make the files agree in a follow-up PR (an allow-file-only change runs the apply again), or apply locally |
| `select`: `lists module.operators…` / `is break-glass` | a break-glass change was merged | apply it locally with MFA (Break-glass, below) |
| `stale`: `already applied … would put older configuration back` | a re-run of an old run after a newer apply | nothing: the newer state stands; change infra with a new PR |
| `PREFLIGHT …` | the code has a provider other than `hashicorp/aws`, a provisioner, an `aws_lambda_invocation`, an `action` block, a `*.tf.json` file or an outside module (CI refuses these, so it reached `main` without passing CI) | nothing ran. Remove it in a PR; anything that really needs it is break-glass |
| `guard`: `REFUSED <address>: …` | the plan touches something break-glass (also drift there), or grants or runs more than a routine change may | nothing was applied; Break-glass, below |
| `guard`: `::warning::UNCHECKED <address>: its policy is known only at apply` (or `inline_policy`) | the policy names an ARN this plan creates, so the guard cannot read its grants | a warning, not a stop: read that policy in the merged change before approving |
| `PLAN VIOLATION: unlisted …`, `stale allow entry …`, `action mismatch …`, `keys not allowed …` | the plan differs from the allow file | nothing was applied. Fix the allow file (or the code) in a follow-up PR; the push runs the apply again |
| `ERROR … \| <address> \| …` in init/plan | Terraform or AWS refused before any change | reproduce with §2 locally; fix in a PR |
| `ERROR …` in **apply** | the apply stopped part-way; the state holds what was done | a re-run does **not** finish it: its plan now lacks the applied entries, so `check-plan.py` reports them as `stale allow entry` and refuses. Finish it with a follow-up PR whose allow file lists only the remainder (the next plan shows exactly that), or locally with MFA (§3), or undo it (Rollback, below) |
| `errored.tfstate pushed` / `… kept as s3://…/recovery/…` / `could not be pushed or kept` | the apply changed AWS but Terraform could not write the state | pushed: the state is whole; plan locally (§2) before the next change. Kept: locally with MFA, `terraform state push` that file after checking its serial against the remote state (break-glass state surgery). Neither: the state misses part of the apply; reconcile locally (imports are break-glass) |
| second plan `PLAN VIOLATION: unexpected …` | the apply happened, but AWS and code still differ (provider normalisation, §6 drift) | look locally (§2); fix in code with its own allow file |
| `Error acquiring the state lock` | a local break-glass apply, or a killed run, holds the lock (`-lock-timeout=10m`) | wait; a stale lock after a killed run: `terraform force-unlock <id>` locally with `devcards-admin` |

### Stale runs and re-runs

GitHub re-runs a run with its original commit. If a later commit on `main` already changed AWS, re-running an older
run would put its older configuration back, sometimes within its own allow-list. `tf-pipeline.py stale` therefore
refuses a commit when a later push run of `terraform.yml` on `main` changed AWS: its `apply (infra-prod)` job
succeeded (an empty plan confirms main and AWS agree), or its step `apply the saved plan` ran at all, whatever the
run's colour (a red second plan, an apply that failed part-way or was cancelled), in any attempt. It reads the newest
100 runs and their jobs from the Actions API (which a token cannot forge), in **select** and again in **apply**
before any credential. A re-run of the latest run goes ahead past this check; it still applies only when its plan
matches its allow-list, so it helps after a transient error, a lock or an approval that timed out, not after an
apply that stopped part-way (When a run stops, above).

### Queueing

One lane, `infra-prod`, for whole runs: a run waits while another is in flight (including one waiting for approval),
and none is ever cancelled in flight. GitHub keeps at most one run queued behind it, and a newer queued run cancels
the pending one. The cancelled push's change then reaches the next run's plan without its allow file, and that run
refuses (`unlisted …`) without applying anything. To recover: Actions → Terraform → the **cancelled** run → **Re-run
all jobs** (approve; it applies only its own change, because its commit does not contain the later one), then
re-run the refused run. Path filters keep documentation pushes out of the lane, so this takes three Terraform merges
inside one approval window.

### Bootstrap (once)

Order matters: GitHub creates an environment that a job names but that does not exist **without** any protection
rule, so `infra-prod` must exist before `terraform.yml` reaches `main`.

1. Supervisor (done 2026-10-04: `infra-prod` exists with the same rules as `production`): environment `infra-prod`,
   required reviewer ChuanQiao1128, deployment branches `main` only, "Prevent self-review" off, administrators cannot
   bypass. Check: `gh api repos/ChuanQiao1128/recallsmith/environments/infra-prod --jq
   '{can_admins_bypass, protection_rules}'`.
2. Supervisor: environment secret `TF_VAR_ALERT_EMAIL` on `infra-prod` = the root variable `alert_email` (the alerts
   topic's e-mail, the value in the gitignored `prod.auto.tfvars`):
   `gh secret set TF_VAR_ALERT_EMAIL --repo ChuanQiao1128/recallsmith --env infra-prod` (it prompts for the value).
3. Merge the change that adds the pipeline. Its push starts `terraform.yml`, whose **select** job stops on
   `docs/delivery/r27-issues/TFCI.plan-allow.json` (it lists `module.operators`): a red run, no approval request,
   nothing applied. Expected.
4. Supervisor, local with MFA (§2/§3, `devcards-admin`): plan, `python3 infra/scripts/check-plan.py --plan
   <tfci>.plan.json --allow docs/delivery/r27-issues/TFCI.plan-allow.json` → `PLAN OK 3` (creates of
   `module.operators.aws_iam_role.gha_infra`, `…aws_iam_role_policy_attachment.gha_infra`,
   `…aws_iam_role_policy.gha_infra_deny`; output `operator_role_arns` gains `gha_infra`; nothing else), apply,
   second plan `PLAN EMPTY`.
5. Prove it end to end: Actions → Terraform → Run workflow (`main`) → approve → **plan only (infra-prod)** must say
   `PLAN EMPTY`. That exercises OIDC, the secret, the backend and the read path: the plan refreshes
   `module.operators` too, including `aws_iam_openid_connect_provider.github`, which is why the role's deny names
   write actions only (a review on 2026-10-04 found that the first draft's `iam:*OpenIDConnectProvider*` also denied
   `GetOpenIDConnectProvider` and would have failed every plan). An `AccessDenied` on a `Get`/`List` call here means
   the deny blocks a read: fix it in `module.operators` (break-glass) before anything else. The first real change
   then goes through the Flow above.

### Break-glass (local, owner's MFA, §2–§5)

- **`module.operators`**: the five operator and CI roles, the GitHub OIDC provider, `devcards-operator-base`. The
  pipeline role's explicit deny forbids changing them, and the guard refuses the plan first so an apply never stops
  half-way. A pipeline that could edit its own role could drop its own limits.
- **The audit trail and the state bucket**: `aws_cloudtrail`, the CloudTrail bucket's settings and objects, the state
  bucket's versioning, lifecycle and policy.
- **Credentials and identities**: IAM users, access keys, login profiles, groups, MFA devices, OIDC and SAML
  providers, Identity Center; and any IAM role whose trust policy names a principal other than an AWS service.
- **Organizations, account and billing settings.**
- **Grants that mint admin**: an IAM policy granting IAM role or policy writes, or `sts:AssumeRole` / `iam:PassRole`
  on every resource; AdministratorAccess, IAMFullAccess or PowerUserAccess attachments. The pipeline role itself
  cannot assume any role (`sts:AssumeRole` is denied).
- **Code that runs during Terraform**: provisioners, `aws_lambda_invocation`, `action` blocks, providers other than
  `hashicorp/aws`, modules from outside the repository (CI refuses these; the pipeline never runs them).
- **Imports** of hand-made resources (`import {}` blocks, `expect_imports`) and **state surgery** (`state mv`,
  `state rm`, `force-unlock`): adopting a resource needs its live configuration read first.
- **Long or risky applies**: anything that may run past the job's 60 minutes or the role's one-hour session (an RDS
  engine upgrade, a large replacement), and finishing an apply the pipeline left half-done.

The break-glass apply is §2/§3/§5 with `devcards-admin`; clear `~/.aws/cli/cache` afterwards (§10).

### Rollback

Terraform has no automatic rollback. A bad apply is undone forward: revert the change on `main` (`git revert` of the
merge) in a pull request with its own allow-list, the inverse of the original (its creates become `delete`, its
updates `update` with the same keys, its deletes `create`), and let the pipeline apply it after the approval. A
revert that touches break-glass resources, or an outage that cannot wait for CI, is applied locally with MFA (§3).
A deleted resource that held data (a bucket, a database) is not brought back by a revert: §13 for the database,
S3 versioning for objects. The state itself is versioned (`recallsmith-tfstate-622994489535`, noncurrent versions
kept 90 days); the pipeline role can neither change that nor delete a version (`s3:DeleteObjectVersion` is denied
on the bucket's objects). Restoring an older state version is break-glass, with the owner.

### What it does not stop

- **Code with a role the pipeline creates.** The role is AdministratorAccess minus the deny. An approved change can
  create a service role, give it a policy and deploy code that runs with it (a Lambda function, a Step Functions
  state machine, a scheduled task); that code keeps running after the job. The guard refuses the direct routes
  (escalating grants, admin attachments, provisioners, `aws_lambda_invocation`), but not a broad grant short of
  those (`s3:*` on `*`, `secretsmanager:GetSecretValue`, `ssm:GetParameter*`), nor a policy whose JSON is known only
  at apply (the `UNCHECKED` warning). The AWS-side fix is a permissions boundary that every role Terraform creates
  must carry (a deny of `iam:CreateRole` / `PutRolePolicy` / `AttachRolePolicy` without it); it touches every role
  module, so it is a separate change.
- **Resource policies.** An approved change can widen access through a resource policy (an S3 bucket policy, a
  Lambda permission, an SQS, SNS or KMS policy naming another principal). Trust policies of IAM roles are checked by
  the guard; resource policies are not.
- **The plan runs before anyone sees it.** The owner approves the allow-list, not the plan: the plan exists only after
  the approval (it needs the role), and it may not be printed in public logs. The gate holds the apply to that list
  exactly. Data sources read AWS at plan time; `preflight` keeps out the ones that run code (`aws_lambda_invocation`,
  other providers).
- **The tap approves gate code nobody reviewed.** `main` takes pull requests with no human review (ruleset: 0
  approvals, no CODEOWNERS), and `terraform.yml`, `tf-pipeline.py`, `check-plan.py` and the lock file run from the
  pushed commit: a merged change to them decides its own run. A change to `infra/scripts/` or to `terraform.yml`
  alone starts no run, so it takes effect at the next Terraform change. The role's trust checks the environment, not
  the workflow file: any workflow on `main` that names `environment: infra-prod` gets the role once the owner taps
  approve. So before approving, check that the run is **Terraform** (`.github/workflows/terraform.yml`) and, when the
  push touched the gate files, read their diff. Two hardenings, both break-glass and left to the owner:
  1. Pin both GitHub roles to their workflow file: set the repository's OIDC subject template to include
     `job_workflow_ref` (`gh api -X PUT repos/ChuanQiao1128/recallsmith/actions/oidc/customization/sub -f
     'include_claim_keys[]=repo' -f 'include_claim_keys[]=context' -f 'include_claim_keys[]=job_workflow_ref'`) and,
     in the same window, change the `sub` conditions of `developercards-gha-infra` and `developercards-gha-prod` to
     `repo:ChuanQiao1128/recallsmith:environment:<env>:job_workflow_ref:ChuanQiao1128/recallsmith/.github/workflows/<terraform|cd>.yml@refs/heads/main`
     (a `module.operators` change, local with MFA). The template changes every token of the repository at once, so
     CD and this pipeline fail between the two steps.
  2. Require code-owner review for `.github/workflows/**`, `infra/scripts/check-plan.py`,
     `infra/scripts/tf-pipeline.py` and `infra/envs/prod/.terraform.lock.hcl`. Not done: GitHub does not let the
     author approve their own pull request, and the delivery pull requests are opened under the owner's account, so
     every such change would wait for a second person who does not exist.

Tests: `infra/scripts/tests/test_tf_pipeline.py` (CI job `python`) covers the pull request rule, preflight, the
allow-file selection and paths (non-ASCII and glob names included), the stale check, the guard, the diagnosis, the
workflow's step bodies run under `bash -e` with stubbed `python3`, `terraform` and `aws`, and the static facts of
`terraform.yml`, `ci.yml` and the role (its deny blocks no refresh read); `ci.yml` job `infra` runs `pr-check` on
every run except a push to `main`.

## 16. Hardening limits: database timeouts, route throttles, security headers (R29 HARDEN, 2026-10-04)

Owner policy 2026-10-04: no new features, hardening only; nothing changes what a user sees except refusing abuse.
Three limits from the enterprise audit (2026-10-03): SPC-01 (no `statement_timeout`), SPC-02 (routes share the stage
default throttle) and the console's missing security headers (SEC-05, user-perspective review G11). Traffic and latency
below are from read-only CloudWatch (`devcards-ro`) for the 30 days to 2026-10-04 08:00 UTC.

### Database timeouts (SPC-01)

Every application connection starts with Postgres' `statement_timeout` and `idle_in_transaction_session_timeout`, sent
as startup options in the connection string (`Options=-c statement_timeout=… -c idle_in_transaction_session_timeout=…`)
by both pools, `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs` and `src_C/Vpc/Db/Pg.cs` (the migration runner's). The values
live in one file, `src_C/Shared/RecallSmith.Lambda.Db/PgSessionTimeouts.cs`; each Lambda constructor names its profile
before the first connection.

| Who | statement_timeout | idle_in_transaction | Why this value |
|---|---|---|---|
| core-vpc (`PgSessionTimeouts.Api`, `VpcFunction`) | 20 s | 60 s | Every core-vpc call comes through API Gateway, which answers 503 after 30 s (`timeout_milliseconds = 30000`); a statement past that works for nobody. The slowest invocation in the 30 days took 7.4 s (p99.9 4.2 s, 31 209 invocations), the slowest route 9.1 s (`POST /api/internal/automation/tick`, whose own budget is 20 s; user routes ≤ 3.3 s, SLO sync latency 2 s). 20 s is that whole budget and twice the slowest route. Idle 60 s is twice the gateway timeout: it only ends a transaction whose caller already has its 503, and a dead function's locks go after a minute |
| worker-lambda (`PgSessionTimeouts.Worker`, `WorkerFunction`) | 600 s | 600 s | The function may run 615 s (slowest job 4.6 s). Nothing a live job does is cut off; only what a dead worker left behind is ended |
| Migration runner (`Vpc/Db/Migrate.cs`) | none | none | Each migration's transaction (and the `card_embeddings` vector block) starts with `set local statement_timeout = 0; set local idle_in_transaction_session_timeout = 0` (`Migrate.LiftTimeoutsSql`), for that transaction only. The advisory-lock wait before it keeps the 20 s: a second **Migrate** press while one runs now fails after 20 s (57014) instead of queueing behind it; press again when the first is done |
| `set local` inside code | lower | — | The usage rollup (3 s) and the anonymous-funnel retention (2 s) already set their own; a `set local` always wins for its transaction |

- Why startup options and not `ALTER ROLE … SET`: no migration, the RDS role and parameter group stay as they are, the
  worker and core-vpc share the role but not the values, and Npgsql's reset of a pooled connection (`RESET ALL`) returns
  to the startup value, so a `set statement_timeout` by one request cannot leak into the next (tested). A session
  someone else opens (psql as the master, the DR drill of §13) keeps the server defaults of the instance's parameter
  group `default.postgres17` (read 2026-10-04): no `statement_timeout`, `idle_in_transaction_session_timeout`
  86 400 000 ms (24 h).
- Npgsql's client-side Command Timeout (30 s default, never overridden here) is unchanged. It fires only while the
  function is alive; the server-side limits also hold for a function that timed out, crashed or was frozen. Migration
  statements are still bounded by those 30 s, as before.
- What a user sees: nothing at today's latencies. A statement over 20 s now ends with `57014 canceling statement due to
  statement timeout` (core-vpc answers 500) instead of running on behind API Gateway's 503.
- Find one: Logs Insights on `/aws/lambda/core-vpc`, `filter @message like /57014|statement timeout|25P03/`; on the
  database (master, read-only), `select pid, usename, state, now() - xact_start as xact_age, left(query, 60) from
  pg_stat_activity where usename = 'developercards_app' order by xact_start nulls last`.
- Change a value: edit `PgSessionTimeouts.cs` and the pinned values in
  `src_C/Tests/RecallSmith.Lambda.IntegrationTests/DbSessionTimeoutsTests.cs` (`ShippedProfiles_AreTheMeasuredValues`),
  pull request, CD deploys core-vpc and worker-lambda (§12). One slow statement that needs more is better served by a
  `set local statement_timeout = <ms>` in its own transaction than by raising the profile.
- Tests (Testcontainers, CI job `backend`): `DbSessionTimeoutsTests` — both pools start with 20 s / 1 min; a slow
  query and a real handler (`GET /api/v1/entitlements`) blocked behind a lock are cancelled by the server (57014); an
  idle transaction's session is ended by the server (`pg_stat_activity`); a session-level `SET` does not survive the
  pool; `new WorkerFunction()` selects 10 min / 10 min and keeps a statement the app path cancels; a migration that
  sleeps past the app limit is applied and the limit is back afterwards.
- Rollback: revert the change; CD redeploys (§12).

### Route throttles (SPC-02)

`infra/modules/api/gateway.tf` `local.route_throttles` puts each listed route in its own token bucket on both stages
(`route_settings`); every other route uses the stage default (`modules/api/variables.tf`: `$default` 200 rps / burst
400, `dev` 50 / 100, unchanged). A bucket is shared by every caller of that route: the HTTP API has no per-client limit.
R29 adds an entry for every unauthenticated route that had none and for the expensive routes; each limit is at least
100 times the busiest minute the route had:

| Route | Who calls it | 30 days | Busiest minute | burst / rate |
|---|---|---|---|---|
| `GET /health` | synthetic check, CD smoke (no token) | 565 | 5 | 20 / 10 |
| `OPTIONS /{proxy+}`, `OPTIONS /api/v1/authoring/{proxy+}`, `OPTIONS /api/v1/admin/{proxy+}` | browser preflights (no token; core-vpc answers them) | 1 / 19 / 13 | 1 / 5 / 9 | 40 / 20 each |
| `ANY /api/v1/authoring/{proxy+}` | console: card import, publish, QA runs | 42 | 11 | 40 / 20 |
| `ANY /api/v1/admin/{proxy+}` | console: usage analytics (whole-history scans, SPC-04), embeddings, manifest rebuild, migrate | 17 | 9 | 40 / 20 |
| `ANY /api/v1/user/{proxy+}` | app (any self-registered account): bootstrap, client errors, card reports, account deletion | 20 | 3 | 40 / 20 |
| `POST /api/v1/authoring/cards/similar`, `POST /api/v1/authoring/drafts` | the local agent (MCP server) | 9 / 2 | 5 / 1 | 20 / 10 each |

The 17 existing entries (sync and draw-state 40 / 20, the callbacks, the runner, the two public routes) are unchanged.
The route guard (terraform validate) now also fails when an `auth = "none"` route has no entry or an entry has a burst
or rate below 1 (0 refuses everything: the 2026-09-23 incident); mutation test
`docs/delivery/r29-issues/HARDEN-route-guard-test.sh`.

- A refusal is a `429` whose access-log line has `integrationLatency` `-`; alarm `api-429` (§7) pages at 3 in 15
  minutes. Live values: `aws apigatewayv2 get-stage --api-id ktbq1sie2c --stage-name '$default' --query
  '{d:DefaultRouteSettings,r:RouteSettings}'`.
- Change a limit: edit the entry (never 0), add an allow file listing `module.api.aws_apigatewayv2_stage.default` and
  `…stage.dev` as `update` with keys `route_settings`, and let the pipeline apply it (§15). The console's import
  runner retries a 429 batch after 1, 2 and 4 s.
- What it does not stop: one self-registered mobile account can still spend a whole route's bucket (20 rps of sync)
  for everyone; a per-user limit (SPC-02's second half) needs code in core-vpc or a REST API with usage plans, and is
  deferred.

### Security headers (SEC-05)

`infra/modules/edge/security_headers.json` holds every value; `security_headers.tf` builds two CloudFront response
headers policies from it, `developercards-prod-console-security-headers` (on `console.developercards.app`,
E85FKUMZZWQWX, `cdn.tf`) and `developercards-prod-site-security-headers` (on `developercards.app` and
`www.developercards.app`, EML9BSZ8EXMQ1, `site.tf`). They replace the AWS managed SecurityHeadersPolicy (X-Frame-Options
SAMEORIGIN, no CSP). Every header overrides what S3 sends; CloudFront adds them to the SPA fallback (403/404 →
`/index.html`) too.

| Header | Value |
|---|---|
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` (every developercards.app host is HTTPS; `.app` is HSTS-preloaded anyway) |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` (and CSP `frame-ancestors 'none'`) |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| Content-Security-Policy | enforced (not report-only); below |

The console's CSP, built from what the built console loads (its bundle and the live one were read on 2026-10-04):

| Directive | Sources | Because |
|---|---|---|
| `default-src`, `script-src`, `style-src`, `font-src` | `'self'` | `index.html` has one external module script; chunks, CSS and preloads are files under `/assets/`; the font stack is the system's. No `'unsafe-inline'`: there is no inline script or style, React sets `style` props through the CSSOM (which CSP does not govern), highlight.js markup carries classes only. No `'unsafe-eval'`: nothing in the bundle evaluates strings |
| `img-src` | `'self' data:` | the favicon is an SVG data URI in `index.html` |
| `connect-src` | `'self' https://api.developercards.app https://ap-southeast-24vf8ucxkt.auth.ap-southeast-2.amazoncognito.com https://o4511427425599488.ingest.us.sentry.io` | the API (`VITE_API_BASE`), the console pool's hosted UI domain for `/oauth2/token` (the sign-in and sign-out redirects are navigations, which CSP does not restrict), the console DSN's Sentry ingest origin. The console reads no CDN: its manifest URL is same-origin (`/manifest/index.json`) |
| `object-src`, `frame-src`, `frame-ancestors` | `'none'` | no plugins, no frames, never framed |
| `base-uri` / `form-action` | `'none'` / `'self'` | no `<base>`; the console's forms are handled in script, and a native submit could only go to the console itself |

The site's: `default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors
'none'` (one HTML page and `styles.css`; no script, no inline style, nothing from another origin).

Proof, 2026-10-04 (no AWS call): `frontend/scripts/serve-with-headers.mjs` serves a build with exactly these headers.
(1) The Playwright smoke (CI job `e2e`) now runs against it, and `tests/e2e/cspGuard.ts` fails a test on any CSP
violation the browser reports: 16 of 16 passed; with `style-src 'none'` and `connect-src` without `'self'` the same
test failed naming both violations. (2) The production-mode bundle (real API, Cognito and Sentry hosts; a dummy DSN key)
and the bundle live on the console that day, each served the same way with every outside request answered by
`page.route` (nothing left the machine): sign-in redirect, callback token exchange to the Cognito domain, signed-in
deck list from the API, an uncaught error reported to the Sentry ingest origin, all with no violation; a `fetch` to
`https://example.com` was blocked (`connect-src`). (3) `site/` served with the site headers: the page and its
stylesheet loaded with no violation; an injected `<style>` and an external image were blocked.
`infra/scripts/tests/test_r29_harden.py` (CI job `python`) keeps the policy strict and tied to
`frontend/.env.production`, and the landing page loadable under its policy.

- After the apply: `curl -sI https://console.developercards.app/ | grep -i -e content-security -e x-frame` and the same
  for `https://developercards.app/`; open the console, sign in, open a deck and a card, and check the browser console
  for `Content Security Policy` errors.
- Change a header: edit `security_headers.json` (and `test_r29_harden.py` when the rule changes), run
  `npx playwright test` in `frontend/` (it serves the edited headers), and add an allow file listing
  `module.edge.aws_cloudfront_response_headers_policy.security["console"]` (or `["site"]`) as `update` with keys
  `security_headers_config` (CSP, HSTS, frame, referrer) or `custom_headers_config` (Permissions-Policy); the pipeline
  applies it (§15). A new API or sign-in host (a Cognito custom domain), a console DSN from another Sentry
  organisation, or a font or script from a CDN (better bundled) each needs a `connect-src` / `script-src` change
  first, or the browser refuses it.
- Rollback: revert the change in a pull request; its allow file lists the two policies as `delete` and both
  distributions as `update` with keys `default_cache_behavior`.
- Not covered: no CSP reporting endpoint, so a violation in production shows only in that browser's console (Sentry's
  security endpoint would put the DSN key in a public header); the other half of SEC-05 (refresh token lifetime and
  revocation on sign-out) changes what users see and is left to a later round.
