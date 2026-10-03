# RecallSmith / DeveloperCards · Resume Project Bullets

| Item | Value |
| --- | --- |
| Target roles | Intermediate Full-stack Engineer; Full-stack + Agent Engineer |
| Last reviewed | 2026-10-03 |
| Current variant | 2026-10-03 technical variant (no product description; Content Intelligence retired in R26) |
| Claim rule | Use past tense only for behaviour that is deployed and supported by retained evidence |

## Current resume version (2026-10-03, five bullets)

**RecallSmith / DeveloperCards** — Independent product · React Native/TypeScript, React, C#/.NET 8, PostgreSQL, AWS, Terraform · iOS App Store

1. Designed offline-first review sync across React Native, .NET 8 and PostgreSQL: an on-device outbox replays events to an idempotent ingest endpoint that merges last-writer-wins in one atomic CTE statement, collapsing 4 database round trips into 1 and cutting ingest-handler p50 49% (37.1 → 18.8 ms).

2. Built a React 19/TypeScript admin console on S3/CloudFront with route-level code splitting, a test-enforced first-load budget (377,000 bytes, from 553,688), optimistic-concurrency card edits with 409 conflict recovery, and duplicate-safe async deck publishing through SQS.

3. Architected a serverless AWS backend codified in Terraform (API Gateway + Cognito JWT, arm64 Lambda, RDS PostgreSQL, SQS + DLQs, CloudFront), importing 91 hand-built resources behind allow-list-gated plans; added multi-window SLO burn-rate alarms, heartbeat alarms and synthetic probes.

4. Built a cross-vendor AI authoring pipeline: a Claude agent drafts via a 4-tool MCP server with tokens scoped to 6 API routes (draft, never publish); a GPT-5.5 reviewer may auto-accept only after an eval gate (recall ≥ 0.90, precision ≥ 0.97), running dry-run until then.

5. Ran GitHub Actions on every push (type checks, lint, npm audit, Expo export, 6,700+ tests, 2,400+ on real PostgreSQL via Testcontainers); shipped with AI coding agents in parallel worktrees under independent review, which caught a migrate call that would have dropped tables before prod smoke-testing.

Role-tailored variants (full-stack, AI agent, AI automation) and their checks are in the owner's evaluation report of 2026-10-03; the console lesson (PR #730, system-design-zh-console.md) holds the verified console facts.

### Evidence and accuracy boundaries (2026-10-03)

