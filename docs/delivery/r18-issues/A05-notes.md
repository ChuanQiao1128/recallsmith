# A05 — Source watch, server side: notes

Issue #410, wave `r18a-s`. Contract: A00 §0, §3, §4, §7 parts 2–3, §8.3, §8.4 rows 11–15, §8.6 (watch rows), §9.6,
§10.3–§10.7, §12.4, §12.6 step 8, §13 `source.changed`, §14 `source_watch`, §18, §20.2, §20.12, §20.16. Builds on A01
(migration 034, `AutomationEnv.SourceWatchSecretEnv`, `Auth.VerifyInternalSignatureStrict`, `AutomationMode`), A02
(`RunnerRoutes` helpers, `AutomationBody`), A03 and A04 (`Notifications.RaiseExceptionAsync`, `EmailTemplates`,
`AutomationTick.SourceEventsAsync`).

## What changed

| File | Change |
|---|---|
| `src_C/Vpc/Qa/QaRuns.cs` | `StartRunAsync` gains a trailing `string? profile = null`; null ⇒ the chunk message is serialised from exactly the old object (human runs byte-identical), non-null ⇒ the same keys with `"profile"` right after `promptVersion`. New `StartCardsRunAsync(conn, deckId, cardIds, requestedBySub, trigger, profile)` (A00 §9.6). |
| `src_C/Vpc/Automation/SourceWatchRoutes.cs` (new) | `HandleTargets`, `HandleReport`, `RetryWaitingRechecksAsync`. |
| `src_C/Vpc/Automation/WatchAdminRoutes.cs` (new) | `HandleWatch` (GET, A), `HandleTargets` (POST, SA), `HandleTarget` (PUT, SA). |
| `src_C/Vpc/Automation/AutomationTick.cs` | `SourceEventsAsync` first calls `SourceWatchRoutes.RetryWaitingRechecksAsync(conn, 20)` and adds the result to `rechecksStarted`. Nothing else. |
| `src_C/Vpc/VpcFunction.cs`, `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` | Brief changes 5 and 6, literals verbatim. |

Tests (new, `[Collection(PostgresCollection.Name)]`): `SourceWatchRoutesTests` (hosts the shared `A05Kit`),
`WatchAdminRoutesTests`, `SourceRecheckTests`. Every targets/report/admin/tick test runs against its own scratch
database migrated to the latest version (`PGDATABASE` switched and restored in `finally`); `StartCardsRunAsync` tests
use the shared database (every check there is per deck). No existing test file changed.

## `StartCardsRunAsync`

