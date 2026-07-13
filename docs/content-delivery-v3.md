# Content Delivery v3 — chunked packages + server-generated delta patches

> Status: IMPLEMENTED 2026-07-11; **DEPLOYED TO AWS 2026-07-13** (core-vpc v43 via prod/dev aliases,
> worker-lambda $LATEST, migrations 011+012 applied, csharp-basics republished — the 115-card deck now ships a
> 435 B package + one 201 KB chunk + a 327 B delta patch vs the previous build; manifest carries
> sha256/packagePath/patches and is live on CloudFront. Not yet committed to git.)
> Scope: free live decks only. Premium full decks keep single-file presigned download (patches/chunks in the
> public content bucket would leak premium content; presigning per-chunk is a follow-up). Premium previews are
> out of scope because no in-repo generator writes preview files today.

## Why

- `deck.json` is downloaded whole-file with no integrity check, no resume, and re-downloaded fully on every
  publish (server never generates the delta patches the client already supports — `ManifestRebuild.cs` wrote
  `patches: null` unconditionally).
- Immutable build-scoped objects were cached for only 300s at the CDN.
- Latent contract bug: Worker serialized `deck.json version = decks.version` (int), while the manifest `version`
  is the buildId string; the client's `installDeckFromUrl` rejects the file on `flat_remote_version_mismatch`.
  (Live content was produced by an older pipeline where version == buildId, so the bug bites on the next publish.)

## Contract (client already ships this; server must match EXACTLY)

Client: `mobile/src/content/deckRepository.ts`.

- Manifest entry (camelCase): `patches?: PatchEdge[] | null` where
  `PatchEdge = { fromVersion: string; toVersion: string; path: string; sha256?: string | null }`.
  `path` is relative to `manifest.prefix` (i.e. the S3 key minus the leading `content/`).
- Delta file (`DeckDelta`):
  `{ schemaVersion: 2, slug, fromVersion, toVersion, generatedAtMs, deck?: { slug, title, locale, deckType, version, totalCards }, added?: Card[], updated?: Card[], deleted?: string[] }`
- Card JSON shape (camelCase):
  `{ stableUid, orderInDeck, difficulty, question, explanation, codeLanguage, codeSnippet, realWorldUsage, revision }`
- Client applies patches only when the local file parses as the flat deck shape and walks a BFS chain of at most
  `MAX_PATCH_HOPS = 4` edges; any failure falls back to full download.
- Full-download validation requires `deck.json .version === manifest entry .version (buildId)`.

## New server-side artifacts (all under the immutable build dir, all best-effort)

For a free-deck publish `content/decks/{slug}/builds/{buildId}/deck.json`:

1. **deck.json fix**: `version` field = `buildId` (from `deck_publishes.build_id`), not `decks.version`.
2. **Chunked package** (`schemaVersion: 1`):
   - `content/decks/{slug}/builds/{buildId}/package.json`:
     `{ schemaVersion: 1, slug, version: buildId, deck: { slug, title, locale, deckType, version: buildId, totalCards }, totalCards, chunks: [{ seq, path, bytes, sha256, cardCount }] }`
     `chunks[].path` is manifest-relative (`decks/{slug}/builds/{buildId}/chunks/{seq}.json`).
   - `content/decks/{slug}/builds/{buildId}/chunks/{seq}.json`:
     `{ schemaVersion: 1, slug, version: buildId, seq, cards: [...] }`, ≤ 500 cards per chunk, cards in
     `orderInDeck, id` order (same as deck.json).
3. **Delta patch** vs the previous SUCCESS build of the same slug (if any):
   - `content/decks/{slug}/patches/{fromBuildId}-{toBuildId}.json` in the `DeckDelta` shape above.
   - `updated` = stableUid present in both builds with ANY of the 9 card fields differing; `added` = new uids;
     `deleted` = uids that disappeared. Skip the patch entirely if its serialized size ≥ the full deck.json size.
4. **Hashes**: sha256 = lowercase hex over the exact serialized UTF-8 bytes uploaded. Whole-file sha256 for
   deck.json; per-chunk sha256 in package.json; patch sha256 on the manifest edge.
5. **Cache-Control**: every build-scoped object (deck.json, package.json, chunks, patches) →
   `public, max-age=31536000, immutable`. `manifest.json` stays `max-age=60`.

All generation is wrapped in try/catch and MUST NOT fail the publish job (missing table/columns before the
migration runs = logged skip, publish still succeeds).

## DB (migration `011_content_delivery_v3.sql`, existing runner: superadmin `POST /api/v1/admin/db/migrate`)

