# E07 — Webhook and ingest input hardening (`webhook-input-hardening`)

Make the RevenueCat webhook honest about failure (a DB failure is a `503` with `retry-after: 60`, so RevenueCat retries instead of marking a paid event delivered), compare its bearer in constant time through E06's `Secrets.FixedTimeEquals`, shrink the `401` body to four keys, record every event in `rc_webhook_events` for real (the insert has failed on every call since the table was created — the `raw jsonb` column receives an uncast `text` parameter, 42804, swallowed by the `Log.Warn` catch), and use `returning 1` so a replay is visible as `replayed:true`. Make the progress ingest reject per event instead of per batch (the frozen 1.5.0/1.6.x client only drops `acceptedEventIds ∪ duplicateEventIds`, so a whole-batch `400` wedges its queue forever), add length caps, cap every request body at 1 MiB in `VpcFunction.DispatchAsync` (`413`), and give the deck slug one shared grammar (`Validation.SlugRegex`) used by `Decks`, `Publish` and `PremiumDeckUrl`. Server-only (`src_C`): no infra, no mobile, no frontend, no migration, no `.csproj` change. Four new test classes; every existing test file is byte-identical.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`, JWT verification merged). Every line below was read on that tree on 2026-09-22. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding; §2.7 (`:298-303`) is this issue's contract, §0 (`:9-37`) the non-negotiables, §1.2 (`:71-110`) the file map (rows `:75`, `:79`, `:91-93`, tests `:108`), §2.16 (`:411-413`) the `VpcFunction.cs` region rule, §3.3 (`:436-438`) the test contract, §4 (`:456`, E07 depends on E06), §5 (`:470-482`) the verify conventions, §6 #19 (`:504`, the seams survey's issue letters are not the driver's — this brief cites the tree only).

What the tree looks like today:

