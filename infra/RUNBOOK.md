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

**Enable / disable a schedule.** `update-schedule` replaces the whole definition, so read it first and
send it back unchanged except for the state:

1. `aws scheduler get-schedule --name <n>` (note `ScheduleExpression`, `ScheduleExpressionTimezone`,
   `FlexibleTimeWindow` and `Target`).
2. `aws scheduler update-schedule --name <n> --schedule-expression '<same>' [--schedule-expression-timezone Pacific/Auckland] --flexible-time-window Mode=OFF --target '<same Target JSON>' --state ENABLED`
   (or `--state DISABLED`).
3. `aws scheduler get-schedule --name <n> --query State` shows the new state.

**After enabling the tick**, enable the tick-missing alarm's actions (they start disabled because the
schedules start disabled; Terraform ignores `actions_enabled`):
`aws cloudwatch enable-alarm-actions --alarm-names developercards-prod-automation-tick-missing`.
When the tick is disabled on purpose, run `aws cloudwatch disable-alarm-actions --alarm-names developercards-prod-automation-tick-missing`
first, or it fires two hours later.

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
- `notifier-errors` — the notifier function raised (tick, digest or an SQS record). Check
  `/aws/lambda/developercards-notifier` for the traceback, then `notifier-secret` and core-vpc health.
- `source-watcher-errors` — a source-watch run raised. Check `/aws/lambda/developercards-source-watcher`,
  `source-watch-secret` and the targets route (`POST /api/internal/source-watch/targets`).
- `automation-tick-missing` — the notifier had no invocation for two hours (actions enabled only once the
  schedules are). Check `developercards-automation-tick` is ENABLED, the scheduler role's
  `developercards-automation-scheduler-invoke` policy, and the notifier's throttles (reserved concurrency 2).
- `notification-failures` — the notifier could not deliver an email (`Service = notifier`). Check SES
  sending status and the configuration set, and the notifier log for the failure code.
- `automation-notify-enqueue-failures` — core-vpc failed `SendMessage` to developercards-notify. Check the
  queue exists, `AUTOMATION_NOTIFY_QUEUE_URL` in core-vpc's environment and the grant
  developercards-core-vpc-notify-send.

**Emergency stop** (runaway automation, a mail incident, a source-watch loop) — each step on its own
takes effect at once; do all that apply:

1. Disable the three schedules with the recipe above: `developercards-source-watch`,
   `developercards-automation-tick`, `developercards-automation-digest` (and disable the tick-missing
   alarm's actions).
2. Stop the email consumer: `aws lambda list-event-source-mappings --function-name developercards-notifier:prod --query 'EventSourceMappings[].UUID'`,
   then `aws lambda update-event-source-mapping --uuid <uuid> --no-enabled`. Queued emails stay in
   developercards-notify (4 days) and resume on `--enabled`; the mapping ignores `enabled` in Terraform.
3. Stop the automation in core-vpc: set `AUTOMATION_MODE=off` in `src_C/env/prod.env.json` and deploy
   core-vpc (`ENV=prod ./src_C/deploy.sh`).

Undo in reverse order; re-enable the schedules only after core-vpc runs with the intended mode.

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

**Changing `alert_email`.** One apply changes, together, the `notify-recipient` SSM value, the SES
recipient identity (the old one is destroyed, a new one created, and SES sends a new verification
link to the new address) and the recipient ARN in `developercards-notifier-ses-send`. Emails fail
with `MessageRejected` until the owner clicks the new link. The plan shows every changed value as
`(sensitive value)`; never print the plan JSON.