- `deck_publishes` + `content_sha256 text`, `content_bytes bigint`, `package_key text` (manifest-relative path).
- New `deck_build_patches (deck_slug, from_build_id, to_build_id, rel_path, s3_key, sha256, bytes, created_at,
  UNIQUE(deck_slug, from_build_id, to_build_id))` + index `(deck_slug, created_at DESC)`.
- Idempotent DDL following the 007/008 style.

## ManifestRebuild wiring (Vpc)

- Latest-build query tries the extended column set (`content_sha256`, `package_key`); on `42703` (column
  missing) falls back to the legacy query — deploying Vpc before running the migration must not blank the manifest.
- Patch edges: newest ≤ 4 rows per slug from `deck_build_patches` (window `row_number()`), `42P01`-tolerant.
- Free live entries now fill: `sha256`, `packagePath`, `patches: [{fromVersion, toVersion, path, sha256}]`.
  `previewPatches` stays null.

## Client (mobile) changes

- `src/content/chunkedInstall.ts` (new): fetch package.json → validate slug/version → download chunks with
  3-way concurrency into `chunks/{slug}.{version}/{seq}.json` under the user deck dir → per-chunk sha256 verify
  via `expo-crypto.digestStringAsync(SHA256, text)` (case-insensitive compare) → **resume**: an existing chunk
  file that hash-verifies is reused, a corrupt one is re-downloaded → assemble cards (concat, sort by
  `orderInDeck`), validate stableUids and count === totalCards → write flat deck.json to a tmp file → atomic
  move to the final path → clean the chunk dir (and stale chunk dirs of other versions). Any error returns
  `{ ok: false }` — the caller falls back to whole-file download. No throw escapes.
- `deckRepository.ts` (surgical edits only):
  - `RawManifest` deck type + `packagePath?: string | null`.
  - `installDeckFromUrl`: after the patch attempt and before full download, if the entry has `packagePath` and
    this is not a preview install → try chunked install; success writes the same `DeckInstallMeta` and returns.
  - Full download path: `_remoteSha256` → `remoteSha256`; when present, verify the downloaded text's sha256
    before finalizing (`fail('sha256_mismatch')` on mismatch; null = skip, so old manifests keep working).
  - `tryPatchUpdate`: when `edge.sha256` is present, verify the fetched delta text before applying.
- expo-crypto is already a dependency (`~15.0.8`); use `digestStringAsync`, NOT node `crypto`.

## Tests

- C# (`src_C/Tests/RecallSmith.Lambda.IntegrationTests`, pure unit, no docker): DeckDiff add/update/delete/
  no-op + per-field sensitivity; ChunkPlanner boundaries (0/1/500/501/1500); serialized patch + package JSON
  field names match this contract byte-for-byte (camelCase, `fromVersion`/`toVersion`/`added`/`updated`/`deleted`).
- Mobile (`tests/unit/*.test.ts` — `.spec.ts` is not collected): chunked happy path (order restored across
  chunks), sha256 mismatch → `{ok:false}`, resume reuses verified chunk / re-downloads corrupt chunk, version
  mismatch → `{ok:false}`; mock `expo-file-system/legacy` (in-memory map), `expo-crypto` (node crypto sha256),
  `fetch` (in-memory registry), per existing self-mock conventions.

## Gates (all must be green)

- `dotnet build` Worker + Vpc + Public; `dotnet test src_C/Tests/RecallSmith.Lambda.IntegrationTests`.
- `cd mobile && npm run test:typecheck && npm run test:unit && npm run test:integration` (baseline: 96 + 146).

## Deployment (manual, owner-run — no CI in this repo)

1. Package + deploy Worker and Vpc lambdas (`src_C/package_lambda_zip.sh`, console upload as usual).
2. `POST /api/v1/admin/db/migrate` (superadmin) → applies 011. (Deploy order is safe either way: artifact
   generation is skip-on-missing-table, manifest rebuild is column-fallback.)
3. Republish each live deck from the console → generates package/chunks/patch + fixes deck.json version.
4. `POST /api/v1/admin/manifest/rebuild` → manifest now carries `sha256`/`packagePath`/`patches`.
5. Ship the mobile update (chunked + verification path) through the normal app release.

## Known follow-ups (documented, deliberately out of scope)

- Manifest sharding + ETag/If-None-Match conditional fetch (catalog-scale problem, separate change).
- SQLite row storage + paged reads on device (removes whole-deck JSON.parse; biggest client refactor).
- Automatic manifest rebuild (the `MANIFEST_QUEUE_URL` consumer/Builder Lambda described in docs/publish.md
  does not exist in-repo; rebuild remains a manual superadmin POST).
- Premium full-deck patches/chunks via presigned URLs.
- Sync pull keyset cursor + `hasMore` (correctness fix, separate change).
