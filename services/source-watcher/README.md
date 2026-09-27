# developercards-source-watcher

Python 3.12 (arm64) Lambda `developercards-source-watcher`, handler
`source_watcher.handler.lambda_handler`. It is the trigger half of the automation flow
(contract A00 §4, §10): once an hour it asks core-vpc which watched URLs are due, fetches each one
politely, normalises the text deterministically (`v1`), hashes it, checks which cited quotes are
still present, extracts feed items and reports every observation back to core.

What it does **not** do:

- **No model.** It never calls a model, in any form.
- **No state.** Everything lives in core Postgres; the function keeps nothing between invocations
  beyond the per-container secret cache.
- **No decisions.** Core decides whether a hash is a change, what gets queued, re-checked, emailed
  or written to the ledger. The watcher's status only says what it fetched. It never edits a card.

The runtime has no third-party dependency (`dependencies = []`): stdlib only, `boto3` comes from
the Lambda runtime and is imported lazily for the one SSM read.

## One invocation (A00 §10.3)

1. Only the event `{"job": "source-watch"}` is acted on; anything else is logged
   (`ignored_event`, no content) and answered `{"watchRunId": null, "checked": 0, "changed": 0, "failed": 0}`.
2. Load the internal secret from SSM (`INTERNAL_SECRET_SSM_NAME`). Missing or unset ⇒ log
   `internal_secret_missing` and **raise**, so `AWS/Lambda Errors` counts it (A10's
   `source_watcher_errors` alarm).
3. `watchRunId = uuid4()`; `POST /api/internal/source-watch/targets`
   `{"v": 1, "watchRunId", "max": WATCH_MAX_TARGETS}`. A failed call ⇒ log `targets_failed` and
   raise. `effectiveMode == "off"` or no targets ⇒ return zeros. The watcher never reads
   `AUTOMATION_MODE`; it obeys this answer. Each target is validated; an invalid one is skipped
   with a `warn` log.
