# V06 notes: pgvector card embeddings (guarded 038), admin upsert/status, semantic duplicates, vector engine for /cards/similar

Issue #560, contract R20-00 §3 and §5. Zero model cost: the server stores and compares vectors that V04 computes
locally (`BAAI/bge-small-en-v1.5` through fastembed on the owner's Mac). No code path here calls a model, and the
tests use synthetic unit vectors.

## What changed

| File | Change |
|---|---|
| `src_C/Vpc/Db/Migrations/038_card_embeddings.sql` | New. First block: when `vector` is not installed, it creates the extension only if the extension is available on the server AND `has_database_privilege(current_user, current_database(), 'CREATE')` is true. Otherwise it raises a NOTICE (`vector not installed: ...`). Second block: only `if exists (select 1 from pg_extension where extname='vector')` does it `execute` `create table if not exists card_embeddings (card_id bigint pk references cards(id) on delete cascade, model text not null, dim int not null, text_sha256 text not null, embedding vector(384) not null, updated_at timestamptz not null default now())`. There is no ANN index. Idempotent. |
| `src_C/Vpc/Authoring/CardEmbeddings.cs` | New. Canonical text and `TextSha256`, the cached "vector ready" check, the three admin handlers, and `FindSimilarAsync` (the vector engine). |
| `src_C/Vpc/Authoring/CardSimilarity.cs` | `HandleSimilar` parses an optional `embedding`. When one is present and the store is ready, it answers from `CardEmbeddings.FindSimilarAsync`; otherwise it takes the unchanged trigram path. `ScopeWhere` is now `internal` so both engines share the deck and exclude scope. `FindAsync` is unchanged, so the drafts and automation callers keep trigram. |
| `src_C/Vpc/VpcFunction.cs` | Dispatch for the three new paths. They sit after the card reports block. `status` is matched before the bare `card-embeddings` path. |
| `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` | Known routes: `/api/v1/admin/card-embeddings`, `/api/v1/admin/card-embeddings/status`, and the template `/api/v1/admin/decks/:deckId/semantic-duplicates`. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` | The Testcontainers image changes from `postgres:16-alpine` to `pgvector/pgvector:pg17`. This moves the suite from PostgreSQL 16 to 17 and from Alpine (musl) to Debian (glibc). |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardEmbeddingsTests.cs` | New, 10 tests (listed below). |
| `docs/runbooks/automation-operations.md` | New section "Card embeddings and semantic duplicates (R20 V06)", covering the owner step, routes, batch size and rollback. |

No env keys and no Terraform change. All paths fit the existing `/api/v1/admin/*` and `/api/v1/authoring/*` proxy routes.

## API surface shipped

All responses use the `Res` envelope. "Vector ready" means the `vector` extension row exists AND
`to_regclass('public.card_embeddings')` is not null. The answer is cached per container for 5 minutes, both true and false.
`CardEmbeddings.ResetReadyCache()` is the test seam. A vector query that fails with SQLSTATE 42P01, 42703, 42704 or 42883
forgets the cached answer.

- `PUT /api/v1/admin/card-embeddings` (`Auth.RequireSuperAdmin`; other methods → 405)
  - Body `{model:"BAAI/bge-small-en-v1.5", dim:384, items:[{deckSlug, stableUid, textSha256, embedding:number[384]}]}`, 1..200 items.
  - `deckSlug` and `stableUid` are trimmed, 1..128 chars. `textSha256` is 64 hex chars in either case and is compared in lower case.
    `embedding` must be exactly 384 finite JSON numbers and not all zero. The same deckSlug/stableUid may not appear twice.
  - → `200 {upserted, unknownCards:[stableUid], staleText:[stableUid]}`. Both lists keep the request order.
    `unknownCards` means the deck or card is missing or deleted. `staleText` means the item's hash differs from the server's hash
    of the card's current canonical text. Neither kind is stored. The rest are upserted in one statement (`on conflict (card_id)
    do update`, `updated_at = now()`), with one `admin_audit` row `card_embeddings.upsert` (counts only).
  - `400 VALIDATION_ERROR` for a wrong model, a wrong dim, the wrong item count, a vector that is short, NaN, Infinity, a string,
    or all zeros, a bad hash, or a duplicate item. `400 BAD_REQUEST` when the body is not JSON (this includes a bare `NaN`
    literal, which Python's `json.dumps` writes by default). Validation runs before the readiness check.
    `503 VECTOR_NOT_READY` when the store is not ready.
- `GET /api/v1/admin/card-embeddings/status?deckId=` (`Auth.RequireAdmin`)
  - → `{engine:"vector"|"none", model:"BAAI/bge-small-en-v1.5", cards, embedded, stale}`.
  - `cards` counts live cards (card and deck not deleted). `embedded` counts live cards with a stored vector. `stale` counts
    stored vectors whose `text_sha256` no longer matches the card's canonical text.
  - With `deckId`: `404 DECK_NOT_FOUND`, then deck read (403 without the grant). Without it: super_admin sees every deck,
    an editor sees their `can_read` decks. A non-integer `deckId` → `400 VALIDATION_ERROR`.
  - Never 503: without the store, `engine` is `"none"` and `embedded` and `stale` are 0.
- `GET /api/v1/admin/decks/:deckId/semantic-duplicates?minCosine=0.90&limit=50` (`Auth.RequireAdmin` + deck read)
  - `minCosine` must be in 0..1 (default `SemanticDuplicateThreshold` 0.90). `limit` must be in 1..200 (default 50).
  - → `{engine:"vector", minCosine, pairs:[{cosine, a:{cardId, stableUid, question}, b:{...}}]}`.
    Each unordered pair appears once with `a.cardId < b.cardId`. Both cards are live and in the deck. Pairs are sorted by
    cosine, highest first, then by a.cardId and b.cardId. Cosine is `1 - (a <=> b)`, rounded to 4 decimals and filtered on the raw value.
  - Order of checks: `400 VALIDATION_ERROR` (deckId, minCosine, limit), `503 VECTOR_NOT_READY`, `404 DECK_NOT_FOUND`, `403`.
- `POST /api/v1/authoring/cards/similar` gains an optional `embedding: number[384]`, validated as above
  (`400 VALIDATION_ERROR` when malformed).
  - When the store is ready: `engine:"vector"`. `similarity` is the cosine against cards that have a stored vector, in the same
    deck scope and with the same `excludeCardIds`. The request `threshold` (default 0.3) is a minimum cosine and `limit` works
    as before. `likelyDuplicate` is `similarity ≥ 0.90` (`CardEmbeddings.SemanticDuplicateThreshold`).
  - When the store is not ready, or no `embedding` was sent, the response is the unchanged trigram response (`pg_trgm` or `fallback`).
    `text` stays required. The MCP server is unchanged.

Canonical text: `question.Trim() + "\n\n" + explanation.Trim()` (a null explanation becomes empty). `textSha256` is the lower-hex
SHA-256 of its UTF-8 bytes. Pinned digest for `"What is S3?"` / `"Object storage."`:
`657f8dad50869de985f7a8d76cbd7dca0cae9f9a49dba025459e40c2dfe94ebb`. V04 pins the same value. I computed it with
`printf 'What is S3?\n\nObject storage.' | shasum -a 256`.

## How it is tested

`src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardEmbeddingsTests.cs`, against the shared pgvector/pg17 container:

- `Embedding_TextSha256_MatchesPinnedContractDigest`: the §5 digest, trimming, and a null explanation.
- `Embedding_Migration038_WithExtension_CreatesTable_AndAppliesTwice`: the extension is present, 038 runs twice more
  without error, the exact column list and types (`vector(384)`) match, and deleting a card cascades to its vector.
- `Embedding_Migration038_WithoutExtension_NoticeOnly_RoutesAnswerVectorNotReady`: uses a scratch database at 037.
  038 runs twice under `set role` to a role without CREATE (the prod app role), producing exactly two
  `vector not installed` notices, no extension and no table. With `PGDATABASE` pointed at the scratch database:
  PUT and semantic-duplicates → `503 VECTOR_NOT_READY`, status → `engine:"none"`, and `/cards/similar` with an embedding
  returns byte-for-byte the trigram response it gives without one. Then the owner step runs (`create extension vector` as a
  superuser, 038 again), after which the table exists and the store is ready.
- `Embedding_Upsert_StoresFresh_ReportsStaleAndUnknown_ThenUpdatesInPlace`: covers upsert, stale and unknown (missing card,
  missing deck, deleted card), an upper-case hash, update in place, and the audit row.
- `Embedding_Upsert_RequiresSuperAdmin`: an editor with read and write on the deck gets 403 and nothing is stored. POST → 405.
- `Embedding_Upsert_RejectsWrongModelDimNaNAndShape`: covers the model, dim (wrong or missing), 0 and 201 items,
  a 383-long vector, a `"NaN"` string, the zero vector, a bad hash, a blank slug, a duplicate item, a non-object body,
  and a bare `NaN` literal (400).
- `Embedding_Status_CountsCardsEmbeddedAndStale_WithinDeckScope`: checks the exact keys and counts (deleted cards and other
  decks are excluded, an edited card counts as stale), editor 403 without the grant, the editor's scope without `deckId`,
  404, and 400.
- `Embedding_SemanticDuplicates_EachPairOnce_HighestFirst_DeckScoped`: a single pair (a,b) at 0.95 with a < b even when
  b was stored first. With `minCosine=0` there are three distinct pairs, highest first, with no deleted or other-deck card.
  Also covers `limit`, editor 403 then 200 after the grant, 404, and 400 for a bad deckId, minCosine or limit.
- `Embedding_Similar_WithEmbedding_UsesVectorEngine_WithoutKeepsTrigram`: engine `vector` with matches
  `[1.0 dup, 0.92 dup, 0.5 not dup]`. Cards without a vector and cards below 0.3 are left out. Without an embedding the engine
  is `pg_trgm`. A short vector and a string give 400.
- `Embedding_Routes_AreDispatchedByVpcFunction`: status and semantic-duplicates go through `VpcFunction`, plus the route-metric template.

Commands run (from `src_C`):

- `dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~Embedding|FullyQualifiedName~CardSimilarity"`: pass.
- `dotnet test Tests/RecallSmith.Lambda.IntegrationTests`: the whole suite on pgvector/pg17 passed, see the final test run below.

## Owner steps

1. As the RDS master user, run `CREATE EXTENSION IF NOT EXISTS vector;`. If 038 already ran as the app role (NOTICE only),
   also run `DELETE FROM schema_migrations WHERE version = 38;`, because the migrate route skips recorded versions. Then run
   `POST /api/v1/admin/db/migrate` (`scripts/invoke-as-admin.sh`) so 038 creates `card_embeddings`, owned by the app role.
   If the extension is installed before the first migrate, the delete is not needed. Details are in
   `docs/runbooks/automation-operations.md`.
2. Push vectors with `dc-evals embed-cards --deck <slug> --push` (V04), with a super_admin console token in env.

## Deviations and decisions

- The contract's "re-run the migration" needs the `schema_migrations` row for 38 removed first, because
  `Migrate.HandleDbMigrate` never re-applies a recorded version. I documented this rather than changing `Migrate.cs`.
- 038 also checks `pg_available_extensions`, so a privileged role on a server without pgvector files gets a NOTICE
  rather than an error.
- Validation, beyond the contract: the zero vector is rejected (it has no cosine), duplicate items are rejected, and
  `textSha256` must be 64 hex chars. The vector norm is not checked.
- `/cards/similar` with an embedding applies the request `threshold` (default 0.3) as a minimum cosine.
- Status `model` is always the configured model string, even when `engine` is `"none"`.

## Deferred

- No ANN (ivfflat/hnsw) index, per the contract. The exact scan is fine at about 900 rows.
- The request body cap (1 MiB) can reject a 200-item push at full float precision. V04 should batch at 100 or fewer items, or
  round to 6 decimals. See the runbook.
- The MCP `find_similar_cards` tool does not pass an embedding (per the contract).
- Draft submit and the automation duplicate re-check still use trigram only.

## Final test run

- `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (full suite, `pgvector/pgvector:pg17`): 2797 passed, 0 failed, 0 skipped.
  No existing test needed a change for the PostgreSQL 16 → 17 (Alpine → Debian) image switch.
- Targeted (`FullyQualifiedName~Embedding|FullyQualifiedName~CardSimilarity|FullyQualifiedName~RouteMetrics`): 87 passed.
