# G01 — Draw pool excludes every card the Library shows as collected

Contract: R25-00 §1. Issue #691.

## What changed (files)
- `mobile/src/features/gacha/draw/drawPool.ts` (new)
  - `loadDrawPoolOwned(slug)`: the set a draw treats as "already collected" =
    `resolveEffectiveOwned(slug, progress)` (drawState.owned + learned cards + open starter-lesson cards).
    Progress is read with `readStoredDeckProgress` (read only, no migration or reconcile writes); a failed or
    missing read counts as "nothing learned", so the draw falls back to owned + starter instead of failing.
    Because it reads only the current progress key, progress that still lives only under a legacy/global key
    is not seen until the Library or Home has run `loadDeckProgress` (r25x F01 g-tests-3).
  - `loadDrawStatus(slug, deckCards)`: moved here from `DrawScreen.tsx` (same behaviour and failure handling),
    now computed from the effective set: "Collection complete" and the rare-guarantee countdown label.
- `mobile/src/features/gacha/draw/drawCommit.ts`
  - The pool passed to `selectDrawCards` excludes the effective set, so the rare guarantee
    ("missing Rare or better") and the "nothing left to draw" (`poolExhausted`, zero cards) result follow it too.
  - Only the drawn cards are written to `drawState.owned` (learned/starter cards stay a read-time union).
  - `ownedAfter` is the effective count (drawn + effective before) over the deck's current cards only, so a
    retired uid still in drawState.owned, stored progress or the starter lesson never counts (r25x F01
    g-correctness-1). It equals the Library's count once progress is migrated and reconciled.
  - The draw-history `ownedBefore` records the effective set, so `replayDraw` rebuilds the same pool.
- `mobile/src/screens/DrawScreen.tsx`: imports `loadDrawStatus` from `drawPool.ts` (local copy removed).
- `mobile/tests/unit/drawPoolEffectiveOwned.test.ts` (new).

## Surface shipped
- A learned card or an open starter-lesson card is never drawn, never shows NEW and never costs a draw.
- The rare guarantee only hands over a Rare/Legendary missing from the effective set.
- The Draw screen shows "Collection complete" (and disables the draw) when every card is in the effective set,
  including when only learned cards were missing from drawState.owned.
- The result screen's "owned/total" counter counts deck cards only (never above total); it matches the Library
  for migrated progress (see the legacy-key limit above).

## How it is tested
`mobile/tests/unit/drawPoolEffectiveOwned.test.ts` (real AsyncStorage mock, real review storage, real starter gate;
fails on the base because the pool ignored learned/starter cards):
- open starter-lesson cards are never drawn; drawState.owned gains only the drawn card;
- learned cards are never drawn; drawn cards are still written to drawState.owned;
- pool size = total − effective owned (30 cards, 5 effective → 10 + 10 + 5, then empty);
- the guarantee does not fire when the only missing Rare+ (by drawState.owned) are learned; it picks the missing Rare
  when the Legendary is learned;
- history `ownedBefore` is the effective set and the replay matches;
- `loadDrawStatus`: complete when only learned cards were missing; complete while the starter lesson covers the rest;
  not complete with one card missing (countdown shown); empty deck never complete.
Existing draw / pity / ceremony / wallet suites are unchanged and green (`npx tsc --noEmit && npx vitest run`).

r25x F01 adds: `ownedAfter` ignores retired uids (drawn, learned and starter); a failed or corrupt progress read
still draws from deck − (owned + starter) and keeps the Draw screen countdown; every read failing leaves the pack
not complete; progress only under a legacy key is not read by the draw (and the draw never migrates it) until
`loadDeckProgress` has run.

## Owner steps
None beyond the normal OTA on runtime 2.0.0 after App Review approval (JS-only change).

## Deferred
- Surfaces outside this issue's scope that still read `drawState.owned` directly (e.g. `MoreScreen` total owned,
  `deckWallet` first-visit bootstrap check) are unchanged; the bootstrap check must keep reading the stored set by design.
