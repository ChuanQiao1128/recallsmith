# C05 — L2a topic server (`topic-server`)

Add the nullable `cards.topic` column (migration `018_cards_topic.sql`), surface it as the **last** column of every authoring `cards` projection (`Cards.cs` GET/POST/PUT, `CardsPage.cs`, `Publish.cs` preview), accept it on POST/PUT through two new `Helpers` normalisers (trim, blank → null, max 80, string only), and carry it through the Worker export as `CardExportData.Topic` — the **last** property, `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`, DB NULL → C# null — so that every deck published today re-publishes to byte-identical `deck.json` / chunks / package / patches. `DeckDiff` compares it, the previous-build reader keeps it, and three test files pin all of it (one new DB class, two add-only golden edits). Server-only: no mobile, no console, no docs, no MCQ, no fallback, no publish gate.

## Context

Base: `delivery/r16-c-economy` (== `main@52594fe`). Every line below was read on that tree on 2026-09-21. `docs/delivery/r16-issues/C00-contracts.md` (C00) is binding; §2.8.1 is this issue's contract, §0 the non-negotiables, §3.1/§3.2 the test contract, §6 #1 and #13 the two decisions that touch it.

What the tree looks like today:

- **Schema.** `cards` is defined once at `src_C/Vpc/Db/Migrations/001_init.sql:36-54` (15 columns, `uq_cards_deck_uid`, `uq_cards_deck_order`); the only later migration touching it is `017_cards_keyset_index.sql` (an index). There is no `topic` column anywhere. The migration runner (`src_C/Vpc/Db/Migrate.cs:23-48`) accepts `^\d+_.+\.sql$`, sorts ordinally, throws on a duplicate version, and `ApplyOne` (`:73-94`) runs each file inside one transaction. Migrations are **not** run by `src_C/deploy.sh` (`:10-11`): the owner runs them from the console's Migrate button after the Lambda deploy. Tests apply every file under `Db/Migrations` to a Testcontainers Postgres (`src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:45-53`, `:136-155`); the files reach the test bin through the Vpc csproj's `<None Include="Db\Migrations\*.sql">` (`src_C/Vpc/RecallSmith.Lambda.Vpc.csproj:31-33`), so a new `.sql` is picked up by the next `dotnet build`.
- **Authoring readers/writers of `cards`** (exhaustive — verified by grepping `from cards` across `src_C/Vpc` and `src_C/Worker`): `src_C/Vpc/Authoring/Cards.cs` GET select `:36-54`, POST INSERT `:135-163` (column list `:137-138`, values `:141-145`, RETURNING `:147-162`, params `:165-178`), PUT spec `:236-249` + RETURNING `:268-283`; `src_C/Vpc/Authoring/CardsPage.cs` `BuildPageQuery` select `:129-147` (deliberately a duplicated projection, `:14-20`); `src_C/Vpc/Authoring/Publish.cs` `cardsSql` `:154-168` and the anonymous `baseCards` `:180-191` that becomes the `mode=preview` export (`:204-215`); `src_C/Worker/Services/PublishJobProcessor.cs` `cardsSql` `:119-133` and the `CardExportData` mapper `:137-148`. `ContentIntelligence.cs` and `ContentIntelligenceDemo.cs` read named columns only and are untouched. `DbUtil.QueryAsync` maps DB NULL to C# `null` (`src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:24`), so `tp as string` on a row value is the correct null-preserving read.
- **Helpers.** `src_C/Vpc/Authoring/Helpers.cs` has `UpdateField(BodyKey, ColumnName, Transform)` + `BuildUpdateSet` (`:48-66`), `ParseOptionalInteger`/`RequireInteger`/`EnsureInteger` (`:80-100`). `ValidationError(string message, string? field = null)` lives at `src_C/Shared/RecallSmith.Lambda.Common/Validation.cs:8-12`; every handler maps it to `res.BadRequest("VALIDATION_ERROR", ex.Message)` (`Cards.cs:183-186`, `:299-302`).
- **Worker export.** `src_C/Worker/S3/IS3DeckUploader.cs:50-61` `CardExportData` — nine properties, `Revision` last at `:60`, no attributes, and the file's line 1 is the namespace (no `using`). `src_C/Worker/Content/ContentJson.cs:11-15` serialises with CamelCase, not indented and **no null-ignore**: `Card_NullCodeLanguage_SerializesAsNull` (`ContentSerializationContractTests.cs:38-45`) proves a null property is emitted as `"codeLanguage":null`. The same `Options` write `deck.json` (`S3DeckUploader.cs:74`), chunks, package and delta patches (`ContentArtifactsGenerator.cs:157`, `:182`, `:228`), and all four embed `List<CardExportData>` (`ContentModels.cs:30-31`, `:69`), so one property added without `WhenWritingNull` would put `"topic":null` on every card of every artifact and invalidate every installed delta. `DeckDiff.CardChanged` (`src_C/Worker/Content/DeckDiff.cs:60-71`) compares nine fields; the class comment at `:17` says "9 个卡片字段". The previous build is read back through `PreviousDeckDocument`/`PreviousCardDocument` (`src_C/Worker/Services/ContentArtifactsGenerator.cs:291-307`, all-nullable, unknown keys ignored) and `MapPreviousCards` (`:258-284`, initializer `:269-280`) — a field missing there diffs as "changed" on every publish and drops out of patches.
- **Golden test.** `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs:28-29` pins `CardJson` byte-for-byte; it is consumed by `:31-36`, `:47-78`, `:118-135`, `:137-157`. `DeckDiffTests.cs:115-126` is the per-field mutation table (comment `:117` says "8 个字段"). `CardsPageTests.cs:66-98` is the JWT-claims event + direct-handler pattern for authoring tests; `:38-53` seeds decks/cards with raw SQL; `:340-369` checks item fields by presence only, so an extra `topic` key does not break it.

