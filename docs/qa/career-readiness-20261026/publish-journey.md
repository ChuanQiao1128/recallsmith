# Isolated edit → publish → download journey

Run from the repository root with Docker running, .NET SDK 10, Node >=23.6, npm and the existing mobile dependencies available:

```sh
DOTNET_BIN=/Users/qc/.dotnet/dotnet bash scripts/test-publish-journey.sh
```

`DOTNET_BIN` defaults to `dotnet` on other machines. The runner creates a fresh temporary handoff, runs only `PublishJourneyTests`, requires the successful producer artifact, then runs only `publishJourneyArtifact.test.ts`. A producer failure stops the runner before mobile starts. The handoff is removed on exit; no previous run's artifact can satisfy it. No package installation or dependency update is performed.

## What the journey asserts

1. Actual `Decks` and `Cards` authoring handlers create a unique synthetic deck/card in the existing Testcontainers PostgreSQL fixture. `Cards` PUT edits question, explanation and topic with optimistic version control. A separate DB read checks the edit immediately.
2. Actual `Publish` handler persists a PENDING job and produces the captured queue message. That exact message body is delivered to actual `WorkerFunction`, `PublishJobProcessor`, `JobRepository`, `ContentArtifactsGenerator` and `ContentArtifactsRepository`.
3. Worker commits SUCCESS, card count and live build pointer. Actual `ManifestBuilder.RebuildAsync` reads that DB and writes its own manifest into captured object storage. The test does not construct a matching manifest.
4. A C# HTTP client downloads the manifest and its referenced deck bytes through an in-process transport. Assertions tie the DB key, byte count and SHA-256 to the manifest and downloaded bytes, check build/version agreement and the edited card, and require a generated package path.
5. Redelivery of the captured message acknowledges the existing SUCCESS job, retains one SUCCESS row/live pointer and the same immutable object contents, and does not upload the deck again. It invokes the real manifest builder again through its conditional write path.
6. The successful producer writes the exact captured object strings to the handoff. Actual mobile `checkManifestForUpdates`, `installDeckFromUrl`, chunked installer and `resolveDeckBySlug` consume these objects: a fresh chunked install checks the edited card and installed metadata; an unavailable package forces a successful full-file download/hash check; corruption of both chunk and full downloads must reject installation without metadata, final file or temporary files.

## Explicit boundaries

This is an isolated business acceptance journey, including the actual mobile TypeScript importer. It is not a native-device or deployed end-to-end test.

- PostgreSQL is real, isolated and disposable: existing `PostgresFixture` uses `pgvector/pgvector:0.8.6-pg17`, applies repository SQL only inside the test container and removes the container on teardown. It does not connect to the author's or production database. The collection serializes static test seams.
- API Gateway events and Cognito JWT claims are synthetic super-admin input. `Auth.GetAuthContextAsync` and handler authorization run, but gateway routing, JWT signature validation, Cognito and browser authoring UI are outside this test.
- `Publish.TestEnqueueSeam` captures the actual SQS request. Delivery/redelivery is invoked locally; AWS queue delivery, IAM, visibility timing and DLQ behavior are outside this test.
- `IS3DeckUploader` is replaced by a clearly named object-store transport adapter: production `ContentJson.Options` serializes deck bytes and SHA-256 hashes the stored UTF-8 bytes. This does **not** execute `S3DeckUploader`'s `/tmp` streaming/file cleanup, bucket selection, SDK upload or cache header mapping. There is no existing SDK injection seam in that uploader, so no production seam was added. Actual artifact planning, package/chunk serialization, content metadata persistence and manifest logic execute unchanged.
- Actual `ManifestBuilder.RebuildAsync` uses the adapter's SDK Head/Put overrides, including assertions for its content/cache headers, metadata and first/replay conditional writes. AWS S3 consistency/conflict races are not simulated.
- C# HTTP and mobile `fetch`/Expo download transports read only this run's captured objects. Mobile manifests are fetched through the real repository code. Network/TLS/CDN caching are outside this test; unexpected mobile origins fail locally.
- React Native AsyncStorage and Expo filesystem use in-memory adapters; Expo Crypto SHA-256 uses Node crypto. Amplify identity and premium state are synthetic. Actual mobile mapping, package/full fallback, integrity checks and installation orchestration run. Native storage permissions, OS IO failures and a simulator/device are not exercised.
- AI QA gate is explicitly disabled for this free-deck publish; no AI provider is called. Webhook queue is unset and its test seam throws on an unexpected send. The fixture has no webhook subscriptions. This journey does not claim AI QA or outbound-webhook acceptance.

The mobile artifact suite is skipped in ordinary mobile test runs when `RECALLSMITH_JOURNEY_ARTIFACT` is absent. Use the single runner for the linked journey; an independently run mobile suite is not evidence that this backend run produced its inputs.
