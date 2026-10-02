# F01 — r26 review fixes: server retire (fixes ledger)

Round r26x, wave s (issue #720). Base: `delivery/r26x-s`. Each finding was checked against the code first; the
supervisor decisions in the issue override the reviewers' alternative suggestions.

Gate: `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (full suite).

New tests fail on the base: they do not compile there, because `Migrate.IsDestructive`,
`Migrate.MigrationsDirOverride` and `AccountDeletion.DeleteOutboxRowsAsync` do not exist on the base. Behaviour on the
base, case by case, is stated under each finding.

### x-deploy-2

Status: fixed

Confirmed. `HandleDbMigrate` ran `foreach (var m in pending)` with no opt-in, so any migrate call with 045 pending
dropped the tables, whoever made it.

Fix (supervisor decision 1):
- `src_C/Vpc/Db/Migrate.cs`: `LoadMigrations` records `Destructive` from a `-- destructive: true` line in the file's
  leading comment block (`IsDestructive`; a later comment cannot mark a file). `HandleDbMigrate` applies pending
  migrations in order and stops before the first pending destructive one unless the query has
  `confirmDestructive=<its version>` (exact ordinal match with the `version` dryRun prints, so `45`, not `045`). When it
  stops it returns 200 with `applied`, `blockedBy: {version, name, file}` and a `message`, and applies nothing after the
  blocked migration. dryRun marks each pending migration `destructive`. The migration lock, the per-migration audit
  entries and the vector step are unchanged. A test-only `AsyncLocal` seam (`MigrationsDirOverride`) points
  `LoadMigrations` at another folder.
- `src_C/Vpc/Db/Migrations/045_retire_content_intelligence.sql`: header line `-- destructive: true` (no other
  migration has it).
- `src_C/Shared/RecallSmith.Lambda.Common/LambdaRequest.cs`: the owner command goes through
  `scripts/invoke-as-admin.sh`, which puts the path it is given into `rawPath` and sends no
  `queryStringParameters`. On the base, `/api/v1/admin/db/migrate?confirmDestructive=45` sent that way was a 404 (the
  `?…` stayed in the path). A query inside `rawPath` is now split into `Query`; `queryStringParameters` wins on a clash.
  API Gateway never puts `?` in `rawPath`, so real traffic is unchanged.

Tests (`src_C/Tests/RecallSmith.Lambda.IntegrationTests/MigrateDestructiveGateTests.cs`, fresh scratch database, the
real migrations plus a synthetic additive 046 and destructive 047):
- `Migrate_PendingAdditiveThenDestructive_AppliesOnlyTheAdditive_AndReportsBlockedBy`: applies 1–44, `blockedBy` 045,
  the outbox still exists, 046 is not applied, and a second plain call (a later round's additive migration) still stops
  at 045. On the base the same call applied 045, 046 and 047.
- `Migrate_WrongConfirmDestructive_DoesNotUnlock045` (`47`, `46`, `44`, `045`, ` 45`, empty, `true`).
- `Migrate_ConfirmDestructive_AppliesIt_AndTheAdditiveBehindIt_ButNotTheNextDestructive`: `confirmDestructive=45`
  applies 45 and 46, writes the `migration:45` audit row and stops at 47; repeating it unlocks nothing; `=47` applies 47.
- `DryRun_MarksEachPendingMigrationDestructiveOrNot`.
- `Migrate_ThroughVpcFunction_WithTheQueryInRawPath_AsInvokeAsAdminSendsIt_Applies045` and
  `LambdaRequest_SplitsAQueryOffRawPath_AndQueryStringParametersWin`.
- `RealMigrations_OnlyMigration045_IsMarkedDestructive`, `DestructiveHeader_IsReadFromTheLeadingCommentBlockOnly`.

Not done here: whether 044 is applied in prod is a deploy-time check for the supervisor. With the gate, a plain migrate
call applies 044 and stops at 045, so 044 no longer drags 045 along.

### x-deploy-1

Status: fixed

Confirmed against `origin/main`: `AccountDeletion.cs:46-47` deletes from `analytics_event_outbox` with no guard, and the
ingest in `ProgressEvents.cs` inserts into it (line 481) and only catches 42703. A pre-R26 build behind the prod alias
after 045 fails every sync push and account deletion with 42P01.

Fix (supervisor decision 2: roll forward only; no recreate script):
- `src_C/Vpc/Db/Migrations/045_retire_content_intelligence.sql` header: owner only, run after the supervisor's prod smoke
  test of the deployed R26 build (one signed-in sync push, one account deletion of a test account), the exact owner
  command (`POST /api/v1/admin/db/migrate?confirmDestructive=45` through `scripts/invoke-as-admin.sh`), and that no
  pre-R26 core-vpc version may become the prod alias target once it has run.
- `docs/delivery/r26-issues/S01-notes.md` "Owner steps": the same, in order.

Proof: documentation; the gate tests under x-deploy-2 show 045 cannot run before the owner's confirmed call. The
`infra/RUNBOOK.md` §Rollback note the reviewer also asked for is outside this issue's scope (follow-up for the infra
wave).

### s-security-1

Status: fixed

Confirmed: the S01 change dropped the "out of reach" note, and the summary said only the Cognito user stays. The
reviewer's 400-day claim is replaced by the supervisor's 2026-10-02 `list-object-versions` facts (decision 3):
`s3://core-vpc/analytics/raw/` holds 0 object versions (the owner deleted the only test export that day); what remains
under `analytics/` is `analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz` (30 aggregate rows for
the demo deck `content-intelligence-demo`, no user identifiers) and three zero-byte folder keys, which the owner
deletes.

Files: `src_C/Vpc/Runtime/AccountDeletion.cs` (doc comment: exported rows under `analytics/raw/` are out of reach of
this code, with the facts above), `docs/delivery/r26-issues/S01-notes.md` (Owner step 5).

Proof: documentation only; no code path changed.

### s-tests-1

Status: fixed

Confirmed: the `to_regclass` check and the delete are separate statements under READ COMMITTED with no lock between
them and no 42P01 handler, so 045 committing in between aborted the deletion (500, Cognito user kept).

Fix: `src_C/Vpc/Runtime/AccountDeletion.cs`: the check stays (the usual post-045 call raises nothing), and the delete
moved into `DeleteOutboxRowsAsync`, which runs it inside a savepoint and on `PostgresException` 42P01 rolls back to the
savepoint and counts 0, so the rest of the transaction continues (contract §0).

Test: `AnalyticsOutboxRetiredTests.AccountDeletion_OutboxDroppedAfterTheCheck_CountsZero_AndTheDeletionStillCommits`:
on the post-045 database (the state right after 045 commits in the gap) the outbox delete runs inside the deletion's
transaction, returns 0, and the user delete in the same transaction still commits. Without the savepoint the delete
throws 42P01 and the transaction is aborted.

### s-tests-2

Status: fixed

Confirmed: the only pre-045 deletion test called `DeleteUserDataAsync` directly; neither route was exercised on a 044
database.

Test: `AnalyticsOutboxRetiredTests.DeleteMeRoute_BeforeMigration045_Is204_AndDeletesTheCallersOutboxRows`
(`/api/v1/me` and `/api/v1/user/me`) points `PGDATABASE` at a scratch database frozen at 044, calls
`VpcFunction.Handler` with a signed-in user and asserts 204, the caller's outbox and user rows gone and another user's
kept. It passes on the base as well: this closes a coverage gap, the behaviour did not change.

Files: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AnalyticsOutboxRetiredTests.cs`,
`docs/delivery/r26-issues/S01-notes.md` (the 204 claim now names the route tests).
