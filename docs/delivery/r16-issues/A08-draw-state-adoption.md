# A08 — draw-state-adoption

E6 wallet/draw-state resilience: adopt the anonymous partition's draw state (owned cards, pity, wallet) into the user partition at sign-in — union-merge, idempotent.

## Context

Gacha state is partitioned per account under `devcards:u:{sub}:` (`mobile/src/review/storage.ts:23-24, 64-67, 79-81`), and nothing signed out goes to the reserved `anon` partition. Review *events* recorded while signed out are adopted by the next account that signs in (`mobile/src/sync/progressSync.ts:602-654 adoptPendingProgressEvents`, called from `setActiveUserSub` at `:744` and `:865`), but draw state is not: `mobile/src/features/gacha/draw/drawStateStore.ts:47-51` admits that a collection landed in `anon` "starts empty" after sign-in, and the cloud push only ever scans the *current* partition (`drawStateStore.ts:273-284 listDrawStateSlugs`, consumed at `mobile/src/sync/drawStateSync.ts:244`), so the anon cards never reach the server's union either. Since 1.5.0 the ownership gate turns that into a lockout of every card pulled before sign-in (`mobile/docs/qa/1.5.0-preflight-findings.md` §一, "Signing in after upgrading strands the anonymous-period collection"; `docs/home-review-and-launch-copy-2026-09-17.md` §3.2 row "登录会丢匿名期抽到的卡"; `docs/release-1.6.0-plan-2026-09-19.md:222` row E6). This change adds the missing adoption step: on sign-in, union the anon partition's owned cards, keep the higher pity counter, add the anon wallet's pulls under the normal caps, then clear the anon keys — and it runs *before* the first `syncDrawStateNow` push so the union reaches the server.

Read first, in this order: `drawStateStore.ts:21-51, 84-99, 200-300` · `drawStateSync.ts:18-61, 156-166, 203-236, 244-247` · `rewardWallet.ts:5-31, 50-66, 92-146` · `mobile/src/auth/authStore.ts:58-106` · `progressSync.ts:580-654` (frozen; read only, for the shape to mirror) · `mobile/src/features/gacha/draw/drawStateCache.ts:65-77` · `mobile/tests/unit/drawStateSync.test.ts:1-49` and `mobile/tests/unit/gachaUserScope.test.ts:1-31` (the AsyncStorage/scope test harness to copy).

## Constraints

- **No new dependencies.** Everything needed is already imported by the scope files (`AsyncStorage`, `getUserScopedKey`, `applyRewardToWallet`, `invalidateDrawStateCache`).
- **Scope (only these paths may change):**
  - `mobile/src/features/gacha/draw/drawStateStore.ts`
  - `mobile/src/sync/drawStateSync.ts` (the issue lists it as `features/gacha/draw/drawStateSync.ts`; that path does not exist — the module lives at `mobile/src/sync/drawStateSync.ts`)
  - `mobile/src/features/gacha/rewards/rewardWallet.ts`
  - `mobile/src/auth/authStore.ts`
  - `mobile/tests/unit/drawStateAdoption.test.ts` (new)
- **Frozen files (gacha-v7.md §2.1) — zero lines changed:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. `mobile/src/sync/drawStateSync.ts` and `mobile/src/auth/authStore.ts` fall under §2.1's wider `src/sync/*` / `src/auth/*` globs (`mobile/gacha-v7.md:86`); the wave scope allows them — keep the diff to the listed additive hunks (new exports in drawStateSync, one import + one call in authStore). A07 (queued before you) edits `authStore.ts` first, so its line numbers in change 4 are as of base: locate `await setActiveUserSub(userSub)` / `await setSyncAccessToken(at)` by literal, not by line. `mobile/src/review/storage.ts` is out of scope too: do **not** export `USER_SCOPE_PREFIX` from it; instead define the anon prefix once in `drawStateStore.ts` (see change 1) and pin it to `getUserScopedKey` with a unit test.
- **Existing test literals:** no existing test assertion may change. `mobile/tests/unit/drawStateSync.test.ts` asserts `apiJson` call counts (`:72, :168, :171, :179, :192, :205`) and exact push bodies (`:75-77`) — adoption must not add a network call and must be a no-op when the anon partition is empty, so these stay green untouched.
- **Never throws:** every new async function returns a result object and swallows its own errors (same contract as `syncDrawStateNow`, `drawStateSync.ts:58-60`). A storage failure during adoption must not fail sign-in or a review sync.
- **Cache contract:** `drawStateStore.ts:211-216` — anything that removes a `devcards:draw-state:` key without going through `saveDrawState` must call `invalidateDrawStateCache(thatKey)` (`drawStateCache.ts:74-77`). Adoption removes anon keys, so it must.
- **Copy-then-clear, never the reverse** (`drawStateStore.ts:185-187`, `progressSync.ts:595-600`): the user partition is written first, the anon key removed second. The removal of the anon keys *is* the "adopted" marker — a second run finds nothing and is a no-op. Do not add a separate "adopted" flag key: a flag that survives would block re-adoption of cards drawn anonymously after a later sign-out.
- No testIDs, no UI copy, no Home changes in this issue.

