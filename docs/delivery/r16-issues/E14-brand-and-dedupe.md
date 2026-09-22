# E14 — brand strings, duplicate deletion, timeout chain (`brand-and-dedupe`)

Rename the seven user-visible `RecallSmith` strings of the console (`<title>`, four `ConsoleShell` titles, the login subtitle, the default deck author) and the root `README.md` title to `DeveloperCards`, with the eight test lines that pin them; delete the three dead/duplicate copies of the server code (`src_C/Common/` + the root `src_C/RecallSmith.Lambda.csproj`, and the second connection pool `src_C/Vpc/Db/Pg.cs` + `DbUtil.cs`) so `core-vpc` has ONE Npgsql data source, re-pointing the six files that resolved the duplicate; align `Npgsql` to `10.0.0` in the two Shared projects; and close the request timeout chain — `CommandTimeout = 20` on the shared connection string, a per-invocation `RequestDeadline` token derived from `ILambdaContext.RemainingTime - 2 s` that `DbUtil` hands to every statement, and a `503 DEADLINE` (`retry-after: 5`) answer when the deadline cancels a statement. The API envelope and log lines carry no brand string today and are not touched (`Res.cs:25` `API_VERSION ?? "v1"` unchanged). Roots: `frontend` + `src_C` (+ `README.md:1` + one three-line registration in a dated doc). No `infra/`, no `mobile/`, no Terraform plan, no allow-list file.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`). Every line below was read on that tree on 2026-09-22; the live AWS facts the same day with `AWS_PROFILE=dev` (account `622994489535`, `ap-southeast-2`, describe/get only). `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding: §0 (`:9-35`) non-negotiables, §1.2 (`:71-108`) file map, §2.14 (`:391-405`) this issue's contract, §2.16 (`:411-413`) the `VpcFunction.cs` regions, §3.3 (`:436-438`) the test contract, §4 (`:463`) E14 merges after E13, §5 (`:470-480`) verify conventions, §6 #4 (`:489`) "EMF namespace flips in E04, not E14". Review: `docs/backend-architecture-review-2026-09-22.md` §2.2.7 (`:111`, timeout chain), §2.4.7 (`:138`, brand map), §3 rows `:213` and `:217`, §5 `:297` (the identifiers that must never change).

What the tree looks like today:

