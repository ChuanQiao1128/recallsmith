# RecallSmith engineering cases

RecallSmith is a personal project designed, implemented and maintained by one person, with AI tools assisting parts of the work. The app is branded DeveloperCards; RecallSmith is the repository and project name. These cases separate code evidence, isolated acceptance and bounded production observations. They do not treat one as proof of the others.

## 1. Guest learning when the app is offline

### Constraint and behavior

The bundled SAA-C03 starter pack lets a guest begin learning without authentication or a content download. In the current native journey, a learner opens the first lesson card, uses **Show answer** and **Got it** through five cards, receives the lesson's five bootstrap draws, opens a draw, and returns to Home. A terminate/relaunch check compares local content, progress, wallet, collection, history, goal and onboarding state.

The test uses current JavaScript in a copied, isolated iOS 18.5 Simulator app. A network guard blocks remote fetch, XHR, WebSocket and remote file transfers while the bundled `file://` starter remains available. The test does not seed or replace learning and reward state. The screenshots show the offline starter card, an actual draw result, and Home after relaunch.

### What this proves, and what it does not

This is visual and persistence evidence for the guest/offline flow in that Simulator setup. The native app shell was reused from a local QA build and adapted for this run, including a local RevenueCat initializer compatibility change. This is not a newly compiled production shell. The journey does not verify Cognito authentication, cross-device sync, paid entitlement or purchases, production content delivery, OTA behavior in a production binary, physical-device behavior, VoiceOver quality, or frame rate.

See the [native journey record](../qa/career-readiness-20261026/native-journey.md) and [integrated verification tracker](../qa/career-readiness-20261026/verification.md).

## 2. Isolated edit, publish and install journey

### Constraint and coverage

The publish path crosses authoring handlers, PostgreSQL, a queue message, a worker, a manifest and a mobile importer. The linked acceptance journey uses the actual authoring and worker business logic with a disposable PostgreSQL Testcontainers database. It creates and edits a synthetic deck, captures the actual queue message, processes and replays it, rebuilds a manifest, downloads captured artifact bytes, and has the actual mobile importer install the deck. Assertions cover the edited card, database live pointer, manifest bytes and hash, chunk install, full-file fallback and rejection when both download forms are corrupted.

The current publish metric policy distinguishes a publish's stored terminal state from the handler-observed metric events. Healthy terminal replays emit no replacement success or failure event. A manifest failure on a successful publish can report an item failure so the manifest can be repaired on redelivery; that makes the metric a best-effort discoverability signal rather than an exactly-once job ledger. Crashes, missing metric logs, and a repaired success replay can leave the SLI without an event.

### Test boundaries

This is an isolated business acceptance path. It uses synthetic super-admin claims, captures SQS locally, substitutes an object-store adapter for the production S3 uploader and uses local mobile HTTP, AsyncStorage and filesystem adapters. Expo Crypto hashing uses Node crypto. The worker is injected with an unconditional manifest rebuild delegate, so the journey bypasses the default manifest freshness/debounce decision that can rebuild or skip based on metadata. A separate pure predicate test does not verify that default hook's integration.

It does not verify API Gateway or Cognito JWT authentication, the production S3 SDK uploader and its file cleanup, AWS queue timing/DLQ, real network/CDN behavior, native storage permissions, OS I/O failures, or the default freshness/debounce hook. AI QA and webhooks are disabled. The journey therefore demonstrates the connected business path under its named adapters, not deployed end-to-end behavior.

See the [publish journey](../qa/career-readiness-20261026/publish-journey.md), [publish metric and replay contract](../qa/career-readiness-20261026/publish-metrics.md), [SLO evidence review](../qa/career-readiness-20261026/slo-review-20261027.md), and [integrated verification tracker](../qa/career-readiness-20261026/verification.md).

## 3. Delivery recovery and operational limits

Production CD builds without AWS credentials, waits for the approved GitHub environment, then uses OIDC credentials to deploy selected targets. It records a restore point, verifies artifacts, and compares post-deploy smokes with a baseline. A newly failing check restores changed aliases and web assets. CD does not migrate the database, and code rollback cannot undo a database migration.

The 4 October restore drill took 26 minutes 10 seconds from restore request to database availability; the app check completed after 26 minutes 25 seconds. The measured restore-point lag was 8 minutes 3 seconds. This is one drill on the recorded database and configuration, not a recovery-time guarantee for a future incident.

The 27 October SLO review retained the configured sync target of 95% of handler requests within 2,000 ms and the existing event guards. The read-only capture had 228 sync samples and 16 publish-success events, but spans releases, cannot attribute every sample to one source version, and does not establish client latency or sync business success. Publish remains below its 200-event minimum, and actual billing-period cost is unknown. No alarm or production configuration changed in that review.

See the [restore drill](../ops/dr-restore-drill-2026-10-04.md), [SLO evidence review](../qa/career-readiness-20261026/slo-review-20261027.md), [operations observation](../qa/career-readiness-20261026/operations.md), and [integrated verification tracker](../qa/career-readiness-20261026/verification.md).
