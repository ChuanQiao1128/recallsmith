# developercards-notifier

Python 3.12 (arm64) Lambda `developercards-notifier`, handler `notifier.handler.lambda_handler`.
It is the notify half of the automation flow (contract A00 §4, §12) and has two jobs:

1. **Mail transport.** It consumes the SQS queue `developercards-notify` (one message per email,
   rendered by core-vpc), reads the owner alert address from SSM, sends the plain-text email
   through Amazon SES v2 and reports the outcome to core.
2. **Clock.** EventBridge Scheduler invokes it with `{"job": "tick"}` every 15 minutes and
   `{"job": "digest"}` on Monday 08:00 Pacific/Auckland; it forwards each to core's tick route,
   where core does all the work.

What it does **not** do:

- **No rendering, no decisions.** Core renders every subject and body (A00 §12.2, §12.5), including
  the "(dry run)" marking, and decides what is sent when. The notifier never rewords, splits or
  summarises an email and never decides anything about drafts, runs or publishes.
- **No model.** It never calls a model, in any form.
- **One recipient.** It sends only to the address in SSM `/developercards/prod/notify-recipient`.

The runtime has no third-party dependency (`dependencies = []`): stdlib only, `boto3` comes from
the Lambda runtime and is imported lazily (SSM and SES clients).

## Sender and format (A00 §12.2)

- `From: DeveloperCards Automation <automation@developercards.app>` (`NOTIFY_FROM`); no Reply-To.
- `To:` the owner alert address only.
- Plain text only (no HTML part), UTF-8 subject and body; `SendEmail` with `Content.Simple`, never
  `SendRawEmail`.
- `ConfigurationSetName = "developercards-automation"` (`SES_CONFIGURATION_SET`) and
  `EmailTags = [{"Name":"kind","Value":<kind>},{"Name":"mode","Value":<mode>}]`.
- Subject prefix `[DeveloperCards] `; in `dry_run` core renders `[DeveloperCards] (dry run) …` and
  a dry-run first line in the body.

**Dry-run guard (belt and braces).** If a `dry_run` message arrives whose subject lacks
`(dry run)`, the notifier inserts `(dry run) ` right after a leading `[DeveloperCards] ` (or
prepends `[DeveloperCards] (dry run) ` when the prefix is missing) and logs `dry_run_marker_added`.
The body is never changed.

## SQS message (A00 §12.5)

```json
{ "v": 1, "notificationId": "uuid", "kind": "batch_summary", "subkind": null,
  "subject": "[DeveloperCards] (dry run) Batch …", "text": "DRY RUN — …", "mode": "dry_run" }
```

`v == 1`; `notificationId` a UUID; `kind` ∈ `exception`, `batch_summary`, `weekly_digest`,
`source_changed`, `test`; `subkind` a string of at most 60 characters or `null`; `subject` 1..200
characters; `text` at most 100 000 characters; `mode` ∈ `off`, `dry_run`, `live`. Any other shape
is logged (`bad_message`, no content) and acknowledged; when the `notificationId` is still a valid
UUID, core is told `failed` / `BAD_MESSAGE`.

## One SQS record

The event source mapping uses batch size 1 and `ReportBatchItemFailures`; the handler answers
`{"batchItemFailures": [{"itemIdentifier": <messageId>}, …]}`.

1. Parse the message (above). `attempt = ApproximateReceiveCount` (default 1).
2. The internal secret (`INTERNAL_SECRET_SSM_NAME`) missing or unset ⇒ **nothing is sent**, log
   `internal_secret_missing`, the record is a batch item failure. Sending without being able to
   report would make core resend and duplicate the email; the message reaches the DLQ after five
   receives and the DLQ alarm fires.
3. Already sent by this container ⇒ no SES call; report `sent` again with the remembered SES
   message id; ack (see "Duplicate avoidance").
4. Dry-run guard (above).
5. Recipient missing, placeholder or not one address ⇒ report `failed` / `RECIPIENT_UNSET`, emit
   `NotificationFailures`, ack.