- **Brand strings (console + README).** Case-sensitive `grep -rn RecallSmith frontend/index.html frontend/src frontend/tests README.md` finds exactly: `frontend/index.html:17` `<title>RecallSmith Console</title>`; `frontend/src/pages/LoginPage.tsx:38` `RecallSmith Authoring Console`; `frontend/src/pages/DeckEditPage.tsx:301` and `frontend/src/pages/AdminUsersPage.tsx:401,424` `title="RecallSmith Console"`; `frontend/src/pages/NewDeckPage.tsx:56` `author: 'RecallSmith Team',` and `:256` `placeholder="RecallSmith Team"`; the tests that pin them `frontend/tests/uiLanguage.test.ts:157` (`/<title>RecallSmith Console<\/title>/`), `frontend/tests/deckFormFieldDrop.test.tsx:113` (`getByPlaceholderText('RecallSmith Team')`), `frontend/tests/newDeckPage.test.tsx:90,104,129,158,417,423` (`'RecallSmith Team'`, `:417` with surrounding spaces); `README.md:1` `# RecallSmith`. Everything else that matches stays by E00 §2.14 ("exhaustive"): `frontend/src/gacha/rarityConfig.ts:2` (comment), `frontend/tests/e2e/authoringConsole.spec.ts:10,21` (comments), `README.md:68,137,309` (the test project's path) and `:304` (prose E15 owns; E00's map names only line 1), the lowercase `frontend/src/lib/sessionCache.ts:42` `'recallsmith/v1/'` (sessionStorage prefix), every C# namespace/assembly (`src_C/Vpc/RecallSmith.Lambda.Vpc.csproj:8-9`), the handler strings (`src_C/package_lambda_zip.sh:30-31,82-83`), bundle id / scheme / EAS slug / `recallsmith:` AsyncStorage keys in `mobile/`, AWS resource names, dated docs. `frontend/tests/__snapshots__` holds no brand string.
- **Server-side brand strings.** `grep -rn '"RecallSmith[" /]' src_C/Vpc src_C/Shared src_C/Worker src_C/Public --include='*.cs'` (excluding `obj/`) hits only `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs:42` `DefaultNamespace = "RecallSmith"` — which **E04** flips together with `RouteMetricsTests.cs:39,389,394` (E00 §6 #4). The envelope's `version` is `API_VERSION ?? "v1"` (`Res.cs:25`), the log `lambda` field is `"core-vpc"` (`VpcFunction.cs:12`), the worker logs `[JobId=…]`, the webhook `tag = "rc-webhook"`: no brand anywhere. E14 therefore changes nothing in the API version header or log fields; the verify pins that the literal is absent after E04.
- **Three copies of the server code, two of them compiled.** (1) `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs` + `DbUtil.cs` (namespace `RecallSmith.Lambda.Db`) is canonical: `MaxAutoPrepare` (`Pg.cs:57-90`), cancellable `OpenConnectionOrNullAsync(CancellationToken)` (`:122-147`); referenced by Vpc, Worker and Tests through `ProjectReference`. (2) `src_C/Vpc/Db/Pg.cs` + `src_C/Vpc/Db/DbUtil.cs` (namespace `RecallSmith.Lambda.Vpc.Db`, `:4`) are compiled by the Vpc csproj's default `**/*.cs` glob; `diff` against the Shared copies shows only the namespace line, the missing `MaxAutoPrepare` block and the missing cancellable overload (`DbUtil.cs`: the namespace line and one trailing blank line). Its own static `NpgsqlDataSource` is the **second pool** that `src_C/Vpc/SnapStartHooks.cs:67-73` resets by hand (`Vpc.Db.Pg.Reset()` `:73`, after the canonical `Pg.Reset()` `:65`). (3) `src_C/Common/` (9 files: `AssemblyInfo.cs`, `Auth.cs`, `LambdaRequest.cs`, `Log.cs`, `Res.cs`, `RouteMatcher.cs`, `SnapStartHooks.cs`, `SqlUtil.cs`, `Validation.cs`) + the root `src_C/RecallSmith.Lambda.csproj` (24 lines, default glob over the whole tree): not in `src_C/RecallSmith.Lambda.sln` (`:8-24` lists Shared ×2, Vpc, Worker, Public, Tests), not packaged (`src_C/package_lambda_zip.sh:5-7` builds Public/Vpc/Worker), not tested (`.github/workflows/ci.yml:166-168` names the root csproj as the reason `dotnet test` must name the test project). Dead; its presence is also why `dotnet build` in `src_C` without naming the `.sln` fails with MSB1011 today. (The comment at `.github/workflows/ci.yml:164-167` that explains the pin will read as history after the deletion; `ci.yml` is E11's file (`workflow_call:` line only) and is not touched here — a post-wave comment chore.)
- **Who resolves the duplicate.** Files in namespace `RecallSmith.Lambda.Vpc.Db` resolve the bare names `Pg`/`DbUtil` to copy (2): `src_C/Vpc/Db/Migrate.cs` (`using static RecallSmith.Lambda.Vpc.Db.DbUtil;` `:4`; `Pg.OpenConnectionOrNullAsync()` at `:118,145,201,238,276,314`; bare `ExecuteAsync`/`QueryAsync`/`ExecuteScalarAsync` throughout), `QueryPremiumState.cs` (`:18` `Pg.`, `:38` `DbUtil.QueryAsync`), `QueryRcEvents.cs` (`:15`, `:25`), `ContentIntelligenceDemo.cs` (`:3` static using, `:56` `Pg.`, `:65-79` bare calls). `Netcheck.cs` shares the namespace but never touches `Pg`/`DbUtil` (only `PGHOST`, `:42-47`) — it needs no edit. Two files outside the namespace import the duplicate's statics while already using the shared `Pg`: `src_C/Vpc/Analytics/OutboxPublisher.cs:10-11` and `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs:10-11` (`using RecallSmith.Lambda.Db;` then `using static RecallSmith.Lambda.Vpc.Db.DbUtil;`). One test reaches the second pool by alias: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/DbWarmupTests.cs:6` `using VpcDb = RecallSmith.Lambda.Vpc.Db;`, `:349` `var adminPoolBefore = VpcDb.Pg.DataSource();`, `:362-363` (comment), `:365` `Assert.NotSame(adminPoolBefore, VpcDb.Pg.DataSource());`. Nothing else in `src_C` names `RecallSmith.Lambda.Vpc.Db.DbUtil`, `Vpc.Db.Pg` or `VpcDb`.
- **Npgsql drift.** `src_C/Shared/RecallSmith.Lambda.Common/RecallSmith.Lambda.Common.csproj:17` and `src_C/Shared/RecallSmith.Lambda.Db/RecallSmith.Lambda.Db.csproj:10` pin `Npgsql 8.0.5`; `src_C/Vpc/RecallSmith.Lambda.Vpc.csproj:21` and `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RecallSmith.Lambda.IntegrationTests.csproj:16` pin `10.0.0` (the root csproj too). NuGet resolves the graph to 10.0.0 already; `~/.nuget/packages/npgsql/` holds `8.0.4`, `8.0.5`, `10.0.0`, so the alignment restores from the local cache (no network). `~/.nuget/packages/` has **no** `amazon.lambda.testutilities`; `Amazon.Lambda.Core 2.5.0` (`ILambdaContext`) is there and flows to the test project through the Vpc/Common `ProjectReference`s.
- **Timeout chain today.** API Gateway integrations `a9dzpce`, `ftkbtwn`, `q8lfdrr` → `core-vpc:prod` at `TimeoutInMillis 30000` (`apigatewayv2 get-integrations --api-id ktbq1sie2c`); `core-vpc:prod` is version 48, `Timeout 90`, `MemorySize 128`, `Handler RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler`, runtime `dotnet8` (`lambda get-function-configuration`); `worker-lambda:prod` version 4, 615 s. The shared connection string (`Pg.cs:88-104`) sets `Timeout` (connect) and `ConnectionIdleLifetime` but **no `CommandTimeout`** → Npgsql's default 30 s, longer than the gateway's 30 s. `DbUtil.QueryAsync` (`:8-30`), `ExecuteAsync` (`:32-40`), `ExecuteScalarAsync` (`:42-51`) call `ExecuteReaderAsync()` / `ReadAsync()` / `IsDBNullAsync(i)` / `ExecuteNonQueryAsync()` / `ExecuteScalarAsync()` with no token. `VpcFunction.Handler(JsonElement evt)` (`VpcFunction.cs:32-47`) takes no `ILambdaContext`; every handler's `catch (Exception ex)` ends in `res.Error500(ex)` (28 call sites in 17 files under `src_C/Vpc` + `src_C/Public`; `Res.Error500` itself at `Res.cs:179-202` logs `{level:"error",tag:"unhandled",…}` and answers `500 INTERNAL_ERROR`). Tests call the single-argument shape at `CardsPageTests.cs:525,535`, `AuthBearerTests.cs:68,188,225`, `CorsAllowlistTests.cs:242,257`, `RouteMetricsTests.cs:416,443,463`; `LambdaHost` (`IntegrationTestBase.cs:172-247`) calls route handlers directly, never `VpcFunction.Handler`.
- **The .NET Lambda runtime rejects handler overloads.** `Amazon.Lambda.RuntimeSupport/Bootstrap/UserCodeLoader.cs` (`aws/aws-lambda-dotnet`, `master`, read 2026-09-22): `FindCustomerMethodByName` calls `typeInfo.GetMethod(_handler.MethodName, Constants.DefaultFlags)`; a second public method with the same name makes that call throw `AmbiguousMatchException`, which the loader turns into `LambdaValidationException` (`Errors.UserCodeLoader.MethodHasOverloads`) — at INIT, on every cold start, for every route. There is no "prefer the `ILambdaContext` overload" rule; optional parameters are not inspected. The live handler string names `Handler` with no signature (`package_lambda_zip.sh:30,82`; the adopted `aws_lambda_function.core_vpc` keeps it, E00 §0 "no renames").
- **`docs/` path guard.** `frontend/tests/docsPaths.test.ts` (`:36-39` CITATION regex over fully-qualified backticked paths, `:41` `<!-- paths-not-on-disk … -->`, `:50-52` non-recursive walk of `docs/*.md`) is symmetric: every cited path must exist or be registered in that document's exemption block, and every registered path must not exist. `docs/backend-architecture-review-2026-09-22.md` cites `src_C/Vpc/Db/Pg.cs` (`:90`, as `…Pg.cs:30`), `src_C/Common/` (`:99`) and both `src_C/Vpc/Db/Pg.cs` / `src_C/Vpc/Db/DbUtil.cs` (`:217`); its exemption block is at `:310-313` (one entry, `docs/README.md`). No other `docs/*.md` and not `README.md` (`frontend/tests/rootReadmePaths.test.ts`) cites a file this issue deletes; `docs/delivery/**` is not walked.
- **Toolchain.** dotnet 8.0.413; Docker daemon up (Testcontainers `postgres:16-alpine`, cached); `frontend/node_modules` present (the driver symlinks it); `frontend/package.json` `lint` = `eslint .`, `build` = `tsc -b && vite build`.

