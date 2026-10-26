# Career readiness assessment

## Assessment

RecallSmith provides credible evidence for intermediate .NET/AWS full-stack roles: a .NET 10 API and worker, PostgreSQL persistence, AWS Lambda and SQS workflows, a React/TypeScript admin console, and an Expo/React Native app. The repository also shows technical judgment in offline conflict policies, publishing and replay behavior, delivery rollback boundaries, and explicit limits on operational evidence.

This is a personal project designed, implemented and maintained by one person, with AI tools assisting parts of the work. The mobile product is branded DeveloperCards; RecallSmith is the repository and project name. The evidence shows individual project scope. It does not establish professional seniority, employment history, team leadership, user counts or experience delivering through a larger engineering organisation.

## Evidence to inspect

| Area | Evidence | What it supports |
| --- | --- | --- |
| .NET and persistence | `src_C/Vpc/`, `src_C/Worker/`, `src_C/Vpc/Db/Migrations/`, `src_C/Vpc/Runtime/ProgressEvents.cs` | .NET 10 API and worker, PostgreSQL schema changes, transactional ingestion and merge logic |
| AWS delivery | `.github/workflows/cd.yml`, `scripts/cd/restore-point.sh`, `scripts/rollback.sh` | Credential-free build, approved OIDC delivery, smoke comparison, alias and asset restore |
| Frontend and mobile | `frontend/src/`, `mobile/src/` | React/TypeScript admin console and Expo/React Native learner app |
| Offline state design | `mobile/src/sync/progressSync.ts`, `mobile/src/sync/drawStateSync.ts`, `src_C/Vpc/Runtime/ProgressMerge.cs` | Local event queue, account-scoped state and explicit merge trade-offs |
| Isolated publish acceptance | [publish journey](../qa/career-readiness-20261026/publish-journey.md), [metric and replay contract](../qa/career-readiness-20261026/publish-metrics.md) | Actual handlers and mobile importer exercised under disposable database, queue, storage and network adapters, with boundaries stated |
| Native guest/offline evidence | [native journey](../qa/career-readiness-20261026/native-journey.md) and [Simulator screenshots](images/b2-ios-simulator-qa-persisted-home.png) | Visible guest learning, local draw and restart persistence in an isolated iOS 18.5 Simulator setup |
| Operations and SLO decision | [operations observation](../qa/career-readiness-20261026/operations.md), [SLO review](../qa/career-readiness-20261026/slo-review-20261027.md) | Bounded handler sample and a recorded decision to retain current thresholds without production changes |
| Dependency maintenance | [audit repairs and risk register](../qa/career-readiness-20261026/dependency-alerts.md) | Actual CI audit failures repaired, with accepted/optional risks and expiry retained |
| Integrated test status | [verification tracker](../qa/career-readiness-20261026/verification.md) | Current integration results and source revisions; use its status table rather than inferring a full-suite pass from one check |

The [engineering cases](engineering-cases.md) explain how these pieces fit together and what each test or observation leaves out.

## Senior-level signals and evidence still missing

The code makes explicit choices about concurrent offline state and describes the known losses. The delivery workflow distinguishes restoring code and web assets from restoring a database. The operations records distinguish handler latency from end-to-end and business outcomes. These are useful technical discussion points. The solo project cannot show how decisions were reviewed across a team, how delivery was coordinated among owners, or how a production incident was handled and followed through.

## Ordered evidence gaps

1. **Dependency maintenance and risk ownership.** The new blocking audit findings have targeted candidate fixes, but the default-branch snapshot still contains accepted and optional Critical records. Keep the gates green, validate the optional embeddings environment and handle the mobile exception before 2027-02-01. [The dependency report](../qa/career-readiness-20261026/dependency-alerts.md) distinguishes the repaired CI delta, bundle exclusion and remaining unknown reachability.
2. **Current-version production performance and outcomes.** The 28-day capture spans releases, and current alias snapshots do not identify the code that served every sample. A controlled run tied to a known deployed version needs request volume, cold/warm context, client-side latency, sync success/failure counts and complete publish outcomes. The SLO review retained the 95% within 2,000 ms sync target and existing guards; it did not verify a full qualifying period, replay alert recovery, or change production configuration. Publish remains below its 200-event minimum, and its metric is best effort rather than a durable ledger.
3. **Real cost and usage context.** There is no verified billing-period cost, load-capacity result or user count in this evidence. API requests and infrastructure estimates cannot substitute for those measurements.
4. **Production and real-device coverage.** The native QA validates guest/offline learning, local draws and persistence in an isolated iOS 18.5 Simulator run using current JavaScript in a reused QA native shell with a local RevenueCat compatibility adaptation. It does not verify Cognito auth, cross-device production sync, paid entitlements, production content delivery, a production shell/OTA path, a physical device, VoiceOver quality or FPS. The isolated publish journey uses synthetic identity and local adapters, and bypasses the default manifest freshness/debounce hook.
5. **Team delivery evidence.** A review by another engineer, a team-owned delivery, or a documented incident and follow-up would show collaboration and influence that this personal project cannot demonstrate. Do not imply these have happened without evidence.
6. **A completed portfolio recording.** The repository has a 2 minute 55 second script and genuine QA screenshots. It does not yet contain a recorded three-minute demo. Any recording should show the isolated Simulator guest journey and label it accurately, then use source and acceptance evidence for the backend path without implying production sync or a production publish.

## Role positioning

Use this project to support applications for intermediate full-stack roles involving .NET, AWS and TypeScript, and to discuss its reliability and data trade-offs. For senior roles, present the design reasoning as technical evidence while being clear that the repository does not demonstrate team-scale delivery or sustained, attributable production outcomes.
