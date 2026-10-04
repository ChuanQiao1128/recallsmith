# RecallSmith / DeveloperCards · Resume Project Bullets

| Item | Value |
| --- | --- |
| Target roles | Intermediate full-stack engineer; full-stack + AI agent engineer; AI automation engineer |
| Last reviewed | 2026-10-04, against `origin/main` f7b163e plus read-only checks of live AWS and GitHub |
| Current variant | 2026-10-04: five general bullets (M1–M5) and three role variants (F, A, U). Technical level only, no product description |
| Claim rule | Use past tense only for behaviour that is deployed and backed by retained evidence. Anything built but switched off says so in the bullet. Quote a number only within the limits the evidence table gives it |

## Current resume version (2026-10-04, five bullets)

**RecallSmith / DeveloperCards** · Independent product · React Native/TypeScript, React 19, C#/.NET 10, Python, PostgreSQL, AWS, Terraform, GitHub Actions · iOS App Store

1. Designed offline-first sync from React Native to C#/PostgreSQL: a device outbox replays events to an idempotent endpoint that merges last-writer-wins in one atomic SQL statement; DB round trips 4 → 1, ingest-handler p50 −49% (37.1 → 18.8 ms).
2. Moved routine deploys of a Terraform-managed AWS stack (Lambda, API Gateway, RDS, SQS, CloudFront) from a laptop to GitHub Actions via OIDC, with no stored CI credentials: owner approval, hash-verified artifacts, smoke tests, automatic rollback.
3. Cut a full-admin AWS key shared by deploy scripts and AI agents to assume-role only: without MFA it reaches just a read-only role that denies secrets and user data; main now requires a PR and 9 passing CI checks; Actions pinned to SHAs.
4. Built a drafting agent on headless Claude Code and a 4-tool TypeScript MCP server that can draft but never publish (verbatim-quote grounding, 6-route token scope); auto-accept stays off until a cross-vendor reviewer passes a server-side eval gate.
5. Ran AI fact-checks: two independent AI checkers compared 61 live AWS cards with official docs and flagged 9 factual errors, each re-confirmed on the page, then fixed and republished; AI-assisted backfill lifted AWS citation coverage 5% → 98.7%.

Testing line (optional, outside the five bullets, usable in every variant): 6,800+ automated tests gate every PR to main (2,900+ backend, most against real PostgreSQL via Testcontainers).

## Role-tailored variants (2026-10-04)

Use one variant per application and do not mix bullets across variants. Each bullet is at most 250 characters, about two resume lines.

### Full-stack engineer (F1–F5)

**RecallSmith / DeveloperCards** · Independent product · TypeScript, React 19, React Native, C#/.NET 10, PostgreSQL, AWS, Terraform, GitHub Actions · iOS App Store

1. Designed offline-first sync from React Native to C#/PostgreSQL: a device outbox replays events to an idempotent endpoint that merges last-writer-wins in one atomic SQL statement; DB round trips 4 → 1, ingest-handler p50 −49% (37.1 → 18.8 ms).
2. Built a React 19/TypeScript admin console (React Query, Cognito PKCE, 18 pages): route splitting cut first-load JS+CSS 44% (554 → 309 kB), now capped by a CI byte budget; strict CSP tested in Playwright under production headers; 1,500+ Vitest tests.
3. Moved routine deploys of a Terraform-managed AWS stack (Lambda, API Gateway, RDS, SQS, CloudFront) from a laptop to GitHub Actions via OIDC, with no stored CI credentials: owner approval, hash-verified artifacts, smoke tests, automatic rollback.
4. Restricted a full-admin AWS key shared by deploy scripts and AI agents to assume-role only (read-only unless MFA); main requires a PR and 9 CI checks incl. npm/pip/NuGet audit gates; CodeQL and secret scanning on; Actions pinned to SHAs.
5. Migrated both C# Lambdas from .NET 8 to .NET 10 ahead of the runtime's deprecation, all 2,887 backend tests passing on both; added 20 s statement / 60 s idle-transaction DB timeouts (Testcontainers-tested); drilled a 27-min point-in-time restore.