- **Webhook** `src_C/Vpc/Webhooks/RevenuecatWebhook.cs` (427 lines). `ImplVersion = "2025-12-27T00:30Z-v13"` (`:14`). `Hash8` (`:50-61`) is an 8-hex SHA-256 prefix. `ModeFromPath` (`:63-73`) matches the two real paths and `/rc/webhook` exactly (`:66-68`) and then falls back to a `host.Contains("dev")` heuristic (`:70-72`). The expected token is read per request from `RC_WEBHOOK_AUTH_DEVELOPMENT` / `RC_WEBHOOK_AUTH_PRODUCTION` (`:75-82`) and stripped of a `Bearer ` prefix (`:40-48`). The compare at `:265` is `string.IsNullOrEmpty(gotToken) || gotToken != expectedToken` — an ordinal, early-exit compare — and the `401` body (`:268-280`) carries `gotBearer`, `gotLen`, `expectedLen`, `expectedHasBearer`, `gotHash8`, `expectedHash8` to the caller. `InsertRcEventOnce` (`:144-184`) runs `insert into rc_webhook_events (…, raw) values ($1,…,$9) on conflict (event_id) do nothing;` (`:156-170`) through `DbUtil.ExecuteAsync`, which binds every parameter with `AddWithValue` (`src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:63-68`); `raw` is `jsonb not null` (`src_C/Vpc/Db/Migrations/002_rc_webhook_events.sql:15`, re-asserted by `006_rc_webhook_and_premium_state.sql:19,57`). **Probe (postgres:16-alpine + Npgsql 8.0.5, same `AddWithValue` path, 2026-09-22):** `values (@p1, @p2)` into a `jsonb` column → `42804 column "raw" is of type jsonb but expression is of type text`; `values (@p1, @p2::jsonb) … returning 1` → `1` on first insert and `null` on the replay. The rest of the code base already casts (`src_C/Vpc/Authoring/Cards.cs:160` `$13::jsonb`, `src_C/Vpc/Runtime/ProgressEvents.cs:462`). So today: the insert throws on every call, the catch at `:336-339` logs a warning, and the handler continues — `rc_webhook_events` is empty in production and no replay has ever been de-duplicated. The connection is opened at `:319` and a `null` (missing PG env, `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs:32-38`) skips the whole DB block; an exception from `OpenAsync` (`Pg.cs:141-147`) propagates to `VpcFunction`'s catch and becomes a `500`. `env_mismatch` (`:344-360`) and `product_mismatch` (`:362-378`) return `200 accepted:false` after the insert; the premium upsert (`:382-405`) catches its own failure at `:402-405` and the handler still answers `200 accepted:true` (`:424`) — RevenueCat never retries, the user paid and stays free. The accepted log line is a bare `Console.WriteLine(JsonSerializer.Serialize(new { tag = "rc-webhook", … }))` (`:407-421`). `Log.Warn` is used at `:338`, `:347`, `:365`, `:404`. `VpcFunction.cs:107-116` routes `POST …/webhooks/revenuecat/{development,production}`, `/rc/webhook` and the bare `/webhooks/revenuecat` to the handler. The live API has exactly the two real routes (`POST /webhooks/revenuecat/production` and `/development`, both `AuthorizationType NONE`, both to `core-vpc` — `aws apigatewayv2 get-routes --api-id ktbq1sie2c`, read-only, 2026-09-22), so the host heuristic never decides anything real.
- **No webhook test exists** (`grep -rln "RevenuecatWebhook\|revenuecat" src_C/Tests` → none). `LambdaHost` (`src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:172-247`) drives three-argument handlers and asserts `200` (`:241-243`), so the webhook (two arguments, non-200 cases) is called directly with a hand-built event (`CardsPageTests.cs:66-92` shape, `http.method = "POST"`, `headers["authorization"]`). `PostgresFixture` sets `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/PGSSLMODE/PG_MAX` and calls `Pg.Reset()` (`IntegrationTestBase.cs:57-72`); `Pg` caches one `NpgsqlDataSource` in a static (`Pg.cs:8`, `:22-25`), so a test that moves `PGDATABASE`/`PGHOST` must `Pg.Reset()` after the change and again after restoring — `DbWarmupTests.cs:183-200` is the save/swap/restore pattern. `CreateScratchDatabaseAsync(name)` (`:118-128`) plus `ApplyMigrationsAsync(conn, maxVersion)` (`:136-155`) give a second database frozen at an older schema (`PublishJobProcessorSchemaTests.cs:45-49`); migrations `001`–`006` are idempotent (`if not exists`, `drop trigger if exists`), and `003_user_premium_state.sql` is the first file that creates `user_premium_state`, so a scratch DB at `maxVersion: 2` has `rc_webhook_events` and no `user_premium_state` — the insert succeeds and the upsert throws `42P01`. `GetExpectedEnv("development")` defaults to `SANDBOX` (`:84-90`) and `GetMonthlyProductId()` to `developercards_premium_monthly` (`:92-96`), so tests need neither env var.
- **Ingest** `src_C/Vpc/Runtime/ProgressEvents.cs` (839 lines). `UuidRegex` `:16-18`; `NormalizedEvent` record `:20-40`; `MaxSrsStage` `:45`; `ProgressEventsImpl = "progressEvents-v1"` `:70`. Batch-level strings `deviceId`/`clientVersion`/`clientPlatform` are read at `:95-97` (unbounded). Structural gates: body not JSON `:90-91`, `events` missing/not array `:101-104`, empty `:107`, `> 200` `:108`. The per-event loop `:117-241` **throws `ValidationError` on the first bad event**: non-object `:120-123`, `eventId` missing/blank (`RequireString`, `:720-730`) or non-UUID `:125-129`, `deckSlug`/`stableUid` missing `:131-132`, `eventTimeMs <= 0` `:142` (unreachable through `OptionalMs`, `:748-764`, which already maps non-positive values to `null`, so `:137-140` falls back to `nowMs`; the guard stays and gets a code anyway). `rating` accepts any int `:134`; `sessionId` `:198`, `reviewStage` `:203`, `schedulerVersion` `:219` are trimmed strings via `OptionalString` (`:783-790`, blank → null) with no length bound; `normalized.Add` `:221-240`. `parseMs` `:246`, `allEventIds` `:248`, SQL assembly from `:250`. The catch at `:678-681` turns that `ValidationError` into **`400 VALIDATION_ERROR` for the whole batch**. Response `:669-676`: `{serverTimeMs, receivedCount, acceptedCount, acceptedEventIds, duplicateEventIds}` with `duplicateEventIds = allEventIds − inserted` (`:646-647`). Column types are unbounded `text` (`src_C/Vpc/Db/Migrations/001_init.sql:143-156`), so the caps are code-only. E12 owns `:611-637` (the 42703 branch) and E13 owns `HashUserId` `:806-810` — E07 never touches those lines.
- **Frozen client contract** (`mobile/src/sync/progressSync.ts`, frozen): ack set = `acceptedEventIds ∪ duplicateEventIds` (`:1537`), `if (ackIds.length === 0) break;` (`:1538`), removed from the queue (`:1540`); `apiJson` throws on non-2xx, so a `400` aborts the round and the same 25 events are re-peeked next time — one malformed event blocks every later review on that device. `PushResp` (`:67-73`) names the five existing keys; unknown keys are ignored.
- **Body size.** `LambdaRequest.RawBody` (`src_C/Shared/RecallSmith.Lambda.Common/LambdaRequest.cs:17`, `:41`) is the decoded body (`Validation.DecodeBody`, `Validation.cs:180-193`; base64 decoded when `isBase64Encoded`), a non-null `string`. Nothing bounds it: API Gateway allows 10 MB, the function has 128 MB. `VpcFunction.DispatchAsync` (`src_C/Vpc/VpcFunction.cs:49`): boot log `:51-62` (E04 rewrites it), auth context `:64-79`, OPTIONS short-circuit `:81-84`, request log `:86-98` (E04), then `try` at `:100-101` whose first statement is the `var p = req.Path.TrimEnd('/');` at `:103` (after a comment at `:102`). `Res` (`src_C/Shared/RecallSmith.Lambda.Common/Res.cs`): `Base(status, body, extraHeaders)` `:101-137`, `Raw(status, body, extraHeaders)` `:139-143`, `Wrap(status, success, data, error)` `:145-157` with **no** `extraHeaders` parameter, envelope helpers `:159-177` (`Ok`, `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `MethodNotAllowed`, `NotImplemented`), `Error500` `:179-202`, `ApiError` `:213-219`. No `413`, no `503`.
- **Slug.** `Validation.cs:20` has `DbNameRegex` and `:178` `IsValidDbName`; there is no slug rule. `Decks.cs` POST reads `slug` at `:124`, requires it non-blank at `:130-133`, passes `slug.Trim()` at `:158`, and maps `ValidationError` to `400 VALIDATION_ERROR` at `:170-173`; PUT's spec entry at `:198` is `new("slug", "slug", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim())`, editors cannot set `slug` (`:219-221`), and PUT's catch is `:252-255`. `Publish.cs:204-208` accepts anything without `/` or `..`; its catch is `:354-357`. `PremiumDeckUrl.SafeSlug` (`:35-43`) matches `^[a-z0-9-]+$` case-insensitively and lower-cases; `:138` calls `res.BadRequest("Missing/invalid slug")` — the message in the `code` slot; the login gate at `:144-147` answers `403 Requires login` for an anonymous caller, so a slug that passes the gate is observable as `403`, not `400`. The mobile client checks only `res.ok` (`mobile/src/content/premiumDeckApi.ts:102-105`), so the error code is free to change. The three live slugs (`aws-saa-c03`, `csharp-basics`, `claude-ccdv-f`) match the new grammar; the console's importer accepts `_` (`frontend/src/lib/deckImport.ts:189`) — a divergence E00 §2.7 accepts (the server rule wins; an underscore import now gets `400 VALIDATION_ERROR`; aligning the console regex is a post-wave chore, not E07's).
- **Test harness.** xunit 2.5.3, `Testcontainers.PostgreSql 3.10.0` (`postgres:16-alpine`), Npgsql 10 in the test project (`RecallSmith.Lambda.IntegrationTests.csproj`). `ProgressEventsIntegrationTests.cs:48-84` has `NewUser`/`NewEventId`/`Ev`/`Batch`/`PostAsync`; `AuthBearerTests.cs:25-68` drives `new VpcFunction().Handler(evt)` with a raw event and shows the `Auth.Configure`/`ResetToEnvironment` bracket; `CardsAuthoringTopicTests.cs` (C05) shows the super_admin claims event for `Decks`/`Publish` (`mode=preview` needs no bucket env for a free deck).

What E00 decided (and how E07 reads it):

- §2.7: the compare is `Secrets.FixedTimeEquals(gotToken, expectedToken)` (E06, `src_C/Shared/RecallSmith.Lambda.Common/Secrets.cs`, `public static bool FixedTimeEquals(string? got, string? expected)`, false for null/empty — E00 §2.6.5 `:296`); the `401` body is exactly `{ ok, error, mode, impl }`; the six diagnostic fields move to a `Log.Event("warn", …)` line (E04's `Log.Event(string level, object fields)`, E00 §2.4.6 `:278`, which also says the webhook's `tag = "rc-webhook"` lines migrate to `Log.Event` — the file is E07's (`:91`), so E07 does that migration); `503` is the literal `res.Raw(503, new { ok = false, error = "DB_UNAVAILABLE", mode, impl }, new Dictionary<string,string> { ["retry-after"] = "60" })`; the host heuristic goes; the status table `200 / 401 / 405 / 400 / 503` is the contract (the pre-existing `500 Missing RC_WEBHOOK_AUTH_*` config path at `:251-260` is unchanged and outside the table).
- **E07 resolutions inside §2.7's wording** (recorded here because E00 cannot be edited by a worker): (a) "DB failure → 503" covers all three DB steps — `OpenConnectionOrNullAsync` returning `null` **or throwing**, the event insert failing, the premium upsert failing — because with the `::jsonb` cast the insert becomes real and a failed insert means the event cannot be de-duplicated on retry; `TEST`, `env_mismatch`, `product_mismatch` and accepted stay `200` only when the DB steps before them succeeded. (b) §2.7 lists `deviceId`/`clientVersion` among the ≤ 64 caps "at the same site"; those two (and `clientPlatform`) are batch-level (`:95-97`), there is no per-event site to reject at, and rejecting the whole batch for a metadata field the frozen client cannot change would drop real reviews — so batch-level strings are **clamped** to 64 code units (`[..64]`), and only the five per-event strings reject with `TOO_LONG`. (c) `receivedCount` becomes the submitted array length (`events.Count`); for an all-valid batch that is the same number as today.
- §2.16: the body-cap line is the first statement inside `DispatchAsync`'s `try` (the `try {` at `:100-101`, before the comment at `:102` and `var p` at `:103`), not before the boot log; E04 rewrites `:51-62`/`:86-98`, E06 inserts after `:123-126`, E03 after `:207-210`, E12 at the top of `Handler` — E07 touches none of those, so the merges are disjoint.
- §3.3: property tests are xunit `[Theory]` + `[MemberData]` with ≥ 50 generated cases — required for the per-event invariants and the slug grammar.
- §0 / §5: no `dotnet restore` by hand, no network; the secret-leak grep forbids a literal after `RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)\s*[=:]\s*"` — tests set the env var through `Environment.SetEnvironmentVariable("RC_WEBHOOK_AUTH_DEVELOPMENT", "test-secret-dev")` (name and value are separate arguments; the value is a placeholder, never a real token) and never print it.

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-37`), §1.2 (`:71-110`), §2.4.6 (`:278`), §2.6.5 (`:296`), §2.7 (`:298-303`), §2.16 (`:411-413`), §3.3 (`:436-438`), §5 (`:470-482`), §6 #19 (`:504`).
2. `src_C/Vpc/Webhooks/RevenuecatWebhook.cs` whole file (427 lines).
3. `src_C/Vpc/Runtime/ProgressEvents.cs:1-70`, `:72-250`, `:640-690`, `:715-790`.
4. `src_C/Vpc/VpcFunction.cs:1-120`; `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-220`; `src_C/Shared/RecallSmith.Lambda.Common/Validation.cs` (194 lines); `src_C/Shared/RecallSmith.Lambda.Common/LambdaRequest.cs:8-45`.
5. `src_C/Shared/RecallSmith.Lambda.Common/Secrets.cs` (E06) and `Log.cs` (E04's `Event`) as they exist on the integration branch.
6. `src_C/Vpc/Authoring/Decks.cs:114-180`, `:182-262`; `src_C/Vpc/Authoring/Publish.cs:143-215`, `:354-357`; `src_C/Vpc/Runtime/PremiumDeckUrl.cs:35-43`, `:128-147`.
7. `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs:8-38`, `:116-147`; `DbUtil.cs:42-71`.
8. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` (247 lines), `ProgressEventsIntegrationTests.cs:1-100`, `CardsPageTests.cs:60-99`, `AuthBearerTests.cs:25-75`, `DbWarmupTests.cs:175-235`, `PublishJobProcessorSchemaTests.cs:40-60`, `CardsAuthoringTopicTests.cs` (helpers for `Decks`/`Publish` events).
9. `mobile/src/sync/progressSync.ts:67-73`, `:1489-1544` (read only; frozen).
10. `docs/delivery/r16-issues/C05-topic-server.md` and `C05.verify.sh` (format precedent).

## Constraints

- **Scope (the ONLY files that may change):**
  1. `src_C/Vpc/Webhooks/RevenuecatWebhook.cs`
  2. `src_C/Vpc/Runtime/ProgressEvents.cs` (regions: `:45` constants, `:70` impl string, `:95-97`, `:117-241` + the early return directly after the loop, `:669-676`, delete `:720-730`)
  3. `src_C/Vpc/VpcFunction.cs` (one line inside the `try` of `DispatchAsync`)
  4. `src_C/Shared/RecallSmith.Lambda.Common/Res.cs`
  5. `src_C/Shared/RecallSmith.Lambda.Common/Validation.cs`
  6. `src_C/Vpc/Authoring/Decks.cs`
  7. `src_C/Vpc/Authoring/Publish.cs` (`:204-208` only)
  8. `src_C/Vpc/Runtime/PremiumDeckUrl.cs` (`:35-43`, `:138` only)
  9. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RevenuecatWebhookTests.cs` (new)
  10. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsPerEventTests.cs` (new)
  11. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/SlugRulesTests.cs` (new)
  12. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/BodyCapTests.cs` (new)
  Nothing else: no `infra/`, no `mobile/`, no `frontend/`, no `.github/`, no `snowflake/`, no `src_C/Vpc/Db/**` (no migration — the caps are code-only), no `Secrets.cs`, `Log.cs`, `Auth.cs`, `Migrate.cs`, `Pg.cs`, `DbUtil.cs`, `LambdaRequest.cs`, no `.csproj`, no `src_C/deploy.sh`, no `src_C/env/*`, no `IntegrationTestBase.cs`, no existing test file, no top-level `docs/*.md`.
- **WORKER SAFETY RULE:** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete. (E07 is a code issue: it needs no AWS CLI and no Terraform at all; `src_C/deploy.sh` is never run, not even with `DRY_RUN=1`.)
- **Frozen files (E00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. The frozen client's ack rule is the reason `rejectedEventIds ⊆ duplicateEventIds`.
- **OTA rule:** nothing under `mobile/` changes; `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"`), `mobile/eas.json` stay byte-identical; no `@sentry/*` anywhere. No `PackageReference` is added or changed in any `.csproj` (the build restores from the local NuGet cache; no network).
- **Secrets:** no real token, password or salt in any file, test, log line, verify output or PR text. Test tokens are placeholders (`test-secret-dev`, `test-secret-prod`); the webhook never logs a token or its hash of the *expected* value beyond the 8-hex prefix E00 §2.7 allows in the warn line; the `401` body carries no length, prefix or hash.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — do not reproduce them, not even in a comment; say "work around", "sidestep", "guard", "fallback", "probe". Two live `core-vpc` env-var names contain one of them (E00 §0 `:31`): never spell them, never add a line that reads them (`PremiumDeckUrl.cs:149-160` reads one — leave that region alone). No `[Fact(Skip = …)]` / `[Theory(Skip = …)]`, no `#pragma warning disable`, no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`/`.skip(`/`.only(` anywhere in the diff.
- **Existing tests:** every existing file under `src_C/Tests/RecallSmith.Lambda.IntegrationTests/` is byte-identical (E00 §1.2 `:108`: E07 has no bounded edits). `ProgressEventsIntegrationTests`, `ProgressEventsSingleStatementTests`, `ProgressEventsClientFeaturesTests`, `ProgressEventsCardFormatTests`, `CardsAuthoringTopicTests`, `AuthBearerTests`, `RouteMetricsTests` must stay green with the new code — they never send a malformed event, never an over-long string, never a bad slug, never a body over 1 MiB.
- **Never copy ExamTopics / SAA-C03 content.** Fixtures use neutral strings (`"q"`, `"e07-deck"`, `new string('x', 129)`).
- **dotnet / Docker:** dotnet 8.0.413. `dotnet build` restores implicitly from the local cache (no `dotnet restore` by hand, no `--no-restore` on a fresh worktree). All four new classes join `[Collection(PostgresCollection.Name)]` (they use the DB or mutate process-global `Pg`/env state) and need a running Docker daemon. Run targeted tests with `--filter "FullyQualifiedName~<Class>"`.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no `expo`, no `npm`, no `eas`, no AWS CLI, no git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree.

## Changes required

1. **`src_C/Shared/RecallSmith.Lambda.Common/Res.cs`**
   a. Line 1 becomes `using System.Globalization;` (the existing three `using` lines follow it).
   b. `Wrap` (`:145-157`) gains a trailing optional parameter and forwards it:
      ```csharp
      private APIGatewayProxyResponse Wrap(int statusCode, bool success, object? data, ApiError? error, IDictionary<string, string>? extraHeaders = null)
      ```
      with the last line `return Base(statusCode, JsonSerializer.Serialize(envelope, JsonOptions), extraHeaders);`. Every existing caller is unchanged.
   c. After `NotImplemented` (`:176-177`) and before `Error500`, verbatim:
      ```csharp
      /// <summary>413: the decoded request body is over VpcFunction's 1 MiB cap. Envelope-shaped like every other error.</summary>
      public APIGatewayProxyResponse PayloadTooLarge() =>
        Wrap(413, false, null, new ApiError { Code = "PAYLOAD_TOO_LARGE", Message = "Request body exceeds 1048576 characters" });

      /// <summary>
      /// 503 with a retry-after header, for a dependency that is down rather than a request that is wrong.
      /// The RevenueCat webhook keeps its own Raw() shape; this one is for envelope routes (E12 uses it).
      /// </summary>
      public APIGatewayProxyResponse ServiceUnavailable(string code, string? message, int retryAfterSec) =>
        Wrap(503, false, null, new ApiError { Code = code, Message = message },
          new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["retry-after"] = retryAfterSec.ToString(CultureInfo.InvariantCulture) });
      ```
      Nothing else in the file changes (`JsonOptions`, `Base`, `Raw`, `Error500`, the two private classes stay as they are).

2. **`src_C/Shared/RecallSmith.Lambda.Common/Validation.cs`** — directly after `DbNameRegex` (`:20`), verbatim:
   ```csharp
   /// <summary>The one deck-slug grammar (E00 §2.7): lower-case ASCII letter or digit first, then up to 63 of [a-z0-9-]. Shared by Decks, Publish and PremiumDeckUrl.</summary>
   public const string SlugPattern = "^[a-z0-9][a-z0-9-]{0,63}$";
   public static readonly Regex SlugRegex = new(SlugPattern, RegexOptions.Compiled);
   public const string SlugRuleMessage = "slug must match ^[a-z0-9][a-z0-9-]{0,63}$";

   /// <summary>True when <paramref name="slug"/> is non-null and matches SlugPattern exactly. `$` would also match before a trailing newline, hence the explicit check.</summary>
   public static bool IsValidSlug(string? slug) => slug is not null && !slug.EndsWith('\n') && SlugRegex.IsMatch(slug);

   /// <summary>Trim, then IsValidSlug or throw ValidationError(SlugRuleMessage, field). Returns the trimmed slug.</summary>
   public static string RequireSlug(string? slug, string field = "slug")
   {
     var s = (slug ?? string.Empty).Trim();
     if (!IsValidSlug(s)) throw new ValidationError(SlugRuleMessage, field);
     return s;
   }
   ```
   Signatures verbatim: `public static bool IsValidSlug(string? slug)` and `public static string RequireSlug(string? slug, string field = "slug")`. No other member changes (`NormalizePath`, `DecodeBody`, `IsValidDbName` untouched).

3. **`src_C/Vpc/Authoring/Decks.cs`**
   a. POST: directly after the required-fields check (`:130-133`) and before `deckTypeInt` (`:135`), add `slug = Validation.RequireSlug(slug);` — inside the existing `try`, so a bad slug throws `ValidationError` and lands in the catch at `:170-173` as `400 VALIDATION_ERROR` with message `slug must match ^[a-z0-9][a-z0-9-]{0,63}$` before any SQL runs. The `slug.Trim()` at `:158` stays (now a no-op).
   b. PUT spec (`:198`) becomes, verbatim:
      ```csharp
      new("slug", "slug", v => v.ValueKind == JsonValueKind.Null ? null : Validation.RequireSlug(v.ToString())),
      ```
      The transform throws inside `BuildUpdateSet` and lands in the catch at `:252-255` before any SQL. `null` keeps today's behaviour (a NOT NULL violation handled by `HandlePgError`). The editor filter (`:219-221`) is unchanged.
   c. GET (`:43`, `:88-91`) filters by `d.slug = $n` and does not validate the query value — unchanged (a non-matching slug simply returns no rows). DELETE unchanged.

4. **`src_C/Vpc/Authoring/Publish.cs`** — `:204-208` become:
   ```csharp
   var deckSlug = Validation.RequireSlug(Convert.ToString(deck["slug"], CultureInfo.InvariantCulture), "deckSlug");
   ```
   (one statement replaces the `Contains('/')`/`".."` check and its `throw new ValidationError("deck.slug contains invalid characters", "deckSlug")`). The catch at `:354-357` already maps it to `400 VALIDATION_ERROR`. This runs for both `mode=preview` and `mode=publish`, before the cards query and before any SQS send. Nothing else in the file changes.

5. **`src_C/Vpc/Runtime/PremiumDeckUrl.cs`**
   a. `SafeSlug` (`:35-43`) becomes:
      ```csharp
      private static string? SafeSlug(string? s)
      {
        var v = (s ?? string.Empty).Trim().ToLowerInvariant();
        return Validation.IsValidSlug(v) ? v : null;
      }
      ```
      (lower-casing first keeps today's case-insensitive acceptance for the phone; the grammar then adds the first-character rule and the 64 cap.)
   b. `:138` becomes `if (string.IsNullOrEmpty(slug)) return res.BadRequest("VALIDATION_ERROR", Validation.SlugRuleMessage);` — the message moves out of the `code` slot. Nothing else in the file changes; `:149-160` (dev-flag region) is not opened.

6. **`src_C/Vpc/VpcFunction.cs`** — inside `DispatchAsync`, the first statement of the `try` block (`:100-101`), i.e. the line directly after `try` + `{` and before the comment at `:102` / `var p = req.Path.TrimEnd('/');`, verbatim:
   ```csharp
   if ((req.RawBody?.Length ?? 0) > 1_048_576) return res.PayloadTooLarge();
   ```
   One line, nothing else. The bound is on decoded UTF-16 code units of `RawBody` (E00's wording), which is what the 128 MB container actually holds; the OPTIONS preflight (`:81-84`) is above the `try` and is never capped; internal events (E12) never enter `DispatchAsync`. Do not touch `:51-62`, `:86-98` (E04), `:123-126` (E06), `:207-210` (E03), `:32-34` (E12).

7. **`src_C/Vpc/Webhooks/RevenuecatWebhook.cs`**
   a. `:14` becomes `private const string ImplVersion = "2026-09-22T00:00Z-v14";`.
   b. `ModeFromPath` (`:63-73`): keep the three exact matches (`:66-68`) and end the method with `return "production";` — delete the `host` heuristic (`:70-72`) and the `PickHeader(req, "host")` call. Fail-safe: an unmatched path (the bare `/webhooks/revenuecat` that `VpcFunction.cs:112` still routes) requires the production token.
   c. Compare (`:265`): `if (!Secrets.FixedTimeEquals(gotToken, expectedToken))` (the helper is false for a null/empty `gotToken`, so the `IsNullOrEmpty` half goes). Inside the branch: keep `var expectedRaw = GetExpectedAuthRaw(mode).Trim();`, compute the six diagnostics as locals (`gotBearer`, `gotLen`, `expectedLen`, `expectedHasBearer`, `gotHash8`, `expectedHash8`, same expressions as today's `:274-279`), then exactly these two statements:
      ```csharp
      Log.Event("warn", new { tag = "rc-webhook", reason = "unauthorized", mode, gotBearer, gotLen, expectedLen, expectedHasBearer, gotHash8, expectedHash8 });
      return res.Raw(401, new { ok = false, error = "Unauthorized", mode, impl = ImplVersion });
      ```
      The `401` body is those four keys in that order and nothing else. `Hash8` (`:50-61`) stays (it feeds the log line).
   d. `InsertRcEventOnce` (`:144-184`) returns `Task<bool>` (`true` = inserted, `false` = the row already existed):
      ```csharp
      private static async Task<bool> InsertRcEventOnce(
      ```
      SQL: the values line becomes `values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)` and the last line `on conflict (event_id) do nothing returning 1;`; the body becomes `var inserted = await DbUtil.ExecuteScalarAsync(conn, null, sql, [ … same nine … ]); return inserted is not null;`. (`ExecuteScalarAsync` returns `null` when `do nothing` produced no row — `DbUtil.cs:42-51`.)
   e. Add one helper next to `Hash8`, verbatim:
      ```csharp
      private static APIGatewayProxyResponse DbUnavailable(Res res, string mode) =>
        res.Raw(503, new { ok = false, error = "DB_UNAVAILABLE", mode, impl = ImplVersion }, new Dictionary<string, string> { ["retry-after"] = "60" });
      ```
   f. DB block (`:318-340`) — the connection is now required, not best-effort:
      ```csharp
      NpgsqlConnection? conn;
      try
      {
        conn = await Pg.OpenConnectionOrNullAsync();
      }
      catch (Exception ex)
      {
        Log.Event("error", new { tag = "rc-webhook", reason = "db_unavailable", mode, eventId, error = ex.Message });
        return DbUnavailable(res, mode);
      }
      if (conn is null)
      {
        Log.Event("error", new { tag = "rc-webhook", reason = "db_unavailable", mode, eventId, error = (string?)null });
        return DbUnavailable(res, mode);
      }
      await using (conn)
      {
        bool replayed;
        try
        {
          replayed = !await InsertRcEventOnce( … same arguments … );
        }
        catch (Exception ex)
        {
          Log.Event("error", new { tag = "rc-webhook", reason = "db_insert_failed", mode, eventId, error = ex.Message });
          return DbUnavailable(res, mode);
        }
        … the rest of the handler (g–j) lives inside this block …
      }
      ```
   g. `env_mismatch` (`:344-360`) and `product_mismatch` (`:362-378`): unchanged `200` bodies; their `Log.Warn(...)` lines become `Log.Event("warn", new { tag = "rc-webhook", reason = "env_mismatch", mode, path = req.Path, eventId, got = envUpper, expected = expectedEnv })` and `Log.Event("warn", new { tag = "rc-webhook", reason = "product_mismatch", mode, path = req.Path, eventId, got = productId, expected = monthly, type = typeUpper })`.
   h. Premium block (`:382-422`): the condition drops `&& conn is not null` (the connection is guaranteed); the upsert catch (`:402-405`) becomes
      ```csharp
      catch (Exception ex)
      {
        Log.Event("error", new { tag = "rc-webhook", reason = "db_upsert_failed", mode, eventId, appUserId, error = ex.Message });
        return DbUnavailable(res, mode);
      }
      ```
      and the `Console.WriteLine(JsonSerializer.Serialize(new { tag = "rc-webhook", … }))` (`:407-421`) becomes `Log.Event("info", new { tag = "rc-webhook", reason = "accepted", impl = ImplVersion, mode, isTest, route = req.Path, eventId, type = typeUpper, environment = …, appUserId, productId, promo, promoAllowed = promo, replayed })` — same fields plus `replayed`.
   i. The final `return res.Raw(200, new { ok = true, accepted = true, mode, impl = ImplVersion, eventId, type = typeUpper, promo });` (`:424`) is unchanged.
   j. After this change the file contains no `Console.WriteLine(` and no `Log.Warn(` — every log line is `Log.Event` with `tag = "rc-webhook"` and one of the seven `reason` values `unauthorized`, `db_unavailable`, `db_insert_failed`, `env_mismatch`, `product_mismatch`, `db_upsert_failed`, `accepted`. Status table: `405` (`:245`), `500` config (`:251-260`, unchanged), `401`, `400` (`:285-301`, unchanged), `503`, `200`. `using System.Text.Json;` stays (the `JsonDocument` parse); drop `using System.Text.Json;` only if the compiler reports it unused — it is not.

8. **`src_C/Vpc/Runtime/ProgressEvents.cs`**
   a. `:70` becomes `private const string ProgressEventsImpl = "progressEvents-v2";`.
   b. After `MaxSrsStage` (`:45`), verbatim:
      ```csharp
      // Per-event caps (E07). Columns are unbounded text, so the bound lives here.
      private const int MaxIdentifierLength = 128;   // deckSlug, stableUid
      private const int MaxShortStringLength = 64;   // sessionId, reviewStage, schedulerVersion; batch-level deviceId/clientVersion/clientPlatform are clamped to it

      /// <summary>One submitted event the ingest refused. EventId is null when the event carried no usable id (NOT_OBJECT, BAD_EVENT_ID).</summary>
      private sealed record RejectedEvent(int Index, string? EventId, string Code);
      ```
   c. Batch-level strings (`:95-97`): each of `deviceId`, `clientVersion`, `clientPlatform` is clamped after the trim: `if (deviceId?.Length > MaxShortStringLength) deviceId = deviceId[..MaxShortStringLength];` (same for the other two). Never rejects the batch.
   d. The loop (`:117-241`) collects instead of throwing. Declare `var rejected = new List<RejectedEvent>();` next to `normalized` (`:116`). Per event, in this order, each failure is `rejected.Add(new RejectedEvent(i, <id or null>, "<CODE>")); continue;`:
      1. `e.ValueKind != JsonValueKind.Object` → `"NOT_OBJECT"` (id `null`).
      2. `var eventId = OptionalString(e.TryGetProperty("eventId", out var eid) ? eid : (JsonElement?)null);` `eventId is null || !UuidRegex.IsMatch(eventId)` → `"BAD_EVENT_ID"` (id `null` — a non-UUID string is never echoed).
      3. `deckSlug` / `stableUid` via `OptionalString`; either `null` → `"MISSING_FIELD"` (id `eventId`).
      4. `deckSlug.Length > MaxIdentifierLength || stableUid.Length > MaxIdentifierLength` → `"TOO_LONG"`.
      5. `rating`: `var rating = OptionalInt(…); if (rating is < 1 or > 4) rating = null;` (not rejected).
      6. `eventTimeMs <= 0` (the existing `:142` guard) → `"BAD_EVENT_TIME"` (defensive; `OptionalMs` already maps non-positive numbers to the `nowMs` fallback, so no test can reach it).
      7. Directly before `normalized.Add(` (`:221`): `if (sessionId?.Length > MaxShortStringLength || reviewStage?.Length > MaxShortStringLength || schedulerVersion?.Length > MaxShortStringLength)` → `"TOO_LONG"`.
      Everything else in the loop (clamps `:151-152`, `:160-177`, `:215`; `nextReviewAtMs`, `lastSeenRevision`, `deckVersion`, `schemaVersion`, `eventType`, `offlineQueueDelayMs`, `dwellTimeMs`, `reviewCountForCard`, `cardRevision`, `statedDifficulty`, `srsStage`) is unchanged. No `throw new ValidationError($"events[` remains; `RequireString` (`:720-730`) has no caller and is deleted.
   e. Directly after the loop, before `var parseMs` (`:246`):
      ```csharp
      var rejectedEventIds = rejected.Where(r => r.EventId is not null).Select(r => r.EventId!).Distinct(StringComparer.Ordinal).ToList();
      if (rejected.Count > 0)
      {
        Log.Event("warn", new { tag = "progress-events", traceId = req.TraceId, impl = ProgressEventsImpl, step = "ingest_rejected", receivedCount = events.Count, rejectedCount = rejected.Count, codes = rejected.Select(r => r.Code).Distinct().ToList() });
      }
      if (normalized.Count == 0)
      {
        return res.Ok(new
        {
          serverTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
          receivedCount = events.Count,
          acceptedCount = 0,
          acceptedEventIds = new List<string>(),
          duplicateEventIds = rejectedEventIds,
          rejectedEventIds,
          rejected,
        });
      }
      ```
      (all-rejected ⇒ `200`, zero SQL, every valid-UUID id acked through `duplicateEventIds`.)
   f. `duplicateEventIds` (`:647`) becomes today's list followed by every `rejectedEventIds` entry not already in it:
      ```csharp
      var duplicateEventIds = allEventIds.Where(id => !acceptedSet.Contains(id)).Concat(rejectedEventIds).Distinct(StringComparer.Ordinal).ToList();
      ```
   g. Response (`:669-676`) becomes:
      ```csharp
      return res.Ok(new
      {
        serverTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        receivedCount = events.Count,
        acceptedCount = insertedIds.Count,
        acceptedEventIds = insertedIds,
        duplicateEventIds,
        rejectedEventIds,
        rejected,
      });
      ```
      The five existing keys keep their names, positions and meaning; `rejected` serialises (CamelCase, `Res.JsonOptions`) as `[{ "index": 3, "eventId": "…" | null, "code": "TOO_LONG" }]`. The catch blocks (`:678-685`) are unchanged: structural errors (`:90-91`, `:101-108`) still answer `400`.
   h. Do not touch `:611-637` (E12) or `:806-810` (E13).

9. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/RevenuecatWebhookTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, `public sealed class RevenuecatWebhookTests : IDisposable`, constructor `(PostgresFixture db)` that saves the current `RC_WEBHOOK_AUTH_DEVELOPMENT`, `PGHOST`, `PGDATABASE` values and sets `RC_WEBHOOK_AUTH_DEVELOPMENT` to `test-secret-dev`; `Dispose` restores all three and calls `Pg.Reset()`. Helpers: `Event(string method, string path, string? authorization, string? body)` (the `CardsPageTests.cs:66-92` shape without the authorizer block; `headers["authorization"]` only when given); `CallAsync(...)` → `RevenuecatWebhook.HandleRevenuecatWebhook(new LambdaRequest(evt), new Res(req.TraceId))`; `Payload(string id, string type = "INITIAL_PURCHASE", string environment = "SANDBOX", string? appUserId = null, string productId = "developercards_premium_monthly", long? expirationAtMs = null)` → JSON `{ "event": { id, type, environment, app_user_id, product_id, event_timestamp_ms = <now>, expiration_at_ms } }`; `NewId(tag)` → `$"e07-{tag}-{Guid.NewGuid():N}"`; `Keys(response)` → the body's top-level property names in order. Every case posts to `/webhooks/revenuecat/development` unless stated. Cases, names verbatim:
   1. `Post_WrongTokenSameLength_Is401WithFourKeysOnly` — `Bearer test-secret-dex` (same length, one byte different) → `401`; `Keys == ["ok","error","mode","impl"]`; `error == "Unauthorized"`, `mode == "development"`, `ok == false`; the body text contains none of `expectedLen`, `expectedHash8`, `gotHash8`, `expectedHasBearer`, `gotLen`, `gotBearer`.
   2. `Post_MissingAuthorization_Is401` — no header → `401`, same four keys.
   3. `Get_Is405`.
   4. `Post_BadJson_Is400` — right token, body `{not json` → `400`, `error == "Invalid JSON body"`.
   5. `Post_TestEvent_Is200_AndRowIsRecorded` — `type = "TEST"` → `200`, `ok:true`, `accepted:true`; `select count(*) from rc_webhook_events where event_id = $1` == 1 (the `::jsonb` cast — this is the assertion that fails on today's SQL); no `user_premium_state` row for the app user.
   6. `Post_Purchase_Is200_UpsertsPremium_ReplayKeepsOneRow` — `INITIAL_PURCHASE`, `appUserId = NewId("user")` → `200 accepted:true`; `user_premium_state` row: `premium_active` true, `premium_env == "sandbox"`, `last_event_id == id`. Post the identical body again while capturing `Console.Out` and `Console.Error` (`Console.SetOut`/`SetError` around the call, restored in `finally`) → `200 accepted:true`; `rc_webhook_events` count for the id still 1; captured text matches `"replayed"\s*:\s*true`.
   7. `Post_EnvMismatch_Is200NotAccepted` — `environment = "PRODUCTION"` on the development path → `200`, `accepted == false`, `reason == "env_mismatch"`; no premium row.
   8. `Post_ProductMismatch_Is200NotAccepted` — `productId = "some_other_product"` → `200`, `reason == "product_mismatch"`; no premium row.
   9. `Post_NoPgEnv_Is503WithRetryAfter` — `Environment.SetEnvironmentVariable("PGHOST", null); Pg.Reset();` → `503`; `Headers["retry-after"] == "60"`; body `ok == false`, `error == "DB_UNAVAILABLE"`, `mode == "development"`, has `impl`; restore in `finally` + `Pg.Reset()`.
   10. `Post_DbOpenFails_Is503WithRetryAfter` — `PGDATABASE = "e07_missing_db"` (never created) + `Pg.Reset()` → `503 DB_UNAVAILABLE` with `retry-after`; restore + `Pg.Reset()` in `finally`.
   11. `Post_UpsertFails_Is503_ThenRetrySucceeds` — `await _db.CreateScratchDatabaseAsync("e07_rc_partial")`; open it and `ApplyMigrationsAsync(conn, maxVersion: 2)`; point `PGDATABASE` at it + `Pg.Reset()`; post a purchase → `503 DB_UNAVAILABLE` with `retry-after`; in the scratch DB `select count(*) from rc_webhook_events where event_id = $1` == 1 (the audit row survives the failed upsert). Then `ApplyMigrationsAsync(conn, maxVersion: 6)` (001–006 are idempotent) and post the identical body → `200 accepted:true`; scratch `user_premium_state` has the row with `premium_active` true; `rc_webhook_events` count still 1. Restore + `Pg.Reset()` in `finally`.
   Assert `response.StatusCode` with the body in the failure message as `CardsPageTests.cs:120` does. Header lookups are case-insensitive (`Res.Base` builds an `OrdinalIgnoreCase` dictionary).

10. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsPerEventTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, `public class ProgressEventsPerEventTests`, constructor `(PostgresFixture db)`. Helpers mirror `ProgressEventsIntegrationTests.cs:48-84` (`NewUser`, `NewEventId`, `Ev`, `Batch`); `PostRawAsync(userSub, object body)` calls `ProgressEvents.HandleProgressEvents(req, res, auth)` directly with the `LambdaHost` event shape and a hand-built `AuthContext(UserSub: userSub, …)` and returns the `APIGatewayProxyResponse` (for the `400` cases); `PostAsync` uses `LambdaHost.PostProgressEventsAsync` (asserts `200`, returns `data`). `Ids(data, "acceptedEventIds")` → `HashSet<string>`. `private const int GeneratedCaseCount = 60;`. Cases, names verbatim:
    1. `OneBadEventAmongTwentyFive_Is200_AndOthersAreStored` — 24 valid + 1 with `stableUid` missing → `200`; `acceptedCount == 24`; `receivedCount == 25`; the bad id ∈ `rejectedEventIds` ∧ ∈ `duplicateEventIds` ∧ ∉ `acceptedEventIds`; `rejected` has one entry `{ index: <its index>, eventId: <id>, code: "MISSING_FIELD" }`; `select count(*) from user_progress_events where user_sub = $1` == 24.
    2. `AllRejected_Is200_WithZeroRows` — 3 events: one non-object (`42`), one with `eventId = "nope"`, one 129-char `deckSlug` → `200`; `acceptedCount == 0`; `acceptedEventIds` empty; `duplicateEventIds == rejectedEventIds == [<the third id>]`; `rejected.Length == 3` with codes `NOT_OBJECT`, `BAD_EVENT_ID`, `TOO_LONG` and `eventId` null for the first two; zero rows for the user.
    3. `RejectedIds_AreAlsoDuplicateIds_ForTheFrozenClient` — 5 valid + 5 rejected (valid UUIDs, each failing a different rule) → every id in `rejectedEventIds` is in `duplicateEventIds`; `acceptedEventIds ∪ duplicateEventIds` equals the set of all 10 ids.
    4. `[Theory] TooLongPerEventField_IsRejectedWithTooLong(string field, int length)` — `InlineData("deckSlug", 129)`, `("stableUid", 129)`, `("sessionId", 65)`, `("reviewStage", 65)`, `("schedulerVersion", 65)` → the event is rejected `TOO_LONG`; a sibling event with the same field at `length - 1` is accepted.
    5. `RatingOutOfRange_IsStoredAsNull_NotRejected` — `rating = 9` → accepted; `select rating from user_progress_events where event_id = $1::uuid` is DB NULL; `rating = 4` on a second event → stored as 4.
    6. `BatchLevelStrings_AreClampedTo64` — `deviceId`, `clientVersion`, `clientPlatform` each 100 chars, one valid event → `200 acceptedCount == 1`; `select device_id, client_version from user_progress_events where event_id = $1::uuid` are both exactly 64 chars.
    7. `[Theory] StructuralErrors_Still400(string bodyJson, string messagePart)` — `("{not json", "Invalid JSON body")`, `("{\"events\":5}", "events must be a non-empty array")`, `("{\"events\":[]}", "events must be a non-empty array")`, `(<201 valid events>, "events too many (max 200)")` (build the last with `MemberData` or inline `JsonSerializer.Serialize`) → `400`, `error.code == "VALIDATION_ERROR"` or `"BAD_REQUEST"` for the first, message contains `messagePart`.
    8. `[Theory] [MemberData(nameof(Seeds))] Invariants_HoldForGeneratedBatches(int seed)` — `Seeds` yields `0..GeneratedCaseCount-1`; per seed `new Random(20260922 + seed)` builds a batch of 1–25 events drawing each from {valid, valid-with-rating-out-of-range, valid-duplicate-of-an-earlier-event-in-the-batch, not-object, bad-id (missing or `"nope"`), missing-field, deckSlug-129, sessionId-65} with distinct fresh UUIDs; post with a fresh user; assert: `receivedCount == batch.Count`; `acceptedEventIds ∪ duplicateEventIds` == the set of distinct valid-UUID ids submitted; `rejectedEventIds ⊆ duplicateEventIds`; `rejected.Length` == the number of events generated as one of the five invalid kinds; `acceptedCount == acceptedEventIds.Length`; `acceptedEventIds ∩ rejectedEventIds` empty; DB row count for the user == `acceptedCount`.

11. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/SlugRulesTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, `public class SlugRulesTests`, constructor `(PostgresFixture db)`. `private const int GeneratedCaseCount = 60;`. Event/handler helpers as `CardsAuthoringTopicTests.cs` (super_admin claims; `Decks.HandleAuthoringDecks`, `Publish.HandleAuthoringPublish` with query `mode=preview`; `PremiumDeckUrl.HandlePremiumDeckUrl(req, query, res, auth)` with an anonymous `AuthContext`). Cases, names verbatim:
    1. `[Theory] IsValidSlug_AcceptTable(string slug)` — `aws-saa-c03`, `csharp-basics`, `claude-ccdv-f`, `a`, `0`, `a-b-c`, a 64-char slug (`"a" + new string('b', 63)`).
    2. `[Theory] IsValidSlug_RejectTable(string? slug)` — `null`, `""`, `"-a"`, `"a_b"`, `"A"`, `"aB"`, `"a/b"`, `".."`, `"a b"`, `" a"`, a 65-char slug, `"abc\n"`, `"é"`.
    3. `[Theory] [MemberData(nameof(GeneratedSlugs))] IsValidSlug_GeneratedCases(string slug, bool expected)` — 30 valid (random length 1–64 over `[a-z0-9-]` with a non-`-` first char, `new Random(20260922)`) and 30 invalid (each mutates a valid one: upper-case a char, insert `_`, prepend `-`, extend to 65, append `\n`, insert a space, insert `/`) — `GeneratedCaseCount` rows total.
    4. `RequireSlug_TrimsOrThrowsWithTheRuleMessage` — `RequireSlug("  ok-1 ")` == `"ok-1"`; `Assert.Throws<ValidationError>(() => Validation.RequireSlug("Bad_Slug"))` has `Message == Validation.SlugRuleMessage` and `Field == "slug"`; with `field: "deckSlug"` → `Field == "deckSlug"`.
    5. `PostDeck_BadSlug_Is400_AndNothingInserted` — `slug = "Bad_Slug"` → `400`, `error.code == "VALIDATION_ERROR"`, `error.message == "slug must match ^[a-z0-9][a-z0-9-]{0,63}$"`; `select count(*) from decks where slug = $1` == 0.
    6. `PostDeck_GoodSlug_Is200` — `slug = $"e07-{Guid.NewGuid():N}"[..20]` → `200`, `data.slug` echoes it.
    7. `PutDeck_BadSlug_Is400_AndRowUnchanged` — POST a good deck, PUT `{ id, slug = "-leading" }` → `400 VALIDATION_ERROR`; DB slug unchanged.
    8. `PublishPreview_BadSlugRow_Is400` — insert a deck by raw SQL with slug `$"Bad_Slug_{Guid.NewGuid():N}"` (no DB constraint), POST publish `mode=preview` body `{ deckId }` → `400 VALIDATION_ERROR`, message contains `slug must match`.
    9. `PremiumUrl_BadSlug_Is400` — query `slug = "Bad_Slug"` → `400`, `error.code == "VALIDATION_ERROR"`.
    10. `PremiumUrl_UpperCaseSlug_PassesTheSlugGate` — query `slug = "AWS-SAA-C03"` → `403` (`Requires login` from `:147`; the slug gate at `:138` was passed after lower-casing).

12. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/BodyCapTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, `public sealed class BodyCapTests`. Helper `Event(string method, string path, string body, bool isBase64Encoded = false)` (the `AuthBearerTests.cs:48-65` shape with a body), `CallAsync(evt)` → `new VpcFunction().Handler(evt)`; `private const int Cap = 1_048_576;`. Cases, names verbatim:
    1. `OverCap_Is413_BeforeRouting` — `GET /health` with a body of `Cap + 1` `'a'`s → `413`, envelope `success == false`, `error.code == "PAYLOAD_TOO_LARGE"`.
    2. `AtCap_IsNot413` — `GET /health` with exactly `Cap` chars → `200` (`/health` ignores the body).
    3. `OverCap_Base64Decoded_Is413` — `isBase64Encoded = true`, body = base64 of `Cap + 1` bytes → `413` (the bound is on the decoded body).
    4. `OverCap_OnWebhookPath_Is413_BeforeAuth` — `POST /webhooks/revenuecat/development`, no authorization header, `Cap + 1` chars → `413` (not `401`, not `500`).
    5. `Options_IsNeverCapped` — `OPTIONS /api/v1/sync/push` with `Cap + 1` chars → `200` (the preflight answer precedes the `try`).

Estimated size: Res ~14 lines; Validation ~16; Decks 2; Publish −4/+1; PremiumDeckUrl 3; VpcFunction 1; webhook ~60 net; ProgressEvents ~70 net; tests ≈ 220 + 260 + 200 + 90.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E07.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0): the four new test files; the eight edited files exist; prerequisites from earlier issues are on the branch: `src_C/Shared/RecallSmith.Lambda.Common/Secrets.cs` with `public static bool FixedTimeEquals(string? got, string? expected)` (E06) and `src_C/Shared/RecallSmith.Lambda.Common/Log.cs` with `public static void Event(string level, object fields)` (E04).
2. Literal guards (exit 0):
   - `Res.cs`: line 1 `using System.Globalization;`; `Wrap(int statusCode, bool success, object? data, ApiError? error, IDictionary<string, string>? extraHeaders = null)`; `public APIGatewayProxyResponse PayloadTooLarge() =>`; `Code = "PAYLOAD_TOO_LARGE"`; `public APIGatewayProxyResponse ServiceUnavailable(string code, string? message, int retryAfterSec)`; `["retry-after"] = retryAfterSec.ToString(CultureInfo.InvariantCulture)`.
   - `Validation.cs`: `public const string SlugPattern = "^[a-z0-9][a-z0-9-]{0,63}$";`, `public static readonly Regex SlugRegex = new(SlugPattern, RegexOptions.Compiled);`, `public const string SlugRuleMessage = "slug must match ^[a-z0-9][a-z0-9-]{0,63}$";`, `public static bool IsValidSlug(string? slug)`, `public static string RequireSlug(string? slug, string field = "slug")`.
   - `Decks.cs`: exactly two `Validation.RequireSlug(` lines; `slug = Validation.RequireSlug(slug);`; the PUT spec line verbatim.
   - `Publish.cs`: `Validation.RequireSlug(Convert.ToString(deck["slug"], CultureInfo.InvariantCulture), "deckSlug")`; no `deckSlug.Contains('/')`, no `contains invalid characters`.
   - `PremiumDeckUrl.cs`: `return Validation.IsValidSlug(v) ? v : null;`; `res.BadRequest("VALIDATION_ERROR", Validation.SlugRuleMessage)`; no `"^[a-z0-9-]+$"`, no `Missing/invalid slug`.
   - `VpcFunction.cs`: exactly one line `if ((req.RawBody?.Length ?? 0) > 1_048_576) return res.PayloadTooLarge();`, whose two preceding non-blank lines are `try` and `{` and which precedes `var p = req.Path.TrimEnd('/');`.
   - `RevenuecatWebhook.cs`: `private const string ImplVersion = "2026-09-22T00:00Z-v14";`; `if (!Secrets.FixedTimeEquals(gotToken, expectedToken))`; the 401 body line `return res.Raw(401, new { ok = false, error = "Unauthorized", mode, impl = ImplVersion });`; `private static async Task<bool> InsertRcEventOnce(`; `$9::jsonb`; `on conflict (event_id) do nothing returning 1;`; `private static APIGatewayProxyResponse DbUnavailable(Res res, string mode) =>`; `error = "DB_UNAVAILABLE"`; `["retry-after"] = "60"`; `replayed`; the seven `reason = "…"` literals; absent: `gotToken != expectedToken`, `host.Contains("dev"`, `Console.WriteLine(`, `Log.Warn(`, `conn is not null`.
   - `ProgressEvents.cs`: `private const string ProgressEventsImpl = "progressEvents-v2";`; `private const int MaxIdentifierLength = 128;`; `private const int MaxShortStringLength = 64;`; `private sealed record RejectedEvent(int Index, string? EventId, string Code);`; the five codes `"NOT_OBJECT"`, `"BAD_EVENT_ID"`, `"MISSING_FIELD"`, `"BAD_EVENT_TIME"`, `"TOO_LONG"`; `if (rating is < 1 or > 4) rating = null;`; `step = "ingest_rejected"`; `receivedCount = events.Count,` (≥ 2); `rejectedEventIds,` and `rejected,` (≥ 2 each); absent: `throw new ValidationError($"events[`, `RequireString(`, `receivedCount = allEventIds.Count`.
   - Tests: each new class carries `[Collection(PostgresCollection.Name)]`; `RevenuecatWebhookTests` has the 11 method names of Changes 9 and the literals `test-secret-dev`, `retry-after`, `DB_UNAVAILABLE`, `e07_rc_partial`, `maxVersion: 2`; `ProgressEventsPerEventTests` has the 8 names of Changes 10, `[MemberData(`, `GeneratedCaseCount = 60`; `SlugRulesTests` has the 10 names of Changes 11, `[MemberData(`, `GeneratedCaseCount = 60`, `slug must match ^[a-z0-9][a-z0-9-]{0,63}$`; `BodyCapTests` has the 5 names of Changes 12, `1_048_576`, `PAYLOAD_TOO_LARGE`, `new VpcFunction().Handler(`.
   - Suppression grep of `C07.verify.sh:151` (`\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable`, plus `Skip[[:space:]]*=` and `#pragma warning disable`) over the twelve scope files: no match.
   - Secret-leak grep of E00 §5 over the `+` lines of the diff and the four new files: no match.
3. Build (exit 0): `cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo`.
4. Targeted tests (exit 0, Docker running): `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Release --no-build --nologo --filter "FullyQualifiedName~RevenuecatWebhookTests|FullyQualifiedName~ProgressEventsPerEventTests|FullyQualifiedName~SlugRulesTests|FullyQualifiedName~BodyCapTests|FullyQualifiedName~ProgressEventsIntegrationTests|FullyQualifiedName~ProgressEventsSingleStatementTests|FullyQualifiedName~ProgressEventsClientFeaturesTests|FullyQualifiedName~ProgressEventsCardFormatTests|FullyQualifiedName~CardsAuthoringTopicTests|FullyQualifiedName~AuthBearerTests"`.
5. Scope + frozen + OTA + apply guard (exit 0): `git diff --name-only <merge-base>` ∪ the pathspec-scoped untracked scan of `src_C scripts docs infra mobile/src mobile/tests frontend/src frontend/tests .github snowflake` contains nothing outside the twelve scope files (+ `docs/delivery/r16-issues/`); the three frozen mobile files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, `mobile`, `frontend`, `infra`, `.github`, `snowflake`, every `.csproj`, `src_C/Vpc/Db`, `src_C/deploy.sh`, `src_C/env`, `Secrets.cs`, `Log.cs`, `Auth.cs`, `Pg.cs`, `DbUtil.cs`, `LambdaRequest.cs`, `IntegrationTestBase.cs` and every pre-existing test file are zero-diff; `grep -Fq '"version": "1.6.1"' mobile/app.json`; no `@sentry` under `mobile/src`; the `+` lines of the diff outside comments contain no `terraform apply|import` and no `aws <svc> create-|update-|delete-|put-`.

## Verify

```bash
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E07.verify.sh
```
Steps 1–2 are file/literal checks (seconds); step 3 builds the solution in Release (implicit cached restore, ~1–2 min cold); step 4 starts one `postgres:16-alpine` container and runs the ten classes (single-digit minutes). No AWS call, no Terraform, no plan: E07 changes nothing the supervisor applies — after the merge the supervisor's only action is the normal `ENV=prod ./deploy.sh` (E06's path) at the end of the wave's deploy window, followed by a second empty plan as for every issue. The driver additionally runs the full `src_C` root gate (`cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`, Docker) plus its diff-scoped banned-term grep and suppression scan, so keep every other test class green; the verify never repeats the whole suite.

## Do NOT

- Do NOT keep any DB path best-effort in the webhook: `null` connection, open failure, insert failure and upsert failure are all `503 DB_UNAVAILABLE` + `retry-after: 60`; do NOT return `503` for `env_mismatch`, `product_mismatch`, `TEST` or a wrong token.
- Do NOT put any length, prefix, hash or bearer flag in the `401` body; do NOT log the token itself anywhere.
- Do NOT add a migration, a CHECK constraint or a column type change — the caps and the slug grammar are code-only.
- Do NOT reject a batch for a batch-level string (`deviceId`/`clientVersion`/`clientPlatform` are clamped), and do NOT answer `400` for a per-event problem — the frozen client (`progressSync.ts:1537-1540`) can only drop what is in `acceptedEventIds ∪ duplicateEventIds`.
- Do NOT rename, reorder or drop the five existing response keys; do NOT change `LambdaHost`, `IntegrationTestBase.cs` or any existing test file.
- Do NOT move the body-cap line above the `try` (OPTIONS must stay uncapped) or into `Handler`; do NOT touch `:51-62`, `:86-98`, `:123-126`, `:207-210`, `:32-34` of `VpcFunction.cs`.
- Do NOT touch `ProgressEvents.cs:611-637` (E12) or `:806-810` (E13), `Secrets.cs`, `Log.cs`, `Auth.cs`, `Migrate.cs`, `Pg.cs`, `DbUtil.cs`, any `.csproj`, `mobile/`, `frontend/`, `infra/`, `.github/`, `docs/*.md`.
- Do NOT run `dotnet restore` by hand, `npm …`, `expo …`, `eas …`, `terraform …`, `aws …`, `src_C/deploy.sh`, or anything that needs the network; do NOT run git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree.
