# B15 — C4 share pull image + R7 rating prompt + deep-link config (`share-review-deeplink`)

C4: a "Share this pull" button on DrawResult that captures the result card with `react-native-view-shot` and hands the PNG to `expo-sharing`. R7: a once-per-install store-review request (`expo-store-review`) triggered by the first Legendary pull or a 7-day streak, plus the `recallsmith://` deep-link `linking` config for `NavigationContainer`. All three native packages are installed by B01; every module here loads them lazily and never throws.

## Context

The 1.6.0 plan keeps C4 (share pull, `docs/release-1.6.0-plan-2026-09-19.md:235`) and R7 (store-review prompt + deep-link scheme, `:242`) in the binary because "view-shot cannot be added by OTA" (`:253`) and the review prompt "is only possible in a binary; cheap" (`:242`); decision #11 (`:301`) puts their native deps in the M2 prebuild (B01) and wires the UI here. The wave table row is `docs/delivery-wave-1.6-plan-2026-09-19.md:97` (verify: "typecheck + vitest (mock sharing/store-review)").

`mobile/src/screens/DrawResultScreen.tsx` (691 lines on base; B10 edits it before you — locate every anchor by literal, never by line) renders the header (`testID="draw-result-header"`, `:330`), the featured card (`screen-draw-result-featured-card`, `:381`), the summary strip (`draw-result-summary-strip`, `:443`) and a footer (`<View style={styles.footer}>`, `:583`) holding the primary CTA (`:584-606`), the wallet-empty "Earn more pulls" pill (`:611-625`, styles `earnPullsPill`/`earnPullsText` at `drawResultStyles.ts:521-537`) and the Done link (`draw-result-done-link`, `:626-636`). `hasLegendary` is already computed at `:100`. There is no share affordance and nothing ever calls `expo-store-review`. `mobile/App.tsx:167-171` mounts `NavigationContainer` without a `linking` prop, and `mobile/app.json` has no `scheme` on base (B01 adds `"scheme": "recallsmith"`, `B00-contracts.md` §2.15).

Four facts you must design around, all verified on this tree:

1. **`vi.mock` does not intercept a CommonJS `require()` under this repo's vitest (4.1.5)** — vite-node hands each module Node's own `createRequire`, so a guarded `require('expo-sharing')` goes to Node's resolver (on the pre-B01 tree it throws `Cannot find module 'expo-sharing'`; with the package installed it loads the real module and ignores the test's mock). `await import('expo-sharing')` IS intercepted, and a `vi.mock` factory satisfies it even when the package is not installed (measured 2026-09-20 with a two-function probe module under vitest 4.1.5: `require` → throw, `import()` → the mocked function). Therefore every optional native package in this issue is loaded with a guarded **dynamic `import()`** inside a function (Metro handles `import()` for installed packages; precedent for local modules at `mobile/src/screens/CardDetailScreen.tsx:29-44`, `await import('../content/activeDeck')` at `:31`). `B00-contracts.md` §2.15 (amended 2026-09-20) and §9 #13 record the same decision: "guarded dynamic `import()`"; the exported signatures are followed verbatim. `mobile/tests/setup/ceremony.ts` (B02, §4.1 item 8) already registers `vi.mock` factories for `expo-sharing`, `expo-store-review` and `react-native-view-shot`; the per-file `vi.mock` calls below re-register the same three ids, and whichever factory wins, the test file and `shareDraw.ts`/`ratingPrompt.ts` receive the SAME module instance, so `vi.mocked(captureRef)` etc. always point at the function the code under test calls.
2. The DrawResult integration test mocks `react-native` with a plain object exporting `ActivityIndicator/View/Text/ScrollView/Modal/Pressable/useWindowDimensions/StyleSheet` only (`mobile/tests/integration/draw-result.screen.test.tsx:10-27`) and `rewardWallet` with `loadRewardWalletState` only (`:39-41`). No `Alert`, no `Share`, no `Platform` — the screen must not reach for them.
3. **Tests are typechecked.** `mobile/tsconfig.json` has `strict: true` and no `include` list, so `npm run test:typecheck` (`tsc --noEmit`) covers every file under `mobile/tests/` (98 files today). Every snippet in this brief compiles under that setting; do not loosen it with `any`-casts you do not need, and never with `@ts-ignore`/`@ts-expect-error`.
4. **verify.sh greps by literal.** Step 3 fails `shareDraw.ts`/`ratingPrompt.ts` on the characters `require(` on any non-comment line, and step 4 fails `DrawResultScreen.tsx` on the package names `react-native-view-shot` / `expo-store-review` and on `from 'expo-sharing'` on any non-comment line (a line whose first non-blank characters are `//`, `*` or `/*` is skipped; a trailing `// …` after code is NOT). The brief's rule is stricter so nobody has to reason about the exemption: in comments write "a CommonJS require" (no parenthesis) and "the view-shot / sharing / store-review packages" (no package names).