### Full-stack + AI agent engineer (A1–A5)

**RecallSmith / DeveloperCards** · Independent product · TypeScript (MCP), Python (evals, Lambdas), headless Claude Code, C#/.NET 10, PostgreSQL, AWS, Terraform

1. Built a drafting agent on headless Claude Code with a 4-tool TypeScript MCP server (ingest, trigram dedupe, lint, submit) that can draft but never publish: verbatim-quote grounding, fetch host allow-list, credential guard, 6-route token scope.
2. Built a Python seeded-defect eval harness (7 defect classes, mirrored controls, card-clustered 95% CIs); an offline Claude Opus 5 run on an unseen set caught 96% of seeded defects with 7.6% false flags on clean controls (452 reviews, ~$19).
3. Designed the autonomy boundary: auto-accept requires a server-recomputed eval gate (recall ≥0.90, precision ≥0.97, ≥120 would-accept cards) for a cross-vendor reviewer; until it passes, humans approve every draft (kill switch, $10/day cap).
4. Ran AI content checks: two independent AI checkers compared 61 live cards with official docs and flagged 9 factual errors, re-confirmed and fixed in production; AI-assisted backfill lifted citation coverage AWS 5% → 98.7%, CCDV-F 25% → 98.4%.
5. Built with AI coding agents in isolated git worktrees under independent review agents, whose reviews of the CD and Terraform pipelines confirmed 18 and 12 findings, all fixed; agents get a read-only AWS role that denies secrets and user data.

### AI automation engineer (U1–U5)

**RecallSmith / DeveloperCards** · Independent product · Python 3.12, AWS (EventBridge Scheduler, Lambda, SQS), C#/.NET 10, PostgreSQL, MCP, Terraform, GitHub Actions

1. Built event-driven automation on AWS: EventBridge Scheduler jobs (hourly source watch, 15-min tick, weekly digest) on Python 3.12 Lambdas, SQS consumers with DLQs, HMAC-signed outbound webhooks with key rotation, SSRF guard, 5-attempt backoff.
2. Automated content verification: an hourly source watcher re-checks each cited page weekly for its verbatim quote; AI-assisted backfill lifted citation coverage AWS 5% → 98.7%, CCDV-F 25% → 98.4%; dual AI fact-checks of 61 cards led to 9 fixes.
3. Built a gated LLM workflow: Claude drafts via a scoped MCP toolset, a cross-vendor reviewer Lambda (deployed, switched off) schema-validates findings, and an off/dry_run/live switch keeps every draft in human review until an eval gate passes.
4. Automated delivery: GitHub OIDC CD deploys only targets changed since the last good deployment, after owner approval, then smoke-tests with automatic rollback; Terraform runs saved plan → privilege guard → allow-list → apply → empty re-plan.
5. Instrumented the automations: DLQ, missed-heartbeat, daily AI-cost, SLO burn-rate and 4xx/auth-reject alarms plus 8 account-free synthetic probes; a scripted point-in-time restore drill measured a 27-min RTO and an 8-min RPO.

## Evidence and accuracy boundaries (2026-10-04)

Bullet IDs: M = current version, F = full-stack, A = AI agent, U = AI automation, T = testing line. Paths are on `origin/main` f7b163e. "Live" means read from AWS or GitHub on 2026-10-04.

