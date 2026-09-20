# B03 — spillSchedule + skipPolicy + ceremonyPrefs (`spill-skip-prefs`)

Three pure-ish modules the ceremony screen (B09) and the timeline hook (B07) build on: `spillSchedule.ts` (the multi-pull deal — 60 ms stagger, every card lands inside the tear phase, the featured card is dealt last to the centre slot, `count` entries and never six padded clones), `skipPolicy.ts` (`'none' | 'compress'` — the fast-forward decision can never leave the ceremony; there is no `'goResult'` member), and `ceremonyPrefs.ts` (AsyncStorage-backed `ceremoniesCompleted`, fail-closed to 0 on any error, garbage or slow read, plus the `__DEV__`-only overrides). Property tests with `fast-check` for the two pure modules; a Map-backed AsyncStorage harness for the third. Depends on B01 (packages) **and B02** (`ceremonyTimings.ts` owns the types and constants these modules import — see Constraints).

## Context

Three defects in today's ceremony are fixed by these modules, and each one is a rule the rest of Wave B relies on:

1. **The multi-pull deal pads to six clones.** `mobile/src/screens/DrawCeremonyScreen.tsx:826-836` builds `orbitCards` with `Array.from({ length: Math.min(10, Math.max(6, cards.length)) })` and `cards[index % cards.length]`, so a 2-card pull orbits 6 cards (three copies of each). Design §3.1 M3 (`docs/release-1.6.0-plan-2026-09-19.md:113`): "card i leaves at 900 + i×60 and travels 300 ms; a 2-card pull spills 2 cards, not 6 padded clones (fixes :828-836)". `buildSpillSchedule` returns exactly `cards.length` entries, and the timeline hook (B07, B00 §2.10 `spill: ReadonlyArray<…> // length = cardCount`) reads them by card index.
2. **The skip control jumps to DrawResult.** The always-visible × at `:884-894` and the settle CTA at `:1370-1386` both call `goResult` (`:470`); the cards-on-table timer at `:764-785` is the only path to the table, and on any device with Lottie installed the Lottie `onAnimationFinish` fires `goResult` first (`:1036-1040`; design §3.3, `:125`), so the table was unreachable. Design §2 "Skippability is earned" (`:71`) and §3.1 FF (`:103`): the first-ever ceremony shows no skip before settle; a repeat user gets a fast-forward from 60 % of hold that **compresses** the timeline (hold → beat only, tear at 1.6×) and never navigates. `skipPolicy` encodes exactly that decision as a pure function; B09 mounts `draw-ceremony-fast-forward` only while it returns `'compress'` (B00 §3.6) and reschedules through `compressTimings` (B00 §2.2). Because the union has no `'goResult'` member, the type system makes "skip leaves the ceremony" unrepresentable.
3. **"First ceremony" must be fail-closed.** The FF gate reads `ceremoniesCompleted ≥ 1` from AsyncStorage (design §3.1 FF, `:103`: "read failure or slow read defaults to 'first ceremony' = no visual skip before settle; `__DEV__` toggle to force repeat mode"; §3.7 row `:162`: "read on mount with fail-closed default 0, incremented on table Continue"). The screen mounts and starts its timers immediately, so a read that has not answered within 250 ms must count as 0 rather than block the ceremony. B09 calls `readCeremoniesCompleted()` on mount, `effectiveCeremoniesCompleted(stored)` for the policy input, and `markCeremonyCompleted()` from the table's `'Continue'` CTA (B00 §3.6). B13's DebugMenu flips `setCeremonyDevOverride('forceRepeat' | 'forceFallback', …)`; B09's renderer choice reads `getCeremonyDevOverrides().forceFallback` (B00 §3.5).

Storage pattern to mirror: `mobile/src/features/gacha/draw/drawStateStore.ts:227-240` (`loadDrawState`: `getItem` inside `try`, a failed read returns the empty record and is deliberately **not** cached so one bad read does not pin a wrong answer for the session). Unlike draw state, the ceremony count is **device-global** — it is not written through `getUserScopedKey` (`drawStateStore.ts:2`), because familiarity with the ceremony belongs to the person holding the phone, not to an account.

