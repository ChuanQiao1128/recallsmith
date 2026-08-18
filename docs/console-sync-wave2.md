# Enterprise Wave 2 — sync keyset pagination + console pagination + manifest conditional GET

> Status: IMPLEMENTED 2026-07-11; **DEPLOYED TO AWS 2026-07-13** together with content-delivery-v3
> (core-vpc version 43, aliases prod+dev repointed from v42; worker-lambda $LATEST; migrations 011+012 applied;
> csharp-basics republished → build 20260713T001338Z-f09254ed with package/chunks/patch; manifest rebuilt and
> live on CloudFront; rollback = repoint aliases to v42, backups of the previous zips retained locally).
> Companion to docs/content-delivery-v3.md (same day, deck-download path). NOT COMMITTED to git yet — see
> commit hygiene below. The console is a locally-run tool (no cloud hosting): next `npm run dev` uses the new code.
> Mobile changes (drain loop, chunked install, sha256 verify, ETag) ride the next App Store release; the
> already-shipped app benefits from server-side delta patches immediately (its patch protocol was already live).

## What shipped

### A. Sync pull keyset pagination (correctness fix + heavy-user convergence)

- **Bug fixed**: the legacy pull cursor was `max(updatedAtMs)` with a strict `>` — push batches share one
  transaction-stable `now()`, so rows straddling a page boundary (or a sync boundary) at the same timestamp were
  permanently skipped. Verified against a real Postgres 16 instance (sub-millisecond residuals included).
- Server (`src_C/Vpc/Runtime/ProgressGet.cs`, `src_C/Vpc/Pagination/KeysetCursors.cs`): optional `cursor` param
  (base64url tuple incl. exact **microsecond** timestamp — ms rounding provably cannot express the boundary),
  sargable row-comparison predicate, additive `nextCursor`/`hasMore` response fields, **nextCursor returned for
  any non-empty page including the last** (clients persist it across syncs — that is where the skip bug lived).
  Legacy `sinceMs` path kept byte-for-byte (deployed App Store clients).
- Mobile (`mobile/src/sync/progressSync.ts`): `while(hasMore)` drain loop (hard cap 20 pages/sync), cursor
  persisted only after a batch applies, v2 cursor in a NEW storage key (v1 ms key untouched, dual-written),
  old servers behave exactly as today (feature-detect). **Self-heal**: a 400-rejected cursor is cleared and the
  page retried via `sinceMs` — a corrupt cursor can no longer permanently break pull
  (`mobile/src/api/apiClient.ts` now attaches `status`/`apiErrorCode` to thrown errors, additive).
- Migration `013`? No — `src_C/Vpc/Db/Migrations/012_sync_keyset_index.sql`: composite keyset indexes for
  `user_progress` and `decks` (plain CREATE INDEX; CONCURRENTLY noted for at-scale out-of-band use).

### B. Console (publishing console) pagination

- New endpoint `GET /api/v1/admin/decks?limit&cursor&q` (`src_C/Vpc/Authoring/AdminDecks.cs`): keyset
  `(updated_at DESC, slug DESC)`, parameterized escaped ILIKE search, `items` include `id`/`deckType` so the UI
  needs no per-row lazy id resolution, super_admin (matches AdminManifest). Replaces the console's dependency on
  proxying the whole `manifest.json` through Lambda (6MB response cap ≈ dead console near 10k decks).
- Console (`frontend/src/pages/DeckListPage.tsx`, `frontend/src/pages/deckListPagination.ts`,
  `frontend/src/api/authoring.ts`): paginated load + Load more + 300ms-debounced server-side search; feature-detects
  the endpoint (404/403 → legacy full-list fallback); **non-superadmin sessions start in legacy mode directly**
  (no doomed 403 probe); status badge from `latestBuildId` (no manifest fetch in paginated mode); pagination state
  logic extracted to a pure React-free module (first thing to unit-test when the console gets a test runner).
- Bonus fix: console deck-delete sent the id in a DELETE **body** while the server reads the **query string** —
  delete was silently broken; now uses `?id=`.

### C. Mobile manifest conditional GET

- `mobile/src/content/deckRepository.ts`: manifest ETag persisted in a sibling AsyncStorage key; requests send
  `If-None-Match`; 304 → serve cache (fresh); 200 → update cache+ETag; errors keep today's fallbacks.
  Kills the "every screen mount re-downloads the whole catalog" cost with zero server change.

## Gates (all green, run after review fixes)

- mobile: typecheck + **123 unit + 146 integration** vitest (baseline 112/146 + wave tests incl. 400-self-heal case)
- src_C: Vpc + Worker build 0 errors; **83** xUnit (incl. cursor codec round-trip/rejection, ILIKE escaping;
  cursor SQL semantics verified against a disposable real Postgres 16)
- frontend: `vite build` + scoped `tsc --noEmit` over the active import graph (repo-wide `tsc -b`/`eslint .` are
  red on pre-existing owner WIP files — " 2.tsx" Finder copies etc. — unrelated to this wave)

## Deployment (owner-run, manual)

1. Deploy Vpc lambda (Worker unchanged by this wave, but redeploy if shipping together with content-delivery-v3).
2. `POST /api/v1/admin/db/migrate` → applies 012 (and 011 if not yet applied).
3. Deploy the console frontend (`cd frontend && npm run build`, upload dist as usual). Note: repo-wide
   `npm run build` currently fails on owner-WIP files — clean those or build from a clean checkout.
4. Mobile changes ride the next App Store release. Order-independent: old app + new server and new app + old
   server are both explicitly supported (feature detection on both sides).

## Commit hygiene (important)

Four files mix this wave's hunks with earlier uncommitted work (owner WIP and/or content-delivery-v3):
`progressSync.ts`, `deckRepository.ts`, `frontend/src/api/authoring.ts`, `VpcFunction.cs`. Use `git add -p`
to pick hunks per wave, or commit v3 + wave-2 together after reviewing. Pure-new files can be added whole:
`KeysetCursors.cs`, `ProgressGet.cs`, `AdminDecks.cs`, `012_sync_keyset_index.sql`, the C# tests,
`deckListPagination.ts`, and the mobile test files. A stray `// experiment: tweak` at the end of
`frontend/src/api/authoring.ts` belongs to owner WIP — clean before committing.

## Still open (documented, deliberate)

- Manifest sharding (index + shards) for 3k+ deck catalogs — conditional GET reduces cost, not peak size.
- SQLite row storage + paged reads on device.
- `RequireAdmin`+permission-join variant of `/api/v1/admin/decks` if editors should use the paginated list.
- Server-side status/tier filters for the console (client-side only today, per loaded pages).
- Console test infrastructure (vitest) — pagination logic is already extracted pure for it.

<!-- paths-not-on-disk
     本文档里出现、但磁盘上确实没有的仓库路径，逐条登记在这里。
     一条 = 一行 "- 路径"；其余文字是说明，不会被读成条目。
     规则与双向核对方式见 frontend 的 tests/docsPaths.test.ts 文件头。
     登记 ≠ 改写历史：上文那句记的是这一波改了哪些文件，时态与措辞保持原样。

     - frontend/src/pages/deckListPagination.ts   2026-08-18 阶段 D 搬到
       frontend/src/features/deckList/deckListPagination.ts（纯 git mv，内容未改）。
-->
