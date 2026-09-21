# C09 — MCQ P1b: page/preview select, pre-enqueue gate, Worker `Mcq` export (`mcq-server-publish-worker`)

Finish the server half of MCQ after C08 landed the column and the API: the two remaining `cards` readers on the Vpc side (`CardsPage.cs` and `Publish.cs`) learn `mcq` and hand it to the console as a JSON object, publish refuses to enqueue a deck whose stored MCQ blob no longer passes the rules, and the Worker carries `mcq` end to end — `CardExportData.Mcq` (`JsonElement?`, omitted when null so Q/A decks stay byte-identical), a `LoadCardsAsync` that survives a database without 018/019 (42703 fallback), `DeckDiff.McqEquals` (structural, `JsonNode.DeepEquals`) and `PreviousCardDocument.Mcq` so delta patches neither churn nor drop the field. Golden-bytes tests pin the PG key order `v, options, shuffle, qualifier` / `key, why, text, correct`. Root `src_C`; deps C08 (which deps C05); pure C#, Docker required for the two DB test classes.

## Context

Base is `delivery/r16-c-economy` (= `main@52594fe`). Every line number below was read on that base on 2026-09-21. **Your worktree is cut after C05 and C08 merged**, so the eight files C05 touches (`CardsPage.cs`, `Publish.cs`, `IS3DeckUploader.cs`, `PublishJobProcessor.cs`, `DeckDiff.cs`, `ContentArtifactsGenerator.cs`, both test files) have shifted by a few lines — locate every edit by the quoted anchor text, not by the number. Where this brief says "after C05: …" that is what you will find on your tree; confirm with `git log --oneline -8` and the greps in Read first.

What the tree looks like today (base):

