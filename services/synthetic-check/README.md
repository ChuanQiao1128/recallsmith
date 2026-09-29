# developercards-synthetic-check

Python 3.12 (arm64) Lambda `developercards-synthetic-check`, handler
`synthetic_check.handler.lambda_handler` (contract H00 §5.1–§5.3). Once per scheduled invocation it
probes, sequentially, the five public paths the app depends on and emits one CloudWatch Embedded
Metric Format line. A scheduled Lambda rather than a CloudWatch Synthetics canary: see H00 §5.1.

- **Stdlib only** (`dependencies = []`). It calls no AWS API (no `boto3` in `src/`), reads no SSM,
  holds no secret and never calls a model.
- **Read only.** Five `GET`s, no write route, never an `Authorization` header or a cookie.
- **Infrastructure is H05's:** the function (created with placeholder code), its role, the 15-minute
  schedule (created **DISABLED**) and the two-consecutive-failures alarm. This package ships at the
  release; the schedule is enabled per `infra/RUNBOOK.md` §8 (H06).

## One invocation

1. Only the event `{"job": "synthetic-check"}` is acted on. Anything else returns
   `{"skipped": "unknown-event"}` with one `synthetic-skip` log line and **no** metric.
2. Settings are read from the environment at call time. An invalid value fails every check with
   `CONFIG` and no request is sent.
3. The five checks run in order (below); an unexpected exception inside one check makes that check
   `ERROR`, the others still run. The whole run has a 40 s wall-time deadline (`RUN_DEADLINE_S`),
   well under the 60 s Lambda timeout: each check runs in a worker thread joined with the remaining
   budget, so a DNS stall or a slow-drip body cannot hold the run. A check still running at the
   deadline, and every check not yet started, is `TIMEOUT` (never-started checks with `ms` 0 and
   no request sent).
4. One EMF line, one `synthetic-run` log line (`info` when all pass, else `warn`, with `ok` and
   `failedChecks`), and the return value `{"ok": bool, "failed": [check names in order]}`.
   The handler never raises.

## The five checks

| # | name | Request | Pass when (else) |
|---|---|---|---|
| 1 | `api-health` | `GET {API_BASE}/health`, cap 1 MiB | 200 and a JSON object with `success is true` and `data.ok is true` (else `HTTP_STATUS` / `BAD_BODY`) |
| 2 | `cdn-manifest` | `GET {CDN_BASE}/content/manifest.json`, cap 1 MiB | 200, JSON object, `schemaVersion` an integer (not a boolean), `decks` a non-empty list (else `HTTP_STATUS` / `BAD_BODY` / `TOO_LARGE`) |
| 3 | `cdn-deck` | the first manifest deck with `downloadMode "public"`, `availability "live"`, a relative `path` (no leading `/`, no `://`, no `..` segment, no `?`/`#`) and a 64-char lowercase-hex `sha256`; `GET {CDN_BASE}/{prefix}/{path}`, cap 5 MiB | 200 and the body's SHA-256 equals `sha256` (else `HTTP_STATUS` / `HASH_MISMATCH` / `TOO_LARGE`); `NO_PUBLIC_DECK` without a request when check 2 failed, `prefix` is missing or invalid, or no deck qualifies |
| 4 | `console-index` | `GET {CONSOLE_BASE}/`, cap 1 MiB | 200, `Content-Type` starting with `text/html` and a body containing `<html` (both case-insensitive; else `HTTP_STATUS` / `BAD_BODY`) |
| 5 | `api-auth-guard` | `GET {API_BASE}/api/v1/me`, no token, cap 1 MiB | status exactly 401 (a 200, 403 or 5xx is `HTTP_STATUS`) |

Every request: no proxy, **no redirect followed** (a 3xx is `HTTP_STATUS`), per-request timeout
`CHECK_TIMEOUT_SECONDS`, **no retry**, only `User-Agent: CHECK_USER_AGENT` and `Accept` set, at
most cap + 1 bytes read (`TOO_LARGE` beyond the cap). The per-request timeout bounds each socket
operation only; the run deadline bounds the whole run, including name resolution, so the EMF line
is always written inside H05's 60 s Lambda timeout.

## Failure codes

| Code | Meaning |
|---|---|
| `HTTP_STATUS` | an unexpected HTTP status (including any 3xx) |
| `TIMEOUT` | the connection or the read timed out, or the run deadline passed (while the check ran or before it started) |
| `NETWORK` | any other connection or protocol error (refused, reset, DNS, TLS) |
| `BAD_BODY` | the body is not what the check requires |
| `HASH_MISMATCH` | the deck body does not hash to the manifest's `sha256` |
| `TOO_LARGE` | the body is larger than the check's cap |
| `NO_PUBLIC_DECK` | no qualifying public live deck (or the manifest check failed) |
| `CONFIG` | an environment value is invalid; nothing was requested |
| `ERROR` | an unexpected exception inside the check |

