# C08 — MCQ P1a server: `019_cards_mcq.sql`, `McqValidation.Canonicalize`, `Cards.cs` GET/POST/PUT, `Helpers.UpdateField.Cast` (`mcq-server-api`)

Add the optional `cards.mcq jsonb` column (migration `019_cards_mcq.sql`), a pure validator/canonicaliser `McqValidation.Canonicalize(JsonElement raw, string? question)` that turns a client blob into the pinned compact JSON in PG's key order, and wire `mcq` through the three `Cards.cs` handlers: GET selects it, POST inserts it as `$13::jsonb`, PUT updates it through a new `Cast` slot on `Helpers.UpdateField`, every response row passes `Helpers.JsonbCell(row, "mcq")` so the API answers a JSON **object** (never a JSON-encoded string), and two handler gates reject an MCQ card whose `explanation` is blank (`MCQ_EXPLANATION_REQUIRED`) or whose difficulty is outside 1–3 (`MCQ_DIFFICULTY_RANGE`). Two new xunit classes pin it: `McqValidationTests` (pure, no DB) and `CardsAuthoringMcqTests` (Testcontainers Postgres). **Nothing in `CardsPage.cs`, `Publish.cs`, the Worker, `ProgressEvents.cs`, `src_C/Shared`, `frontend/` or `mobile/` changes — those are C09/C10/C11+.**

## Context

C00 (`docs/delivery/r16-issues/C00-contracts.md`) is binding; §2.9.1–§2.9.3 are this issue's contract and are repeated verbatim below. C08 depends on **C05** (topic): the driver merges C05 into `delivery/r16-c-economy` before it cuts your worktree, so the `Cards.cs` / `Helpers.cs` you open already carry C05's `topic` edits. Every line number below was read on the **base** tree (`delivery/r16-c-economy` = `main@52594fe`, 2026-09-21) — C05 shifts `Cards.cs` by roughly +1 line per select list (3), +2 in the INSERT (column + value), +1 param, +1 PUT spec entry, and adds two methods to `Helpers.cs`. Re-grep before editing; never trust an offset. If `src_C/Vpc/Db/Migrations/018_cards_topic.sql` is missing or `Cards.cs` has no `c.topic`, stop: C05 has not merged and C08 cannot be `$13`.

What the tree looks like today (base + C05 where noted):

