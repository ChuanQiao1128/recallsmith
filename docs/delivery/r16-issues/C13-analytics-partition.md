# C13 — Analytics partition (`analytics-partition`)

Partition every analytics surface by answer mode before any MCQ content ships: the Snowflake setup script projects `card_format` / `client_features` / `update_id` and derives `answer_mode`, the user and difficulty baselines group by `answer_mode`, the four Q/A quality rules are reached only by `'qa'` rows and MCQ rows read `'MCQ · Not Assessed'`; the Content Intelligence Lambda's live (non-snapshot) query stops feeding MCQ answers into the Q/A baselines and the response summary gains `mcqCardCount` (last key) with a 42703 fallback for a database without migration 019; the console shows an amber banner above the summary tiles when `mcqCardCount > 0`. Root: `src_C` + `frontend` (+ `snowflake/`). No mobile file changes. Deps: C10 (`card_format` in the outbox payload — the Snowflake projection reads it) and C12 (`frontend/src/api/authoring.ts` is edited by C06 and C12 before this issue; rebase on their merges).

## Context

What the tree looks like today (`delivery/r16-c-economy` == `main@52594fe`; every line below was read on that tree on 2026-09-21):

- **`src_C/Vpc/Authoring/ContentIntelligence.cs` (378 lines).** Handler `HandleContentIntelligence` `:10-332`: admin gate `:15-16`, connection `:20-21`, params `deckSlug`/`days` (7..365, default 90)/`limit` (1..500, default 100) `:23-27`. Snapshot branch `:29-103` — taken only when `days ∈ {30, 90}` **and** `SnapshotAvailableAsync` (`:340-349`) finds rows in `content_intelligence_card_snapshot`; its SQL `:31-91`, execution `:93-102` (`DbUtil.QueryAsync(conn, null, snapshotSql, [days, auth.UserSub, deckSlug, auth.IsSuperAdmin, limit])`, `BuildResponse(cards, days, deckSlug)` at `:96`). Live query `const string sql` `:105-320`: `event_scored` `:106-145` joins `decks d` (`:132`) and `cards c` (`:133-136`) and `admin_deck_permissions p` (`:137-140`); its WHERE is `:141-144` (`e.event_time >= …`, deckSlug, permission, `e.rating is not null`). `user_baseline` `:146-154` and `baseline` `:155-168` (grouped by `deck_slug, stated_difficulty`) are both computed from `event_scored`, so an MCQ card's `again`-heavy answers (MCQ verdict mapping, MCQ plan §5.3) would enter the Q/A baselines the moment MCQ content is live. Execution `:322-331` with `[days, deckSlug, auth.UserSub, auth.IsSuperAdmin, limit]` (`:324`). `BuildResponse` `:351-370` builds `summary` `:359-367` with exactly seven keys, the last being `difficultyOverstated` (`:367`); `CountStatus` `:372-377`. `Res.Ok` serialises anonymous objects camelCase (`src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-96`, `:159`). No 42703 handling exists in this file; the Vpc precedent is `src_C/Vpc/Authoring/ManifestRebuild.cs:174` (`catch (PostgresException pg) when (pg.SqlState == "42703")` → legacy column list), the Worker precedent `src_C/Worker/Services/ContentArtifactsGenerator.cs:93-96`, `:108-111`. `DbUtil.ExecuteScalarAsync` (`src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:42-51`) returns `count(*)` as a boxed `long`; parameters bind via `AddWithValue` (`:63-68`), so a nullable text parameter needs an explicit `::text` cast where Postgres cannot infer it from context. `[assembly: InternalsVisibleTo("RecallSmith.Lambda.IntegrationTests")]` (`src_C/Vpc/AssemblyInfo.cs:11`) lets the test project call `internal static` helpers.
- **`cards.mcq`** exists on the tree you receive: `src_C/Vpc/Db/Migrations/019_cards_mcq.sql` (C08) adds `mcq jsonb null`; `018_cards_topic.sql` (C05) adds `topic text null`. On the base today the latest migration is `017_cards_keyset_index.sql`. The test fixture applies every migration at start-up (`src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:45-53`), and `CreateScratchDatabaseAsync` (`:118-128`) + `ApplyMigrationsAsync(conn, maxVersion)` (`:136-155`) give you a second database frozen at an older schema — that is how the 42703 path is exercised for real (C09 uses the same mechanism).
- **`snowflake/001_content_intelligence_setup.sql` (314 lines).** `staging.stg_review_events` `:54-91` projects one column per payload key as `coalesce(src:payload:K, src:K)`; `app_version` is `:79`, `offline_queue_delay_ms` `:80`. `staging.card_observations` `:93-116` is a **fixed column list** (`:95-109`, ends `platform, app_version`) — a hop the MCQ plan never mentions; any column not added there is invisible to the marts (C00 §6 #10). `marts.mart_card_quality_daily` `:118-240`: `user_card_ordered` `:122-130`, `user_baseline` `:131-138` (`group by user_id_hash` `:137`), `expected_by_difficulty` `:139-151` (`group by event_date, deck_slug, stated_difficulty` `:150`), `card_stats` `:152-180` (`left join user_baseline ub on ub.user_id_hash = e.user_id_hash` `:178`, group by `:179`), `scored` `:181-195` (join on `event_date, deck_slug, stated_difficulty` `:191-194`), final `select *, …` `:196-240` with `difficulty_calibration_status` `:198-203`, `content_quality_status` `:204-220` (arms: `Needs More Data` `:205`, `Possibly Unclear` `:206-210`, `Productive Challenge` `:211-215`, `Too Shallow` `:216-218`, else `Healthy` `:219`), `confidence_level` `:221-225`, `fix_priority_score` `:226-239`. `marts.mart_card_revision_impact` `:242-294` (`revision_rollup` `:246-259` reads the quality mart at `:257`, groups at `:258`). `marts.mart_deck_health_daily` `:296-313` (last column `max(fix_priority_score) as max_fix_priority_score` `:311`, group by `:313`). Views (`:54`, `:93`) and dynamic tables (`:118`, `:242`, `:296`) are all `create or replace`, so re-running the file after an edit is idempotent; there is no local runner, no CI step and no test harness for this SQL anywhere in the repo — the owner applies it by hand (`snowflake/README.md:32-40`). The outbox payload is built with `jsonb_strip_nulls` (`src_C/Vpc/Runtime/ProgressEvents.cs:399-447`), so keys absent from older events must default in Snowflake (`coalesce(…, 'qa')`). After C10 the payload carries `card_format` (`'mcq'` | `'qa'`); after C14 (later than this issue) it will carry `client_features` (jsonb array) and `update_id`. The MCQ plan's `answer_mode` keyed on "card_format + app_version ≥ 1.6.0" (`docs/mcq-card-type-plan-2026-09-18.md:375`) is **superseded**: `docs/release-1.6.0-plan-2026-09-19.md:206`, `:279` key it on the client capability flag, and C00 §6 #9 makes this issue write that final expression now, keyed on `client_features` (absent → `'qa'`), while C14 never touches `snowflake/`.
- **Console.** `frontend/src/api/authoring.ts:648-662` `ContentIntelligenceData`, `summary` `:653-661` with the same seven numeric keys. (C06 and C12 add lines above this block; after their merges it sits a few lines lower — locate it by the `summary: {` literal inside `ContentIntelligenceData`.) `frontend/src/pages/ContentIntelligencePage.tsx` (461 lines): `const summary = state.data?.summary;` `:193`; layout `:209-`: toolbar section `:210-261`, error banner `:263-265` (`rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700`), **tile grid `<section className="grid …">` `:267-281`**, table `:283-`. The page has exactly two `useEffect` calls (`:154`, `:170`) and a long in-file note (`:101-153`) on why `react-hooks/set-state-in-effect` forbids a `setState` in a new effect. `frontend/tests/contentIntelligencePage.test.tsx` (602 lines, 33 cases) is a characterisation suite: `tileTexts()` `:174-176` selects `section.grid > div`, and `:266-273` asserts exactly six tiles in order — a seventh child of that section fails it; fixtures `SUMMARY` `:127-135` / `payload()` `:137-139` are typed `ContentIntelligenceData`, so the new summary key must be optional or `tsc -b` (which compiles `tests/`) goes red. The mock pattern you copy is `:54-64` (`vi.hoisted` + `vi.mock('../src/api/authoring', …)` + top-level `await import`), the mount helpers `:188-196`, session helpers `tests/support/consoleSession.ts:48` (`signInAsSuperAdmin`) / `:101` (`signOut`), `tests/support/apiResult.ts:19` (`ok`), `tests/support/routerProbe.tsx:28` (`renderAt`). `frontend/vitest.config.ts:15` includes `tests/**/*.test.tsx`; a DOM test opts in with the `// @vitest-environment jsdom` docblock.
- **Server test harness.** `IntegrationTestBase.cs:27-156` `PostgresFixture` (one Testcontainers `postgres:16-alpine`), `:88-98` `QueryAsync`/`ScalarAsync`, `:158-165` `PostgresCollection` (`[Collection(PostgresCollection.Name)]`, serial), `:172-247` `LambdaHost` (`PostProgressEventsAsync(userSub, body)` `:174-181` is the only way to create `user_progress_events` rows through the real ingest — it upserts the `users` row the FK at `001_init.sql:145` needs). `CardsPageTests.cs:66-92` builds a real API Gateway event with `cognito:groups` claims and `:94-99` invokes the handler with `Auth.GetAuthContext(req)` — `super_admin` (`src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:88`) passes `RequireAdmin` (`:113-116`); `:38-58` are the deck/card/permission insert helpers to copy. `ProgressEventsIntegrationTests.cs:52-82` shows the ingest body shape (`deviceId, clientVersion, clientPlatform, events[{eventId (UUID), deckSlug, stableUid, rating, eventTimeMs, …}]`). Table shapes: `users` `001_init.sql:83-92`, `decks` `:18-30`, `cards` `:36-54`, `admin_deck_permissions` `:64-73`, `user_progress_events` `:143-157`.

What C00 decided (binding; `docs/delivery/r16-issues/C00-contracts.md` §2.12, §1.2/§1.3, §3.1/§3.2, §5, §6 #9/#10):

- Live query: `and c.mcq is null` is added to `event_scored`'s WHERE so MCQ answers never enter the Q/A baselines; a second scalar query counts readable MCQ cards for `summary.mcqCardCount`; both are wrapped so a `PostgresException` with `SqlState == "42703"` falls back to today's SQL text and `mcqCardCount = 0`. `summary` gains `mcqCardCount` **last**. The snapshot SQL (`:31-91`) is not touched (Phase 5, migration 020, is not Wave C).
- Console: `mcqCardCount?: number` (optional) on the TS type; a `<div data-testid="content-intelligence-mcq-banner" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">` between the error banner and the tile grid, rendered only when `(summary?.mcqCardCount ?? 0) > 0`, text `${n} MCQ card${n === 1 ? '' : 's'} in scope are not assessed by the Q/A model.`, derived at render time, never a child of `section.grid`.
- Snowflake: the exact four projection lines, the `card_observations` hop, the group-by / join changes, the first `'MCQ · Not Assessed'` arm, `where answer_mode = 'qa'` on the revision mart's source, `mcq_not_assessed_count` on the deck-health mart; README gains a "re-run after editing" line and the new columns. Verify = non-empty + literal greps (nothing can execute Snowflake SQL here).
- Tests: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentIntelligenceMcqTests.cs` (new, DB) and `frontend/tests/contentIntelligenceMcqBanner.test.tsx` (new, jsdom). `frontend/tests/contentIntelligencePage.test.tsx` stays byte-identical (C00 §3.1 permits add-only edits there; this brief puts every new case in the new file instead, and the verify enforces zero diff on the old one).

Two places where this brief is more specific than C00 (recorded so the driver can see them; neither contradicts a pinned literal):

1. **Where `mcqCardCount` is computed.** C00 §2.12 describes it inside the live fallback and says the snapshot path is "unchanged". In production the default window is 90 days, and once `content_intelligence_card_snapshot` has rows the handler takes the snapshot branch — a count living only in the live branch would leave the banner dark exactly where the owner looks. The count reads `cards`, not events and not the snapshot, so it is branch-independent: it runs once inside **each** branch's existing `try` and is passed to `BuildResponse` from both call sites. The snapshot SQL text stays byte-identical; the only edits inside `:29-103` are one added line and the extra argument at `:96`.
2. **`user_baseline` join in Snowflake.** C00 groups `user_baseline` by `user_id_hash, answer_mode` but does not mention the join at `:178`; without `and ub.answer_mode = e.answer_mode` a user with both modes would produce two baseline rows and fan out `card_stats`. The join condition is added (it is the only way the group-by C00 asks for stays 1:1).

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables), §1.2–1.3 (file map rows for C13), §2.12 (the contract you implement — SQL and TSX literals verbatim), §3.1–3.2 (test contracts), §5 (verify conventions), §6 #9, #10, #11, #13.
2. `src_C/Vpc/Authoring/ContentIntelligence.cs:1-378` (whole file — you restructure the bottom half).
3. `src_C/Vpc/Authoring/ManifestRebuild.cs:160-205` (the 42703 fallback shape used in this assembly) and `src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:1-72`.
4. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:1-247`, `CardsPageTests.cs:1-135` (JWT event + direct handler + insert helpers), `ProgressEventsIntegrationTests.cs:44-97` (ingest body shape).
5. `src_C/Vpc/Db/Migrations/001_init.sql:18-30`, `:36-54`, `:64-73`, `:83-92`, `:143-157`; `018_cards_topic.sql` and `019_cards_mcq.sql` as they exist on your tree.
6. `snowflake/001_content_intelligence_setup.sql:54-116` (staging), `:118-240` (quality mart), `:242-313` (the two downstream marts); `snowflake/README.md:32-51`.
7. `frontend/src/api/authoring.ts` — the `ContentIntelligenceData` interface (base `:648-662`); `frontend/src/pages/ContentIntelligencePage.tsx:1-30`, `:95-198`, `:199-283`.
8. `frontend/tests/contentIntelligencePage.test.tsx:43-64` (mock pattern), `:84-141` (fixtures), `:152-210` (readers, mount, hooks), `:251-275` (the six-tile pin you must not break); `frontend/tests/support/{apiResult.ts,consoleSession.ts,routerProbe.tsx}` exports.
9. `docs/mcq-card-type-plan-2026-09-18.md:372-379` (§7 — Phase 3 is this issue; its `app_version` keying is superseded, see Context) and `:325-327` (§5.8, why MCQ dwell must never meet the Q/A `expected_dwell_time_ms`).
10. `docs/delivery-wave-1.6-plan-2026-09-19.md:117` (the C13 row).

## Constraints

- **Scope (the ONLY files that may change):**
  - `src_C/Vpc/Authoring/ContentIntelligence.cs` (E)
  - `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentIntelligenceMcqTests.cs` (C)
  - `frontend/src/api/authoring.ts` (E — one line)
  - `frontend/src/pages/ContentIntelligencePage.tsx` (E)
  - `frontend/tests/contentIntelligenceMcqBanner.test.tsx` (C)
  - `snowflake/001_content_intelligence_setup.sql` (E)
  - `snowflake/README.md` (E)
  Nothing else. In particular: no `src_C/Vpc/Runtime/ProgressEvents.cs` (C10/C14 own it), no migration, no `src_C/Vpc/Analytics/*` (`OutboxPublisher.cs`, `ContentIntelligenceSnapshotImport.cs` are on the do-not-touch list), no `frontend/src/lib/cardRules.ts`, no new file under `frontend/src/pages/` (`tests/consoleDirectoryLayout.test.ts:97` pins the set), no top-level `docs/*.md` (C15 owns the doc amendments; `frontend/tests/docsPaths.test.ts` scans every top-level doc), no `frontend/tests/contentIntelligencePage.test.tsx` edit, no `ProgressEventsSingleStatementTests.cs` edit.
- **Frozen files (zero diff):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. This issue touches nothing under `mobile/` at all.
- **OTA / dependency rule:** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, `frontend/package.json`, `frontend/package-lock.json`, any `.csproj`, or any NuGet/npm dependency. No `npm install`, `npm ci`, `dotnet restore`, `dotnet add package`, no network.
- **Banned literals in any added line:** the six terms of B00 §0 (the driver's diff-scoped, case-insensitive grep over `src_C/Vpc`, `src_C/Worker`, `frontend/src`, `mobile/src` — do not paste prose from plan docs into comments). Use "work around", "sidestep", "guard", "fallback", "probe". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`, and no `[Fact(Skip = …)]` / `[Theory(Skip = …)]` anywhere in the diff.
- **No MCQ content.** The C# fixture needs a non-null `cards.mcq` value only for `is not null`; use a shape-only §2.9.1 blob with placeholder option text (e.g. `{"v":1,"options":[{"key":"a","why":null,"text":"option a","correct":true},{"key":"b","why":"why b","text":"option b","correct":false},{"key":"c","why":"why c","text":"option c","correct":false}],"shuffle":true,"qualifier":null}`). No AWS / exam wording, nothing from any question dump; the only MCQ example text any test may quote is `docs/mcq-card-type-plan-2026-09-18.md:177-253`, and this issue needs none of it.
- **Existing tests:** no existing test file changes. `frontend/tests/contentIntelligencePage.test.tsx` (33 cases, the six-tile pin at `:266-273`) must stay green untouched — which is why the banner is not a `section.grid` child and `mcqCardCount` is optional on the TS type. Every other server test class stays green: your SQL changes only the live query's WHERE and add one scalar; the snapshot branch's SQL is byte-identical.
- **Lint traps (frontend):** `react-hooks/set-state-in-effect` — the banner is derived at render time from `state.data`; do not add a `useEffect` (the file keeps exactly two). `verbatimModuleSyntax` — `import type` for types. `noUnusedLocals`. `react-refresh/only-export-components` — no non-component export from the `.tsx` page.
- **Server rules:** Nullable enabled; the two helpers are `internal static` (visible to the test project via `AssemblyInfo.cs:11`), never `public`. Only `PostgresException` with `SqlState == "42703"` is caught by the fallbacks; every other exception still reaches the handler's existing `catch (Exception ex)` → `Log.Error` + `res.Error500(ex)` (`:98-102`, `:327-331`). The fallback text is today's SQL; do not probe `information_schema` first (C00 §6 #11 forbids a probe-then-query design).
- **Snowflake rules:** edit `001_content_intelligence_setup.sql` in place (no `002_*.sql` — `snowflake/002_mcq_marts.sql` is registered as not-on-disk at `docs/mcq-card-type-plan-2026-09-18.md:498` and creating it turns the frontend `docsPaths` gate red). Never key `answer_mode` on `app_version` (C00 §6 #9). Do not touch `difficulty_calibration_status` (`:198-203`), `confidence_level`, `fix_priority_score`, the raw/stage/pipe DDL (`:13-52`), or the sample CSVs. Nothing executes this SQL in the repo — write it as if it will be run once by hand, and say so in the README line.
- **dotnet / Docker:** `dotnet test` needs Docker running (Testcontainers pulls `postgres:16-alpine` from the local image cache; the fixture starts one container per test run, ~10 s). Build is an implicit restore from the local NuGet cache — no package changes, so no network. Run only the filtered class (`--filter "FullyQualifiedName~ContentIntelligenceMcqTests"`); the driver runs the whole project afterwards.

## Changes required

### 1. `src_C/Vpc/Authoring/ContentIntelligence.cs`

a. Add `using Npgsql;` to the using block (`:1-4`); `Npgsql.NpgsqlConnection` at `:340` may then lose its prefix or stay as is.

b. Replace the `const string sql = """…"""` at `:105-320` with a builder that yields the same text plus one optional predicate. The `$"""` raw interpolated string contains the SQL of `:106-319` unchanged except for one placeholder line inside `event_scored`'s WHERE (`:141-144`), inserted **after** `and e.rating is not null`:

```csharp
/// <summary>
/// The live (non-snapshot) query. withMcqFilter=true appends `and c.mcq is null` to event_scored's WHERE so
/// MCQ answers never enter the Q/A user/difficulty baselines (MCQ plan §5.8: their dwell and verdict
/// distribution are structurally different); false is today's text, for a database without migration 019.
/// </summary>
private static string BuildLiveSql(bool withMcqFilter)
{
  var mcqFilter = withMcqFilter ? "and c.mcq is null" : "";
  return $"""
    with event_scored as (
      …                                  ← :107-140 verbatim
      where e.event_time >= now() - ($1::int * interval '1 day')
        and ($2::text is null or e.deck_slug = $2::text)
        and ($4::boolean or p.id is not null)
        and e.rating is not null
        {mcqFilter}
    ),
    …                                    ← :146-319 verbatim
    """;
}
```
(The SQL contains no `{` or `}` characters, so interpolation is safe; the `$1…$5` placeholders are not interpolation.) Parameter order stays `[days, deckSlug, userSub, isSuperAdmin, limit]`.

c. Add the two helpers (both `internal static`, same class):

```csharp
/// Runs BuildLiveSql(true); on PostgresException 42703 (cards.mcq absent: migration 019 not applied) re-runs
/// BuildLiveSql(false). Any other exception propagates to the handler's catch.
internal static async Task<List<Dictionary<string, object?>>> QueryLiveCardsAsync(
  NpgsqlConnection conn, int days, string? deckSlug, string? userSub, bool isSuperAdmin, int limit)
{
  object?[] parameters = [days, deckSlug, userSub, isSuperAdmin, limit];
  try
  {
    return await DbUtil.QueryAsync(conn, null, BuildLiveSql(true), parameters);
  }
  catch (PostgresException pg) when (pg.SqlState == "42703")
  {
    return await DbUtil.QueryAsync(conn, null, BuildLiveSql(false), parameters);
  }
}

/// Readable, live MCQ cards in scope (C00 §2.12). Branch-independent: reads `cards`, not events or the snapshot,
/// so both the snapshot and the live branch report it. 42703 → 0 (no mcq column, so no MCQ cards).
internal static async Task<int> CountMcqCardsAsync(
  NpgsqlConnection conn, string? deckSlug, string? userSub, bool isSuperAdmin)
{
  const string countSql = """
    select count(*) from cards c join decks d on d.id = c.deck_id and d.is_deleted = 0
    left join admin_deck_permissions p on p.deck_id = d.id and p.admin_sub = $2 and p.can_read = 1
    where c.is_deleted = 0 and c.mcq is not null and ($1::text is null or d.slug = $1::text) and ($3::boolean or p.id is not null)
    """;
  try
  {
    var scalar = await DbUtil.ExecuteScalarAsync(conn, null, countSql, [deckSlug, userSub, isSuperAdmin]);
    return scalar is null ? 0 : Convert.ToInt32(scalar, CultureInfo.InvariantCulture);
  }
  catch (PostgresException pg) when (pg.SqlState == "42703")
  {
    return 0;
  }
}
```
The `countSql` text is C00 §2.12's, verbatim (`$1` deckSlug, `$2` admin sub, `$3` super-admin — a different order from the live query; keep it).

d. Handler wiring. Snapshot branch `try` (`:93-97`) becomes:
```csharp
var mcqCardCount = await CountMcqCardsAsync(conn, deckSlug, auth.UserSub, auth.IsSuperAdmin);
var cards = await DbUtil.QueryAsync(conn, null, snapshotSql, [days, auth.UserSub, deckSlug, auth.IsSuperAdmin, limit]);
return res.Ok(BuildResponse(cards, days, deckSlug, mcqCardCount));
```
(`snapshotSql` `:31-91` byte-identical; `catch` `:98-102` unchanged.) Live branch `try` (`:322-326`) becomes:
```csharp
var mcqCardCount = await CountMcqCardsAsync(conn, deckSlug, auth.UserSub, auth.IsSuperAdmin);
var cards = await QueryLiveCardsAsync(conn, days, deckSlug, auth.UserSub, auth.IsSuperAdmin, limit);
return res.Ok(BuildResponse(cards, days, deckSlug, mcqCardCount));
```
(`catch` `:327-331` unchanged.)

e. `BuildResponse` (`:351-370`) gains a fourth parameter `int mcqCardCount` and `summary` gains **one** key, appended **last**, immediately after `difficultyOverstated = CountStatus(cards, "difficultyCalibrationStatus", "Difficulty Overstated"),` (`:367`):
```csharp
        mcqCardCount,
```
The seven existing keys and their order are unchanged (`cardCount, needsMoreData, possiblyUnclear, tooShallow, productiveChallenge, difficultyUnderstated, difficultyOverstated, mcqCardCount`). `CountStatus`, `NullIfBlank`, `SnapshotAvailableAsync` unchanged. `System.Globalization` is already imported (`:1`).

### 2. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentIntelligenceMcqTests.cs` (new)

`[Collection(PostgresCollection.Name)] public class ContentIntelligenceMcqTests` with a `PostgresFixture` constructor (pattern `CardsPageTests.cs:24-32`). Helpers (private, copy and adapt `CardsPageTests.cs:36-58`): `NewSub(tag)`, `NewDeckAsync(tag)` returning `(long id, string slug)` — you need the slug for `deckSlug` and for events, `NewCardAsync(deckId, orderInDeck, mcq: string? = null, isDeleted = 0)` inserting `(deck_id, stable_uid, question, order_in_deck, is_deleted, mcq)` with `$6::jsonb` (the shape-only blob from Constraints when `mcq` is requested), returning the `stable_uid`, `GrantReadAsync(adminSub, deckId)`, an `Event(path, sub, groups, query)` JSON builder identical to `CardsPageTests.cs:66-92`, and

```csharp
private static async Task<JsonElement> GetAsync(string sub, string[] groups, IDictionary<string, string> query)
{
  var req = new LambdaRequest(Event("/api/v1/authoring/content-intelligence", sub, groups, query));
  var res = new Res(req.TraceId);
  var response = await ContentIntelligence.HandleContentIntelligence(req, res, Auth.GetAuthContext(req));
  Assert.True(response.StatusCode == 200, $"GET content-intelligence returned {response.StatusCode}: {response.Body}");
  using var doc = JsonDocument.Parse(response.Body!);
  return doc.RootElement.GetProperty("data").Clone();
}
```
Every query passes `["days"] = "7"` so the handler takes the live branch regardless of what other test classes leave in `content_intelligence_card_snapshot` (`:29` checks the snapshot only for 30/90). The four `[Fact]`s, names verbatim:

1. `McqCardCount_IsScopedByDeckSlug_AndSkipsDeletedCards` — deck A: 2 MCQ cards + 1 Q/A card + 1 MCQ card with `is_deleted = 1`; deck B: 1 MCQ card. As `super_admin`: `deckSlug=A` → `summary.mcqCardCount == 2`; `deckSlug=B` → `1`; `summary.cardCount == 0` (no events) and the key exists in the response (`TryGetProperty("mcqCardCount", …)` true, `ValueKind == Number`). Do not assert the unscoped super-admin count as an equality — other classes in the shared database also insert cards; `>= 3` is the most you may claim there.
2. `McqCardCount_FollowsReadPermission_ForEditors` — same layout, an `editor` sub with `can_read` on deck A only: no `deckSlug` → exactly `2`; a second editor with no permission row → `0`; `deckSlug=B` for the first editor → `0`.
3. `LiveCards_ExcludeMcqCards_ButKeepQaCards` — deck A with one Q/A card and one MCQ card; a fresh user posts one `rating: 3` event per card via `LambdaHost.PostProgressEventsAsync(sub, body)` (body shape `ProgressEventsIntegrationTests.cs:52-79` with your slug; `eventTimeMs` one hour ago; `eventId` = `Guid.NewGuid().ToString("D")`). GET as `super_admin` with `deckSlug=A`, `days=7`: `cards` has exactly one row whose `cardStableUid` is the Q/A uid, `summary.cardCount == 1`, `summary.mcqCardCount == 1`.
4. `LiveQueries_FallBack_WhenCardsMcqColumnIsAbsent` — `var cs = await _db.CreateScratchDatabaseAsync("ci_c13_mig018");` open an `NpgsqlConnection` on it, `await PostgresFixture.ApplyMigrationsAsync(conn, 18);`, assert `select 1 from information_schema.columns where table_name = 'cards' and column_name = 'mcq'` returns no row (the fallback is really exercised), seed directly through `DbUtil` (`users(user_sub)`, `decks(slug, title, author)`, `cards(deck_id, stable_uid, question, order_in_deck)`, `user_progress_events(event_id, user_sub, deck_slug, stable_uid, rating, event_time)` with `event_time = now() - interval '1 hour'`), then `ContentIntelligence.QueryLiveCardsAsync(conn, 7, slug, sub, true, 100)` returns exactly one row with `cardStableUid` == the seeded uid, and `ContentIntelligence.CountMcqCardsAsync(conn, slug, sub, true)` returns `0`. Dispose the connection; the scratch database may be left (the fixture drops it with `force` on the next run).

Each test mints its own subs/slugs (`Guid.NewGuid():N`) — the suite is rerunnable against a dirty container. No `Skip`, no `Thread.Sleep`, no log probing.

### 3. `frontend/src/api/authoring.ts`

Inside `ContentIntelligenceData.summary` (base `:653-661`), after `difficultyOverstated: number;`, append exactly:
```ts
    mcqCardCount?: number;
```
Optional on purpose: an older Lambda omits it, and `tests/contentIntelligencePage.test.tsx:127-139` builds summary literals without it. No other change to this file (C06/C12's edits to `createCard`/`updateCard` are already on your tree — rebase, do not re-apply). No new export (`tests/apiSurfaceCensus.test.ts` counts them).

### 4. `frontend/src/pages/ContentIntelligencePage.tsx`

a. After `const summary = state.data?.summary;` (`:193`) add `const mcqCardCount = summary?.mcqCardCount ?? 0;`.

b. Between the error banner's closing `) : null}` (`:265`) and `<section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">` (`:267`) insert, as a sibling (never inside the grid section):
```tsx
        {mcqCardCount > 0 ? (
          <div
            data-testid="content-intelligence-mcq-banner"
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          >
            {`${mcqCardCount} MCQ card${mcqCardCount === 1 ? '' : 's'} in scope are not assessed by the Q/A model.`}
          </div>
        ) : null}
```
The `data-testid`, the className string and the sentence are C00 §2.12 literals — verbatim. Nothing else in the file changes: no new hook, no new effect, no tile, no change to the `contentQualityStatus` union (the live path never returns an MCQ row, and snapshot rows are Phase 5).

### 5. `frontend/tests/contentIntelligenceMcqBanner.test.tsx` (new, `// @vitest-environment jsdom`)

Mock and mount exactly as `contentIntelligencePage.test.tsx:54-64` / `:188-196` (`vi.hoisted` api object, `vi.mock('../src/api/authoring', …)` spreading `importOriginal`, top-level `await import('../src/pages/ContentIntelligencePage')`, `renderAt(<ContentIntelligencePage />, ['/content-intelligence'])`, `beforeEach`: `signOut(); signInAsSuperAdmin(); api.fetchDecks.mockResolvedValue(ok([]))`; `afterEach`: `cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); signOut()`). A `payload(mcqCardCount?: number): ContentIntelligenceData` helper returns `cards: []` and a seven-key summary (any numbers), spreading `mcqCardCount` only when it is defined (an absent key, not `undefined`, is the "older server" case). Wait for the first paint with `await waitFor(() => expect(document.querySelector('tbody')?.textContent ?? '').not.toContain('Loading…'))`. Banner reader: `document.querySelector('[data-testid="content-intelligence-mcq-banner"]')`. Five cases, titles verbatim:

1. `it('shows the MCQ banner with the count from the server summary', …)` — `payload(2)`; banner present; `textContent` is exactly `2 MCQ cards in scope are not assessed by the Q/A model.`
2. `it('uses the singular form for exactly one MCQ card', …)` — `payload(1)`; text exactly `1 MCQ card in scope are not assessed by the Q/A model.`
3. `it('renders no banner when mcqCardCount is zero', …)` — `payload(0)`; reader returns `null`.
4. `it('renders no banner when the summary has no mcqCardCount', …)` — `payload()`; reader returns `null`.
5. `it('keeps the six summary tiles outside the banner', …)` — `payload(2)`; `document.querySelectorAll('section.grid > div')` has length 6 and `document.querySelector('section.grid [data-testid="content-intelligence-mcq-banner"]')` is `null`.

### 6. `snowflake/001_content_intelligence_setup.sql`

a. `staging.stg_review_events` — after `:79` (`… as app_version,`) and before `:80` (`… as offline_queue_delay_ms,`) insert, in this order, byte for byte:
```sql
  coalesce(src:payload:card_format::string, src:card_format::string, 'qa') as card_format,
  coalesce(src:payload:client_features, src:client_features) as client_features,
  coalesce(src:payload:update_id::string, src:update_id::string) as update_id,
  iff(coalesce(src:payload:card_format::string, src:card_format::string, 'qa') = 'mcq' and coalesce(array_contains('mcq'::variant, coalesce(src:payload:client_features, src:client_features)), false), 'mcq', 'qa') as answer_mode,
```
(`answer_mode` is `'mcq'` only when the card is MCQ **and** the client advertised the `mcq` capability; a Wave C client sends no `client_features`, so everything reads `'qa'` — the honest label for a client that rendered the stem as a flashcard. C14 later makes the key real; nothing here changes then.)

b. `staging.card_observations` — after `app_version` (`:109`, which gains a trailing comma) append `card_format,`, `answer_mode,`, `client_features,`, `update_id` (last, no comma). Filters `:111-116` unchanged.

c. `marts.mart_card_quality_daily`:
   - `user_baseline` (`:131-138`): select `answer_mode,` after `user_id_hash,`; `group by user_id_hash, answer_mode`.
   - `expected_by_difficulty` (`:139-151`): select `answer_mode,` after `stated_difficulty,`; `group by event_date, deck_slug, stated_difficulty, answer_mode`.
   - `card_stats` (`:152-180`): select `e.answer_mode,` after `e.stated_difficulty,` (`:158`); the join at `:178` becomes `left join user_baseline ub on ub.user_id_hash = e.user_id_hash and ub.answer_mode = e.answer_mode`; `group by e.event_date, e.deck_slug, e.card_stable_uid, e.card_revision, e.stated_difficulty, e.answer_mode`.
   - `scored` (`:181-195`): the join gains a fourth line `and b.answer_mode = cs.answer_mode`.
   - Final select: `answer_mode` reaches the output through `cs.*` → `*`; do not add an explicit column.
   - `content_quality_status` CASE (`:204-220`): insert `when answer_mode = 'mcq' then 'MCQ · Not Assessed'` as the **first** arm, directly before `when review_count < 30 then 'Needs More Data'` (`:205`). The five existing arms are byte-identical (they are now reached only by `'qa'` rows — that is how "the four Q/A rules are restricted to `answer_mode = 'qa'`" is implemented; do not also wrap each arm). `difficulty_calibration_status` (`:198-203`) is not changed.

d. `marts.mart_card_revision_impact` (`:242-294`): `revision_rollup` gains `where answer_mode = 'qa'` between `from marts.mart_card_quality_daily` (`:257`) and `group by …` (`:258`).

e. `marts.mart_deck_health_daily` (`:296-313`): append `count_if(content_quality_status = 'MCQ · Not Assessed') as mcq_not_assessed_count` as the last column after `max(fix_priority_score) as max_fix_priority_score` (`:311`, which gains a trailing comma). `card_count` (`:303`) keeps counting every row.

Nothing else in the file changes. File stays UTF-8 (the middle dot in `MCQ · Not Assessed` is U+00B7, the same character C00 and the wave plan use).

### 7. `snowflake/README.md`

Under `## Snowflake setup` (`:32-40`), after the placeholder list, add one paragraph (3–8 lines) that says: the file is applied by hand and must be **re-run after every edit** (every view and dynamic table is `create or replace`, so re-running is idempotent); the 2026-09 edit added `card_format`, `answer_mode`, `client_features`, `update_id` to `staging.stg_review_events` and `staging.card_observations`; `answer_mode` is `'mcq'` only when `card_format = 'mcq'` and the event's `client_features` contains `'mcq'`, else `'qa'`; the quality mart's baselines group by `answer_mode`, MCQ rows carry `content_quality_status = 'MCQ · Not Assessed'`, `mart_card_revision_impact` reads `'qa'` rows only and `mart_deck_health_daily` gains `mcq_not_assessed_count`. Do not backtick any repo path that does not exist; this README is not scanned by `docsPaths`, but keep the habit.

Estimated size: ContentIntelligence.cs ~60 changed lines (mostly the string-to-builder move), test class ~220 lines, authoring.ts 1 line, page ~10 lines, banner test ~90 lines, SQL ~20 lines, README ~8 lines.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C13.verify.sh` re-runs exactly these (steps 1–5).

1. Scope files exist: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentIntelligenceMcqTests.cs` and `frontend/tests/contentIntelligenceMcqBanner.test.tsx` (both absent on the base — the step that fails there); the C10 prerequisite `src_C/Vpc/Db/Migrations/019_cards_mcq.sql` exists.
2. Literal guards (all `grep -F`, exit 0):
   - `ContentIntelligence.cs`: `using Npgsql;`, `private static string BuildLiveSql(bool withMcqFilter)`, `and c.mcq is null`, `internal static async Task<List<Dictionary<string, object?>>> QueryLiveCardsAsync(`, `internal static async Task<int> CountMcqCardsAsync(`, `c.mcq is not null`, `admin_deck_permissions p on p.deck_id = d.id and p.admin_sub = $2 and p.can_read = 1`, `pg.SqlState == "42703"` (≥ 2 occurrences), `mcqCardCount`; the line after `difficultyOverstated = CountStatus(` is `mcqCardCount,` (last summary key); `const string snapshotSql` occurs once and no removed line of the diff mentions `content_intelligence_card_snapshot` or `snapshotSql`; `BuildResponse(cards, days, deckSlug, mcqCardCount)` occurs twice; no `information_schema` in the source file.
   - `ContentIntelligenceMcqTests.cs`: `[Collection(PostgresCollection.Name)]`, `public class ContentIntelligenceMcqTests`, the four `[Fact]` names of change 2, `CreateScratchDatabaseAsync(`, `ApplyMigrationsAsync(conn, 18)`, `information_schema.columns`, `QueryLiveCardsAsync(`, `CountMcqCardsAsync(`, `LambdaHost.PostProgressEventsAsync(`, `["days"] = "7"`; no `Skip =`, no `Thread.Sleep`.
   - `authoring.ts`: `mcqCardCount?: number;`.
   - `ContentIntelligencePage.tsx`: `data-testid="content-intelligence-mcq-banner"`, `rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800`, `in scope are not assessed by the Q/A model.`, `const mcqCardCount = summary?.mcqCardCount ?? 0;`; exactly two lines that begin with `useEffect(` (`:154`, `:170` today — the comment at `:133` also contains the token and is not counted).
   - `contentIntelligenceMcqBanner.test.tsx`: `// @vitest-environment jsdom`, the five `it('…'` titles of change 5, `section.grid > div`, `2 MCQ cards in scope are not assessed by the Q/A model.`, `1 MCQ card in scope are not assessed by the Q/A model.`.
   - `001_content_intelligence_setup.sql`: non-empty and ≥ 325 lines (314 on base + the 15 lines change 6 adds); the four `stg_review_events` lines of change 6a verbatim, in that order, between `as app_version,` and `as offline_queue_delay_ms,`; inside `card_observations` (between its `create or replace view` and `from staging.stg_review_events`) the lines `card_format,`, `answer_mode,`, `client_features,`, `update_id`; `group by user_id_hash, answer_mode`; `group by event_date, deck_slug, stated_difficulty, answer_mode`; `and ub.answer_mode = e.answer_mode`; `group by e.event_date, e.deck_slug, e.card_stable_uid, e.card_revision, e.stated_difficulty, e.answer_mode`; `and b.answer_mode = cs.answer_mode`; `when answer_mode = 'mcq' then 'MCQ · Not Assessed'` immediately before the quality CASE's `when review_count < 30 then 'Needs More Data'`; `where answer_mode = 'qa'`; `count_if(content_quality_status = 'MCQ · Not Assessed') as mcq_not_assessed_count`; no `app_version >=` / `app_version >` keying; `snowflake/002_mcq_marts.sql` does not exist.
   - `snowflake/README.md`: mentions `create or replace`, `answer_mode`, `client_features`, `mcq_not_assessed_count`.
   - No `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in any scope file.
3. Frontend gate (exit 0): `cd frontend && npm run lint && npm run build`.
4. Targeted tests (exit 0): `cd frontend && npx vitest run tests/contentIntelligenceMcqBanner.test.tsx tests/contentIntelligencePage.test.tsx tests/apiSurfaceCensus.test.ts tests/consoleDirectoryLayout.test.ts tests/docsPaths.test.ts --reporter=dot` (the new file has 5 `it(` blocks; the old one still 33); then, with Docker running, `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~ContentIntelligenceMcqTests"` — 4 passed.
5. Scope + frozen guard (exit 0): `git diff --numstat $(git merge-base HEAD delivery/r16-c-economy) -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json src_C/Vpc/Runtime/ProgressEvents.cs src_C/Vpc/Db/Migrations src_C/Vpc/Analytics src_C/Worker frontend/src/lib/cardRules.ts frontend/package.json frontend/package-lock.json frontend/tests/contentIntelligencePage.test.tsx src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsSingleStatementTests.cs` is empty, and the union of `git diff --name-only <merge-base>` and the pathspec-scoped untracked scan over `src_C/Vpc src_C/Worker src_C/Tests src_C/Shared frontend/src frontend/tests docs snowflake mobile/src mobile/tests` contains only the seven scope files (plus anything under `docs/delivery/r16-issues/`).

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C13.verify.sh
```
Runtime ≈ 3–5 min: lint + build ≈ 15 s, frontend vitest ≈ 5 s, `dotnet test` ≈ 2–4 min (implicit restore from the local NuGet cache, build of five projects, one Testcontainers Postgres start). Docker must be running or step 4 fails with a clear message. The Snowflake SQL is not executed anywhere — its checks are non-empty + literal greps, and the owner applies the file by hand after the wave (`docs/delivery-wave-1.6-plan-2026-09-19.md:121`).

The driver then runs the full root gates in addition — `frontend`: `npm run lint && npx vitest run && npm run build`; `src_C`: `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (whole project, Docker) — plus the diff-scoped banned-term grep and the suppression scan. A verify pass is necessary, not sufficient.

## Do NOT

- Do NOT edit `src_C/Vpc/Runtime/ProgressEvents.cs`, any file under `src_C/Vpc/Analytics/` or `src_C/Vpc/Db/Migrations/`, or `ProgressEventsSingleStatementTests.cs`.
- Do NOT touch the snapshot SQL (`:31-91`), `SnapshotAvailableAsync`, or `content_intelligence_card_snapshot` in any way; do NOT add `answer_mode` to the snapshot table or its import (Phase 5, migration 020).
- Do NOT put the banner inside the tile grid, add a seventh tile, add a `useEffect`, or call `setState` for it; do NOT change the six tile labels or their order.
- Do NOT make `mcqCardCount` required on the TS type; do NOT add `'MCQ · Not Assessed'` to the `contentQualityStatus` union.
- Do NOT create `snowflake/002_*.sql`, do NOT key `answer_mode` on `app_version`, do NOT wrap the four Q/A arms individually, do NOT change `difficulty_calibration_status`.
- Do NOT edit any top-level `docs/*.md` (C15), `frontend/tests/contentIntelligencePage.test.tsx`, or anything under `mobile/`.
- Do NOT quote exam-style MCQ text in fixtures; the C# blob is shape-only placeholder text.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no `npm install`/`dotnet restore`, no test gutting (`.skip`, `.only`, `Skip =`, `@ts-ignore`, `eslint-disable`).
