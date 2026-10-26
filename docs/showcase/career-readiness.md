# Career readiness assessment

## Assessment

RecallSmith provides credible evidence for intermediate .NET/AWS full-stack roles: a .NET 10 API and worker, PostgreSQL persistence, AWS Lambda and SQS workflows, a React/TypeScript admin console, and a React Native/Expo mobile client. The repository also shows senior-level engineering concerns in specific design decisions, including offline conflict policies, delivery rollback boundaries, and explicit limits on operational metrics.

This is evidence from a personal project maintained by one person, with AI tools assisting implementation and documentation. It shows technical scope and individual ownership. It does not establish professional seniority, employment history, team leadership, production user numbers or experience delivering through a larger engineering organisation.

## Evidence a reviewer can inspect

| Area | Evidence | What it supports |
| --- | --- | --- |
| .NET backend | `src_C/Vpc/`, `src_C/Worker/`, `src_C/global.json` | .NET 10 API and queue worker, with PostgreSQL access and integration tests |
| AWS delivery | `.github/workflows/cd.yml`, `scripts/cd/restore-point.sh`, `scripts/rollback.sh` | Build/deploy separation, OIDC delivery, approval, smoke checks, alias and asset restore |
| Relational data | `src_C/Vpc/Db/Migrations/`, `src_C/Vpc/Runtime/ProgressEvents.cs` | Schema evolution and transactional ingestion/merge logic |
| Frontend and mobile | `frontend/src/`, `mobile/src/` | TypeScript admin console and Expo mobile product |
| Offline and distributed-state choices | `mobile/src/sync/progressSync.ts`, `src_C/Vpc/Runtime/ProgressMerge.cs`, `mobile/src/sync/drawStateSync.ts` | Durable local queue, idempotent event replay, account-scoped state, and explicit conflict trade-offs |
| Operational evidence | `docs/qa/career-readiness-20261026/operations.md`, `docs/ops/dr-restore-drill-2026-10-04.md` | A bounded read-only observation and one recorded database restore drill, both with stated limits |

The [engineering cases](engineering-cases.md) explain the design context, failure handling, observed results and known limits for these examples.

## Senior-level signals and evidence still missing

The code includes careful trade-offs: progress counters add while latest-review fields move together; owned collections use union while wallets accept a last-writer-wins loss; deployment rollback restores what CD changed but does not pretend to restore database state. The runbooks describe what an operational signal can and cannot prove.

To support a senior-level claim in hiring, a reviewer would also need evidence from work with people and sustained operation: design decisions reviewed with a team, coordinating delivery across owners, mentoring or technical direction, and handling incidents with their follow-up. The repository is a solo project and cannot supply that evidence by itself.

## Ordered evidence gaps

1. **Tie operational outcomes to a known release.** The October CloudWatch window spans multiple releases, while the alias versions are only current snapshots. A controlled cold/warm run on an identified source version, with request volume and client-side latency, would make performance claims more useful.
2. **Measure business outcomes, not only handlers.** Record sync success and failure counts, and reconcile terminal publish jobs into a complete per-job outcome view. The current 16 publish-success events are below the runbook minimum and do not form a complete per-job success rate.
3. **Build real-world delivery evidence.** A second engineer's review, a team delivery, or a post-incident review would show collaboration and influence that the personal project does not demonstrate. Do not imply these have happened until there is evidence.
4. **Establish user and cost context if relevant.** The current observation does not provide user counts, load capacity or an actual billing-period cost. Use real product analytics or billing evidence only if available and appropriate; do not infer these values from API requests or infrastructure estimates.
5. **Refresh the evidence after pending integration.** A2/A3/B1/B2 work has not been reconciled into this baseline. Recheck the cases and assessment against the integrated code, CI, QA and current operational evidence before using them as final claims.

## Role positioning

Use this project to support applications for intermediate full-stack roles involving .NET, AWS and TypeScript, and to start a technical discussion about reliability and data trade-offs. For senior roles, present the design reasoning as evidence of technical judgment while being clear that team-scale and sustained production evidence remains to be built.