| Claim | Evidence | Boundary to state if asked |
| --- | --- | --- |
| 37.1 → 18.8 ms | `docs/low-latency-plan.md` (handler timing, 4 → 1 exchanges) | Ingest-handler internal p50 (prod v44, 128 MB, batch 1, n=100, synthetic events); end-to-end p50 was ~103 ms, so the user-visible saving is ~18 ms |
| Durable on-device outbox | `mobile/src/sync/progressSync.ts` | AsyncStorage queue, events deleted after server ack, capped at 3,000 per partition (oldest dropped); a failed enqueue write loses that event |
| One atomic CTE statement | `src_C/Vpc/Runtime/ProgressEvents.cs` | 6 CTEs since R26 (7 when measured); do not quote a count |
| 91 imported resources | `infra/envs/prod/imports.tf`, `imports_r18a.tf` | State holds 315 resources in total; VPC, subnets and security groups are read as data sources, not adopted |
| NAT-free VPC | `infra/modules/worker/ai_qa.tf`, `docs/backend-architecture-review-2026-09-22.md` | S3 gateway + SQS interface endpoints; egress work runs in out-of-VPC Lambdas whose callbacks are HMAC-signed. No private subnets: RDS and Lambdas sit in IGW-routed subnets |
| Eval gate | `src_C/Vpc/Automation/EvalGate.cs` | Also requires CI lower bounds (recall 0.85, precision 0.93) and ≥ 2 runs; prod `AUTOMATION_MODE=dry_run` (checked 2026-10-03); the Claude drafter runs hourly on the owner's Mac under launchd, not in AWS |
| Duplicate search | `tools/mcp-server/src/server.ts`, `src_C/Vpc/Authoring/CardSimilarity.cs` | The agent's tool uses trigram search; pgvector is used only by the offline eval near-duplicate path |
| First-load budget 377,000 bytes (553,688 before) | `frontend/tests/bundleFirstLoad.test.ts` | Raw bytes of the first-load static-import closure; the data router later added 55.6 kB, still under the cap |
| 409 conflict recovery, duplicate-safe publish | `src_C/Vpc/Authoring/Cards.cs`, `src_C/Vpc/Authoring/Publish.cs` | Bulk import does not check versions and can overwrite a concurrent single-card edit; publish relies on polling plus a reaper for stuck jobs |
| Agent tokens scoped to 6 routes | `infra/modules/api/gateway.tf`, `src_C/Vpc/AgentClientPolicy.cs` | Two allow-lists kept in sync by a CI checker, not one source; agent tokens carry the owner's groups and are stored on disk |
| SLO, heartbeat and synthetic alarms | `infra/modules/observability/` | Heartbeat alarms misfired three times at creation (alarm deployed before its data source, actions disabled, no notification); see the ops postmortems (PR #732) |
| CI on every push | `.github/workflows/ci.yml` | main has no branch protection, so say "ran", not "gated"; lint covers the console only |
| 6,700+ tests | Local runs 2026-10-02: backend 2,887, console 1,512, mobile 2,333 | ~2,465 backend tests use the shared Postgres container; ~387 are pure unit tests |
| Migration guard | `src_C/Vpc/Db/Migrate.cs`, migration 045 | 045 dropped three tables that were being retired; the hazard was running it before the smoke test and breaking rollback, not user-data loss |

## Superseded variant (2026-09-11)

Bullets 1, 2 and 4 of the 2026-09-11 variant remain true as written, except that bullet 1's "seven-CTE" should not be quoted (6 CTEs since R26). Bullet 3 (Content Intelligence) is **no longer valid**: the pipeline, its console page and its tables were retired in R26 on 2026-10-02 (migration 045). Do not reuse it. Its "Post-agent replacement" and "Content Intelligence verification" sections were removed with it.

## Production evidence gate

Keep enough evidence to answer the first follow-up question without reconstructing history during interview preparation.

| Resume claim | Evidence to retain | Accuracy boundary |
| --- | --- | --- |
| 37.1 → 18.8 ms | Production handler timing samples, benchmark method and the 4 → 1 database-exchange evidence | Handler timing produced the latency result; database statement logs and TCP observation established the exchange count |
| Ten pulls for four cards | Pre-fix reproduction, fixing commit and regression test | These were earned pull credits, not money, and the defect was caught before release |
| 1% phased rollout | App Store Connect version/build, start date, phased-release state, monitored stop criteria and final ramp result | `1%` refers to the first phased-release stage, not a hard cap on all devices |
| Mutation checks | The deliberate mutation, the previously surviving test suite and the new regression test that kills it | Do not claim that all tests in the repository were mutation-tested |
| Agent capability boundary | Deployed tool registry, dedicated-role policy, proposal/apply audit trail and negative integration tests | A prompt instruction or missing UI button is not a security boundary |

## Optional product-metric replacement

If the production usage numbers are substantial and clean, replace bullet 4 with a user-outcome bullet in this shape:

> X unique learners completed Y production reviews across Z cards in the last 90 days.

Use this only after excluding demo decks, test users, synthetic seed data, retries/replays and non-production environments. Do not present a large event count without its unique-learner count. If the learner count is small, retain the mutation-testing bullet.

## CV variant control

- Current variant: the four bullets under **Current resume version (2026-10-03)**.
- Record the variant and submission date for every application.
- A later resume may truthfully add a newly deployed capability; variants must not disagree about facts that were already fixed at the same submission date.
