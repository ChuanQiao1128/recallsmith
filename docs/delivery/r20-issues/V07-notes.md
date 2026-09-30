# V07 notes: change-impact watch (affected cards, FTS-matched cards per release note, email, status)

Issue #561, contract R20-00 §3 and §6. Zero model cost: every step is SQL (exact URL match and built-in
PostgreSQL full-text search). It works with `AI_QA_ENABLED=0` and never edits a card.

## What changed

| File | Change |
|---|---|
| `src_C/Vpc/Db/Migrations/039_source_watch_impact.sql` | New, additive: `alter table source_watch_feed_items add column if not exists possibly_affected_cards jsonb null`. `source_watch_feed_items` had no jsonb column; `source_watch_events.details` already is jsonb, so page impact needs no DDL. No extension. |
| `src_C/Vpc/Automation/ChangeImpact.cs` | New. `AffectedCardsAsync` (exact URL, live cards, cap 200), `PossiblyAffectedAsync` (full-text search, `MinFeedRank` 0.2, top 5), `RecordFeedItemsAsync` (after commit, best effort), `RecentFeedItemsAsync` (watch route), `DigestFeedItemsAsync` (digest), parsers, `EditUrl`. Records `AffectedCard`, `PossiblyAffectedCard`, `DigestFeedItem`. Missing column/table (42P01/42703) → skip with an `impact_not_migrated` log line. |
| `src_C/Vpc/Automation/SourceWatchRoutes.cs` | Page `changed`/`gone`: `details.affectedCards` and `details.needsHumanReview:false` written in the report transaction. The re-check update sets `needsHumanReview = (state = 'unavailable' and affectedCards is non-empty)`. This covers the report and the tick's retry/give-up. Feed: new matching items that are not a baseline are analysed after the commit. Feed items accept an optional `summary` string, capped at 2000 characters. It is used only as query text and is never stored or logged. |
| `src_C/Vpc/Automation/WatchAdminRoutes.cs` | `recentEvents[]` gains `affectedCards` (contract key order) and `needsHumanReview`; the response gains `recentFeedItems`. |
| `src_C/Vpc/Automation/StatusRoutes.cs` | `watch.needsReview`. |
| `src_C/Vpc/Automation/AutomationTick.cs` | Step 8 passes the event's affected cards and flag to the `source_changed` email. The digest loads the week's analysed feed items. |
| `src_C/Vpc/Automation/EmailTemplates.cs` | `SourceChangedData` gains `AffectedCards` and `NeedsHumanReview`. `WeeklyDigestData` gains `FeedItemsNew` and `FeedItems`. Both are optional with defaults. The new lines are described below. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ChangeImpactTests.cs` | New: 8 integration tests + 3 template tests. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/EmailTemplatesTests.cs` | Golden texts updated on purpose: the digest has one new DETAILS line, `Release notes: 0 new, 0 with possibly affected card(s)`, and the source email has one new DETAILS line, `Affected cards: 0 (needs human review: no)`. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/WatchAdminRoutesTests.cs` | Pinned event keys + response keys extended; a pre-V07 event reads `affectedCards: []`, `needsHumanReview: false`. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AutomationStatusRoutesTests.cs` | Status contract JSON gains `watch.needsReview`. |
| `docs/runbooks/automation-operations.md` | New section "Change impact of the source watch (R20 V07)". |

No env key, no new route, no Terraform change, and no webhook change (`source.changed` payload unchanged).

## API surface shipped

- `source_watch_events.details` (kind `changed`/`gone`) gains:
  - `affectedCards: [{cardId, deckId, deckSlug, stableUid, question, quoteMissing}]`. These are the cards with
    `c.source->>'url' = <target url>` where both card and deck are not deleted, ordered by card id, at most 200.
    `quoteMissing` means the id was in the report's `missingQuoteCardIds`.
  - `needsHumanReview: bool`. It is `true` when `affectedCards` is non-empty and the re-check state became
    `unavailable`: AI QA is off, every deck was dropped, or the tick gave up after 24 h. It is `false` while the
    state is `waiting`, and also when a run started or no card cites the page.
- `source_watch_feed_items.possibly_affected_cards` (039): `[{cardId, deckId, deckSlug, stableUid, question, rank}]`.
  It is set to `[]` when nothing qualifies, and to `null` when the item was not analysed: a baseline item, a
  pattern mismatch, or an item recorded before 039.
- `GET /api/v1/admin/automation/watch` (unchanged auth, `RequireAdmin`):
  - `recentEvents[]` gains `affectedCards` and `needsHumanReview`. Corrected in R20X F02: as shipped here the cards
    (deck slug, stable uid, question) of every deck went to every admin; they are deck-scoped data, so an admin who
    is not super_admin now sees only the cards of decks they may read, in `affectedCards`, in `details.affectedCards`
    and in `recentFeedItems[].possiblyAffectedCards` (contract §10.4).
  - The response gains `recentFeedItems: [{id, title, url, firstSeenAt, possiblyAffectedCards}]`. It holds the
    latest 20 analysed items, newest `firstSeenAt` first, and is `[]` before 039.
  - `id` is the string `"<targetId>:<itemKey>"`, because the table has a composite key and no id column.
- `GET /api/v1/admin/automation/status` → `watch.needsReview`: the count of `changed`/`gone` events from the last 30
  days whose `details.needsHumanReview` is true.
- `POST /api/internal/source-watch/report`: each `feedItems[]` entry may carry an optional `summary` (string or null).
- Email `source_changed`:
  - When a review is needed, the summary gains "The AI QA re-check is unavailable: N card(s) need a human review.".
    NEEDS YOU then lists up to 20 cards as `- <uid> (<deck>) — <question ≤120>[ (quote missing)] — <CONSOLE_BASE_URL>/decks/cards/edit?deckId=<id>&cardId=<id>`,
    followed by `- … and N more affected card(s) — <watch link>` if there are more.
  - Otherwise DETAILS lists the same lines, each prefixed with `Affected card `.
  - DETAILS always has the line `Affected cards: N (needs human review: yes|no)`.
