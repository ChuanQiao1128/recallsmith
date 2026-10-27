# AWS Basics Console release bundle v1

The authenticated Console route is `/decks/release?deckId=15`, linked from that deck's card list. It is limited to ordinary signed-in `editor` / `super_admin` sessions; backend deck permissions and normal Console token authorization remain authoritative. It does not run a model or perform human per-card review. No credentials belong in a bundle or journal.

`src/types/contentRelease.ts` is the typed contract. `parseReleaseBundle` in `src/lib/contentRelease.ts` rejects missing or extra top-level, card, evidence and per-card review fields, wrong scope, duplicate UIDs/order, absent Chinese/help fields, invalid MCQ/translation shapes, and expired evidence. `tests/support/contentReleaseFixtures.ts` provides a complete synthetic 337-card sample generator. Its synthetic hashes are test placeholders, never production review evidence.

The JSON object has exactly:

```typescript
{
  schema: 'aws-basics-release-bundle-v1',
  deckId: 15,
  deckSlug: 'aws-saa-fundamentals',
  releaseId: string, // nonempty, at most 160 characters; immutable release identity
  cards: ImportCardInput[], // exactly 337, all fields below explicit
  review: {
    runId: string,
    batchAuthorizationRef: string, // existing user authorization reference, not a new claim of human content review
    authorizationScope: 'aws-saa-fundamentals:full-deck-bilingual-release',
    model: string,
    mainSHA: string, // exact 40-hex final main commit
    evidenceRef: string, evidenceHash: string, evidenceVersion: string,
    reportRef: string, reportHash: string, reportVersion: string,
    promptHash: string, promptVersion: string,
    corpusHash: string, corpusVersion: string,
    expiresAt: string, // ISO timestamp strictly in the future, at most 24h
    cards: [{
      stableUid: string,
      verdict: 'PASS',
      cardContentHash: string, // actual backend CardContentHash, not a JSON.stringify hash
      schema: 'legacy-v1' | 'front-help-v1',
      revision: number, // expected actual post-import server revision
      orderInDeck: number,
      blockers: [], unknowns: []
    }] // exactly one for every candidate UID
  }
}
```

Every hash field is a lowercase 64-hex SHA-256. `evidenceRef` / `reportRef` and batch authorization reference permit 2000 characters; model and version strings permit 200; other identifiers permit 160. The authorization scope is fixed. Policy, policyHash, reviewSchema and schemaHash are **not bundle fields**: the page reads them from the current server snapshot when constructing `/release/review`.

Every card has exactly `stableUid`, `question`, `explanation`, `codeSnippet`, `codeLanguage`, `realWorldUsage`, `topic`, `difficulty`, `orderInDeck`, `mcq`, `source`, `frontHelp`, `translations`. The six text fields are strings (empty string for absent optional text), already trimmed except codeSnippet, whose whitespace is preserved. `source` is `{url: httpsUrl, quote: string | null}`. `frontHelp` is an explicit array of up to two `{term,definition}` entries or null. `translations` includes a complete `zh-CN` v1 translation and matching Chinese help entry count. MCQ and translation shapes are the existing Console types, validated with the shared MCQ/translation validators. All existing active UIDs must remain in the 337-card candidate. Nothing soft-deletes omitted cards.

An exporter must bind local model PASS records to the **post-import** server hash/schema/revision/order. `src_C/Vpc/Qa/CardContentHash.cs` defines the backend hash, including PostgreSQL JSON object order, .NET serialization, translations and front-help schema. It is not the pipeline's sorted-key candidate hash. Do not copy a server hash onto an unrelated PASS record, invent a PASS, or label deterministic UI checks as model review. A mismatch blocks review registration. If an exporter cannot establish those expected values from immutable candidate/review/baseline evidence, it must stop; the Console does not guess them.

The page freezes the entire initial `/release/snapshot` response before any write, including all backup rows (deleted rows included), original editingSnapshot and original `deck.live_build_id`. Download the complete backup and recovery journal. That journal also retains the immutable bundle and exact serialized payloads. It is stored in sessionStorage under the signed-in subject; a storage failure blocks dispatch. A downloaded journal can be restored through the recovery file input after closing a tab. Restoring forces a fresh query before any replay.

Only three logical action IDs are used, scoped by deck/release: `import`, `review`, `publish`. The import uses `idempotencyKey=import`; review/publish use `actionId=review/publish`. No error generates another key. Before initial import, the original editing and live baselines must still match. Before review and initial publish, the page fetches snapshot → fully paginated cards → snapshot and checks stable snapshot, all canonical candidate fields, server version/revision, current translations, and local per-card review bindings. Publishing additionally requires the review request's identical editing snapshot. Every action preserves the original expectedLive; it never silently rebases onto a concurrent live build.

After any unsuccessful write response, including a timeout or 503, query `/release/actions` before replay. A query showing `ACTION_NOT_FOUND` permits replay of the original bytes/key. A committed import/review is recovered from the stored API Gateway response. A committed publish with unconfirmed dispatch may replay the same publish request; the backend delivers the same job rather than replacing its generation. Query output shows the actual jobs, receipts and current live pointer. The page always displays `manifestVerified=false`; actual CDN verification is a separate release step.

This adapter does not restore editing rows, revoke evidence, roll back builds, launch a new model review, add a permission grant, or verify CDN publication. It intentionally provides no generic API explorer or arbitrary endpoint input.
