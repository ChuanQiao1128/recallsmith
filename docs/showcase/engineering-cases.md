# RecallSmith engineering cases

RecallSmith is a personal project, designed, implemented and maintained by one person with AI tools assisting in parts of the work. The cases below describe code and operations evidence in this repository. Operational observations are bounded samples, not claims about a particular traffic level or a complete production period.

## 1. Offline review sync across devices

### Constraint

Learners can review cards without a network connection. A review must appear locally at once and still reach the server after a crash, a temporary outage or a repeated request. The same person may also switch accounts on one device, so a pending queue or cursor must not appear under another account.

### Design

`mobile/src/sync/progressSync.ts` writes review events to AsyncStorage before scheduling a push. Events carry an id, and a replay uses that id as the idempotency key. Push responses distinguish accepted events from already-seen event ids, allowing the client to remove acknowledged work without treating a network retry as a second review. The client pushes bounded batches, then pulls progress using a cursor. Queue, cursor, status and remote cache keys include the authenticated Cognito `sub`.

The backend merges progress in PostgreSQL as part of event ingestion (`src_C/Vpc/Runtime/ProgressEvents.cs`). The merge policy follows the meaning of each field: review counts add, monotonic facts keep their greatest value, and fields describing the latest review travel together under one recency comparison. The client schedules recovery after failed work and resumes it when the app returns to the foreground.

### Conflict policy and trade-offs

Draw state uses a separate snapshot path in `mobile/src/sync/drawStateSync.ts` and `src_C/Vpc/Runtime/DrawStateSync.cs`. Owned cards merge by set union, while pity and wallet balances use last-writer-wins stamps. That is intentionally lossy when two offline devices both spend from a wallet: one snapshot can replace the other. The code and migration comment identify an event ledger as the more complete design if that loss stops being acceptable.

The progress SQL also has a known exact-timestamp tie: when two devices review the same card in the same millisecond, the SQL arrival order decides the latest-review fields. Event-id deduplication does not resolve that conflict. The executable merge specification documents the gap in `src_C/Vpc/Runtime/ProgressMerge.cs`.

### Evidence and limits

The sync paths and integration coverage are in `mobile/tests/` and `src_C/Tests/RecallSmith.Lambda.IntegrationTests/`. A read-only CloudWatch sample covering 28 requested days returned 21 push, 136 progress and 71 draw-state handler samples; each returned sample was within 2 seconds. This is handler latency, not end-to-end latency, and it does not prove each review synced successfully. The window spans releases, and the deployed source for every sample is unknown. See [the dated operations observation](../qa/career-readiness-20261026/operations.md) and its [query evidence](../qa/career-readiness-20261026/operations-source.json).

## 2. Publish failure, replay and recovery

### Constraint

Publishing can involve a database job row, an SQS delivery, content generation and an S3 upload. A worker may fail or receive the same message again. A stale job must not overwrite a deck that changed after its publish checks passed.

### Design

`src_C/Vpc/Authoring/Publish.cs` creates a publish job and sends its message to SQS. `src_C/Worker/Services/PublishJobProcessor.cs` acquires the job before loading content, verifies that the card snapshot and relevant deck settings still match the checks recorded for the job, uploads the deck, then marks the job complete. A replay that finds a terminal job is acknowledged; a successful replay can retry idempotent after-publish side effects. The worker's job repository and reaper handle acquisition, attempts and stale work. The console polls job status so the author can see a terminal result.

### Failure behavior

An upload or processing error is recorded on the job and the message can be retried according to queue delivery behavior. A changed card snapshot or deck setting fails the job and asks for a fresh publish. Webhook delivery and ledger recording happen after the job is marked successful and are best-effort, so a notification or ledger outage does not turn a completed publish into a failed publish.

### Evidence and limits

The 28-day read-only observation returned 16 `PublishJobsSucceeded` events and no datapoints for `PublishJobsFailed`. These are best-effort handler metrics, not a durable per-job outcome ledger; missing failure datapoints do not prove every job succeeded. The sample is below the runbook's 200-event minimum for drawing an SLO conclusion. Worker invocation counts are also not publish counts. The exact figures and limitations are in [the operations observation](../qa/career-readiness-20261026/operations.md).

This case demonstrates a replay-aware workflow and explicit failure boundaries. It does not establish a complete publish success rate, production load capacity or a controlled end-to-end latency result. Those require a durable outcome ledger and a controlled run on an identified deployed version.

## 3. Deployment rollback and database restore

### Constraint

A production delivery can change several Lambda aliases and static web assets. Reverting application code does not restore database state, and rolling code behind a destructive schema change can make the service unusable.

### Delivery and rollback design

`.github/workflows/cd.yml` separates a build without AWS credentials from an OIDC production job that waits for the GitHub `production` environment approval. The deploy verifies artifact hashes, records the aliases and web assets it is about to change, deploys the selected targets and runs a post-deploy smoke against a pre-deploy baseline. A newly failing smoke triggers a restore of changed aliases and web assets. The scripts verify alias versions and content state after restore. CD does not run database migrations.

For core-vpc, rollback is constrained by migration 045: versions below 74 write to the retired outbox table and are refused by `scripts/rollback.sh`. Migration work is a separate owner action with its own snapshot and confirmation path. This keeps the code rollback boundary explicit, but the CD restore point is not a database restore point.

### Database recovery evidence

The 4 October 2026 restore drill restored a point-in-time copy beside production, ran a throwaway copy of the deployed core-vpc build against it, and compared migrations, deck count and card count. From the restore request to instance availability took 26 minutes 10 seconds; the app check completed 26 minutes 25 seconds after the request. The measured restore-point lag was 8 minutes 3 seconds. The temporary resources were removed by the drill cleanup. See [`infra/RUNBOOK.md` section 13](../../infra/RUNBOOK.md#13-database-restore-enterprise-audit-dr-01-drilled-2026-10-04) and the [drill record](../ops/dr-restore-drill-2026-10-04.md).

That is one successful drill on the database and configuration recorded at the time. It does not establish a universal recovery time or the recovery time after a future schema or infrastructure change. A real incident also needs a chosen restore point, write containment, verification and owner-approved cutover.
