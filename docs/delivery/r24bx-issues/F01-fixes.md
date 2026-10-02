# F01 (#679) — r24b review fixes: draw copy

Round r24bx, wave w. Base: `delivery/r24bx-w`. Every finding was checked against the code before any change.

### w-correctness-1

Status: fixed

- Confirmed: `DrawResultScreen.tsx` rendered the summary strip as `${summary.COM} COM`, `${summary.RAR} RAR`,
  `${summary.LEG} LEG`, and `tests/integration/draw-result.screen.test.tsx` pinned `['0 COM', '1 RAR', '1 LEG']`.
- Test first: the strip test now expects `['0 Common', '1 Rare', '1 Legendary']` and no `COM|RAR|LEG` word;
  it failed on the base (received `0 COM` …), passes after the fix.
- Fix: the chips reuse the existing `rarityLabel()` (Common / Rare / Legendary, the kept words of contract §1).
  Only the visible text changed; the `summary.COM/RAR/LEG` keys, styles and testIDs keep their names.
- Files: `mobile/src/screens/DrawResultScreen.tsx`, `mobile/tests/integration/draw-result.screen.test.tsx`.
- Test: `draw-result.screen.test.tsx` › "renders rarity strip in Common, Rare, Legendary order with plain words".

### w-tests-1

Status: fixed

- Confirmed: neither 'Checking remaining draws' nor 'Unable to load Draw right now.' appeared in `mobile/tests`.
- 'Checking remaining draws': the wallet-loading test ("keeps primary CTA non-routable until wallet pulls
  resolve") now asserts the primary CTA's `accessibilityLabel`.
- 'Unable to load Draw right now.': every `setLoadState('error')` path in `DrawScreen.tsx` also sets a message
  (`errorToMessage()` always returns a string), so no render reaches the `error ?? …` fallback. A render test
  cannot show it without changing behaviour, so the new `mobile/tests/unit/drawScreenCopy.test.ts` pins it as
  source text and fails if `DrawScreen.tsx` or `DrawResultScreen.tsx` contain `remaining pulls` or
  `draw chamber` again.
- These are coverage additions for copy that was already correct, so they pass on the base by design
  (no code defect to fail on).
- Files: `mobile/tests/integration/draw-result.screen.test.tsx`, `mobile/tests/unit/drawScreenCopy.test.ts`.
- Tests: `draw-result.screen.test.tsx` (wallet-loading case), `drawScreenCopy.test.ts`.

## Other change needed for the gate

- `mobile/tests/unit/plainWordsGuard.test.ts` failed on the base: its "keeps PENDING honest" test requires a
  module to leave `PENDING` once it is clean, and after the r24b release merge all five listed modules
  (`ceremonyCopy.ts`, `homeSelectors.ts`, `summaryMapper.ts`, `rewardResolver.ts`, `mcqConstants.ts`) are
  clean. As the file's own comment says, the release merge empties the list: `PENDING` is now `[]`, so the
  guard scans all modules (15 tests, all green). No module, pattern or allow-list entry was loosened.

## Original notes

`docs/delivery/r24b-issues/W01-notes.md` now lists the summary chips row and no longer leaves the two strings
as unpinned.

## Gates

`cd mobile && npx tsc --noEmit && npx vitest run`: 291 files, 2249 tests pass.
