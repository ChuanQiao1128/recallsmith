# H04 — synthetic check Lambda `developercards-synthetic-check` (notes)

Issue #516, brief `H04-synthetic-check-lambda.md`, contract H00 §5.1–§5.3. Code only: H05 creates the
function (placeholder code), its role, the DISABLED 15-minute schedule and the alarm; this package
ships at the release (H00 §8.2 steps 4 and 6).

## Modules (`services/synthetic-check/src/synthetic_check/`)

| Module | Role |
|---|---|
| `__init__.py` | docstring only |
| `settings.py` | `Settings` / `load_settings(env=None)`: reads `os.environ` at call time, never raises; bases must be `https://<host>[:port][/]` or `http://127.0.0.1:<port>[/]`, timeout in [0.1, 10], non-empty user agent and namespace; a violation sets `config_error` (e.g. `invalid_api_base`, never the value) |
| `checks.py` | `CHECK_NAMES`, `CheckResult`, `run_checks(settings)`; one `check_*` function per check, run in order; opener = `ProxyHandler({})` + a redirect handler whose `redirect_request` returns `None`; bounded failure codes |
| `emf.py` | `run_line(namespace, results, latency_ms)`: one EMF line, `SyntheticCheckSuccess` (Count) + `SyntheticCheckLatency` (Milliseconds), dimension `Service` |
| `handler.py` | `lambda_handler`: event gate (`{"job": "synthetic-check"}`), one EMF line + one `synthetic-run` log line, returns `{"ok", "failed"}`, never raises |
| `logs.py` | the H03 notifier `logs.py` (xrayTraceId / upstreamTraceId) |
| `tracectx.py` | byte-identical to `services/notifier/src/notifier/tracectx.py` |

## Checks as implemented

| # | name | Request | Pass when (else) |
|---|---|---|---|
| 1 | `api-health` | `GET {api_base}/health`, cap 1 MiB, `Accept: application/json` | 200, JSON object, `success is True`, `data.ok is True` (else `HTTP_STATUS` / `BAD_BODY` / `TOO_LARGE`) |
| 2 | `cdn-manifest` | `GET {cdn_base}/content/manifest.json`, cap 1 MiB | 200, JSON object, `schemaVersion` int not bool, `decks` non-empty list (else `HTTP_STATUS` / `BAD_BODY` / `TOO_LARGE`) |
| 3 | `cdn-deck` | first deck dict with `downloadMode "public"`, `availability "live"`, relative safe `path`, 64-char lowercase-hex `sha256`; `GET {cdn_base}/{prefix}/{path}` (prefix stripped of `/`, validated like a path), cap 5 MiB | 200 and body SHA-256 matches (else `HTTP_STATUS` / `HASH_MISMATCH` / `TOO_LARGE`); `NO_PUBLIC_DECK`, status `None`, no request when check 2 failed, prefix missing/invalid or no deck qualifies |
| 4 | `console-index` | `GET {console_base}/`, cap 1 MiB, `Accept: text/html` | 200, `Content-Type` starts with `text/html`, body contains `<html` (case-insensitive; else `HTTP_STATUS` / `BAD_BODY`) |
| 5 | `api-auth-guard` | `GET {api_base}/api/v1/me`, no token, cap 1 MiB | exactly 401 (else `HTTP_STATUS`; timeout `TIMEOUT`) |

Transport: `TimeoutError` / `socket.timeout` (raw or as a `URLError` reason, on connect or read) ⇒
`TIMEOUT`; other `URLError` / `OSError` / `http.client.HTTPException` ⇒ `NETWORK`; a non-2xx answer
(including a 3xx, never followed) ⇒ `HTTP_STATUS` with its status; any other exception ⇒ `ERROR`.
`config_error` set ⇒ five `CheckResult(name, False, None, 0, "CONFIG")`, no request.

## Tests (29, loopback only)

| File | Tests |
|---|---|
| `tests/test_checks.py` | 16 |
| `tests/test_handler.py` | 5 |
| `tests/test_emf.py` | 1 |
| `tests/test_settings.py` | 3 |
| `tests/test_tracectx.py` | 4 (the two required + `current_root` env tests from H03) |

`conftest.py` serves all five paths from one `ThreadingHTTPServer` on `127.0.0.1` (routes overridable
per test, every request's headers recorded); the manifest lists a premium and a retired deck before
the public live `decks/demo/builds/b1/deck.json`.

## Deploy script

One new `case` line (`synthetic-check) FN="developercards-synthetic-check"; PKG="synthetic_check"`)
and the usage text. `DRY_RUN=1 services/deploy-python-lambda.sh synthetic-check` output (tests pass
first; the sha256 is omitted here):

```
DRY: function developercards-synthetic-check (region ap-southeast-2, alias prod)
DRY: zip services/synthetic-check/build/synthetic-check.zip (8323 bytes, sha256 …)
DRY: developercards-synthetic-check env overlay keys: API_BASE,CDN_BASE,CHECK_TIMEOUT_SECONDS,CHECK_USER_AGENT,CONSOLE_BASE,LOG_LEVEL,METRICS_NAMESPACE
```

The zip holds only `synthetic_check/*.py` at its root (no tests, fixtures or dev packages).

## Cost (H00 §9)

No AWS resource in this issue. Once H05's schedule is enabled: 2,880 runs/month × ≈ 2 s × 256 MB ≈
1.4k GB-s (free tier) ⇒ USD 0.00; 5,760 API Gateway requests ⇒ ≈ USD 0.01; ≈ 0.6 GB CloudFront (free
tier) ⇒ USD 0.00; two custom metrics ⇒ USD 0.60; ≈ 6 MB logs ⇒ ≈ USD 0.01. Total ≈ USD 0.62/month.