`__DEV__` is read at call time through `globalThis`, the way `deckRepository.ts:1428` does it (`(globalThis as any).__DEV__ === true`), so a unit test can flip it and production (where `__DEV__` is `false`) gets inert overrides. `fast-check ^4.9.0` is already a devDependency (`mobile/package.json:61`) and is used by `tests/unit/poolSelection.properties.test.ts` and `tests/unit/scheduler.properties.test.ts` — no dependency change in this issue.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` §2 preamble (`CeremonyPhase` / `PeakRarity` ownership), §2.3 (spillSchedule — signatures, formulas and invariants verbatim), §2.4 (skipPolicy), §2.5 (ceremonyPrefs), §3.5–3.6 (how B09 consumes all three), §5 (deps), §8 (verify conventions).
2. `mobile/src/features/gacha/draw/ceremonyTimings.ts` (B02, merged before you): `CeremonyPhase`, `PeakRarity`, `SPILL_STAGGER_MS`, `SPILL_START_FRACTION`, `SPILL_TRAVEL_FRACTION`, `FAST_FORWARD_FROM_HOLD_FRACTION`, and the `DEVICE`/`TEST_BASE` `tearFlip` values (1800 / 940 multi) that the literal test cases use.
3. `mobile/src/screens/DrawCeremonyScreen.tsx:133-140` (`pickFeaturedCard` — the featured rule you re-implement as `featuredCardIndex`), `:826-836` (the padding you replace), `:1178-1224` (the table layout: ≤ 5 cards one row, else two rows of `ceil(n/2)` — the source of `centreSlot`), `:884-894` and `:1370-1386` (both skip controls call `goResult` today), `:710-724` and `:747-751` (`setCanSkip(true)` is settle-gated — the rule `skipPolicy` keeps for `'settle'`/`'cards-on-table'`: those phases return `'none'` because the CTA owns them).
4. `mobile/src/features/gacha/draw/drawStateStore.ts:1-4` (imports) and `:227-240` (`loadDrawState` — the read shape; note what is and is not cached).
5. `mobile/src/content/deckRepository.ts:1428` (frozen; read only: the `globalThis.__DEV__` read at call time).
6. `mobile/tests/unit/poolSelection.properties.test.ts:19-40` and `mobile/tests/unit/scheduler.properties.test.ts:20-29` (fast-check style in this repo: generators encode the *real* input contract, including dirty values the types forbid).
7. `mobile/tests/unit/drawStateSync.test.ts:1-16` (the Map-backed AsyncStorage mock) and `mobile/tests/unit/deckRepositoryTimeouts.test.ts:84-90` (`loadRepo()`: `vi.resetModules()` + dynamic `import` for a module with in-memory state) and `:230-245` (fake timers with `advanceTimersByTimeAsync` for a hanging promise).
8. `docs/release-1.6.0-plan-2026-09-19.md:62-71` (grammar rows: anticipation, silence, settle, player agency, skippability), `:103` (FF row), `:113` (M3 row), `:125` (§3.3), `:161-162` (the two §3.7 code rows for this issue); `docs/delivery-wave-1.6-plan-2026-09-19.md:85` (the B03 row).

## Constraints

- **Scope (the ONLY files that may change):**
  - `mobile/src/features/gacha/draw/spillSchedule.ts` (new)
  - `mobile/src/features/gacha/draw/skipPolicy.ts` (new)
  - `mobile/src/features/gacha/draw/ceremonyPrefs.ts` (new)
  - `mobile/tests/unit/spillSchedule.test.ts` (new)
  - `mobile/tests/unit/skipPolicy.test.ts` (new)
  - `mobile/tests/unit/ceremonyPrefs.test.ts` (new)
- **Frozen (zero diff):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched in this issue: `mobile/src/features/gacha/draw/ceremonyTimings.ts` (B02's — import from it, never edit it), `mobile/src/screens/DrawCeremonyScreen.tsx` (B09 wires these modules in), `mobile/src/features/gacha/draw/drawStateStore.ts`, `mobile/src/review/storage.ts`, `mobile/package.json`, `mobile/package-lock.json`, `mobile/vitest.config.ts`, `mobile/tests/setup/*`.
- **Dependency on B02 (spec JSON `deps: "B01,B02"` and B00 §5 since 2026-09-20).** B00 §2 preamble: `CeremonyPhase` and `PeakRarity` are owned by `ceremonyTimings.ts` and "every module imports these from where they are defined; never redeclare". B00 §2.3 defines the schedule in terms of `SPILL_START_FRACTION` / `SPILL_TRAVEL_FRACTION` / `SPILL_STAGGER_MS` and §2.4 in terms of `FAST_FORWARD_FROM_HOLD_FRACTION` — all exported by `ceremonyTimings.ts`. So `spillSchedule.ts` and `skipPolicy.ts` `import` from `./ceremonyTimings`, and this issue must run on a tree where B02 is merged (B00 §5's merge order already puts B03 after B02: "B01 → B02 → B03, B04, B06 → …"). Do not copy the numbers into local constants; do not redeclare the two types.
- **No dependency changes.** `fast-check` is present (`package.json:61`); nothing is added.
- **Purity:** `spillSchedule.ts` and `skipPolicy.ts` import nothing but `./ceremonyTimings` (types + constants). No `react`, no `react-native`, no storage, no `Date.now`, no randomness — same input, same output, always. `ceremonyPrefs.ts` imports only `@react-native-async-storage/async-storage` (default import, as `drawStateStore.ts:1`); it must not import `../../../review/storage` (device-global key) nor `ceremonyTimings`.
- **Never throws:** every exported function of `ceremonyPrefs.ts` resolves; storage failures are swallowed. `readCeremoniesCompleted` resolves within `CEREMONY_PREFS_READ_TIMEOUT_MS` even if `getItem` never settles.
- **No memo of the count (B00 §2.5):** `ceremonyPrefs.ts` has **no module-level `let`** — storage is the only source of truth, every read hits `AsyncStorage.getItem`, and neither a successful read, a timed-out read nor a failed write is remembered in memory. The reason is B09's integration file (B00 §4.2): its case 1 presses `'Continue'` (→ `markCeremonyCompleted()`) and a later case 8 assumes a first-ever ceremony through the statically imported screen; a remembered count would leak a repeat user across cases. verify.sh greps `^let ` in the file and fails on any hit; the only module state is the `const overrides` object.
- **Tokens that must not appear anywhere in `ceremonyPrefs.ts` — comments included** (verify.sh greps them): `getUserScopedKey`, `review/storage`, `ceremonyTimings`, `from 'react`. Describe the key as "device-global on purpose (no per-user prefix, unlike draw state)" — do not name the helper you are not using. Same discipline as `goResult` in `skipPolicy.ts` below.
- **`__DEV__`** is read at call time as `(globalThis as { __DEV__?: unknown }).__DEV__ === true` — never captured at module load, never assumed present.
- **Type discipline:** `SkipDecision` is exactly `'none' | 'compress'`. The string `goResult` must not appear anywhere in `skipPolicy.ts` (not even in a comment — verify.sh greps the bare token; write "leave the ceremony" instead).
- **Test-literal rules:** no existing test file changes. The three new tests use `fast-check` (`import fc from 'fast-check'`) for `spillSchedule` and `skipPolicy` with `fc.assert(fc.property(...))`; `ceremonyPrefs.test.ts` is example-based with the AsyncStorage mock. `it(` titles below are verbatim (verify.sh greps them).
- **No testIDs, no UI, no copy** in this issue (B09/B10 own those).
- **Banned literals in new lines:** `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`.

## Changes required

1. **`mobile/src/features/gacha/draw/spillSchedule.ts` (new, pure)** — exactly B00 §2.3.
   ```ts
   import {
     SPILL_STAGGER_MS,
     SPILL_START_FRACTION,
     SPILL_TRAVEL_FRACTION,
     type PeakRarity,
   } from './ceremonyTimings';

   export type SpillEntry = { index: number; leaveAt: number; landAt: number; slot: number };
   export type SpillSchedule = {
     entries: SpillEntry[];
     startMs: number;
     travelMs: number;
     staggerMs: number;
     featuredIndex: number;
   };

   export function featuredCardIndex(cards: ReadonlyArray<{ rarity: PeakRarity }>): number;
   export function centreSlot(count: number): number;
   export function buildSpillSchedule(cards: ReadonlyArray<{ rarity: PeakRarity }>, tearMs: number): SpillSchedule;
   ```
   Semantics:
   - `featuredCardIndex(cards)`: index of the first `'LEG'`, else the first `'RAR'`, else `0`; `-1` when `cards` is empty. Same precedence as `pickFeaturedCard` (`DrawCeremonyScreen.tsx:133-140`), returning the index instead of the card.
   - `centreSlot(count)`: `rowLength = count <= 5 ? count : Math.ceil(count / 2)`; return `Math.floor((rowLength - 1) / 2)`; for `count < 1` return `0` (nothing to centre — the only case B00's formula leaves undefined). Table: 1→0, 2→0, 3→1, 4→1, 5→2, 6→1, 7→1, 8→1, 9→2, 10→2. This is the middle of the **top** row of the layout at `DrawCeremonyScreen.tsx:1199-1224` (one row up to five cards, otherwise two rows of `ceil(n/2)`).
   - `buildSpillSchedule(cards, tearMs)`:
     - `count = cards.length`; `tear = Number.isFinite(tearMs) && tearMs > 0 ? tearMs : 0` (a negative or non-finite tear collapses the whole deal to t = 0 rather than producing negative stagger).
     - `startMs = Math.round(tear * SPILL_START_FRACTION)`; `travelMs = Math.round(tear * SPILL_TRAVEL_FRACTION)`;
     - `staggerMs = count <= 1 ? 0 : Math.max(0, Math.min(SPILL_STAGGER_MS, Math.floor((tear - startMs - travelMs) / (count - 1))))`;
     - `featuredIndex = featuredCardIndex(cards)`;
     - deal order: every non-featured card in index order, then the featured card **last**. The card at deal position `o` (0-based) gets `leaveAt = startMs + o * staggerMs`, `landAt = leaveAt + travelMs`.
     - slots: the featured card gets `centreSlot(count)`; the remaining slots `0..count-1` minus that one are handed to the non-featured cards in index order.
     - `entries` is **in card-index order** (`entries[i].index === i`) so `useCeremonyTimeline` (B07) can address `spill[i]` directly; deal order is recoverable from `leaveAt`. Return `{ entries, startMs, travelMs, staggerMs, featuredIndex }`; an empty `cards` returns `{ entries: [], startMs, travelMs, staggerMs: 0, featuredIndex: -1 }`.
     - Worked values (assert them literally in the unit test): DEVICE multi (`tearMs` 1800, 10 cards) → `startMs 900, travelMs 300, staggerMs 60`, last `landAt` = 900 + 9×60 + 300 = 1740 ≤ 1800; TEST_BASE multi (`tearMs` 940, 10 cards) → `470, 157, 34`, last `landAt` = 470 + 306 + 157 = 933 ≤ 940; 2 cards at 1800 → two entries, non-featured `leaveAt 900`, featured `leaveAt 960`, slots `{1, 0}` when the featured card is index 1 → featured gets `centreSlot(2) = 0`, the other gets `1`.
   Header comment: three lines — what it replaces (`DrawCeremonyScreen.tsx:828-836`), the invariants, and that the numbers come from `ceremonyTimings.ts` (design §3.1 M3).

2. **`mobile/src/features/gacha/draw/skipPolicy.ts` (new, pure)** — exactly B00 §2.4.
   ```ts
   import { FAST_FORWARD_FROM_HOLD_FRACTION, type CeremonyPhase } from './ceremonyTimings';

   /** 'none' = no visible fast-forward control; 'compress' = show the × / accept a stage tap that
    *  compresses the timeline. There is deliberately no third member: this policy can never
    *  leave the ceremony. */
   export type SkipDecision = 'none' | 'compress';

   export type SkipPolicyInput = {
     ceremoniesCompleted: number;    // ceremonyPrefs, fail-closed 0
     phase: CeremonyPhase;
     phaseElapsedMs: number;         // ms since the current phase started
     phaseDurationMs: number;        // scheduled duration of the current phase
     reduceMotion: boolean;
     alreadyCompressed: boolean;
   };

   export function skipPolicy(input: SkipPolicyInput): SkipDecision;
   ```
   Rules, evaluated in this order (the first that applies wins):
   1. `reduceMotion` → `'none'` (RM is a parallel ceremony with its own 180/420 ms path, B00 §3.3; nothing to compress).
   2. `!(ceremoniesCompleted >= 1)` → `'none'` — written with the negated comparison so `NaN`, `undefined`-as-number and negatives all fail closed (first-ever ceremony shows nothing before settle).
   3. `alreadyCompressed` → `'none'` (one compression per ceremony).
   4. by phase: `'swipe' | 'approach'` → `'none'` (the tell has not landed; design §2 "skip appears after the meteor colour"); `'hold'` → `phaseElapsedMs >= FAST_FORWARD_FROM_HOLD_FRACTION * phaseDurationMs ? 'compress' : 'none'` (a `NaN` on either side compares false → `'none'`); `'tear-flip' | 'flash-reveal'` → `'compress'`; `'settle' | 'cards-on-table'` → `'none'` (the CTA owns those phases — `setCanSkip(true)` at `:750`/`:768` today); any other string (defensive `default`) → `'none'`.
   The token `goResult` must not appear in this file. No other export.

3. **`mobile/src/features/gacha/draw/ceremonyPrefs.ts` (new)** — exactly B00 §2.5.
   ```ts
   import AsyncStorage from '@react-native-async-storage/async-storage';

   export const CEREMONY_PREFS_KEY = 'recallsmith:ceremony:completed:v1';
   export const CEREMONY_PREFS_READ_TIMEOUT_MS = 250;

   export function readCeremoniesCompleted(): Promise<number>;
   export function markCeremonyCompleted(): Promise<number>;

   export type CeremonyDevOverrides = { forceRepeat: boolean; forceFallback: boolean };
   export function getCeremonyDevOverrides(): CeremonyDevOverrides;
   export function setCeremonyDevOverride<K extends keyof CeremonyDevOverrides>(key: K, value: boolean): void;
   export function effectiveCeremoniesCompleted(stored: number): number;
   ```
   Semantics:
   - Module state: **none for the count** (no module-level `let`; B00 §2.5 and Constraints). Storage is the only source of truth, exactly as `drawStateStore.ts:227-240` never caches `loadDrawState`. The only module state is the `const overrides` object below.
   - `readCeremoniesCompleted()`: race `AsyncStorage.getItem(CEREMONY_PREFS_KEY)` against a `setTimeout` of `CEREMONY_PREFS_READ_TIMEOUT_MS` (clear the timer when the read settles; never leave a live timer behind). Timeout **or** rejection → resolve `0`. A settled read → `parseCount(raw)` where `raw === null` → 0 and otherwise `n = Number(raw)`, valid iff `Number.isInteger(n) && n >= 0`, else 0; resolve `n`. Wrap the whole body in `try/catch` → `0`. Never throws, never rejects, remembers nothing — the next call reads storage again.
   - `markCeremonyCompleted()`: `const next = (await readCeremoniesCompleted()) + 1;` then `try { await AsyncStorage.setItem(CEREMONY_PREFS_KEY, String(next)); } catch { /* swallowed: storage stays the source of truth; the next read sees whatever is stored */ }` and resolve `next`. Nothing is retained in memory on either path. Add a comment naming the accepted edge: a read that timed out (0) followed by a mark writes `1` over a larger stored value — the count only gates "≥ 1", so the regression is invisible and self-heals on the next mark.
   - Dev overrides: `const overrides: CeremonyDevOverrides = { forceRepeat: false, forceFallback: false };` and `function isDev(): boolean { return (globalThis as { __DEV__?: unknown }).__DEV__ === true; }`. `getCeremonyDevOverrides()` returns a **copy** (`{ ...overrides }`) in dev and `{ forceRepeat: false, forceFallback: false }` otherwise; `setCeremonyDevOverride(key, value)` is a no-op outside dev, else `overrides[key] = value === true`. `effectiveCeremoniesCompleted(stored)`: `base = Number.isInteger(stored) && stored >= 0 ? stored : 0`; return `getCeremonyDevOverrides().forceRepeat ? Math.max(base, 1) : base`.
   - Header comment (five lines): the key is device-global on purpose (no per-user prefix, unlike draw state — familiarity with the ceremony belongs to the phone, not the account; **do not name the per-user helper**, its identifier is grep-banned in this file), fail-closed meaning ("first ceremony" = no visible skip before settle), the 250 ms budget (the screen's timers start at mount and must not wait on storage), no in-memory memo (storage is the source of truth; a remembered count would leak across the integration file's cases), and that B09 reads on mount / marks on the table's Continue while B13 flips the overrides.

4. **`mobile/tests/unit/spillSchedule.test.ts` (new)** — `import fc from 'fast-check'`; imports from `../../src/features/gacha/draw/spillSchedule` and `SPILL_STAGGER_MS`, `SPILL_START_FRACTION`, `SPILL_TRAVEL_FRACTION` from `../../src/features/gacha/draw/ceremonyTimings`. Generators: `rarityArb = fc.constantFrom<PeakRarity>('COM', 'RAR', 'LEG')`; `cardsArb = fc.array(fc.record({ rarity: rarityArb }), { minLength: 1, maxLength: 10 })`; `tearArb = fc.integer({ min: 0, max: 10000 })`. Cases (titles verbatim, each its own `it`; properties via `fc.assert(fc.property(cardsArb, tearArb, (cards, tearMs) => { … }))`):
   1. `it('deals exactly one entry per card, in card-index order', …)` — property: `entries.length === cards.length` and `entries[i].index === i` for every `i`; plus the literal 2-card case from change 1 (two entries, not six — `:828-836`) and `buildSpillSchedule([], 1800)` → `entries []`, `featuredIndex -1`, `staggerMs 0`.
   2. `it('lands every card inside the tear phase', …)` — property: every `landAt <= tearMs`, every `leaveAt >= startMs`, `landAt - leaveAt === travelMs`, `startMs === Math.round(tearMs * SPILL_START_FRACTION)`, `travelMs === Math.round(tearMs * SPILL_TRAVEL_FRACTION)`, `0 <= staggerMs <= SPILL_STAGGER_MS`.
   3. `it('assigns slots as a permutation with the featured card in the centre', …)` — property: sorted `slot`s equal `[0..n-1]`; `entries[featuredIndex].slot === centreSlot(n)`; `featuredIndex === featuredCardIndex(cards)`; plus the literal `centreSlot` table 1→0, 2→0, 3→1, 4→1, 5→2, 6→1, 7→1, 8→1, 9→2, 10→2 and `centreSlot(0) === 0`.
   4. `it('deals the featured card last and the rest in index order', …)` — property: `entries[featuredIndex].leaveAt >= every other leaveAt`; when `staggerMs > 0` it is strictly greater than every other and the non-featured entries' `leaveAt` are strictly increasing in index order; the sequence of `leaveAt` values sorted ascending is `startMs + o * staggerMs` for `o = 0..n-1`.
   5. `it('picks the first LEG, else the first RAR, else index 0', …)` — property over `cardsArb`: if any LEG, result is the first LEG index; else if any RAR, the first RAR index; else 0; plus `featuredCardIndex([]) === -1`.
   6. `it('reproduces the DEVICE and TEST_BASE multi numbers', …)` — 10 cards at 1800 → `startMs 900, travelMs 300, staggerMs 60`, max `landAt` 1740; 10 cards at 940 → `470, 157, 34`, max `landAt` 933; 1 card at 1800 → one entry `{ index: 0, leaveAt: 900, landAt: 1200, slot: 0 }`, `staggerMs 0`.
   7. `it('is deterministic and tolerates a degenerate tear', …)` — property: two calls with the same input are `toEqual`; `buildSpillSchedule(cards, 0)`, `(cards, -50)` and `(cards, NaN)` all give `startMs 0, travelMs 0, staggerMs 0` and every `leaveAt`/`landAt` 0 with the slot permutation intact.

5. **`mobile/tests/unit/skipPolicy.test.ts` (new)** — `import fc from 'fast-check'`; imports `skipPolicy`, types from `../../src/features/gacha/draw/skipPolicy`, `FAST_FORWARD_FROM_HOLD_FRACTION` and `DEVICE` from `../../src/features/gacha/draw/ceremonyTimings`. Generators: `phaseArb = fc.constantFrom<CeremonyPhase>('swipe', 'approach', 'hold', 'tear-flip', 'flash-reveal', 'settle', 'cards-on-table')`; `completedArb = fc.oneof(fc.integer({ min: -3, max: 5 }), fc.constantFrom(NaN, Infinity, -Infinity, 0.5))` (dirty values on purpose, as `scheduler.properties.test.ts:26-29`); `msArb = fc.integer({ min: 0, max: 6000 })`; `inputArb = fc.record({ ceremoniesCompleted: completedArb, phase: phaseArb, phaseElapsedMs: msArb, phaseDurationMs: msArb, reduceMotion: fc.boolean(), alreadyCompressed: fc.boolean() })`. Cases (titles verbatim):
   1. `it('only ever answers none or compress', …)` — property over `inputArb`: `['none', 'compress']` contains the result (this is the executable form of "never goResult").
   2. `it('never shows a skip under reduce motion, on a first ceremony, or twice', …)` — property: `reduceMotion || !(ceremoniesCompleted >= 1) || alreadyCompressed` ⇒ `'none'`; literal: `ceremoniesCompleted: 0` in `'tear-flip'` at any elapsed → `'none'`; `NaN` → `'none'`.
   3. `it('keeps swipe, approach, settle and the table under the CTA', …)` — property: for an otherwise eligible input (`completed 1..5`, no RM, not compressed) those four phases → `'none'`.
   4. `it('opens the fast-forward at sixty percent of hold', …)` — property with eligible input in `'hold'`: result is `'compress'` iff `phaseElapsedMs >= FAST_FORWARD_FROM_HOLD_FRACTION * phaseDurationMs`; literal: DEVICE single RAR hold 620 → elapsed 372 → `'compress'`, 371 → `'none'`; DEVICE multi LEG hold 1100 → 660 → `'compress'`, 659 → `'none'`.
   5. `it('compresses tear and flash on a repeat ceremony', …)` — property: eligible input in `'tear-flip'` or `'flash-reveal'` → `'compress'` regardless of elapsed/duration.
   6. `it('is monotone in elapsed time during hold', …)` — property: eligible `'hold'` input, `e1 <= e2` (generate two `msArb` and sort) ⇒ `skipPolicy(e1) === 'compress'` implies `skipPolicy(e2) === 'compress'`.

6. **`mobile/tests/unit/ceremonyPrefs.test.ts` (new)** — Map-backed AsyncStorage mock with a switchable mode, declared before the imports (`vi.mock` is hoisted; keep the `store`/`mode` variables at module scope as `drawStateSync.test.ts:3-16` does):
   ```ts
   const store = new Map<string, string>();
   let mode: 'ok' | 'throw' | 'hang' | 'write-throw' = 'ok';
   const getItem = vi.fn(async (key: string) => {
     if (mode === 'throw') throw new Error('storage down');
     if (mode === 'hang') return new Promise<string | null>(() => {});
     return store.get(key) ?? null;
   });
   const setItem = vi.fn(async (key: string, value: string) => {
     if (mode === 'throw' || mode === 'write-throw') throw new Error('storage down');
     store.set(key, value);
   });
   vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem, setItem } }));
   ```
   `async function loadPrefs() { vi.resetModules(); return await import('../../src/features/gacha/draw/ceremonyPrefs'); }` (fresh module state per test, as `deckRepositoryTimeouts.test.ts:87-90`). The factory above references module-scope variables, which is safe only because **every** import of `ceremonyPrefs` is the dynamic one inside `loadPrefs()` (the factory first runs during that import, after the variables are initialised) — never add a static `import … from '…/ceremonyPrefs'` to this file; if you prefer, declare `store`/`mode`/`getItem`/`setItem` through `vi.hoisted(() => ({ … }))` instead. `beforeEach`: `store.clear(); mode = 'ok'; getItem.mockClear(); setItem.mockClear(); (globalThis as any).__DEV__ = true;`. `afterEach`: `vi.useRealTimers(); (globalThis as any).__DEV__ = true;`. Cases (titles verbatim):
   1. `it('reads 0 when nothing is stored and re-reads storage on every call', …)` — `await read()` → 0; second `read()` → 0 and `getItem` called exactly **twice** (nothing is memoised — B00 §2.5); then `store.set(KEY, '2')` without reloading the module → third `read()` → 2 (the module sees a change made behind its back, which a memo would hide).
   2. `it('parses a stored integer and fails closed on garbage', …)` — for `['3', 3]`, `['0', 0]`, `['abc', 0]`, `['-1', 0]`, `['2.5', 0]`, `['1e3', 1000]`: set the store, `loadPrefs()`, `read()` equals the expectation.
   3. `it('resolves 0 when the read throws and retries on the next call', …)` — `mode = 'throw'` → `read()` 0 (no rejection); then `mode = 'ok'`, `store.set(KEY, '4')` → `read()` 4 and `getItem` called twice; `setItem` never called.
   4. `it('resolves 0 within the timeout when the read hangs', …)` — `vi.useFakeTimers()`; `mode = 'hang'`; `const p = read()`; `await vi.advanceTimersByTimeAsync(CEREMONY_PREFS_READ_TIMEOUT_MS)`; `await p` → 0; then `mode = 'ok'`, `store.set(KEY, '2')`, `read()` → 2 (the timeout did not memoise 0).
   5. `it('markCeremonyCompleted increments, persists and returns the new count', …)` — `store.set(KEY, '2')`; `await mark()` → 3; `setItem` called once with `(KEY, '3')`; `store.get(KEY) === '3'`; `read()` → 3 and `getItem` called exactly twice (once inside `mark`, once for the read — no memo); a second `mark()` → 4 and `store.get(KEY) === '4'`.
   6. `it('resolves the incremented count when the write fails and never pins it', …)` — `store.set(KEY, '2')`; `mode = 'write-throw'` (reads work, writes throw); `await mark()` → 3 (resolves, no rejection); `setItem` called once; `store.get(KEY) === '2'` (unchanged); `read()` → 2 (storage is the only source of truth — the failed increment was **not** kept in memory, B00 §2.5); a second `mark()` → 3 again, not 4.
   7. `it('dev overrides are inert outside __DEV__', …)` — `(globalThis as any).__DEV__ = false`; `setCeremonyDevOverride('forceRepeat', true)`; `getCeremonyDevOverrides()` toEqual `{ forceRepeat: false, forceFallback: false }`; `effectiveCeremoniesCompleted(0) === 0`.
   8. `it('forceRepeat lifts a first ceremony to a repeat in __DEV__', …)` — `setCeremonyDevOverride('forceRepeat', true)` → `effectiveCeremoniesCompleted(0) === 1`, `(5) === 5`, `(NaN) === 1`, `(-2) === 1`; `setCeremonyDevOverride('forceFallback', true)` → getter `{ forceRepeat: true, forceFallback: true }`; the returned object is a copy (mutating it does not change the next read); `setCeremonyDevOverride('forceRepeat', false)` → `effectiveCeremoniesCompleted(0) === 0` and `effectiveCeremoniesCompleted(NaN) === 0`.
   9. `it('exports the device-global key and the read budget', …)` — `CEREMONY_PREFS_KEY === 'recallsmith:ceremony:completed:v1'`; `CEREMONY_PREFS_READ_TIMEOUT_MS === 250`; `CEREMONY_PREFS_KEY.startsWith('devcards:u:') === false`.

Estimated size: spillSchedule ~90 lines, skipPolicy ~50, ceremonyPrefs ~110; tests ~150 + ~110 + ~150.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/B03.verify.sh` re-runs exactly these.

