# F02 — R20 review fixes: server (V05–V08)

R20X fix round, wave s, issue #583. Base: `delivery/r20x-s` (release/r20 = main + the five R20 waves). Contract:
`R20-00-contracts.md` §1 and §10 (amendments after review). Each finding was checked against the code first; the
tests named below fail on the base (or do not compile against it, where they use a new seam) and pass after the fix.
All tests are in `src_C/Tests/RecallSmith.Lambda.IntegrationTests`.

Contract §10 items applied here: 1 (100 items), 2 (ensure vector objects on every migrate; exception handler around
`create extension`), 3 (reportable cards; captured question), 4 (deck-scoped cards in watch and usage; documented
30-day `needsReview`; documented title-only feed matching), 6 (`400 VALIDATION_ERROR` for invalid JSON on every new
route) and 8 (analytics step budget and `statement_timeout`).

### s-correctness-1

Status: fixed

Confirmed: `MaxItems = 200`, and `VpcFunction` answers `413 PAYLOAD_TOO_LARGE` for any body over 1,048,576 characters
before routing. A 384-dim full-precision vector as `json.dumps` writes it is about 8.5 KB, so 200 items are about
1.7 MB. Fix per contract §10.1: `CardEmbeddings.MaxItems = 100` (the error message, doc comment and 101-item rejection
follow the constant).

- Files: `src_C/Vpc/Authoring/CardEmbeddings.cs`.
- Test: `CardEmbeddingsTests.Embedding_Upsert_ContractMaxBatch_OfFullPrecisionVectors_FitsTheBodyCap` builds a body the
  way Python's `json.dumps` does (`", "`/`": "` separators, shortest round-trip floats of random L2-normalised
  vectors), asserts 100 items fit under the cap and 200 do not, and PUTs the 100-item body through the real
  `VpcFunction.Handler`: `200`, `upserted: 100`. `Embedding_Upsert_RejectsWrongModelDimNaNAndShape` now rejects
  `MaxItems + 1` = 101 items.

### s-correctness-2

Status: fixed

Confirmed: `HandleDbMigrate` applies only unrecorded versions, so once 038 was recorded with a NOTICE, installing
`vector` and migrating again never created `card_embeddings`. Fix per contract §10.2: `Migrate.EnsureVectorObjectsSql`
is 038's guarded table block (`if exists (… pg_extension … 'vector') then execute create table if not exists …`).
`HandleDbMigrate` runs it in its own transaction on every non-dry-run call once 038 is recorded or pending, also when
nothing is pending, clears the embeddings readiness cache, and answers an extra `vectorReady` field (true/false; null
before 038 exists). Without the extension it is a no-op; it can run any number of times. The owner step becomes
"CREATE EXTENSION vector as the master, then press Migrate"; no `schema_migrations` row is deleted.

- Files: `src_C/Vpc/Db/Migrate.cs`, `src_C/Vpc/Db/Migrations/038_card_embeddings.sql` (header),
  `docs/runbooks/automation-operations.md`, `docs/delivery/r20-issues/V06-notes.md`.
- Test: `CardEmbeddingsTests.Embedding_Migrate_ExtensionInstalledAfter038WasRecorded_NextMigrateCreatesTheTable`. A
  login role that owns a fresh database but is not a superuser runs the whole chain through `HandleDbMigrate`: 038 and
  040 are applied, 38 is recorded, no table, `vectorReady: false`; a second migrate without the extension is still a
  no-op. Then a superuser runs `CREATE EXTENSION vector`, and the next migrate (0 applied) answers `vectorReady: true`
  and `card_embeddings` exists with the contract's columns, owned by the app role; a third call is a no-op. The test
  also checks that the ensure SQL is literally 038's block (whitespace-normalised), so the two cannot drift.

### s-security-1

Status: fixed