4. Group targets by lowercased host and visit hosts round-robin (host A's first target, host B's
   first, …, then A's second, …). Consecutive requests to one host (robots.txt included) start at
   least `WATCH_HOST_INTERVAL_SECONDS` apart. No new fetch starts once
   `WATCH_TIME_BUDGET_SECONDS` have passed since the invocation began or once the Lambda has less
   than 40 s left. Unvisited targets are simply not reported; their lease lapses and they are due
   again next hour.
5. Per target: robots.txt (disallowed ⇒ `robots_disallowed`, nothing fetched), then a conditional
   GET with the stored `etag`/`lastModified`, then normalise and hash (pages, html-headings) or
   parse the feed (rss, atom).
6. `POST /api/internal/source-watch/report` `{"v": 1, "watchRunId", "observations"}` in batches of
   at most `REPORT_BATCH_SIZE = 100`, each with the remaining Lambda time minus 5 s as its budget.
   A batch is posted **as soon as it is full** (during the loop), the rest after the loop, so a run
   killed later (timeout, OOM) has already reported every full batch (C03).
   A failed batch ⇒ `SourceWatchReportFailures` and a `report_failed` log; after all batches the
   invocation raises if any batch failed.
7. Returns `{"watchRunId", "checked", "changed", "failed"}` (`changed` = the sum of the report
   answers' `data.changed`).

### Observation (A00 §10.5)

`targetId`, `url` (the target's url, never a redirected one), `status` (`ok` | `not_modified` |
`failed` | `gone` | `unsupported` | `robots_disallowed`), `httpStatus`, `contentSha256` (64
lowercase hex for `ok`, else `null`), `normalizer` (`"v1"`), `etag`, `lastModified` (the response's,
else the stored ones for `not_modified`, else `null`), `bytes`, `fetchedAt`
(`YYYY-MM-DDTHH:MM:SS.mmmZ`, when the request was sent), `latencyMs`, `errorCode`. Page observations
always carry `missingQuoteCardIds` (possibly empty, at most 50 ids); feed observations with status
`ok` carry `feedItems` (at most the first 200, `{url, title, publishedAt}`).

Error codes (closed list): `TIMEOUT`, `DNS`, `TLS`, `URL_REJECTED`, `TOO_LARGE`, `HTTP_4XX`,
`HTTP_5XX`, `REDIRECT_LIMIT`, `PARSE`.

## Schedule

EventBridge Scheduler `developercards-source-watch` (created by A10): `rate(1 hour)`, target the
alias `developercards-source-watcher:prod`, input `{"job":"source-watch"}`, no retries (the next
hour covers). It is created **DISABLED**; the supervisor enables it after the code deploy (A00
§19.2 step 6). **Disabling the schedule is the watcher's emergency stop.**

## Internal routes and HMAC

Both routes are served by core-vpc and verified with `Auth.VerifyInternalSignatureStrict` against
`INTERNAL_SECRET_SOURCE_WATCH` (+`_PREVIOUS`):

- `POST /api/internal/source-watch/targets`
- `POST /api/internal/source-watch/report`

Every request is signed over the canonical body (`json.dumps(…, separators=(",", ":"),
ensure_ascii=True, sort_keys=True)`): header `x-internal-timestamp` (epoch milliseconds) and
`x-internal-signature: v1=<lowercase hex HMAC-SHA256(secret, "<ts>.<body>")>`. Test vector:
`test-secret`, `1790000000000`, `{"a":1}` ⇒
`v1=4ff7aae81c904927786fb5dc89854a13823626f7f1fd6692d046db073616bb85`.

Retries: a connection error, 5xx and 429 are retried once while the budget allows. Answers are the
standard envelope `{"success", "data", "error", "traceId", "version"}`; 403 is a bad signature, 503
`SERVER_NOT_READY_AUTOMATION` means migration 034 has not run.

Secret: SSM `/developercards/prod/source-watch-secret` (created as a placeholder by A10, set by the
supervisor). The value `PLACEHOLDER-set-by-supervisor` and a blank value count as unset and are
never cached. A loaded value is cached for 300 s, so a rotation reaches every warm container within
five minutes. Rotation: `/developercards/prod/source-watch-secret-previous` exists only during a
rotation; it is read only when core answers 401/403, and the same request is then sent once more
signed with it. Only `ParameterNotFound` counts as "no previous secret"; any other read error is
logged with its error class only and never cached.

## Politeness and limits (A00 §10.7)

| Setting (`env/prod.env.json`) | Value | Meaning |
|---|---|---|
| `WATCH_MAX_TARGETS` | 60 | targets asked for per run (clamped to 1..100) |
| `WATCH_TIME_BUDGET_SECONDS` | 240 | no new fetch after this |
| `WATCH_HTTP_TIMEOUT_SECONDS` | 10 | whole-hop deadline (connect, headers and body) |
| `WATCH_MAX_BYTES` | 5242880 | body cap, raw and decoded (`TOO_LARGE`) |
| `WATCH_HOST_INTERVAL_SECONDS` | 1 | spacing between requests to one host |
| `WATCH_USER_AGENT` | `DeveloperCards-SourceWatch/1.0 (+https://developercards.app)` | sent on every request |

An unparsable or out-of-range number falls back to its default with one `warn` log (the key name
only). The function runs with reserved concurrency 1, a 300 s timeout and 512 MB (A10).

- **robots.txt** once per host per run (`<scheme>://<host>[:port]/robots.txt`, 10 s, at most
  512 KiB, redirects allowed, no conditional headers): a 2xx is parsed with `urllib.robotparser`
  and answered for the user-agent token `DeveloperCards-SourceWatch` (that group, else `*`);
  4xx, a guard rejection, DNS, TLS, a timeout or any other failure ⇒ allowed; 5xx ⇒ the whole
  host is disallowed for this run.
- **Conditional GET:** `If-None-Match` / `If-Modified-Since` from the stored validators (first
  hop only), `Accept-Encoding: gzip` (decoded incrementally, so a small compressed body cannot
  inflate past the cap).
- **Redirects:** 301, 302, 303, 307, 308 with a `Location`, resolved against the current URL and
  re-guarded, at most 3; a 4th, a redirect without a usable `Location` or any other 3xx ⇒
  `REDIRECT_LIMIT`.
- **Classification:** 304 ⇒ `not_modified`; 404, 410 ⇒ `gone`; other 4xx ⇒ `HTTP_4XX`; 5xx ⇒
  `HTTP_5XX`; 2xx with `text/html`, `application/xhtml+xml`, `text/plain`, `application/rss+xml`,
  `application/atom+xml`, `application/xml` or `text/xml` ⇒ `ok`; any other or missing media type
  (PDF included) ⇒ `unsupported`.

## SSRF guard and address pinning

`urlguard.check_url` is a copy of the webhook dispatcher's guard: `https` only, no userinfo, not
`localhost`/`*.localhost`, IP literals and **every** resolved address must be public
(`ipaddress.is_global`, IPv4-mapped IPv6 unwrapped). Every hop (including each redirect and the
robots.txt request) is guarded; a rejection is `URL_REJECTED`, a lookup failure `DNS`. The
connection then goes to the first vetted address while Host, SNI and the certificate check use the
URL's host, so DNS rebinding between the check and the connect cannot point the request somewhere
else. (A plain-HTTP twin of the pinned connection exists only for the loopback tests; the guard
never lets `http` through.)

## Normalisation `v1`

`normalize.py`, constant `NORMALIZER = "v1"`. **This section is the specification: any change to
the output for some input is a new version `v2`** (core treats a stored hash with another
normaliser as a new baseline, not a change).

- **Decoding (HTML/XML):** charset from the `Content-Type` parameter, else a `<meta charset=…>` or
  `<meta http-equiv="Content-Type" content="…charset=…">` in the first 4096 bytes, else UTF-8;
  decoded with `errors="replace"`; an unknown codec name, or one whose Python codec is not a WHATWG
  text encoding (`normalize.ALLOWED_CODECS`: UTF-8/16, ASCII, ISO-8859-x, windows-125x, windows-874,
  KOI8-R/U, IBM866, macintosh, Shift_JIS, EUC-JP, ISO-2022-JP, EUC-KR, GB2312/GBK/GB18030, Big5),
  means UTF-8. So a page cannot pick `punycode`, `idna`, `utf-7` and the like (quadratic or raising
  decoders; C03). `text/plain` uses the
  `Content-Type` charset, else UTF-8 (no `<meta>` sniffing).
- **HTML tree:** stdlib `html.parser.HTMLParser` (`convert_charrefs=True`) builds a minimal
  element tree. The void elements `area, base, br, col, embed, hr, img, input, link, meta, source,
  track, wbr` never open a scope; an end tag closes the nearest open element with that name (and
  everything opened inside it); an unmatched end tag is ignored. For a repeated attribute the first
  value wins.
- **Bounded work (C03).** The end-tag search looks at the `END_TAG_SEARCH_DEPTH = 64` innermost
  open elements only (an opener further up counts as unmatched); beyond `MAX_OPEN_DEPTH = 512` open
  elements a start tag is appended to the innermost one without opening a scope. Both only change
  the tree of pages no real site serves, so the version stays `v1`, and parsing is linear in the
  page size. A page with more than `MAX_ELEMENTS = 200 000` elements, or whose parse takes more
  than `PARSE_TIME_BUDGET_SECONDS = 20`, raises `ParseLimitExceeded`: the observation is `failed` /
  `PARSE` (log `parse_limit` with `targetId`, `host`, `limit`) and the run continues.
- **Dropped subtrees:** `script, style, noscript, template, svg, nav, header, footer, aside, form,
  iframe, button` (removed before the content root is chosen).
- **Content root:** the first `main`, else the first `article`, else the first element whose
  `role` attribute is `main` (trimmed, case-insensitive), else `body`, else the whole document.
- **Text:** the text of the content root, with a line break at the start and at the end of every
  `p, div, section, li, ul, ol, table, tr, td, th, h1, h2, h3, h4, h5, h6, pre, br, dd, dt,
  blockquote`.
- **Lines** (`normalize_lines`, also used alone for `text/plain`):
  `unicodedata.normalize("NFKC", …)`, U+00A0 → space, split on line breaks (`str.splitlines`),
  every whitespace run within a line → one space, lines trimmed, empty lines dropped, joined with
  `"\n"`.
- **Hash:** lowercase hex SHA-256 of the UTF-8 bytes of the normalised text.
- **Quote presence (pages):** the quote passed through the line normalisation with its line breaks
  turned into spaces must be a case-sensitive substring of the normalised text with `"\n"` replaced
  by a space (the MCP grounding rule, `tools/mcp-server/README.md`). A missing quote puts its card
  id in `missingQuoteCardIds`.
- XML media types on a **page** target are normalised as HTML too.

## Feeds

- **XML safety:** a body containing `<!DOCTYPE` or `<!ENTITY` (case-insensitive) is refused as
  `PARSE` before parsing (feeds need no DTD; this blocks entity expansion), and so is a body with a
  NUL byte (UTF-16/32, which the byte-level check could not read). Parsed with
  `xml.etree.ElementTree.fromstring`; a parse error is `PARSE`.
- **RSS** (`feedFormat: rss`): every element whose local name is `item`; the first `link` child
  with text, `title`, `pubDate` (RFC 822, via `email.utils.parsedate_to_datetime`) → UTC
  `YYYY-MM-DDTHH:MM:SSZ`, unparsable ⇒ `null`.
- **Atom** (`feedFormat: atom`): `entry` elements in the Atom namespace; the `link` with
  `rel="alternate"` or no `rel`, else the first `link`'s `href`; `title`; `updated`, else
  `published` (ISO 8601) → UTC `…Z` when parseable, else `null`.
- **html-headings** (`feedFormat: html-headings`): the page hash is the normalised page (above);
  items are every `h2`/`h3` inside the content root, url `<page url without fragment>#<id
  attribute, else slug>`, where the slug is the lowercased heading text with runs of
  non-alphanumerics (Unicode-aware) replaced by `-` and leading/trailing `-` trimmed (an empty slug
  skips the heading); title = the heading text with whitespace collapsed; `publishedAt` is `null`.
- **All formats:** links resolved with `urljoin(<target url>, link)` and stripped; items whose url
  is not `https://` or is longer than 2048 characters are dropped; titles collapsed and cut to 300
  characters; for a repeated url the first item wins; at most the first 200 items (document order)
  are reported.
- **Feed hash** (rss/atom) = SHA-256 of the sorted distinct item urls joined with `"\n"`:
  reordering or description edits are not changes.

## Logs and metrics

JSON lines on stdout (`logs.log`, tag `source-watcher`, filtered by `LOG_LEVEL`). One `info` line
`observe_start` (`targetId`, `host`, `kind`) before any robots/fetch/parse work on a target, so a
target that stops a run is always named in the log. One `info` line
per observation with `watchRunId`, `targetId`, `host`, `status`, `httpStatus`, `errorCode`,
`bytes`, `latencyMs`. Logs never carry page text, quotes, query strings, bodies, secrets or
signatures.

EMF (namespace `METRICS_NAMESPACE`, `Service = "source-watcher"`):

| Metric | Unit | Dimensions |
|---|---|---|
| `SourceWatchChecks` | Count | `Service`, `Outcome` (= the observation status) |
| `SourceWatchLatency` | Milliseconds | `Service` (only when a request was sent) |
| `SourceWatchReportFailures` | Count | `Service` |

## boto3 pin

`boto3==1.43.103` in the `dev` dependency group only (tests; never bundled). Pinned on 2026-09-28
to the version the other two Python packages (`services/webhook-dispatcher`, `services/ai-qa`) pin,
resolved by `uv` on 2026-09-27: the exact boto3 build of the Lambda `python3.12` runtime could not
be confirmed offline, and the code uses only `ssm.get_parameter`, which is stable across versions.

## Local tests

```bash
cd services/source-watcher
uv lock --check && uv run --python 3.12 pytest -q
```

The tests never touch the network except loopback servers on 127.0.0.1 (a fake site and a fake
core that verifies the HMAC like `Auth.cs`); resolvers, fetchers, clocks and sleeps are injected.
The fixtures under `tests/fixtures/` are original text.

## Supervisor-only operations

Nothing here is deployed by a worker. The function itself is created by A10's Terraform apply with
placeholder code; at release (A00 §19.2 step 5) the supervisor deploys the code with
`services/deploy-python-lambda.sh source-watcher` (a worker only ever runs
`DRY_RUN=1 bash services/deploy-python-lambda.sh source-watcher`, which builds and prints the env
key names without calling `aws`), sets the SSM secret, and then enables the schedule
`developercards-source-watch` (A00 §19.2 step 6). The first hour records a `baseline` for the
seeded feeds.
