# developercards-synthetic-check

Python 3.12 (arm64) Lambda `developercards-synthetic-check`, handler
`synthetic_check.handler.lambda_handler` (contract H00 §5.1–§5.3). Once per scheduled invocation it
probes, sequentially, the public paths the app depends on (nine checks since R28 MONITOR, 2026-10-04)
and emits one CloudWatch Embedded Metric Format line. A scheduled Lambda rather than a CloudWatch
Synthetics canary: see H00 §5.1.

- **Stdlib only** (`dependencies = []`). It calls no AWS API (no `boto3` in `src/`), reads no SSM,
  holds no secret and never calls a model.
- **Read only.** Eleven `GET`s, no write route, never an `Authorization` header or a cookie. No account:
  every probed URL is public (R28 MONITOR added no IAM and no secret).
- **Infrastructure is H05's:** the function (created with placeholder code), its role, the 15-minute
  schedule (created **DISABLED**) and the two-consecutive-failures alarm. This package ships at the
  release; the schedule is enabled per `infra/RUNBOOK.md` §8 (H06).

## One invocation

1. Only the event `{"job": "synthetic-check"}` is acted on. Anything else returns
   `{"skipped": "unknown-event"}` with one `synthetic-skip` log line and **no** metric.
2. Settings are read from the environment at call time. An invalid value fails every check with
   `CONFIG` and no request is sent.
3. The checks run in order (below); an unexpected exception inside one check makes that check
   `ERROR`, the others still run. The whole run has a 40 s wall-time deadline (`RUN_DEADLINE_S`),
   well under the 60 s Lambda timeout: each check runs in a worker thread joined with the remaining
   budget, so a DNS stall or a slow-drip body cannot hold the run. A check still running at the
   deadline, and every check not yet started, is `TIMEOUT` (never-started checks with `ms` 0 and
   no request sent).
4. One EMF line, one `synthetic-run` log line (`info` when all pass, else `warn`, with `ok`,
   `failedChecks` and `advisoryFailed`), and the return value
   `{"ok": bool, "failed": [check names in order], "advisoryFailed": [...]}`. `ok` and `failed` leave out
   the advisory check `remote-config` (below), so `scripts/smoke.sh` (`ok` true, `failed` empty) never
   rolls a deploy back over GitHub raw. The handler never raises.

## The checks

| # | name | Request | Pass when (else) |
|---|---|---|---|
| 1 | `api-health` | `GET {API_BASE}/health`, cap 1 MiB | 200 and a JSON object with `success is true` and `data.ok is true` (else `HTTP_STATUS` / `BAD_BODY`) |
| 2 | `cdn-manifest` | `GET {CDN_BASE}/content/manifest.json`, cap 1 MiB | 200, JSON object, `schemaVersion` an integer (not a boolean), `decks` a non-empty list (else `HTTP_STATUS` / `BAD_BODY` / `TOO_LARGE`) |
| 3 | `cdn-deck` | the first manifest deck with `downloadMode "public"`, `availability "live"`, a relative `path` (no leading `/`, no `://`, no `..` segment, no `?`/`#`) and a 64-char lowercase-hex `sha256`; `GET {CDN_BASE}/{prefix}/{path}`, cap 5 MiB | 200 and the body's SHA-256 equals `sha256` (else `HTTP_STATUS` / `HASH_MISMATCH` / `TOO_LARGE`); `NO_PUBLIC_DECK` without a request when check 2 failed, `prefix` is missing or invalid, or no deck qualifies |
| 4 | `console-index` | `GET {CONSOLE_BASE}/`, cap 1 MiB | 200, `Content-Type` starting with `text/html` and a body containing `<html` (both case-insensitive; else `HTTP_STATUS` / `BAD_BODY`) |
| 5 | `api-auth-guard` | `GET {API_BASE}/api/v1/me`, no token, cap 1 MiB | status exactly 401 (a 200, 403 or 5xx is `HTTP_STATUS`) |
| 6 | `api-sync-guard` | `GET {API_BASE}/api/v1/sync/progress`, no token, cap 1 MiB | status exactly 401: the app's sync route is served and a JWT authorizer rejects the token-less call (a 200 or 403 means the route lost its authorizer, a 429 a throttle, a 5xx an outage; all `HTTP_STATUS`). A 401 cannot tell which authorizer answered: a deleted sync route falls to `ANY /{proxy+}`, which is guarded too |
| 7 | `remote-config` | `GET {REMOTE_CONFIG_URL}` (the document `mobile/App.tsx` `REMOTE_CONFIG_URL` reads), cap 64 KiB | 200, JSON, and the rules below (else `HTTP_STATUS` / `BAD_BODY` with `detail` / `TOO_LARGE`) |
| 8 | `cognito-console` | `GET {COGNITO_CONSOLE_ISSUER}/.well-known/openid-configuration`, then `GET {COGNITO_CONSOLE_ISSUER}/.well-known/jwks.json` (the configured URL, never one read from the response), cap 64 KiB each | both 200 and JSON; discovery `issuer` equals the configured issuer and `jwks_uri` equals the JWKS URL; `keys` a non-empty list of objects with a non-empty string `kid` and a string `kty`, at least one `kty RSA`, `alg RS256`, `use` absent or `sig` (core-vpc accepts RS256 only) |
| 9 | `cognito-mobile` | the same for `COGNITO_MOBILE_ISSUER` | the same |

### Remote-config rules (`checks.remote_config_problem`)

The app never fails on a bad document: it keeps the last good copy, or uses a flag's built-in default for
a value of the wrong type, so a broken document silently changes behaviour. The check fails `BAD_BODY`
with the first broken rule as `detail`:

| `detail` | Rule |
|---|---|
| `json` | the body is a JSON object |
| `ios` | `ios`, when present, is an object |
| `ios.<key>` | each of `minSupportedVersion`, `latestVersion`, `updateUrl`, `appStoreId`, `message`, when present, is a string (the app calls `.trim()` on them); `minSupportedVersion`, when not blank, is 1–3 dot-separated numbers (the version gate compares it); `updateUrl`, when not blank, starts with `https://apps.apple.com/` (report G10: the only place a gated user may be sent); `appStoreId`, when not blank, is digits. `latestVersion` needs only to be a string: `resolveIosUpdate` returns it but nothing gates on it or shows it (the live document still says `1.3.0`), so it is not compared with `minSupportedVersion` |
| `features` | `features`, when present, is an object |
| `features.<flag>` / `features.<flag>.<leaf>` | each known flag is an object and each known leaf has the type `applyRemoteFeatures` accepts (booleans; `mcq.maxPerRun` a non-negative integer; `mistakeBook.relatedCount` 0–5) |
| `features.unknown` | a flag this check does not know (a newer app's) is still an object |

`null` counts as absent everywhere. `tests/test_remote_config_schema.py` fails when the app's readers
(`featureFlags.ts`, `remoteConfig.ts`) and these rules drift apart.

`remote-config` is an **advisory** check (`checks.ADVISORY_CHECKS`): a third party serves the document and
the app keeps its last good copy, so its failure is not an outage of ours. It is left out of
`SyntheticCheckSuccess`, of the handler's `ok` / `failed` and so of the paging alarm
`developercards-prod-synthetic-check-failing` (which would otherwise sit in ALARM through a GitHub incident or
a bad document and send nothing for a real outage meanwhile). It has its own metric and alarm (below).

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

A failed R28 check may also carry `detail`: a remote-config rule id (above) or, for the Cognito checks,
`discovery` / `jwks` (which request failed) or `discovery.issuer`, `discovery.jwks_uri`, `jwks.keys`,
`jwks.rs256`. Every value comes from a fixed list in `checks.DETAILS`, never from a response.

## Metrics (EMF, namespace `METRICS_NAMESPACE`, dimension `Service = synthetic-check`)

| Metric | Unit | Value |
|---|---|---|
| `SyntheticCheckSuccess` | Count | 1 only when every check except `remote-config` passes, else 0; alarm `developercards-prod-synthetic-check-failing` |
| `SyntheticCheckLatency` | Milliseconds | wall time of the whole run |
| `SyntheticRemoteConfigSuccess` | Count | 1 when `remote-config` passes, else 0 (since the R28 review, 2026-10-04); alarm `developercards-prod-synthetic-remote-config-failing` |

The same line carries `failedChecks` (every failed check, `remote-config` included, in check order), `checks`
(`{name: {ok, status, ms, code}}`, plus `detail` on a failed check that set one) and `xrayTraceId` when
the invocation has an X-Ray root. Logs and metrics never carry a URL, a response body or a header value.

The API Gateway alarms of R28 MONITOR (`infra/modules/observability/alarms_r28.tf`) leave this check's
requests out by their `User-Agent` (`DeveloperCards-Synthetic/…`), and the api-availability SLO subtracts
its API routes (`GET /health`; the 4xx of `GET /api/v1/me` and `ANY /api/v1/sync/{proxy+}`).
`tests/test_infra_contract.py` keeps both in step with `CHECK_USER_AGENT` and the probed paths: change
them together.

## What it does not prove: the database

The synthetic proves edge, CDN and console reachability, not RDS. `GET /health` is answered by
core-vpc before any database access (`src_C/Vpc/VpcFunction.cs`, the `/health` branch), and the
token-less `GET /api/v1/me` and `GET /api/v1/sync/progress` are rejected with 401 by the API Gateway
JWT authorizer without invoking core-vpc at all. Only check 1 invokes core-vpc. An RDS outage, connection exhaustion or a broken DB
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
| `REMOTE_CONFIG_URL` | `https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json` | a base (as above) plus a path of unreserved segments; equals `mobile/App.tsx` `REMOTE_CONFIG_URL` (tested) |
| `COGNITO_CONSOLE_ISSUER` | `https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_4Vf8uCXKt` | a base plus one segment, the pool id; the console pool (core-vpc `DefaultConsolePool`, tested) |
| `COGNITO_MOBILE_ISSUER` | `https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_04hd6iisb` | the same; the mobile pool (core-vpc `DefaultIssuers`, tested) |
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

The tests serve every probed path from a loopback `ThreadingHTTPServer` on `127.0.0.1`; they never
reach the real hosts. Packaging: `DRY_RUN=1 services/deploy-python-lambda.sh synthetic-check` builds the zip
and prints the function, zip size and env key names only.

## Cost (H00 §9)

Once H05's schedule is enabled: 2,880 runs/month × ≈ 3 s × 256 MB ≈ 2.2k GB-s (Lambda free tier)
⇒ USD 0.00; 8,640 API Gateway requests ⇒ ≈ USD 0.01 (only the 2,880 `/health` requests invoke
core-vpc; the token-less `/api/v1/me` and `/api/v1/sync/progress` requests stop at the JWT authorizer);
2,880 deck downloads ≈ 0.6 GB CloudFront (free tier) ⇒ USD 0.00; the GitHub raw and Cognito discovery/JWKS
reads are free; three custom metrics × USD 0.30 = USD 0.90; ≈ 8 MB of logs ⇒ ≈ USD 0.01.
Total ≈ USD 0.92/month (R28 MONITOR's review added `SyntheticRemoteConfigSuccess`; its alarm is USD 0.10,
counted in infra/RUNBOOK.md §7).