1. Files exist: the six scope files; prerequisite `mobile/src/features/gacha/draw/ceremonyTimings.ts` exists (B02 merged) and exports `SPILL_STAGGER_MS` and `FAST_FORWARD_FROM_HOLD_FRACTION`.
2. Literal guards (exit 0):
   - `s=mobile/src/features/gacha/draw/spillSchedule.ts`: `export type SpillEntry`, `export type SpillSchedule`, `export function featuredCardIndex`, `export function centreSlot`, `export function buildSpillSchedule`, `from './ceremonyTimings'`, `SPILL_STAGGER_MS`, `SPILL_START_FRACTION`, `SPILL_TRAVEL_FRACTION` present; `! grep -Eq "from 'react|require\(|Date\.now|Math\.random|AsyncStorage" "$s"`; no local re-declaration of the timing constants: `! grep -Eq "^(export )?const [A-Za-z_]+ = (60|0\.5|1 */ *6);" "$s"`.
   - `k=mobile/src/features/gacha/draw/skipPolicy.ts`: `export type SkipDecision = 'none' | 'compress';`, `export type SkipPolicyInput`, `export function skipPolicy`, `FAST_FORWARD_FROM_HOLD_FRACTION`, `from './ceremonyTimings'` present; `! grep -q "goResult" "$k"`; `! grep -Eq "from 'react|require\(|AsyncStorage|^(export )?const [A-Za-z_]+ = 0\.6;" "$k"`.
   - `p=mobile/src/features/gacha/draw/ceremonyPrefs.ts`: `export const CEREMONY_PREFS_KEY = 'recallsmith:ceremony:completed:v1';`, `export const CEREMONY_PREFS_READ_TIMEOUT_MS = 250;`, `export async function readCeremoniesCompleted` (or `export function readCeremoniesCompleted`), `export async function markCeremonyCompleted` (or `export function`), `export type CeremonyDevOverrides`, `export function getCeremonyDevOverrides`, `export function setCeremonyDevOverride`, `export function effectiveCeremoniesCompleted`, `import AsyncStorage from '@react-native-async-storage/async-storage';`, `.__DEV__ === true`, `setTimeout(`, `clearTimeout(` present; `! grep -Eq "getUserScopedKey|review/storage|ceremonyTimings|from 'react" "$p"` (comments included — see Constraints); `! grep -Eq "^let " "$p"` (no module-level memo of the count).
   - tests: `grep -q "from 'fast-check'"` in `spillSchedule.test.ts` and `skipPolicy.test.ts`; `grep -q "fc.assert("` in both; `vi.resetModules()`, `useFakeTimers`, `advanceTimersByTimeAsync` in `ceremonyPrefs.test.ts`; all 22 `it(` titles above present.
   - no `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in any scope file.
3. `cd mobile && npm run test:typecheck` — exit 0.
4. `cd mobile && npx vitest run tests/unit/spillSchedule.test.ts tests/unit/skipPolicy.test.ts tests/unit/ceremonyPrefs.test.ts --reporter=dot` — exit 0; ≥ 7 / ≥ 6 / ≥ 9 `it(` blocks respectively.
5. Scope + frozen guard: `mb=$(git merge-base HEAD delivery/r16-b-ceremony)`; `git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/features/gacha/draw/ceremonyTimings.ts mobile/src/screens/DrawCeremonyScreen.tsx mobile/src/features/gacha/draw/drawStateStore.ts mobile/src/review/storage.ts mobile/package.json mobile/package-lock.json mobile/vitest.config.ts` empty; `{ git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; }` contains only the six scope paths and `docs/delivery/r16-issues/*`.

## Do NOT

- Do NOT edit `ceremonyTimings.ts` (B02) to add anything these modules want — if a constant is missing, compute it from the ones that exist and say so in your report.
- Do NOT add a `'goResult'` (or any third) member to `SkipDecision`; do NOT reference `goResult` in `skipPolicy.ts`.
- Do NOT scope the prefs key per user (the per-user helper in `review/storage.ts` — its name must not even appear in `ceremonyPrefs.ts`), do NOT memoise the count in module state (no `let` at module scope; not a successful read, not a timed-out read, not a failed write), do NOT let any prefs function reject.
- Do NOT pad the spill schedule to 6 or 10 entries; do NOT sort `entries` by deal order (card-index order is the contract; `leaveAt` carries the order).
- Do NOT wire anything into `DrawCeremonyScreen.tsx`, `DebugMenuScreen.tsx` or `useCeremonyTimeline.ts` — B09/B13/B07 consume these modules.
- Do NOT add a dependency, a `vitest.config.ts` change, or a setup file; do NOT edit an existing test.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy / EAS / `npm install` / `npm ci`, no test gutting (no `.skip`, no `@ts-ignore`, no `eslint-disable`), no loosening of `tsconfig`.
