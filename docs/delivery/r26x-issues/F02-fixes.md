# F02 — r26 review fixes (wave c: console retire) — fixes ledger

Round r26x, wave c. Issue #721. Findings from the independent review of C01.

### c-correctness-1
Status: handled in F04

Confirmed against the code: `frontend/tests/docsPaths.test.ts` carries the `RETIRED_CITATIONS`
entry for `docs/delivery-wave-1.6-plan-2026-09-19.md -> frontend/src/pages/ContentIntelligencePage.tsx`
and a guard that fails once that doc registers the path in its own paths-not-on-disk block, so a docs
change made on a branch without C01 would pass its own run and break the integration build.

Per the supervisor, F04 (wave d) owns the docs and the `RETIRED_CITATIONS` entry and fixes this
there: it registers the path in the doc's paths-not-on-disk block and deletes the entry in the same
change. F02 does not edit `frontend/tests/docsPaths.test.ts`.

- Files changed here: none.
- Test: none in F02 (the guard itself is in `docsPaths.test.ts`, changed by F04).

### c-tests-1
Status: fixed

Confirmed: the deleted `frontend/tests/contentIntelligencePage.test.tsx` ("what the header offers each
role" → "shows an em dash when there is no session at all") was the only test of ConsoleShell's
no-session fallback (`: '—'` in `frontend/src/components/console/ConsoleShell.tsx`). The remaining
tests (`consoleShellEverywhere.test.tsx` "derives the user label when a page passes none",
`deckListPagePermissionGate.test.tsx`) cover only the derived ` · super_admin` / ` · editor` labels.

Fix: the case moved into `frontend/tests/consoleShellEverywhere.test.tsx` as
`shows an em dash and no Admin Management link when there is no session at all` — `signOut()`,
mount `ConsoleShell` with no label, expect the header pill to be `—` and no `Admin Management` link.

This is a coverage gap, not a behaviour bug, so the shell source is unchanged and the new test passes
on the base. To show it guards the behaviour, the fallback was mutated locally (`'—'` → `'Signed in'`):
the new case failed (`Tests 1 failed | 6 passed`), and passed again once the mutation was reverted.

- Files changed: `frontend/tests/consoleShellEverywhere.test.tsx`, `docs/delivery/r26-issues/C01-notes.md`
  (the note that only the page's own tests were deleted overclaimed; it now names the moved case).
- Test: `cd frontend && npx vitest run tests/consoleShellEverywhere.test.tsx`.

## Gate status (not a finding)

`F02.verify.sh` step 3 (`npx tsc --noEmit -p . && npx vitest run`) fails on one test that is
outside this issue: `tests/docsPaths.test.ts` › "exist on disk, unless the document says they do
not". It fails identically on the base `delivery/r26x-c` with F02's change absent (checked in a
detached worktree: `Tests 1 failed | 10 passed`). Cause: S01 (`6664447`) deleted
`src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs`, `src_C/Vpc/Analytics/OutboxPublisher.cs`
and `src_C/Vpc/Authoring/ContentIntelligence.cs`, which `docs/backend-architecture-review-2026-09-22.md`
and `docs/delivery-wave-1.6-plan-2026-09-19.md` still cite without a paths-not-on-disk entry. Those
docs are outside F02's scope (and owned by the docs fix round, F04). Everything else passes:
typecheck clean, 162/163 files, 1507/1508 tests.
