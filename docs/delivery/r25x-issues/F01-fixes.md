# F01 — r25x review fixes: draw pool (issue #701)

Base: `delivery/r25x-g`. Test file for every finding: `mobile/tests/unit/drawPoolEffectiveOwned.test.ts`.

### g-correctness-1
Status: fixed
- Confirmed: `ownedAfter` was `ownedAfterSet.size`. The set unions drawState.owned, `readStoredDeckProgress`
  (no deck filter) and `loadStarterUids`, none filtered to `deck.Cards`. Reproduced: 4-card deck,
  drawState.owned `[c1, retired-drawn]`, stored progress learned `[c2, retired-learned]`; drawing the last two
  cards returned `ownedAfter` 6 of 4. A retired starter-lesson uid gave 7 of 6.
- Fix: `mobile/src/features/gacha/draw/drawCommit.ts` — `ownedAfter` = number of distinct deck cards in the
  effective set (`countInDeck`). The pool was already deck-only, so draws are unchanged.
- Tests (fail on base, pass now): "ownedAfter counts only cards still in the deck", "ownedAfter does not count a
  retired starter-lesson card".

### g-tests-1
Status: fixed
- Same defect as g-correctness-1 from the test side. Fixed by the same change. The new tests put a retired uid in
  drawState.owned and in stored progress (and one in the starter lesson) and check
  `ownedAfter <= totalCards`.
- Notes: `docs/delivery/r25-issues/G01-notes.md` no longer says the counter always matches the Library. It now says
  the counter counts deck cards only and matches the Library for migrated progress.

### g-tests-2
Status: fixed
- Confirmed: no test made the progress read fail. With the try/catch in `loadDrawPoolOwned` removed, the whole suite
  stayed green on base.
- Tests added (in `mobile/tests/unit/drawPoolEffectiveOwned.test.ts`; the AsyncStorage mock can now reject reads
  per key):
  - "a failed progress read still draws from the deck minus owned and starter": `getItem` throws for the progress
    key. commitDraw draws exactly deck − (owned + starter).
  - "corrupt stored progress counts as nothing learned": invalid JSON under the progress key.
  - loadDrawStatus "a failed progress read falls back to owned + starter, keeping the countdown": the pack is not
    complete, and the countdown label stays, which shows the inner fallback ran and not the outer catch.
  - loadDrawStatus "is not complete when every read fails": `collectionComplete` false.
- Mutation check: with the try/catch removed from `loadDrawPoolOwned`, the first and third tests fail. Restoring it
  makes them pass. These tests pin behaviour that already works on base, so no source change was needed.

### g-tests-3
Status: partially fixed
- Confirmed: the draw reads only the current progress key (`readStoredDeckProgress`). Progress that lives only
  under a legacy/global key is not seen until `loadDeckProgress` (Library/Home) migrates it. The "same set the
  Library counts" claim was too broad.
- Fixed: the claim is narrowed in the `drawPool.ts` doc comment and in `G01-notes.md`. New test "progress only under
  a legacy key is not read until it is migrated" pins the behaviour. Before migration, a learned card stored only
  under the legacy key is outside the pool's owned set, and a draw writes neither the current key nor the legacy
  key. After `loadDeckProgress`, the card is excluded.
- Not done: a parity fallback that reads the legacy keys. The key builders and `tryLoadLegacyProgress` are private
  to `mobile/src/review/storage.ts`, which is outside this issue's scope. Copying the key schema into the draw module
  would add a second copy that could drift from the first. The gap needs a user who has not opened the Library or
  Home since upgrading from a pre-Phase-0 build. Follow-up: export a read-only legacy read from `review/storage.ts`
  and use it in `loadDrawPoolOwned`.

## Files changed
- `mobile/src/features/gacha/draw/drawCommit.ts`
- `mobile/src/features/gacha/draw/drawPool.ts` (comment only)
- `mobile/tests/unit/drawPoolEffectiveOwned.test.ts`
- `docs/delivery/r25-issues/G01-notes.md`
- `docs/delivery/r25x-issues/F01-fixes.md`