| Claim (used in) | Evidence | Boundary to state if asked |
| --- | --- | --- |
| Device outbox (M1, F1) | `mobile/src/sync/progressSync.ts` | AsyncStorage queue. Events are deleted after the server acks them. Capped at 3,000 per partition: the oldest are dropped, and the drop count is kept only on the device. A failed enqueue write loses that event. Say "outbox", never "durable" or "log". |
| Idempotent endpoint, last-writer-wins, one atomic statement (M1, F1) | `src_C/Vpc/Runtime/ProgressEvents.cs` (`on conflict (event_id) do nothing`; order by `event_time desc, event_id desc`) | The idempotency key is `event_id`. With LWW, the later review wins when two offline devices touch the same card. It is one statement built from several CTEs; do not quote a CTE count. |
| 4 → 1 round trips; p50 37.1 → 18.8 ms (M1, F1) | `docs/low-latency-plan.md` | Internal p50 of the ingest handler on prod v44 (then .NET 8, 128 MB), batch 1, synthetic events. The 18.8 ms run had n=100; the 37.1 ms baseline came from the earlier interleaved run (n=200). Not re-measured on .NET 10 (now 512 MB). End-to-end p50 was ~103 ms, so users save ~18 ms. The round-trip count comes from DB statement logs and a TCP proxy. |
| Terraform-managed AWS stack (M2, F3) | `infra/envs/prod/`, `infra/modules/*`, `infra/envs/prod/imports*.tf` | Hand-built resources were adopted by import: 91 at the time; 16 were retired with edge-public (c171ca3), so the import files now hold 75 blocks. VPC, subnets and security groups are data sources. No private subnets, no staging. |
| Routine deploys via GitHub OIDC CD, no stored CI credentials, owner approval, hash-verified artifacts, smoke tests, automatic rollback (M2, F3, U4) | `.github/workflows/cd.yml`, `scripts/cd/*.sh`, `scripts/smoke.sh`, `infra/RUNBOOK.md` §12, `scripts/tests/cd-scripts.test.sh`. Live: 0 repo Actions secrets, 0 environment secrets; GitHub Deployments shows 6 production deploys (2026-10-03 21:08 to 2026-10-04 08:59 UTC), all `success` with `#cd-full`. Review: PR #741 ("25 findings, 18 confirmed, 18 fixed"), fixes 8c74419 | "Routine" because a local MFA break-glass deploy still exists. Environment `production`: owner as required reviewer, `main` only, admins cannot bypass. The build job has no AWS credentials. Smoke = `/health` plus the synthetic check; a deploy fails only on a check that passed in the pre-deploy baseline. Rollback restores moved Lambda aliases, the console `index.html` and the site bucket, not the database or `$LATEST`. It has never fired in production: it was tested against stubbed `aws`/`gh`/`curl`, and with no staging the smoke test hits production. Mobile OTA, migrations and Terraform are outside CD. "No stored CI credentials" does not mean no static key exists (see the IAM row). |
| Deploys only changed targets (U4) | `scripts/cd/plan.sh` (GitHub Deployments API), RUNBOOK §12 "What deploys when"; CD run 37190637998 planned `backend console` | Changes are measured from the last successful *full* deployment. A merge that touches only docs, infra or mobile deploys nothing and asks for no approval. |
| Terraform: saved plan → privilege guard → allow-list → apply → empty re-plan (U4) | `.github/workflows/terraform.yml`, `infra/scripts/tf-pipeline.py` (guard), `infra/scripts/check-plan.py` (allow-list), RUNBOOK §15. 3 production applies on 2026-10-04 (runs 37185288412, 37185788377, 37190473658). Review: PR #747 (15 findings, 12 confirmed and fixed; 3b1c829) | The guard runs before the allow-list check. The pipeline role is AdministratorAccess minus a 9-statement explicit deny. The guard refuses operator-role changes, IAM writes, PassRole/AssumeRole on `*`, admin attachments, provisioners and imports. It does not catch service roles that run code, or resource policies (RUNBOOK §15). The owner approves the allow-list, not the plan text. Break-glass stays local with MFA. |
| Shared full-admin key cut to assume-role only; job-scoped roles (M3, F4, A5) | `infra/modules/operators/main.tf`, RUNBOOK §10, `infra/scripts/operator-cutover.sh`; independent review of #736 fixed in PR #739 (5d69915); deployer MFA in #740 | The key was restricted, not removed: it is still Active and can only assume roles (plus see its own user and change its password). Without MFA it reaches only `devcards-agent-readonly`: ReadOnlyAccess plus 8 explicit deny statements (KMS/SSM/Secrets Manager, Lambda configuration, S3 objects, Cognito user records, code and credential downloads, API access logs, owner contact, latent PII reads). `devcards-deployer` (scoped) and `devcards-admin-mfa` (AdministratorAccess) need MFA and have 1-hour sessions. The admin role is not least-privilege, so say "job-scoped". Agents run as the same macOS user, so they could use a cached owner session for that hour. No IAM Identity Center. Do not quote a count of review findings for this PR: none is recorded. |
| main requires a PR and 9 CI checks (M3, F4) | GitHub ruleset 24412075 (`gh api repos/ChuanQiao1128/recallsmith/rulesets/24412075`) | Required checks: mobile, frontend vitest, frontend Playwright, backend, python, infra, mcp-server, n8n, author-runner. Force push and deletion are blocked; no bypass actors. 0 required approvals: review is by AI agents, not a human. CodeQL is not one of the 9. |
| npm/pip/NuGet audit gates (F4) | `ci.yml`: `check-npm-audit.py` with `mobile/npm-audit-allowlist.json` in the mobile job; `npm audit --omit=dev --audit-level=high` in frontend, mcp-server and author-runner; `pip-audit --strict` in python. `src_C/Directory.Build.props` (NU1903/NU1904 as errors) in backend; commit 5996b0f | The gates run inside required checks. Commit 5996b0f fixed 62 of 71 high/critical mobile npm advisories by changing only the lockfile (no native module moved; 3 shipped package versions changed). Whether that lockfile has reached users by OTA was not checked. 9 accepted advisories stay on an allow-list that expires 2027-02-01 (the next Expo SDK upgrade), when CI goes red unless they are re-reviewed; each is marked not in the shipped app, and `check-bundle-packages.py` checks that against the iOS and Android source maps in every mobile CI run. |
| SHA-pinned Actions, CodeQL, secret scanning (M3, F4) | `.github/workflows/*.yml` (commit 801af4a: all 41 `uses:` lines pinned to 40-hex SHAs), `.github/dependabot.yml`. Live: CodeQL default setup for Actions, C#, JS/TS and Python, 0 open alerts; secret scanning with push protection | These settings live in GitHub, not in the repo. Non-provider secret patterns and validity checks are off. Dependabot version updates cover Actions only. 50 Dependabot alerts remain open: 33 console dev-only (14 high), 17 mobile runtime (the 9 allow-listed high/critical plus 8 medium/low). |
| Strict CSP tested in Playwright under production headers (F2) | `infra/modules/edge/security_headers.{json,tf}`, `frontend/tests/e2e/cspGuard.ts`, `infra/scripts/tests/test_r29_harden.py`, RUNBOOK §16. Live `curl -sI` on the console and landing site; CI "frontend (playwright smoke)" 16 passed on f7b163e | Enforced through CloudFront on the console and landing site, not the API: no `unsafe-inline` or `unsafe-eval`, plus HSTS, XFO DENY and nosniff. Playwright runs against a local server sending the production headers (`serve-with-headers.mjs`). No CSP report endpoint. |
| React 19 console, React Query, Cognito PKCE, 18 pages (F2) | `frontend/package.json`, `frontend/src/pages/` (18 files, incl. login and callback), `frontend/src/auth/cognito.ts` (S256) | Internal admin console with no outside users. The refresh token lasts 30 days and is kept in sessionStorage; refresh-token revocation is not done. |
| First-load −44%, CI byte budget (F2) | `frontend/tests/bundleFirstLoad.test.ts` (cap 377,000 B) | 553,688 → 308,582 B raw (not gzip) when measured. The data router later added bytes: now ~372 kB, −33% vs baseline and under the cap. The budget holds 377 kB, not the 44%. No RUM. |
| 1,500+ Vitest tests (F2) | CI run 37191434061 on f7b163e: 162 files, 1,511 passed | None |
| .NET 8 → 10, all 2,887 backend tests passing on both (F5) | PR #737 (2,887/0/0 on SDK 10; same on the net8 baseline, run 36993409873); commits 328bff7, dd885c2, 61fe5e9; RUNBOOK §11; `infra/scripts/check-lambda-runtimes.py` (CI fails 90 days before any runtime deprecation). Live INIT_START: `dotnet:10.mainline.v74` on both functions | Done before the 2026-11-10 dotnet8 deprecation. Cutover by alias: the `prod` alias moved only after the dotnet10 version was published. Do not say "zero downtime": availability was not measured. Rolling back to a dotnet8 version is only a stopgap. |
| DB timeouts 20 s / 60 s (F5) | `src_C/Shared/RecallSmith.Lambda.Db/PgSessionTimeouts.cs`, `DbSessionTimeoutsTests.cs` (Testcontainers, 7 facts), RUNBOOK §16; deployed by CD run 37190637998 | Applies to core-vpc only; the worker uses 600 s / 600 s. Migrations lift both limits for their own transaction. The slowest invocation in 30 days took 7.4 s. |
| Restore drill: 27-min RTO, 8-min RPO (F5, U5) | `docs/ops/dr-restore-drill-2026-10-04.md`, `infra/scripts/dr-restore-drill.sh`, RUNBOOK §13 | One drill so far. Instance available at 26 min 10 s, app answering at 26 min 25 s; the report rounds to 27. RPO: the newest restorable point was 8 min 3 s behind the request. The restore ran beside production and was checked with a throwaway copy of the live build (migrations, deck and card totals). A real incident adds detection and the cut-over (point `PGHOST` at the new endpoint and deploy). Backups are in one region and one account (not re-checked live). |
| Alarms: DLQ, missed heartbeat, daily AI cost, SLO burn rate, 4xx, auth rejects (U5) | `infra/modules/observability/` (50 metric-alarm blocks, some `for_each`, plus 5 composites; `slo_r18h.tf`, `alarms_r28.tf`). Live: 55 metric alarms + 5 composites | 50 alarms notify one SNS e-mail topic; the 10 SLO window alarms have no actions and feed the composites. No paging. Since August, production alarms fired 9 times (6 core p95 latency on 09-27, 2 heartbeat-missing, 1 synthetic on 09-29); say that, not "caught incidents". With tens of requests a day, the SLOs carry little signal. |
| 8 account-free synthetic probes (U5) | `services/synthetic-check/src/synthetic_check/checks.py`; schedule `developercards-synthetic-check` rate(15 minutes), ENABLED | 9 checks: 8 gating plus 1 advisory (remote-config). No probe signs in as a user, and `/health` does not touch the DB. The CD smoke uses `/health` plus these checks. |
| 6,800+ tests; 2,900+ backend, most on real PostgreSQL (T) | CI run 37191434061 on f7b163e: backend 2,928, console 1,511, mobile 2,417 (total 6,856) | Python (~1,026), mcp-server (93), author-runner (76) and CD-script (229) tests are not counted. "Most on PostgreSQL" is a static estimate (~2,500 of 2,928 in the Postgres collection). Before quoting a number, re-run `dotnet test --list-tests` grouped by collection and save the count. Test counts are not a quality claim; only named guards were mutation-tested. |
| Drafting agent on headless Claude Code, 4-tool MCP server (M4, A1, U3) | `tools/mcp-server/src/server.ts` (`read_source`, `find_similar_cards`, `lint_card`, `submit_draft`), `tools/author-runner/` | The drafter runs hourly under launchd on the owner's Mac with a personal subscription, not in AWS. The queue is mostly empty: 74 launches, 2 items claimed (local log, 2026-10-04). |
| 6-route token scope (M4, A1) | `src_C/Vpc/AgentClientPolicy.cs`, `infra/modules/api/gateway.tf`, `infra/scripts/check-agent-routes.py` | 3 MCP routes plus 3 runner routes. Two allow-lists are kept in sync by a CI checker. Agent tokens carry the owner's groups and are stored on disk. |
| Grounding, fetch host allow-list, credential guard (A1) | `tools/mcp-server/src/grounding.ts`, `credentialGuard.ts`, `DC_AUTOMATION_SOURCE_HOSTS` | The host allow-list applies only inside automation runs; outside them any https URL is allowed. Duplicate search is trigram; pgvector appears only in the offline eval path. There is no prompt-injection test set, so say "rules", not "tested against injection". |
| Eval gate: recall ≥0.90, precision ≥0.97, ≥120 cards; cross-vendor reviewer (M4, A3, U3) | `src_C/Vpc/Automation/EvalGate.cs` (`AutomationGateModels` = GPT-5.5), `AutomationMode.cs` | The gate also requires CI lower bounds (0.85 / 0.93) and ≥2 runs; 120 means would-accept cards. It has never passed, and no GPT-5.5 run exists. Prod has `AUTOMATION_MODE=dry_run` and `AI_QA_ENABLED=0` (`src_C/env/prod.env.json`, `services/ai-qa/env/prod.env.json`), so no AI decision has taken effect in production and dry-run has produced no would-accept data. |
| Reviewer Lambda (deployed, switched off), schema-validated findings, kill switch, $10/day cap (A3, U3) | `services/ai-qa/` (`schema.py`, pydantic `extra="forbid"`), `infra/modules/worker/ai_qa.tf`, RUNBOOK §7 (emergency stop) | Live: 0 invocations and 0 queue messages in 30 days. No reviewer model has returned a production finding. |
| Seeded-defect eval: 96% recall, 7.6% false flags, 452 reviews, ~$19 (A2) | `evals/README.md`, `evals/src/dc_evals/score.py` (`clustered_wilson_ci`, 608c31c), `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md` | Claude Opus 5 through a claude-cli proxy, not Bedrock and not the GPT-5.5 reviewer. The report marks it proxy evidence, and it FAILS its rollout gate on provider grounds, not on metrics. TP 216, FN 10 (recall 0.956); FP 17 of 225 scored control reviews (0.0756). Precision 0.927 holds at ~50% defect prevalence; the report estimates ~0.58 at 10%, which is why the bullet quotes the false-flag rate. This run predates card-clustered scoring: its recall CI (0.92–0.98) is a pooled Wilson interval, so do not call it clustered. Labels come from a model jury with no human calibration. Cost is estimated at list price; the subscription run billed nothing. |
| Citation coverage AWS 5% → 98.7%, CCDV-F 25% → 98.4% (M5, A4, U2) | `docs/delivery/r29-content/REPORT.md`, `backfill-applied.json`. Live CDN deck.json: AWS 366/371 (build 20261004T090438Z), CCDV-F 434/441 | Before: 20/371 and 109/441. 21 citations are URL-only (AWS 11, CCDV-F 10); 355/371 AWS cards (96%) have a verbatim quote. Quotes were re-fetched and matched with the source watcher's `quote_present`, which checks that the quote is on the page, not that it supports the answer. Sources came mostly from the authoring ledger. A citation is not a fact-check. |
| 61 cards checked, 9 factual errors fixed (M5, A4, U2) | `REPORT.md` §2–3, `verify-applied.json` (48 sourced, 9 fixed+sourced, 4 disputed), commit 01dcb67; corrections visible in the live deck | Two independent AI checkers. The repo does not record which models they were, so say "AI checkers", not "two models" or "two vendors". Both checkers flagged the same 9; the AI session re-confirmed each on the official page, then made a minimal edit. The edits fixed answer details, not the correct option or the stem, so say "factual errors", not "wrong answers". 4 disagreements are left for the owner. No human expert reviewed all 61. |
| Hourly source watcher, weekly re-check per page (U2) | `services/source-watcher/` (`quote_present`), `infra/modules/worker/automation.tf`, `SourceWatchRoutes.cs` (`check_interval_minutes` 10080) | Schedule enabled 2026-09-28. Live: 164 invocations, 0 errors in 30 days. No model involved. A daily cap limits how many items it queues for the runner. |
| EventBridge Scheduler jobs, SQS + DLQs, signed webhooks (U1) | `infra/modules/worker/automation.tf`, `synthetic.tf`, `services/webhook-dispatcher/` (`signing.py`, `urlguard.py`, `delivery.py`: 30/120/480/900 s, 5 attempts) | Terraform creates the schedules DISABLED and they were enabled by hand; all ENABLED on 2026-10-04. A failed run is not retried (Lambda async retries 0); Scheduler retries delivery up to 2 times for tick and digest, 0 for source-watch and synthetic. The Python Lambdas are thin triggers; the logic lives in the .NET core. The webhook dispatcher had 0 invocations in 30 days and has no external subscriber. |
| AI coding agents in isolated worktrees, independent review: 18 and 12 confirmed findings (A5) | PR #741 (CD: 25 findings, 18 confirmed, 18 fixed; 8c74419), PR #747 (Terraform: 15 findings, 12 confirmed and fixed; 3b1c829); `docs/delivery/*/` notes | 87% of non-merge commits on main carry an AI co-author trailer. Every PR is merged under the owner's account, with no human second reviewer; whether a person or an agent pressed merge is not recorded. Be ready to explain and change any part by hand (for example the `ProgressEvents` SQL and the rollback order in `scripts/cd/`). |
| Per-route throttles ≥100× observed peak (interview only) | `infra/modules/api/gateway.tf` (`route_throttles`), RUNBOOK §16 | Peak = the busiest minute in 30 days (≤11 requests). All callers of a route share one bucket; there is no per-user limit. Not in any bullet: it signals low traffic more than design. |

