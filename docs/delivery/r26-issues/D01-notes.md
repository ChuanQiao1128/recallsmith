# D01 — Docs: retire Snowflake (R26, wave d)

Contract: `~/.rimv-delivery/r26-common/R26-00-contracts.md` §4. Docs and doc-path tests only; no code, infra or mobile change.

## What changed (files)

- `snowflake/` — deleted (`001_content_intelligence_setup.sql`, `README.md`, two sample CSV exports).
- `README.md` — intro no longer says review events flow into Snowflake; it points at the PostgreSQL
  `analytics_daily` rollups. The `snowflake/` row is gone from the §1 directory table, and a paragraph
  under it says Snowflake was retired on 2026-10-02 and why (trial ended and needed a paid card; the
  pipeline ran by hand once and never on a schedule; Postgres rollups already give usage and per-card
  numbers; the outbox carried an unsalted user hash + device id with no consumer). The `snowflake/*.csv`
  entry is gone from the §6 repository map.
- `docs/interview-walkthrough-2026-09-23.md` — tech stack row, architecture sketch, §2.4 (dated
  2026-10-02 update note above the historical design paragraph), whiteboard step 5, Q16/Q19, the §7
  limitations row, both resume headers (Snowflake dropped), resume bullet 3 in both languages marked
  withdrawn, and its evidence/unlock rows. The `snowflake/` citation is reworded away.
- `docs/backend-architecture-review-2026-09-22.md`, `docs/delivery-wave-1.6-plan-2026-09-19.md`,
  `docs/mcq-card-type-plan-2026-09-18.md` — historical records left as written; their
  `snowflake/001_content_intelligence_setup.sql` citation is registered in each document's existing
  `paths-not-on-disk` block.
- `frontend/tests/rootReadmePaths.test.ts` — `snowflake` removed from `TOP_LEVEL`; new test: the
  folder is not on disk, the README cites no `snowflake/` path, and it states the retirement with the date.
- `frontend/tests/docsPaths.test.ts` — `snowflake` deliberately kept in `TOP_LEVEL` (with a comment) so
  every historical citation must be registered as gone, and recreating the folder turns the guard red.
  New `the Snowflake retirement (R26 D01)` block: no folder, no unregistered `snowflake/` citation,
  and the walkthrough explains the retirement with its date.

## Surface shipped

Documentation only. No runtime surface, route, env var, or migration.

## How it is tested

- Tests first: commit 1 adds the three new assertions; they failed on the base (folder present,
  README cites `snowflake/`, walkthrough had no retirement date).
- `cd frontend && npx vitest run tests/docsPaths.test.ts tests/rootReadmePaths.test.ts` — 14 passed.
- `bash ~/.rimv-delivery/r26-d/briefs/D01.verify.sh` — passes.

## Owner steps

None for this issue. (Dropping the warehouse account itself, migration 045 and the IAM role removal are
owned by S01 / P03 and the owner.)

## Deferred

- `docs/delivery/**` historical briefs and verify scripts still name `snowflake/` paths; they are
  records of past rounds and outside the docs-path guard, so they were left untouched.
- Other dated plan docs mention Snowflake in prose (no path citations); left as history.

## R26x correction (F04, issue #723)

- The README and walkthrough said the outbox table had been deleted or removed in R26. That was an overclaim: R26
  stops writing it, and migration 045 drops the table only when the owner runs it. The docs now say this.
- Both resume headers still claimed a "data platform", and Q20 and the pitch closer still listed data-pipeline
  scheduling. These lines are removed. Evidence row 3 now says only the outbox write left the ProgressEvents CTE.
- After S01 merged, `docs/backend-architecture-review-2026-09-22.md` and `docs/delivery-wave-1.6-plan-2026-09-19.md`
  cited deleted src_C files (and the C01 page). These paths are now registered in their `paths-not-on-disk` blocks.
  See `docs/delivery/r26x-issues/F04-fixes.md`.