- **Migrations.** `src_C/Vpc/Db/Migrations/001_init.sql:36-54` creates `cards` (`explanation text null` `:41`, `difficulty int not null default 2` `:45`; constraints `uq_cards_deck_uid`, `uq_cards_deck_order` `:52-53`). Latest on base: `017_cards_keyset_index.sql` (header comment style `:1-4`, one statement `:30-31`); C05 adds `018_cards_topic.sql`. Runner: `src_C/Vpc/Db/Migrate.cs:23-48` — regex `^\d+_.+\.sql$`, ordinal sort, version = int before the first `_`, duplicate version throws. Files reach the Lambda zip and the test bin via `src_C/Vpc/RecallSmith.Lambda.Vpc.csproj:31-33` (`None Include="Db\Migrations\*.sql"`, glob — a new file is picked up automatically). Tests apply every migration to a fresh `postgres:16-alpine` container: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:45-53` → `ApplyMigrationsAsync(conn, int.MaxValue)` (`:136-155`, same regex/sort, `DbUtil.ExecuteAsync` per file). **The plan doc's `018_cards_mcq.sql` is superseded** (C00 §6 #1): 018 = topic (C05), 019 = mcq (this issue). `docs/mcq-card-type-plan-2026-09-18.md:499` registers `src_C/Vpc/Db/Migrations/018_cards_mcq.sql` as not-on-disk and `frontend/tests/docsPaths.test.ts:169-184` goes red if that path ever exists — never create it.
- **`src_C/Vpc/Authoring/Cards.cs` (342 lines on base).** One connection, no transaction anywhere (`DbUtil.QueryAsync(conn, null, …)` at `:82`, `:180`, `:289`, `:292`). GET `:22-95`: select list `:36-54` (15 aliased columns, `c.updated_at as "updatedAt"` last on base; C05 appends `c.topic`), permission join `:59-64`, filters `:66-79`, `res.Ok(rows)` `:83`. POST `:97-193`: required keys `:105-111`, `explanation` null-able and trimmed `:126`, `difficultyInt`/`revisionInt`/`versionInt` via `Helpers.ParseOptionalInteger` (`long?`) `:131-133`, INSERT `:135-163` (columns `:137-138`, values `$1..$7, coalesce($8,2), $9, coalesce($10,1), coalesce($11,1)` `:141-145`, RETURNING `:147-162`; C05 appends column `topic` = `$12` and `topic` to RETURNING), params array `:165-178` (11 on base, 12 after C05), `res.Ok(rows[0])` `:181`, catch arms `:183-192` (`when (ex is ValidationError)` → `VALIDATION_ERROR`, then `Helpers.HandlePgError`, then 500). PUT `:195-309`: `id` `:203-204`, `expectedVersion`/`version` required `:206-215`, `GetDeckIdByCardId` → 404 `:217-218`, deck write permission `:220-221`, deck-move guard `:223-234`, spec `:236-249` (`new(bodyKey, column, transform)`; C05 inserts a `topic` entry after `revision` `:247`), editor filter `:251-255` (drops only `deckId`/`isDeleted`/`stableUid` — editors keep `mcq`), `BuildUpdateSet` `:257`, "No fields to update" `:258`, `version = version + 1` `:260-262`, UPDATE with RETURNING `:264-284`, `parameters.Add(idInt); parameters.Add(expectedVersionInt)` `:286-287`, execute `:289`, 0 rows → 404 / `VERSION_CONFLICT` `:290-295`, `res.Ok(rows[0])` `:297`, catch arms `:299-308`. Route: `src_C/Vpc/VpcFunction.cs:177-180`.
- **`src_C/Vpc/Authoring/Helpers.cs` (149 lines on base).** `public sealed record UpdateField(string BodyKey, string ColumnName, Func<JsonElement, object?> Transform);` `:48`; `BuildUpdateSet` `:50-66` skips absent body keys (`:58`) and emits `fields.Add($"{f.ColumnName} = ${idx++}");` (`:60`) — **no cast slot**, so a jsonb column cannot be updated through it today. The only other user is `src_C/Vpc/Authoring/Decks.cs:196-224` (three-argument `new(...)` calls that must keep compiling — hence the default parameter). C05 adds `ParseOptionalTopic` / `NormalizeTopic` here.
- **Why the casts and the cell conversion.** `src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:63-68` binds every parameter with `AddWithValue` — a C# string arrives as `text`, and PG has no implicit `text → jsonb` assignment cast, so the INSERT/UPDATE placeholder must read `$n::jsonb` (explicit I/O cast; precedent for typed placeholders: `src_C/Vpc/Authoring/ContentIntelligence.cs:77-78` `$1::int`, `$3::text`). A `DBNull` bound to `$13::jsonb` is fine: the cast fixes the parameter type (the reasoning pinned by `ProgressEventsSingleStatementTests.PreparedStatement_BindsNullAndNonNullParametersAlike`, `:473`). On the way out, `DbUtil.cs:24` `reader.GetValue(i)` hands a jsonb column to the row dictionary as a .NET **string** in PG's text form (`{"v": 1, "options": [...]}` — `": "` / `", "` spacing, PG key order), and `Res` serialises rows with `JsonSerializerOptions { CamelCase, DefaultIgnoreCondition.Never }` (`src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-99`, `Wrap` `:145`), so without conversion the API would answer `"mcq":"{\"v\": 1, …}"`. A `JsonElement` value in the dictionary serialises as an object (verified with a probe on this machine: `{"id":1,"mcq":{"v":1,…},"mcq2":null}`), which is what `Helpers.JsonbCell` does. `JsonSerializer.Deserialize<JsonElement>(s)` preserves the string's key order (verified: a PG-spaced string enumerates `v, options, shuffle, qualifier`) and returns an own copy — `JsonDocument.Parse(s).RootElement` would dangle after the document is disposed (`Validation.ParseJsonBody`, `Validation.cs:30-36`, is a `using var doc` in both handlers, `Cards.cs:101`, `:199`).
- **Response envelope.** `Res.BadRequest(code, message)` `:161` → 400 `{success:false,data:null,error:{code,message},traceId,version}`; `Res.Ok(data)` `:159`. A new code is just `res.BadRequest("MCQ_…", "…")`.
- **`ValidationError` is `public sealed class`** (`src_C/Shared/RecallSmith.Lambda.Common/Validation.cs:8-16`, duplicated verbatim in the legacy `src_C/Common/Validation.cs`). C00 §2.9.2 writes `McqValidationError : ValidationError`; that cannot compile, and `src_C/Shared` is outside this issue (C00 §1.2 lists only the six files below). **Resolution (recorded here, binding for C08): `McqValidationError` derives from `Exception`.** Consequence: the generic `catch (Exception ex) when (ex is ValidationError)` arms do **not** catch it, so every handler that calls `Canonicalize` catches `McqValidationError` by name — which C00 already demands ("before the generic `ValidationError` arm"). C09's publish gate will do the same.
- **Test harness.** DB classes are `[Collection(PostgresCollection.Name)]` (`IntegrationTestBase.cs:158-165`, serial) with a `PostgresFixture` ctor argument; `_db.QueryAsync(sql, params)` `:88-92` runs raw SQL through `DbUtil`. The authoring-handler precedent is `CardsPageTests.cs:24-32` (class head), `:38-45` (`NewDeckAsync`: `insert into decks (slug, title, author) values ($1, $2, $3) returning id`), `:66-92` (`Event(...)`: a real API Gateway v2 event with `requestContext.http.method`, JWT claims `sub` + `cognito:groups`, `body` string, `isBase64Encoded`) and `:94-99` (`new LambdaRequest(...)`, `new Res(req.TraceId)`, `Auth.GetAuthContext(req)`, direct handler call). Those helpers are `private` — write your own in the new class (method + body). `LambdaHost` (`IntegrationTestBase.cs:172-`) asserts 200 and is not usable for 400 cases. Pure-class precedent: `ContentSerializationContractTests.cs:10-36` (no collection attribute); `[Theory]` + `[MemberData]` precedent: `DeckDiffTests.cs:114-136`. Groups: `super_admin` (`Auth.cs:88`).
- **Canonical form (C00 §2.9.1, MCQ plan §3.2).** PG jsonb orders object keys by length then bytes, so a stored blob reads back as `v, options, shuffle, qualifier` / `key, why, text, correct`. The canonical string uses exactly that order so a round trip changes only PG's spacing. Escaping: the string goes into PG as `::jsonb` and PG re-emits its own text, so escaping never reaches disk; for the golden bytes in `McqValidationTests` the encoder is pinned to `JavaScriptEncoder.UnsafeRelaxedJsonEscaping` (verified on this machine: leaves `'`, `/`, `+`, `<`, `&` and non-ASCII unescaped, escapes only `"`, `\` and control characters — the §4.3 card text contains `bucket's`, which the default encoder would turn into `bucket's`).
- **The only MCQ example text allowed anywhere in this issue** is the two original cards at `docs/mcq-card-type-plan-2026-09-18.md:177-253` (§4.3). Never copy exam-dump content. The two golden canonical strings for those cards are given verbatim in change 6 — they were generated from hand-typed blobs with the algorithm of change 2, joining the doc's wrapped lines with one space.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables: migrations, banned literals, do-not-touch), §1.2 (your six-file row), §2.9.1–§2.9.3 (this contract, verbatim), §2.9.4 (what C09 does next — so you leave it room, not do it), §3.1 "C08: none existing", §3.2 (the two test files), §5 (verify conventions), §6 #1, #13, #14, #16.
2. `src_C/Vpc/Authoring/Cards.cs` whole file (342 lines on base; ~350 after C05).
3. `src_C/Vpc/Authoring/Helpers.cs:1-66` (usings, `UpdateField`, `BuildUpdateSet`) and `:80-100` (integer parsers you reuse).
4. `src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:8-30` and `:53-71`; `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-99`, `:145-163`; `src_C/Shared/RecallSmith.Lambda.Common/Validation.cs:8-16`, `:30-40`.
5. `src_C/Vpc/Db/Migrations/017_cards_keyset_index.sql:1-11`, `:30-31`; `src_C/Vpc/Db/Migrations/018_cards_topic.sql` (C05, whole); `src_C/Vpc/Db/Migrate.cs:23-48`.
6. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:27-98`, `:136-165`; `CardsPageTests.cs:1-99`; `ContentSerializationContractTests.cs:1-36`; `DeckDiffTests.cs:114-136`; `CardsAuthoringTopicTests.cs` (C05's new class — the closest precedent for POST/PUT events; copy its event builder shape, not its file).
7. `docs/mcq-card-type-plan-2026-09-18.md:62-104` (§3.1–§3.2, the rules; remember §3.1's "PUT in a transaction … rollback" is superseded by C00 §6 #14: pre-read + effective-value check, no transaction) and `:172-254` (§4.3, the two cards).
8. `src_C/Vpc/Authoring/Decks.cs:196-224` (the other `UpdateField` caller that must keep compiling unchanged).

## Constraints

- **Scope (the ONLY files that may change):**
  - `src_C/Vpc/Db/Migrations/019_cards_mcq.sql` (new)
  - `src_C/Vpc/Authoring/McqValidation.cs` (new)
  - `src_C/Vpc/Authoring/Cards.cs` (edit)
  - `src_C/Vpc/Authoring/Helpers.cs` (edit)
  - `src_C/Tests/RecallSmith.Lambda.IntegrationTests/McqValidationTests.cs` (new)
  - `src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardsAuthoringMcqTests.cs` (new)
  Nothing else. In particular **not** `CardsPage.cs`, `Publish.cs`, `Decks.cs`, anything under `src_C/Worker`, `src_C/Shared`, `src_C/Common`, `src_C/Public`, `src_C/Vpc/Runtime`, any `.csproj`/`.sln`, `snowflake/`, `frontend/`, `mobile/`, or any top-level `docs/*.md`. No file named `018_cards_mcq.sql`, ever.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. This is a server issue: the whole `mobile/` and `frontend/` trees stay byte-identical (the verify diffs them).
- **OTA / dependency rule:** no `mobile/package.json`, `package-lock.json`, `app.json`, `eas.json`; no NuGet package added or bumped (`src_C/**/*.csproj` unchanged); no `dotnet add package`, no `npm install`, no network beyond what `dotnet build` needs from the local NuGet cache.
- **No new `eventType`, no `schemaVersion` bump, no manifest key, no CHECK constraint, no index** (C00 §0; MCQ plan §3.1).
- **Byte identity elsewhere is C09's problem, not yours** — but do not pre-empt it: `CardExportData`, `DeckDiff`, `PublishJobProcessor`, `ContentSerializationContractTests` are untouched.
- **Existing tests:** no existing test file changes (C00 §3.1 "C08: none existing"). `CardsPageTests.cs`, `CardsAuthoringTopicTests.cs` (C05), `ProgressEventsSingleStatementTests.cs` are byte-identical. The full `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` must stay green (the driver runs it after your verify).
- **Banned literals in any new/changed line:** the six driver-gate terms (do not spell them out in comments either — use "work around", "sidestep", "sensor", "guard", "fallback", "probe"). No `[Fact(Skip = …)]`, `[Theory(Skip = …)]`, `#pragma warning disable`, `@ts-ignore`, `eslint-disable`, `.skip(`, `.only(` in any diff.
- **Purity:** `McqValidation.cs` imports only `System.Text.Json`, `System.Text.Json.Serialization` (if needed), `System.Text.Encodings.Web`, `System.Text.RegularExpressions`, `System.Text` — no Npgsql, no `DbUtil`, no `Res`, no I/O. `McqValidationTests.cs` has no `[Collection]` attribute and never opens a connection.
- **dotnet / Docker notes:** run everything from `src_C` (`cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~McqValidationTests"`); the root holds both a `.sln` and a legacy `.csproj`, so always name the test project. Docker Desktop must be running for `CardsAuthoringMcqTests` (`docker info` must succeed; `postgres:16-alpine` is cached on this machine). Your worktree has no `bin/`/`obj/`: the first `dotnet build` restores from the local NuGet cache (offline is fine). dotnet SDK here is 8.0.413; `TreatWarningsAsErrors` is not set, but do not introduce warnings in the files you own. The DB collection runs serially and shares one container; isolate by minting a fresh deck slug / stable uid per test (`Guid.NewGuid():N`), never by truncating tables.
- **Standing rules:** no `git push`, no PR, never touch `main`, no deploy, no migration run against any real database, no test gutting.