Confirmed: `GET /api/v1/admin/automation/watch` checked only `RequireAdmin` and returned every deck's affected cards
(slug, stable uid, question) in `recentEvents[].affectedCards`, again inside `recentEvents[].details.affectedCards`,
and in `recentFeedItems[].possiblyAffectedCards`. Fix per contract §10.4: new `Helpers.ReadableDeckIdsAsync` (null for
super_admin, else the caller's `can_read = 1` decks). The watch route filters `affectedCards`, rewrites
`details.affectedCards` to the same filtered list (`ChangeImpact.WithAffectedCards`), and
`ChangeImpact.RecentFeedItemsAsync` filters `possiblyAffectedCards`. Events, targets and items stay listed (site-wide
watch configuration); the other `details` keys are counts and ids that predate V07 and are unchanged.

- Files: `src_C/Vpc/Authoring/Helpers.cs`, `src_C/Vpc/Automation/WatchAdminRoutes.cs`, `src_C/Vpc/Automation/ChangeImpact.cs`.
- Test: `ChangeImpactTests.WatchRoute_DeckScopedAdmin_SeesOnlyCardsOfReadableDecks`: cards in decks A and B cite a
  changed page, and a deck-less feed item matches a card in each. super_admin sees both; an editor with read on A only
  sees A's cards in all three places and the body contains none of B's question, slug or uid; an editor with no grant
  sees the events and items with no cards.

### s-tests-1

Status: fixed

Confirmed on the suite's image (pgvector 0.8.6, `vector.control` has no `trusted = true`): a role with CREATE on the
database but not a superuser passed the `has_database_privilege` guard and then failed with `permission denied to
create extension "vector"`, aborting 038 and so 039/040. Fix: the `create extension` in 038's first block is wrapped in
`begin … exception when insufficient_privilege or feature_not_supported or undefined_file then raise notice 'vector not
installed: … cannot create the extension …'; end;` (contract §10.2). The runbook and the V06 notes no longer say that
"no CREATE" is the only case that ends in a NOTICE.

- Files: `src_C/Vpc/Db/Migrations/038_card_embeddings.sql`, `docs/runbooks/automation-operations.md`,
  `docs/delivery/r20-issues/V06-notes.md`.
- Test: `CardEmbeddingsTests.Embedding_Migration038_RoleWithCreateButNotSuperuser_NoticeOnly_NoError`: a nologin,
  non-superuser role granted `create on database <scratch>` (has_database_privilege is asserted true) runs 038 twice:
  two "cannot create the extension" notices, no extension, no table, no error. The migrate test above covers the
  database-owner case end to end (038 recorded, 039 and 040 applied after it).

### s-correctness-3

Status: declined

Real as described, but accepted into the contract instead of changed: contract §10.4 fixes `watch.needsReview` as
"events of the last 30 days with needsHumanReview (documented; no clear action this round)". A reviewed marker would
need a new write route and a console action, which are outside this round. The behaviour and its two consequences
(an unhandled event drops out after 30 days; fixing the cards does not lower the count) are now written down.

- Files: `src_C/Vpc/Automation/StatusRoutes.cs` (comment), `docs/runbooks/automation-operations.md`,
  `docs/delivery/r20-issues/V07-notes.md`.
- Test: unchanged behaviour, covered by the existing `ChangeImpactTests.Report_AiQaOff_FlagsHumanReview_AndTheEmailListsEditLinks`
  (`status.watch.needsReview == 1`).

### s-correctness-4

Status: partially fixed

Confirmed: `services/source-watcher/src/source_watcher/feeds.py` sends feed items as `{url, title, publishedAt}` with
no `summary`, so production matching uses the title alone. Changing the watcher is outside this issue's scope
(`services/` is not in scope), so the contract was amended instead (§10.4: "the current watcher sends titles only
(documented)"). The server keeps accepting an optional `summary`. Code comment, runbook and V07 notes now say
"title only until the watcher sends a summary".

- Files: `src_C/Vpc/Automation/SourceWatchRoutes.cs` (comment), `docs/runbooks/automation-operations.md`,
  `docs/delivery/r20-issues/V07-notes.md`.
- Test: `ChangeImpactTests.WatchRoute_DeckScopedAdmin_SeesOnlyCardsOfReadableDecks` reports its feed item in the
  watcher's real shape (`A05Kit.Item`: url, title, publishedAt, no summary) and asserts the title alone lists the
  relevant card in each deck. Follow-up (not in scope): send a capped summary from the watcher.

### s-correctness-5

Status: fixed

Confirmed: `HandleUpsert` answered a body that is not JSON (including Python's bare `NaN`) with `400 BAD_REQUEST`,
while the contract says `400 VALIDATION_ERROR` and the V05 routes already did so. Fix per contract §10.6:
`res.BadRequest("VALIDATION_ERROR", "Invalid JSON body")`. The other new R20 routes that read a body (card reports
POST and resolve) already answered `VALIDATION_ERROR`; the new GET routes read no body.

- Files: `src_C/Vpc/Authoring/CardEmbeddings.cs`.
- Test: `CardEmbeddingsTests.Embedding_Upsert_RejectsWrongModelDimNaNAndShape` now asserts `400 VALIDATION_ERROR` for
  the bare `NaN` literal (it asserted only the status before).

### s-security-2

Status: fixed

Confirmed: `CreateAsync` found the card by slug, uid and `is_deleted` only, and `ListOwnAsync` returned
`left(c.question, 200)` from the live `cards` row. Fix per contract §10.3: the lookup also requires
`d.availability = 'live'` and either `d.tier = 'free'` or an active `user_premium_state` row for the learner (the
premium download gate's rule: `expires_at_ms` in the future, or `premium_active` when there is no expiry; sandbox
refused when `DISALLOW_SANDBOX_PREMIUM` is set). Anything else is the same `404 CARD_NOT_FOUND` as an unknown card. New
migration `041_card_reports_question.sql` adds a nullable `card_reports.question` (≤ 200, CHECK); the POST stores the
first 200 characters at report time and the learner GET returns that column (null for reports made before 041), never
the live row. The console list still joins the live row (admins with deck read may see the working copy). Between the
code deploy and 041 the learner routes answer `503 NOT_READY` (42703), per contract §3.

- Files: `src_C/Vpc/Reports/CardReports.cs`, `src_C/Vpc/Db/Migrations/041_card_reports_question.sql`,
  `docs/runbooks/automation-operations.md`, `docs/delivery/r20-issues/V05-notes.md`.
- Tests: `CardReportsTests.CardReport_Post_OnlyCardsTheLearnerCanSee` (coming, retired, premium without entitlement,
  premium with an expired one → 404 and nothing stored; active entitlement → 200) and
  `CardReportsTests.CardReport_GetMine_ReturnsTheQuestionCapturedAtReportTime_NotTheWorkingCopy` (an edit after the
  report never reaches the learner; a pre-041 row answers null).

### s-security-3

Status: fixed

Confirmed: `decks[]` of `GET /api/v1/admin/analytics/usage` listed every deck's slug and learner counts for any admin.
Fix per contract §10.4: for a caller who is not super_admin the deck query keeps only slugs of decks in the caller's
`can_read = 1` grants (`Helpers.ReadableDeckIdsAsync`); `days[]` stays site-wide.

- Files: `src_C/Vpc/Analytics/UsageAnalytics.cs`.
- Tests: `UsageAnalyticsTests.Usage_Route_DeckScopedAdmin_SeesOnlyReadableDecks_AndEveryDay` (super_admin: x and y;
  editor with read on x: x only, identical `days`; editor without grants: no decks). The existing
  `Usage_Route_ReturnsDaysDecksAndExclusionCount` called the route as an ungranted editor and expected every deck; it
  now calls it as super_admin.

### s-security-4

Status: fixed

Same root cause as s-tests-1: the `has_database_privilege(…, 'CREATE')` guard is not enough for an untrusted
extension, and an allow-list refusal (`feature_not_supported`) or missing control file (`undefined_file`) also
aborted the migration transaction. The exception handler in 038 covers all three (contract §10.2 names exactly these
three conditions, so `others` is deliberately not caught: an unexpected error should still stop the migration).

- Files: `src_C/Vpc/Db/Migrations/038_card_embeddings.sql`.
- Tests: `CardEmbeddingsTests.Embedding_Migration038_RoleWithCreateButNotSuperuser_NoticeOnly_NoError` and
  `CardEmbeddingsTests.Embedding_Migrate_ExtensionInstalledAfter038WasRecorded_NextMigrateCreatesTheTable` (039 and
  040 apply after 038 for a database-owner role). `feature_not_supported` and `undefined_file` cannot be produced on
  the test image (pgvector is installed and not allow-listed away); they share the same handler.

### s-tests-2

Status: fixed

Confirmed: the only vector-engine test used axis 30, which no other stored vector touched, and sent no
`excludeCardIds`, so dropping the scope clause from `FindSimilarAsync` would not fail it. The code was correct; the
test was extended so it would catch that mutation.

- Files: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardEmbeddingsTests.cs`.
- Test: `CardEmbeddingsTests.Embedding_Similar_WithEmbedding_UsesVectorEngine_WithoutKeepsTrigram` now stores a
  `Vec(30)` embedding on a card of a second deck: it is listed at 1.0 without a deck, alone for the second deck, and
  absent from the first deck's answer. With `excludeCardIds: [same]` the matches are exactly `[near, mid]`.

### x-deploy-1

Status: partially fixed

Confirmed: `analytics_daily` is the last tick step, `Spent()` is checked only before a step starts, both rollup
statements scan the whole review history under Npgsql's default 30 s command timeout, and a failed run left the step
due for the next tick. Fix per contract §10.8:

- `AutomationTick` passes the remaining budget; `UsageAnalytics.RunIfDueAsync` answers `Deferred` (log
  `analytics_deferred`) when less than half of the 20 s budget remains, so the next tick runs it.
- `ComputeAsync` runs `set local statement_timeout = 3000` (`UsageAnalytics.StatementTimeout`, 3 s per statement,
  three statements) inside its transaction, so a slow rollup fails fast with 57014 and rolls back.
- After a failure the Lambda container remembers the UTC day and answers `BackedOff` (log `analytics_backoff`) until
  the next UTC day instead of rerunning on each tick; the failure is still thrown once so `AutomationStepFailures`
  counts it.

Partial because the backoff is per Lambda container (in memory), not durable: a cold container may try once more the
same day. A durable failure marker would need a new table or column; the in-container marker plus the 3 s timeout
already caps the cost at a few seconds per container per day. The suggested index on
`user_progress_events(event_type, event_time)` was not added: the rollup needs every review ever made (first-review
dates), so an index on the event type would not avoid the full scan.

- Files: `src_C/Vpc/Analytics/UsageAnalytics.cs`, `src_C/Vpc/Automation/AutomationTick.cs`,
  `docs/runbooks/automation-operations.md`, `docs/delivery/r20-issues/V08-notes.md`.
- Tests: `UsageAnalyticsTests.Analytics_Step_DefersWhenLessThanHalfTheTickBudgetRemains` (9.9 s of 20 s left →
  `Deferred`, nothing written; 10 s → `Computed`) and
  `UsageAnalyticsTests.Analytics_Step_StatementTimeout_FailsOnce_ThenBacksOffUntilTheNextUtcDay` (a table lock makes
  the rollup wait; the 300 ms `statement_timeout` cancels it with 57014, nothing is written, the connection's own
  setting is untouched; the same UTC day answers `BackedOff`; the next UTC day computes all 8 days).

### x-deploy-2

Status: fixed

Confirmed: `pgvector/pgvector:pg17` is a floating tag under a comment that says "Pinned, not floating". It is now
`pgvector/pgvector@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f`, the multi-arch index
digest of `pgvector/pgvector:0.8.6-pg17`, which is pgvector 0.8.6 on PostgreSQL 17.11 (the same image the floating
tag named on 2026-10-01, so no test changes behaviour). Testcontainers cannot parse `tag@digest`, so the tag is in
the comment next to the digest.

Prod: RDS PostgreSQL 17.9 (`infra/modules/data/rds.tf`). Which pgvector version RDS offers on 17.9 is **unverified**
here (this worker has no AWS access). Check it as the master with
`select default_version from pg_available_extensions where name = 'vector';` and bump the test image deliberately if
it differs. The suite also runs PostgreSQL 17.11 against prod's 17.9; no exact 17.9 + pgvector image was pinned
because the matching pgvector version is not known.

- Files: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs`, `docs/delivery/r20-issues/V06-notes.md`.
- Test: the whole integration suite runs on the pinned digest (see the test run below).

## Owner steps (changed)

1. §9 step 1 becomes: `CREATE EXTENSION vector` as the RDS master, then press Migrate
   (`POST /api/v1/admin/db/migrate`); the response shows `vectorReady: true`. No `schema_migrations` delete.
2. After deploying this code, press Migrate once for `041_card_reports_question.sql`; until then the learner card
   report routes answer `503 NOT_READY`.
3. Optional: check the pgvector version prod offers (query above) and record it next to the pinned test image.

## Test run

See the report at the end of the worker run; the full integration suite and `F02.verify.sh` were run on the final
commit.
