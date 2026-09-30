# M03 — `x-dc-trace-id` from the active Sentry trace (`mobile-trace-header`) — notes

Issue #536, wave R19M-M. Contract: M00 §4. No server, CORS, dependency or frozen-file change.

## Where each change lives

| Change | Location |
|---|---|
| Provider injection `setTraceHeaderProvider` (module variable `_traceHeaderProvider`) | `mobile/src/api/apiClient.ts:40-47` |
| Local `TRACE_HEADER_PATTERN` literal (must agree with `TraceContext.cs:28` and `sentryPolicy.DC_TRACE_HEADER_PATTERN`) | `mobile/src/api/apiClient.ts:49-52` |
| Case-insensitive lookup of a caller header / guarded provider read (try/catch + pattern check) | `mobile/src/api/apiClient.ts:54-72` |
| Header added in `requestOnce` after the caller's headers are merged, before the first `send()` | `mobile/src/api/apiClient.ts:103-114` |
| `err.requestId` (envelope `traceId` when a string) and `err.dcTraceId` (header actually sent) on non-OK responses | `mobile/src/api/apiClient.ts:180-183` |
| `DC_TRACE_HEADER`, `DC_TRACE_HEADER_PATTERN`, `toDcTraceHeader`, `apiErrorTags` (appended, no existing line changed) | `mobile/src/telemetry/sentryPolicy.ts:218-254` |
| Kill-switch close removes the provider: `setTraceHeaderProvider(null)` | `mobile/src/telemetry/observability.ts:92` |
| `beforeSend` merges `apiErrorTags(hint?.originalException)` into `event.tags` before `scrubEvent` (after the drop rule and the cap) | `mobile/src/telemetry/observability.ts:159-160` |
| Step 5 (after a successful `Sentry.init`) installs `setTraceHeaderProvider(getDcTraceHeader)` | `mobile/src/telemetry/observability.ts:176-177` |
| `getDcTraceHeader()` (never throws) | `mobile/src/telemetry/observability.ts:190-201` |

The 401 replay reuses the same `headers` object, so it carries the same value; the fallback retry runs
`requestOnce` again, which asks the provider again. A caller-supplied `x-dc-trace-id` in any casing wins and the
provider is not called.

## Sentry API used for the trace id

Installed `@sentry/react-native` version: **7.2.0** (`mobile/node_modules/@sentry/react-native/package.json`).
Both documented APIs are exported by its typings (`dist/js/index.d.ts` re-exports them from `@sentry/core`), so no
equivalent was needed:

- `Sentry.getActiveSpan()?.spanContext().traceId` — the active span's trace id;
- `Sentry.getCurrentScope().getPropagationContext().traceId` — the scope's trace id when no span is active.

`toDcTraceHeader` accepts only 32 lower-case hex (not all zeros) and returns `1-<first 8>-<last 24>`.

## Proof that inactive builds send no header

apiClient never invents a value: with no provider installed the header set is exactly today's.

- `tests/unit/apiClientTraceHeader.test.ts` — "sends no header and the unchanged header set when no provider is
  installed" (asserts the full header object), "sends no header for …" (null, throwing, upper-case, too short,
  `Root=…`, empty, raw 32-hex, non-string), "sends no header again after setTraceHeaderProvider(null)".
- `tests/unit/observabilityTrace.test.ts` — "is not installed when inactive (dev | channel | channel | no-dsn |
  kill-switch)", "is not installed when init throws ('init-failed')", "is removed after the kill-switch flip"; each
  sends a real `apiJson` call through a fake `fetch` and asserts no `x-dc-trace-id`.
- The existing `apiClientErrors` / `apiClientFallback` / `apiClientRefresh` suites install no provider and pass
  unchanged.

## Finding an event's backend log line

For a failed API call captured by Sentry, the event carries:

- `api.request_id` = the envelope `traceId` = core-vpc `traceId` (API Gateway request id, H00 §0.5);
- `api.dc_trace_id` = the `x-dc-trace-id` header sent = core-vpc `upstreamTraceId` on the route EMF line
  (`RouteMetrics.cs:559-560`);
- `api.status`, `api.error_code` = HTTP status and envelope error code.

In CloudWatch Logs Insights on the core-vpc log group, filter on `traceId = "<api.request_id>"` or
`upstreamTraceId = "<api.dc_trace_id>"`. For a transaction without an error, `upstreamTraceId` is
`1-<first 8>-<last 24>` of the transaction's Sentry trace id.