## Changes required

1. **`mobile/src/features/gacha/draw/drawStateStore.ts` — `adoptAnonDrawState()`**
   - Add `export const ANON_USER_SCOPE_PREFIX = 'devcards:u:anon:';` next to `DRAW_STATE_PREFIX` (`:21`), with a comment that it mirrors `review/storage.ts:24` (`USER_SCOPE_PREFIX` + the `'anon'` fallback at `:65`) and is pinned by the unit test in change 5.
   - Import `invalidateDrawStateCache` from `./drawStateCache` alongside the two existing imports (`:3`).
   - Add
     ```ts
     export type AnonDrawStateAdoption = { decks: number; ownedAdded: number; pityRaised: number };
     export async function adoptAnonDrawState(): Promise<AnonDrawStateAdoption>
     ```
     Behaviour:
     a. `const userPrefix = await stateKey('')`; if `userPrefix.startsWith(ANON_USER_SCOPE_PREFIX)` return `{0,0,0}` — signed out, there is no partition to adopt into.
     b. `const keys = await AsyncStorage.getAllKeys()`; anon slugs = keys starting with `` `${ANON_USER_SCOPE_PREFIX}${DRAW_STATE_PREFIX}` `` (same slice/filter shape as `listDrawStateSlugs`, `:277-280`).
     c. Per slug: read the anon key; parse with `parseDrawStateRecord` (a corrupt anon value counts as `{owned: [], pity: null}` but its key is still removed, same reasoning as `:126-132`). `current = await loadDrawState(slug)`. Merge:
        - `owned`: union, user order first, anon uids appended in anon order, no duplicates, empty strings skipped (same semantics as `unionOwned` at `drawStateSync.ts:157-166`; re-implement locally — `drawStateStore` must not import from `sync/drawStateSync`, that would be a cycle).
        - `pity`: if either side is `null` take the other; else `{ draws: Math.max(a.draws, b.draws), threshold: current.pity.threshold > 0 ? current.pity.threshold : anon.pity.threshold }`.
        - If `owned` grew or `pity` changed → `await saveDrawState(slug, merged)`; count `ownedAdded += grew`, `pityRaised += 1` when draws went up.
        - Then `await AsyncStorage.removeItem(anonKey); invalidateDrawStateCache(anonKey);` and `decks += 1`.
     d. Whole body in `try/catch`; on error return the counts accumulated so far.
   - Rewrite the stale paragraph at `:47-51` ("Known consequence, accepted: … signing in afterwards starts empty …") to say the anon partition is adopted at sign-in by `adoptAnonDrawState` (called through `adoptAnonGachaState` in `sync/drawStateSync.ts`). The phrase `signing in afterwards starts empty` must no longer appear in the file.

2. **`mobile/src/features/gacha/rewards/rewardWallet.ts` — `adoptAnonRewardWallet()`**
   - Import `ANON_USER_SCOPE_PREFIX` from `../draw/drawStateStore` (type-free runtime import; `draw/` already depends on `rewards/` only via a type import at `drawState.ts:1`, so no cycle).
   - Add
     ```ts
     export type AnonWalletAdoption = { addedPulls: number; dropped: number };
     export async function adoptAnonRewardWallet(): Promise<AnonWalletAdoption>
     ```
     Behaviour:
     a. `const userKey = await walletKey()`; if it starts with `ANON_USER_SCOPE_PREFIX` return `{0,0}`.
     b. Read `` `${ANON_USER_SCOPE_PREFIX}${REWARD_WALLET_KEY}` ``. If present: `anon = parseWallet(raw)` (corrupt → `{0,0}`); `pulls = anon.availablePulls + anon.reservePulls`; if `pulls > 0`: `current = await loadRewardWalletState()`, `applied = applyRewardToWallet(current, pulls)` (`:50-66` — this is the FREE_PULL_CAP / FREE_PULL_OVERFLOW_CAP cap the issue asks for), `await saveRewardWalletState({availablePulls, reservePulls})`, `addedPulls = applied.appliedToAvailable + applied.appliedToReserve`, `dropped = applied.dropped`. Then `removeItem` the anon wallet key (after the user write, never before).
     c. Starter-grant flag: if `` `${ANON_USER_SCOPE_PREFIX}${WALLET_SEEDED_KEY}` `` is set and the scoped `seededKey()` is not, `setItem(await seededKey(), '1')`. Do **not** remove the anon seeded flag (a later signed-out session must not be re-granted). Rationale: the person who took the anon starter grant is the person signing in (same personal-device reading as `hasSeededFlag`, `:121-131`); without this a user who spent the 3 anon pulls before signing in would be seeded a second time.
     d. `try/catch`, never throws. Add a comment stating the accepted crash window: a kill between the user wallet write and the anon key removal replays the add on the next run — bounded by the caps and pointing the same safe direction as the timing caveat at `:10-17`.

