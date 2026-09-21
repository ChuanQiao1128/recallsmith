# C14 — Event envelope `clientFeatures` + `updateId` (`event-envelope-client-features`)

Give every `/api/v1/sync/push` batch two optional, top-level capability markers next to `clientVersion` — `clientFeatures: string[]` (empty in Wave C, `'mcq'` arrives with Wave D) and `updateId: string` (the running `expo-updates` update, which tells a post-OTA 1.6.0 device from a pre-OTA one; `app_version` cannot) — have `ProgressEvents.cs` read them into the outbox payload as `client_features` (jsonb array) and `update_id`, and prove with a golden-bytes test that a client without capabilities sends exactly today's bytes. The frozen `progressSync.ts` gains **exactly four added lines and nothing else** (the second of the wave's two signed exceptions); the `expo-updates` read lives in a new, non-frozen module behind a guarded dynamic `import()`. No migration, no new statement, no Snowflake edit (C13 already keys `answer_mode` on `client_features`), no dependency change (OTA on runtimeVersion 1.6.0).

## Context

What the tree looks like today (`delivery/r16-c-economy`, base `52594fe`, plus C05–C13 merged before you):

- **`mobile/src/sync/progressSync.ts`** (frozen, blob `7393f532`, 1868 lines; `mobile/gacha-v7.md` §2.1, signed exception `docs/economy-v2-learn-to-earn-2026-09-19.md:66`). Imports `:2-18` — `expo-crypto`, AsyncStorage, `expo-constants`, `Platform`, `apiJson`, … ; **no `expo-updates` import anywhere**. `:11` is `import { invalidateDrawStateCache } from '../features/gacha/draw/drawStateCache';` (your new import goes on the line after it). `getClientVersion()` `:278-280` reads `Constants.expoConfig?.version ?? 'unknown'`. `syncProgressOnce` `:1459`; the push loop starts at `// 1) push` `:1481`; `:1485` `  const deviceId = await getDeviceId();` (C00 §2.13 cites `:1483` — the tree has it at `:1485`; the literal is the anchor, not the number); the push body is `:1494-1531`: `:1494` `      body: {`, `:1495` `        deviceId,`, `:1496` `        clientPlatform: Platform.OS,`, `:1497` `        clientVersion: getClientVersion(),`, `:1498` `        events: batch.map((ev: any) => ({`, per-event keys `:1499-1527` (21 keys, in this order: `eventId, schemaVersion, eventType, type, deckSlug, deckVersion, stableUid, rating, sessionId, cardRevision, statedDifficulty, reviewStage, reviewCountForCard, dwellTimeMs, offlineQueueDelayMs, reviewedAtMs, eventTimeMs, nextReviewAtMs, schedulerVersion, progressAfter, lastSeenRevision`; `offlineQueueDelayMs` is `Math.max(0, Date.now() - Number(ev.reviewedAtMs ?? Date.now()))` at `:1513`). `SCHEDULER_VERSION = 'ladder-v1'` `:133`; `getDeviceId()` `:210-220` reads `DEVICE_ID_KEY = 'devcards:deviceId:v1'` (`:186`) and falls back to `Crypto.randomUUID()`; `recordReviewEvent` `:873-959` builds the stored event at `:933-955` (`schemaVersion: 1`, `eventType: 'card_reviewed'`, `offlineQueueDelayMs: 0`, `schedulerVersion: SCHEDULER_VERSION`).
- **`mobile/src/api/apiClient.ts:26`** `body?: any;` and `:52` `body: opts.body ? JSON.stringify(opts.body) : undefined` — `JSON.stringify` drops undefined-valued keys, which is why the two field lines can be unconditional in the frozen file and a capability-less client still sends `deviceId, clientPlatform, clientVersion, events` byte for byte.
- **`expo-updates`** `~29.0.15` (`mobile/package.json:43`; installed `29.0.15`). `mobile/node_modules/expo-updates/build/Updates.d.ts:19` `export declare const updateId: string | null;` (null in dev / when updates are disabled). Its entry pulls `react-native` `Image` (`build/Updates.js:2`) and `requireNativeModule('ExpoUpdates')` (`build/ExpoUpdates.js:5`), so a **static** `import 'expo-updates'` in `progressSync.ts` would break every suite that imports it — ten unit files (`tests/unit/{progressSyncDropCounter,progressSyncPendingAdoption,progressSyncPullPagination,progressSyncPullTriggers,progressSyncQueueRace,multiDeviceSync.sim,revisionDemotionSync,drawStateCacheInvalidation,deckActionResolver.spec,homeOwnedGate.spec}`) plus integration suites, none of which mocks `expo-updates` (`grep -rn expo-updates mobile/tests` → 0). Measured on this tree (vitest 4.1.5, `environment: 'node'`, `tests/setup/globals.ts` loaded): `await import('expo-updates')` from a test under `mobile/` **rejects** with `Parse failure: Expected 'from', got 'typeOf' At file: /node_modules/react-native/index.js:27:7` in ≈30 ms — a clean rejection, no hang, no process crash — so a guarded dynamic import resolves to `{}` under every existing suite at the cost of one failed transform per worker; a top-level `vi.mock('expo-updates', () => ({ get updateId() { … } }))` getter is reachable through the same dynamic import and counts reads, and `vi.doMock('expo-updates', () => { throw … })` after `vi.resetModules()` makes the import reject. Under this vitest only a dynamic `import()` goes through the mock registry lazily (B00 §9 #13); the proven in-repo pattern is `mobile/src/features/gacha/milestones/ratingPrompt.ts:55-68` (`loadStoreReview`) with its tests at `mobile/tests/unit/ratingPrompt.test.ts:17-20` (top-level `vi.mock`) and `:108-121` (`vi.resetModules()` + `vi.doMock(…, () => { throw … })` + dynamic import of the module under test). Existing in-app readers of the package (`mobile/src/config/appEnv.ts:2`, `mobile/src/content/premiumDeckApi.ts:3`) import it statically and are mocked by every test that reaches them — do not copy that style here.
- **Mobile test infra**: `mobile/vitest.config.ts:9-18` includes `tests/unit/**/*.{test,spec}.{ts,tsx}`, `environment: 'node'`, setup `tests/setup/globals.ts` (`__DEV__ = true`); `tsc --noEmit` (`npm run test:typecheck`) typechecks `tests/` too (strict). `fast-check ^4.9.0` is a devDependency (`mobile/package.json:66`; `import fc from 'fast-check'` as in `tests/unit/spillSchedule.test.ts:4`). The progressSync suites mock `react-native` as `{ Platform: { OS: 'ios' } }`, `expo-constants` as `{ default: { expoConfig: { version: 'test' } } }`, `expo-crypto` as a counter (`new-1`, `new-2`, …), AsyncStorage as a Map, and `../../src/api/apiClient` (`tests/unit/progressSyncDropCounter.test.ts:20-66`); `tests/unit/progressSyncQueueRace.test.ts:155-159` shows how to drive a real push (`setActiveUserSub`, `setSyncAccessToken('test-token')`, `forceProgressSync('manual')`) and `:69-92` how the push mock captures `opts.body` and acks every id. No existing test snapshots the push body — the golden test is new.
- **`src_C/Vpc/Runtime/ProgressEvents.cs`** (765 lines on the base; C10 has since restructured it — re-read it, the numbers below are base anchors). Envelope parse `:95-97` (`deviceId`, `clientVersion`, `clientPlatform` via `TryGetProperty(...).ToString().Trim()`); unknown body keys are ignored today, so `clientFeatures`/`updateId` already arrive and are dropped. Parameter list `:250-253` (`parameters`, `idx`, `static string P(ref int i) => "$" + i++;`); envelope params `:277-286`; the last parameter before the SQL text is `:364-365` `var userHashParam = P(ref idx); parameters.Add(userIdHash);`. Outbox CTE `:399-447`: `jsonb_strip_nulls(jsonb_build_object(…))` with 22 keys ending `'app_version', client_version, 'offline_queue_delay_ms', offline_queue_delay_ms, 'deck_version', deck_version` (`:440-442`), `from ins` `:444`. After C10 the SQL is produced by `BuildIngestSql(bool withCardFormat)`, `'card_format'` is the last payload key, `from ins` carries the `left join decks … left join cards …`, and execution (`:595` `DbUtil.QueryAsync(conn, null, sql, parameters)`) is wrapped in `try { withCardFormat: true } catch (PostgresException pg) when (pg.SqlState == "42703") { withCardFormat: false }` (C00 §2.10). Parameters are bound with `AddWithValue(name, value ?? DBNull.Value)` (`src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs:63-68`) — a null is untyped, so every nullable placeholder needs an explicit cast (`ProgressEventsSingleStatementTests.cs:473` F7). `users` upsert `:369-379` writes only `email, last_seen_at, last_platform, last_version, last_device_id` — it gains nothing here (no column, no migration). `analytics_event_outbox.payload` is `jsonb not null` (`src_C/Vpc/Db/Migrations/009_content_intelligence_events.sql:32-46`).
- **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsSingleStatementTests.cs`** (679 lines): `Batch()` `:64-80` is a `private static` dictionary builder (`events`, then `deviceId`/`clientVersion`/`clientPlatform` only when non-null — absent and null are different inputs, `:58-63`); `:68` is exactly `    string? clientPlatform = "ios")`. F5 `OneIngest_CostsOneStatement_AndNoTransactionShell` `:418-449` proves one billable statement through the private log probe (`ProbeIngestAsync` `:374-405`, `IsConnectionReset` `:359-361`, `Render` `:670-679`); F7 `PreparedStatement_BindsNullAndNonNullParametersAlike` `:472-…`. `IntegrationTestBase.cs:86-96` `_db.QueryAsync/ScalarAsync(sql, params)` (`$1` placeholders), `:174-181` `LambdaHost.PostProgressEventsAsync(userSub, object body)` (serialises any object, asserts 200). `ProgressEventsIntegrationTests.cs:72-78` is the anonymous-type `Batch` (untouched) and `:151` the outbox-join assertion style.
- **Snowflake**: C13 (merged before you) already projects `client_features` / `update_id` in `staging.stg_review_events` and derives `answer_mode` with `array_contains('mcq'::variant, coalesce(src:payload:client_features, src:client_features))` (C00 §2.12). The wave table row (`docs/delivery-wave-1.6-plan-2026-09-19.md:118`) lists `snowflake/*.sql` in C14's scope — C00 §6 #9 resolves that C13 owns the SQL and C14 only greps it. `docs/mcq-card-type-plan-2026-09-18.md:375` still says `answer_mode` is keyed on `app_version ≥ 1.6.0`; the release plan (`docs/release-1.6.0-plan-2026-09-19.md:206`, `:279`) supersedes it with these two fields; C15 amends the prose.

What C00 decided (binding; §0, §1.1, §1.2, §2.13, §3.1, §3.2, §3.3, §5, §6 #9, #11, #17, #18):

- Shape: **`clientFeatures: string[]`** (not an object) — lowercase tokens matching `^[a-z][a-z0-9_-]{0,31}$`, sorted, deduplicated, ≤ 16 entries, **omitted** from the body when empty. **`updateId: string`** — `expo-updates` `Updates.updateId`, **omitted** when null. Neither is ever sent as JSON `null`. Both are top-level envelope fields (batch-scoped), not per-event fields.
- The frozen file gains exactly four added lines and zero removed (regexes in Changes required 3); `deckRepository.ts` and `model.ts` are zero-diff.
- The `expo-updates` read is a guarded dynamic `import()` inside a function in the new module `mobile/src/sync/clientCapabilities.ts`; cached after the first resolve; never throws; any failure → `{}`; no undefined-valued keys.
- Server: two nullable parameters after `userHashParam`, two payload keys after `'card_format'` with explicit `::jsonb` / `::text` casts, null → stripped by `jsonb_strip_nulls`; still one statement; no users column; no migration.
- Tests: `tests/unit/clientCapabilities.test.ts` (with a fast-check property), `tests/unit/progressSyncEnvelopeBytes.test.ts` (the golden-bytes test), `ProgressEventsClientFeaturesTests.cs` (DB), `Batch()` in `ProgressEventsSingleStatementTests.cs` gains the two optional params; every existing `progressSync*` mobile suite is untouched.

Why the golden test matters: the owner's contract for this frozen file is "two optional fields, nothing else changes on the wire". A test that only checks the new keys would pass if a stray `null` or a reordered key slipped in; comparing `JSON.stringify(body)` against an independently built literal is the only assertion that pins the old bytes.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables: OTA, frozen files, banned terms), §1.1/§1.2 (your file rows), §2.13 (verbatim signatures and the four regexes), §3.1 C14, §3.2 (the two mobile test files and the C# test class), §3.3, §5 (verify conventions), §6 #9, #11, #17, #18.
2. `mobile/src/sync/progressSync.ts:1-18`, `:278-280`, `:1481-1531` (the four anchors and the per-event mapping you will mirror in the golden test), `:873-959` (`recordReviewEvent`), `:210-220` (`getDeviceId`).
3. `mobile/src/features/gacha/milestones/ratingPrompt.ts:55-68` and `mobile/tests/unit/ratingPrompt.test.ts:1-40`, `:108-121` (dynamic-import guard + how to mock / throw / unmock it).
4. `mobile/tests/unit/progressSyncDropCounter.test.ts:20-66` (the mock block you copy) and `mobile/tests/unit/progressSyncQueueRace.test.ts:69-92`, `:155-165` (push capture + driving a sync).
5. `mobile/node_modules/expo-updates/build/Updates.d.ts:15-19`, `build/Updates.js:1-3`, `build/ExpoUpdates.js:5` (why the import must be dynamic).
6. `src_C/Vpc/Runtime/ProgressEvents.cs` — whole file as it is after C10 (envelope parse, parameter list, `BuildIngestSql`, outbox CTE, the 42703 catch), and `docs/delivery/r16-issues/C10-mcq-ingest-card-format.md` change 3 (the `cardFormatKey` / `cardFormatJoin` fragments and the `'deck_version', deck_version{cardFormatKey}` template line your change 4d extends).
7. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsSingleStatementTests.cs:40-80` (helpers, `Batch()`), `:338-405` (log probe), `:418-449` (F5), `:460-473` (F7 rationale); `IntegrationTestBase.cs:80-96`, `:158-246` (fixture, collection, `LambdaHost`); `ProgressEventsIntegrationTests.cs:72-78`, `:145-158`; `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsCardFormatTests.cs` (C10's outbox-payload assertion style — reuse it, do not edit it).
8. `docs/economy-v2-learn-to-earn-2026-09-19.md:62-66` (the signature), `docs/release-1.6.0-plan-2026-09-19.md:206`, `:279` (why `updateId`).

## Constraints

- **Scope (the ONLY files that may change):**
  - `mobile/src/sync/clientCapabilities.ts` (new)
  - `mobile/src/sync/progressSync.ts` (frozen — **exactly the four added lines of Changes required 3; `git diff --numstat` must print `4	0`**)
  - `mobile/tests/unit/clientCapabilities.test.ts` (new)
  - `mobile/tests/unit/progressSyncEnvelopeBytes.test.ts` (new)
  - `src_C/Vpc/Runtime/ProgressEvents.cs`
  - `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsSingleStatementTests.cs` (`Batch()` signature/body + one add-only `[Fact]`; every existing line outside `Batch()` byte-identical)
  - `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsClientFeaturesTests.cs` (new)
  Nothing else: no `snowflake/*` (C13 owns it), no `src_C/Vpc/Db/Migrations/*`, no `frontend/*`, no top-level `docs/*.md` (C15), no `mobile/src/config/*`, no `mobile/src/review/storage.ts`, no `mobile/tests/setup/*`, no `mobile/vitest.config.ts`, no `ProgressEventsCardFormatTests.cs` / `ProgressEventsIntegrationTests.cs` / `IntegrationTestBase.cs`.
- **Frozen files (gacha-v7 §2.1):** `mobile/src/content/deckRepository.ts` and `mobile/src/review/model.ts` — zero diff. `mobile/src/sync/progressSync.ts` — the four lines only, each byte-exact (6 of them are whitespace-sensitive: 2-space indent on the `caps` line, 8-space indent on the two field lines). No reflow, no comment, no blank line, no import reordering.
- **OTA rule:** runtimeVersion 1.6.0 — `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json` are untouched; no new dependency, no native module, no `expo prebuild`, no `npm install`. `"expo-updates": "~29.0.15"` is already installed and is read only through the dynamic import.
- **No new `eventType`, no `schemaVersion` bump, no per-event field** — the two markers are batch-level (C00 §0, §2.13). Events stay `card_reviewed` / `schemaVersion: 1` / `'ladder-v1'`.
- **No users column, no migration, no second statement.** `ProgressEventsSingleStatementTests.OneIngest_CostsOneStatement_AndNoTransactionShell` stays green and is not edited; the 42703 fallback text of C10 must also carry the two keys (a client on a not-yet-migrated database still gets its markers).
- **Banned literals in any added line** (driver grep over the diff, case-insensitive): the six terms of B00 §0 / C00 §0 — this brief deliberately does not spell them out; write "work around", "sidestep", "sensor", "guard", "fallback", "probe" instead. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff.
- **Existing tests:** no mobile test file changes (in particular none of the ten `progressSync`-importing unit suites and no integration suite — they need no `expo-updates` mock because the import is dynamic and its failure is swallowed). Server: only `Batch()` and one new `[Fact]` in `ProgressEventsSingleStatementTests.cs`; `ProgressEventsIntegrationTests.cs`, `ProgressEventsCardFormatTests.cs` untouched.
- **Typing:** `mobile/tsconfig.json` is `strict: true` and covers `tests/`; no `any` in the new module (the test harness may keep the `(ev: any)` style of its models). No `JSX`.
- **dotnet / Docker:** `dotnet test` needs a running Docker daemon (Testcontainers `postgres:16-alpine`, `IntegrationTestBase.cs:31`); every `[Collection(PostgresCollection.Name)]` class runs serially. Do not run `dotnet restore` explicitly (`dotnet test` restores from the local cache); do not add packages. Runtime for the two targeted classes is single-digit minutes (one container start + the log-probe tests that `ALTER SYSTEM` + reload).
- **Never copy dump content.** No MCQ text anywhere in this issue; the only feature token you ever write is `'mcq'`.

## Changes required

1. **`mobile/src/sync/clientCapabilities.ts` (new, NOT frozen)** — signatures verbatim from C00 §2.13 plus one extra pure export (`normalizeClientFeatures`) so the token grammar is testable while `CLIENT_FEATURES` is empty:

   ```ts
   // mobile/src/sync/clientCapabilities.ts
   /**
    * What this client can do, sent once per push batch next to clientVersion
    * (progressSync.ts, the two signed envelope lines). Wave C ships no feature
    * tokens; the update id lets analytics tell a post-OTA 1.6.0 device from a
    * pre-OTA one, which app_version cannot.
    *
    * expo-updates is loaded with a guarded dynamic import() inside a function:
    * a static import would drag react-native Image and requireNativeModule into
    * every suite that imports progressSync (B00 §9 #13). Any failure → {}.
    */
   export type ClientCapabilities = { clientFeatures?: string[]; updateId?: string };

   /** Wave C ships this empty; Wave D appends 'mcq' when flags.mcq.enabled at call time. */
   export const CLIENT_FEATURES: readonly string[] = [];

   export const MAX_CLIENT_FEATURES = 16;
   export const MAX_UPDATE_ID_LENGTH = 64;
   const FEATURE_TOKEN = /^[a-z][a-z0-9_-]{0,31}$/;

   /**
    * Strings only; trimmed and lower-cased; must match FEATURE_TOKEN; deduplicated;
    * sorted (ordinal); at most MAX_CLIENT_FEATURES. Pure, never throws.
    */
   export function normalizeClientFeatures(input: readonly unknown[]): string[];

   /**
    * Guarded dynamic `import('expo-updates')` inside the function (B00 §9 #13: a static import breaks ≥ 9 unit suites — Updates.js:1-3 pulls
    * react-native Image and ExpoUpdates.js:5 calls requireNativeModule). Cached after the first resolve; never throws; any failure → {}.
    * Keys are added only when defined (no undefined-valued keys are ever present either).
    */
   export async function getClientCapabilities(): Promise<ClientCapabilities>;
   export function resetClientCapabilitiesForTests(): void;
   ```

   Implementation rules:
   - `normalizeClientFeatures`: iterate `input`; skip non-strings; `token = raw.trim().toLowerCase()`; keep it iff `FEATURE_TOKEN.test(token)`; collect in a `Set`; return `[...set].sort().slice(0, MAX_CLIENT_FEATURES)` (default `sort()` is ordinal for these ASCII tokens).
   - `updateId` read (private `readUpdateId()`): `try { const mod = (await import('expo-updates')) as { updateId?: unknown; default?: { updateId?: unknown } } | undefined; const raw = mod?.updateId ?? mod?.default?.updateId; … } catch { return undefined; }` — accept only a `string`; `id = raw.trim().toLowerCase()`; return it iff `0 < id.length <= MAX_UPDATE_ID_LENGTH`, else `undefined`. The module id string `'expo-updates'` must appear exactly once, inside the `import(` call — no static `import … from 'expo-updates'`, no `require(`.
   - Cache: a module-level `let cachedUpdateId: { value: string | undefined } | null = null;`. `getClientCapabilities()` resolves `readUpdateId()` once (including the "unavailable" outcome) and reuses it on every later call; `clientFeatures` is recomputed from `CLIENT_FEATURES` on every call (so Wave D can make it flag-dependent without touching the cache). Build the result as `const caps: ClientCapabilities = {}` and assign `caps.clientFeatures` only when the normalised array is non-empty, `caps.updateId` only when defined — never `{ clientFeatures: undefined }`. Wrap the whole body in `try … catch { return {}; }`.
   - `resetClientCapabilitiesForTests()` sets `cachedUpdateId = null`.
   - Imports: none (no `react`, no AsyncStorage, no `expo-constants`). ~70 lines.

2. **Nothing else on mobile besides the frozen four lines and the two tests.** No feature flag read, no `remoteConfig`, no change to `drawStateSync.ts`.

3. **`mobile/src/sync/progressSync.ts` — the four added lines, exact (C00 §2.13; the verify checks each with these regexes and their positions):**
   1. Directly after `:11` `import { invalidateDrawStateCache } from '../features/gacha/draw/drawStateCache';` insert
      `import { getClientCapabilities } from './clientCapabilities';` — `^\+import \{ getClientCapabilities \} from '\./clientCapabilities';$`
   2. Directly after `  const deviceId = await getDeviceId();` (`:1485` on the base; C00 cites `:1483`) insert
      `  const caps = await getClientCapabilities();` — `^\+  const caps = await getClientCapabilities\(\);$` (two-space indent)
   3. Directly after `        clientVersion: getClientVersion(),` (`:1497`) insert
      `        clientFeatures: caps.clientFeatures,` — `^\+        clientFeatures: caps\.clientFeatures,$` (eight-space indent)
   4. On the next line insert
      `        updateId: caps.updateId,` — `^\+        updateId: caps\.updateId,$`
   so that the body reads `deviceId, clientPlatform, clientVersion, clientFeatures, updateId, events`. `git diff --numstat <base> HEAD -- mobile/src/sync/progressSync.ts` prints `4	0	mobile/src/sync/progressSync.ts`; `git diff -U0 … | grep '^+' | grep -v '^+++'` prints those four lines in that order and nothing else. Do not touch `deckRepository.ts` or `model.ts`.

4. **`src_C/Vpc/Runtime/ProgressEvents.cs`** (after C10's restructure; anchor on literals, not line numbers):
   a. Directly after the `clientPlatform` read (base `:97`) add
      ```csharp
      var clientFeatures = ReadClientFeatures(body); // JSON array text such as ["mcq"], or null
      var updateId = ReadUpdateId(body);             // trimmed, or null
      ```
   b. Two private helpers next to `RequireString` (base `:646`), verbatim in behaviour:
      ```csharp
      private static readonly Regex FeatureTokenRegex = new("^[a-z][a-z0-9_-]{0,31}$", RegexOptions.Compiled);
      private const int MaxClientFeatures = 16;
      private const int MaxUpdateIdLength = 64;

      /// <summary>
      /// clientFeatures → the JSON text of a sorted, distinct array of feature tokens, or null.
      /// Anything but an array → null. Items that are not strings, or that fail the token grammar
      /// after trim + lower-case, are ignored; at most 16 survive. An empty result → null, so the
      /// key is stripped from the payload exactly as when the client sent nothing.
      /// </summary>
      private static string? ReadClientFeatures(JsonElement body)
      {
        if (!body.TryGetProperty("clientFeatures", out var el) || el.ValueKind != JsonValueKind.Array) return null;
        var tokens = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var item in el.EnumerateArray())
        {
          if (item.ValueKind != JsonValueKind.String) continue;
          var token = (item.GetString() ?? "").Trim().ToLowerInvariant();
          if (FeatureTokenRegex.IsMatch(token)) tokens.Add(token);
        }
        if (tokens.Count == 0) return null;
        return JsonSerializer.Serialize(tokens.Take(MaxClientFeatures));
      }

      /// <summary>updateId → trimmed string when it is a non-blank JSON string of ≤ 64 chars; otherwise null.</summary>
      private static string? ReadUpdateId(JsonElement body)
      {
        if (!body.TryGetProperty("updateId", out var el) || el.ValueKind != JsonValueKind.String) return null;
        var id = (el.GetString() ?? "").Trim();
        return id.Length > 0 && id.Length <= MaxUpdateIdLength ? id : null;
      }
      ```
      (`System.Text.RegularExpressions` and `System.Text.Json` are already imported at `:5-6`.)
   c. Parameters — directly after `var userHashParam = P(ref idx); parameters.Add(userIdHash);` (base `:364-365`) append, in this order:
      ```csharp
      var featuresParam = P(ref idx);
      parameters.Add(clientFeatures);
      var updateIdParam = P(ref idx);
      parameters.Add(updateId);
      ```
      They are allocated once, before the SQL text is built, and interpolated by both `BuildIngestSql(true)` and `BuildIngestSql(false)`.
   d. Outbox payload — inside `jsonb_build_object(…)`, after `card_format`. C10 (its brief, change 3a–3b) splices `card_format` in as a C# fragment, so the last argument of `jsonb_build_object` on the merged tree is the single template line `'deck_version', deck_version{cardFormatKey}` (its verify pins that literal), with `{cardFormatKey}` empty when `withCardFormat` is false. Give that line a trailing comma and append the two keys as the next two template lines, so the three lines read exactly
      ```sql
              'deck_version', deck_version{cardFormatKey},
              'client_features', {featuresParam}::jsonb,
              'update_id', {updateIdParam}::text
      ```
      (14-space indent like the neighbouring keys; C# interpolation inside the raw string, the same way `'user_id_hash', {userHashParam}` is written; `))` stays on the following line). Do NOT put the keys inside the `cardFormatKey` C# string — that would drop them from the `withCardFormat: false` text. This way one template yields both texts: after `'card_format'` when the column exists, directly after `'deck_version'` when it does not. The explicit casts are load-bearing: `AddWithValue` binds a null untyped (F7). Nothing else in the CTE moves; `from ins{cardFormatJoin} … on conflict (event_id) do nothing returning 1` unchanged.
   e. No change to `NormalizedEvent`, the per-event VALUES row, `ensure_user`, `agg`, or the response body. Still exactly one `DbUtil.QueryAsync` per attempt.

5. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsSingleStatementTests.cs`** — two edits only:
   a. `Batch()` (`:64-80`) gains two optional parameters defaulting to absent. The signature becomes exactly
      ```csharp
      private static object Batch(
        IEnumerable<object> events,
        string? deviceId = "device-under-test",
        string? clientVersion = "1.2.3",
        string? clientPlatform = "ios",
        IReadOnlyList<string>? clientFeatures = null,
        string? updateId = null)
      ```
      (the only pre-existing line that changes is `:68`, which gains a trailing comma) and the body gains, after the `clientPlatform` line,
      ```csharp
      if (clientFeatures is not null) body["clientFeatures"] = clientFeatures;
      if (updateId is not null) body["updateId"] = updateId;
      ```
      Absent stays absent: every existing caller passes nothing, so no existing assertion changes.
   b. One add-only `[Fact]`, placed after F5 (`:449`) and before the `// --- F7` banner, named exactly `OneIngest_WithClientFeaturesAndUpdateId_IsStillOneStatement`: `NewUser("f5b")`, `WarmAsync(user, 3)`, then `ProbeIngestAsync(() => LambdaHost.PostProgressEventsAsync(user, Batch([Ev(NewEventId(), "card-caps", 4, Base + 6000)], clientFeatures: ["mcq"], updateId: "0b6c3f52-1c3f-4a3b-9c8e-7f0d2a1b4c5d")))`; assert `billable.Count == 1` (same `IsConnectionReset` filter and `Render` message as F5), `Assert.Contains("client_features", sql)`, `Assert.Contains("update_id", sql)`, and no `BEGIN`/`COMMIT`/`ROLLBACK`. Doc-comment: the markers ride the same statement; a second statement here would be the shell growing back.
   c. Nothing else in the file changes (F1–F4, F5 `OneIngest_CostsOneStatement_AndNoTransactionShell`, F7 `PreparedStatement_BindsNullAndNonNullParametersAlike`, F8 and every helper byte-identical — the verify greps those two names and F5's `Assert.Contains("ensure_user", sql, StringComparison.Ordinal);` / `Assert.Contains("analytics_event_outbox", sql, StringComparison.Ordinal);` lines to prove they are still there, and step 5 rejects any removed line other than the old `Batch()` tail).

6. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsClientFeaturesTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, constructor `(PostgresFixture db)`, `Deck = "csharp-basics"`, `NewUser(tag)` / `NewEventId()` / `Ev(...)` copied from `ProgressEventsSingleStatementTests.cs:42-56`, and a `Body(IEnumerable<object> events, IDictionary<string, object?>? extra = null)` builder returning a `Dictionary<string, object?>` with `events`, `deviceId = "device-under-test"`, `clientVersion = "1.2.3"`, `clientPlatform = "ios"` plus every `extra` entry (a dictionary so that an explicit JSON `null` can be expressed). A `PayloadAsync(string eventId)` helper runs `select payload::text from analytics_event_outbox where event_id = $1::uuid` through `_db.ScalarAsync`, asserts non-null, and returns `JsonDocument.Parse(raw).RootElement.Clone()`. Post through `LambdaHost.PostProgressEventsAsync(user, Body(...))`. Facts, names exact:
   1. `Payload_CarriesClientFeaturesAndUpdateId_WhenSent` — `clientFeatures = new[] { "mcq" }`, `updateId = "0b6c3f52-1c3f-4a3b-9c8e-7f0d2a1b4c5d"`: `payload.client_features` has `ValueKind == JsonValueKind.Array` with exactly one element `"mcq"`; `payload.update_id` equals the string; `payload.app_version` is still `"1.2.3"` and `payload.event_id` equals the event id (the old keys are intact).
   2. `Payload_HasNeitherKey_WhenAbsent` — no extra keys: `TryGetProperty("client_features", …)` and `("update_id", …)` are both false.
   3. `Payload_HasNeitherKey_WhenSentAsNull` — `extra = { ["clientFeatures"] = null, ["updateId"] = null }`: both absent (stripped).
   4. `ClientFeatures_AreNormalized_BeforeTheyReachThePayload` — `new object[] { "MCQ", " mcq ", "mcq", 42, "", "x y", "Alpha_1", "9start", "-dash" }` → exactly `["alpha_1", "mcq"]` in that order; a second post with `clientFeatures = "mcq"` (a string, not an array) → no `client_features` key.
   5. `ClientFeatures_AreCappedAtSixteen` — twenty distinct tokens `f00`…`f19` in reverse order → exactly `f00`…`f15` ascending.
   6. `UpdateId_IsTrimmed_AndDroppedWhenBlankOrTooLong` — `"  abc  "` → `"abc"`; `"   "` → no key; `new string('a', 65)` → no key; `new string('a', 64)` → present.
   Each Fact uses a fresh user and fresh event ids (event_id is a global primary key). No log probe here (one statement is F5 + change 5b).

7. **`mobile/tests/unit/clientCapabilities.test.ts` (new)** — `import fc from 'fast-check'`; top-level `const mockState = vi.hoisted(() => ({ reads: 0, updateId: 'ABC-Def' as unknown }));` and `vi.mock('expo-updates', () => ({ get updateId() { mockState.reads += 1; return mockState.updateId; } }));` (a getter, so reads are countable — verified to work through a dynamic import under this vitest); `beforeEach` resets `mockState` and calls `resetClientCapabilitiesForTests()`. Cases, each its own `it`, titles verbatim:
   1. `it('resolves {} when expo-updates cannot be loaded', …)` — `vi.resetModules(); vi.doMock('expo-updates', () => { throw new Error('missing'); });` then `const mod = await import('../../src/sync/clientCapabilities'); expect(await mod.getClientCapabilities()).toEqual({})`; `finally { vi.doUnmock('expo-updates'); vi.resetModules(); }` (pattern `ratingPrompt.test.ts:108-121`).
   2. `it('resolves {} against the real expo-updates module under node', …)` — `vi.doUnmock('expo-updates'); vi.resetModules();` then the same dynamic import of the module under test: the real package's entry throws under the node environment (react-native `Image`, `requireNativeModule`) or yields no string `updateId`; either way `toEqual({})` and the promise never rejects. Re-register nothing afterwards beyond `vi.resetModules()`.
   3. `it('resolves { updateId } lower-cased when expo-updates provides one', …)` — `mockState.updateId = 'ABC-Def'` → `toEqual({ updateId: 'abc-def' })`.
   4. `it('omits updateId when the module value is null or not a string', …)` — `null` → `{}`; reset; `42` → `{}`; reset; `''` → `{}`; reset; a 65-char string → `{}`.
   5. `it('caches the update id until reset', …)` — two calls → `mockState.reads === 1`; `resetClientCapabilitiesForTests()`; third call → `reads === 2`.
   6. `it('never sends undefined-valued keys', …)` — with `updateId = null`: `Object.keys(await getClientCapabilities())` is `[]` (`'clientFeatures' in caps` and `'updateId' in caps` both false).
   7. `it('ships no feature tokens in Wave C', …)` — `expect(CLIENT_FEATURES).toEqual([])` and the resolved object has no `clientFeatures` key.
   8. `it('normalizes feature tokens: trim, lower-case, grammar, dedupe, sort, cap at 16', …)` — `fc.assert(fc.property(fc.array(fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined)), { maxLength: 40 }), (input) => { const out = normalizeClientFeatures(input); … }))`: every item matches `/^[a-z][a-z0-9_-]{0,31}$/`; `out` is strictly ascending (`out[i] < out[i + 1]`); `out.length <= 16`; every item equals some `input` string's `trim().toLowerCase()`.
   9. `it('is idempotent and keeps every valid token when at most sixteen', …)` — `fc.assert(fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9_-]{0,31}$/), { maxLength: 16 }), (tokens) => { expect(normalizeClientFeatures(tokens)).toEqual([...tokens].sort()); expect(normalizeClientFeatures(normalizeClientFeatures(tokens))).toEqual(normalizeClientFeatures(tokens)); }))` (`fc.stringMatching` and `fc.uniqueArray` are both exported by the installed fast-check 4.9.0 — `mobile/node_modules/fast-check/lib/fast-check.d.ts`; `fc.stringOf` is not, it was removed in v4, so do not reach for it. If you need a hand-rolled token arbitrary use `fc.tuple(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'), maxLength: 31 })).map(([h, t]) => h + t)`).
   Import `CLIENT_FEATURES, getClientCapabilities, normalizeClientFeatures, resetClientCapabilitiesForTests` statically for cases 3–9; cases 1–2 use the dynamic import. ~110 lines.

8. **`mobile/tests/unit/progressSyncEnvelopeBytes.test.ts` (new — the golden-bytes test)** — copy the mock block of `progressSyncDropCounter.test.ts:20-66` verbatim (AsyncStorage Map with `getItem/setItem/removeItem/getAllKeys/multiRemove`; `expo-crypto` counter `new-${++uuidN}`; `expo-constants` version `'test'`; `react-native` `{ Platform: { OS: 'ios' } }`; `deckRepository` → `resolveDeckBySlug: null`; `review/storage` stubs), but the `apiJson` mock records `opts.body` for `/api/v1/sync/push` into `pushedBodies: unknown[]` and acks every id (`acceptedEventIds: ids`, as `progressSyncQueueRace.test.ts:69-92`), keeps the canned bootstrap (`userSub: USER`) and returns `ok({ serverTimeMs: 1, sinceMs: null, items: [] })` for every other path (the draw-state sync at the end of a round swallows its own errors). Add
   ```ts
   const capsState = vi.hoisted(() => ({ value: {} as { clientFeatures?: string[]; updateId?: string } }));
   vi.mock('../../src/sync/clientCapabilities', () => ({ getClientCapabilities: vi.fn(async () => capsState.value) }));
   ```
   `USER = 'envelope-user'`, `NOW_MS = 50_000`. `beforeAll`: `store.set('devcards:deviceId:v1', 'device-golden')`, `await setActiveUserSub(USER)`, `await setSyncAccessToken('test-token')`. `beforeEach`: `pushedBodies.length = 0`, `capsState.value = {}`, `vi.spyOn(Date, 'now').mockReturnValue(NOW_MS)`; `afterEach`: `vi.restoreAllMocks()` on the spy only (`dateSpy.mockRestore()`). Helper `pushOne(stableUid)`: `const id = await recordReviewEvent({ deckSlug: 'algo', stableUid, rating: 'good', reviewedAtMs: 1_000 }); await forceProgressSync('manual'); return { id, body: pushedBodies[0] }` (record after sign-in so the event lands in the user partition and the queue cache sees it; `expect(pushedBodies).toHaveLength(1)`). Cases, titles verbatim:
   1. `it('sends the pre-C14 envelope bytes when the client has no capabilities', …)` — `capsState.value = {}`; build the expected body **independently**, from the fixture, mirroring `progressSync.ts:1494-1528`:
      ```ts
      const expected = {
        deviceId: 'device-golden',
        clientPlatform: 'ios',
        clientVersion: 'test',
        events: [{
          eventId: id, schemaVersion: 1, eventType: 'card_reviewed', type: 'review',
          deckSlug: 'algo', deckVersion: null, stableUid: 'uid-golden', rating: 3,
          sessionId: null, cardRevision: null, statedDifficulty: null, reviewStage: null,
          reviewCountForCard: null, dwellTimeMs: null, offlineQueueDelayMs: NOW_MS - 1_000,
          reviewedAtMs: 1_000, eventTimeMs: 1_000, nextReviewAtMs: null,
          schedulerVersion: 'ladder-v1', progressAfter: null, lastSeenRevision: null,
        }],
      };
      expect(JSON.stringify(body)).toBe(JSON.stringify(expected));
      expect(Object.keys(JSON.parse(JSON.stringify(body)))).toEqual(['deviceId', 'clientPlatform', 'clientVersion', 'events']);
      expect(JSON.stringify(body)).not.toContain('clientFeatures');
      expect(JSON.stringify(body)).not.toContain('updateId');
      ```
      (`id` is the value `recordReviewEvent` returned — do not hard-code `new-1`.)
   2. `it('places clientFeatures and updateId after clientVersion and before events', …)` — `capsState.value = { clientFeatures: ['mcq'], updateId: 'abc' }`: `Object.keys(JSON.parse(JSON.stringify(body)))` is exactly `['deviceId', 'clientPlatform', 'clientVersion', 'clientFeatures', 'updateId', 'events']`; `body.clientFeatures` `toEqual(['mcq'])`; `body.updateId` `toBe('abc')`; and `JSON.stringify(body.events)` equals the events built as in case 1 (the markers change nothing per event).
   3. `it('keeps an absent capability off the wire', …)` — `capsState.value = { updateId: 'abc' }`: serialised keys exactly `['deviceId', 'clientPlatform', 'clientVersion', 'updateId', 'events']`; the raw `JSON.stringify(body)` does not contain `clientFeatures` and does not contain `null` immediately after `"updateId":`.
   ~140 lines. This file, and only this file, mocks `../../src/sync/clientCapabilities`; the other progressSync suites run against the real module (whose dynamic import fails under node and yields `{}`).

Estimated size: `clientCapabilities.ts` ~70 lines; `progressSync.ts` +4; `ProgressEvents.cs` ~40 lines; `ProgressEventsSingleStatementTests.cs` +30; `ProgressEventsClientFeaturesTests.cs` ~150; the two mobile tests ~250 together.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C14.verify.sh` re-runs exactly these.

1. Scope files exist: `mobile/src/sync/clientCapabilities.ts`, `mobile/tests/unit/clientCapabilities.test.ts`, `mobile/tests/unit/progressSyncEnvelopeBytes.test.ts`, `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsClientFeaturesTests.cs`; prerequisites merged: `ProgressEvents.cs` contains `'card_format'` (C10) and `snowflake/001_content_intelligence_setup.sql` contains `as client_features`, `as update_id`, `as answer_mode` and `array_contains('mcq'::variant` (C13).
2. Literal guards (exit 0): `clientCapabilities.ts` has the four C00 exports verbatim, `export function normalizeClientFeatures(input: readonly unknown[]): string[]`, `MAX_CLIENT_FEATURES = 16`, `MAX_UPDATE_ID_LENGTH = 64`, the regex `^[a-z][a-z0-9_-]{0,31}$`, exactly one `import('expo-updates')`, no static `from 'expo-updates'`, no `require(`, no `from 'react`. `progressSync.ts`: the four lines are present at their anchors (import right after `:11`'s line; `caps` right after `const deviceId = await getDeviceId();`; `clientFeatures`/`updateId` right after `clientVersion: getClientVersion(),` and right before `events: batch.map(`); no other `expo-updates` / `clientCapabilities` mention. `ProgressEvents.cs`: `TryGetProperty("clientFeatures"`, `TryGetProperty("updateId"`, `private static string? ReadClientFeatures(JsonElement body)`, `private static string? ReadUpdateId(JsonElement body)`, `MaxClientFeatures = 16`, `MaxUpdateIdLength = 64`, `^[a-z][a-z0-9_-]{0,31}$`, `JsonValueKind.Array`, `SortedSet<string>(StringComparer.Ordinal)`; the four parameter lines `var featuresParam = P(ref idx);` / `parameters.Add(clientFeatures);` / `var updateIdParam = P(ref idx);` / `parameters.Add(updateId);` consecutive and after `parameters.Add(userIdHash);`; the three consecutive template lines `'deck_version', deck_version{cardFormatKey},` / `'client_features', {featuresParam}::jsonb,` / `'update_id', {updateIdParam}::text` (each exactly once, in that order, adjacent); C10's anchors intact (`string BuildIngestSql(bool withCardFormat)`, `BuildIngestSql(withCardFormat: true)`, `BuildIngestSql(withCardFormat: false)`, `'card_format', case when c.mcq is not null then 'mcq' else 'qa' end`, `from ins{cardFormatJoin}`, exactly one `catch (PostgresException`); the `insert into users (user_sub, email, last_seen_at, last_platform, last_version, last_device_id)` line is unchanged; no `alter table`, `information_schema`, `pg_attribute`, `to_regclass`, `BeginTransaction`. `ProgressEventsSingleStatementTests.cs`: the new `Batch()` signature lines and the two `body[...]` lines, the three pinned Fact names (`OneIngest_CostsOneStatement_AndNoTransactionShell`, `PreparedStatement_BindsNullAndNonNullParametersAlike`, `OneIngest_WithClientFeaturesAndUpdateId_IsStillOneStatement`). `ProgressEventsClientFeaturesTests.cs`: `[Collection(PostgresCollection.Name)]`, the six Fact names of change 6, `analytics_event_outbox`. Mobile tests: the nine `it('…'` titles of change 7 and the three of change 8; `from 'fast-check'` + `fc.assert(` in `clientCapabilities.test.ts`; `vi.mock('../../src/sync/clientCapabilities'`, `JSON.stringify(body)` and `'ladder-v1'` in `progressSyncEnvelopeBytes.test.ts`. No `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in any scope file. OTA guard: `mobile/package.json`/`package-lock.json`/`app.json`/`eas.json` unchanged against the base, `"expo-updates": "~29.0.15"`, `"vite": "7.2.4"`, `"version": "1.6.0"` present, no `@sentry` under `mobile/src`. Banned-term grep over the added lines of the scope files finds nothing.
3. `cd mobile && npm run test:typecheck` — exit 0.
4. `cd mobile && npx vitest run tests/unit/clientCapabilities.test.ts tests/unit/progressSyncEnvelopeBytes.test.ts tests/unit/progressSyncDropCounter.test.ts tests/unit/progressSyncPendingAdoption.test.ts tests/unit/progressSyncPullPagination.test.ts tests/unit/progressSyncPullTriggers.test.ts tests/unit/progressSyncQueueRace.test.ts --reporter=dot` — exit 0 (the five pre-existing suites prove the static import of the new module and the real `expo-updates` failure path cost them nothing). Then, with Docker running, `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~ProgressEventsClientFeaturesTests|FullyQualifiedName~ProgressEventsSingleStatementTests"` — exit 0.
5. Scope + frozen guard: `git diff --numstat <merge-base> HEAD -- mobile/src/sync/progressSync.ts` prints `4	0	mobile/src/sync/progressSync.ts` and the four `+` lines match the regexes of change 3 in order; `git diff --quiet <merge-base> HEAD -- mobile/src/content/deckRepository.ts mobile/src/review/model.ts`; `ProgressEventsSingleStatementTests.cs` has at most one removed line and it is `    string? clientPlatform = "ios")`; `git diff --name-only` ∪ the pathspec-scoped untracked scan (`mobile/src mobile/tests src_C/Vpc src_C/Worker src_C/Tests src_C/Shared snowflake docs frontend/src frontend/tests`) contains only the seven scope files and `docs/delivery/r16-issues/*`.

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C14.verify.sh
```
(cwd = worktree root; Docker daemon running; no network, no `npm install`, no `dotnet restore`; mobile part ~1 min, server part single-digit minutes.) The driver then runs the full per-root gates on top — mobile `npm run test:typecheck && npx vitest run`; src_C `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` — plus its own diff-scoped banned-term and suppression scans. Every progressSync suite and `ProgressEventsIntegrationTests` / `ProgressEventsCardFormatTests` must still be green there without any edit from you.

## Do NOT

- Do NOT add a static `import … from 'expo-updates'` anywhere (not in `progressSync.ts`, not in the new module); do NOT `require(` it; do NOT mock it in any existing test.
- Do NOT touch `snowflake/*` (C13), `docs/*.md` (C15), migrations, `users`, `NormalizedEvent`, the per-event VALUES row, `OutboxPublisher.cs`, `ContentIntelligence.cs`, `mobile/src/config/featureFlags.ts` / `remoteConfig.ts`, `mobile/src/review/storage.ts`, `drawStateSync.ts`.
- Do NOT send `null` for either field, do NOT make them per-event, do NOT add an `eventType` or bump `schemaVersion`, do NOT put the markers on `ProgressEvent`.
- Do NOT add a fifth line to `progressSync.ts` (no comment, no blank line, no type annotation on `caps`, no reformat by a formatter — check `git diff --numstat` before you finish).
- Do NOT probe the database for a column, open a transaction, or issue a second statement; do NOT edit F5/F7 or any existing assertion in `ProgressEventsSingleStatementTests.cs`; do NOT edit `ProgressEventsIntegrationTests.cs` or `ProgressEventsCardFormatTests.cs`.
- Do NOT change `mobile/package.json`, `package-lock.json`, `app.json`, `eas.json`, `tsconfig.json`, `vitest.config.ts`, `tests/setup/*`.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy / EAS / `expo prebuild`, no `npm install` / `npm ci` / `dotnet restore`, no test gutting (no `.skip`, no `@ts-ignore`, no `eslint-disable`), and none of the six banned terms in any added line.