What C00 decided (and why):

- §0 / §6 #1: **`018_cards_topic.sql`** is this issue's migration; `019_cards_mcq.sql` is C08's. The MCQ plan's `018_cards_mcq.sql` is superseded and registered as not-on-disk at `docs/mcq-card-type-plan-2026-09-18.md:499` — creating a file by that name turns `frontend/tests/docsPaths.test.ts` red. The release plan (`docs/release-1.6.0-plan-2026-09-19.md:204`) says "in the SAME commit amend docs/mcq-card-type-plan"; C00 assigns that doc edit to **C15** — C05 touches no `docs/*.md`.
- §0 "Byte-identical artifacts": `Topic` carries `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`, the mapper maps DB NULL to C# null and **never** `?? string.Empty`, `CardJson` stays byte-identical. The owner's post-deploy check is "republish both live decks, diff everything except buildId/sha" (`docs/delivery-wave-1.6-plan-2026-09-19.md:121`).
- §2.8.1: `topic` is the **last** column of every select list and the **last** key of an exported card; the API always echoes the key (`"topic": null` for untagged cards — the API is not byte-golden). §6 #13: the preview export (`Publish.cs` anonymous type) shows `"topic": null` on untagged cards while the Worker omits the key — accepted, byte identity is asserted on `CardExportData` only.
- §1.2 / §2.9.4: the Worker's 42703 fallback (`LoadCardsAsync`, 11-column then legacy select) belongs to **C09**; C05 adds none. Consequence the owner already accepts: between the Lambda deploy and the console Migrate click, every `cards` reader above returns 500 (42703). Do not work around it here.
- `docs/gacha-acquisition-learning-loop-plan.md:413` proposed a publish gate making topic required for pilot decks; C00 §2.8.1 says "No index, no CHECK" and defines no topic gate — C05 adds none (C09's pre-enqueue gate is MCQ-only).
- §3.3: C05's tests use xunit `[Theory]` tables (no fast-check on the server).
- Wave-plan row (`docs/delivery-wave-1.6-plan-2026-09-19.md:109`) says scope `src_C/Vpc/Authoring/*`, `src_C/Worker/**`, `src_C/Tests/**`; C00 §1.2 narrows that to the twelve files under Constraints. `MakeCard` in `DeckDiffTests.cs` needs a trailing optional `topic` parameter to express the new mutation row — that is the one edit to an existing helper this brief allows; `MakeCard` in `ContentSerializationContractTests.cs` is not touched (set `Topic` on the returned object instead).

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables, `:9-22`), §1.2 (`:68-93`), §2.8.1 (`:387-409`), §3.1 C05 (`:666`), §3.2 (`:688`), §3.3 (`:695-697`), §5 (`:725-736`), §6 #1 and #13 (`:742`, `:754`).
2. `src_C/Vpc/Db/Migrations/017_cards_keyset_index.sql:1-11` (header style, the transaction note) and `src_C/Vpc/Db/Migrate.cs:20-48`, `:73-94`.
3. `src_C/Vpc/Authoring/Cards.cs` whole file (342 lines): `:36-54`, `:97-193`, `:195-309`.
4. `src_C/Vpc/Authoring/Helpers.cs` whole file (149 lines).
5. `src_C/Vpc/Authoring/CardsPage.cs:9-28` and `:122-147`; `src_C/Vpc/Authoring/Publish.cs:87-117`, `:154-215`.
6. `src_C/Worker/S3/IS3DeckUploader.cs` whole file (61 lines); `src_C/Worker/Content/ContentJson.cs`; `src_C/Worker/Content/ContentModels.cs:22-70`.
7. `src_C/Worker/Services/PublishJobProcessor.cs:88-160`; `src_C/Worker/Content/DeckDiff.cs` whole file (72 lines); `src_C/Worker/Services/ContentArtifactsGenerator.cs:188-243`, `:258-307`.
8. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs` (158 lines), `DeckDiffTests.cs` (176 lines), `IntegrationTestBase.cs:27-98`, `:158-165`, `CardsPageTests.cs:24-99`, `:340-369`.
9. `src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:8-30`; `src_C/Shared/RecallSmith.Lambda.Common/Validation.cs:8-12`; `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-99`, `:145-163`.

## Constraints

- **Scope (the ONLY files that may change):**
  1. `src_C/Vpc/Db/Migrations/018_cards_topic.sql` (new)
  2. `src_C/Vpc/Authoring/Cards.cs`
  3. `src_C/Vpc/Authoring/Helpers.cs`
  4. `src_C/Vpc/Authoring/CardsPage.cs`
  5. `src_C/Vpc/Authoring/Publish.cs`
  6. `src_C/Worker/S3/IS3DeckUploader.cs`
  7. `src_C/Worker/Services/PublishJobProcessor.cs`
  8. `src_C/Worker/Content/DeckDiff.cs`
  9. `src_C/Worker/Services/ContentArtifactsGenerator.cs`
  10. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs` (add-only)
  11. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/DeckDiffTests.cs` (add-only, see Changes 11)
  12. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardsAuthoringTopicTests.cs` (new)
  Nothing else: no `mobile/`, no `frontend/`, no `snowflake/`, no top-level `docs/*.md`, no `src_C/Shared/**`, no `src_C/Vpc/Runtime/**`, no `ContentModels.cs`, no `ContentJson.cs`, no `Migrate.cs`, no `.csproj`, no `019_*.sql`, no `018_cards_mcq.sql`.