Shaped like `StartChangedRunAsync`: null when `AI_QA_ENABLED` is off; `CONFIG_ERROR` (no `AI_QA_QUEUE_URL`),
`FORBIDDEN` (empty requester), `VALIDATION_ERROR` (0 or > 200 ids, duplicates, or a card not live in the deck — the
`ValidationError` of `SelectCardsAsync` is caught), `DECK_NOT_FOUND`; then `queued` / `in_progress`
(`AI_QA_RUN_IN_PROGRESS`, the open run's id) / `not_started` with `AI_QA_TOO_MANY_CARDS`, `AI_QA_DAILY_CAP`,
`ENQUEUE_FAILED`; any exception ⇒ `SERVER_NOT_READY_AI_QA` (42P01) or `INTERNAL_ERROR`. Never throws. The run row is
`scope 'cards'`, `requested_by_sub 'automation'`; results come back through the existing card path of `AiQaResults`.

## `POST /api/internal/source-watch/targets`

Prologue: 405 for non-POST, strict HMAC on `INTERNAL_SECRET_SOURCE_WATCH` (no shared-secret fallback), body
`{ v: 1, watchRunId: uuid, max: 1..100 }` (all required) else 400 `VALIDATION_ERROR`, 503
`SERVER_NOT_READY_AUTOMATION` when `source_watch_targets`/`authoring_queue_items` are missing. Effective `off` ⇒
`targets: []`, nothing written. Otherwise one transaction: the §10.4 page sync verbatim, then one
`with due as (… for update skip locked) update … set leased_until = now() + 15 min` over the due rule of §10.4 (page
targets need a live citing card), returned in `last_checked_at nulls first, id` order; `quotes` for pages (≤ 50 by
card id), `[]` for feeds.

## `POST /api/internal/source-watch/report` — the state machine as implemented

The body is validated completely before any write (≤ 100 observations; `contentSha256` 64 lowercase hex and required
for `ok`; `fetchedAt` required ISO-8601; `errorCode` from the §10.5 list; `bytes`/`latencyMs` ≥ 0;
`missingQuoteCardIds` ≤ 200 integers; `feedItems` ≤ 200 objects with a string `url`). Effective `off` ⇒ 200 with zero
counts, nothing written. Otherwise one transaction; the reported target rows are locked `for update` (id order) and
each observation is applied in body order:

| Status | Target row (always: `last_checked_at = fetchedAt`, `last_http_status`, `etag`, `last_modified`, `leased_until = null`) | Event |
|---|---|---|
| `ok`, stored hash null or stored normaliser ≠ `v1` | `baseline`, hash + normaliser stored | `baseline`; feeds record every item with no queue item |
| `ok`, same hash | `unchanged` | none; feeds: newly seen matching items are queued with `source_event_id = null` |
| `ok`, new hash | `changed`, hash + normaliser, `last_changed_at = fetchedAt` | pages `changed` (+ re-check, queue items); feeds `feed_items` only when at least one item was queued |
| `not_modified` | `not_modified` | none |
| `gone` | `gone` | `gone` only when the previous `last_status` was not `gone`; pages: re-check + queue items + `source_gone` |
| `unsupported` | `unsupported` | `unsupported` only when the previous status was not `unsupported` |
| `robots_disallowed` | `robots_disallowed` | none |
| `failed` | `failed`, `consecutive_failures + 1` | `failing` exactly when the count reaches 3 (+ `watch_failing`) |

Every non-`failed` status resets `consecutive_failures` to 0 and records `recovered` when it was ≥ 3. An unknown
`targetId` is skipped (`watch_unknown_target` warn). `feedItems` on a page and `missingQuoteCardIds` on a feed are
ignored (warn).

**Feed items.** Items with a non-https or > 2048-char url are skipped (one warn with the count); `item_key` = lowercase
hex SHA-256 of the url; one `insert … select … from unnest(…) on conflict do nothing returning` with
`matched = pattern is null or coalesce(title, '') ~* pattern` evaluated by PostgreSQL. A stored pattern PostgreSQL
rejects (2201B, only possible if written outside the admin routes) is caught in a savepoint and matches nothing.
Each newly inserted matched item of a non-baseline observation becomes a `feed_item` queue item (`deck_id` = the
target's, `title`, `section_hint` = the title for `html-headings`, both cut at 300, dedupe
`feed_item:<targetId>:<item_key>`, `created_by 'watcher'`) and the feed item gets its `queue_item_id`.
`publishedAt` is stored when it parses as a timestamp, else null (never a 400: RSS dates vary).

**Pages changed or gone.** The citing cards are the live cards in live decks whose `source->>'url'` equals the target
url, grouped by deck. The event gets `recheck_state 'waiting'` (`'not_needed'` when nothing cites the page any more);
per deck one `source_changed` queue item (dedupe `source_changed:<targetId>:<newSha256 | gone>:<deckId>`, title
`Source changed`, note `missing quotes: <n>` with n = the reported missing-quote ids among that deck's citing cards);
`details = { citingCards, byDeck, missingQuoteCardIds (≤ 50), queueItemIds, recheckPendingDeckIds }`. No card is
read for writing: existing cards are never edited (decision 2).

**After the commit** (best effort, each step never fails the report): per page event and deck
`StartCardsRunAsync(conn, deckId, ≤ 200 citing card ids by id, "automation", "source_changed", "automation")`, then the
`source.changed` webhook (A00 §13 data), `source_gone` for a page `gone` event, `watch_failing` for a `failing` event
(its notification id is linked on the event; `source_changed` events keep `notification_id` free for the tick's
email), and the `source_watch` ledger row (skipped when no observation applied; units = `ok` + `not_modified`;
`failure` when every applied observation failed, `partial` when some did; dedupe
`watch:<watchRunId>:<first 16 hex of SHA-256 over the distinct reported target ids sorted numerically, joined by ",">`;
details `{ changed, gone, failed, feedItemsQueued }`; `source 'live'`, dry_run and live). Response
`{ watchRunId, applied, changed, queued, rechecks }` — `changed` counts `ok` observations with a new hash (pages and
feeds), `queued` every queue item inserted, `rechecks` the runs started.

## Re-check state aggregation

Per deck: `queued` ⇒ run id appended to `recheck_run_ids`, deck leaves `recheckPendingDeckIds`;
`in_progress`, `AI_QA_DAILY_CAP`, `ENQUEUE_FAILED`, `INTERNAL_ERROR` ⇒ the deck stays pending; null (QA disabled),
`CONFIG_ERROR`, `SERVER_NOT_READY_AI_QA` and every other code (`VALIDATION_ERROR`, `DECK_NOT_FOUND`,
`AI_QA_TOO_MANY_CARDS`, …), or a deck with no live citing card left ⇒ the deck is dropped. Then
`recheck_state = waiting` if a deck is pending, else `started` if any run id exists, else `unavailable`.

The tick (step 8, before A04's `started → done` and email handling) retries at most 20 `waiting` events, oldest
first, re-deriving the card ids; an event created more than 24 h ago drops its pending decks without a try
(`started` if it already has a run, else `unavailable`). A04's step then marks `started` events `done` when every
run is `done`/`failed` and emails `source_changed` for `done`/`unavailable` events.

## What the watcher (A08) must send

- Sign both calls with the §8.3 HMAC using `INTERNAL_SECRET_SOURCE_WATCH` (`-previous` retry on 401/403).
- `targets`: `{ "v": 1, "watchRunId": <uuid4>, "max": 1..100 }`; stop when `effectiveMode` is `off` or `targets` is empty.
- `report`: `{ "v": 1, "watchRunId", "observations": [...] }`, ≤ 100 per call, with the same `watchRunId`; each
  observation carries `targetId` and `url` from the targets response, `status`, `httpStatus`, `contentSha256`
  (required and lowercase for `ok`), `normalizer: "v1"`, `etag`/`lastModified` to store (they overwrite the stored
  values, so send the current ones on `not_modified`), `bytes`, `fetchedAt` (ISO-8601 with `Z` or an offset),
  `latencyMs`, `errorCode` from the §10.5 list, `missingQuoteCardIds` (pages; card ids from `quotes`), `feedItems`
  (feeds; `{ url, title, publishedAt }`, `html-headings` urls as `<page url>#<anchor>`, ≤ 200).
- A repeated report is safe: queue items, feed items and the ledger row are deduplicated; events for an unchanged
  state are not repeated.
- Unreported targets simply keep their 15-minute lease and are due again next hour.

## Console routes (A00 §8.6)

- `GET /api/v1/admin/automation/watch` — `kind` (`feed`|`page`), `active` (`true`|`false`), `limit` 1..100 (50),
  `cursor` (`Drafts` codec, id desc); `recentEvents` = the latest 50 events of every target; `citingCards` counts the
  live cards citing a page target (null for feeds); `queueItemIds` comes from the event's details.
- `POST …/watch/targets` — only `kind: "feed"`; checks in order: body (400), deck live (404 `DECK_NOT_FOUND`),
  pattern (`select '' ~* $1`, 2201B ⇒ 400 `WATCH_PATTERN_INVALID`), `on conflict (url) do nothing` (409
  `WATCH_TARGET_EXISTS`); `created_by 'owner:<sub>'`, interval default 360.
- `PUT …/watch/targets/:targetId` — any subset of `active`, `deckId` (null clears), `itemTitlePattern` (null clears),
  `checkIntervalMinutes`; unknown or non-numeric id ⇒ 404 `WATCH_TARGET_NOT_FOUND`; an empty body returns the target.