The R7 streak trigger reads the existing streak snapshot (`mobile/src/features/gacha/streaks/streakTracker.ts:6-13` `StreakSnapshot.currentDailyStreak`, `:70-78` `loadStreakSnapshot()` never throws); the settlement/session screens that produce the streak are out of scope, so DrawResult is the one natural pause where both triggers are evaluated.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` §2.13 (`CEREMONY_COPY_V10.shareCta` = `'Share this pull'`, B10), §2.15 (this issue's exported signatures — verbatim), §4.1 item 8 (B02's setup mocks for `expo-sharing` / `expo-store-review` / `react-native-view-shot`), §4.3 (DrawResult testIDs that must survive; new `draw-result-share-button`), §4.4 (draw-result test: add cases only), §5 (deps: B10, +B13 — App.tsx is serialised), §8.
2. `mobile/src/screens/DrawResultScreen.tsx` as merged after B10: `:1-25` imports (`useRef`/`useState`/`useEffect` already imported; `colors`, `PAGE_GRADIENT_LIGHT` already imported), `:82-113` state + `hasLegendary`, `:142-170` the two mount effects (pattern for the new one), `:326-463` header → featured → summary strip (the capture target), `:582-637` footer.
3. `mobile/tests/integration/draw-result.screen.test.tsx:1-100` (mocks, fixture, `flush()`, `collectText`), `:102-118` (the first case: how a tree is created and queried).
4. `mobile/src/features/gacha/draw/ceremonyCopy.ts` — `CEREMONY_COPY_V10` (added by B10; confirm `shareCta`).
5. `mobile/src/features/gacha/streaks/streakTracker.ts:6-13` (`StreakSnapshot`), `:70-78` (`loadStreakSnapshot`, never throws, `EMPTY_SNAPSHOT` on miss).
6. `mobile/tests/unit/drawStateSync.test.ts:1-16` (Map-backed AsyncStorage mock to copy into `ratingPrompt.test.ts`).
7. `mobile/App.tsx:7` (`NavigationContainer` import), `:167-171` (the container; add `linking={linking}` here), `:11` (type import — put the new import next to it). B13 has already added a `CeremonyTuning` import + `Stack.Screen`; leave them.
8. `mobile/src/navigation/types.ts:14-22` (`Home`), `:36` (`Library`), `:38` (`CardDetail: { cardId: string }`), `:102-126` (`DrawResult`, `slug` required), `:171-174` (`Draw`, `slug?` optional) — the five routes the linking config names.
9. `mobile/node_modules/@react-navigation/native/lib/typescript/src/types.d.ts:31` (`LinkingOptions<ParamList>`); `@react-navigation/core` exports `getStateFromPath` (pure, node-safe — the linking test uses it).
10. Format exemplar: `docs/delivery/r16-issues/A08-draw-state-adoption.md`.

## Constraints

- **Scope (the ONLY files that may change; C = new):**
  - C `mobile/src/features/gacha/share/shareDraw.ts`
  - C `mobile/src/features/gacha/milestones/ratingPrompt.ts` (the existing `milestones/milestoneTracker.ts` is NOT edited)
  - C `mobile/src/navigation/linking.ts` (B00 §1 — the config is a navigation concern and `App.tsx` may only import it)
  - E `mobile/src/screens/DrawResultScreen.tsx`
  - E `mobile/App.tsx` — linking only: one import line + `linking={linking}` on `NavigationContainer`
  - C `mobile/tests/unit/shareDraw.test.ts`
  - C `mobile/tests/unit/ratingPrompt.test.ts`
  - C `mobile/tests/unit/linking.test.ts` (added beyond the spec's two test files so the deep-link config is asserted, not just grepped — five lines of config, one 20-line test)
  - E `mobile/tests/integration/draw-result.screen.test.tsx` — **add cases and `vi.mock` blocks only**; no existing `it(` title, fixture value or assertion changes (`B00-contracts.md` §4.4)
- **Frozen files — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched: `drawResultStyles.ts` (reuse `earnPullsPill`/`earnPullsText`/`doneText`/`pressed`), `ceremonyCopy.ts`, `types.ts`, `app.json`, `package.json`, `streakTracker.ts`, `milestoneTracker.ts`.
- **No new dependencies.** `react-native-view-shot`, `expo-sharing`, `expo-store-review` are already in `package.json` (B01). Only dynamic `import()` of those three, inside `try/catch`, inside a function — never a static `import … from` of any of them, never `require(`.
- **Never throws:** `shareDrawImage` and `maybeRequestRating` resolve to a status on every path (missing module, unavailable, rejected promise, storage error).
- **Once per install, ever:** `RATING_PROMPT_KEY` is a plain device-global AsyncStorage key (not `getUserScopedKey`), written BEFORE `requestReview()` is awaited so a throwing OS call can never lead to a second prompt; `resetAllProgress` prefixes (`mobile/src/features/debug/resetProgress.ts:8-15`) do not cover it, so a debug reset does not re-arm it — intended.
- **DrawResult test surface:** the screen may use only `View`, `Text`, `Pressable`, `ScrollView`, `Modal`, `ActivityIndicator` from `react-native` (what the test mocks export). No `Alert`, `Share`, `Platform`, `Linking` in `DrawResultScreen.tsx`.
- **testIDs:** every existing `screen-draw-result-*` / `draw-result-*` testID stays. New: `draw-result-share-button` (`SHARE_DRAW_TESTID`), `draw-result-share-target` (the capture wrapper), `draw-result-share-status` (inline status Text, only on `unavailable`/`failed`).
- **Copy:** button label is `CEREMONY_COPY_V10.shareCta` (`'Share this pull'`); while capturing the label is `'Preparing image…'`; status texts `'Sharing is not available on this device'` / `'Could not prepare the image'`.
- **Banned literals** in any new identifier/comment/string: `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`.
- **Comment-safe wording (verify.sh greps whole files, comments included):** in `shareDraw.ts` and `ratingPrompt.ts` never write the characters `require(` — not even inside a comment; say "a CommonJS require". In `DrawResultScreen.tsx` never write `react-native-view-shot`, `expo-store-review` or `from 'expo-sharing'` — not even inside a comment; say "the view-shot / sharing / store-review packages" or "see shareDraw.ts".
- **Typed tests:** `mobile/tests/` is inside `tsc --noEmit`'s file set (`tsconfig.json` has no `include`, `strict: true`). Snippets below are written to compile as-is; where a mocked function must accept whatever the screen passes, declare it with a rest parameter (`vi.fn(async (..._args: unknown[]) => …)`), and where a navigation `params` object must be inspected, assert with `toEqual`/`toMatchObject` or cast once to `Record<string, unknown> | undefined` (`Route.params` is typed `Readonly<object | undefined>` in `@react-navigation/routers`, so `params.slug` is a TS2339 error).
- **Return-type annotations:** never `JSX.Element` (no global `JSX` in `@types/react` 19.1); leave inferred.

## Changes required

1. **`mobile/src/features/gacha/share/shareDraw.ts` (new).**
   ```ts
   import type React from 'react';

   export type ShareDrawResult = { status: 'shared' | 'unavailable' | 'cancelled' | 'failed' };
   export const SHARE_DRAW_TESTID = 'draw-result-share-button';

   type ViewShotModule = { captureRef: (view: unknown, options?: Record<string, unknown>) => Promise<string> };
   type SharingModule = {
     isAvailableAsync: () => Promise<boolean>;
     shareAsync: (uri: string, options?: Record<string, unknown>) => Promise<unknown>;
   };

   async function loadViewShot(): Promise<ViewShotModule | null>;   // guarded `await import('react-native-view-shot')`; accepts `captureRef` on the module or on `.default`; anything else → null
   async function loadSharing(): Promise<SharingModule | null>;     // guarded `await import('expo-sharing')`; needs both functions, else null

   /** One share at a time (module-level `inFlight`). Never throws. */
   export async function shareDrawImage(
     viewRef: React.RefObject<unknown>,
     opts: { slug: string; deckTitle?: string },
   ): Promise<ShareDrawResult>;
   ```
   Algorithm: `if (inFlight) return { status: 'cancelled' }` (a second tap while the sheet is open is the cancelled one) → `inFlight = true` → `try { if (!viewRef.current) return unavailable; const [viewShot, sharing] = await Promise.all([loadViewShot(), loadSharing()]); if (!viewShot || !sharing) return unavailable; if (!(await sharing.isAvailableAsync())) return unavailable; const uri = await viewShot.captureRef(viewRef, { format: 'png', quality: 1, result: 'tmpfile' }); if (typeof uri !== 'string' || uri.length === 0) return failed; await sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: `${opts.deckTitle?.trim() || opts.slug} pull` }); return shared; } catch { return failed; } finally { inFlight = false; }`. Pass the ref OBJECT to `captureRef` (view-shot accepts a ref object; the test asserts the same object). Header comment: why a dynamic `import()` and not a CommonJS require (fact 1 above — write exactly the words "CommonJS require", never the characters `require(`, which verify.sh step 3 rejects anywhere in the file), and that the sharing package cannot report dismissal, so `'cancelled'` is only ever the re-entrant tap.

2. **`mobile/src/features/gacha/milestones/ratingPrompt.ts` (new).**
   ```ts
   import AsyncStorage from '@react-native-async-storage/async-storage';

   export const RATING_PROMPT_KEY = 'recallsmith:rating-prompt:v1';
   export const RATING_STREAK_DAYS = 7;
   /** DrawResult waits this long after mount before asking (the Pokedex pill and the featured spring are done). */
   export const RATING_PROMPT_DELAY_MS = 1500;
   export type RatingTrigger = 'first-legendary' | 'streak-7';
   export type RatingPromptState = { requestedAt: number; trigger: RatingTrigger } | null;
   export type RatingPromptOutcome = 'requested' | 'already' | 'unavailable' | 'failed';

   /** Pure: true only when nothing has been recorded (state === null). `trigger` is accepted for symmetry/logging. */
   export function shouldRequestRating(state: RatingPromptState, trigger: RatingTrigger): boolean;
   /** Pure: 'first-legendary' when hasLegendary, else 'streak-7' when currentDailyStreak >= RATING_STREAK_DAYS, else null. */
   export function resolveRatingTrigger(input: { hasLegendary: boolean; currentDailyStreak: number }): RatingTrigger | null;
   /** Pure: JSON with a finite requestedAt >= 0 and a known trigger → state; anything else (null, bad JSON, wrong shape) → null. */
   export function parseRatingPromptState(raw: string | null): RatingPromptState;
   /** Never throws. */
   export async function maybeRequestRating(trigger: RatingTrigger): Promise<RatingPromptOutcome>;
   ```
   `maybeRequestRating`: read `AsyncStorage.getItem(RATING_PROMPT_KEY)` in `try/catch` → on error return `'failed'` (fail closed: a storage fault must not risk a second prompt) → `parseRatingPromptState` → `if (!shouldRequestRating(state, trigger)) return 'already'` → `const review = await loadStoreReview()` (guarded `await import('expo-store-review')`, needs `isAvailableAsync` + `requestReview`; else `null`) → `if (!review) return 'unavailable'` → `try { if (!(await review.isAvailableAsync())) return 'unavailable'; await AsyncStorage.setItem(RATING_PROMPT_KEY, JSON.stringify({ requestedAt: Date.now(), trigger })); await review.requestReview(); return 'requested'; } catch { return 'failed'; }`. Note the order: `'unavailable'` writes nothing (the one chance is kept for a device where the sheet can appear); the write lands before `requestReview` so a rejected OS call still counts as consumed — document both in comments (same comment rule as `shareDraw.ts`: "CommonJS require", never `require(`).

3. **`mobile/src/navigation/linking.ts` (new)** — verbatim from `B00-contracts.md` §2.15:
   ```ts
   import type { LinkingOptions } from '@react-navigation/native';
   import type { RootStackParamList } from './types';

   /** `recallsmith` is registered as the app scheme in app.json (B01). */
   export const linking: LinkingOptions<RootStackParamList> = {
     prefixes: ['recallsmith://'],
     config: {
       screens: {
         Home: 'home',
         Draw: 'draw/:slug?',
         Library: 'library',
         CardDetail: 'card/:cardId',
         DrawResult: 'result/:slug',
       },
     },
   };
   ```
   (`DrawResult` opened by link has no `drawResult` param and renders the existing "Draw result unavailable → Back to draw" state, `DrawResultScreen.tsx:240-264` — acceptable, no change.)

4. **`mobile/App.tsx` — linking only.** Add `import { linking } from './src/navigation/linking';` directly after `import type { RootStackParamList } from './src/navigation/types';` and add the prop `linking={linking}` to the `<NavigationContainer` element (the line after `ref={navigationRef}`). Nothing else: `git diff --numstat` for `App.tsx` must be exactly 2 added / 0 deleted.

5. **`mobile/src/screens/DrawResultScreen.tsx`.**
   a. Imports (after the existing `drawResultStyles` import): `import { CEREMONY_COPY_V10 } from '../features/gacha/draw/ceremonyCopy';`, `import { SHARE_DRAW_TESTID, shareDrawImage, type ShareDrawResult } from '../features/gacha/share/shareDraw';`, `import { RATING_PROMPT_DELAY_MS, maybeRequestRating, resolveRatingTrigger } from '../features/gacha/milestones/ratingPrompt';`, `import { loadStreakSnapshot } from '../features/gacha/streaks/streakTracker';`.
   b. State, next to the existing `useState`s: `const shareTargetRef = useRef<View>(null);` and `const [shareStatus, setShareStatus] = useState<ShareDrawResult['status'] | 'idle' | 'sharing'>('idle');`.
   c. **Rating effect**, placed directly after the `isPermissionPromptPending` effect (before any early `return`; hooks order is fixed):
      ```ts
      // R7: one store-review request per install, at a natural pause. First Legendary wins over the
      // streak trigger; ratingPrompt.ts guarantees once-ever, this effect only decides the moment.
      useEffect(() => {
        if (cards.length === 0) return;
        let cancelled = false;
        const timer = setTimeout(() => {
          void (async () => {
            const snapshot = await loadStreakSnapshot();
            const trigger = resolveRatingTrigger({ hasLegendary, currentDailyStreak: snapshot.currentDailyStreak });
            if (!trigger || cancelled) return;
            await maybeRequestRating(trigger);
          })().catch(() => {});
        }, RATING_PROMPT_DELAY_MS);
        return () => { cancelled = true; clearTimeout(timer); };
      }, []);
      ```
   d. **Capture target**: wrap the three consecutive siblings header → featured block → summary strip (from the `<View style={styles.header} testID="draw-result-header">` element through the `</View>` closing `testID="draw-result-summary-strip"`) in `<View ref={shareTargetRef} collapsable={false} testID="draw-result-share-target" style={{ backgroundColor: PAGE_GRADIENT_LIGHT[0] }}>` — `collapsable={false}` so Android keeps a native node to snapshot; the top gradient stop as background so the PNG is opaque while the wrapper stays invisible on screen. Nothing inside the wrapper changes.
   e. **Share handler** (near `handleDone`):
      ```ts
      const handleShare = async () => {
        if (shareStatus === 'sharing') return;
        setShareStatus('sharing');
        const result = await shareDrawImage(shareTargetRef, { slug: params.slug, deckTitle: params.deckTitle });
        setShareStatus(result.status === 'cancelled' ? 'idle' : result.status);
      };
      ```
   f. **Share button** in the footer, directly after the primary CTA `Pressable` and before the `Earn more pulls` block:
      ```tsx
      <Pressable
        testID={SHARE_DRAW_TESTID}
        accessibilityRole="button"
        accessibilityLabel={CEREMONY_COPY_V10.shareCta}
        accessibilityState={{ disabled: shareStatus === 'sharing' }}
        disabled={shareStatus === 'sharing'}
        style={({ pressed }) => [styles.earnPullsPill, pressed && styles.pressed]}
        onPress={() => void handleShare()}
      >
        <Text style={styles.earnPullsText} numberOfLines={1}>
          {shareStatus === 'sharing' ? 'Preparing image…' : CEREMONY_COPY_V10.shareCta}
        </Text>
      </Pressable>
      {shareStatus === 'unavailable' || shareStatus === 'failed' ? (
        <Text testID="draw-result-share-status" style={styles.doneText} numberOfLines={1}>
          {shareStatus === 'unavailable' ? 'Sharing is not available on this device' : 'Could not prepare the image'}
        </Text>
      ) : null}
      ```
      The early-return states (loading / error / no cards) get no share button.

6. **`mobile/tests/unit/shareDraw.test.ts` (new).** Hoisted mocks: `vi.mock('react-native-view-shot', () => ({ captureRef: vi.fn(async () => 'file:///tmp/draw.png') }))`, `vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(async () => true), shareAsync: vi.fn(async () => {}) }))`; import the mocked fns (`import { captureRef } from 'react-native-view-shot'; import * as Sharing from 'expo-sharing';`) and use `vi.mocked(...)`; `beforeEach` resets implementations. Cases (titles verbatim):
   1. `it('shares a captured PNG through expo-sharing', …)` — `ref = { current: {} }`; result `{ status: 'shared' }`; `captureRef` called once with `(ref, expect.objectContaining({ format: 'png', result: 'tmpfile' }))`; `shareAsync` called with `('file:///tmp/draw.png', expect.objectContaining({ mimeType: 'image/png', dialogTitle: 'C# Interview pull' }))` for `{ slug: 'csharp', deckTitle: 'C# Interview' }`; with `deckTitle` omitted the dialog title is `'csharp pull'`.
   2. `it('returns unavailable when the ref has no node or sharing is unavailable', …)` — `{ current: null }` → `'unavailable'`, `captureRef` not called; `isAvailableAsync` → `false` → `'unavailable'`, `captureRef` not called.
   3. `it('returns failed and never throws when capture or share rejects', …)` — `captureRef` rejects → `'failed'`; `shareAsync` rejects → `'failed'`; `captureRef` resolves `''` → `'failed'`, `shareAsync` not called.
   4. `it('reports cancelled for a second call while one share is in flight', …)` — `shareAsync` returns a deferred promise; call twice without awaiting; the second resolves `{ status: 'cancelled' }` before the deferred is resolved; resolve it → first is `'shared'`; a third call afterwards is `'shared'` (flag reset).
   5. `it('returns unavailable when expo-sharing cannot be loaded', …)` — `vi.resetModules(); vi.doMock('expo-sharing', () => { throw new Error('missing'); });` then `const mod = await import('../../src/features/gacha/share/shareDraw')` → `'unavailable'`; `vi.doUnmock('expo-sharing'); vi.resetModules()` in `finally`.
   6. `it('exposes the DrawResult share testID', …)` — `SHARE_DRAW_TESTID === 'draw-result-share-button'`.

7. **`mobile/tests/unit/ratingPrompt.test.ts` (new).** Map-backed AsyncStorage mock (`drawStateSync.test.ts:3-16`, `getItem`/`setItem`/`removeItem`); `vi.mock('expo-store-review', () => ({ isAvailableAsync: vi.fn(async () => true), requestReview: vi.fn(async () => {}) }))`; `store.clear()` + `mockClear()` in `beforeEach`. Cases (titles verbatim):
   1. `it('shouldRequestRating is true only for a null state', …)`
   2. `it('resolveRatingTrigger prefers first-legendary, then a 7-day streak, else null', …)` — `{true, 0}` → `'first-legendary'`; `{true, 9}` → `'first-legendary'`; `{false, 7}` → `'streak-7'`; `{false, 6}` → `null`; `{false, 0}` → `null`.
   3. `it('parseRatingPromptState rejects malformed values', …)` — `null`, `'{}'`, `'not json'`, `'{"requestedAt":"x","trigger":"streak-7"}'`, `'{"requestedAt":5,"trigger":"bogus"}'` → `null`; `'{"requestedAt":5,"trigger":"first-legendary"}'` → that object.
   4. `it('requests a review once per install and records it under RATING_PROMPT_KEY', …)` — first call `'requested'`; `store.get(RATING_PROMPT_KEY)` parses to `{ requestedAt: number, trigger: 'first-legendary' }`; `requestReview` called once; second call with `'streak-7'` → `'already'`, still once.
   5. `it('returns unavailable when store review is unavailable and keeps the one chance', …)` — `isAvailableAsync` → `false` → `'unavailable'`, key absent, `requestReview` not called; then availability `true` → `'requested'`.
   6. `it('returns failed when storage cannot be read and never throws', …)` — `getItem` rejects once → `'failed'`; `requestReview` not called.
   7. `it('a review request that throws still counts as consumed', …)` — `requestReview` rejects → `'failed'`; key present; next call → `'already'`.
   8. `it('returns unavailable when expo-store-review cannot be loaded', …)` — `vi.resetModules(); vi.doMock('expo-store-review', () => { throw new Error('missing'); })`; dynamic-import the module → `'unavailable'`, key absent; `vi.doUnmock` + `vi.resetModules()` in `finally`.

8. **`mobile/tests/unit/linking.test.ts` (new).** `import { getStateFromPath } from '@react-navigation/core';` (the pure resolver; `@react-navigation/native` re-exports it at `mobile/node_modules/@react-navigation/native/lib/typescript/src/index.d.ts:17` but importing `native` pulls `react-native` into a node test — `core` is a hoisted transitive dependency at `mobile/node_modules/@react-navigation/core` and loads under plain node) and `import { linking } from '../../src/navigation/linking';`. **Typing:** `getStateFromPath` returns `PartialState<NavigationState> | undefined` (`mobile/node_modules/@react-navigation/core/lib/typescript/src/getStateFromPath.d.ts:8-32`) whose `routes[0].params` is `Readonly<object | undefined>` (`@react-navigation/routers/lib/typescript/src/types.d.ts:51-69`), so `params?.slug` / `params.cardId` are TS2339 errors under `tsc` (tests are typechecked, Context fact 3). Use this helper and assert on whole objects:
   ```ts
   function firstRoute(path: string) {
     const state = getStateFromPath(path, linking.config);
     expect(state).toBeDefined();
     const route = state!.routes[0];
     return { name: route.name, params: route.params as Record<string, unknown> | undefined };
   }
   ```
   One `it('maps recallsmith:// paths onto the five linked routes', …)`: `expect(linking.prefixes).toEqual(['recallsmith://'])`; `firstRoute('result/csharp')` → `name` is `'DrawResult'` and `params` `toEqual({ slug: 'csharp' })`; `firstRoute('draw')` → `name` is `'Draw'` and `params?.slug` is `undefined` (the resolver returns `params: {}` for an omitted optional segment — do not assert `params` is `undefined`); `firstRoute('draw/aws')` → `Draw` with `params` `toEqual({ slug: 'aws' })`; `firstRoute('card/abc')` → `CardDetail` with `params` `toEqual({ cardId: 'abc' })`; `firstRoute('library').name` is `'Library'`; `firstRoute('home').name` is `'Home'`. (`linking.config` is `LinkingOptions<RootStackParamList>['config']`, possibly `undefined` in the type — pass it as is; `getStateFromPath`'s `options` parameter is optional, so this compiles.)

9. **`mobile/tests/integration/draw-result.screen.test.tsx` — additions only.** Add three module-level fixtures + three hoisted `vi.mock` blocks after the existing `PermissionPromptScreen` mock (`:45-48`):
   ```ts
   let shareResultFixture: { status: 'shared' | 'unavailable' | 'cancelled' | 'failed' } = { status: 'shared' };
   // Rest parameters on the vi.fn: the wrapper below spreads whatever the screen passed
   // (ref, opts). Spreading into a zero-parameter vi.fn is TS2556 ("A spread argument must
   // either have a tuple type or be passed to a rest parameter") under tsc, which covers tests.
   const shareDrawImageMock = vi.fn(async (..._args: unknown[]) => shareResultFixture);
   vi.mock('../../src/features/gacha/share/shareDraw', () => ({
     SHARE_DRAW_TESTID: 'draw-result-share-button',
     shareDrawImage: (...args: unknown[]) => shareDrawImageMock(...args),
   }));
   let streakFixture = { currentDailyStreak: 0 };
   vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
     loadStreakSnapshot: vi.fn(async () => streakFixture),
   }));
   const maybeRequestRatingMock = vi.fn(async (..._args: unknown[]) => 'requested' as const);
   vi.mock('../../src/features/gacha/milestones/ratingPrompt', async (importOriginal) => ({
     ...(await importOriginal<typeof import('../../src/features/gacha/milestones/ratingPrompt')>()),
     maybeRequestRating: (...args: unknown[]) => maybeRequestRatingMock(...args),
   }));
   ```
   (Keep the closure wrappers: vitest hoists the `vi.mock` calls AND the file's static imports above these `const`s, so a factory that referenced `shareDrawImageMock` directly would run while the `const` is still in its temporal dead zone — the same reason the file already wraps `clearPermissionPromptPendingMock` at `:44-48`. The wrapper spreads `args` into a rest-typed mock, so no tuple typing is needed. `vi.fn(async (..._args: unknown[]) => …)` is the shape to copy; do not write `(...args: any[])` wrappers around zero-parameter mocks.) Also `import { RATING_PROMPT_DELAY_MS } from '../../src/features/gacha/milestones/ratingPrompt';`. Extend the existing `beforeEach` by appending resets for the three fixtures/mocks (`shareResultFixture = { status: 'shared' }; streakFixture = { currentDailyStreak: 0 }; shareDrawImageMock.mockClear(); maybeRequestRatingMock.mockClear();` — appending lines inside the existing block is allowed; do not reorder or remove its lines). New cases, titles verbatim, appended inside `describe('DrawResultScreen v9')`.

   **Timer hygiene for the new cases.** The fifteen earlier cases never unmount their trees, so with the new rating effect each of them leaves a REAL 1500 ms `setTimeout` pending that, if the file ever runs slowly (the driver runs the full suite under parallel load), fires during a later case and calls the mocked `maybeRequestRating('first-legendary')`. The new cases therefore (a) install fake timers BEFORE rendering so their own effect timers are on the fake clock, (b) `maybeRequestRatingMock.mockClear()` right after `vi.useFakeTimers()` and again between two renders in one case, (c) assert with `toHaveBeenCalledWith(...)` / `not.toHaveBeenCalledWith(...)` rather than bare call counts where a stray `'first-legendary'` could pollute, and (d) `tree.unmount()` inside `act` in their `finally` so they leave nothing pending themselves. Do not add an `afterEach` that touches the earlier cases' trees (you have no handle to them and their lines may not change).
   1. `it('shares the pull image from the share button and reports unavailable inline', …)` — create the tree with `renderer.create(<DrawResultScreen … />, { createNodeMock: () => ({}) })` so the wrapper ref has a node (the test's mocked `View` is a function component; under React 19.1 — `mobile/package.json:42` — `ref` arrives as an ordinary prop and the mock spreads `...props` onto the host `'View'` element, so `createNodeMock` populates `shareTargetRef.current`); `draw-result-share-target` exists with `collapsable === false`; press `draw-result-share-button`; `await flush()` → `shareDrawImageMock` called once with `(expect.objectContaining({ current: expect.anything() }), { slug: 'csharp', deckTitle: 'C# Interview' })`; no `draw-result-share-status` node. Then `shareResultFixture = { status: 'unavailable' }`, new tree, press, flush → `draw-result-share-status` text is `'Sharing is not available on this device'`; button text back to `'Share this pull'`. Unmount both trees in `finally` (`await act(async () => { tree.unmount(); })`).
   2. `it('requests a store review once for a Legendary pull after the delay', …)` — `vi.useFakeTimers(); maybeRequestRatingMock.mockClear();` in a `try`, `vi.useRealTimers()` (after unmounting) in `finally`; render (fixture has a LEG card) and `await flush()`; `expect(maybeRequestRatingMock).not.toHaveBeenCalled()` (taken immediately after render, inside the fake-timer window); `await act(async () => { await vi.advanceTimersByTimeAsync(RATING_PROMPT_DELAY_MS); })` → `expect(maybeRequestRatingMock).toHaveBeenCalledWith('first-legendary')` and `toHaveBeenCalledTimes(1)`.
   3. `it('requests a store review on a seven-day streak when no Legendary was pulled', …)` — same fake-timer frame; params with `cards` all `'COM'`/`'RAR'` and `streakFixture = { currentDailyStreak: 7 }` → after the same advance, `toHaveBeenCalledWith('streak-7')`; unmount, `maybeRequestRatingMock.mockClear()`, then `streakFixture = { currentDailyStreak: 6 }`, render again, advance → `expect(maybeRequestRatingMock).not.toHaveBeenCalledWith('streak-7')` and `not.toHaveBeenCalled()`; unmount in `finally`.

Estimated size: `shareDraw.ts` ≈ 90 LOC, `ratingPrompt.ts` ≈ 110, `linking.ts` ≈ 20, `DrawResultScreen.tsx` +≈ 60, `App.tsx` +2, tests ≈ 120 + 150 + 25 + 90.

## Acceptance

Run from `mobile/`. `docs/delivery/r16-issues/B15.verify.sh` runs exactly these from the worktree root.

1. `npx vitest run tests/unit/shareDraw.test.ts tests/unit/ratingPrompt.test.ts tests/unit/linking.test.ts tests/integration/draw-result.screen.test.tsx --reporter=dot` exits 0; the three unit files carry the case titles above (≥ 6 / ≥ 8 / ≥ 1 `it(`), and `draw-result.screen.test.tsx` carries the three new titles AND every pre-existing title unchanged: the eleven from the base file (ten `it(` at `:102-319` plus the `it.each` at `:340`, titles listed in verify.sh) and B10's four (`marks cards missing from revealedUids with a Not flipped chip`, `shows no unrevealed chips when revealedUids is absent`, `shows no unrevealed chips when every card was flipped`, `marks a single unflipped pull on the featured card`). `git diff -U0 <merge-base> -- tests/integration/draw-result.screen.test.tsx` contains NO removed line (additions only, B00 §4.4) — appending inside the existing `beforeEach` block is an addition; re-ordering or rewriting a line is not.
2. `npm run test:typecheck` exits 0.
3. Module guards: `shareDraw.ts` contains the exact lines `export const SHARE_DRAW_TESTID = 'draw-result-share-button';` and `export type ShareDrawResult = { status: 'shared' | 'unavailable' | 'cancelled' | 'failed' }` (B00 §2.15 verbatim, one line), `export async function shareDrawImage`, `import('react-native-view-shot')`, `import('expo-sharing')`, `isAvailableAsync`, `captureRef(`; `ratingPrompt.ts` contains `export const RATING_PROMPT_KEY = 'recallsmith:rating-prompt:v1';`, `export const RATING_STREAK_DAYS = 7;`, `export const RATING_PROMPT_DELAY_MS`, `export type RatingTrigger = 'first-legendary' | 'streak-7';` (one line), `export function shouldRequestRating`, `export function resolveRatingTrigger`, `export function parseRatingPromptState`, `export async function maybeRequestRating`, `import('expo-store-review')`, `from '@react-native-async-storage/async-storage'`; NEITHER file contains `require(` (checked on non-comment lines by verify.sh, but the brief's rule is stricter: never write it, comments included), a static `import … from 'expo-sharing'|'react-native-view-shot'|'expo-store-review'`, or `getUserScopedKey`; `linking.ts` contains `export const linking: LinkingOptions<RootStackParamList>`, `prefixes: ['recallsmith://']` and the five route lines verbatim (`Home: 'home'`, `Draw: 'draw/:slug?'`, `Library: 'library'`, `CardDetail: 'card/:cardId'`, `DrawResult: 'result/:slug'`). `linking.test.ts` imports from `'@react-navigation/core'`.
4. Screen guards: `DrawResultScreen.tsx` contains `testID={SHARE_DRAW_TESTID}`, `CEREMONY_COPY_V10.shareCta`, `draw-result-share-target`, `collapsable={false}`, `draw-result-share-status`, `shareDrawImage(shareTargetRef`, `resolveRatingTrigger(`, `maybeRequestRating(`, `RATING_PROMPT_DELAY_MS`, `loadStreakSnapshot`, `Sharing is not available on this device`, `Could not prepare the image`, `Preparing image`; still contains every base testID (`screen-draw-result-root`, `draw-result-header`, `draw-result-collection-bar`, `screen-draw-result-featured-card`, `draw-result-summary-strip`, `draw-result-open-all-cards`, `draw-result-all-cards-sheet`, `screen-draw-result-primary-cta`, `draw-result-earn-pulls-link`, `draw-result-done-link`, `draw-result-confetti`, `screen-draw-result-detail-close`, `draw-result-guarantee-badge`); contains none of `from 'expo-sharing'`, `react-native-view-shot`, `expo-store-review`, `Alert.alert(`, `Share.share(`, `Linking.openURL(`, `RN.Alert`/`RN.Share`/`RN.Platform`/`RN.Linking` (verify.sh checks non-comment lines; the brief's rule is stricter — keep package names out of comments too); and neither the multi-line `import {` … `} from 'react-native';` block (`:2-9` on base) nor any single-line `import { … } from 'react-native'` names `Alert`, `Share`, `Platform` or `Linking`.
5. `App.tsx` contains `import { linking } from './src/navigation/linking';` and `linking={linking}`; `git diff --numstat <merge-base> -- mobile/App.tsx` is exactly `2 0`.
6. Scope + frozen guard (purely negative): changed/untracked paths ⊆ scope ∪ `docs/delivery/r16-issues/`; zero diff on the frozen files AND on `drawResultStyles.ts`, `ceremonyCopy.ts`, `navigation/types.ts`, `streakTracker.ts`, `milestoneTracker.ts`, `app.json`, `package.json`, `package-lock.json`, `vitest.config.ts`, `tests/setup/`; no `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in the scope files; `"vite": "7.2.4"` in `package.json`; no `@sentry` under `mobile/src`; `app.json` `scheme` is `recallsmith` (B01's line — reported as a warning, not a failure, if missing).

## Do NOT

- Do NOT add, remove or bump a dependency; do NOT edit `package.json`, `package-lock.json`, `app.json`, `vitest.config.ts`, `tests/setup/*`.
- Do NOT statically import or CommonJS-require `expo-sharing`, `react-native-view-shot` or `expo-store-review` anywhere (the modules must load, and be mockable, without them). Do NOT write the characters `require(` in `shareDraw.ts` / `ratingPrompt.ts`, nor the package names `react-native-view-shot` / `expo-store-review` / `from 'expo-sharing'` in `DrawResultScreen.tsx` — not even in comments (verify.sh greps for them).
- Do NOT write `(...args: any[]) => mock(...args)` around a zero-parameter `vi.fn`, and do NOT read `route.params.slug` off a `getStateFromPath` result without the `Record<string, unknown> | undefined` cast — both fail `tsc`, which covers `mobile/tests/`.
- Do NOT scope `RATING_PROMPT_KEY` per user, do NOT re-arm it on reset, do NOT call `requestReview` on any path other than the one recorded above, do NOT add a second trigger site outside `DrawResultScreen`.
- Do NOT use `Alert`/`Share`/`Platform`/`Linking` in `DrawResultScreen.tsx`; do NOT add styles to `drawResultStyles.ts` (reuse `earnPullsPill`/`earnPullsText`/`doneText`); do NOT move or rename any existing testID; do NOT change the featured-card or summary-strip internals (B10 owns them).
- Do NOT touch `App.tsx` beyond the import and the `linking` prop (B13's `CeremonyTuning` lines and B01's boundary/worklet probe stay as they are).
- Do NOT modify or delete existing `it(...)` cases, fixture values or `vi.mock` factories in `draw-result.screen.test.tsx`; do NOT edit any other test file.
- Do NOT touch the frozen files (`mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`) or `milestoneTracker.ts` / `streakTracker.ts`.
- Standing rules: no `git push`, no PR, never touch `main`, no EAS/expo/npm-install command, no test gutting (`.skip`, `.only`, `@ts-ignore`, `eslint-disable`), no loosening of `tsconfig`.
