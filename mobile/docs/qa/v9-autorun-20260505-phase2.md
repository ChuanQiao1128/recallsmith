# v9 autorun phase 2 report (2026-05-05)

## Branch
- `v9-autorun-20260505-1643`

## Commits In This Run
- `d358962` v9.1 phase 1.1: cardRarity module + test
- `41ccc57` v9.1 phase 1.2: ownedStore module + test
- `0e8c9e2` v9.1 phase 1.3: poolSelection module + tests
- `aaab3af` v9.1 phase 1.4: pity v9 extensions
- `503a8e2` v9.1 phase 1.5: commitDraw wiring + DrawScreen integration
- `3c41bb5` v9.1 phase 1.6: ownership cycle integration test
- `ae33aee` v9.1 phase 1: complete + report
- `2f31be3` v9 phase 2.1: DrawScreen simplification
- `f201556` v9 phase 2.2: DrawResult collection bar + single CTA
- `aa3c331` v9 phase 2.3: Library Missing terminology + collection bar
- `24e31c5` v9 phase 2.4: Home CTA label + study link

## Final Gate
- `npm run test:typecheck`: pass
- `npm run test:unit`: pass (`17` files, `80` tests)
- `npm run test:integration`: pass (`29` files, `123` tests)

## Files Changed Count
- `git diff --stat main...HEAD` summary: `256 files changed, 98620 insertions(+), 4829 deletions(-)`
- Note: this repository branch is ahead of `main` by substantial pre-existing work; run-local delta from this autorun branch point is `26 files changed, 981 insertions(+), 79 deletions(-)`.

## Notable Test Reshaping
- `tests/integration/draw.screen.test.tsx`
  - Updated CTA copy assertions to `Open 10` / `Open 1`.
  - Added explicit 2-CTA presence assertion.
- `tests/integration/draw-result.screen.test.tsx`
  - Replaced old primary/secondary action assertions with wallet-based single-CTA behavior (`Continue draw` vs `Go to Library`).
  - Added assertions for `draw-result-collection-bar` and `draw-result-done-link`.
- `tests/unit/library.test.ts` and `tests/integration/library-final.screen.test.tsx`
  - Updated filter model and UI expectations from `New/Learning/Mastered` to `All/Owned/Missing`.
  - Added focus-slug route-param coverage.
- `tests/integration/home.screen.test.tsx`
  - Updated primary CTA copy expectations to deck-open copy when pulls exist.
  - Added due-cards link assertion.

## Deviations / Independent Decisions
- Added `tests/integration/draw-ownership-cycle.test.tsx` as a shim importing the required `.spec.tsx` test because the project vitest include pattern matches only `*.test.ts(x)`.
- Kept `commitDraw` re-export in `drawState.ts` but used dynamic imports inside `drawCommit.ts` to avoid Node parse failures during unit tests.
- For Library legacy ID compatibility, `library-filter-missing` is the active `testID`, and the same node carries `nativeID="library-filter-unowned"` as alias metadata.

## What’s Left (Deferred)
- Full v9 visual reframe elements intentionally deferred by runbook scope:
  - Home pack carousel (requires new deps / Phase 3 decision).
  - Ceremony 5-phase rewrite (requires Reanimated-level animation expansion).
  - Bottom-sheet Library filter, lucide iconography, haptics, SVG tear-line visuals (all out-of-scope and/or dep-gated).
- `buildPoolDrawResult` remains in `src/mock/draw.ts` with deprecation JSDoc (explicitly retained per runbook).