3. **`mobile/src/sync/drawStateSync.ts` — orchestrator + ordering guarantee**
   - Import `adoptAnonDrawState` (extend the existing import at `:6-10`) and `adoptAnonRewardWallet` (extend `:11-15`).
   - Add
     ```ts
     export type AnonGachaAdoption = AnonDrawStateAdoption & AnonWalletAdoption;
     export function adoptAnonGachaState(): Promise<AnonGachaAdoption>
     ```
     Runs `adoptAnonDrawState()` then `adoptAnonRewardWallet()`, merges the two results, never throws. **Coalesce concurrent calls** with a module-level `let _adopting: Promise<AnonGachaAdoption> | null` — return the in-flight promise if one exists, clear it in `.finally`. Two callers race in production (change 4 and the `user_changed` progress sync that `setActiveUserSub` schedules at `progressSync.ts:762`, whose `finally` reaches `syncDrawStateNow` at `:1667`); without coalescing the wallet add can land twice.
   - In `syncDrawStateNow` (`:230`), inside the `try` right after `_inFlight = true;` (`:235-236`) and before `readStamps()`: `await adoptAnonGachaState();`. This is what guarantees "adopted before the first push": the adopted deck is new to `stamps.decks`, so it is pushed with `UNKNOWN_STAMP_MS` (`:253-261`) in the same run. Add one sentence to the module comment (`:18-61`) noting that adoption runs first and that the adopted wallet pulls fall under the existing wallet LWW known-loss (`:41-46`).

4. **`mobile/src/auth/authStore.ts` — call it at sign-in**
   - Add `import { adoptAnonGachaState } from '../sync/drawStateSync';` after `:14`.
   - In `applySessionToState` (`:58-106`), after `await setActiveUserSub(userSub);` (`:89`) and before the `set({ status: … })` at `:91`: `if (userSub) await adoptAnonGachaState();` with a short comment. Placement matters: the first render with `status: 'signed_in'` must already see the union (Library/Home read draw state on that render). `init()` also goes through this function and the call is a no-op when nothing is in `anon`.

5. **`mobile/tests/unit/drawStateAdoption.test.ts` (new)** — copy the harness of `drawStateSync.test.ts:1-49` (Map-backed AsyncStorage mock **with** `getAllKeys` and `removeItem`, mocked `apiJson`, real `review/storage`, `invalidateDrawStateCache()` + `store.clear()` in `beforeEach`). Write anon fixtures the honest way: `setActiveUserSubForStorage(null)` → `saveDrawState` / `saveRewardWalletState` → `setActiveUserSubForStorage('user-a')`. Cases (each its own `it`):
   1. **union**: anon owned `['c1','c2']`, pity `{draws:7,threshold:10}`; user owned `['c2','c3']`, pity `{draws:3,threshold:10}` → user `['c2','c3','c1']`, pity draws `7`; the anon `devcards:u:anon:devcards:draw-state:csharp` key is gone; result `decks 1, ownedAdded 1, pityRaised 1`.
   2. **pity from null**: user has no draw state at all → user record equals the anon record.
   3. **wallet add + cap**: user `{28,0}`, anon `{10,0}` → user `{30,5}`, result `addedPulls 7, dropped 3`; anon wallet key removed; anon seeded flag set + user seeded flag absent → user `devcards:u:user-a:recallsmith:wallet-seeded:v1` becomes `'1'` and the anon flag is still present.
   4. **idempotent**: after case 1+3 fixtures, call `adoptAnonGachaState()` twice sequentially → second result is all zeros and user state/wallet unchanged.
   5. **concurrent calls coalesce**: `await Promise.all([adoptAnonGachaState(), adoptAnonGachaState()])` on a fresh fixture → wallet added exactly once (`{3,0}` from anon `{3,0}`, user `{0,0}`).
   6. **signed-out no-op**: `setActiveUserSubForStorage(null)` with anon state present → result zeros, anon keys untouched.
   7. **cache invalidated**: load the anon deck while signed out (primes the cache), sign in, adopt, `setActiveUserSubForStorage(null)`, `loadDrawState(SLUG)` → `owned` is `[]`.
   8. **pushed before the first sync**: user partition empty, anon owned `['c1']`; `apiJson.mockResolvedValueOnce(okResponse({serverTimeMs:1, decks:[], wallet:null}))`; `await syncDrawStateNow('token')` → `apiJson` called once and its body `decks[0]` is `{deckSlug:'csharp', owned:['c1']}` (no `pity` key, as `:307-309`).
   9. **prefix pinned**: `setActiveUserSubForStorage(null); expect(await getUserScopedKey('x')).toBe(\`${ANON_USER_SCOPE_PREFIX}x\`)`.

