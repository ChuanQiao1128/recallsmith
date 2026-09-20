# C10 — MCQ P1c ingest: outbox payload `card_format` (`mcq-ingest-card-format`)

Tag every `analytics_event_outbox` payload the ingest writes with `card_format` (`'mcq'` when the reviewed card's `cards.mcq` is non-null, else `'qa'`) by joining `decks`/`cards` inside the existing outbox CTE of `src_C/Vpc/Runtime/ProgressEvents.cs`, keep the ingest ONE statement on a migrated database, and fall back to today's statement when Postgres answers `42703` (the `mcq` column is not there yet because migration 019 has not run). Root: `src_C`. Deps: C08 (which created `019_cards_mcq.sql`; C05's `018_cards_topic.sql` is below it). One edited file, one new test class. No migration, no new `eventType`, no `schemaVersion` bump, no client change, no Snowflake change (C13 reads the key; C14 appends two more keys after it).

## Context

What the tree looks like today (`delivery/r16-c-economy` == `main@52594fe`, plus C05 and C08 merged before you start — every line number below was read on the base on 2026-09-21; C05/C08 do not touch `ProgressEvents.cs` or the tests project files named here, so these numbers hold on your worktree):

- `src_C/Vpc/Runtime/ProgressEvents.cs` (765 lines) `HandleProgressEvents` (`:72`): envelope parsing `:95-97`, per-event normalisation into `NormalizedEvent` (`:20-38`), statement assembly `:246-365` (`values` `:288-341`, `stageRows` `:354-362`, `userHashParam` `:364-365` — the last parameter bound before the SQL string; C14 later appends two more after it). The whole ingest is one interpolated raw string `var sql = $"""` at `:367` … `""";` at `:584`, executed exactly once at `:595` (`var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);`) with no transaction; `catch … when (ex is ValidationError)` at `:636`, everything else `res.Error500(ex)` at `:640-643`. `using Npgsql;` is already at `:8`, `using RecallSmith.Lambda.Common;` (for `Log`) at `:9`, `using System.Text.Json;` at `:5`. No `42703` handling exists in this file today.
- The outbox CTE is `:399-447`. Its select (`:403-443`) reads unqualified columns of `ins` (the RETURNING of the event insert, `:390-397`), builds the payload with `jsonb_strip_nulls(jsonb_build_object(` (`:408`), and today ends with `'deck_version', deck_version` (`:442`), `))` (`:443`), `from ins` (`:444`), `on conflict (event_id) do nothing` (`:445`). The 22 payload keys are `event_id, schema_version, event_type, user_id_hash, deck_slug, card_stable_uid, card_revision, stated_difficulty, rating, rating_value, response_score, session_id, review_stage, review_count_for_card, dwell_time_ms, client_event_ts, server_received_ts, device_id, platform, app_version, offline_queue_delay_ms, deck_version`. `stable_uid` is read unqualified twice: `deck_slug || ':' || stable_uid,` (`:407`, the `aggregate_id`) and `'card_stable_uid', stable_uid,` (`:414`).
- The join to mirror is `src_C/Vpc/Authoring/ContentIntelligence.cs:131-136` (`left join decks d on d.slug = e.deck_slug and d.is_deleted = 0` / `left join cards c on c.deck_id = d.id and c.stable_uid = e.stable_uid and c.is_deleted = 0`). `cards` has `constraint uq_cards_deck_uid unique (deck_id, stable_uid)` (`src_C/Vpc/Db/Migrations/001_init.sql:52`) and `decks.slug` is `unique` (`:20`), so the join yields at most one `cards` row per event — no fan-out, one outbox row per event stays true. `cards` also has a column named `stable_uid` (`:39`), which is the one name the outbox select shares with the joined table (the other `cards`/`decks` columns — `id, version, is_deleted, created_at, updated_at, revision, …` — are never referenced unqualified in that select).
- **Verified on postgres:16-alpine with migrations 001–017 applied (2026-09-21):** adding the join while leaving `stable_uid` unqualified fails with `column reference "stable_uid" is ambiguous` (SqlState `42702`) — so C00 §2.10's "nothing else moves" is amended here: the two `stable_uid` references become `ins.stable_uid` (§ Changes 1c). Running the joined statement against a database without `cards.mcq` fails with `column c.mcq does not exist` (SqlState `42703`) and writes nothing (the whole statement is rolled back — one statement, no shell), so re-running the legacy text afterwards is safe. With the column present, three events for a Q/A card, an MCQ card and a card that has no row tag `qa` / `mcq` / `qa`; a deleted MCQ card and a deleted deck both tag `qa`; the same `stable_uid` living in a second deck does not leak its format into the first deck's event.
- The 42703 precedent in this codebase: `src_C/Vpc/Authoring/ManifestRebuild.cs:153-189` (try the v3 column list, `catch (PostgresException pg) when (pg.SqlState == "42703")` → legacy list) and `src_C/Worker/Services/ContentArtifactsGenerator.cs:93-96`, `:108-111`. `Log.Warn(params object?[])` (`src_C/Shared/RecallSmith.Lambda.Common/Log.cs:24-27`) writes to stderr.
- `Pg` (`src_C/Shared/RecallSmith.Lambda.Db/Pg.cs`) caches one `NpgsqlDataSource` in a static (`:8`), built from `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` (`:27-30`), with `MaxAutoPrepare` 10 (`:85-86`). Auto-prepare keys on statement text, so the two texts (`withCardFormat` true/false) are two cache entries, and on a migrated database only the first one is ever executed. `Pg.Reset()` (`:13-21`) drops the cached data source; `ProgressEventsSingleStatementTests.cs:573-575` and its `finally` (`:597-601`) are the in-repo precedent for swapping an env var + `Pg.Reset()` inside `try/finally`.
- Tests: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` — `PostgresFixture` starts `postgres:16-alpine` and applies every migration (`:45-53` → `ApplyMigrationsAsync(conn, int.MaxValue)`, `:136-155`), then exports the PG env vars and calls `Pg.Reset()` (`:57-72`); `QueryAsync`/`ScalarAsync` helpers (`:85-95`); `CreateScratchDatabaseAsync(name)` (`:118-128`) makes a second database in the same container and returns its connection string; `PostgresCollection` (`:158-165`) runs every DB class serially; `LambdaHost.PostProgressEventsAsync(userSub, body)` (`:174-181`) invokes the real handler and asserts 200 (`:241-243`), returning `data`. Seeding precedent: `CardsPageTests.cs:38-53` (`insert into decks (slug, title, author) … returning id`, `insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) …`). Scratch-schema precedent: `Migration015BackfillTests.cs:29-33` (`CreateScratchDatabaseAsync("mig015")`, `new Npgsql.NpgsqlConnection(cs)`, `ApplyMigrationsAsync(conn, maxVersion: 14)`, `information_schema.columns` check at `:35-37`). Outbox counting precedent: `ProgressEventsIntegrationTests.cs:143-157` (join `analytics_event_outbox o` to `user_progress_events e` on `event_id`). `Batch()` envelope precedent: `ProgressEventsSingleStatementTests.cs:64-80`.
- `src_C/Tests/…/ProgressEventsSingleStatementTests.cs:418-449` `OneIngest_CostsOneStatement_AndNoTransactionShell` (F5) asks Postgres how many statements one ingest cost (log probe `:374-397`) and asserts exactly one (`:432-434`) containing `ensure_user`, `into user_progress_events`, `into user_progress`, `analytics_event_outbox` (`:437-440`). The fixture is fully migrated, so the `withCardFormat: true` statement succeeds first time and F5 stays green **without being edited** (C00 §6 #11). A design that probes for the column before the ingest (a `select … from information_schema.columns`, `to_regclass`, `pg_attribute`, anything) would make every ingest two statements and is forbidden. `HotStatement_IsServerSidePrepared_WithoutBuyingAnExtraRoundTrip` (`:561-`) also stays green: the statement text is identical from call to call on a migrated database.
- `analytics_event_outbox` (`009_content_intelligence_events.sql:32-46`): `event_id uuid unique`, `aggregate_id text`, `payload jsonb`. The publisher (`src_C/Vpc/Analytics/OutboxPublisher.cs`, untouched by Wave C) writes `payload` under `payload`, so Snowflake reads `src:payload:card_format` (C13, C00 §2.12). The value vocabulary is exactly `'qa'` | `'mcq'`; the key is never null (an unknown card is `'qa'`), so `jsonb_strip_nulls` never removes it.

What C00 decided (binding): §2.10 pins the key expression, the two join lines, the `BuildIngestSql(bool withCardFormat)` builder, the `try { true } catch (PostgresException pg) when (pg.SqlState == "42703") { false }` execution, and that F5 is not edited; §0 "No new `eventType`, no `schemaVersion` bumps"; §1.2 gives C10 exactly `ProgressEvents.cs` (E) and `ProgressEventsCardFormatTests.cs` (C), and forbids editing `ProgressEventsSingleStatementTests.cs` (C14 edits its `Batch()`); §3.2 names the three outcomes (`qa` / `mcq` / unknown → `qa`) and prefers asserting through `analytics_event_outbox` over a new log probe; §3.3 asks for an xunit `[Theory]` table; §4: deps C08, and C13 (`ContentIntelligence.cs`, Snowflake) + C14 (`client_features`, `update_id` appended after `card_format`) build on this merge.

Why: MCQ answers must never enter the Q/A quality baselines (MCQ plan §7 Phase 1 `docs/mcq-card-type-plan-2026-09-18.md:374`: "payload 加一个键 `'card_format', …`. 带 42703 容错 …，保持单语句 ingest"). Tagging at ingest, from content metadata the server already owns, needs no client change and no privacy-label change; a column on `cards` was rejected (`:70`, `:471`) because `mcq is not null` already says it.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables), §1.2 (file map row), §2.10 (the contract you implement, verbatim), §3.1 "C10" + §3.2 (the test file), §5 (verify conventions), §6 #11 (why F5 is untouched).
2. `src_C/Vpc/Runtime/ProgressEvents.cs:1-15` (usings), `:72-97` (handler head), `:246-286` (params + the CTE-fold comment), `:354-367` (`stageRows`, `userHashParam`, the string head), `:383-447` (the `ins` RETURNING and the whole outbox CTE), `:580-600` (string tail, timing comment, execution), `:613-643` (timing log shape, catch arms).
3. `src_C/Vpc/Authoring/ContentIntelligence.cs:125-145` (the join to mirror), `src_C/Vpc/Authoring/ManifestRebuild.cs:153-189` (the 42703 shape to mirror).
4. `src_C/Vpc/Db/Migrations/001_init.sql:18-58` (`decks`, `cards`, the two unique constraints), `019_cards_mcq.sql` (whole; C08's file — confirm it says `mcq jsonb null`).
5. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` (whole, 247 lines), `ProgressEventsSingleStatementTests.cs:1-95` (class head, `Ev`, `Batch`, `PostAsync`), `:374-449` (probe + F5), `:561-601` (env-swap + `Pg.Reset()` precedent), `Migration015BackfillTests.cs:24-40`, `CardsPageTests.cs:36-53`, `ProgressEventsIntegrationTests.cs:44-80` (`Ev`/`Batch` shapes) and `:137-157`.
6. `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs:8-30`, `:85-86`, `:118-121`; `src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs` (whole, 72 lines — `QueryAsync` returns `Dictionary<string, object?>` rows, jsonb arrives as a .NET string, parameters bind via `AddWithValue`).
7. `docs/mcq-card-type-plan-2026-09-18.md:372-379` (§7, the source of this issue) and `docs/delivery-wave-1.6-plan-2026-09-19.md:114` (the C10 row).

## Constraints

- **Scope (the ONLY files that may change):** `src_C/Vpc/Runtime/ProgressEvents.cs` (edit) and `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsCardFormatTests.cs` (new). Nothing else: not `ProgressEventsSingleStatementTests.cs`, not `ProgressEventsIntegrationTests.cs`, not `IntegrationTestBase.cs` (add your helpers to the new class), not `OutboxPublisher.cs`, not `ContentIntelligence.cs`, no file under `src_C/Vpc/Db/Migrations/`, nothing under `snowflake/`, `frontend/`, `mobile/`, `docs/` (except nothing — the brief and verify already exist).
- **Frozen files (gacha-v7 §2.1 `mobile/gacha-v7.md:83-88`, narrowed by C00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. C10 is server-only, so this is trivially true; the verify checks it anyway.
- **OTA / dependency rule:** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`; no NuGet package added or bumped in any `.csproj` (the tests project already references Npgsql 10.0.0, Testcontainers.PostgreSql 3.10.0, xunit 2.5.3). No `dotnet add package`.
- **Statement discipline (C00 §6 #11):** on a database that has `cards.mcq` the ingest is exactly one statement, byte-identical text from call to call. The fallback is a *second* statement only after a `42703`. No pre-flight probe of the schema, no `BeginTransaction`, no `select *`, no caching of "the column is missing" across requests (a Lambda container outlives the migration; the next request must try the tagged text again).
- **Payload discipline:** the 22 existing keys keep their names, expressions and order; `card_format` is appended after `'deck_version', deck_version` and is the last key (C14 appends `client_features` / `update_id` after it — do not add those, do not reserve room for them, and do not name those two keys — or `42P01`, `information_schema`, `select *` — even in a comment, because the verify greps the whole file for them). No other CTE (`ensure_user`, `ins`, `agg`, `last_row`, `merged`, `upsert`) changes. No new `eventType`, `schema_version` stays as it is.
- **Banned literals in any added line (driver gate, case-insensitive, diff-scoped):** the six terms of B00 §0 / C00 §0 — this brief deliberately does not spell them out; write "work around", "sidestep", "sensor", "guard", "fallback", "probe" instead, and do not paste plan-doc prose into comments. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff; in C# that also means no `[Fact(Skip = …)]` / `[Theory(Skip = …)]`, no `#pragma warning disable`, and avoid LINQ `.Skip(` in the new file (use an index loop) so a case-insensitive gate cannot misread it.
- **Content rule:** never copy ExamTopics / SAA-C03 dump content. The MCQ blob in the test fixture is a shape-valid placeholder (§ Changes 2a); the tag depends only on `mcq is not null`, never on the blob's text. Do not quote any exam question.
- **Existing tests:** no existing test file changes. `ProgressEventsSingleStatementTests.cs` is byte-identical (verify diffs it). The full `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` must stay green — in particular F5 (`OneIngest_CostsOneStatement_AndNoTransactionShell`) and F6 (`HotStatement_IsServerSidePrepared_WithoutBuyingAnExtraRoundTrip`) with no edit.
- **dotnet / Docker notes:** `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~ProgressEventsCardFormatTests"` needs a running Docker daemon (Testcontainers pulls/starts `postgres:16-alpine`; the image is cached on this machine). `dotnet build`/`dotnet test` restore implicitly from the local NuGet cache — do not run `dotnet restore` by hand, do not touch `src_C/dist`, do not pass `--logger`/`--collect` (a `TestResults/` directory is not gitignored). Run the two `ProgressEvents*` classes together at least once before you finish: `--filter "FullyQualifiedName~ProgressEventsCardFormatTests|FullyQualifiedName~ProgressEventsSingleStatementTests"`.
- **Env-swap hygiene (test 2c):** the fallback test moves `PGDATABASE` to the scratch database and calls `Pg.Reset()`; it MUST restore the previous value and `Pg.Reset()` again in a `finally` (precedent `ProgressEventsSingleStatementTests.cs:597-601`), or every later class in the collection runs against the wrong database.

## Changes required

1. **`src_C/Vpc/Runtime/ProgressEvents.cs`** — the SQL body keeps its current indentation; only the lines named here change (expected diff ≈ 30 lines, all inside `HandleProgressEvents`).

   a. **Wrap the statement in a local function.** Replace `:367` `var sql = $"""` with the local function head below, and replace `:584` `""";` with `""";` followed by `}` (closing the function; keep the closing `"""` at its current 8-space column so the raw string's whitespace stripping is unchanged). The function captures `userSubParam`, `emailParam`, `platformParam`, `versionParam`, `deviceIdParam`, `values`, `stageRows`, `userHashParam` exactly as the interpolation does today (they are all assigned before this line; `static string P(ref int i)` at `:253` is the existing local-function precedent in this method). Signature verbatim from C00 §2.10:

   ```csharp
      // The outbox tag `card_format` reads cards.mcq (migration 019). Until that
      // migration has run on a database, Postgres answers 42703 for this text;
      // withCardFormat=false is then today's statement, re-run as is. One text
      // per shape, so auto-prepare (Pg.cs) keeps one plan per shape.
      string BuildIngestSql(bool withCardFormat)
      {
        var cardFormatKey = withCardFormat
          ? ",\n              'card_format', case when c.mcq is not null then 'mcq' else 'qa' end"
          : "";
        var cardFormatJoin = withCardFormat
          ? "\n          left join decks d on d.slug = ins.deck_slug and d.is_deleted = 0"
            + "\n          left join cards c on c.deck_id = d.id and c.stable_uid = ins.stable_uid and c.is_deleted = 0"
          : "";
        return $"""
        with ensure_user as (
   ```
   (the raw string continues unchanged from `:368`, `with ensure_user as (`). The three SQL fragments are byte-for-byte: `'card_format', case when c.mcq is not null then 'mcq' else 'qa' end`, `left join decks d on d.slug = ins.deck_slug and d.is_deleted = 0`, `left join cards c on c.deck_id = d.id and c.stable_uid = ins.stable_uid and c.is_deleted = 0` (the verify greps them with `-F`). Whitespace inside the fragments is not load-bearing for Postgres, but keep the `\n` + indentation so a logged statement still reads as one block.

   b. **Splice the fragments into the outbox CTE.** `:442` `'deck_version', deck_version` becomes `'deck_version', deck_version{cardFormatKey}` (still the last argument of `jsonb_build_object`; `))` on `:443` unchanged) and `:444` `from ins` becomes `from ins{cardFormatJoin}`. `on conflict (event_id) do nothing` / `returning 1` (`:445-446`) unchanged. Nothing is added to any other CTE.

   c. **Qualify the two `stable_uid` reads** (the C00 amendment recorded in Context; unconditional, so both texts compile): `:407` `deck_slug || ':' || stable_uid,` → `deck_slug || ':' || ins.stable_uid,` and `:414` `'card_stable_uid', stable_uid,` → `'card_stable_uid', ins.stable_uid,`. Do not qualify anything else (no other name in that select exists on `decks` or `cards`), and do not touch `agg` / `last_row`, whose `from ins` is separate.

   d. **Execute with the fallback.** Replace `:595` `var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);` with:

   ```csharp
      List<Dictionary<string, object?>> rows;
      try
      {
        rows = await DbUtil.QueryAsync(conn, null, BuildIngestSql(withCardFormat: true), parameters);
      }
      catch (PostgresException pg) when (pg.SqlState == "42703")
      {
        // cards.mcq is not there yet: the failed statement wrote nothing (one
        // statement, no shell), so today's text is run in its place. Logged so a
        // production database that has not had migration 019 is visible.
        Log.Warn(JsonSerializer.Serialize(new
        {
          traceId = req.TraceId,
          impl = ProgressEventsImpl,
          step = "ingest_card_format_fallback",
          sqlState = pg.SqlState,
        }));
        rows = await DbUtil.QueryAsync(conn, null, BuildIngestSql(withCardFormat: false), parameters);
      }
   ```
   `swStatement` (`:594`) and `statementMs` (`:596`) stay where they are, bracketing the whole `try`. The catch is exactly `when (pg.SqlState == "42703")` — not `is "42703" or "42P01"`: a missing *table* is a real failure here. `PostgresException` comes from `Npgsql` (`:8`). Everything from `:597` on (`sqlMs`, `insertedIds`, the timing log, the response, the two catch arms) is unchanged.

   e. Optional, one sentence only: extend the comment at `:586-593` ("…is ONE statement…") with "The 42703 fallback below is a second statement only on a database that has not run migration 019." Do not rewrite that comment.

2. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsCardFormatTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, `public class ProgressEventsCardFormatTests`, constructor `(PostgresFixture db) => _db = db;`. Usings: `System.Globalization`, `System.Text.Json`, `Npgsql`, `RecallSmith.Lambda.Db`. Class-level summary comment: what the tag is, why it is asserted through `analytics_event_outbox` rather than a log probe (F5 owns the one-statement claim), and that the fallback case moves `PGDATABASE`.

   a. **Helpers (private, in this class).**
      - `NewUser(tag)` → `$"it-cardformat-{tag}-{Guid.NewGuid():N}"`; `NewEventId()` → lowercase `Guid` "D"; `NewSlug(tag)` → `$"it-cardformat-{tag}-{Guid.NewGuid():N}"`; `NewUid()` → `$"uid-{Guid.NewGuid():N}"` (fresh per test: the suite must be rerunnable against a dirty container, `IntegrationTestBase.cs:22-26`).
      - `Ev(eventId, deckSlug, stableUid)` → the anonymous shape of `ProgressEventsSingleStatementTests.cs:46-56` with the slug and uid as parameters (`rating = 3`, `eventTimeMs = Base + n`, `nextReviewAtMs = eventTimeMs + OneDayMs`, `sessionId = "sess-cardformat"`, `progressAfter = new { stage = 2 }`; `Base` = `DateTimeOffset.UtcNow.AddDays(-10).ToUnixTimeMilliseconds()`).
      - `Batch(events)` → `new { deviceId = "device-under-test", clientVersion = "1.2.3", clientPlatform = "ios", events = events.ToList() }` (the `ProgressEventsIntegrationTests.cs:73-79` shape); `PostAsync(user, events)` → `LambdaHost.PostProgressEventsAsync(user, Batch(events))`.
      - `NewDeckAsync(slug, isDeleted = 0)` → `insert into decks (slug, title, author, is_deleted) values ($1, $2, $3, $4) returning id` → `long`.
      - `NewQaCardAsync(deckId, uid, order, isDeleted = 0)` → `insert into cards (deck_id, stable_uid, question, explanation, order_in_deck, is_deleted) values ($1, $2, 'q', 'e', $3, $4) returning id` — the `mcq` column is **not named** (column default null), so no null jsonb parameter is ever bound.
      - `NewMcqCardAsync(deckId, uid, order, isDeleted = 0)` → same insert plus `, mcq` / `, $5::jsonb` with `McqBlob` as the fifth parameter (explicit `::jsonb` cast: `AddWithValue` binds the string as text).
      - `private const string McqBlob = """{"v":1,"options":[{"key":"a","why":null,"text":"placeholder a","correct":true},{"key":"b","why":"placeholder why b","text":"placeholder b","correct":false},{"key":"c","why":"placeholder why c","text":"placeholder c","correct":false},{"key":"d","why":"placeholder why d","text":"placeholder d","correct":false}],"shuffle":true,"qualifier":null}""";` — the canonical shape of C00 §2.9.1 with placeholder text; not exam content, and no validation runs on a direct insert. A comment says the tag reads only `is not null`.
      - `OutboxRowAsync(eventId)` → `select aggregate_id, payload::text as payload from analytics_event_outbox where event_id = $1::uuid` through `_db.QueryAsync`; `Assert.Single(rows)`; returns `(string AggregateId, JsonElement Payload)` with the payload parsed via `JsonDocument.Parse((string)row["payload"]!)` and `.RootElement.Clone()` (the document is disposed on return — same reason as `IntegrationTestBase.cs:236-239`).
      - `OutboxRowsForUserAsync(user)` → `select count(*) from analytics_event_outbox o join user_progress_events e on e.event_id = o.event_id where e.user_sub = $1` (the `ProgressEventsIntegrationTests.cs:143-157` shape) → `int`.

   b. **The table (one `[Theory]`, five rows).** Title and rows verbatim:

   ```csharp
   [Theory]
   [InlineData("qa", "qa")]
   [InlineData("mcq", "mcq")]
   [InlineData("card-deleted", "qa")]
   [InlineData("deck-deleted", "qa")]
   [InlineData("missing", "qa")]
   public async Task OutboxPayload_CardFormat_FollowsTheCardsRow(string kind, string expected)
   ```
   Arrange by `kind`: `"qa"` → live deck + `NewQaCardAsync`; `"mcq"` → live deck + `NewMcqCardAsync`; `"card-deleted"` → live deck + `NewMcqCardAsync(…, isDeleted: 1)`; `"deck-deleted"` → `NewDeckAsync(slug, isDeleted: 1)` + `NewMcqCardAsync`; `"missing"` → no deck row and no card row at all (the slug/uid are still fresh strings). Act: post ONE event (`NewUser(kind)`, `Ev(id, slug, uid)`); assert `acceptedCount == 1`. Assert on the outbox row: `Payload.GetProperty("card_format").GetString() == expected`; `Payload.GetProperty("card_stable_uid").GetString() == uid`; `Payload.GetProperty("deck_slug").GetString() == slug`; `Payload.GetProperty("app_version").GetString() == "1.2.3"` (an old key still lands); `AggregateId == $"{slug}:{uid}"` (proves the `ins.stable_uid` qualification kept the aggregate id). The `"card-deleted"` and `"deck-deleted"` rows are what pin the two `is_deleted = 0` predicates; `"missing"` pins the LEFT join.

   c. **Mixed batch, one row per event, keyed by deck AND uid.**

   ```csharp
   [Fact]
   public async Task MixedBatch_TagsEachEventByItsOwnDeckAndUid_OneOutboxRowPerEvent()
   ```
   Seed deck A (live) with a Q/A card `uidQa` and an MCQ card `uidMcq`; seed deck B (live) with an **MCQ** card whose `stable_uid` is the same `uidQa` (legal: `uq_cards_deck_uid` is per deck). Post one batch of four events for one user: (A, `uidQa`), (A, `uidMcq`), (A, a `NewUid()` that has no row), (B, `uidQa`). Assert `acceptedCount == 4`; `OutboxRowsForUserAsync(user) == 4` (no fan-out from the join); per event: A/`uidQa` → `"qa"` (deck B's MCQ twin does not leak), A/`uidMcq` → `"mcq"`, A/unknown → `"qa"`, B/`uidQa` → `"mcq"`. Then replay the same batch: `acceptedCount == 0`, `duplicateEventIds` length 4, `OutboxRowsForUserAsync(user)` still 4 (the outbox `on conflict (event_id) do nothing` is unchanged by the join).

   d. **The fallback.**

   ```csharp
   [Fact]
   public async Task WithoutTheMcqColumn_IngestFallsBackToTheLegacyStatement()
   ```
   1. Guard the premise: on the shared database `select count(*) from information_schema.columns where table_name = 'cards' and column_name = 'mcq'` is `1` (so the other cases really exercised the join).
   2. `var scratchCs = await _db.CreateScratchDatabaseAsync("c10_no_mcq");` open `new NpgsqlConnection(scratchCs)`, `await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 18);` (018 = `cards.topic`, C05; 019 = `cards.mcq`, C08 — deliberately not applied), assert the same `information_schema` count is `0` there.
   3. `var prevDb = Environment.GetEnvironmentVariable("PGDATABASE"); Environment.SetEnvironmentVariable("PGDATABASE", "c10_no_mcq"); Pg.Reset();` then inside `try`: post one event for a fresh user and a fresh slug/uid (no seeding needed — the legacy text has no join); assert `acceptedCount == 1`; read the outbox row **through the scratch connection** (`DbUtil.QueryAsync(conn, null, "select aggregate_id, payload::text as payload from analytics_event_outbox where event_id = $1::uuid", [eventId])`), assert `Assert.False(payload.TryGetProperty("card_format", out _))`, `payload.GetProperty("card_stable_uid").GetString() == uid`, `aggregate_id == $"{slug}:{uid}"`, and that `user_progress` in the scratch database has one row for the user (the rest of the statement ran).
   4. `finally { Environment.SetEnvironmentVariable("PGDATABASE", prevDb); Pg.Reset(); }`. After the `finally`, post one more event for another fresh user on the shared database and assert its payload HAS `card_format == "qa"` (proves the env swap was undone and the tagged text is back).
   Do not `drop column` on the shared database instead — the collection is serial but a crash between drop and re-add would poison every later class.

   Do not add a statement-log probe (`alter system set log_statement`) to this class: F5 already owns the one-statement claim on the migrated fixture, and this class must stay fast. Expected size: ~220 lines.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C10.verify.sh` re-runs exactly these (five numbered steps; step 1 is the one that fails on the untouched base).

1. **Scope files + prerequisites.** `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsCardFormatTests.cs` exists (missing on base — the step-1 failure); `src_C/Vpc/Runtime/ProgressEvents.cs` and `ProgressEventsSingleStatementTests.cs` exist; `src_C/Vpc/Db/Migrations/019_cards_mcq.sql` (C08) exists and contains `mcq jsonb`; `018_cards_topic.sql` (C05) exists; `018_cards_mcq.sql` does not exist; exactly one `019_*.sql`; no `020_*`–`029_*` file (C10 adds no migration).
2. **Literal guards on `ProgressEvents.cs`** (all `grep -F`, must match): `string BuildIngestSql(bool withCardFormat)`, `BuildIngestSql(withCardFormat: true)`, `BuildIngestSql(withCardFormat: false)`, `catch (PostgresException pg) when (pg.SqlState == "42703")`, `'card_format', case when c.mcq is not null then 'mcq' else 'qa' end`, `left join decks d on d.slug = ins.deck_slug and d.is_deleted = 0`, `left join cards c on c.deck_id = d.id and c.stable_uid = ins.stable_uid and c.is_deleted = 0`, `'deck_version', deck_version{cardFormatKey}`, `from ins{cardFormatJoin}`, `deck_slug || ':' || ins.stable_uid,`, `'card_stable_uid', ins.stable_uid,`, `ingest_card_format_fallback`; untouched anchors `jsonb_strip_nulls(jsonb_build_object(`, `'app_version', client_version,`, `on conflict (event_id) do nothing`, `static string P(ref int i)`, `with ensure_user as (`, `var swStatement = Stopwatch.StartNew();`, `var statementMs = swStatement.Elapsed.TotalMilliseconds;`. Counts: `'deck_version', deck_version{cardFormatKey}` exactly once, `from ins{cardFormatJoin}` exactly once, `catch (PostgresException` exactly once, a line that is exactly eight spaces + `""";` exactly once (the raw string still closes at its 8-space column). Key order: the first occurrence of each of the 22 keys `'event_id',` … `'deck_version',` lies after `jsonb_strip_nulls(jsonb_build_object(`, is strictly increasing in file order, and none sits after the `{cardFormatKey}` splice. Negative (must NOT match anywhere in the file, comments included): `'card_stable_uid', stable_uid,`, `|| ':' || stable_uid,`, `information_schema`, `pg_attribute`, `to_regclass`, `BeginTransaction`, `client_features`, `update_id`, `select *`, `var sql = $"""`, `42P01`.
3. **Literal guards on `ProgressEventsCardFormatTests.cs`** (must match): `[Collection(PostgresCollection.Name)]`, `public class ProgressEventsCardFormatTests`, `[Theory]`, the five rows `[InlineData("qa", "qa")]` `[InlineData("mcq", "mcq")]` `[InlineData("card-deleted", "qa")]` `[InlineData("deck-deleted", "qa")]` `[InlineData("missing", "qa")]`, `public async Task OutboxPayload_CardFormat_FollowsTheCardsRow(`, `public async Task MixedBatch_TagsEachEventByItsOwnDeckAndUid_OneOutboxRowPerEvent(`, `public async Task WithoutTheMcqColumn_IngestFallsBackToTheLegacyStatement(`, `CreateScratchDatabaseAsync("c10_no_mcq")`, `maxVersion: 18`, `Environment.SetEnvironmentVariable("PGDATABASE"`, `Pg.Reset()` (on at least two lines: the swap and the `finally`), `finally`, `information_schema.columns`, `"card_format"`, `LambdaHost.PostProgressEventsAsync`, `analytics_event_outbox`, `::jsonb`, `duplicateEventIds`, `acceptedCount`; `[Fact]` on ≥ 2 lines. Negative: `log_statement`, `alter system`, `ExamTopics`, `SAA-C03`, `drop column`, `.Skip(`. Across both scope files: no `Skip =` / `Skip=`, `#pragma warning disable`, `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`.
4. `( cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo )` exit 0 (compiles Vpc + Worker + Tests; no Docker), and `019_cards_mcq.sql` is present under `src_C/Tests/RecallSmith.Lambda.IntegrationTests/bin/Debug/net8.0/Db/Migrations/` (so the fallback test's `maxVersion: 18` cut is real).
5. Docker daemon running (`docker info`), then `( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo --filter "FullyQualifiedName~ProgressEventsCardFormatTests|FullyQualifiedName~ProgressEventsSingleStatementTests" )` exit 0 — the new class (7 cases: 5 theory rows + 2 facts) and the untouched F1–F7 including `OneIngest_CostsOneStatement_AndNoTransactionShell`.
6. **Scope + frozen guard** (`MB = git merge-base HEAD $BASE_REF`, working tree against it): `git diff --numstat "$MB" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/src mobile/tests frontend/src frontend/tests snowflake src_C/Shared src_C/Worker src_C/Vpc/Authoring src_C/Vpc/Analytics src_C/Vpc/Db src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsSingleStatementTests.cs src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsIntegrationTests.cs src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs ':(glob)src_C/**/*.csproj' ':(glob)docs/*.md'` is empty, and `{ git diff --name-only "$MB"; git ls-files --others --exclude-standard -- src_C/Vpc src_C/Worker src_C/Tests src_C/Shared mobile/src mobile/tests frontend/src frontend/tests snowflake docs; }` filtered by `^(src_C/Vpc/Runtime/ProgressEvents\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/ProgressEventsCardFormatTests\.cs|docs/delivery/r16-issues/.*)$` is empty.

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C10.verify.sh
```

Steps: (1) scope files + C05/C08 prerequisites, (2) literal guards, (3) `dotnet build`, (4) `docker info` + targeted `dotnet test` of the two `ProgressEvents*` classes, (5) scope + frozen guard. Expect a few minutes (one `postgres:16-alpine` start plus the single-statement class's log-probe and concurrency cases; not measured). The driver then runs the full root gate `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (Docker) plus the diff-scoped banned-term and suppression scans; the verify never repeats the whole suite.

## Do NOT

- Do NOT edit `ProgressEventsSingleStatementTests.cs` (C14 owns its `Batch()`), `IntegrationTestBase.cs`, `ProgressEventsIntegrationTests.cs`, `OutboxPublisher.cs`, `ContentIntelligence.cs`, any migration, anything under `snowflake/`, `frontend/`, `mobile/`.
- Do NOT probe the schema before the ingest, open a transaction, or remember "no `mcq` column" across requests; do NOT catch `42P01` here.
- Do NOT add `client_features` / `update_id` (C14), do NOT rename or reorder the 22 existing payload keys, do NOT touch `schema_version` / `event_type`.
- Do NOT emit `card_format` as null for an unknown card (it is `'qa'`), do NOT add a `card_format` column to `cards` or to the outbox table.
- Do NOT drop or alter `cards.mcq` on the shared test database; use the scratch database for the fallback case and restore `PGDATABASE` in a `finally`.
- Do NOT run `dotnet restore`, `dotnet add package`, `npm install`, `git push`, open a PR, or touch `main` / the shared checkout `/Users/qc/src/recallsmith`.
