# F04 — r26x review fixes: docs retire (issue #723)

Base: `delivery/r26x-d` (S01, C01, P03 and D01 already merged). Tests: `frontend/tests/docsPaths.test.ts` and
`frontend/tests/rootReadmePaths.test.ts`. The new assertions were committed first (9525754) and failed on the base;
the doc fixes came in the next commit.

### x-interfaces-1
Status: fixed
- Confirmed by running the test itself: `cd frontend && npx vitest run tests/docsPaths.test.ts` on the base failed
  "exist on disk, unless the document says they do not" with the 4 entries the reviewer listed
  (backend-architecture-review → `OutboxPublisher.cs`, `ContentIntelligenceSnapshotImport.cs`,
  `Authoring/ContentIntelligence.cs`; delivery-wave-1.6-plan → `Authoring/ContentIntelligence.cs`).
- Fix: registered the three src_C paths in the existing `paths-not-on-disk` block of
  `docs/backend-architecture-review-2026-09-22.md`, under the R26 retirement line. Registered
  `src_C/Vpc/Authoring/ContentIntelligence.cs` and `frontend/src/pages/ContentIntelligencePage.tsx` in the block of
  `docs/delivery-wave-1.6-plan-2026-09-19.md`. The prose stays as written, because it is history.
- The RETIRED_CITATIONS guard then failed ("…not yet registered by the document" for ContentIntelligencePage.tsx),
  as it was built to. I removed that entry from `frontend/tests/docsPaths.test.ts`. The list is now empty, and the
  mechanism stays for the next frontend-only retirement.
- Proof: the existing "exist on disk…" and RETIRED_CITATIONS tests. The full frontend suite
  (`npx vitest run --testTimeout=30000`) passes: 163 files, 1511 tests.

### d-correctness-1
Status: fixed
- Confirmed: walkthrough §2.4 note, resume bullet 3 (zh and en), evidence row 3 and README §1 all said the outbox
  table was deleted or removed. Contract §0 says the owner runs 045 and the supervisor never does, so until then the
  table and its rows are still in production.
- Fix: each of these places now says the outbox is no longer written in R26. Each also says the table is dropped by
  migration 045, which the owner runs by hand. The §2.4 note and the README add that the table, and the rows in it,
  stay in production until 045 runs. Files: `README.md`, `docs/interview-walkthrough-2026-09-23.md`.
- Tests (failed on base): docsPaths "says migration 045, run by the owner, drops the outbox table — not that it is
  gone" (every walkthrough line that talks about removing the outbox table has to name 045). rootReadmePaths
  "explains the retirement in §1, and leaves the outbox table to migration 045" (every §1 sentence about the outbox
  table has to name migration 045).

### d-correctness-2
Status: fixed
- Confirmed: both resume headers claimed a data platform (zh "数据平台与基础设施", en "data platform and
  infrastructure"), and Q20 offered "数据管道定时化". There was a third stale line the reviewer did not list: the
  5-minute pitch closer (§ 收尾) said "数据管道常态化".
- Fix: removed the data-platform claim from both headers. Q20 and the closer no longer mention the data pipeline,
  and Q20 now points at the Postgres `analytics_daily` rollups. File: `docs/interview-walkthrough-2026-09-23.md`.
- Test (failed on base): docsPaths "claims no data platform or pipeline schedule the retirement withdrew". It checks
  both `> **DeveloperCards**` headers have no 数据平台 / data platform, and that the walkthrough has no
  数据管道定时化/常态化. The struck-through text of withdrawn bullet 3 is deliberately not checked.

### d-tests-1
Status: fixed
- Partly reproduced. The "code still exists" half does not hold on this branch. S01/C01 are merged, and
  `src_C/Vpc/Analytics/OutboxPublisher.cs`, `ContentIntelligenceSnapshotImport.cs`,
  `src_C/Vpc/Authoring/ContentIntelligence.cs` and `frontend/src/pages/ContentIntelligencePage.tsx` are all absent
  (`ls` and the docsPaths failure above both show it). The "table is gone before 045" half is real, and is the same
  defect as d-correctness-1. So is the evidence row 3 overclaim: S01 removed only the outbox insert from the
  ProgressEvents CTE, not the CTE.
- Fix: the 045 wording (see d-correctness-1). Evidence row 3 now says the single-statement ProgressEvents CTE lost
  only the outbox write.
- Tests: the reviewer's optional guard was added as rootReadmePaths "only calls code retired that is really gone".
  It asserts that the four files above are absent, so restoring any of them turns README §1 red. docsPaths also now
  rejects "outbox CTE … 删除".

### d-tests-2
Status: fixed
- Confirmed: `/Snowflake[^\n]*2026-10-02/` was satisfied by the tech-stack row alone, and the README regex by the
  intro sentence alone.
- Fix: the walkthrough test now reads the `### 2.4` section and requires `2026-10-02`, `试用`, `analytics_daily` and
  `无盐` there. The README test finds the §1 paragraph that starts "Snowflake was retired on 2026-10-02" and requires
  `trial`, `analytics_daily` and `unsalted`.
- Proof: these tests pass on the base because the explanation is there. A mutation check stands in for a red run on
  the base: deleting the §2.4 dated note and the README §1 paragraph turned both tests red, 2 failed. Both texts
  were then restored.

### d-tests-3
Status: fixed
- Same defect as d-correctness-2, reported from the test side, with the same fix and the same test ("claims no data
  platform or pipeline schedule the retirement withdrew").

## Notes corrected
- `docs/delivery/r26-issues/D01-notes.md` gets an "R26x correction" section. It says the outbox table is dropped by
  045, not by D01, and lists the doc lines F04 fixed.
