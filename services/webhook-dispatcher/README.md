# developercards-webhook-dispatcher

Python 3.12 (arm64) Lambda `developercards-webhook-dispatcher`, handler
`webhook_dispatcher.handler.lambda_handler`. It consumes the SQS queue
`developercards-webhook-events` (batch size 1, `ReportBatchItemFailures`) and delivers each
outbound webhook (contract §6.5):

1. Parse the §6.4 message (`v`, `deliveryId`, `eventId`, `event`, `subscriptionId`, `url`,
   `occurredAt`, `body`). A bad shape is logged (without content) and acked, never retried.
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
| unexpected exception | — | batch item failure (SQS retries, then the DLQ) |

Backoff (`RETRY_DELAYS_SECONDS`) after attempt 1, 2, 3, 4: **30 s, 120 s, 480 s, 900 s**.
Redirects are never followed: `http.client` does not follow them, so a 3xx is just a status and a
permanent failure.

Every attempt with a valid message is reported to core-vpc with
`POST /api/internal/webhooks/deliveries/report` (§6.5.3), signed with the internal HMAC (§4.3:
`x-internal-timestamp` in epoch milliseconds, `x-internal-signature: v1=<hex>`). If the report
answers `"stop": true` (subscription disabled or deleted) a `retry` is acked instead. A failed
report never changes the decision; it counts in `WebhookReportFailures`. The report's `error` is at
most 500 characters and never contains the URL path/query or the response body.

## What receivers see, and how to verify it (§6.3)

```
POST <subscription url>
Content-Type: application/json
User-Agent: DeveloperCards-Webhooks/1
X-DeveloperCards-Event: deck.published
X-DeveloperCards-Delivery: <uuid, the same on every retry of this delivery>
X-DeveloperCards-Timestamp: <unix epoch seconds of this attempt>
X-DeveloperCards-Signature: <lowercase hex HMAC-SHA256(secret, "<timestamp>.<body>")>
```

Receiver recipe:

1. Read the raw request body as bytes; do not re-serialise the JSON.
2. Reject when `|now − X-DeveloperCards-Timestamp| > 300` seconds.
3. Compute `hex(HMAC-SHA256(secret, f"{timestamp}.{raw_body}"))` over UTF-8 and compare it with
   the header in constant time (`hmac.compare_digest`, `crypto.timingSafeEqual`).
4. Deduplicate on the body's `eventId` (retries and multiple deliveries carry the same event).

Test vector: secret `whsec-test`, timestamp `1790000000`, body `{"event":"webhook.test"}` →
`c36d984357900ab4a8e0a6e211f9a7deb1cc72361f27cf4075e9d6f666c661ef`.

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

The two secrets are read with `ssm:GetParameter` (`WithDecryption=True`) by exact name — never by
path — and cached per container once loaded. Their values are never in git, the environment or the
logs. The value `PLACEHOLDER-set-by-supervisor` (what Terraform creates) means "not set yet" and is
treated as missing; a missing value is not cached, so setting it takes effect on the next
invocation without a deploy.

Logs are one JSON line per attempt (`tag`, `deliveryId`, `eventId`, `event`, `subscriptionId`,
`host`, `attempt`, `outcome`, `statusCode`, `durationMs`). They carry the URL's **host only**:
webhook URLs such as Slack's hold their credential in the path. Bodies, signatures and secrets are
never logged.

## Metrics (EMF, namespace `DeveloperCards`, `Service` = `webhook-dispatcher`)

| Metric | Unit | Dimensions |
|---|---|---|
| `WebhookDeliveryAttempts` | Count | `Service`, `Outcome` (`delivered`, `retry`, `failed`, `dead`) |
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
  alias. `DRY_RUN=1 services/deploy-python-lambda.sh webhook-dispatcher` builds and prints the
  function name, zip size, sha and env key names without calling AWS.
- Set the signing secret: `aws ssm put-parameter --name /developercards/prod/webhook-signing-secret
  --type SecureString --overwrite --value …` (value from the owner, never pasted into git or chat).
- DLQ redrive, after fixing the cause: `aws sqs start-message-move-task --source-arn
  <developercards-webhook-events-dlq ARN>` (messages go back to `developercards-webhook-events`).
