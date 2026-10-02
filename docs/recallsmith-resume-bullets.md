# RecallSmith / DeveloperCards · Resume Project Bullets

| Item | Value |
| --- | --- |
| Target roles | Intermediate Full-stack Engineer; Full-stack + Agent Engineer |
| Last reviewed | 2026-10-03 |
| Current variant | 2026-10-03 technical variant (no product description; Content Intelligence retired in R26) |
| Claim rule | Use past tense only for behaviour that is deployed and supported by retained evidence |

## Current resume version (2026-10-03)

**RecallSmith / DeveloperCards** — Independent product · React Native/TypeScript, React, C#/.NET 8, PostgreSQL, AWS, Terraform · iOS App Store

1. Designed offline-first sync across React Native, .NET 8 and PostgreSQL: reviews are queued in a durable on-device outbox, ingested idempotently and merged last-writer-wins in one atomic CTE statement, collapsing 4 database round trips into 1 and cutting ingest-handler p50 49% (37.1 → 18.8 ms).

2. Architected a serverless AWS backend (API Gateway with Cognito JWT, arm64 Lambda, RDS PostgreSQL, SQS with DLQs, CloudFront-served immutable content builds); imported 91 hand-built resources into Terraform behind allow-list-gated plans, and kept the VPC NAT-free with VPC endpoints and HMAC-authenticated out-of-VPC Lambdas.

3. Built a cross-vendor AI authoring pipeline: a Claude agent drafts cards through a scoped MCP toolset (source reading, duplicate search, linting), and a GPT-5.5 reviewer may auto-accept only after a measured eval gate (seeded-defect recall ≥ 0.90, precision ≥ 0.97 on ≥ 120 cards); it runs in dry-run until then.

4. Shipped solo through a multi-agent delivery pipeline (parallel git-worktree waves, independent multi-lens review, fix rounds, gated deploys) backed by 6,700+ automated tests (2,400+ against real PostgreSQL via Testcontainers); cross-review caught a routine migrate call that would have prematurely run a table-dropping migration, now gated behind explicit confirmation.

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
