# H03 — services-trace-correlation (issue #515)

The four Python Lambdas now correlate with X-Ray using the standard library only (no X-Ray SDK, no
OpenTelemetry, no Powertools, no dependency or lock change).

## What changed per package

| Package | Files (line ranges in the new tree) |
|---|---|
| `services/ai-qa` (`ai_qa`) | `tracectx.py` new (1-50); `logs.py` import 10-11, record build 24-31; `internal_client.py` import 24-25, `_attempt` headers 142-155; `handler.py` import 18, `_trace_header` 579-582, `lambda_handler` loop 587-599 |
| `services/webhook-dispatcher` (`webhook_dispatcher`) | `tracectx.py` new (1-50); `logs.py` 10-11, 24-31; `internal_client.py` 24-25, 139-152; `handler.py` imports 12 and 17, `_trace_header` 386-389, `lambda_handler` loop 395-412 |
| `services/notifier` (`notifier`) | `tracectx.py` new (1-50); `logs.py` 10-11, 24-31; `internal_client.py` 24-25, 144-157; `handler.py` import 18, `_trace_header` 325-328, `_handle_sqs` loop 333-346 |
| `services/source-watcher` (`source_watcher`) | `tracectx.py` new (1-50); `logs.py` 10-11, 24-31; `internal_client.py` 24-25, 143-156. `handler.py` untouched (schedule-only, no SQS) |

The four `tracectx.py` files are byte-identical.

## Log key order

`["level", "tag", "xrayTraceId"?, "upstreamTraceId"?, <caller fields>]`

- `xrayTraceId` — present only when `_X_AMZN_TRACE_ID` holds a valid root (`1-` + 8 lowercase hex + `-` +
  24 lowercase hex, bare or as the first `Root=` segment).
- `upstreamTraceId` — present only while an SQS record whose `attributes.AWSTraceHeader` carries a valid
  root is handled. It is bound before the record's code and cleared in a `finally` that encloses the
  existing `try/except` and the batch-item-failure append, so a failing record's existing error line
  (`unexpected_error` / `webhook_unexpected_error` / `record_error`) still carries it and the next
  record starts clean.
- Caller fields are applied last (`record.update(fields)`). No Python code writes a field called `traceId`.

With `_X_AMZN_TRACE_ID` unset (every existing test) the line is unchanged.

## Header rule

`internal_client._attempt` (the only path to core-vpc) adds `x-dc-trace-id: <bare root>` when
`tracectx.current_root()` is not `None`, and nothing otherwise. The HMAC still covers timestamp and body
only, so signatures are unchanged. No other module sends a trace header:
`services/webhook-dispatcher/src/webhook_dispatcher/delivery.py` and
`services/source-watcher/src/source_watcher/fetch.py` are byte-identical to the base, and SES calls are
untouched.

## No new log line

The number of `log(` call sites in every edited module equals the base; no log line was added, removed or
reworded, and no tag changed.

## Tests

| Package | New tests | Full suite |
|---|---|---|
| ai-qa | `test_tracectx.py` (6), `test_trace_handler.py` (3), `test_trace_propagation.py` (2) | 274 passed |
| webhook-dispatcher | `test_tracectx.py` (6), `test_trace_handler.py` (3) | 142 passed |
| notifier | `test_tracectx.py` (6), `test_trace_handler.py` (3) | 51 passed |
| source-watcher | `test_tracectx.py` (6) | 88 passed |

- `test_tracectx.py`: `test_root_parsing_property` (seeded `random.Random`, 60 valid roots in four shapes,
  1260 invalid mutations), `test_current_root_reads_the_lambda_env`, `test_invalid_env_value_gives_no_root`,
  `test_log_fields_present_only_when_set`, `test_internal_client_sends_trace_header_when_root_exists`,
  `test_internal_client_omits_trace_header_without_root` (loopback `local_server` on 127.0.0.1).
- `test_trace_handler.py`: `test_record_trace_header_is_bound_during_its_record_only`,
  `test_upstream_is_cleared_after_a_record_raises`, `test_invalid_trace_header_is_not_logged`.
- `test_trace_propagation.py` (ai-qa): `test_boto3_sends_lambda_trace_header_inside_lambda`,
  `test_boto3_sends_no_trace_header_outside_lambda` — SQS and SSM clients with a `before-send` stub; no
  network, no credentials read from the machine.

Every existing test file is byte-identical.
