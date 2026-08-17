# v9 autorun phase 1 report (2026-05-05)

## Branch
- `v9-autorun-20260505-1643`

## Commits (since branch start)
- `d358962` v9.1 phase 1.1: cardRarity module + test
- `41ccc57` v9.1 phase 1.2: ownedStore module + test
- `0e8c9e2` v9.1 phase 1.3: poolSelection module + tests
- `aaab3af` v9.1 phase 1.4: pity v9 extensions
- `503a8e2` v9.1 phase 1.5: commitDraw wiring + DrawScreen integration
- `3c41bb5` v9.1 phase 1.6: ownership cycle integration test

## Test Summary
- `npm run test:typecheck`: pass
- `npm run test:unit`: pass (`17` files, `81` tests)
- `npm run test:integration`: pass (`29` files, `121` tests)

## Deviations From Spec
- Added `tests/integration/draw-ownership-cycle.test.tsx` shim to import `draw-ownership-cycle.spec.tsx`.
  - Reason: repository vitest include pattern only matches `*.test.ts(x)`, so the required `.spec.tsx` file would not execute without a loader file.
- `commitDraw` uses dynamic imports for `deckRepository` and `review/storage`.
  - Reason: `drawState` re-export of `commitDraw` caused unit parse failure in Node test env when those modules were eagerly imported.

## Pre-existing Tests Updated
- Updated `tests/unit/pity.test.ts` with v9 pity persistence and label assertions.

Diff snippet:

```diff
+it('returns default pity state when nothing is stored', async () => {
+  const state = await loadPityState('csharp');
+  expect(state).toEqual(DEFAULT_PITY_STATE);
+});
+
+it('returns guarantee label when pity remaining is zero', () => {
+  expect(buildPityProgressLabelV9({ draws: 10, threshold: 10 }, 1))
+    .toBe('Next draw guarantees a missing rare or better');
+});
```
