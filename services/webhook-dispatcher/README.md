# developercards-webhook-dispatcher

Python 3.12 (arm64) Lambda `developercards-webhook-dispatcher`, handler
`webhook_dispatcher.handler.lambda_handler`. It consumes the SQS queue
`developercards-webhook-events` (batch size 1, `ReportBatchItemFailures`) and delivers each
outbound webhook (contract §6.5):

1. Parse the §6.4 message (`v`, `deliveryId`, `eventId`, `event`, `subscriptionId`, `url`,
   `occurredAt`, `body`). A bad shape is logged (without content) and acked, never retried. A
   message that carries a valid `deliveryId` but a `v` other than `1` (a newer producer) is **not**
   dropped: it is logged as `webhook_unsupported_version` and returned as a batch item failure, so
   SQS moves it to the DLQ (alarmed) where it can be redriven once a dispatcher that speaks that
   version is deployed. Deploy the dispatcher before the core that emits a new message version.
2. Load the signing secret from SSM. Missing or unset ⇒ nothing is sent and the attempt is
   retryable (`SIGNING_SECRET_MISSING`), so a misconfiguration ends in the DLQ and trips the DLQ
   alarm instead of silently dropping events.
3. Run the SSRF guard (below). A rejected URL is a permanent failure (`URL_REJECTED: <reason>`),
   no request is sent.
4. POST the pre-rendered body with the §6.3 headers, pinned to the vetted address.
5. Decide the outcome by the attempt number `n` = `ApproximateReceiveCount`, report the attempt to
   core-vpc, emit metrics, write one log line.

The runtime has no third-party dependency: stdlib only, `boto3` comes from the Lambda runtime.

## Delivery policy (§6.5.2)

| Result of attempt `n` | Outcome | SQS action |
|---|---|---|
| 2xx | `delivered` | ack (deleted) |
| 408, 429, 5xx, timeout, connection error, DNS failure, missing signing secret — `n < 5` | `retry` | `ChangeMessageVisibility` to the backoff below, returned as a batch item failure |
| the same — `n >= 5` | `dead` | batch item failure, no visibility change; SQS moves it to the DLQ on the next receive (`maxReceiveCount = 5`) |
| any other status (other 4xx, 3xx, 1xx) or `URL_REJECTED` | `failed` | ack |
| unexpected exception, or an unsupported message `v` | — | batch item failure (SQS retries, then the DLQ) |

Backoff (`RETRY_DELAYS_SECONDS`) after attempt 1, 2, 3, 4: **30 s, 120 s, 480 s, 900 s**.
Redirects are never followed: `http.client` does not follow them, so a 3xx is just a status and a
permanent failure.

`WEBHOOK_HTTP_TIMEOUT_SECONDS` bounds the **whole** attempt (connect, send, status line, headers and
body), not each socket read: a watchdog shuts the socket down at the deadline, so a receiver that
trickles bytes cannot hold the POST open. A timeout before the status line is a retryable
`timeout`; once the status line and headers are in, the status counts and the rest of the body is
abandoned. The deadline is also capped at the Lambda's remaining time minus 6 s, so every attempt
is still reported to core-vpc before the 30 s function timeout.

Every attempt with a valid message is reported to core-vpc with
`POST /api/internal/webhooks/deliveries/report` (§6.5.3), signed with the internal HMAC (§4.3:
`x-internal-timestamp` in epoch milliseconds, `x-internal-signature: v1=<hex>`). If the report
answers `"stop": true` (subscription disabled or deleted) a `retry` is acked instead. A failed
report never changes the decision; it counts in `WebhookReportFailures`. The report's `error` is at
most 500 characters and never contains the URL path/query or the response body.

**Disabling, deleting or re-pointing a subscription does not recall messages already queued.** The
URL is copied into each SQS message (§6.4) and `stop` is learnt only from the report *after* an
attempt. So every delivery already in the queue makes at most **one** more attempt to the URL it
was enqueued with; the report of that attempt answers `stop: true` and the message is acked instead
of retried. If a URL must not receive anything more (it leaked, or points somewhere wrong), disable
the subscription *and* stop the dispatcher (see "Emergency stop") until the queue holds nothing for
that subscription, or purge the queue. A pre-send claim check needs a core-vpc route and is a
follow-up.

## What receivers see, and how to verify it (§6.3)