6. `SendEmail` (below). `sent` ⇒ report `sent` with `sesMessageId`, emit `NotificationsSent`.
   `failed` ⇒ report `failed` with its code, emit `NotificationFailures`, ack. `retry` ⇒ batch item
   failure while `attempt < MAX_RECEIVES` (5, the queue's `maxReceiveCount`); on the fifth receive
   report `failed` with the last code, emit `NotificationFailures`, ack.
7. Any unexpected exception ⇒ log the exception class, batch item failure.

### SES outcomes

| SES result | Status | Meaning |
|---|---|---|
| success | `sent` | `MessageId` is reported as `sesMessageId` |
| `TooManyRequestsException` | `retry` | after two more attempts 1.1 s apart (the sandbox allows 1 send/s) |
| `LimitExceededException`, `SendingPausedException`, `AccountSuspendedException`, `MessageRejected`, `MailFromDomainNotVerifiedException`, `NotFoundException`, `BadRequestException` (`PERMANENT_CODES`) | `failed` | sending again will not help |
| any other error with HTTP status ≥ 500 | `retry` | redelivered by SQS |
| any other 4xx error (for example `AccessDeniedException`) | `failed` | a configuration problem |
| `EndpointConnectionError`, `ConnectTimeoutError`, `ReadTimeoutError`, `ConnectionClosedError` | `retry` | code = the class name |

The reported `error` is a fixed text per code (at most 300 characters), **never** the SES message:
SES messages can quote the recipient address. `errorCode` is at most 60 characters.

**SES sandbox note.** The account is in the SES sandbox (≤ 200 messages per 24 h, 1 per second,
verified recipients only). A11 creates the domain identity `developercards.app` (Easy DKIM), the
verified recipient identity, the configuration set and the `ses:SendEmail` grant. Until then the
failures are expected and mean:

- DKIM not verified yet ⇒ `MessageRejected` or `MailFromDomainNotVerifiedException`;
- the owner has not clicked the SES verification link yet ⇒ `MessageRejected`;
- no send grant yet (before A11's apply) ⇒ `AccessDeniedException`;
- configuration set missing ⇒ `NotFoundException`.

Each lands as `failed` in core's email log and fires the `NotificationFailures` alarm.

### Report (A00 §12.3)

`POST /api/internal/automation/notifications/report`

```json
{ "v": 1, "notificationId": "uuid", "status": "sent|failed", "sesMessageId": "…|null",
  "errorCode": "…|null", "error": "…|null", "attempt": 1 }
```

Budget: the remaining Lambda time minus 2 s; three attempts (R18B contract K6): after a connection
error, 5xx or 429 it retries after a pause drawn uniformly from 0.5-1.5 s, then from 2-4 s
(`REPORT_RETRY_PAUSES`, jittered so containers that failed together do not retry together). **A
failed report never changes the send decision** (the email is not resent): when every attempt
failed it emits `NotifierReportFailures` and logs `report_failed`. Core's `sent` is sticky, so a later report of the
same notification is harmless.

### Duplicate avoidance

Each container keeps an in-memory LRU of at most 1000 `notificationId → sesMessageId` for the
emails it sent. A redelivery of a sent notification (a lost delete, a report that failed) is not
sent again; `sent` is reported again with the remembered id. The cache lives only as long as the
container. Under R18B contract K6 core no longer re-sends a notification whose SQS send succeeded
(SQS redelivery and the notify DLQ own retries); a row still `queued` 60 minutes after a successful
send with no report is counted as "unconfirmed" in the status API's email health. So the only
duplicate left is an SQS redelivery (a lost delete) that lands on another container, and the
retried report above makes an unreported `sent` rare. During a mail incident, disable
`developercards-automation-tick` together with the notify event source mapping, so the tick does not
enqueue further rows while the mapping is off.

### Retries, `MAX_RECEIVES` and the DLQ

The notify queue has visibility 180 s and `maxReceiveCount = 5` (A10). A `retry` outcome returns the
record as a batch item failure, so SQS redelivers it after the visibility timeout; on the fifth
receive the notifier reports `failed` and acknowledges instead, so a message only reaches the DLQ
`developercards-notify-dlq` when it could not be handled at all (for example the internal secret is
missing).

## Scheduler path (A00 §12.6)

`{"job": "tick"}` or `{"job": "digest"}` ⇒ `POST /api/internal/automation/tick`
`{"v": 1, "tickId": <uuid4>, "job": "tick"|"digest"}`, one attempt with a 28 s timeout (the gateway
allows 30 s; the next tick covers a failure). Core answers
`{"tickId", "mode", "effectiveMode", "skipped", "actions": {…}, "failedSteps": [string]}`; the
notifier logs `tick_ok` with `tickId`, `mode`, `effectiveMode`, `skipped`, the integer `actions` and
the string `failedSteps` (`[]` when absent), and returns `{"tickId", "skipped", "actions",
"failedSteps"}`. A non-empty `failedSteps` (R18B contract K4: automation steps core swallowed while
still answering 200) is also logged as `tick_steps_failed` at warn level; core's own
`AutomationStepFailures` gauge carries the alarm. Every `{"job": "tick"}` invocation first emits
`AutomationTicks` (R18B contract K5), whatever core answers; the digest job does not. A failed call (or a missing internal secret) emits
`AutomationTickFailures`, logs `tick_failed` and **raises**, so `AWS/Lambda Errors` counts it.
Any other event is logged as `ignored_event` and answered `{"ignored": true}`.

Schedules (A10), both created **DISABLED** and enabled by the supervisor after the deploy:

- `developercards-automation-tick`: `rate(15 minutes)`, input `{"job":"tick"}`;
- `developercards-automation-digest`: `cron(0 8 ? * MON *)` in `Pacific/Auckland`, input
  `{"job":"digest"}`.

## Internal routes and HMAC

Both routes are served by core-vpc and verified with `Auth.VerifyInternalSignatureStrict` against
`INTERNAL_SECRET_NOTIFIER` (+`_PREVIOUS`; never the shared secret). Every request is signed over the
canonical body (`json.dumps(…, separators=(",", ":"), ensure_ascii=True, sort_keys=True)`): header
`x-internal-timestamp` (epoch milliseconds) and
`x-internal-signature: v1=<lowercase hex HMAC-SHA256(secret, "<ts>.<body>")>`. Test vector:
`test-secret`, `1790000000000`, `{"a":1}` ⇒
`v1=4ff7aae81c904927786fb5dc89854a13823626f7f1fd6692d046db073616bb85`. Answers are the standard
envelope `{"success", "data", "error", "traceId", "version"}`.

## Secrets and personal data

| SSM parameter | Use |
|---|---|
| `/developercards/prod/notifier-secret` | internal HMAC secret (placeholder created by A10, set by the supervisor) |
| `/developercards/prod/notifier-secret-previous` | exists only during a rotation; read only when core answers 401/403, then the same request is sent once more signed with it; only `ParameterNotFound` counts as absent |
| `/developercards/prod/notify-recipient` | the owner alert address (SecureString written by Terraform from `var.alert_email`, A11) |

The value `PLACEHOLDER-set-by-supervisor` and a blank value count as unset and are never cached. A
loaded value is cached for 300 s (`SECRET_TTL_SECONDS`), so a rotation reaches every warm container
within five minutes. Read errors are logged with the error class only.

**Personal data (A00 §0.5).** The owner's address lives only in SSM. It is never written in a file,
fixture, test, log line, report or this README; the tests use `owner@example.com`. Logs carry
`notificationId`, `kind`, `subkind`, `mode`, `status`, `sesMessageId`, `errorCode` and `attempt` —
never the subject, the body, the recipient or an SES error message.

## Metrics (EMF, namespace `METRICS_NAMESPACE`, `Service = "notifier"`)

| Metric | Unit | Dimension sets | Alarm (A10) |
|---|---|---|---|
| `NotificationsSent` | Count | `[Service, Kind]` | — |
| `NotificationFailures` | Count | `[Service]` and `[Service, ErrorCode]` (one line) | `developercards-prod-notification-failures` reads the `Service`-only set |
| `NotifierReportFailures` | Count | `[Service]` | — |
| `AutomationTickFailures` | Count | `[Service]` | tick failures also raise, feeding `developercards-prod-notifier-errors` |
| `AutomationTicks` | Count | `[Service]` | one per tick invocation; `developercards-prod-automation-tick-missing` watches it (R18B K5) |

Other A10 alarms around the function: `developercards-prod-notify-dlq-nonempty` (DLQ has a
message), `developercards-prod-notifier-errors` (`AWS/Lambda Errors`) and
`developercards-prod-automation-tick-missing` (no `AutomationTicks` for two hours; SQS email
deliveries do not emit it, so they cannot keep the alarm green).

## Emergency stop

Disable the two schedules (`developercards-automation-tick`, `developercards-automation-digest`)
and the notify event source mapping (A00 §17.2, `infra/RUNBOOK.md` §7). Messages then wait in the
queue (retention 4 days) and nothing is sent.

## Environment (`env/prod.env.json`)

`NOTIFY_FROM`, `NOTIFY_RECIPIENT_SSM_NAME`, `INTERNAL_SECRET_SSM_NAME`, `CORE_API_BASE`,
`SES_REGION` (`ap-southeast-2`), `SES_CONFIGURATION_SET`, `METRICS_NAMESPACE`, `LOG_LEVEL`. A blank
value falls back to the file's value.

## boto3 pin

`boto3==1.43.103` in the `dev` dependency group only (tests; never bundled). Pinned on 2026-09-28
to the version the other Python packages (`services/webhook-dispatcher`, `services/ai-qa`,
`services/source-watcher`) pin: the exact boto3 build of the Lambda `python3.12` runtime could not
be confirmed offline, and the code uses only `ssm.get_parameter` and `sesv2.send_email`, which are
stable across versions. The tests use botocore's `Stubber`, which checks the request against this
version's service model.

## Local tests

```bash
cd services/notifier
uv lock --check && uv run --python 3.12 pytest -q
```

The tests never touch the network except a loopback fake core on 127.0.0.1 that verifies the HMAC
like `Auth.cs`; SES is a `Stubber`-wrapped client with dummy credentials, SSM a fake, and sleeps are
injected. No email is sent.

## Supervisor-only operations

Nothing here is deployed by a worker. The function is created by A10's Terraform apply with
placeholder code; the SES identities and the send grant arrive with A11's apply. The supervisor
deploys the code with `services/deploy-python-lambda.sh notifier` (a worker only ever runs
`DRY_RUN=1 bash services/deploy-python-lambda.sh notifier`, which builds and prints the env key
names without calling `aws`), sets `notifier-secret`, enables the schedules and the event source
mapping, and — after DKIM succeeds and the owner has clicked the SES verification link — sends the
test email with `POST /api/v1/admin/automation/notifications/test` (A00 §19.2 step 8).