What E00 decided (and what the tree adds to it — recorded here, binding for E14):

1. **E00 §2.14 brand map is exhaustive**; the EMF namespace and `RouteMetricsTests` belong to E04 (§6 #4); `snowflake/001…sql:1` belongs to E13. E14 does not open `RouteMetrics.cs`, `RouteMetricsTests.cs`, `snowflake/`.
2. **Overload → optional parameter.** §2.14 asks for `Handler(JsonElement evt, ILambdaContext ctx)` "with the single-argument overload kept for tests". Two methods named `Handler` would trip `MethodHasOverloads` (above) and take production down at the first cold start after deploy. Resolution: ONE method, `public async Task<APIGatewayProxyResponse> Handler(JsonElement evt, ILambdaContext? ctx = null)`. The runtime sees one method with two parameters (the second is `ILambdaContext`, the shape it expects) and passes both; every existing `fn.Handler(evt)` call site compiles unchanged; `ctx == null` means "no deadline" (tests, `DeadlineTokenTests` pins the single-method fact by reflection).
3. **The 503 mapping lives in `Res.Error500`.** §2.14 says "via `Res.Error500`'s existing catch"; §1.2 lists `Res.cs` under E07 only. With 28 per-handler `catch → res.Error500(ex)` sites, the only place a cancelled statement can become a 503 for every route is inside `Error500` itself. Resolution: E14 adds one guarded early return (≤ 8 added lines, 0 removed) at the top of `Error500`, using E07's `ServiceUnavailable(string code, string? message, int retryAfterSec)`; nothing else in `Res.cs` changes.
4. **`DbWarmupTests.cs` gets a bounded edit.** §1.2 says every other test file is byte-identical; the file references the class E14 deletes (`:6,349,365`), so it cannot compile unchanged. Resolution: delete exactly those three lines and replace the two-line comment `:362-363` by one line (numstat `1 5`); the eleven other assertions of the file, including both `Assert.NotSame(poolBefore, Pg.DataSource())`, stay.
5. **`TestLambdaContext` is written in-tree.** §1.2 says `IntegrationTestBase.cs` "passes a `TestLambdaContext`"; the NuGet package that ships one is absent from the cache and a worker has no network. Resolution: a 20-line `public sealed class TestLambdaContext : ILambdaContext` in `IntegrationTestBase.cs` (add-only) plus `LambdaHost.InvokeFunctionAsync(JsonElement evt, TimeSpan remainingTime)`.
6. **The review doc registers the three deleted paths.** Deleting them without the registration turns `docsPaths.test.ts` red (E00 §3.3 makes E14 run it). Resolution: three bullets appended inside the existing `<!-- paths-not-on-disk … -->` block at `docs/backend-architecture-review-2026-09-22.md:310-313` — the guard's own prescribed move ("register, once, a machine-checkable fact"); no prose changes; numstat `3 0`.
7. **`Netcheck.cs` stays byte-identical** (§2.14 lists it among the five namespace files; it never resolves `Pg`/`DbUtil`).
8. **`CommandTimeout` defaults to 20 and is env-overridable** (`PG_COMMAND_TIMEOUT`, `0` = unlimited), the same shape as every other knob of `Pg.cs` (`:48-55`, `:85-86`). No env file gains the key in this wave; the default is what ships.
9. **A deadline cancellation is still logged** by each handler's existing `Log.Error` before `Error500` maps it — accepted; no catch clause outside `Error500` changes (§2.16: E14 changes only the `Handler` signature in `VpcFunction.cs`).

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-35`), §1.2 (`:71-108`), §2.14 (`:391-405`), §2.16 (`:411-413`), §3.3 (`:436-438`), §5 (`:470-480`), §6 #4 (`:489`).
2. `docs/backend-architecture-review-2026-09-22.md` `:111` (§2.2.7), `:138` (§2.4.7), `:297`, and the exemption block `:310-313`.
3. `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs` whole file (148 lines) and `DbUtil.cs` whole file (72 lines); then `diff src_C/Vpc/Db/Pg.cs src_C/Shared/RecallSmith.Lambda.Db/Pg.cs` and the same for `DbUtil.cs`.
4. `src_C/Vpc/SnapStartHooks.cs:63-81`; `src_C/Vpc/Db/Migrate.cs:1-8`; `QueryPremiumState.cs:1-6`, `:18`, `:38`; `QueryRcEvents.cs:1-6`, `:15`, `:25`; `ContentIntelligenceDemo.cs:1-8`, `:56-79`; `src_C/Vpc/Analytics/OutboxPublisher.cs:1-13`; `ContentIntelligenceSnapshotImport.cs:1-13`.
5. `src_C/Vpc/VpcFunction.cs:1-47`, `:317-323`; `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:21-25`, `:100-137`, `:179-202` (and E07's `ServiceUnavailable` as merged).
6. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:1-9`, `:172-247`; `DbWarmupTests.cs:1-8`, `:318-376`; `RouteMetricsTests.cs:405-470` (how a whole-function test builds an event).
7. The five csproj files named under Context "Npgsql drift"; `src_C/RecallSmith.Lambda.sln:8-24`; `src_C/package_lambda_zip.sh:1-12`, `:82-83`.
8. `frontend/index.html:15-19`; the six `.tsx`/`.ts` lines of the brand map; `frontend/tests/docsPaths.test.ts:1-80`; `README.md:1-8`.

## Constraints

- **Scope (the ONLY files that may change):**
  1. `frontend/index.html` (1 line)
  2. `frontend/src/pages/AdminUsersPage.tsx` (2 lines), `DeckEditPage.tsx` (1), `LoginPage.tsx` (1), `NewDeckPage.tsx` (2)
  3. `frontend/tests/uiLanguage.test.ts` (1), `frontend/tests/deckFormFieldDrop.test.tsx` (1), `frontend/tests/newDeckPage.test.tsx` (6)
  4. `README.md` (line 1 only)
  5. `docs/backend-architecture-review-2026-09-22.md` (3 bullets appended inside the existing `paths-not-on-disk` block; nothing else)
  6. DELETE: `src_C/Common/` (all 9 files), `src_C/RecallSmith.Lambda.csproj`, `src_C/Vpc/Db/Pg.cs`, `src_C/Vpc/Db/DbUtil.cs`
  7. `src_C/Vpc/Db/Migrate.cs`, `QueryPremiumState.cs`, `QueryRcEvents.cs`, `ContentIntelligenceDemo.cs` (`using` lines only)
  8. `src_C/Vpc/Analytics/OutboxPublisher.cs`, `ContentIntelligenceSnapshotImport.cs` (the one `using static` line each)
  9. `src_C/Vpc/SnapStartHooks.cs` (remove the second-pool block)
  10. `src_C/Shared/RecallSmith.Lambda.Common/RecallSmith.Lambda.Common.csproj`, `src_C/Shared/RecallSmith.Lambda.Db/RecallSmith.Lambda.Db.csproj` (the `Npgsql` version attribute only)
  11. `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs`, `DbUtil.cs`
  12. `src_C/Shared/RecallSmith.Lambda.Common/RequestDeadline.cs` (new)
  13. `src_C/Shared/RecallSmith.Lambda.Common/Res.cs` (add-only, `Error500` head)
  14. `src_C/Vpc/VpcFunction.cs` (one `using`, the `Handler` signature, one statement)
  15. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` (add-only)
  16. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/DbWarmupTests.cs` (bounded, Changes 13)
  17. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/DeadlineTokenTests.cs` (new)
  Nothing else: no `infra/`, no `mobile/`, no `snowflake/`, no `.github/`, no `scripts/`, no `src_C/deploy.sh`, no `src_C/env/*`, no `.sln`, no `Vpc`/`Worker`/`Tests`/`Public` csproj, no `RouteMetrics.cs`, no `RouteMetricsTests.cs`, no `Log.cs`, no `Netcheck.cs`, no `src_C/Worker/**`, no other dated `docs/*.md`, no `infra/README.md` (E14 is not an infra issue).
- **WORKER SAFETY RULE (E00 §0, verbatim):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  For E14 this means: no AWS CLI is needed at all; never run `src_C/deploy.sh`, `frontend/deploy.sh`, `package_lambda_zip.sh` for real (`DRY_RUN=1` only if at all), never `aws lambda …`, never `terraform …`. The supervisor deploys after merge (Verify).
- **Frozen files (E00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **OTA rule:** nothing under `mobile/` changes; `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"`), `mobile/eas.json` stay byte-identical; no `@sentry/*` anywhere.
- **No new packages.** The only `.csproj` edits are the two `Npgsql` version attributes (`8.0.5` → `10.0.0`, already in the local cache). No `Amazon.Lambda.TestUtilities`, no `npm install`, no `dotnet restore` by hand, no network.
- **Names that never change** (review §5 `:297`, E00 §0): C# namespaces and assembly names (`RecallSmith.Lambda`, `RecallSmith.Lambda.Worker`, `RecallSmith.Lambda.IntegrationTests`), the handler strings, `com.timeawake.recallsmith`, the `recallsmith` scheme/EAS slug, `recallsmith:` storage keys, `'recallsmith/v1/'` (`sessionCache.ts:42`), AWS resource names, the `RecallSmith.Lambda.Vpc.Db` **namespace** (only the two duplicate classes go; `Migrate`, `QueryPremiumState`, `QueryRcEvents`, `ContentIntelligenceDemo`, `Netcheck` keep their namespace).
- **`VpcFunction.cs` region rule (E00 §2.16):** E14 touches the `using` block, the `Handler` signature and its first statement — nothing in `DispatchAsync`, no route block, no catch clause. E03/E06/E07/E12 have merged before E14: rebase onto their lines; expect the `:32-47` numbers to have drifted.
- **Tests that may change:** the three frontend test files (brand literal only, numstat 1/1, 1/1, 6/6); `IntegrationTestBase.cs` (add-only); `DbWarmupTests.cs` (exactly Changes 13); `DeadlineTokenTests.cs` (new). **Every other test file is byte-identical** — in particular `RouteMetricsTests.cs`, `AuthBearerTests.cs`, `CorsAllowlistTests.cs`, `CardsPageTests.cs` (they prove the single-argument call shape still compiles), `PublishJobProcessorSchemaTests.cs`, `JwtVerifierTests.cs`.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 (E00 §0 does not spell them; neither does this brief) — say "guard", "fallback", "work around", "probe". The two live env-var names E00 §0 calls unspellable are never written. No `[Fact(Skip = …)]` / `[Theory(Skip = …)]`, `#pragma warning disable`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff.
- **Never copy ExamTopics / SAA-C03 content.** Test fixtures use `"q"`, `select 1`, `pg_sleep`.
- **dotnet / Docker:** `dotnet build RecallSmith.Lambda.sln -c Release -nologo` from `src_C` restores implicitly from the local cache. The DB test classes need the Docker daemon (Testcontainers `postgres:16-alpine`, cached). Run targeted tests with `--filter "FullyQualifiedName~<Class>"`.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no `expo`, no `eas`, no `npm install`. Git only inside your worktree, never in `/Users/qc/src/recallsmith` or under `/Users/qc/Desktop`.

## Changes required

1. **Console + README brand strings (nine files, eighteen lines, all `RecallSmith` → `DeveloperCards`, nothing else on those lines):**
   - `frontend/index.html:17` → `    <title>DeveloperCards Console</title>`
   - `frontend/src/pages/AdminUsersPage.tsx:401,424` and `frontend/src/pages/DeckEditPage.tsx:301` → `title="DeveloperCards Console"`
   - `frontend/src/pages/LoginPage.tsx:38` → `<p className="text-xs text-slate-500 mt-1">DeveloperCards Authoring Console</p>`
   - `frontend/src/pages/NewDeckPage.tsx:56` → `    author: 'DeveloperCards Team',`; `:256` → `placeholder="DeveloperCards Team"`
   - `frontend/tests/uiLanguage.test.ts:157` → `expect(html()).toMatch(/<title>DeveloperCards Console<\/title>/);`
   - `frontend/tests/deckFormFieldDrop.test.tsx:113` → `screen.getByPlaceholderText('DeveloperCards Team')`
   - `frontend/tests/newDeckPage.test.tsx:90,104,129,158,423` → `'DeveloperCards Team'`; `:417` → `'  DeveloperCards Team  '` (keep the two spaces on each side — that case tests trimming)
   - `README.md:1` → `# DeveloperCards` (the paragraph `:3-7` and every other line untouched; E15 rewrites the body later and keeps this title)
   After this, `grep -rn RecallSmith frontend/index.html frontend/src frontend/tests/*.ts frontend/tests/*.tsx` returns only `frontend/src/gacha/rarityConfig.ts:2` (a comment; leave it).

2. **Register the deleted paths** in `docs/backend-architecture-review-2026-09-22.md`: inside the existing block at `:310-313`, after the bullet `- docs/README.md`, append exactly:
   ```
   - src_C/Common/
   - src_C/Vpc/Db/Pg.cs
   - src_C/Vpc/Db/DbUtil.cs
   ```
   No other line of the file changes (numstat `3 0`); the prose that cites them at `:90`, `:99`, `:217` stays as history.

3. **Delete the dead and duplicate copies** (`git rm`): `src_C/Common/` (all nine files), `src_C/RecallSmith.Lambda.csproj`, `src_C/Vpc/Db/Pg.cs`, `src_C/Vpc/Db/DbUtil.cs`. The `.sln` needs no edit (it never listed them). Do not create a replacement; do not move anything into `Shared`.

4. **Re-point the four namespace files to the shared classes:**
   - `src_C/Vpc/Db/Migrate.cs:4` `using static RecallSmith.Lambda.Vpc.Db.DbUtil;` → `using RecallSmith.Lambda.Db;` + `using static RecallSmith.Lambda.Db.DbUtil;` (two lines, keep alphabetical position after `using RecallSmith.Lambda.Common;`). Body untouched: the six `Pg.OpenConnectionOrNullAsync()` calls and the bare `ExecuteAsync`/`QueryAsync`/`ExecuteScalarAsync` calls now bind to `RecallSmith.Lambda.Db`.
   - `src_C/Vpc/Db/QueryPremiumState.cs` and `QueryRcEvents.cs`: add `using RecallSmith.Lambda.Db;` after `using RecallSmith.Lambda.Common;` (`:1`). Their `Pg.` (`:18` / `:15`) and `DbUtil.QueryAsync` (`:38` / `:25`) calls are otherwise unchanged.
   - `src_C/Vpc/Db/ContentIntelligenceDemo.cs:3` → `using RecallSmith.Lambda.Db;` + `using static RecallSmith.Lambda.Db.DbUtil;`.
   - `src_C/Vpc/Db/Netcheck.cs`: **no change**.

5. **Flip the two Analytics static imports:** `src_C/Vpc/Analytics/OutboxPublisher.cs:11` and `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs:11` become `using static RecallSmith.Lambda.Db.DbUtil;` (line 10 `using RecallSmith.Lambda.Db;` already there). One-line change each; E04/E12/E13's edits to these files are untouched.

6. **`src_C/Vpc/SnapStartHooks.cs`:** remove the second-pool comment and call (today `:67-73`, the seven lines from `// The second pool.` through `try { Vpc.Db.Pg.Reset(); } catch { /* best-effort */ }`) plus the blank line before them; `Pg.Reset()` (`:65`) and every other `Reset()` line (including E03's `ManifestBuilder.Reset()`) stay. Afterwards the file contains no `Vpc.Db.Pg`.

7. **Npgsql alignment:** `RecallSmith.Lambda.Common.csproj:17` and `RecallSmith.Lambda.Db.csproj:10` → `<PackageReference Include="Npgsql" Version="10.0.0" />`. No other attribute, no other package, no other csproj.

8. **`src_C/Shared/RecallSmith.Lambda.Common/RequestDeadline.cs` (new)** — verbatim shape (comments may be expanded, signatures may not change):
   ```csharp
   namespace RecallSmith.Lambda.Common;

   /// <summary>
   /// The per-invocation cancellation budget: ILambdaContext.RemainingTime minus a 2 s margin,
   /// opened by VpcFunction.Handler and read by DbUtil for every statement. Unset (tests, the
   /// worker, INIT-phase warmup) it is CancellationToken.None, which never cancels.
   /// </summary>
   public static class RequestDeadline
   {
     private static readonly AsyncLocal<CancellationToken> Current = new();

     /// <summary>CancellationToken.None when no scope is active.</summary>
     public static CancellationToken Token => Current.Value;

     /// <summary>
     /// Opens a scope whose token cancels after <paramref name="budget"/> — immediately when the
     /// budget is zero or negative. Dispose restores the previous token.
     /// </summary>
     public static Scope Set(TimeSpan budget)
     {
       var cts = new CancellationTokenSource();
       if (budget <= TimeSpan.Zero) cts.Cancel(); else cts.CancelAfter(budget);
       var previous = Current.Value;
       Current.Value = cts.Token;
       return new Scope(cts, previous);
     }

     public sealed class Scope : IDisposable
     {
       private readonly CancellationTokenSource _cts;
       private readonly CancellationToken _previous;
       private int _disposed;

       internal Scope(CancellationTokenSource cts, CancellationToken previous)
       {
         _cts = cts;
         _previous = previous;
       }

       public void Dispose()
       {
         if (Interlocked.Exchange(ref _disposed, 1) == 1) return;
         Current.Value = _previous;
         _cts.Dispose();
       }
     }
   }
   ```
   `AsyncLocal`, `CancellationToken`, `Interlocked` come from `ImplicitUsings`. No `Console`, no env read, no static mutable state other than the `AsyncLocal`.

9. **`src_C/Shared/RecallSmith.Lambda.Db/Pg.cs`:** after the `PG_MAX_AUTO_PREPARE` pair (`:85-86`) add
   ```csharp
      // Statement cap. 20 s sits under the 30 s API Gateway integration timeout so a slow query
      // answers 503 (RequestDeadline) instead of a gateway 504; PG_COMMAND_TIMEOUT=0 lifts it for a
      // one-off heavy migration, the same escape hatch PG_MAX_AUTO_PREPARE=0 gives auto-prepare.
      var cmdTimeoutRaw = Environment.GetEnvironmentVariable("PG_COMMAND_TIMEOUT");
      var commandTimeout = int.TryParse(cmdTimeoutRaw, out var ctm) && ctm >= 0 ? ctm : 20;
   ```
   and inside the `NpgsqlConnectionStringBuilder` initializer (`:88-104`), directly after `MaxAutoPrepare = autoPrepare,`, the line `CommandTimeout = commandTimeout,`. Nothing else in the file changes (the cancellable `OpenConnectionOrNullAsync` overload stays as is).

10. **`src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs`:** each of the three public execution methods captures the deadline once and passes it to every awaited Npgsql call:
    - `QueryAsync` (`:8-30`): first statement `var ct = RequestDeadline.Token;`; `cmd.ExecuteReaderAsync(ct)`, `reader.ReadAsync(ct)`, `reader.IsDBNullAsync(i, ct)`.
    - `ExecuteAsync` (`:32-40`): `var ct = RequestDeadline.Token;` then `cmd.ExecuteNonQueryAsync(ct)`.
    - `ExecuteScalarAsync` (`:42-51`): `var ct = RequestDeadline.Token;` then `cmd.ExecuteScalarAsync(ct)`.
    `CreateCommand` (`:53-71`) and the parameter naming are untouched; `using RecallSmith.Lambda.Common;` (`:2`) already resolves `RequestDeadline`. With no scope the token is `None` and Npgsql behaves exactly as before.

11. **`src_C/Vpc/VpcFunction.cs`:**
    - `using` block: add `using Amazon.Lambda.Core;` after `using Amazon.Lambda.APIGatewayEvents;` (`:2`).
    - Signature `:32` becomes exactly `public async Task<APIGatewayProxyResponse> Handler(JsonElement evt, ILambdaContext? ctx = null)`. It is the **only** method named `Handler` in the class — never add a second one (Context: `MethodHasOverloads`).
    - First statement of `Handler`, above E12's internal-event branch and above `var req = new LambdaRequest(evt);`:
      ```csharp
      // One deadline per invocation: RemainingTime less a 2 s margin, so a slow statement is
      // cancelled and answered (503 DEADLINE) while there is still time to write the response.
      // ctx is null only when a test calls Handler(evt) directly -- then nothing cancels.
      using var deadline = ctx is null ? null : RequestDeadline.Set(ctx.RemainingTime - TimeSpan.FromSeconds(2));
      ```
    Nothing else: `DispatchAsync`, the route blocks, the `catch` at the end (`:317-321`) and the boot log are not touched.

12. **`src_C/Shared/RecallSmith.Lambda.Common/Res.cs` — `Error500` head (add-only):** as the first statements of `Error500(Exception? ex)` (`:179`), before the existing `if (ex is not null)` log block:
    ```csharp
    // A statement cancelled by the request deadline (RequestDeadline, from ILambdaContext.RemainingTime)
    // is not an unhandled error: answer 503 with a short retry-after so the client retries against a
    // fresh budget. Any other cancellation (no deadline set, or set but not yet expired) stays a 500.
    if (ex is OperationCanceledException && RequestDeadline.Token.IsCancellationRequested)
      return ServiceUnavailable("DEADLINE", null, 5);
    ```
    `ServiceUnavailable(string code, string? message, int retryAfterSec)` is E07's helper (E00 §2.7), merged before E14. No other line of `Res.cs` changes; `_apiVersion` (`:25`) stays `API_VERSION ?? "v1"`.

13. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/DbWarmupTests.cs` (bounded):** delete line `:6` (`using VpcDb = RecallSmith.Lambda.Vpc.Db;`), line `:349` (`var adminPoolBefore = VpcDb.Pg.DataSource();`) and line `:365` (`Assert.NotSame(adminPoolBefore, VpcDb.Pg.DataSource());`); replace the two comment lines `:362-363` by the single line
    ```csharp
        // 1. Invalidated. One pool since E14: the Vpc/Db duplicate of Pg (and its own data source) is gone.
    ```
    Everything else byte-identical: numstat `1 5`; `Assert.NotSame(poolBefore, Pg.DataSource());` still appears twice (`:329`, `:364`); every `[Fact]` name unchanged.

14. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` (add-only):**
    - `using Amazon.Lambda.Core;` added to the `using` block (`:1-7`): after the three `System.*` lines, before `using Npgsql;` (the file's convention — `System` first, then alphabetical, as `VpcFunction.cs:1-3`).
    - After the `LambdaHost` class (end of file), append:
      ```csharp
      /// <summary>
      /// The ILambdaContext the deadline tests hand to VpcFunction.Handler. Amazon.Lambda.TestUtilities is
      /// not in the local NuGet cache and workers have no network, so the one member the handler reads
      /// (RemainingTime) is real and the rest are inert placeholders.
      /// </summary>
      public sealed class TestLambdaContext : ILambdaContext
      {
        public TestLambdaContext(TimeSpan remainingTime) { RemainingTime = remainingTime; }
        public TimeSpan RemainingTime { get; }
        public string AwsRequestId { get; } = Guid.NewGuid().ToString();
        public string FunctionName => "core-vpc";
        public string FunctionVersion => "$LATEST";
        public string InvokedFunctionArn => "arn:aws:lambda:ap-southeast-2:000000000000:function:core-vpc";
        public string LogGroupName => "/aws/lambda/core-vpc";
        public string LogStreamName => "test";
        public int MemoryLimitInMB => 128;
        public IClientContext ClientContext => null!;
        public ICognitoIdentity Identity => null!;
        public ILambdaLogger Logger => null!;
      }
      ```
    - Inside `LambdaHost`, after `GetProgressAsync` (`:192-199`), add:
      ```csharp
      /// <summary>The whole function the way the Lambda runtime calls it: event plus context.</summary>
      public static Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> InvokeFunctionAsync(JsonElement evt, TimeSpan remainingTime) =>
        new VpcFunction().Handler(evt, new TestLambdaContext(remainingTime));
      ```
    No existing line changes (numstat removed = 0).

15. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/DeadlineTokenTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, `public class DeadlineTokenTests`, constructor `(PostgresFixture db)`; usings `System.Diagnostics`, `System.Reflection`, `System.Text.Json`, `Amazon.Lambda.Core`, `Npgsql`, `RecallSmith.Lambda.Common`, `RecallSmith.Lambda.Db`. Helper `HealthEvent()` = `JsonSerializer.SerializeToElement(new { rawPath = "/health", requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "GET" } }, headers = new Dictionary<string, string>(), queryStringParameters = new Dictionary<string, string>(), isBase64Encoded = false })`. Cases, names verbatim, each `[Fact]`:
    1. `Token_WithoutScope_IsNone` — `Assert.Equal(CancellationToken.None, RequestDeadline.Token)`; `Assert.False(RequestDeadline.Token.CanBeCanceled)`.
    2. `Set_Token_CancelsAfterBudget` — `using var s = RequestDeadline.Set(TimeSpan.FromMilliseconds(50));` token `CanBeCanceled` and not yet cancelled; `await Task.Delay(500)`; `IsCancellationRequested` true.
    3. `Set_NonPositiveBudget_IsCancelledImmediately` — `Set(TimeSpan.Zero)` and `Set(TimeSpan.FromSeconds(-1))` → `IsCancellationRequested` true with no delay.
    4. `Scope_Dispose_RestoresPreviousToken` — nested: outer `Set(10 s)`, inner `Set(10 s)`, inner token differs from outer; after inner `Dispose()` the current token equals the outer; after outer `Dispose()` it is `None`. Double `Dispose()` does not throw.
    5. `Set_FlowsToAwaitedCalls_NotToTheCaller` — `await Task.Run(async () => { using var s = RequestDeadline.Set(TimeSpan.FromSeconds(10)); await Task.Yield(); return RequestDeadline.Token.CanBeCanceled; })` is true; afterwards the caller's `RequestDeadline.Token.CanBeCanceled` is false.
    6. `Handler_WithContext_AnswersHealth_AndLeavesNoTokenBehind` — `LambdaHost.InvokeFunctionAsync(HealthEvent(), TimeSpan.FromSeconds(30))` → `StatusCode == 200`, body `data.ok == true`; afterwards `RequestDeadline.Token.CanBeCanceled` is false.
    7. `Handler_WithoutContext_StillAnswers` — `await new VpcFunction().Handler(HealthEvent())` → 200 (the call shape every pre-existing test uses).
    8. `Handler_IsTheOnlyMethodNamedHandler` — `typeof(VpcFunction).GetMethods(BindingFlags.Public | BindingFlags.Instance).Where(m => m.Name == "Handler")` has exactly one element; its parameters are `[typeof(JsonElement), typeof(ILambdaContext)]` and the second `IsOptional`. (Pins the runtime's no-overload rule.)
    9. `QueryAsync_UnderExpiredDeadline_ThrowsOperationCanceled_Fast` — open `Pg.OpenConnectionOrNullAsync()` (not null); `using var s = RequestDeadline.Set(TimeSpan.FromMilliseconds(300));` `Stopwatch`; `await Assert.ThrowsAnyAsync<OperationCanceledException>(() => DbUtil.QueryAsync(conn!, null, "select pg_sleep(20)", []))`; elapsed `< 5000 ms`.
    10. `ExecuteScalarAsync_WithoutScope_Runs` — no scope; `DbUtil.ExecuteScalarAsync(conn!, null, "select 1", [])` returns `1`.
    11. `DataSource_CommandTimeout_Is20` — `new NpgsqlConnectionStringBuilder(Pg.DataSource()!.ConnectionString).CommandTimeout == 20`.
    12. `Error500_OperationCanceled_UnderCancelledDeadline_Is503Deadline` — `using var s = RequestDeadline.Set(TimeSpan.Zero);` `var r = new Res("t-1").Error500(new OperationCanceledException());` → `StatusCode == 503`, body `error.code == "DEADLINE"`, `success == false`, `r.Headers["retry-after"] == "5"`.
    13. `Error500_OperationCanceled_WithoutDeadline_Stays500` — no scope → `500`, `error.code == "INTERNAL_ERROR"`.
    14. `Error500_OperationCanceled_UnexpiredDeadline_Stays500` — `Set(TimeSpan.FromSeconds(30))` (not expired) → `500`.
    Each DB case opens its own connection (`await using`), none depends on order; the class needs Docker like every `PostgresCollection` class.

Estimated size: frontend 18 lines changed; README 1; review doc +3; deletions 13 files; usings 8 lines; SnapStartHooks −8; csproj 2; `RequestDeadline.cs` ~45; `Pg.cs` +6; `DbUtil.cs` +3/±5; `VpcFunction.cs` +5/−1; `Res.cs` +6; `IntegrationTestBase.cs` +28; `DbWarmupTests.cs` +1/−5; `DeadlineTokenTests.cs` ~180.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E14.verify.sh` re-runs exactly these.

