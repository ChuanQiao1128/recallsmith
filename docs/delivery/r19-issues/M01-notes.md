# M01 notes: Mistake Book per-key merge, replay-safe adoption, done-state label and hints

Issue #534, contract M00 §3.10 and §3.11.

## Merge rule as implemented

`mobile/src/features/gacha/mistakes/mistakeBook.ts`

- `mergeMistakeBooks` (`:193`), signature unchanged. A key in one book keeps that entry as is. A key in both goes through `mergeEntry` (`:157`):
  - `W = a.lastWrongAt > u.lastWrongAt ? a : u` (user wins ties); `deckSlug`, `stableUid`, `topic`, `lastOutcome` come from `W`.
  - `wrongCount = u.wrongCount + a.wrongCount`, `firstWrongAt = Math.min(...)`, `lastWrongAt = Math.max(...)`.
  - Resolution source: both resolved: the greater `resolvedAt` (user on a tie); exactly one resolved `R`: `R` when the other side's `lastWrongAt < R.resolvedAt`, otherwise the unresolved side; neither resolved: `W`.
  - `withResolutionFrom` (`:148`) copies `correctStreak`, `resolvedAt` and `lastCorrectAt` as one unit and leaves the `lastCorrectAt` key out when the source has none.
  - `capEntries` runs last, on the merged entries. The result is `{ ...user, entries }`, so the user book's `adoptedAnon` survives. Neither input is mutated.
- `applyOutcome` returns `{ ...s, entries }` in both changing branches (`:127`, `:143`) and still returns `s` itself when nothing changes.

## Replay fingerprint

- `MistakeBookState.adoptedAnon?: string` (`:50`).
- `fnv1a32` (`:336`, local, not exported) is FNV-1a 32-bit with offset basis `0x811c9dc5` and prime `0x01000193`, using `Math.imul` and `>>> 0`, and returns 8 lowercase hex characters. **Variant:** it iterates UTF-16 code units (`charCodeAt`), not UTF-8 bytes. For ASCII input, which is what the book's JSON almost always is, the result is the same as the textbook byte-wise FNV-1a. The value is only ever compared with another value computed the same way on the same device, so matching a byte-wise reference for non-ASCII text is not needed, and it avoids an encoder.
- `parseBook` (`:284`) keeps `adoptedAnon` only when it is a string that matches `/^[0-9a-f]{8}$/`. Otherwise the key is absent.
- `adoptNow` (`:347`) works out the fingerprint of the raw anon JSON. If `user.adoptedAnon` equals it (`:364`), the book already holds this exact adoption, so it skips the merge, removes the anon key and returns `mistakesAdopted: 0`. Otherwise it writes `{ ...mergeMistakeBooks(user, anon), adoptedAnon }`, then removes the anon key.
- **Why replay is now safe:** the merge sums counts, so running it twice would double them. If the app is killed between `setItem(user)` and `removeItem(anon)`, the next run reads the same raw anon JSON and finds its fingerprint on the user book. It only clears the anon key and does not merge again. A different anon book (new raw JSON) has a different fingerprint and is merged. The read-error path (a failed user read throws before any write) and the lock chain are unchanged.
- Behaviour change: an anon book that parses to zero entries (but is present) now writes the user book with its fingerprint before the anon key is removed. Previously this case made no write. The entries are unchanged. This follows the brief's `adoptNow` wording.
- Residual limit: an anon book whose raw JSON is byte-identical to the one adopted last is skipped. In practice this cannot happen, because each new mistake carries a new timestamp. Two different JSONs can also collide on the 32-bit hash; the odds are about 2^-32 per adoption.

## Done state

`mobile/src/screens/MistakeBookScreen.tsx`: `REVIEW_DONE_LABEL`, `REVIEW_DONE_HINT` and `REVIEW_HINT` are exported (`:39-43`). The review button shows `done ? REVIEW_DONE_LABEL : reviewLabel` (`:284`) with `accessibilityHint={done ? REVIEW_DONE_HINT : REVIEW_HINT}` (`:269`). `disabled`, `accessibilityState`, `DONE_FOR_TODAY_TEXT`, the done line, the `testID`s, the styles and the rows' `accessibilityHint="Opens the card"` are unchanged.

## Tests

- `mobile/tests/unit/mistakeBookMerge.test.ts` (new) contains:
  - a 15-row table covering every branch of the rule;
  - fast-check properties (numRuns 300 and 200): no mutation, the empty book as identity, `resolvedAt >= lastWrongAt`, summed counts, and the cap applied last;
  - the fingerprint parse round trip, and preservation of the fingerprint by `applyOutcome` and `mergeMistakeBooks`;
  - replay safety with `removeItem` killed once. As a check, disabling the fingerprint makes this test fail.
- `mobile/tests/integration/mistakeBookDoneState.test.tsx` (new) covers done at load, done after the tap, an open deck, and `relatedCount: 0`. For "done after the tap", the screen is mounted at 23:59 local time with the correct answers stamped 00:00:30 the next day, which is not yet "today". The clock then moves across midnight with `vi.setSystemTime` before the press.
- `mobile/tests/unit/mistakeBook.test.ts`: only the old `:425-461` block changed. It is now titled `merges two books per key, summing counts, then applies the LRU cap`, uses the same fixtures, and keeps the LRU half verbatim. The new expectations are:
  - `both-user-newer`: `wrongCount 4`, `lastWrongAt T0+5`, unresolved;
  - `both-anon-newer`: `wrongCount 3`, `lastWrongAt T0+9`, `correctStreak 1`, `lastCorrectAt T0+3`;
  - `tie`: `wrongCount 8`, user side;
  - `user-only` and `anon-only`: unchanged.
- Lines changed outside that block, in this or any other existing test file: none. The adoption tests (`:463-520`) pass unchanged.

## Cherry-pick

The commits touch only these paths:
- `mobile/src/features/gacha/mistakes/mistakeBook.ts`
- `mobile/src/screens/MistakeBookScreen.tsx`
- `mobile/tests/unit/mistakeBook.test.ts`
- `mobile/tests/unit/mistakeBookMerge.test.ts`
- `mobile/tests/integration/mistakeBookDoneState.test.tsx`
- this notes file

They add no dependency, no package import, and no native or app-config change. The branch is cut from `delivery/r19m-m`, whose base is `6ce7d3e` (runtime 1.8.0), and none of these files changed between the two, so the commits apply to `6ce7d3e` without conflicts.