```
POST <subscription url>
Content-Type: application/json
User-Agent: DeveloperCards-Webhooks/1
X-DeveloperCards-Event: deck.published
X-DeveloperCards-Delivery: <uuid, the same on every retry of this delivery>
X-DeveloperCards-Timestamp: <unix epoch seconds of this attempt>
X-DeveloperCards-Signature: <lowercase hex HMAC-SHA256(secret, "<timestamp>.<body>")>
X-DeveloperCards-Signature-Previous: <the same HMAC with the previous secret; only during a rotation>
```

Receiver recipe:

1. Read the raw request body as bytes; do not re-serialise the JSON.
2. Reject when `|now − X-DeveloperCards-Timestamp| > 300` seconds.
3. Compute `hex(HMAC-SHA256(secret, f"{timestamp}.{raw_body}"))` over UTF-8 and compare it with
   the header in constant time (`hmac.compare_digest`, `crypto.timingSafeEqual`).
   Accept the request when **either** `X-DeveloperCards-Signature` or (when present)
   `X-DeveloperCards-Signature-Previous` matches: that is what lets the secret rotate without a
   window of rejected deliveries.
4. Deduplicate on the body's `eventId` (retries and multiple deliveries carry the same event).
5. Ignore unknown JSON fields and unknown headers: new fields are added without a version bump.

Test vector: secret `whsec-test`, timestamp `1790000000`, body `{"event":"webhook.test"}` →
`c36d984357900ab4a8e0a6e211f9a7deb1cc72361f27cf4075e9d6f666c661ef`.

## Signing-secret rotation

One signing secret serves the whole environment (§6.3). The dispatcher reads it from
`SIGNING_SECRET_SSM_NAME` and, when it exists, the previous one from `<that name>-previous`
(`/developercards/prod/webhook-signing-secret-previous`). Both are cached per container for at most
**5 minutes** (`SECRET_TTL_SECONDS = 300`), so a change reaches every warm container within that
window. With one secret the headers are byte-identical to before; while `-previous` is set, each
attempt also carries `X-DeveloperCards-Signature-Previous`.

IAM prerequisite: the dispatcher role must be allowed `ssm:GetParameter` on
`…/webhook-signing-secret-previous` (tracked in X08). Until then the read is denied, treated as
"no previous secret" (logged at debug level only), and only the current signature is sent.

Runbook (supervisor only; values never in git or chat):

1. Make sure every receiver accepts either signature header (receiver recipe step 3). Receivers
   that check only `X-DeveloperCards-Signature` must be updated first, or they reject deliveries
   between steps 3 and 4 (a 401 is a permanent failure, not retried).
2. Copy the current value to the previous name:
   `aws ssm put-parameter --name /developercards/prod/webhook-signing-secret-previous --type SecureString --overwrite --value <current>`.
3. Put the new value in `/developercards/prod/webhook-signing-secret`. Wait 10 minutes (two cache
   TTLs): every container now signs with the new secret and the old one.
4. Give every receiver the new secret. They keep verifying through the `-Previous` header until they
   switch, and through the primary header after.
5. Delete the previous parameter:
   `aws ssm delete-parameter --name /developercards/prod/webhook-signing-secret-previous`. Within
   5 minutes only the new signature is sent.

A receiver holds the environment-wide secret and could sign events for other receivers;
per-subscription secrets are a later step.

## SSRF guard and address pinning

`urlguard.check_url` requires `https`, no userinfo, a hostname that is not `localhost` /
`*.localhost`; an IP-literal host must be globally routable; otherwise the host is resolved with
`socket.getaddrinfo` and **every** address must be `is_global` (IPv6 scope ids stripped,
IPv4-mapped IPv6 checked as IPv4). That excludes loopback, RFC 1918, link-local (including the
instance metadata address), carrier-grade NAT, ULA and the other special ranges. A resolution error
is retryable (`DNS resolution failed`), never a rejection.

`delivery.post_json` then connects to the vetted address itself (a pinned
`http.client.HTTPSConnection`) while the `Host` header, TLS SNI and certificate verification keep
the URL's hostname. A second DNS answer cannot change the target between the check and the
connect, which closes the DNS rebinding gap. At most 64 KiB of the response body is read, then
dropped.

## Configuration and secrets

Non-secret environment (`env/prod.env.json`, owned by the deploy script, never by Terraform after
creation):

| Key | Value |
|---|---|
| `SIGNING_SECRET_SSM_NAME` | `/developercards/prod/webhook-signing-secret` |
| `INTERNAL_SECRET_SSM_NAME` | `/developercards/prod/internal-shared-secret` |
| `CORE_API_BASE` | `https://api.developercards.app` |
| `METRICS_NAMESPACE` | `DeveloperCards` |
| `WEBHOOK_HTTP_TIMEOUT_SECONDS` | `10` |
| `LOG_LEVEL` | `info` |