## Metrics (EMF, namespace `METRICS_NAMESPACE`, dimension `Service = synthetic-check`)

| Metric | Unit | Value |
|---|---|---|
| `SyntheticCheckSuccess` | Count | 1 only when all five checks pass, else 0 |
| `SyntheticCheckLatency` | Milliseconds | wall time of the whole run |

The same line carries `failedChecks` (names in check order), `checks`
(`{name: {ok, status, ms, code}}`) and `xrayTraceId` when the invocation has an X-Ray root. Logs and
metrics never carry a URL, a response body or a header value.

## What it does not prove: the database

The synthetic proves edge, CDN and console reachability, not RDS. `GET /health` is answered by
core-vpc before any database access (`src_C/Vpc/VpcFunction.cs`, the `/health` branch), and the
token-less `GET /api/v1/me` is rejected with 401 by the API Gateway JWT authorizer without invoking
core-vpc at all. Only check 1 invokes core-vpc. An RDS outage, connection exhaustion or a broken DB
secret leaves the synthetic green.

A database outage still pages within 30 minutes, through the automation tick:

1. `developercards-automation-tick` (EventBridge Scheduler, `rate(15 minutes)`, ENABLED) invokes
   the notifier's `prod` alias with `{"job":"tick"}`.
2. The notifier POSTs `/api/internal/automation/tick`. Core's `AutomationTick.HandleTick` opens a
   Postgres connection and queries before any step and before the automation-mode check, so it
   touches the database in every mode. A connect failure (`PG_CONNECTION_TIMEOUT`, default 8 s), an authentication
   failure or `too_many_connections` is caught and answered 500; a hung core is a gateway 504 or
   the notifier's 28 s client timeout.
3. The notifier treats any non-2xx or failed envelope as a tick failure: it emits
   `AutomationTickFailures` and raises, so the invocation is a Lambda error.
4. `developercards-prod-notifier-errors` (`AWS/Lambda` `Errors` ≥ 1 in one 300 s period, actions
   to `developercards-alerts`) pages.

Worst case: 15 minutes to the next tick, plus the tick itself, plus one 5-minute period and the
evaluation lag, about 22 minutes. The app's own API 5xx also feed the api-availability burn alarms,
and `developercards-prod-rds-connections` covers exhaustion. `tests/test_db_outage_paging.py` in
`services/notifier` pins steps 1, 3 and 4 against the infra files. A deep, auth-free database probe
(for example `GET /health?deep=1` running `SELECT 1` with a short timeout) would be a core route
change and is a follow-up, not part of this function.

## Environment (`env/prod.env.json`, all strings)

| Key | Prod value | Rule |
|---|---|---|
| `API_BASE` | `https://api.developercards.app` | `https://<host>[:port]` (tests: `http://127.0.0.1:<port>`) |
| `CDN_BASE` | `https://cdn.developercards.app` | same |
| `CONSOLE_BASE` | `https://console.developercards.app` | same |
| `CHECK_TIMEOUT_SECONDS` | `10` | a number in [0.1, 10] |
| `CHECK_USER_AGENT` | `DeveloperCards-Synthetic/1.0 (+https://developercards.app)` | non-empty |
| `METRICS_NAMESPACE` | `DeveloperCards` | non-empty |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Development

```bash
cd services/synthetic-check
uv lock --check
uv run --python 3.12 pytest -q
```

The tests serve all five paths from a loopback `ThreadingHTTPServer` on `127.0.0.1`; they never reach
the real hosts. Packaging: `DRY_RUN=1 services/deploy-python-lambda.sh synthetic-check` builds the zip
and prints the function, zip size and env key names only.

## Cost (H00 §9)

Once H05's schedule is enabled: 2,880 runs/month × ≈ 2 s × 256 MB ≈ 1.4k GB-s (Lambda free tier)
⇒ USD 0.00; 5,760 API Gateway requests ⇒ ≈ USD 0.01 (only the 2,880 `/health` requests invoke
core-vpc; the 2,880 token-less `/api/v1/me` requests stop at the JWT authorizer); 2,880 deck downloads ≈ 0.6 GB CloudFront (free
tier) ⇒ USD 0.00; two custom metrics × USD 0.30 = USD 0.60; ≈ 6 MB of logs ⇒ ≈ USD 0.01.
Total ≈ USD 0.62/month.