1. Scope files exist / are gone (exit 0): `RequestDeadline.cs` and `DeadlineTokenTests.cs` exist; `src_C/Common`, `src_C/RecallSmith.Lambda.csproj`, `src_C/Vpc/Db/Pg.cs`, `src_C/Vpc/Db/DbUtil.cs` do not exist and are not tracked. Prerequisites from earlier merges: `Res.cs` contains `ServiceUnavailable(string code` (E07); `RouteMetrics.cs` contains `DefaultNamespace = "DeveloperCards"` (E04).
2. Literal guards (exit 0):
   - Brand: `<title>DeveloperCards Console</title>` in `frontend/index.html`; `title="DeveloperCards Console"` ×2 in `AdminUsersPage.tsx`, ×1 in `DeckEditPage.tsx`; `DeveloperCards Authoring Console` in `LoginPage.tsx`; `author: 'DeveloperCards Team',` and `placeholder="DeveloperCards Team"` in `NewDeckPage.tsx`; `/<title>DeveloperCards Console<\/title>/` in `uiLanguage.test.ts`; `getByPlaceholderText('DeveloperCards Team')` in `deckFormFieldDrop.test.tsx`; `'DeveloperCards Team'` ×5 and `'  DeveloperCards Team  '` ×1 in `newDeckPage.test.tsx`; `README.md` line 1 is `# DeveloperCards`; `grep -rn RecallSmith frontend/index.html frontend/src frontend/tests/*.ts frontend/tests/*.tsx` matches only `frontend/src/gacha/rarityConfig.ts:2`; numstat `1 1` for `index.html`, `LoginPage.tsx`, `DeckEditPage.tsx`, `uiLanguage.test.ts`, `deckFormFieldDrop.test.tsx`, `README.md`; `2 2` for `AdminUsersPage.tsx`, `NewDeckPage.tsx`; `6 6` for `newDeckPage.test.tsx`.
   - Server brand: `grep -rn '"RecallSmith[" /]' src_C/Vpc src_C/Shared src_C/Worker src_C/Public --include='*.cs'` (no `obj/`) is empty.
   - Review doc: the `paths-not-on-disk` block contains `- src_C/Common/`, `- src_C/Vpc/Db/Pg.cs`, `- src_C/Vpc/Db/DbUtil.cs`; numstat `3 0`.
   - Duplicates: `grep -rn 'RecallSmith\.Lambda\.Vpc\.Db\.DbUtil\|Vpc\.Db\.Pg\b\|VpcDb' src_C --include='*.cs'` (no `obj/`/`bin/`) is empty; `using RecallSmith.Lambda.Db;` in `Migrate.cs`, `QueryPremiumState.cs`, `QueryRcEvents.cs`, `ContentIntelligenceDemo.cs`; `using static RecallSmith.Lambda.Db.DbUtil;` in `Migrate.cs`, `ContentIntelligenceDemo.cs`, `OutboxPublisher.cs`, `ContentIntelligenceSnapshotImport.cs`; `Netcheck.cs` zero-diff; `SnapStartHooks.cs` still has `Pg.Reset()`.
   - Npgsql: both Shared csproj contain `<PackageReference Include="Npgsql" Version="10.0.0" />`; no csproj contains `Npgsql" Version="8`.
   - `Pg.cs`: `PG_COMMAND_TIMEOUT`, `: 20;`, `CommandTimeout = commandTimeout,` (the latter directly after `MaxAutoPrepare = autoPrepare,`).
   - `DbUtil.cs`: `var ct = RequestDeadline.Token;` ×3; `ExecuteReaderAsync(ct)`, `ReadAsync(ct)`, `IsDBNullAsync(i, ct)`, `ExecuteNonQueryAsync(ct)`, `ExecuteScalarAsync(ct)`; no `ExecuteReaderAsync()` / `ExecuteNonQueryAsync()` / `ExecuteScalarAsync()` / `ReadAsync()` left.
   - `RequestDeadline.cs`: `namespace RecallSmith.Lambda.Common;`, `public static class RequestDeadline`, `AsyncLocal<CancellationToken>`, `public static CancellationToken Token`, `public static Scope Set(TimeSpan budget)`, `public sealed class Scope : IDisposable`, `cts.CancelAfter(budget)`.
   - `VpcFunction.cs`: `using Amazon.Lambda.Core;`; exactly one line matching `Handler(` in a method signature and it is `public async Task<APIGatewayProxyResponse> Handler(JsonElement evt, ILambdaContext? ctx = null)`; `RequestDeadline.Set(ctx.RemainingTime - TimeSpan.FromSeconds(2))`; `res.Error500(ex)` still present in the final catch.
   - `Res.cs`: `if (ex is OperationCanceledException && RequestDeadline.Token.IsCancellationRequested)` and `return ServiceUnavailable("DEADLINE", null, 5);`; numstat removed = 0, added ≤ 8; `?? "v1"` still on the `_apiVersion` line.
   - `IntegrationTestBase.cs`: `public sealed class TestLambdaContext : ILambdaContext`, `InvokeFunctionAsync(JsonElement evt, TimeSpan remainingTime)`, `using Amazon.Lambda.Core;`; numstat removed = 0.
   - `DbWarmupTests.cs`: numstat `1 5`; `Assert.NotSame(poolBefore, Pg.DataSource());` ×2; no `VpcDb`.
   - `DeadlineTokenTests.cs`: `[Collection(PostgresCollection.Name)]` and all fourteen method names of Changes 15.
   - No `Skip =`, `#pragma warning disable`, `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in either new file or in any added line (the pre-existing `eslint-disable-next-line` at `AdminUsersPage.tsx:187` is not touched and not scanned); no secret-shaped `NAME = "value"` in added lines.
3. Gates (exit 0): `cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo` (also proves `Public` still compiles without `src_C/Common`); `cd frontend && npm run lint && npm run build`.
4. Targeted tests (exit 0, Docker running): `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Release --no-build --nologo --filter "FullyQualifiedName~DeadlineTokenTests|FullyQualifiedName~DbWarmupTests|FullyQualifiedName~RouteMetricsTests|FullyQualifiedName~AuthBearerTests|FullyQualifiedName~CorsAllowlistTests|FullyQualifiedName~CardsPageTests"`; `cd frontend && npx vitest run tests/uiLanguage.test.ts tests/deckFormFieldDrop.test.tsx tests/newDeckPage.test.tsx tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot`.
5. Scope + frozen + OTA + apply guard (exit 0): `git diff --name-only <merge-base>` ∪ pathspec-scoped untracked scan of `src_C frontend/src frontend/tests frontend/index.html README.md docs mobile/src mobile/tests snowflake infra .github site scripts` contains nothing outside the seventeen scope entries (+ `docs/delivery/r16-issues/`); the three frozen mobile files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, `RouteMetrics.cs`, `RouteMetricsTests.cs`, `Log.cs`, `Netcheck.cs`, the `.sln`, the Vpc/Worker/Tests/Public csproj, `src_C/Worker/**`, `src_C/deploy.sh`, `infra/**`, `snowflake/**` are zero-diff; `mobile/app.json` still says `"version": "1.6.1"`; no `@sentry` under `mobile/src`; no added non-comment line of any scope file matches `terraform +(apply|import)` or `aws +<service> +(create|update|delete|put)-`.

## Verify

```bash
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E14.verify.sh
```
Steps 1–2 are file/literal checks (seconds); step 3 builds the solution in Release (~2 min cold) and lints + builds the console (~1–2 min); step 4 starts one `postgres:16-alpine` container for the six server classes (single-digit minutes) and runs the five vitest files (~30 s). No AWS CLI, no Terraform, no plan (E14 owns no `.tf`; there is no `E14.plan-allow.json`). The driver then runs the root gates — `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (Docker) and `cd frontend && npm run lint && npx vitest run && npm run build` — plus its diff-scoped banned-term grep and suppression scan, so keep every other test class green.

**Supervisor after merge (never the worker):** `./src_C/deploy.sh` (E06's version, `ENV=prod`) → `aws lambda get-function-configuration --function-name core-vpc --qualifier prod --query Handler` still prints `RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler` → one cold `GET /health` through `https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com/health` returns 200 (a cold start proves the runtime resolved the single `Handler`; a `MethodHasOverloads` INIT failure would show here) → `frontend/deploy.sh` → `curl -s https://d12pfy1rhi3ekm.cloudfront.net/ | grep -F '<title>DeveloperCards Console</title>'` → the second `terraform plan` in `infra/envs/prod` is trivially empty (no `.tf` touched). No SSM, no Cognito, no CLI cleanup for this issue.

## Do NOT

- Do NOT add a second method named `Handler` to `VpcFunction` (overload, `HandlerAsync` + `Handler`, an interface default, anything) — one method, optional `ILambdaContext? ctx = null`. Do NOT change the handler string, the assembly name or any C# namespace.
- Do NOT touch `RouteMetrics.cs`, `RouteMetricsTests.cs` (E04), `snowflake/001…sql:1` (E13), `Log.cs`, `Netcheck.cs`, `src_C/Worker/**`, `Warmup.cs`, `Migrate.cs` beyond its `using` lines, `Res.cs` beyond the `Error500` head, `VpcFunction.cs` beyond the `using` block + signature + first statement.
- Do NOT rename `frontend/src/lib/sessionCache.ts:42` `'recallsmith/v1/'`, the `rarityConfig.ts:2` comment, the e2e spec comments, `README.md` beyond line 1, any dated `docs/*.md` prose (only the review's exemption block gains three bullets), `mobile/**`, AWS names.
- Do NOT add `Amazon.Lambda.TestUtilities` or any other package; do NOT change any csproj attribute other than the two `Npgsql` versions; do NOT edit the `.sln`.
- Do NOT put the 503 mapping in `DispatchAsync`'s catch or in individual handlers; do NOT map anything but `OperationCanceledException` under an expired deadline; do NOT change the `retry-after` (5) or the code (`DEADLINE`).
- Do NOT floor or clamp the budget in `RequestDeadline.Set` (non-positive cancels immediately); do NOT read env vars there; do NOT make `Token` throw when unset.
- Do NOT delete or rewrite any test in `DbWarmupTests.cs` beyond the three lines + one comment of Changes 13; do NOT edit `CardsPageTests.cs`, `AuthBearerTests.cs`, `CorsAllowlistTests.cs`, `RouteMetricsTests.cs`.
- Do NOT run `src_C/deploy.sh`, `frontend/deploy.sh`, `package_lambda_zip.sh`, `aws …`, `terraform …`, `eas …`, `npm install`, `dotnet restore`; do NOT run git in `/Users/qc/src/recallsmith` or under `/Users/qc/Desktop` — only inside your worktree.