## What changed since 2026-10-03

- This file now holds the three role variants, which were only in the owner's evaluation report, plus the testing line. Every bullet fits in two resume lines.
- New deployed work in the bullets: GitHub OIDC CD and the Terraform pipeline, the IAM key restriction, the main ruleset with SHA pins and audit gates, the .NET 10 migration, DB timeouts, the restore drill, and the R29 content checks and citation backfill.
- Stack line: .NET 8 → .NET 10; Python and GitHub Actions added.
- Fact-check corrections applied:
  - Terraform order: the guard runs before the allow-list.
  - Admin key: restricted to assume-role, not replaced or split. The roles are "job-scoped", not least-privilege.
  - "Keyless" became "no stored CI credentials", and "off a laptop" became "routine deploys".
  - "Zero-downtime" dropped.
  - The eval gate and reviewer are described as off. No "GPT-5.5 reviewer returns findings".
  - "Quote-verified" coverage became citation coverage; the 96% quote share is in the table.
  - The bundle budget is no longer said to hold the 44% cut.
  - "9 wrong answers" became "9 factual errors", and "two models" became "two AI checkers".
  - The source watcher runs hourly, with a weekly re-check per page.
  - CodeQL is not one of the 9 required checks.
- Numbers refreshed:
  - Mobile tests: 2,417 (not ~2,394); total 6,856 in CI.
  - Author-runner: 74 launches. Source watcher: 164 runs.
  - AI trailers: 87% of non-merge commits (not ~66%).
  - Scheduler retries corrected.
  - 50 open Dependabot alerts added.