The secrets are read with `ssm:GetParameter` (`WithDecryption=True`) by exact name — never by
path — and cached per container for at most 5 minutes once loaded. Their values are never in git,
the environment or the logs. The value `PLACEHOLDER-set-by-supervisor` (what Terraform creates)
means "not set yet" and is treated as missing; a missing value is not cached, so setting it takes
effect on the next invocation without a deploy. (The optional `-previous` signing secret's absence
is cached for the same 5 minutes, so it costs one SSM read per container per TTL.)

Logs are one JSON line per attempt (`tag`, `deliveryId`, `eventId`, `event`, `subscriptionId`,
`host`, `attempt`, `outcome`, `statusCode`, `durationMs`). They carry the URL's **host only**:
webhook URLs such as Slack's hold their credential in the path. Bodies, signatures and secrets are
never logged.

## Metrics (EMF, namespace `DeveloperCards`, `Service` = `webhook-dispatcher`)

| Metric | Unit | Dimensions |
|---|---|---|
| `WebhookDeliveryAttempts` | Count | `Service`, `Outcome` (`delivered`, `retry`, `failed`, `dead`) |

`Outcome` values: `delivered` = 2xx; `retry` = retryable failure with attempts left; `failed` =
**permanent** failure (non-retryable status or `URL_REJECTED`), acked at once; `dead` = **gave up**
after the last (5th) retryable attempt, headed for the DLQ. Alarms on permanent failures use
`Outcome=failed`, alarms on exhausted retries use `Outcome=dead`.
| `WebhookDeliveryLatency` | Milliseconds | `Service` (only when a request was sent) |
| `WebhookReportFailures` | Count | `Service` |

## boto3 pin

`boto3==1.43.103` in the `dev` dependency group only (tests and type hints; never bundled). Pinned
on 2026-09-27 to the version `uv` resolved that day: the exact boto3 build of the Lambda
`python3.12` runtime could not be confirmed offline, and the code uses only
`ssm.get_parameter` and `sqs.change_message_visibility`, which are stable across versions.

## Local tests

```bash
cd services/webhook-dispatcher
uv lock --check && uv run --python 3.12 pytest -q
```

The tests use fake SSM/SQS clients, a fake resolver and HTTP servers on `127.0.0.1` only; no AWS
call and no outside network. CI runs the same command in the `python` job.

## Supervisor-only operations

Workers never run these.

- Deploy (after J05's infra apply created the function, alias, queue and DLQ):
  `AWS_PROFILE=dev services/deploy-python-lambda.sh webhook-dispatcher`. It builds
  `build/webhook-dispatcher.zip`, overlays `env/prod.env.json` onto the live environment, runs
  `aws lambda update-function-code`, checks `CodeSha256`, publishes a version and moves the `prod`
  alias. It runs the tests first, installs only hash-verified wheels (`--require-hashes`), refuses
  uncommitted changes under `services/webhook-dispatcher`, and prints the rollback command for the
  alias's previous version. `DRY_RUN=1 services/deploy-python-lambda.sh webhook-dispatcher` tests,
  builds and prints the function name, zip size, sha and env key names without calling AWS.
- Set the signing secret: `aws ssm put-parameter --name /developercards/prod/webhook-signing-secret
  --type SecureString --overwrite --value …` (value from the owner, never pasted into git or chat).
- Emergency stop (a receiver incident, a leaked URL, a runaway producer). The event source mapping
  targets the `prod` alias, whose published version has its environment frozen, so editing an
  environment variable on the function changes nothing; stop the consumer instead. Messages stay
  in the queue (retention 4 days) and resume when re-enabled.
  - Find the mapping: `aws lambda list-event-source-mappings --function-name developercards-webhook-dispatcher:prod --query 'EventSourceMappings[].UUID'`.
  - Stop: `aws lambda update-event-source-mapping --uuid <uuid> --no-enabled`
    (or `aws lambda put-function-concurrency --function-name developercards-webhook-dispatcher --reserved-concurrent-executions 0`).
  - Undo: `aws lambda update-event-source-mapping --uuid <uuid> --enabled`
    (or restore the Terraform value: `aws lambda put-function-concurrency --function-name developercards-webhook-dispatcher --reserved-concurrent-executions 2`).
- DLQ redrive, after fixing the cause: `aws sqs start-message-move-task --source-arn
  <developercards-webhook-events-dlq ARN>` (messages go back to `developercards-webhook-events`).