Estimated size: ~170 LOC across the four source files (drawStateStore ≈ 80, rewardWallet ≈ 45, drawStateSync ≈ 35, authStore ≈ 5) plus ~220 LOC of tests.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/A08.verify.sh` runs exactly these.

1. `cd mobile && npx vitest run tests/unit/drawStateAdoption.test.ts tests/unit/drawStateSync.test.ts tests/unit/gachaUserScope.test.ts tests/unit/drawStateStore.test.ts tests/unit/rewardWalletOrdering.test.ts tests/unit/drawStateCacheInvalidation.test.ts --reporter=dot` exits 0, and `tests/unit/drawStateAdoption.test.ts` contains at least 9 `it(` blocks.
2. `cd mobile && npm run test:typecheck && npx vitest run tests/unit --reporter=dot` exits 0.
3. Literal guards (all must hold): `grep -q "export const ANON_USER_SCOPE_PREFIX = 'devcards:u:anon:'" mobile/src/features/gacha/draw/drawStateStore.ts` · `grep -q "export async function adoptAnonDrawState" mobile/src/features/gacha/draw/drawStateStore.ts` · `grep -q "invalidateDrawStateCache" mobile/src/features/gacha/draw/drawStateStore.ts` · `! grep -q "signing in afterwards starts empty" mobile/src/features/gacha/draw/drawStateStore.ts` · `grep -q "export async function adoptAnonRewardWallet" mobile/src/features/gacha/rewards/rewardWallet.ts` · `grep -q "applyRewardToWallet(" mobile/src/features/gacha/rewards/rewardWallet.ts` (still the cap path) · `grep -Eq "export (async )?function adoptAnonGachaState" mobile/src/sync/drawStateSync.ts` · in `mobile/src/sync/drawStateSync.ts` the line of `await adoptAnonGachaState()` inside `syncDrawStateNow` is after the `_inFlight = true;` line and before the `await readStamps()` line.
4. Ordering guard in `mobile/src/auth/authStore.ts`: the line containing `adoptAnonGachaState()` is after the line containing `await setActiveUserSub(userSub)` and before the line containing `await setSyncAccessToken(at)`.
5. Scope guard: `git diff --name-only $(git merge-base origin/$BASE HEAD)` (falling back to `$BASE`) lists only paths from the Scope list above, and `git diff --numstat <merge-base> -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/review/storage.ts` is empty.

## DO NOT

- Do not touch the frozen files (`mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`) or `mobile/src/review/storage.ts`; do not edit any test file other than the new `drawStateAdoption.test.ts`.
- Do not add a network call to adoption, do not adopt the anon draw *history* keys (diagnostics only, out of scope), do not migrate `recallsmith:reward-session:*` receipts (see `drawStateSync.ts:48-56` for why they must never move between partitions), do not delete the anon `wallet-seeded` flag.
- Do not add a separate "adopted" flag key; do not resolve the wallet LWW known-loss (`drawStateSync.ts:41-46`) — out of scope.
- Do not change Home copy ("Sign in for cloud backup") — separate Home issue.
- Standing rules: no `git push`, no PR, never target or touch `main`, no deploy command, no disabling/skipping/gutting tests, no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`, no loosening of `tsconfig`/eslint.