- "2,400+ on real PostgreSQL" is out until the split is re-run on .NET 10; use "most".
- The console bullet now appears only in the full-stack variant (F2). Throttles and the 62/71 npm count are interview-only now.

### Retired wording (do not reuse)

- "Ran CI, not gated" / "main has no branch protection": main is gated by ruleset 24412075 (PR, 9 checks, no bypass), with 0 human approvals.
- ".NET 8" in the stack line: both Lambdas run dotnet10.
- "Replaced" or "split" the admin key; "least-privilege" for the role set; "keyless"; "off a laptop" without "routine"; "zero-downtime".
- "A GPT-5.5 reviewer returns findings"; "production ran dry-run" as if it produced shadow data.
- "Quote-verified 98.7%"; "9 wrong answers"; "two models"; "re-checks cited pages hourly".
- "91 imported resources" as a headline (16 were retired with edge-public); "NAT-free VPC" (no private subnets).
- "5-probe synthetic check", "46 alarm definitions", "6,700+ tests", "67 launches", "156 runs", "~66% AI commits", "schedules do not retry".
- The migration-guard story stays interview-only: migration 045 dropped retired tables, and the hazard was a premature drop that broke rollback, not data loss.
- The 2026-09-11 Content Intelligence bullet: the pipeline, its console page and its tables were retired in R26 (migration 045).

