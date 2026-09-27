# A08 notes — source watcher Lambda (`services/source-watcher`)

Contract readings made while implementing A08 (A00 §10), with the reason for each.

## Fetch error mapping (A00 §10.3 step 6, §10.5)

The report's error list is closed (`TIMEOUT`, `DNS`, `TLS`, `URL_REJECTED`, `TOO_LARGE`,
`HTTP_4XX`, `HTTP_5XX`, `REDIRECT_LIMIT`, `PARSE`), so every failure had to land on one of them:

| Failure | Code | Reason |
|---|---|---|
| socket timeout, whole-hop deadline, refused, reset, closed early, any other `OSError` without an HTTP status, a malformed status line or a broken body (`http.client.HTTPException`) | `TIMEOUT` | the brief maps every "no usable HTTP answer" to `TIMEOUT`; a broken status line is the same kind of failure for core (retry next hour) |
| `ssl.SSLError` / certificate errors | `TLS` | as specified; an `SSLError` raised after the deadline watchdog fired is `TIMEOUT` (the watchdog shut the socket) |
| `http.client.InvalidURL` or a `ValueError` building the connection | `URL_REJECTED` | the URL is not one the watcher can request |
| a 2xx with a `Content-Encoding` other than none/`identity`/`gzip`/`x-gzip` | `PARSE` | only gzip is advertised; a body in another encoding cannot be decoded |
| a truncated gzip stream (no end of stream) | `PARSE` | same as a corrupt stream |
| 300, 305, 306 or any 3xx not in {301, 302, 303, 307, 308} (304 excepted) | `REDIRECT_LIMIT` | "a 3xx without a usable `Location`": the watcher does not follow it |
| guard answered `ok` with no address | `URL_REJECTED` | nothing vetted to connect to |

`httpStatus` on a failure is the last HTTP status received (for example 308 on `REDIRECT_LIMIT`,
the 3xx before a redirect hop the guard rejected), else `null`.

## Other readings

- **robots.txt body of any media type.** "A 2xx is parsed" — a robots.txt is often served as
  `text/plain` but sometimes without a type or as `application/octet-stream`, which `fetch` would
  classify as `unsupported`. `fetch` gained one keyword with a default,
  `any_media_type: bool = False`, used only by `robots.py`, so a 2xx robots body is always read and
  parsed. A robots answer over 512 KiB (`TOO_LARGE`) or any other failure without a 5xx counts as
  allowed.
- **Feed base URL.** Relative feed links and html-headings anchors resolve against the target url
  (the fetch does not surface the final redirected URL, and the report keys observations by the
  target url).
- **NUL byte in an XML body ⇒ `PARSE`.** The DTD/entity refusal is a byte-level check; a UTF-16/32
  document could hide a `<!DOCTYPE` from it, so any body with a NUL byte is refused too. Feeds are
  UTF-8 in practice.
- **Slug is Unicode-aware.** "Runs of non-alphanumerics" uses Python's Unicode word classes
  (`[\W_]+`), so a heading in another script keeps its letters instead of becoming an empty slug.
- **`role="main"`** is compared trimmed and case-insensitively.
- **Repeated HTML attribute:** the first value wins (as in browsers), relevant for `id`/`role`.
- **Empty quote** is "present" (the empty string is a substring of any text); core only sends
  non-null quotes.
- **Page observations that are not `ok`** carry `missingQuoteCardIds: []` (the key is on every page
  observation; quotes can only be checked on fetched text).
- **`bytes`** is the decoded body length for `ok` and 0 for every other status.
- **Spacing and the budget.** The robots.txt request goes through the same per-host spacing as page
  requests. The budget is checked when a target's visit starts and again after the per-host wait,
  right before the page fetch; a target whose fetch did not start is not reported.
- **No observations ⇒ no report call.** When the budget or the 40 s floor stops the run before the
  first fetch, nothing is reported (the leases lapse and the targets are due next hour).
- **Settings ranges.** Besides the mandated `WATCH_MAX_TARGETS` 1..100, the other numbers accept:
  budget `0 < x < 900` s, HTTP timeout `0 < x ≤ 60` s, max bytes `0 < x ≤ 50 MiB`, host interval
  `0 ≤ x ≤ 60` s; outside ⇒ the default with one `warn` log naming the key.
- **Targets call budget.** The targets call uses the same budget rule as the report calls (remaining
  Lambda time minus 5 s).
- **Deploy script comment.** The header comment "both Python functions read their two SSM
  parameters at cold start" became "each Python function reads its SSM parameters at runtime"
  (allowed by the brief; the source watcher reads one parameter, with a TTL).