- **Frozen files (gacha-v7 §2.1, C00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts` (a server issue never opens them).
- **OTA / dependency rule:** nothing under `mobile/` changes; `mobile/package.json`, `package-lock.json`, `app.json` stay byte-identical. No `PackageReference` is added or changed in any `.csproj` (the build restores from the local NuGet cache; no network).
- **Byte identity:** the `CardJson` literal at `ContentSerializationContractTests.cs:28-29` and the six existing `[Fact]`s of that file (`Card_SerializesExactCamelCaseFieldNames`, `Card_NullCodeLanguage_SerializesAsNull`, `DeckDelta_SerializesExactContractShape`, `DeckPackage_SerializesExactContractShape`, `DeckChunk_SerializesExactContractShape`, `DeckExportData_DeckJson_KeepsExistingCamelCaseShape`) are byte-identical. No `schemaVersion` changes (`ContentModels.cs`), no manifest key.
- **Existing tests:** `ContentSerializationContractTests.cs` and `DeckDiffTests.cs` are add-only (Changes 10–11); `CardsPageTests.cs`, `ProgressEventsSingleStatementTests.cs` and every other existing test file are untouched. The full suite (`cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`) must stay green — every `[Collection(PostgresCollection.Name)]` class runs against the migrated fixture, which now includes 018.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — do not reproduce them, not even in a comment; say "work around", "sidestep", "guard", "fallback", "probe". No `[Fact(Skip = …)]` / `[Theory(Skip = …)]`, no `#pragma warning disable`, no `@ts-ignore`/`eslint-disable`/`.skip(`/`.only(` anywhere in the diff.
- **Never copy ExamTopics / SAA-C03 content.** Test fixtures use neutral strings (`"q"`, `"Networking"`, `new string('x', 81)`).
- **dotnet / Docker:** dotnet 8.0.413. `dotnet build` restores implicitly from the local cache (no `dotnet restore` by hand, no `--no-restore` on a fresh worktree either — `obj/` does not exist there yet). The DB test classes need a running Docker daemon (Testcontainers `postgres:16-alpine`, image cached on this machine); the pure classes (`ContentSerializationContractTests`, `DeckDiffTests`) do not. Run targeted tests with `--filter "FullyQualifiedName~<Class>"`.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no `expo`, no `npm`.

## Changes required

1. **`src_C/Vpc/Db/Migrations/018_cards_topic.sql` (new)** — one statement under a header in the style of `017_cards_keyset_index.sql:1-4`:
   ```sql
   -- =========================
   -- 018_cards_topic.sql
   -- Optional single-valued topic label on cards (Wave C, C05)
   -- =========================

   -- One statement, runs inside Migrate.ApplyOne's transaction (Migrate.cs:73-94).
   -- No index and no CHECK: topic is a grouping label for the console and the
   -- mobile Library; the 80-character bound is enforced by the API
   -- (Helpers.NormalizeTopic), and legacy cards stay NULL ("untagged").
   alter table cards add column if not exists topic text null;
   ```
   Exactly that DDL line (verify greps it with `-F`); no `create index`, no `check (…)`, no `not null`, no `default`. Do not create `019_*` or `018_cards_mcq.sql`.

2. **`src_C/Vpc/Authoring/Helpers.cs`** — insert after `EnsureInteger` (`:96-100`) and before `DeckPerm` (`:102`):
   ```csharp
   /// <summary>Upper bound on cards.topic in UTF-16 code units; the console's TOPIC_MAX_LENGTH (C06) is the same 80.</summary>
   public const int TopicMaxLength = 80;

   /// <summary>
   /// POST body → cards.topic. absent / JSON null / blank → null; string → Trim();
   /// > 80 chars → ValidationError("topic too long (max 80)");
   /// any other ValueKind → ValidationError("topic must be a string").
   /// </summary>
   public static string? ParseOptionalTopic(JsonElement body)
   {
     return body.TryGetProperty("topic", out var el) ? NormalizeTopic(el) : null;
   }

   /// <summary>Same rules for one element (the PUT spec transform).</summary>
   public static string? NormalizeTopic(JsonElement el)
   {
     switch (el.ValueKind)
     {
       case JsonValueKind.Undefined:
       case JsonValueKind.Null:
         return null;
       case JsonValueKind.String:
         var s = (el.GetString() ?? string.Empty).Trim();
         if (s.Length == 0) return null;
         if (s.Length > TopicMaxLength) throw new ValidationError("topic too long (max 80)", "topic");
         return s;
       default:
         throw new ValidationError("topic must be a string", "topic");
     }
   }
   ```
   Signatures verbatim from C00 §2.8.1: `public static string? ParseOptionalTopic(JsonElement body)` and `public static string? NormalizeTopic(JsonElement el)`. The two messages `topic too long (max 80)` and `topic must be a string` are exact (tests and verify grep them). Trim first, then measure. Nothing else in the file changes (`UpdateField` keeps three members — `Cast` is C08's).

3. **`src_C/Vpc/Authoring/Cards.cs`**
   a. GET select (`:36-54`): `c.updated_at    as "updatedAt"` (`:52`) gains a trailing comma and a new last line `c.topic` follows it (same 12-space indent), before `from cards c`.
   b. POST: after `versionInt` (`:133`) add `var topic = Helpers.ParseOptionalTopic(body);`. INSERT column list (`:137-138`) becomes `…, real_world_usage, difficulty, order_in_deck, revision, version, topic`; values (`:141-145`) gain a last line `$12` after `coalesce($11,1),` (add the comma). RETURNING (`:147-162`): `updated_at    as "updatedAt",` then a new last line `topic;`. Params array (`:165-178`): append `topic,` after `versionInt,` — it is the 12th parameter.
   c. PUT spec (`:236-249`): insert, after the `revision` entry (`:247`) and before `isDeleted` (`:248`), verbatim:
      ```csharp
      new("topic", "topic", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.NormalizeTopic(v)),
      ```
      The editor filter (`:251-255`) is unchanged — editors may set and clear `topic`. PUT RETURNING (`:268-283`): `updated_at    as "updatedAt",` then a new last line `topic;`. `BuildUpdateSet` numbers the parameters, so nothing else moves; the `fields.Count == 1` check (`:258`) and `version = version + 1` (`:260-262`) are untouched.
   d. DELETE, error handling, auth: untouched. A PUT with `topic: 42` or an 81-char topic throws `ValidationError` from the transform inside `BuildUpdateSet` and lands in the existing `VALIDATION_ERROR` catch (`:299-302`) before any SQL runs.

4. **`src_C/Vpc/Authoring/CardsPage.cs`** — `BuildPageQuery` select (`:129-147`): `c.updated_at    as "updatedAt"` (`:145`) gains a trailing comma; new last line `c.topic` before `from cards c`. Nothing else (the header comment `:14-20` already explains why the projection is duplicated).

5. **`src_C/Vpc/Authoring/Publish.cs`**
   a. `cardsSql` (`:154-168`): `revision` (`:164`) gains a trailing comma; new last line `topic` before `from cards`.
   b. `baseCards` (`:180-191`): after `revision = …,` (`:190`) add, verbatim:
      ```csharp
      topic = c.TryGetValue("topic", out var tp) ? tp as string : null,
      ```
      The preview JSON therefore shows `"topic": null` on untagged cards (C00 §6 #13 — accepted). No pre-enqueue gate, no other change.

6. **`src_C/Worker/S3/IS3DeckUploader.cs`**
   a. Line 1 becomes `using System.Text.Json.Serialization;`, followed by a blank line, then the existing `namespace RecallSmith.Lambda.Worker.S3;`.
   b. `CardExportData` (`:50-61`): after `public int Revision { get; set; } = 1;` (`:60`) append, as the **last** property of the class, verbatim:
      ```csharp
      [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      public string? Topic { get; set; }
      ```
      No initializer (never `= string.Empty`). `DeckExportData` and `S3UploadResult` untouched. Export key order is therefore `stableUid, orderInDeck, difficulty, question, explanation, codeLanguage, codeSnippet, realWorldUsage, revision, topic` with `topic` absent when null (C09 appends `mcq` after it).

7. **`src_C/Worker/Services/PublishJobProcessor.cs`**
   a. `cardsSql` (`:119-133`): `revision` (`:129`) gains a trailing comma; new last line `topic` before `FROM cards`.
   b. Mapper (`:137-148`): after `Revision = …,` (`:147`) add, verbatim:
      ```csharp
      Topic = c.TryGetValue("topic", out var tp) ? tp as string : null,
      ```
      **Never** `?? string.Empty` / `?? ""` on this line — an empty string would be serialised as `"topic":""` on every card and break byte identity. No 42703 catch here (C09).

8. **`src_C/Worker/Content/DeckDiff.cs`**
   a. `:17` comment: `9 个卡片字段` → `10 个卡片字段`.
   b. `CardChanged` (`:60-71`): append one more disjunct so the method ends
      ```csharp
      || a.Revision != b.Revision
      || !string.Equals(a.Topic, b.Topic, StringComparison.Ordinal);
      ```
      (null vs null is equal; null vs `"t"` is a change.) Nothing else in the file changes.

9. **`src_C/Worker/Services/ContentArtifactsGenerator.cs`**
   a. `PreviousCardDocument` (`:296-307`): after `public int? Revision { get; set; }` add `public string? Topic { get; set; }`.
   b. `MapPreviousCards` initializer (`:269-280`): after `Revision = c.Revision ?? 1,` add `Topic = c.Topic,` (a previous build without the key deserialises to null, exactly like a DB NULL). No other line changes; the delta-size gate (`:229-234`) and the 42P01/42703 handlers of this file stay as they are.

10. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs` (add-only)** — do not touch `MakeCard` (`:12-26`), `CardJson` (`:28-29`) or any of the six existing facts, which stay byte-identical and keep their names: `Card_SerializesExactCamelCaseFieldNames`, `Card_NullCodeLanguage_SerializesAsNull`, `DeckDelta_SerializesExactContractShape`, `DeckPackage_SerializesExactContractShape`, `DeckChunk_SerializesExactContractShape`, `DeckExportData_DeckJson_KeepsExistingCamelCaseShape`. Append two facts before the closing brace, names verbatim:
    ```csharp
    [Fact]
    public void Card_WithTopic_AppendsTopicLast()
    {
      var card = MakeCard();
      card.Topic = "t";

      var json = ContentJson.Serialize(card);

      Assert.Equal(
        """{"stableUid":"u1","orderInDeck":1,"difficulty":2,"question":"q","explanation":"e","codeLanguage":"csharp","codeSnippet":"c","realWorldUsage":"r","revision":1,"topic":"t"}""",
        json);
      // The golden card plus one appended key — nothing in front of it moved.
      Assert.Equal(CardJson[..^1] + ""","topic":"t"}""", json);
    }

    [Fact]
    public void Card_NullTopic_KeepsGoldenBytes()
    {
      var card = MakeCard();
      card.Topic = null;

      Assert.Equal(CardJson, ContentJson.Serialize(card));

      var chunk = new DeckChunkModel { SchemaVersion = 1, Slug = "s", Version = "to-2", Seq = 0, Cards = new List<CardExportData> { card } };
      Assert.DoesNotContain("topic", ContentJson.Serialize(chunk), StringComparison.Ordinal);
    }
    ```

11. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/DeckDiffTests.cs` (add-only)**
    a. `MakeCard` (`:11-34`): add a trailing optional parameter `string? topic = null` after `int revision = 1` and `Topic = topic,` after `Revision = revision,`. Every existing call site is unchanged.
    b. `SingleFieldMutations` (`:115-126`): the comment `:117` becomes `// 除 stableUid 之外的 9 个字段，逐一变化都必须触发 updated`; add, after the `revision` row, verbatim:
       ```csharp
       yield return new object[] { "topic", MakeCard("a", topic: "changed") };
       ```
    c. Append one fact (name verbatim), mirroring `Compute_CodeLanguageNullToValue_TriggersUpdated` (`:142-151`):
       ```csharp
       [Fact]
       public void Compute_TopicNullToValue_TriggersUpdated()
       {
         var prev = new List<CardExportData> { MakeCard("a", topic: null) };
         var next = new List<CardExportData> { MakeCard("a", topic: "t") };

         var diff = DeckDiff.Compute(prev, next);

         Assert.Single(diff.Updated);
       }
       ```
    The header comment `:7` is not pinned by C00; leave it. All nine existing test methods stay byte-identical and keep their names: `Compute_IdenticalDecks_IsNoOp`, `Compute_NewUid_IsAdded`, `Compute_MissingUid_IsDeleted`, `Compute_ChangedCard_IsUpdated_AndCarriesNextValues`, `Compute_MixedChanges_AllBucketsFilled_InNextOrder`, `Compute_AnySingleFieldChange_TriggersUpdated`, `Compute_CodeLanguageNullToValue_TriggersUpdated`, `Compute_EmptyPrev_AllAdded`, `Compute_EmptyNext_AllDeleted`.

12. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardsAuthoringTopicTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, `public class CardsAuthoringTopicTests`, constructor `(PostgresFixture db)`. Usings as `CardsPageTests.cs:1-7`. Helpers, modelled on `CardsPageTests.cs:36-99`:
    - `NewDeckAsync(tag)`: `insert into decks (slug, title, author) values ($1, $2, $3) returning id` (deck_type defaults to 1 and tier to `'free'`, so preview needs no bucket env).
    - `Event(string method, string path, string sub, string[] groups, IDictionary<string, string>? query, string? body)`: the JWT-claims shape of `CardsPageTests.cs:66-92` with `http = new { method }` and `body` passed through (`isBase64Encoded = false`). Always `groups = ["super_admin"]` here.
    - `CardsAsync(method, query, body)` → `Cards.HandleAuthoringCards(req, res, Auth.GetAuthContext(req))` with `req = new LambdaRequest(Event(...))`, `res = new Res(req.TraceId)`, path `/api/v1/authoring/cards`; `PageAsync(deckId)` → `CardsPage.HandleAuthoringCardsPage` on `/api/v1/authoring/cards/page` with `deckId` + `limit=50`; `PreviewAsync(deckId)` → `Publish.HandleAuthoringPublish` on `/api/v1/authoring/publish` with query `mode=preview` and body `{"deckId":<id>}`.
    - `Data(response)`: `JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone()`; `ErrorCode(response)` reads `error.code`, `ErrorMessage(response)` reads `error.message`.
    - `PostCardAsync(deckId, object body)`: serialises `new { deckId, stableUid = $"uid-{Guid.NewGuid():N}", question = "q", orderInDeck = n, topic = … }` (build the anonymous object per case; omit `topic` where the case says "absent").
    Cases, method names verbatim (each its own `[Fact]` unless marked `[Theory]`):
    1. `Post_WithTopic_ReturnsTrimmedTopic` — `topic = "  Networking  "` → 200; `Data.topic == "Networking"`; `select topic from cards where id = $1` is `"Networking"`.
    2. `Post_BlankTopic_ReturnsNull` — `topic = "   "` → 200 and `Data.topic.ValueKind == JsonValueKind.Null`; a second POST with no `topic` key → the key is present and null (`TryGetProperty("topic")` true, `ValueKind == Null`).
    3. `Post_TopicOver80_IsValidationError` — `topic = new string('x', 81)` → 400, `error.code == "VALIDATION_ERROR"`, `error.message` contains `topic too long (max 80)`; `select count(*) from cards where stable_uid = $1` is 0. A follow-up POST with `new string('x', 80)` → 200 and the 80-char topic echoed (boundary).
    4. `Post_NonStringTopic_IsValidationError` — `topic = 42` → 400, `VALIDATION_ERROR`, message `topic must be a string`.
    5. `Put_TopicNull_ClearsTopic` — POST with `topic = "T"`, then PUT `{ id, expectedVersion = 1, topic = (string?)null }` → 200, `Data.topic` is JSON null, `Data.version == 2`; DB column is NULL.
    6. `Put_WithoutTopic_LeavesTopicIntact` — POST with `topic = "T"`, PUT `{ id, expectedVersion = 1, question = "q2" }` → 200, `Data.topic == "T"`, `Data.question == "q2"`.
    7. `Put_TopicOver80_IsValidationError` — POST with `topic = "T"`, PUT `{ id, expectedVersion = 1, topic = new string('x', 81) }` → 400 `VALIDATION_ERROR`; DB still `"T"` and `version` still 1. Then PUT `{ id, expectedVersion = 1, topic = "  Storage " }` → 200, `Data.topic == "Storage"`.
    8. `Get_Page_Preview_AllCarryTopicKey` — one deck, POST card A with `topic = "T"` (orderInDeck 1) and card B without topic (orderInDeck 2). GET `?deckId=` → an array of 2; both items have the `topic` key, A `"T"`, B null. Page → `data.items` same two assertions. Preview → 200, `data.export.cards` has 2 entries, both with the `topic` key, A `"T"`, B null; `data.export.cards[0]` also still has `stableUid`, `orderInDeck`, `revision`.
    9. `[Theory] NormalizeTopic_TrimsAndNullsBlank(string json, string? expected)` — `InlineData("\"  AWS  \"", "AWS")`, `InlineData("\"\"", null)`, `InlineData("\"   \"", null)`, `InlineData("null", null)`; `Helpers.NormalizeTopic(JsonSerializer.Deserialize<JsonElement>(json))` equals `expected`.
    10. `[Theory] NormalizeTopic_RejectsNonStringAndOverlong(string json, string message)` — `InlineData("42", "topic must be a string")`, `InlineData("true", "topic must be a string")`, `InlineData("{}", "topic must be a string")`, `InlineData("[]", "topic must be a string")`, `InlineData("\"" + …81 x… + "\"", "topic too long (max 80)")` (build the 81-char case with `MemberData` or a `const string` of 81 `x`); `Assert.Throws<ValidationError>(…).Message == message`.
    11. `[Theory] NormalizeTopic_LengthBoundaryIs80(int length, bool accepted)` — `InlineData(1, true)`, `InlineData(80, true)`, `InlineData(81, false)`; the element is `JsonSerializer.SerializeToElement(new string('x', length))`; accepted → returns the same string, else throws `ValidationError`.
    Every DB case mints its own deck/uids (the fixture is shared and rerunnable, `IntegrationTestBase.cs:21-25`). Assert `response.StatusCode` with the body in the failure message as `CardsPageTests.cs:120` does.

Estimated size: migration 10 lines; Helpers ~35; Cards.cs ~12; CardsPage 2; Publish 3; IS3DeckUploader 4; PublishJobProcessor 3; DeckDiff 2; ContentArtifactsGenerator 2; contract tests ~30; DeckDiffTests ~16; new test class ~260.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C05.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0): `[ -f src_C/Vpc/Db/Migrations/018_cards_topic.sql ] && [ -f src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardsAuthoringTopicTests.cs ]`; `[ ! -e src_C/Vpc/Db/Migrations/018_cards_mcq.sql ]`; exactly one `018_*.sql` and no `019_*.sql` under `src_C/Vpc/Db/Migrations`.
2. Literal guards (exit 0):
   - migration: `grep -Fq 'alter table cards add column if not exists topic text null;'`, header names `018_cards_topic.sql`, exactly one `;` outside comment lines, no `create index` / `check (` / `not null` / `default` (case-insensitive).
   - `Helpers.cs`: `public const int TopicMaxLength = 80;`, `public static string? ParseOptionalTopic(JsonElement body)`, `public static string? NormalizeTopic(JsonElement el)`, `"topic too long (max 80)"`, `"topic must be a string"`; no `Cast` member on `UpdateField`.
   - `Cards.cs`: exactly one line `c.topic` (GET), exactly two lines `topic;` (POST/PUT RETURNING), three `as "updatedAt",` and no `as "updatedAt"` without a trailing comma; `Helpers.ParseOptionalTopic(body)`; `real_world_usage, difficulty, order_in_deck, revision, version, topic`; a values line `$12`; the PUT spec line verbatim, positioned after `new("revision"` and before `new("isDeleted"`.
   - `CardsPage.cs`: exactly one `c.topic`, one `as "updatedAt",`.
   - `Publish.cs`: one bare `topic` select line; `topic = c.TryGetValue("topic", out var tp) ? tp as string : null`.
   - `PublishJobProcessor.cs`: one bare `topic` select line; `Topic = c.TryGetValue("topic", out var tp) ? tp as string : null`; no `Topic = …` line containing `string.Empty` or `?? ""`; no `42703`.
   - `IS3DeckUploader.cs`: line 1 is `using System.Text.Json.Serialization;`; the last three non-blank lines of the file are the `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` attribute, `public string? Topic { get; set; }` and `}` (Topic is the last property of `CardExportData`).
   - `DeckDiff.cs`: `|| !string.Equals(a.Topic, b.Topic, StringComparison.Ordinal)`; `10 个卡片字段` present, `9 个卡片字段` absent.
   - `ContentArtifactsGenerator.cs`: `public string? Topic { get; set; }` and `Topic = c.Topic,`, the latter after `Revision = c.Revision ?? 1,`.
   - `ContentSerializationContractTests.cs`: the `CardJson` literal line byte-identical; the six existing method names present; `Card_WithTopic_AppendsTopicLast`, `Card_NullTopic_KeepsGoldenBytes`; the literal `"revision":1,"topic":"t"}`.
   - `DeckDiffTests.cs`: `{ "topic", MakeCard("a", topic: "changed") }`; `除 stableUid 之外的 9 个字段`; `Compute_TopicNullToValue_TriggersUpdated`; the nine existing method names present.
   - `CardsAuthoringTopicTests.cs`: `[Collection(PostgresCollection.Name)]`, at least one `[Theory]`, and all eleven method names of Changes 12.
   - no `Skip =`, `#pragma warning disable`, `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in any scope file.
3. Build (exit 0): `cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo`; afterwards `Tests/RecallSmith.Lambda.IntegrationTests/bin/Debug/net8.0/Db/Migrations/018_cards_topic.sql` exists.
4. Targeted tests (exit 0, Docker running): `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo --filter "FullyQualifiedName~ContentSerializationContractTests|FullyQualifiedName~DeckDiffTests|FullyQualifiedName~CardsAuthoringTopicTests"`.
5. Scope + frozen guard (exit 0): `git diff --name-only <merge-base>` ∪ pathspec-scoped untracked scan of `src_C/Vpc src_C/Worker src_C/Tests src_C/Shared mobile/src mobile/tests frontend/src frontend/tests snowflake docs` contains nothing outside the twelve scope files (+ `docs/delivery/r16-issues/`); the three frozen mobile files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, every `.csproj`, `ContentModels.cs`, `ContentJson.cs`, `Migrate.cs`, `src_C/Shared`, `src_C/Vpc/Runtime` and every top-level `docs/*.md` are zero-diff.

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C05.verify.sh
```
Steps 1–2 are file/literal checks (seconds); step 3 builds the test project (implicit cached restore, ~1–2 min cold); step 4 starts one `postgres:16-alpine` container and runs the three classes (single-digit minutes, not measured). The driver then runs the full root gate in addition — `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (Docker) — plus its diff-scoped banned-term grep and suppression scan, so keep every other test class green; the verify never repeats the whole suite.

## Do NOT

- Do NOT create `019_*.sql`, `018_cards_mcq.sql`, or a second statement in 018 (no index, no CHECK, no NOT NULL, no DEFAULT).
- Do NOT add a 42703 fallback anywhere (Worker `LoadCardsAsync` is C09; the API has none by design), a topic publish gate, or a `Cast`/`JsonbCell`/`JsonbElement` helper (C08/C09).
- Do NOT put `[JsonIgnore]` on any existing property, add `DefaultIgnoreCondition` to `ContentJson.Options`, or reorder `CardExportData` — `Topic` goes last and nothing in front of it moves.
- Do NOT default `Topic` to `""` anywhere (`CardExportData` initializer, the Worker mapper, `MapPreviousCards`): DB NULL is C# null, and null is omitted from the export.
- Do NOT touch `mobile/`, `frontend/`, `snowflake/`, any top-level `docs/*.md` (the MCQ-plan renumbering is C15), `src_C/Shared/**`, `src_C/Vpc/Runtime/**`, `ContentIntelligence*.cs`, `ManifestRebuild.cs`, `ContentModels.cs`, `ContentJson.cs`, `Migrate.cs`, any `.csproj`, `IntegrationTestBase.cs`, `CardsPageTests.cs`.
- Do NOT edit `MakeCard`/`CardJson` or any existing `[Fact]` in `ContentSerializationContractTests.cs`; do NOT rename or re-order the existing rows of `SingleFieldMutations`.
- Do NOT run `dotnet restore` by hand, `npm …`, `expo …`, `eas …`, or anything that needs the network; do NOT run git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree.