## Production evidence gate

Keep enough evidence to answer the first follow-up question without reconstructing history during interview preparation.

| Resume claim | Evidence to retain | Accuracy boundary |
| --- | --- | --- |
| 37.1 → 18.8 ms | Handler timing samples, benchmark method and the 4 → 1 database-exchange evidence (`docs/low-latency-plan.md`) | Handler timing produced the latency result; DB statement logs and a TCP proxy established the exchange count. Measured on .NET 8 |
| CD with automatic rollback | GitHub Deployments history (6 production deploys, 2026-10-03/04), the CD run logs, PR #741 review table, `cd-scripts.test.sh` output | Rollback has only run against stubs; keep the run link of the first real rollback if one happens |
| Terraform pipeline | The 3 apply runs of 2026-10-04, their saved plans and allow-list files, PR #747 review table | The owner approves the allow-list, not the plan text |
| IAM restriction | Live `list-attached-user-policies` / role policies, PR #739 and #740, CloudTrail session names | The static key still exists; record the date it is deleted when OIDC/Identity Center replaces it |
| 27-min RTO | `docs/ops/dr-restore-drill-2026-10-04.md` and the script output | One drill; add each quarterly drill's result |
| 9 corrections, 98.7% coverage | `verify-applied.json`, `backfill-applied.json`, the live deck build id (20261004T090438Z) | Save a copy of the live deck.json; coverage changes when cards are added |
| Eval numbers | The report file, its jsonl and dataset sha256 | Proxy evidence; re-score with card-clustered CIs before quoting a CI |
| Test counts | CI run 37191434061 job logs; the backend Postgres/unit split once re-run | Re-count at each submission |
| Mutation checks | The deliberate mutation, the previously surviving suite and the new regression test that kills it | Do not claim that all tests in the repository were mutation-tested |
| Agent capability boundary | Deployed tool registry, dedicated-role policy, proposal/apply audit trail and negative integration tests | A prompt instruction or missing UI button is not a security boundary |