- **`src_C/Vpc/Authoring/CardsPage.cs`** — `BuildPageQuery` select `:129-147` is the 15-column projection duplicated on purpose from `Cards.cs` (header comment `:15-20`: a select list is a wire contract; C05/C09 must add `topic`/`mcq` to *both* copies). Rows come back at `:80` and go into the `{items, nextCursor, hasMore}` envelope at `:97-102` untouched. After C05 the last column is `c.topic` (after `c.updated_at    as "updatedAt"`).
- **`src_C/Vpc/Authoring/Publish.cs`** — handler `:87-315`. `:19` `PublishJobQueueUrl` is a `static readonly` read once at type init; `:98` returns `CONFIG_ERROR` in `mode=publish` when it is empty, **before the connection opens**. Cards select `:154-168` (9 columns, local `const string cardsSql`), loaded at `:170`; `baseCards` anonymous projection `:180-191` (`?? string.Empty` for the string fields; after C05 also `topic = …`); preview return `:204-215`; the ONLY pre-enqueue check today is the duplicate-job query `:221-237`; `insert into deck_publishes` `:259-264`; SQS send `:280-298`; catch arms `:306-314` (`ValidationError → VALIDATION_ERROR`, everything else 500 — Publish does not call `Helpers.HandlePgError`).
- **Row cells.** `src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:24` fills rows with `reader.GetValue(i)`, so a jsonb column arrives as a .NET `string` in PG's text form — `{"v": 1, "options": [{"key": "a", …}], "shuffle": true, "qualifier": null}` with `": "` / `", "` separators and PG's key order (length, then bytes; `docs/mcq-card-type-plan-2026-09-18.md:92`). `Res.JsonOptions` (`src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-99`, `DefaultIgnoreCondition.Never`) would emit that string as a JSON-encoded string. C08 added `Helpers.JsonbElement(row, key)` / `Helpers.JsonbCell(row, key)` (C00 §2.9.3: an OWN copy via `JsonSerializer.Deserialize<JsonElement>(s)`, never `JsonDocument.Parse(...).RootElement`) and applied them in `Cards.cs`; C09 applies them to the page and the preview. Parameters bind through `AddWithValue` (`DbUtil.cs:63-68`) as `text`, so a jsonb write needs `$n::jsonb` (`SqlUtil.ToNpgsql`, `src_C/Shared/RecallSmith.Lambda.Common/SqlUtil.cs:7-10`, rewrites it to `@pn::jsonb`).
- **`src_C/Worker/S3/IS3DeckUploader.cs:50-61`** `CardExportData`: nine properties, no attributes, property order = export key order. After C05: `using System.Text.Json.Serialization;` at `:1` and `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Topic { get; set; }` after `Revision`. `src_C/Worker/Content/ContentJson.cs:11-15` (`CamelCase`, `WriteIndented = false`, **no null-ignore**) serialises deck.json (`src_C/Worker/S3/S3DeckUploader.cs:74`), chunks, package and delta (all embed `List<CardExportData>`, `src_C/Worker/Content/ContentModels.cs:22-70`), so the attribute on `Mcq` is what keeps the two live decks byte-identical after redeploy (the owner's post-deploy check, `docs/delivery-wave-1.6-plan-2026-09-19.md:121`).
- **`src_C/Worker/Services/PublishJobProcessor.cs:89-160`** private `LoadDeckDataAsync`: cards select `:119-133`, mapper `:137-148` (the string fields use `?? string.Empty` — the pattern you must **not** copy for `Topic`/`Mcq`). No 42703 handling: a select naming a column the database lacks throws out of `ProcessAsync` (`:50`) and the job is FAILED. After C05 the select ends `revision,\n topic` and the mapper has `Topic = c.TryGetValue("topic", out var tp) ? tp as string : null,`.
- **42703 precedents.** `src_C/Vpc/Authoring/ManifestRebuild.cs:153-189` (try the v3 column list, `catch (PostgresException pg) when (pg.SqlState == "42703")` at `:174`, re-run the legacy list on the same connection) and `src_C/Worker/Services/ContentArtifactsGenerator.cs:93`, `:108`, `:126`. A failed statement outside a transaction leaves the Npgsql connection usable for the retry — that is exactly what ManifestRebuild relies on.
- **Why the Worker must tolerate two older schemas.** `src_C/deploy.sh:10-11`: migrations are not run by deploy; the owner runs them afterwards from the console. `src_C/Vpc/Db/Migrate.cs:73-94` `ApplyOne` commits each file in its own transaction, so a failed 019 leaves a real, persistent 018-only database. The Worker therefore sees three shapes in the wild: pre-018, 018-only, full.
- **`src_C/Worker/Content/DeckDiff.cs:60-71`** `CardChanged`: nine ordinal compares; comment `:17` "9 个卡片字段" (after C05: a `Topic` compare and "10"). A raw-string compare of `mcq` would mark every MCQ card `updated` on every publish (PG spacing on the DB side, compact bytes on the deck.json side — `docs/mcq-card-type-plan-2026-09-18.md:116`); not comparing at all would keep an options/WHY-only edit from reaching patched clients. Hence structural `JsonNode.DeepEquals`.
- **`src_C/Worker/Services/ContentArtifactsGenerator.cs:196-211`** reads the previous SUCCESS build's deck.json into `PreviousDeckDocument` (`:291-294`) / `PreviousCardDocument` (`:296-307`, private, all-nullable, unknown keys ignored) and maps it at `:258-284`. Without `Mcq` there, every MCQ card diffs as changed forever and patches drop the field. After C05 both carry `Topic`.
- **Tests.** `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs` — golden `CardJson` `:28-29`, its six consumers `:31-157`; after C05 also `Card_WithTopic_AppendsTopicLast`. `DeckDiffTests.cs` — `MakeCard` `:11-34`, `SingleFieldMutations` `:115-126` (comment `:117` "8 个字段"; after C05 a `topic` row and "9"). `IntegrationTestBase.cs:118-128` `CreateScratchDatabaseAsync` + `:136-155` `ApplyMigrationsAsync(conn, maxVersion)` (precedent `Migration015BackfillTests.cs:24-33`). `CardsPageTests.cs:38-53` seed helpers, `:66-98` real API-Gateway event with JWT groups + direct handler call. `src_C/Vpc/AssemblyInfo.cs:11` `InternalsVisibleTo("RecallSmith.Lambda.IntegrationTests")` (Vpc only; the Worker has none, which is why `LoadCardsAsync` is `public`).
- **Why the gate is not exercised through `mode=publish` in tests** (C00 gap, resolved here). `Publish.cs:98` answers `CONFIG_ERROR` before the gate whenever `PUBLISH_JOB_QUEUE_URL` is empty, and the value is captured once (`:19`). Setting that env var in the test process is not an option: `src_C/Vpc/Warmup.cs:207-236` then makes a real `GetQueueAttributes` call, and `DbWarmupTests.cs:343` / `WarmupDecisionTests.cs:69` silently early-return. Decision: the gate is a pure `internal static Publish.FirstMcqGateFailure(rows)` tested against rows read with the production `Publish.CardsSql`; the handler test covers `mode=preview` (not gated, `mcq` echoed as an object); the publish-mode wiring is pinned structurally by the verify (`mode == "preview"` → `FirstMcqGateFailure(cardRows)` → `checkDuplicateSql`, in that order, exactly one `"MCQ_PUBLISH_GATE"` literal).
- **Fallback depth** (C00 §2.9.4 says "re-runs the 9-column legacy SELECT"; C00 §3.2 says "on a 018-only schema returns `Topic` set and `Mcq == null`"). Both hold only with a three-step fallback (11 → 10 → 9 columns), which is also the only version that keeps `topic` in a published deck while a failed 019 is being repaired. That is what this brief specifies.

What C00 decided (binding): §0 byte-identity (`WhenWritingNull`, DB NULL → C# null, golden `CardJson` untouched); §2.9.1 canonical shape and PG key order; §2.9.3 `JsonbElement`/`JsonbCell` signatures; §2.9.4 every signature repeated verbatim below; §6 #2 `Mcq` goes after `Topic` (last); §6 #13 the preview may show `"mcq": null` — byte identity is asserted on `CardExportData` only; §6 #14 the gate applies to publish only, never `mode=preview`. `McqValidation.Canonicalize(JsonElement raw, string? question)`, `McqValidation.IsMcqDifficulty(int)` and `McqValidationError.Code` are C08's (C00 §2.9.2) — you rely on those three names only. (C00 declares `McqValidationError : ValidationError`, but `ValidationError` is `sealed` at `src_C/Shared/RecallSmith.Lambda.Common/Validation.cs:8`; whichever base class C08 chose, `catch (McqValidationError ex)` inside the gate works and nothing leaks to the outer arms.)

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0, §1.2 (the C09 column), §2.9.1–§2.9.4 (whole), §3.1 "C09", §3.2 (the two C09 bullets), §5, §6 #1, #2, #13, #14.
2. `src_C/Vpc/Authoring/Publish.cs:15-31` (statics), `:80-85` (`InferTier`, where the new function goes), `:87-115` (handler head, `:98` config check), `:154-215` (select → preview return), `:217-237` (duplicate-job check), `:306-314` (catch arms).
3. `src_C/Vpc/Authoring/CardsPage.cs:9-28` (why the projection is duplicated), `:79-102`, `:129-147`.
4. On your tree: `grep -n "JsonbElement\|JsonbCell" src_C/Vpc/Authoring/Helpers.cs` and `grep -n "Canonicalize\|IsMcqDifficulty\|class McqValidationError\|Code" src_C/Vpc/Authoring/McqValidation.cs` (C08); `grep -n "topic\|Topic" src_C/Vpc/Authoring/Publish.cs src_C/Vpc/Authoring/CardsPage.cs src_C/Worker/S3/IS3DeckUploader.cs src_C/Worker/Services/PublishJobProcessor.cs src_C/Worker/Content/DeckDiff.cs src_C/Worker/Services/ContentArtifactsGenerator.cs` (C05).
5. `src_C/Worker/S3/IS3DeckUploader.cs:47-61`; `src_C/Worker/Content/ContentJson.cs:11-17`; `src_C/Worker/S3/S3DeckUploader.cs:70-76`.
6. `src_C/Worker/Services/PublishJobProcessor.cs:86-160`; `src_C/Vpc/Authoring/ManifestRebuild.cs:153-189`; `src_C/Worker/Services/ContentArtifactsGenerator.cs:1-8`, `:85-135`, `:196-211`, `:258-307`.
7. `src_C/Worker/Content/DeckDiff.cs:1-19`, `:60-71`; `src_C/Worker/Content/ContentModels.cs:22-70`.
8. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs:1-158` and `DeckDiffTests.cs:1-176` (whole — you append to both).
9. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:27-53`, `:81-98`, `:112-165`; `Migration015BackfillTests.cs:17-33`; `CardsPageTests.cs:24-99`.
10. `src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:8-30`, `:53-71`; `src_C/Shared/RecallSmith.Lambda.Common/SqlUtil.cs:5-11`; `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-99`, `:159-163` (`Ok`, `BadRequest`).
11. `src_C/Vpc/Warmup.cs:198-236`, `src_C/Tests/RecallSmith.Lambda.IntegrationTests/DbWarmupTests.cs:338-343`, `WarmupDecisionTests.cs:60-69` (why no test may set `PUBLISH_JOB_QUEUE_URL`).
12. `docs/mcq-card-type-plan-2026-09-18.md:76-92` (§3.2 shape + key-order rule), `:94-103` (§3.3), `:105-112` (§3.4), `:114-116` (§3.5), `:118-120` (§3.6); `:172-254` (§4.3 — the only MCQ prose any fixture may quote).
13. `src_C/Vpc/Db/Migrate.cs:73-94`; `src_C/deploy.sh:8-11`.

## Constraints

- **Scope (the ONLY files that may change):** `src_C/Vpc/Authoring/CardsPage.cs`, `src_C/Vpc/Authoring/Publish.cs`, `src_C/Worker/S3/IS3DeckUploader.cs`, `src_C/Worker/Services/PublishJobProcessor.cs`, `src_C/Worker/Content/DeckDiff.cs`, `src_C/Worker/Services/ContentArtifactsGenerator.cs`, `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs` (add-only), `src_C/Tests/RecallSmith.Lambda.IntegrationTests/DeckDiffTests.cs` (add-only), `src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishMcqGateTests.cs` (new), `src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishJobProcessorSchemaTests.cs` (new). Nothing else: not `Cards.cs`, `Helpers.cs`, `McqValidation.cs` (C08), not the migrations, not `ProgressEvents.cs` (C10), not `ContentIntelligence.cs` (C13), not `src_C/Shared/**`, no `.csproj`, no `AssemblyInfo.cs`, nothing under `mobile/`, `frontend/`, `snowflake/`, `docs/` (C15 owns the docs).
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Server issue: nothing under `mobile/` changes at all.
- **OTA / no-dependency rule:** `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json` untouched. No NuGet package added or bumped anywhere (`System.Text.Json` and `System.Text.Json.Nodes` are in the net8.0 BCL; `Npgsql` reaches the Worker through `Shared/Db`).
- **Byte identity:** the golden `CardJson` literal in `ContentSerializationContractTests.cs:28-29` and its six existing consumers stay byte-identical; `Mcq` carries `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`; the Worker maps DB NULL to C# null — never `?? string.Empty`, never an empty `JsonElement`. `deck.json`/package/delta/manifest `schemaVersion`s unchanged; the manifest gains no key.
- **Key order:** `Mcq` is the LAST property of `CardExportData` (after `Topic`). A card serialises as `…,"revision":1,"topic":"t","mcq":{…}}` with both, `…,"revision":1,"mcq":{…}}` with mcq only, `…,"revision":1}` with neither.
- **No `JsonDocument.Parse(...).RootElement`** anywhere you touch (the document would be disposed before serialisation); `JsonSerializer.Deserialize<JsonElement>(s)` only.
- **Gate placement:** publish only — after the `mode == "preview"` return, before the duplicate-job check; exactly one `res.BadRequest("MCQ_PUBLISH_GATE", …)`; the `CONFIG_ERROR` check at `:98` keeps its position.
- **Tests:** never set `PUBLISH_JOB_QUEUE_URL` (or any env var) in a test; never reference that name in the new test files. DB classes carry `[Collection(PostgresCollection.Name)]`. Scratch databases are named `c09_pre018` / `c09_only018` (unique per test, `mig015` is taken). Fixture strings are plain ASCII letters/digits/spaces (the default `JavaScriptEncoder` escapes non-ASCII and `<>&'+`, which would make goldens unreadable); never copy exam-dump text — the only quotable MCQ prose is `docs/mcq-card-type-plan-2026-09-18.md:172-254`, and the short synthetic words pinned below are what the goldens use.
- **Existing tests:** `ContentSerializationContractTests.cs` and `DeckDiffTests.cs` are add-only (every existing `[Fact]`, the `CardJson` const and C05's `Card_WithTopic_AppendsTopicLast` / `topic` row stay byte-identical; `MakeCard` may gain one optional trailing parameter). No other existing test file changes — in particular `CardsPageTests.cs`, `CardsAuthoringMcqTests.cs`, `McqValidationTests.cs`, `ProgressEventsSingleStatementTests.cs`.
- **Banned literals in any added line:** the six terms of B00 §0 (driver gate; write "sidestep", "work around", "guard", "fallback", "probe" instead). No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`, and no `Skip =` on a `[Fact]`/`[Theory]`.
- **dotnet / Docker notes:** `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~PublishMcqGateTests"` builds Vpc + Worker + tests and starts one `postgres:16-alpine` Testcontainer (image cached on this machine; Docker must be running — `docker info`). The implicit restore reads the local NuGet cache; do not run `dotnet restore --force`, `dotnet add package`, or anything that needs the network. Pure classes (`ContentSerializationContractTests`, `DeckDiffTests`) run without Docker. New migrations reach the test bin through the Vpc `ProjectReference` (`<None Include="Db\Migrations\*.sql">`), so `ApplyMigrationsAsync(conn, maxVersion: 18)` sees `018_cards_topic.sql` after a build.

## Changes required

1. **`src_C/Vpc/Authoring/CardsPage.cs`**
   a. `BuildPageQuery` select: turn C05's last line `        c.topic` into `        c.topic,` and add `        c.mcq` as the new last column, directly before `      from cards c`. Unaliased, like `c.topic` (the column name is already the wire name).
   b. Handler: after `var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);` (`:80`) add
      ```csharp
      // jsonb arrives from DbUtil as PG text; the console reads an object (C08's JsonbCell).
      foreach (var row in rows) Helpers.JsonbCell(row, "mcq");
      ```
      The cursor arithmetic (`:87-95`) and the envelope (`:97-102`) are untouched. `"mcq": null` on Q/A cards is correct.

2. **`src_C/Vpc/Authoring/Publish.cs`**
   a. Lift the select: delete the local `const string cardsSql = """…""";` (`:154-168`) and add a class member directly above `HandleAuthoringPublish`:
      ```csharp
      /// <summary>
      /// The cards a publish exports, in export order. Internal so the gate test reads rows with
      /// the exact production text (jsonb comes back as PG text, and that is what the gate parses).
      /// </summary>
      internal const string CardsSql = """
        select
          stable_uid as "stableUid",
          order_in_deck as "orderInDeck",
          difficulty,
          question,
          explanation,
          code_language as "codeLanguage",
          code_snippet as "codeSnippet",
          real_world_usage as "realWorldUsage",
          revision,
          topic,
          mcq
        from cards
        where deck_id = $1 and is_deleted = 0
        order by order_in_deck asc, id asc
        """;
      ```
      and make `:170` read `var cardRows = await DbUtil.QueryAsync(conn, null, CardsSql, [deckIdInt]);`.
   b. `baseCards` (`:180-191`): after C05's `topic = …,` append `mcq = Helpers.JsonbElement(c, "mcq"),` (last member). The preview shows `"mcq": null` on Q/A cards — accepted (C00 §6 #13).
   c. Gate call, inserted after the `if (mode == "preview") { … }` block (`:204-215`) and before `Log.Info("[DEBUG] 1. Starting async publish logic.");` (`:219`):
      ```csharp
      // Pre-enqueue gate (publish only — the preview above has already returned). A stored MCQ
      // blob that no longer satisfies the API rules must not reach the Worker, which serialises
      // it verbatim into deck.json / chunks / patches.
      var gate = FirstMcqGateFailure(cardRows);
      if (gate is not null) return res.BadRequest("MCQ_PUBLISH_GATE", $"{gate.Value.StableUid}: {gate.Value.Code}");
      ```
   d. The gate itself, added after `InferTier` (`:80-85`), signature verbatim:
      ```csharp
      /// <summary>
      /// First card whose stored MCQ blob fails the publish rules, or null when every row passes.
      /// Pure (no IO). Rows arrive in order_in_deck order, so the first failure is deterministic.
      /// Order of checks per row (C00 §2.9.4): Canonicalize against the stem, then explanation
      /// non-blank (MCQ_EXPLANATION_REQUIRED), then difficulty 1..3 (MCQ_DIFFICULTY_RANGE).
      /// </summary>
      internal static (string StableUid, string Code)? FirstMcqGateFailure(IReadOnlyList<Dictionary<string, object?>> cardRows)
      {
        foreach (var c in cardRows)
        {
          var mcq = Helpers.JsonbElement(c, "mcq");
          if (mcq is null) continue;

          var stableUid = Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty;
          var question = Convert.ToString(c["question"], CultureInfo.InvariantCulture);
          var explanation = Convert.ToString(c.TryGetValue("explanation", out var ex) ? ex : null, CultureInfo.InvariantCulture);
          var difficulty = Convert.ToInt32(c.TryGetValue("difficulty", out var dif) ? (dif ?? 2) : 2, CultureInfo.InvariantCulture);

          try
          {
            McqValidation.Canonicalize(mcq.Value, question);
          }
          catch (McqValidationError mex)
          {
            return (stableUid, mex.Code);
          }

          if (string.IsNullOrWhiteSpace(explanation)) return (stableUid, "MCQ_EXPLANATION_REQUIRED");
          if (!McqValidation.IsMcqDifficulty(difficulty)) return (stableUid, "MCQ_DIFFICULTY_RANGE");
        }

        return null;
      }
      ```
   e. Nothing else moves: `:98` (`CONFIG_ERROR`), the duplicate-job check, the PENDING insert, the SQS send and both catch arms are byte-identical. No new `using` (`System.Text.Json` `:3`, `Npgsql` `:9`; `Helpers`, `McqValidation`, `McqValidationError` share the namespace).

3. **`src_C/Worker/S3/IS3DeckUploader.cs`** — add `using System.Text.Json;` as line 1 (above C05's `using System.Text.Json.Serialization;`), and append to `CardExportData` after `Topic`, as the LAST property:
   ```csharp
     [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
     public JsonElement? Mcq { get; set; }
   ```
   No other member moves.

4. **`src_C/Worker/Services/PublishJobProcessor.cs`**
   a. Add `using System.Text.Json;` and `using Npgsql;` to the using block.
   b. Three private select constants, same `FROM cards WHERE deck_id = $1 AND is_deleted = 0 ORDER BY order_in_deck ASC, id ASC` tail: `CardsSql` (the 11 columns `…, revision, topic, mcq`), `CardsSqlTopicOnly` (`…, revision, topic`), `CardsSqlLegacy` (the base text `:119-133` verbatim, 9 columns). All three are multi-line raw strings in exactly the layout of `:119-133` — `private const string CardsSql = """`, one column per line, so `CardsSql` has a `topic,` line followed by a bare `mcq` line and `CardsSqlTopicOnly` ends with a bare `topic` line (the verify counts those lines).
   c. New method (signature verbatim from C00 §2.9.4):
      ```csharp
      /// <summary>
      /// Cards of one deck in export order, tolerant of a database that has not yet run 018/019:
      /// the 11-column select runs first; a 42703 (undefined_column) retries the 018-only shape,
      /// a second 42703 the pre-018 shape. Each retry is a fresh statement on the same connection
      /// (no transaction, so the failed statement leaves it usable — the ManifestRebuild precedent).
      /// A column the schema lacks maps to null, never to "" (byte identity of existing decks).
      /// </summary>
      public static async Task<List<CardExportData>> LoadCardsAsync(NpgsqlConnection conn, int deckId)
      {
        List<Dictionary<string, object?>> cardRows;
        try
        {
          cardRows = await DbUtil.QueryAsync(conn, null, CardsSql, [deckId]);
        }
        catch (PostgresException pg) when (pg.SqlState == "42703")
        {
          try
          {
            cardRows = await DbUtil.QueryAsync(conn, null, CardsSqlTopicOnly, [deckId]);
          }
          catch (PostgresException pg2) when (pg2.SqlState == "42703")
          {
            cardRows = await DbUtil.QueryAsync(conn, null, CardsSqlLegacy, [deckId]);
          }
        }

        return cardRows.Select(c => new CardExportData
        {
          // …the nine existing initialisers of :139-147, byte-identical…
          Topic = c.TryGetValue("topic", out var tp) ? tp as string : null,
          Mcq = c.TryGetValue("mcq", out var m) && m is string s ? JsonSerializer.Deserialize<JsonElement>(s) : (JsonElement?)null,
        }).ToList();
      }
      ```
      The `Topic` line is C05's, kept verbatim; the `Mcq` line is verbatim from C00 (an owned element — a disposed `JsonDocument` would throw at `S3DeckUploader.cs:74`).
   d. `LoadDeckDataAsync`: replace the block `// 查询 cards` … `}).ToList();` (`:118-148`) with `var cards = await LoadCardsAsync(conn, deckId);`. Everything else in the file is byte-identical.

5. **`src_C/Worker/Content/DeckDiff.cs`**
   a. Add `using System.Text.Json;` and `using System.Text.Json.Nodes;` above `using RecallSmith.Lambda.Worker.S3;`.
   b. Comment `:17`: "10 个卡片字段" (C05) → "11 个卡片字段".
   c. `CardChanged`: append `|| !McqEquals(a.Mcq, b.Mcq)` after C05's `|| !string.Equals(a.Topic, b.Topic, StringComparison.Ordinal)` (move the `;`).
   d. New public method, signature verbatim:
      ```csharp
      /// <summary>
      /// Structural jsonb equality. The current side comes from DbUtil as PG text (": " spacing),
      /// the previous side from compact deck.json — raw strings never match, so compare as trees.
      /// </summary>
      public static bool McqEquals(JsonElement? a, JsonElement? b)
      {
        if (a is null && b is null) return true;
        if (a is null || b is null) return false;
        return JsonNode.DeepEquals(JsonNode.Parse(a.Value.GetRawText()), JsonNode.Parse(b.Value.GetRawText()));
      }
      ```

6. **`src_C/Worker/Services/ContentArtifactsGenerator.cs`** — `PreviousCardDocument`: add `public JsonElement? Mcq { get; set; }` after C05's `public string? Topic { get; set; }`; `MapPreviousCards`: add `Mcq = c.Mcq,` after `Topic = c.Topic,`. `using System.Text.Json;` is already at `:2`. Nothing else (the three 42703 arms, the size gate `:229-234`, the summary builder stay).

7. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs`** (add-only; add `using System.Text.Json;`). Two consts and a helper next to `CardJson`:
   ```csharp
   // What DbUtil hands back for a stored blob: PG jsonb text, PG key order, ": " / ", " spacing.
   private const string McqPgText =
     """{"v": 1, "options": [{"key": "a", "why": null, "text": "queue", "correct": true}, {"key": "b", "why": "no buffer", "text": "resize", "correct": false}, {"key": "c", "why": "one shard", "text": "stream", "correct": false}], "shuffle": true, "qualifier": null}""";

   // What ContentJson emits for it: same key order, compact.
   private const string McqJson =
     """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

   private static JsonElement Mcq(string json) => JsonSerializer.Deserialize<JsonElement>(json);
   ```
   Cases (set `Topic`/`Mcq` on the card returned by `MakeCard()` with property assignments so C05's signature does not matter):
   1. `Card_WithTopicAndMcq_AppendsMcqLast` — `card.Topic = "t"; card.Mcq = Mcq(McqPgText);` → `Assert.Equal(CardJson[..^1] + ""","topic":"t","mcq":""" + McqJson + "}", ContentJson.Serialize(card))`.
   2. `Card_WithMcqOnly_OmitsTopic` — `card.Mcq = Mcq(McqPgText);` (Topic null) → `CardJson[..^1] + ""","mcq":""" + McqJson + "}"`.
   3. `Card_WithMcq_RoundTripsThroughContentJson` — the bytes of case 1 deserialised with `JsonSerializer.Deserialize<CardExportData>(expected, ContentJson.Options)!` serialise back to exactly `expected`, and `card.Mcq!.Value.ValueKind == JsonValueKind.Object` (this is the previous-build read path: deck.json → `JsonElement` → `DeckDiff`).
   The existing `Card_SerializesExactCamelCaseFieldNames` is the "neither" case and stays as is. The facts that must survive byte-identical (the verify greps every name): `Card_SerializesExactCamelCaseFieldNames`, `Card_NullCodeLanguage_SerializesAsNull`, `DeckDelta_SerializesExactContractShape`, `DeckPackage_SerializesExactContractShape`, `DeckChunk_SerializesExactContractShape`, `DeckExportData_DeckJson_KeepsExistingCamelCaseShape`, and C05's `Card_WithTopic_AppendsTopicLast` and `Card_NullTopic_KeepsGoldenBytes` (with its literal `"revision":1,"topic":"t"}`). Add-only means the diff of this file has zero removed lines.

8. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/DeckDiffTests.cs`** (add-only; add `using System.Text.Json;`). `MakeCard` gains one trailing optional parameter `JsonElement? mcq = null` → `Mcq = mcq,`. Consts: `McqCompact` (= `McqJson` above), `McqPgSpaced` (= `McqPgText` above), `McqWhyChanged` (= `McqCompact` with option b's `"why":"no buffer"` → `"why":"no queue"`), helper `Mcq(string)`. Then:
   1. `SingleFieldMutations`: append `yield return new object[] { "mcq", MakeCard("a", mcq: Mcq(McqCompact)) };` and change the comment "9 个字段" (C05) → "10 个字段".
   2. `Compute_SameMcqDifferentSpacing_IsUnchanged` — prev `MakeCard("a", mcq: Mcq(McqCompact))`, next `MakeCard("a", mcq: Mcq(McqPgSpaced))` → `Added`, `Updated`, `Deleted` all empty.
   3. `Compute_McqOptionWhyChange_TriggersUpdated` — prev compact, next `McqWhyChanged` → exactly one `Updated`, nothing else.
   4. `McqEquals_BothNullEqual_OneNullDifferent` — `DeckDiff.McqEquals(null, null)` true; `(null, x)` and `(x, null)` false; `(compact, pgSpaced)` true.
   The facts that must survive byte-identical (the verify greps every name): `Compute_IdenticalDecks_IsNoOp`, `Compute_NewUid_IsAdded`, `Compute_MissingUid_IsDeleted`, `Compute_ChangedCard_IsUpdated_AndCarriesNextValues`, `Compute_MixedChanges_AllBucketsFilled_InNextOrder`, `Compute_AnySingleFieldChange_TriggersUpdated`, `Compute_CodeLanguageNullToValue_TriggersUpdated`, `Compute_EmptyPrev_AllAdded`, `Compute_EmptyNext_AllDeleted`, and C05's `Compute_TopicNullToValue_TriggersUpdated` with its row `{ "topic", MakeCard("a", topic: "changed") }`. The only two lines this file may lose are the `MakeCard` parameter line that gains the trailing `mcq` parameter and the `9 个字段` comment; nothing else is removed.

9. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishMcqGateTests.cs`** (new, `[Collection(PostgresCollection.Name)]`, `PostgresFixture _db` ctor injection like `CardsPageTests.cs:25-32`). Helpers: `NewDeckAsync` (`CardsPageTests.cs:38-45` verbatim, slug prefix `it-c09gate-`); `NewCardAsync(long deckId, int order, string uid, string question, string? explanation, int difficulty, string? mcqJson)` doing `insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, mcq) values ($1, $2, $3, $4, $5, $6, $7::jsonb)` — direct SQL on purpose: it sidesteps `Cards.cs`, which is how a blob written before a rule tightened looks; `Event(string method, string path, string sub, string[] groups, IDictionary<string,string>? query, string? body)` (the `CardsPageTests.cs:66-92` event with method and body parameterised); `LoadRowsAsync(deckId)` = `_db.QueryAsync(Publish.CardsSql, deckId)`. Consts `ValidMcq` (= `McqJson` of change 7) and `BadVersionMcq` (= `ValidMcq` with `"v":1` → `"v":2`, everything else identical so only the version rule fails); question `"Which service buffers a burst"`, explanation `"queue it"`. Cases:
   1. `Gate_InvalidStoredMcq_ReportsUidAndCode` — deck with a Q/A card (order 1), a valid MCQ card (order 2, difficulty 2) and `BadVersionMcq` (order 3, uid `bad-version`) → `Publish.FirstMcqGateFailure(await LoadRowsAsync(deckId))` equals `("bad-version", "MCQ_BAD_VERSION")`.
   2. `Gate_MissingExplanation_IsMcqExplanationRequired` — `ValidMcq`, explanation `null` → code `"MCQ_EXPLANATION_REQUIRED"` with that uid.
   3. `Gate_DifficultyOutOfRange_IsMcqDifficultyRange` — `ValidMcq`, explanation set, difficulty 4 → `"MCQ_DIFFICULTY_RANGE"`.
   4. `Gate_ValidMcqAndQaRows_Pass` — a Q/A card with difficulty 4 and null explanation (Q/A rules are untouched) plus a valid MCQ card → `null`.
   5. `Preview_IsNotGated_AndEchoesMcqAsObject` — deck with the three cards of case 1; `Publish.HandleAuthoringPublish(req, res, Auth.GetAuthContext(req))` with `POST`, path `/api/v1/authoring/publish`, query `["mode"] = "preview"`, body `{"deckId":<id>}`, groups `["super_admin"]` → 200; `data.export.cards` has 3 items; the valid card's `mcq` has `ValueKind == JsonValueKind.Object` and `GetProperty("v").GetInt32() == 1`; the Q/A card's `mcq` is `JsonValueKind.Null`; the bad-version card is present too (preview is not gated).
   6. `CardsPage_EchoesMcqAsObject` — same deck; `CardsPage.HandleAuthoringCardsPage` with `GET /api/v1/authoring/cards/page`, query `deckId`/`limit=50`, `["super_admin"]` → 200; `data.items[*].mcq` is `Object` for the MCQ cards and `Null` for the Q/A card.
   The file never mentions `PUBLISH_JOB_QUEUE_URL` and never calls `Environment.SetEnvironmentVariable`.

10. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishJobProcessorSchemaTests.cs`** (new, `[Collection(PostgresCollection.Name)]`). Scratch-database pattern `Migration015BackfillTests.cs:29-33` (`new Npgsql.NpgsqlConnection(connectionString)` + `PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: N)`); seed with `DbUtil.ExecuteAsync`/`QueryAsync` on that connection (`insert into decks (slug, title, author) … returning id`, then the card). `deckId` is `(int)` of the returned `long`. Cases:
   1. `LoadCards_PreTopicSchema_FallsBackToLegacyColumns` — scratch `c09_pre018`, `ApplyMigrationsAsync(conn, maxVersion: 17)`, one card inserted without `topic`/`mcq` (the columns do not exist) → `PublishJobProcessor.LoadCardsAsync(conn, deckId)` returns one card with `Question == "q"`, `Assert.Null(card.Topic)`, `Assert.Null(card.Mcq)`.
   2. `LoadCards_TopicOnlySchema_KeepsTopicAndNullMcq` — scratch `c09_only018`, `ApplyMigrationsAsync(conn, maxVersion: 18)`, card with `topic = 't'` → `Topic == "t"`, `Assert.Null(card.Mcq)`.
   3. `LoadCards_FullSchema_ParsesMcqAsOwnedElement` — the shared fixture database (`await _db.OpenAsync()`); insert one MCQ card with the blob written in **authoring order** `{"v":1,"qualifier":null,"shuffle":true,"options":[{"key":"a","text":"queue","why":null,"correct":true},{"key":"b","text":"resize","why":"no buffer","correct":false},{"key":"c","text":"stream","why":"one shard","correct":false}]}` (a `"""…"""` raw string so the bytes appear verbatim in the file) via `$n::jsonb`, plus one Q/A card → the MCQ card's `Mcq!.Value.ValueKind == JsonValueKind.Object` and `JsonSerializer.Serialize(card.Mcq.Value, ContentJson.Options)` equals the `McqJson` literal of change 7 exactly (PG re-orders to `v, options, shuffle, qualifier` / `key, why, text, correct` — the §3.2 claim, proven against a real planner); the Q/A card has `Topic == null && Mcq == null`.

Estimated size: CardsPage 4 lines, Publish ~60, IS3DeckUploader 3, PublishJobProcessor ~55 net, DeckDiff ~12, ContentArtifactsGenerator 2, contract tests ~45, diff tests ~50, gate tests ~200, schema tests ~120.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C09.verify.sh` re-runs exactly these.

- Scope files exist: the two new test files, plus the prerequisites `src_C/Vpc/Db/Migrations/018_cards_topic.sql`, `019_cards_mcq.sql`, `src_C/Vpc/Authoring/McqValidation.cs`, `JsonbElement` in `Helpers.cs`, `public string? Topic { get; set; }` in `IS3DeckUploader.cs`.
- Literal guards (exit 0):
  - `CardsPage.cs`: `c.topic,` then `c.mcq` on the next line; `Helpers.JsonbCell(row, "mcq")`.
  - `Publish.cs`: `internal const string CardsSql`; `topic,` then `mcq` on the next line inside it; `DbUtil.QueryAsync(conn, null, CardsSql, [deckIdInt])`; `mcq = Helpers.JsonbElement(c, "mcq"),`; `internal static (string StableUid, string Code)? FirstMcqGateFailure(IReadOnlyList<Dictionary<string, object?>> cardRows)`; `McqValidation.Canonicalize(`, `catch (McqValidationError`, `McqValidation.IsMcqDifficulty(`, `"MCQ_EXPLANATION_REQUIRED"`, `"MCQ_DIFFICULTY_RANGE"`; exactly one `"MCQ_PUBLISH_GATE"`; line order `if (mode == "preview")` < `FirstMcqGateFailure(cardRows)` < `checkDuplicateSql = `; `:98`'s `if (mode == "publish" && string.IsNullOrEmpty(PublishJobQueueUrl))` still present; no `cardsSql` local left.
  - `IS3DeckUploader.cs`: `using System.Text.Json;`; `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` immediately above `public JsonElement? Mcq { get; set; }`; `Topic` declared before `Mcq`; the next non-blank line after `Mcq` is `}`.
  - `PublishJobProcessor.cs`: `using Npgsql;`, `using System.Text.Json;`; `public static async Task<List<CardExportData>> LoadCardsAsync(NpgsqlConnection conn, int deckId)`; `CardsSql`, `CardsSqlTopicOnly`, `CardsSqlLegacy`; at least two `SqlState == "42703"`; the `Topic = c.TryGetValue("topic", out var tp) ? tp as string : null,` and `Mcq = c.TryGetValue("mcq", out var m) && m is string s ? JsonSerializer.Deserialize<JsonElement>(s) : (JsonElement?)null,` lines verbatim; `await LoadCardsAsync(conn, deckId)`; no `JsonDocument.Parse(`; no `Topic = …string.Empty` / `Mcq = …string.Empty`.
  - `DeckDiff.cs`: `using System.Text.Json.Nodes;`; `public static bool McqEquals(JsonElement? a, JsonElement? b)`; `JsonNode.DeepEquals(`; `|| !McqEquals(a.Mcq, b.Mcq)`; `11 个卡片字段`; no `GetRawText() ==`/`!=` and no `string.Equals(a.Mcq`.
  - `ContentArtifactsGenerator.cs`: `public JsonElement? Mcq { get; set; }`, `Mcq = c.Mcq,` (and C05's `Topic` pair still present).
  - `ContentSerializationContractTests.cs`: the base `CardJson` line byte-identical; `McqPgText =`, `McqJson =`, the compact `McqJson` literal, the PG fragment `"v": 1, "options": [{"key": "a", "why": null,`; `,"topic":"t","mcq":`; `,"mcq":`; `JsonSerializer.Deserialize<CardExportData>(`; the six base names + C05's `Card_WithTopic_AppendsTopicLast`, `Card_NullTopic_KeepsGoldenBytes` + `Card_WithTopicAndMcq_AppendsMcqLast`, `Card_WithMcqOnly_OmitsTopic`, `Card_WithMcq_RoundTripsThroughContentJson`; `git diff -U0 $mb -- <file>` has no removed line (add-only).
  - `DeckDiffTests.cs`: all nine base names + C05's `Compute_TopicNullToValue_TriggersUpdated` and `{ "topic", MakeCard("a", topic: "changed") }`; `JsonElement? mcq = null`; `{ "mcq", MakeCard("a", mcq:`; `10 个字段` present, `9 个字段` absent; `Compute_SameMcqDifferentSpacing_IsUnchanged`, `Compute_McqOptionWhyChange_TriggersUpdated`, `McqEquals_BothNullEqual_OneNullDifferent`; `DeckDiff.McqEquals(null, null)`; every removed line of `git diff -U0 $mb -- <file>` is either the `topic = null)` parameter line or the `9 个字段` comment.
  - `PublishMcqGateTests.cs`: `[Collection(PostgresCollection.Name)]`; `Publish.CardsSql`; `Publish.FirstMcqGateFailure(`; `Publish.HandleAuthoringPublish(`; `CardsPage.HandleAuthoringCardsPage(`; `::jsonb`; `"MCQ_BAD_VERSION"`, `"MCQ_EXPLANATION_REQUIRED"`, `"MCQ_DIFFICULTY_RANGE"`; `JsonValueKind.Object`; `JsonValueKind.Null`; the six case names; ≥ 6 `[Fact]`; no `PUBLISH_JOB_QUEUE_URL`, no `SetEnvironmentVariable`.
  - `PublishJobProcessorSchemaTests.cs`: `[Collection(PostgresCollection.Name)]`; `CreateScratchDatabaseAsync("c09_pre018")`, `CreateScratchDatabaseAsync("c09_only018")`; `ApplyMigrationsAsync(conn, maxVersion: 17)`, `ApplyMigrationsAsync(conn, maxVersion: 18)`; `PublishJobProcessor.LoadCardsAsync(`; `ContentJson.Options`; the three case names; ≥ 3 `[Fact]`.
  - No `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `Skip =` in any scope file.
- `docker info` succeeds; `dotnet build src_C/Tests/RecallSmith.Lambda.IntegrationTests` exits 0.
- `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --no-build --filter "FullyQualifiedName~ContentSerializationContractTests|FullyQualifiedName~DeckDiffTests|FullyQualifiedName~PublishMcqGateTests|FullyQualifiedName~PublishJobProcessorSchemaTests"` exits 0.
- Scope + frozen + OTA guard: `git diff --name-only $(git merge-base HEAD delivery/r16-c-economy)` ∪ untracked under `src_C/Vpc src_C/Worker src_C/Tests src_C/Shared` ⊆ the ten scope files (+ `docs/delivery/r16-issues/`); zero diff on the three frozen mobile files and on `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`.

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C09.verify.sh
```
(cwd = worktree root; Docker running; ~2–4 min: one build, one Testcontainers start, two scratch databases.) The driver then runs the full root gate `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (every class, including C08's `CardsAuthoringMcqTests` and the single-statement ingest test), the diff-scoped banned-term grep and the suppression scan — the verify does not repeat those.

## Do NOT

- Do NOT edit `Cards.cs`, `Helpers.cs`, `McqValidation.cs`, any migration, `ProgressEvents.cs`, `ContentIntelligence.cs`, anything under `src_C/Shared/`, any `.csproj`, `AssemblyInfo.cs`, or any file under `mobile/`, `frontend/`, `snowflake/`, `docs/` (other than nothing — C15 documents this issue).
- Do NOT compare `mcq` as text, do NOT add `DefaultIgnoreCondition` to `ContentJson.Options` (it would drop `"codeLanguage":null` and break `Card_NullCodeLanguage_SerializesAsNull`), do NOT put `Mcq` anywhere but last, do NOT default `Topic`/`Mcq` to `""`.
- Do NOT probe `information_schema` before the select — the fallback is catch-and-retry on 42703, nothing else; do NOT wrap the select in a transaction.
- Do NOT gate `mode=preview`; do NOT move the `CONFIG_ERROR` check; do NOT emit `MCQ_PUBLISH_GATE` from more than one place.
- Do NOT set environment variables in tests, do NOT add `InternalsVisibleTo` to the Worker, do NOT touch `CardsPageTests.cs` or any other existing test file beyond the two add-only ones.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no network, no test gutting.
