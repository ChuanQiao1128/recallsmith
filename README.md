# RecallSmith

RecallSmith is a spaced-repetition product for developers. It includes an Expo and React Native learner app, a React admin console for authoring and publishing decks, and a .NET 10 backend on AWS with PostgreSQL. This is a personal project written and maintained by one person; AI tools have assisted with implementation and documentation.

## Run locally

Requirements: Node.js 20, the .NET 10 SDK selected by `src_C/global.json`, and Docker for the backend integration tests.

Start the admin console:

```bash
cd frontend
npm ci
npm run dev
```

The committed `frontend/.env.development` configures the console for the development API. Keep Vite on port 5173 because that is the registered Cognito callback. See [frontend setup](frontend/README.md) for the variables and the test type-check details.

Start the mobile app:

```bash
cd mobile
npm ci
npx expo start
```

Run focused suites:

```bash
cd frontend && npx vitest run
cd mobile && npx vitest run
cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests
```

The frontend build runs `tsc -b` before Vite, and this is the frontend type-check gate. `frontend/tsconfig.json` is references-only, so `npx tsc --noEmit` there checks no files. Test files are included through `frontend/tsconfig.test.json`.

## Architecture

| Area | Role |
| --- | --- |
| `mobile/` | Learner app, local review storage and offline sync |
| `frontend/` | Admin console for decks, cards, review and publishing |
| `src_C/` | .NET API and SQS worker on AWS Lambda |
| `pg-layer/` | Node.js Lambda layer for the PostgreSQL driver |
| `infra/` | Terraform and infrastructure runbooks |
| `services/` | Supporting Python Lambda services |
| `docs/` | Design, operations and release evidence |
| `.github/workflows/ci.yml` | Continuous integration |
| `.github/workflows/cd.yml` | Approved production delivery |

An admin request passes through `frontend/src/api/http.ts` to API Gateway and the VPC Lambda, where `src_C/Vpc/Authoring/Publish.cs` creates the job and `src_C/Worker/WorkerFunction.cs` consumes queued work. The mobile app stores review events in `mobile/src/sync/progressSync.ts`, sends them when it can, and pulls account-scoped progress. See [the operations runbook](infra/RUNBOOK.md), [mobile sync design](docs/console-system-design-2026-10-05.md), and [backend architecture review](docs/backend-architecture-review-2026-09-22.md). Other useful entry points are `frontend/src/auth/tokenStore.ts`, `src_C/Vpc/Runtime/ProgressEvents.cs`, `mobile/src/sync/drawStateSync.ts`, `frontend/package.json`, and `mobile/package.json`.

## Delivery and operations

CI validates the mobile and frontend projects, runs a Playwright browser smoke against the built console with stubbed API and Cognito routes, tests the .NET backend, and checks the Python packages, infrastructure, MCP server, n8n recipes and author runner. The frontend build includes TypeScript checks for app and test files. CI does not deploy.

Production CD starts after successful CI on `main`. A credential-free build stages hash-verified artifacts; the production deploy waits for the configured GitHub environment approval and uses OIDC credentials. It records a restore point, deploys selected targets and runs smokes. A newly failing smoke triggers automatic rollback of changed Lambda aliases and web assets. CD does not run database migrations. See [CD operations](infra/RUNBOOK.md#flow) and [restore procedures](infra/RUNBOOK.md#automatic-rollback).

The console has a Sentry integration when its deployment is configured with a DSN; without one, Sentry is disabled in that build. The frontend also has a separate `sendBeacon` error funnel, which sends nothing unless `VITE_ERROR_REPORT_URL` is set. These are distinct paths. See [frontend deployment and reporting](frontend/README.md#deployment).

## Engineering cases and career evidence

- [Engineering cases](docs/showcase/engineering-cases.md): offline sync, publish failure and recovery, and deploy/database restore.
- [Career readiness assessment](docs/showcase/career-readiness.md): evidence for .NET/AWS full-stack roles and the remaining gaps.
- [Portfolio demo plan](docs/showcase/portfolio-demo.md): a script and shot plan under three minutes. It is not a recorded video.
- [Reviewer guide](docs/showcase/reviewer-guide.md): the AI-assisted authoring review flow.
- [Process redesign case study](docs/showcase/process-redesign-case-study.md): evidence and limits for the authoring workflow.
- [Existing demo script](docs/showcase/demo-video-script.md): an earlier short script for the authoring workflow.

## Historical analytics retirement

Snowflake was retired on 2026-10-02. The trial had ended, the pipeline had been run by hand once and was never scheduled, and PostgreSQL `analytics_daily` rollups already provided usage and per-card counts. The retired analytics outbox also carried an unsalted user hash and device id with no consumer reading them. R26 stopped sync writes to the outbox and removed its publisher and the console's Content Intelligence page. The outbox table and its existing rows remain in production until the owner runs migration 045, which drops them permanently; this repository does not claim that migration has run.

## Current operational evidence

The [26 October operations observation](docs/qa/career-readiness-20261026/operations.md) records a read-only, bounded CloudWatch sample. It found 228 sync handler samples and 16 publish-success events in the requested 28-day window. The sample spans releases, does not identify the source version for every observation, and does not establish capacity, end-to-end latency, sync business success or a per-job publish success rate. The source queries and responses are in [operations-source.json](docs/qa/career-readiness-20261026/operations-source.json).

The database restore drill recorded a 26-minute restore and an 8-minute restore-point lag in its 4 October 2026 evidence ([drill record](docs/ops/dr-restore-drill-2026-10-04.md)). It is one drill on the recorded database size, not a service-wide recovery guarantee.

## CI and release details

See the [CI workflow](.github/workflows/ci.yml), [CD workflow](.github/workflows/cd.yml), [backend source](src_C/Vpc/), [worker source](src_C/Worker/), [sync implementation](mobile/src/sync/progressSync.ts), and [offline sync tests](mobile/tests/). The repository also retains detailed design notes and operational history under `docs/`.

## License

MIT. See [LICENSE](LICENSE).