Earlier claims (ten pulls for four cards, 1% phased rollout) are in no current bullet; keep their evidence in case they return.

## Optional product-metric replacement

A user-outcome bullet would take this shape:

> X unique learners completed Y production reviews across Z cards in the last 90 days.

Do not use it yet: the 2026-10-02 funnel was 907 → 41 → 3. When it is used, exclude demo decks, test users, synthetic seed data, retries/replays and non-production environments, and never show an event count without its unique-learner count.

## CV variant control

- Current variant: the five bullets under **Current resume version (2026-10-04)** (M1–M5), and the role variants F, A and U.
- Full-stack postings: use F1–F5, not the general version, which has no web UI bullet.
- AI agent postings: use A1–A5. Code-centric automation or platform postings: use U1–U5. Business-process automation roles (n8n, Power Automate): U is the closest fit, but add no claim to make it fit.
- One variant per application; record the variant and submission date for every application.
- Before each submission, re-check the live-state claims: `AUTOMATION_MODE` / `AI_QA_ENABLED`, citation coverage, alarm and probe counts, test counts. If the reviewer is switched on or the eval gate passes, rewrite M4, A3 and U3 with measured results. Do not rewrite them before that.
- The 9 allow-listed npm advisories expire on 2027-02-01 (the next Expo SDK upgrade); the 3 fast-xml-parser ones can clear earlier, with the aws-amplify update shipped by OTA. If CI goes red then, F4's "audit gates" still holds but its boundary changes.
- A later resume may truthfully add a newly deployed capability; variants must not disagree about facts that were already fixed at the same submission date.