## Changes required

1. **`src_C/Vpc/Db/Migrations/019_cards_mcq.sql` (new)** — exactly one statement under a header comment in the style of `017_cards_keyset_index.sql:1-4`:
   ```sql
   -- =========================
   -- 019_cards_mcq.sql
   -- Optional MCQ overlay on a card. NULL = plain Q/A card (the only kind that
   -- exists before this migration). The blob's shape is validated at the API
   -- boundary (McqValidation.Canonicalize) and again by the publish gate, so
   -- there is no CHECK here and no index. One statement; runs inside
   -- Migrate.ApplyOne's transaction like every other migration.
   -- =========================
   alter table cards add column if not exists mcq jsonb null;
   ```
   The statement line is byte-exact (`alter table cards add column if not exists mcq jsonb null;`). No other file in `Migrations/` changes; `018_cards_topic.sql` (C05) must already exist beside it.

2. **`src_C/Vpc/Authoring/McqValidation.cs` (new, pure)** — namespace `RecallSmith.Lambda.Vpc.Authoring`. Two public types, signatures verbatim (the class base is the one deliberate deviation from C00 §2.9.2, see Context):
   ```csharp
   /// Raised by McqValidation.Canonicalize. NOT a ValidationError (that class is sealed and lives in
   /// src_C/Shared); every handler that canonicalises catches this type by name and answers
   /// res.BadRequest(ex.Code, ex.Message).
   public sealed class McqValidationError : Exception
   {
     public string Code { get; }
     public McqValidationError(string code, string message) : base(message) { Code = code; }
   }

   public static class McqValidation
   {
     /// Validates `raw` against C00 §2.9.1 and returns the canonical compact JSON string in the pinned key
     /// order. `question` null → the two stem checks (MCQ_QUALIFIER_NOT_IN_STEM, MCQ_CHOOSE_N_MISMATCH) are skipped.
     public static string Canonicalize(JsonElement raw, string? question);
     /// 1..3 — the only difficulties an MCQ card may carry (rarity = difficulty; snapshot CHECK, MCQ plan §3.10).
     public static bool IsMcqDifficulty(int difficulty);
     public static bool IsMcqDifficulty(long difficulty);
   }
   ```
   `IsMcqDifficulty(int)` is C00's pinned signature (C09 calls it); the `long` overload exists because `Cards.cs` holds difficulty as `long?` and a silent `(int)` cast would let `4294967297` through as `1`. Both are `difficulty is >= 1 and <= 3`.

   **`Canonicalize` — checks in this order, each throwing `McqValidationError(code, message)` where the message names the offending key/index (free text, codes pinned):**
   1. `raw.ValueKind != JsonValueKind.Object` → `MCQ_BAD_SHAPE`.
   2. `v` absent, not a JSON number, or not exactly `1` (`TryGetInt32` → 1) → `MCQ_BAD_VERSION`.
   3. `options` absent or not an array → `MCQ_BAD_SHAPE`. `shuffle`: absent → `true`; JSON `true`/`false` → that value; anything else → `MCQ_BAD_SHAPE`. `qualifier`: absent or JSON null → null; string → `Trim()`; anything else → `MCQ_BAD_SHAPE`.
   4. option count `< 3` → `MCQ_TOO_FEW_OPTIONS`; `> 6` → `MCQ_TOO_MANY_OPTIONS`.
   5. Each option, in stored order: not an object → `MCQ_BAD_SHAPE`; `key` absent/not string → `MCQ_BAD_SHAPE`; `text` absent/not string → `MCQ_BAD_SHAPE`; `correct` absent/not `true`/`false` → `MCQ_BAD_SHAPE`; `why` present but neither null nor string → `MCQ_BAD_SHAPE`. Collect `(key, text.Trim(), why?.Trim() with "" → null, correct)`.
   6. Any key not matching `^[a-f]$` (lowercase, one char — the API is strict; only the importer lowercases) → `MCQ_KEY_SEQUENCE`.
   7. Any repeated key → `MCQ_DUPLICATE_OPTION_KEY`.
   8. `key[i] != (char)('a' + i)` for any `i` → `MCQ_KEY_SEQUENCE` (consecutive from `a` in stored order).
   9. Per option in order: trimmed `text` empty → `MCQ_OPTION_EMPTY`; `text.Length > 600` → `MCQ_OPTION_TOO_LONG`.
   10. Two options with the same trimmed text (`OrdinalIgnoreCase`) → `MCQ_OPTION_TEXT_DUPLICATE`.
   11. `requiredCount = count(correct)`: `0` → `MCQ_NO_CORRECT`; `== option count` → `MCQ_ALL_CORRECT`; `> 3` → `MCQ_TOO_MANY_CORRECT` (checked in that order, so 4 of 4 is `MCQ_ALL_CORRECT`, 4 of 6 is `MCQ_TOO_MANY_CORRECT`).
   12. Any option with `correct == false` and `why == null` → `MCQ_WHY_MISSING` (a correct option's `why` is optional).
   13. `qualifier` non-null: empty after trim → `MCQ_QUALIFIER_EMPTY`; `Regex.IsMatch(qualifier, "choose (two|three)", RegexOptions.IgnoreCase)` → `MCQ_QUALIFIER_IS_CHOOSE_N`; `question != null && !question.Contains(qualifier, StringComparison.OrdinalIgnoreCase)` → `MCQ_QUALIFIER_NOT_IN_STEM`.
   14. `question != null`: `m = Regex.Match(question, @"\(choose (two|three)\.?\)", RegexOptions.IgnoreCase)`; `expected = m.Success ? (two → 2, three → 3) : 1`; `requiredCount != expected` → `MCQ_CHOOSE_N_MISMATCH` (both directions: "(Choose two.)" with one correct, and two correct without the marker).
   15. Unknown keys on the blob or on an option are ignored and dropped from the output (not an error).
   16. Write the canonical string with `Utf8JsonWriter` over a `MemoryStream`, `new JsonWriterOptions { Indented = false, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }`, in exactly this order: `WriteNumber("v", 1)`; `options` array, each option `WriteString("key", …)`, `why` (`WriteString` or `WriteNull("why")`), `WriteString("text", …)`, `WriteBoolean("correct", …)`; `WriteBoolean("shuffle", …)`; `qualifier` (`WriteString` or `WriteNull("qualifier")`). Return `Encoding.UTF8.GetString(stream.ToArray())`. Shape, for reference: `{"v":1,"options":[{"key":"a","why":null,"text":"…","correct":true},{"key":"b","why":"…","text":"…","correct":false}],"shuffle":true,"qualifier":null}`. `why` and `qualifier` are explicit `null` when absent; trimmed values are what gets stored.
   The 18 codes, all of which must appear as string literals in this file: `MCQ_BAD_SHAPE`, `MCQ_BAD_VERSION`, `MCQ_TOO_FEW_OPTIONS`, `MCQ_TOO_MANY_OPTIONS`, `MCQ_KEY_SEQUENCE`, `MCQ_DUPLICATE_OPTION_KEY`, `MCQ_OPTION_EMPTY`, `MCQ_OPTION_TOO_LONG`, `MCQ_OPTION_TEXT_DUPLICATE`, `MCQ_NO_CORRECT`, `MCQ_TOO_MANY_CORRECT`, `MCQ_ALL_CORRECT`, `MCQ_WHY_MISSING`, `MCQ_QUALIFIER_EMPTY`, `MCQ_QUALIFIER_IS_CHOOSE_N`, `MCQ_QUALIFIER_NOT_IN_STEM`, `MCQ_CHOOSE_N_MISMATCH`, plus (raised by the handlers, not here — do not put them in this file) `MCQ_EXPLANATION_REQUIRED`, `MCQ_DIFFICULTY_RANGE`. No `JsonDocument.Parse(` anywhere in this file (the input is already an element).

3. **`src_C/Vpc/Authoring/Helpers.cs`** — three edits, verbatim from C00 §2.9.3:
   a. `:48` becomes
      ```csharp
      public sealed record UpdateField(string BodyKey, string ColumnName, Func<JsonElement, object?> Transform, string Cast = "");
      ```
      (default `""` keeps every existing three-argument `new(...)` in `Cards.cs` and `Decks.cs:196-224` compiling and emitting byte-identical SQL).
   b. `:60` becomes `fields.Add($"{f.ColumnName} = ${idx++}{f.Cast}");` — nothing else in `BuildUpdateSet` moves (`:58` still skips absent keys, `:64` still appends `updated_at = now()`).
   c. Append two methods (after `GetDeckIdByCardId`, `:143-148`, or next to `BuildUpdateSet` — your choice, but both in this class):
      ```csharp
      /// A jsonb column arrives from DbUtil.QueryAsync as a .NET string in PG text form (DbUtil.cs:24 GetValue;
      /// parameters bind via AddWithValue, :63-68). Returns an OWN copy (JsonSerializer.Deserialize<JsonElement>(s)),
      /// never JsonDocument.Parse(...).RootElement. null / absent → null; an already-converted JsonElement is returned as is.
      public static JsonElement? JsonbElement(IReadOnlyDictionary<string, object?> row, string key)
      /// In place: row[key] = JsonbElement(row, key) when the key is present (a null cell stays null, so the wire
      /// carries "mcq": null for a Q/A card). Absent key → no-op.
      public static void JsonbCell(Dictionary<string, object?> row, string key)
      ```
      Implementation of `JsonbElement`: `row.TryGetValue(key, out var v)`; `v is JsonElement je` → `je`; `v is string s` → `JsonSerializer.Deserialize<JsonElement>(s)`; otherwise `null`. No `JsonDocument.Parse(` in this file.

4. **`src_C/Vpc/Authoring/Cards.cs`** — GET, POST, PUT; DELETE untouched.
   a. **GET.** Select list: add `c.mcq` as the **last** column, directly after C05's `c.topic` (so the order is `…, c.updated_at as "updatedAt", c.topic, c.mcq`). After `var rows = await DbUtil.QueryAsync(...)` (`:82` on base) and before `return res.Ok(rows);`: `foreach (var row in rows) Helpers.JsonbCell(row, "mcq");`. Filters, joins, ordering unchanged.
   b. **POST.** After the `difficultyInt`/`revisionInt`/`versionInt` lines (`:131-133`) and C05's topic parse, add
      ```csharp
      var mcq = body.TryGetProperty("mcq", out var mcqEl) && mcqEl.ValueKind != JsonValueKind.Null
        ? McqValidation.Canonicalize(mcqEl, question)
        : null;
      if (mcq is not null)
      {
        if (string.IsNullOrWhiteSpace(explanation)) return res.BadRequest("MCQ_EXPLANATION_REQUIRED", "explanation is required for an MCQ card");
        if (!McqValidation.IsMcqDifficulty(difficultyInt ?? 2)) return res.BadRequest("MCQ_DIFFICULTY_RANGE", "difficulty must be 1..3 for an MCQ card");
      }
      ```
      (`question` is the trimmed, non-empty string from `:115`; `explanation` the trimmed-or-null from `:126`; `difficultyInt ?? 2` mirrors `coalesce($8,2)`.) INSERT: column list gains `mcq` after C05's `topic`, so its second line reads byte-exact `real_world_usage, difficulty, order_in_deck, revision, version, topic, mcq`; the VALUES list gains `$13::jsonb` after `$12` (C05's bare `$12` line becomes `$12,` and `$13::jsonb` is the new last line); RETURNING gains `mcq` after `topic` (last). Params array appends `mcq` as the 13th entry. Before `return res.Ok(rows.Count > 0 ? rows[0] : null);` (`:181`): `if (rows.Count > 0) Helpers.JsonbCell(rows[0], "mcq");`. Insert a new catch arm **first**, before `catch (Exception ex) when (ex is ValidationError)` (`:183`):
      ```csharp
      catch (McqValidationError ex)
      {
        return res.BadRequest(ex.Code, ex.Message);
      }
      ```
   c. **PUT — pre-check (C00 §6 #14: no transaction; the `expectedVersion` match at `:264-267` / `:290-295` makes the pre-read race-safe).** After the deck-move guard (`:231-234`) and before `var spec = …` (`:236`):
      ```csharp
      var stored = await DbUtil.QueryAsync(conn, null, "select question, explanation, difficulty, mcq from cards where id = $1", [idInt]);
      if (stored.Count == 0) return res.NotFound("Card not found");
      var storedRow = stored[0];
      var effectiveQuestion = body.TryGetProperty("question", out var qEl) && qEl.ValueKind != JsonValueKind.Null
        ? qEl.ToString().Trim()
        : storedRow["question"] as string ?? string.Empty;
      var effectiveExplanation = body.TryGetProperty("explanation", out var exEl)
        ? (exEl.ValueKind == JsonValueKind.Null ? null : exEl.ToString().Trim())
        : storedRow["explanation"] as string;
      long? effectiveDifficulty = body.TryGetProperty("difficulty", out var dEl)
        ? (dEl.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(dEl, "difficulty"))
        : Convert.ToInt64(storedRow["difficulty"], CultureInfo.InvariantCulture);
      string? effectiveMcq;
      if (body.TryGetProperty("mcq", out var mcqEl))
      {
        effectiveMcq = mcqEl.ValueKind == JsonValueKind.Null ? null : McqValidation.Canonicalize(mcqEl, effectiveQuestion);
      }
      else
      {
        var storedMcq = Helpers.JsonbElement(storedRow, "mcq");
        effectiveMcq = storedMcq is null ? null : McqValidation.Canonicalize(storedMcq.Value, effectiveQuestion);
      }
      if (effectiveMcq is not null)
      {
        if (string.IsNullOrWhiteSpace(effectiveExplanation)) return res.BadRequest("MCQ_EXPLANATION_REQUIRED", "explanation is required for an MCQ card");
        if (effectiveDifficulty is not long d || !McqValidation.IsMcqDifficulty(d)) return res.BadRequest("MCQ_DIFFICULTY_RANGE", "difficulty must be 1..3 for an MCQ card");
      }
      ```
      The pre-read SQL literal `select question, explanation, difficulty, mcq from cards where id = $1` is byte-exact. Re-canonicalising a stored blob is idempotent (it is already canonical) — the point is re-running the two stem checks when only `question` changes.
   d. **PUT — spec.** Add, after C05's `topic` entry and before `isDeleted`, verbatim:
      ```csharp
      new("mcq", "mcq", v => v.ValueKind == JsonValueKind.Null ? null : McqValidation.Canonicalize(v, effectiveQuestion), "::jsonb"),
      ```
      The editor filter `:251-255` is byte-identical (`spec = spec.Where(f => f.BodyKey is not ("deckId" or "isDeleted" or "stableUid")).ToList();`) — editors may write `mcq`. RETURNING (`:268-283`) gains `mcq` after `topic` (last). Before `return res.Ok(rows[0]);` (`:297`): `Helpers.JsonbCell(rows[0], "mcq");`. Add the same `catch (McqValidationError ex)` arm first, before `:299`. The `VERSION_CONFLICT` / 404 branch `:290-295` is unchanged.
   e. Nothing else: no transaction, no `select *`, no change to `HandlePgError`, no change to DELETE, no reordering of existing columns (C05's `topic` stays immediately before `mcq` everywhere). Wire key is `mcq`; a Q/A card answers `"mcq": null` from all three handlers.

5. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/McqValidationTests.cs` (new, pure — no `[Collection]`, no DB).** Golden constants, hand-typed as `const string`, byte-exact, **each on ONE source line** (a raw string literal `"""…"""` or a regular `"…"` literal with `\"` escapes are both accepted — the verify greps the whole string in either spelling; `+` concatenation or a multi-line raw literal is not):
   ```
   SqsCanonical = {"v":1,"options":[{"key":"a","why":"Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.","text":"Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.","correct":false},{"key":"b","why":null,"text":"Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.","correct":true},{"key":"c","why":"A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.","text":"Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.","correct":false},{"key":"d","why":"Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.","text":"Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.","correct":false}],"shuffle":true,"qualifier":"LEAST operational overhead"}
   ```
   ```
   S3Canonical = {"v":1,"options":[{"key":"a","why":null,"text":"Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.","correct":true},{"key":"b","why":"Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.","text":"Enable S3 Transfer Acceleration on the source bucket.","correct":false},{"key":"c","why":null,"text":"Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.","correct":true},{"key":"d","why":"A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.","text":"Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.","correct":false},{"key":"e","why":"MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.","text":"Enable MFA Delete on the source bucket.","correct":false}],"shuffle":true,"qualifier":null}
   ```
   Stems (`const string SqsQuestion` / `S3Question`, the doc's wrapped lines joined with one space): `An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost. The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?` and `A company must keep a copy of every object written to an S3 bucket in a second Region and must be able to prove that no copy can be deleted for seven years, even by an account administrator. Which combination of actions meets these requirements? (Choose two.)`. The *inputs* are hand-typed in the doc's written order (`v`, `qualifier`, `options` with `key, text, why, correct`; no `shuffle`; correct options without a `why` key) — proving the canonicaliser reorders and fills defaults. Cases, names verbatim:
   1. `Canonicalize_SqsCard_ProducesThePinnedBytes` — `Assert.Equal(SqsCanonical, McqValidation.Canonicalize(el, SqsQuestion))`.
   2. `Canonicalize_S3ChooseTwoCard_ProducesThePinnedBytes` — same for the S3 card (`"qualifier":null`, two correct, "(Choose two.)" satisfied).
   3. `Canonicalize_IsStable_AfterPgSpacedRoundTrip` — take `SqsCanonical`, re-space it as PG would (`": "` and `", "` — e.g. `JsonSerializer.Serialize(JsonSerializer.Deserialize<JsonElement>(SqsCanonical), new JsonSerializerOptions { WriteIndented = true })` is an acceptable stand-in for "different spacing, same order"), `Deserialize<JsonElement>` it, assert `EnumerateObject().Select(p => p.Name)` is exactly `["v","options","shuffle","qualifier"]` and the first option's is `["key","why","text","correct"]`, then `Canonicalize(el, SqsQuestion) == SqsCanonical`.
   4. `Canonicalize_DefaultsShuffleTrue_AndNullQualifier` — a minimal 3-option blob without `shuffle`/`qualifier`/`why` on the correct option → output ends `"shuffle":true,"qualifier":null}` and the correct option carries `"why":null`; with `"shuffle":false` the output carries `"shuffle":false`.
   5. `Canonicalize_SkipsStemChecks_WhenQuestionIsNull` — the SQS blob with `question: null` does not throw even though no stem is given; the S3 blob likewise.
   6. `Canonicalize_DropsUnknownKeys` — `"foo":1` on the blob and `"bar":true` on an option are absent from the output.
   7. `Canonicalize_LeavesApostrophesAndNonAsciiUnescaped` — an option text `it's über` comes out as `it's über`, not `it's über`.
   8. `Canonicalize_RejectsEveryCode` — `[Theory]` + `[MemberData(nameof(Rejections))]` with `(string code, string json, string? question)` rows; `var ex = Assert.Throws<McqValidationError>(() => McqValidation.Canonicalize(el, question)); Assert.Equal(code, ex.Code);`. `Rejections` yields **at least one row for each of the 17 codes** the canonicaliser raises (`MCQ_BAD_SHAPE`, `MCQ_BAD_VERSION`, `MCQ_TOO_FEW_OPTIONS`, `MCQ_TOO_MANY_OPTIONS`, `MCQ_KEY_SEQUENCE`, `MCQ_DUPLICATE_OPTION_KEY`, `MCQ_OPTION_EMPTY`, `MCQ_OPTION_TOO_LONG`, `MCQ_OPTION_TEXT_DUPLICATE`, `MCQ_NO_CORRECT`, `MCQ_TOO_MANY_CORRECT`, `MCQ_ALL_CORRECT`, `MCQ_WHY_MISSING`, `MCQ_QUALIFIER_EMPTY`, `MCQ_QUALIFIER_IS_CHOOSE_N`, `MCQ_QUALIFIER_NOT_IN_STEM`, `MCQ_CHOOSE_N_MISMATCH`) and two rows for `MCQ_CHOOSE_N_MISMATCH` (marker without two correct; two correct without marker). Build the rows from a small helper that mutates a valid 4-option blob, not from exam text.
   9. `IsMcqDifficulty_AcceptsOneToThreeOnly` — `[Theory]` `[InlineData(0,false)] [InlineData(1,true)] [InlineData(2,true)] [InlineData(3,true)] [InlineData(4,false)]` over both overloads (`(int)` and `(long)`), plus `4294967297L` → false.
   10. `McqValidationError_CarriesTheCode_AndIsNotAValidationError` — `Exception ex = new McqValidationError("MCQ_BAD_SHAPE", "m"); Assert.False(ex is ValidationError); Assert.Equal("MCQ_BAD_SHAPE", ((McqValidationError)ex).Code); Assert.Equal("m", ex.Message);`.

6. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardsAuthoringMcqTests.cs` (new, `[Collection(PostgresCollection.Name)]`, ctor `(PostgresFixture db)`).** Private helpers: `NewDeckAsync(tag)` (copy of `CardsPageTests.cs:38-45`); `Event(string method, string sub, string[] groups, object? body)` — the `CardsPageTests.cs:66-92` event with `http = new { method }`, `rawPath = "/api/v1/authoring/cards"`, `body = body is null ? null : JsonSerializer.Serialize(body)`, `queryStringParameters` optional; `InvokeAsync(method, body, query = null)` → `new LambdaRequest(...)`, `new Res(req.TraceId)`, `Cards.HandleAuthoringCards(req, res, Auth.GetAuthContext(req))` as `super_admin`; `Data(response)` → `JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone()`; `ErrorCode(response)` → `error.code`. Blobs: build the SQS and S3 cards of §4.3 as anonymous objects (or reuse the two canonical strings via `JsonSerializer.Deserialize<JsonElement>`); a Q/A card is a POST without `mcq`. Every card gets a fresh `stableUid` (`Guid.NewGuid():N`) and `orderInDeck`. Cases, names verbatim:
   1. `Post_WithMcq_EchoesMcqAsObject_InPgKeyOrder` — POST `{deckId, stableUid, question: SqsQuestion, explanation: "…", difficulty: 2, orderInDeck: 10, mcq: <SQS blob in doc order>}` → 200; `data.mcq.ValueKind == JsonValueKind.Object` (never `String`); top-level keys enumerate exactly `v, options, shuffle, qualifier`; `options[0]` keys `key, why, text, correct`; `JsonNode.DeepEquals(JsonNode.Parse(data.mcq.GetRawText()), JsonNode.Parse(SqsCanonical))` (re-declare the two golden strings here or a shared `internal static class McqFixtures` **inside this test file**; no new file).
   2. `Get_ReturnsMcqAsObject_ForEveryReader` — after the POST above: GET `?id=` → `mcq` Object; GET `?deckId=` → the row's `mcq` Object; the raw DB text (`_db.QueryAsync("select mcq::text as t from cards where id = $1", id)`) is a string containing `"v": 1` (PG spacing) — proving the conversion happens in the handler, not in PG.
   3. `Post_QaCard_ReturnsMcqNull` — POST without `mcq` → 200, `data` has the key `mcq` with `ValueKind == JsonValueKind.Null`; GET `?id=` likewise.
   4. `Post_McqWithoutExplanation_IsRejected` — `explanation` absent → 400 `MCQ_EXPLANATION_REQUIRED`; `explanation: "   "` → same; and no row was inserted (`select count(*) … where stable_uid = $1` is 0).
   5. `Post_McqDifficultyOutOfRange_IsRejected` — `difficulty: 4` → 400 `MCQ_DIFFICULTY_RANGE`; `difficulty: 0` → same; `difficulty` absent (DB default 2) → 200.
   6. `Post_InvalidBlob_ReturnsTheMcqCode` — a 2-option blob → 400 with `error.code == "MCQ_TOO_FEW_OPTIONS"` (proves the `McqValidationError` arm answers with the specific code, not `VALIDATION_ERROR` and not 500); a blob whose qualifier is not in the stem → `MCQ_QUALIFIER_NOT_IN_STEM`.
   7. `Put_McqNull_ClearsTheColumn` — POST an MCQ card, PUT `{id, expectedVersion: 1, mcq: null}` → 200, `data.mcq` Null, `data.version == 2`; GET → Null; DB `mcq is null`.
   8. `Put_WithoutMcq_LeavesItIntact` — POST an MCQ card, PUT `{id, expectedVersion: 1, realWorldUsage: "changed"}` → 200, `data.mcq` Object deep-equal to the stored blob; DB `mcq::text` unchanged.
   9. `Put_ReplacesTheBlob_AndEchoesObject` — POST the SQS card, PUT `{id, expectedVersion: 1, question: S3Question, mcq: <S3 blob>}` → 200, `data.mcq` Object with five options and `"qualifier":null`; GET agrees.
   10. `Put_BlankExplanationOrBadDifficulty_OnMcqCard_IsRejected` — on an MCQ card: PUT `{explanation: null}` → 400 `MCQ_EXPLANATION_REQUIRED`; PUT `{explanation: "  "}` → same; PUT `{difficulty: 5}` → 400 `MCQ_DIFFICULTY_RANGE`; the card's `version` is still 1 afterwards (no write happened).
   11. `Put_QuestionChange_ReChecksTheStoredStem` — SQS card stored (qualifier `LEAST operational overhead`); PUT `{question: "Which option is best?"}` without `mcq` → 400 `MCQ_QUALIFIER_NOT_IN_STEM`; PUT `{question: SqsQuestion + " Really?"}` → 200. On the S3 card: PUT `{question: <stem without "(Choose two.)">}` → 400 `MCQ_CHOOSE_N_MISMATCH`.
   12. `Put_McqOntoQaCard_RequiresExplanation` — POST a Q/A card with no explanation; PUT `{mcq: <SQS blob>, question: SqsQuestion}` → 400 `MCQ_EXPLANATION_REQUIRED`; PUT `{mcq: <SQS blob>, question: SqsQuestion, explanation: "e"}` → 200 with `data.mcq` Object.
   13. `Put_StaleVersion_StillReportsVersionConflict` — a valid MCQ PUT with `expectedVersion: 99` → 400 `VERSION_CONFLICT` (the pre-check never replaces the optimistic match).

Estimated size: migration ~10 lines, `McqValidation.cs` ~170 lines, `Helpers.cs` +18 lines, `Cards.cs` +45 lines, `McqValidationTests.cs` ~230 lines, `CardsAuthoringMcqTests.cs` ~330 lines.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C08.verify.sh` re-runs exactly these.

- The six scope files exist (four new); `018_cards_topic.sql` exists and `Cards.cs` contains `c.topic` (C05 merged); `src_C/Vpc/Db/Migrations/018_cards_mcq.sql` does **not** exist; `019_cards_mcq.sql` is the only `019_*.sql` and contains the byte-exact `alter table cards add column if not exists mcq jsonb null;`, no `create index`, no `check`.
- `McqValidation.cs`: `public sealed class McqValidationError : Exception`, `public string Code { get; }`, `public McqValidationError(string code, string message) : base(message)`, `public static string Canonicalize(JsonElement raw, string? question)`, `public static bool IsMcqDifficulty(int difficulty)`, `public static bool IsMcqDifficulty(long difficulty)`, `JavaScriptEncoder.UnsafeRelaxedJsonEscaping`, all 17 `MCQ_…` canonicaliser codes as literals; no `MCQ_EXPLANATION_REQUIRED`/`MCQ_DIFFICULTY_RANGE`, no `Npgsql`, no `DbUtil`, no `JsonDocument.Parse(`.
- `Helpers.cs`: the exact `UpdateField` record line with `string Cast = ""`, the exact `fields.Add($"{f.ColumnName} = ${idx++}{f.Cast}");`, both `JsonbElement`/`JsonbCell` signatures, `JsonSerializer.Deserialize<JsonElement>`, no `JsonDocument.Parse(`.
- `Cards.cs`: `c.mcq` present and after `c.topic` (the bare last select line is `c.mcq`, `c.topic,` carries a comma); the INSERT column line `real_world_usage, difficulty, order_in_deck, revision, version, topic, mcq`; `$13::jsonb` as the bare last VALUES line; `mcq;` closes both RETURNING lists; `Helpers.JsonbCell(row, "mcq")` (GET loop) and `Helpers.JsonbCell(rows[0], "mcq")` (POST + PUT); the PUT spec entry with `"::jsonb")`; the pre-read literal `select question, explanation, difficulty, mcq from cards where id = $1`; `MCQ_EXPLANATION_REQUIRED` and `MCQ_DIFFICULTY_RANGE` each at least twice (POST + PUT); `catch (McqValidationError ex)` at least twice, each within five lines **before** a `catch (Exception ex) when (ex is ValidationError)` arm; `Helpers.JsonbCell(` at least three times; the editor filter line byte-identical; no `BeginTransaction`, no `select *`.
- Tests: the 10 `McqValidationTests` and 13 `CardsAuthoringMcqTests` method names above appear verbatim; `McqValidationTests.cs` has no `[Collection`; `CardsAuthoringMcqTests.cs` has `[Collection(PostgresCollection.Name)]`; both golden constants `SqsCanonical` / `S3Canonical` byte-exact in `McqValidationTests.cs`; no `Skip =` anywhere in the two files.
- `cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests` exit 0.
- `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --no-build --filter "FullyQualifiedName~McqValidationTests"` exit 0 (no Docker needed) and `… --filter "FullyQualifiedName~CardsAuthoringMcqTests"` exit 0 (Docker required).
- Scope + frozen guard: nothing outside the six files (plus `docs/delivery/r16-issues/`) differs from the merge-base, tracked or untracked under `src_C/Vpc src_C/Worker src_C/Tests src_C/Shared src_C/Common src_C/Public`; `mobile/`, `frontend/`, `snowflake/`, every `.csproj`, `Decks.cs`, `CardsPage.cs`, `Publish.cs`, `src_C/Worker/**` and the three frozen mobile files are zero-diff.

## Verify

```bash
cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -nologo
cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --no-build --filter "FullyQualifiedName~McqValidationTests"
docker info >/dev/null && cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --no-build --filter "FullyQualifiedName~CardsAuthoringMcqTests"
bash docs/delivery/r16-issues/C08.verify.sh        # BASE=delivery/r16-c-economy, cwd = worktree root
```

The driver then runs the full root gate `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (every class, Docker) plus the diff-scoped banned-term and suppression greps; all must stay green.

## Do NOT

- Do NOT create `018_cards_mcq.sql`, a `020_*.sql`, or touch `018_cards_topic.sql`.
- Do NOT edit `CardsPage.cs`, `Publish.cs` (select lists, `JsonbCell` there, the pre-enqueue gate are C09), `Decks.cs`, anything in `src_C/Worker` (`CardExportData.Mcq`, `DeckDiff.McqEquals`, `PublishJobProcessor` fallback are C09), `src_C/Vpc/Runtime/ProgressEvents.cs` (C10), `src_C/Vpc/Authoring/ContentIntelligence.cs` (C13), `src_C/Shared/**`, `src_C/Common/**` (do not unseal `ValidationError`), any `.csproj`/`.sln`, `frontend/**`, `mobile/**`, `snowflake/**`, top-level `docs/*.md`.
- Do NOT wrap the PUT in a transaction, add a CHECK constraint or index, add a `card_format` column, or store the blob as anything but the canonical string cast with `::jsonb`.
- Do NOT return the blob as a JSON-encoded string, stash a `JsonElement` from the request document past the handler, or use `JsonDocument.Parse(s).RootElement` for a stored cell.
- Do NOT make `McqValidationError` derive from `ValidationError` (sealed, out of scope) and do NOT let the generic `ValidationError` arm be the only one that could catch it (it cannot — the named arm must come first).
- Do NOT paste any exam-dump content; the two §4.3 cards are the only MCQ prose allowed, and only in the test files.
- Do NOT edit any existing test; do NOT add `Skip`, `#pragma warning disable`, or loosen `Nullable`.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no `npm`/`dotnet add package`, no migration run outside Testcontainers.