- Weekly digest:
  - NEEDS YOU gets `- N release note(s) may affect existing cards — …?tab=watch` when N > 0.
  - DETAILS gets `Release notes: X new, N with possibly affected card(s)`.
  - Then up to 20 lines of the form `Release note <title> (<url>): possibly affects <uid> (<deck>, rank 0.70) — <edit link>, …`.
    X counts the items analysed that week.

### Full-text search and the minimum rank

Query: `replace(plainto_tsquery('english', <title + ' ' + summary>)::text, ' & ', ' | ')::tsquery` against
`to_tsvector('english', question || ' ' || coalesce(explanation, ''))`, `ts_rank_cd` (normalization 0), live cards
of the feed target's deck (all decks when the target has none), `round(rank, 4) >= 0.2`, order rank desc then
card id, limit 5.

- **Why OR:** `plainto_tsquery` ANDs every word. A release-note headline ("Amazon S3 now supports conditional
  writes") would then only match a card that contains every one of its words, which is almost never. The
  normalisation (stemming, stop words) still comes from `plainto_tsquery`. Only the operator changes, and a
  tsquery's text form never has a space inside a lexeme, so replacing ` & ` is exact.
- **Why 0.2:** with an OR query each occurrence of a query word is one cover worth 0.1 (weight D). Measured on
  PostgreSQL 16:
  - a single shared word ("amazon" once): 0.1
  - two hits: 0.2
  - the S3 bucket card against the headline above: 0.3
  - the conditional-writes card: 0.7

  So 0.2 is the lowest value that needs two hits. It drops one-generic-word matches and keeps cards on the topic.
  It is pinned as `ChangeImpact.MinFeedRank` and tested.

## How it is tested

`dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (pgvector/pg17 Testcontainers, scratch databases):

- `ChangeImpactTests.Report_PageChanged_StoresAffectedCardsByExactUrl`: exact URL match only. A card that is
  deleted, a card in a deleted deck, and a URL with `?variant=1` are all excluded. The test also checks id order,
  deck/slug/question, `quoteMissing`, `needsHumanReview` false with AI QA on (re-checks started), and that the
  cards are byte-identical afterwards.
- `…Report_AffectedCards_AreCappedAt200`: 205 citing cards give the first 200 by id; `citingCards` stays 205.
- `…Report_AiQaOff_FlagsHumanReview_AndTheEmailListsEditLinks`: the AI-QA-off path. The test checks the
  `unavailable` state, `needsHumanReview` true, and that no QA message is sent. The tick's `source_changed` email
  must hold both editor links and the "(quote missing)" marker. `status.watch.needsReview` must be 1. The watch
  route must show the event with contract-ordered card keys. Cards must be unchanged.
- `…Report_PageWithoutCitingCards_NeedsNoReview`.
- `…PossiblyAffected_RanksTheRelevantCardFirst_AndDropsBelowTheMinimumRank`: fixture cards
  (conditional writes, S3 bucket, DynamoDB TTL, a deleted card). The relevant card must rank first and every rank
  must be ≥ 0.2. A one-word overlap (0.1) is not returned. Stop-word and blank text return nothing, and the deck
  scope is honoured.
- `…Report_NewFeedItem_StoresPossiblyAffectedCards_AndTheWatchRouteListsIt`: the baseline item is not analysed.
  A new item with `summary` stores the relevant card first. An unrelated item stores `[]`. The test checks the
  `recentFeedItems` shape, then the digest job's email lines.
- `…BeforeMigration039_ReportAndWatchStillWork`: a scratch database at 038. The report still queues,
  `recentFeedItems` is `[]`, and the digest reports zero.
- `ChangeImpactEmailTests` (pure): at most 20 editor links plus the "… and 5 more" line under NEEDS YOU, the
  DETAILS placement when a re-check ran, and the digest's release-note lines.
- Existing tests updated as listed above; the whole suite passes (see the final run below).

Tests first: `ChangeImpactTests.cs` was written before the implementation and does not compile against the base
(`ChangeImpact`, `AffectedCard` and the new record fields do not exist there).

## Owner steps

1. After deploying the code, run `POST /api/v1/admin/db/migrate` (039) through `scripts/invoke-as-admin.sh`.
2. Optional: have the source watcher send a `summary` per feed item for better matches. No change is needed on
   the core side.

## Deferred

- The source watcher (`services/source-watcher`, outside this issue's scope) does not send `summary` yet, so the
  query is the item title only until it does. This contradicted the contract's "title + summary"; contract §10.4
  now records it as the documented behaviour (R20X F02).
- `needsHumanReview` has no "reviewed" action. The status count uses a 30-day window instead. A console action to
  clear it would need a route, which is out of scope here. So the count drops an unhandled event after 30 days and
  does not fall when someone fixes the cards; contract §10.4 accepts this for this round (R20X F02).
- The `source.changed` webhook payload does not carry the affected cards (that would change the A00 §13 payload
  contract).
- The console rendering is V10.

## Final test run (2026-10-01)

- `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (from `src_C`): 2807 passed, 0 failed, 0 skipped.
- `V07.verify.sh` with `BASE=delivery/r20-s`: `V07 VERIFY OK` (targeted filter: 30 passed).
- The docs path citations in this file and the runbook were checked against the `docsPaths.test.ts` rule: every
  cited path exists. vitest itself could not run, because this worktree has no `frontend/node_modules`.
