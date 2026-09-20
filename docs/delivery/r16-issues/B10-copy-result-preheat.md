# B10 — Copy, DrawResult reveal chips, DrawScreen preheat, nav params (`copy-result-preheat`)

`ceremonyCopy.ts` withholds the rarity word ('Pack inbound' ×3, 'Pack open') and gains `CEREMONY_COPY_V10` · `navigation/types.ts` gains the `tapFlow`/`pityThreshold`/`pityCardIndex`/`poolExhausted` and `revealedUids`/`tableReached` params · `DrawResultScreen` marks cards the player never flipped and wears the rarity frame + glow (CardFace) · `DrawScreen` prewarms audio and the foil shader on mount and forwards the pity/pool facts into the ceremony.

## Context

The approach title already spoils the pull: `CEREMONY_COPY_V9.approach.rareTitles` (`mobile/src/features/gacha/draw/ceremonyCopy.ts:72-76`) says `'Rare inbound'` / `'Legendary inbound'` and `DrawCeremonyScreen.tsx:451-459` picks it by `peakRarity` before anything has torn. Design §3.2 (`docs/release-1.6.0-plan-2026-09-19.md`, "稀有度预告") makes the tell a single learnable channel — colour temperature during hold — and withholds it "in EVERY channel including copy" through swipe and approach: all three `rareTitles` become `'Pack inbound'`, and `'flash-reveal'` (`:86-89`, `'Card revealed'`) becomes `'Pack open'` because the flash no longer reveals a card face (the table does). Those two literals are what B09's screen and test rewrite hang off, which is why the contracts file reversed the spec's B09→B10 edge (`docs/delivery/r16-issues/B00-contracts.md` §9 #2): **B10 runs before B09** with deps B02, B04, B08, B12.

The same reversal means this issue must keep the *current* ceremony test green: `mobile/tests/integration/draw-ceremony.screen.test.tsx` asserts the old literals at `:152`, `:166`, `:667` (`'Legendary inbound'`), `:243`, `:258` (`'Rare inbound'`) and `:197`, `:204`, `:288`, `:378`, `:384` (`'Card revealed'`), and the driver runs the full vitest suite on every issue. So this brief adds that test file to the scope for exactly those ten in-place literal substitutions (B00 §4.2 step 9) — the same substitutions B09's verify applies to the base file when it derives its expected prefix, so B09's byte-exact check stays idempotent (the file keeps 787 lines).

DrawResult today ignores what happened on the table: `ceremonyEcho` (`mobile/src/navigation/types.ts:120-123`) carries only `rarity`/`phaseCue`, nothing reads it, and the screen (`mobile/src/screens/DrawResultScreen.tsx`) has no idea which cards the player flipped. With tap-to-flip reachable (design §3.3) the player may `'Skip · 3/10'` to the result; B09's `goResult` will pass `revealedUids` and `ceremonyEcho.tableReached` (B00 §3.6), and this issue renders the small 'Not flipped' chip on the cards that were never turned (`release-1.6.0-plan:173`, "mark cards not in revealedUids with a small 'unrevealed' chip; no motion changes; keep every draw-result testID") and puts the B12 rarity frame + glow 9-slice on the featured card ("CardFace template + rarity frame PNG"). Both are optional-prop-safe: with no `revealedUids` in the params the screen renders exactly what it renders today.

DrawScreen is where the ceremony's first frame is decided: B04's `prewarmCeremonyAudio()` loads every sample into a player once (`B00 §2.6`) and B08's `prewarmFoilShader()` compiles the SkSL once (`B00 §2.11`); both must run on Draw mount so the first LEG flip stalls < 50 ms (design §3.8 DoD) — `release-1.6.0-plan:169` row `src/screens/DrawScreen.tsx` (`:166` is the `CeremonyLottie.tsx` row). That row also forwards `poolExhausted`, `pityThreshold`, `pityCardIndex` into the `DrawCeremony` params; `commitDraw` returns `poolExhausted` and `pityFiredFor` (`mobile/src/features/gacha/draw/drawCommit.ts:19-28`) but neither the threshold nor the slot the guarantee paid out on, so both are derived here from the same rule `poolSelection.ts:106-152` applies.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` §0, §1 (B10 row), §2.6 (`prewarmCeremonyAudio`), §2.11 (`prewarmFoilShader`), §2.13 (this issue's copy contract, verbatim), §2.14 (params), §3.6 (`goResult` payload), §4.2 step 9, §4.3 (DrawResult testIDs), §4.4, §6 (the `packArt.ts` exports B12 provides: `cardFrameForRarity`, `GLOW_9SLICE`, `GLOW_9SLICE_INSET`), §9 #2.
2. `mobile/src/features/gacha/draw/ceremonyCopy.ts:5-62` (`CEREMONY_COPY`, scanned by `tests/unit/ceremony-copy.test.ts:11-17` — untouched), `:64-94` (`CEREMONY_COPY_V9`), `:96-118` (single-pull tear copy, `getCeremonyPhaseCopy`).
3. `mobile/src/navigation/types.ts:81-101` (`DrawCeremony`), `:102-126` (`DrawResult`, `ceremonyEcho` at `:120-123`).
4. `mobile/src/screens/DrawCeremonyScreen.tsx:451-459` (reads `rareTitles`), `:470-489` (`goResult` — pre-B09 it passes `ceremonyEcho` **without** `tableReached`; this is why `tableReached` must be optional in this issue).
5. `mobile/src/screens/DrawResultScreen.tsx:27-38` (the `readAnimated` guard — vitest's RN mock throws on missing exports), `:40-45`, `:82-113`, `:293-302` (accent/halo), `:367-436` (featured card), `:465-509` (mini strip), `:526-578` (grid sheet).
6. `mobile/src/screens/HomeScreen.tsx:47-55` (`readRN(key, fallback)` + `RNImage` facade — copy this shape).
7. `mobile/src/screens/DrawScreen.tsx:1-41` (imports, `readRN`, `RNImage`), `:46-55` (`DrawReady`), `:103-130` (`loadDrawStatus`), `:344-354` (mount effect to add after), `:415`, `:443-452` (`setReady`), `:485-577` (`open`), `:552-565` (the `DrawCeremony` navigate).
8. `mobile/src/features/gacha/draw/drawCommit.ts:19-28`, `mobile/src/features/gacha/draw/poolSelection.ts:106-152` (guarantee checked before every slot; COM advances the counter capped at threshold, anything else resets it), `mobile/src/features/gacha/draw/pity.ts:29-32,104-112`.
9. `mobile/tests/integration/draw-result.screen.test.tsx:10-27` (RN mock: `View, Text, ScrollView, Modal, Pressable, ActivityIndicator, useWindowDimensions, StyleSheet` — **no `Image`**), `:52-73` (fixtures), `:82-90` (`collectText`), `:92-100`.
10. `mobile/tests/integration/draw.screen.test.tsx:49-63` (RN mock without `Image`/`Platform`), `:238-246` (`navigate` asserted with `objectContaining` — extra params are safe).
11. `mobile/tests/integration/draw-ceremony.screen.test.tsx:152,166,197,204,243,258,288,378,384,667` (the ten literals).
12. The two other tests that import your screens and run in the driver's full-suite gate, each with its own `react-native` mock: `mobile/tests/integration/draw-wallet-atomicity.spec.tsx:68-82` (imports `DrawScreen` at `:126`; mock exports `View, Text, ActivityIndicator, Pressable, StyleSheet` only) and `mobile/tests/integration/pity-visibility.test.tsx:17-34` (imports both screens at `:99-100`; mock exports `ActivityIndicator, View, Text, ScrollView, Modal, Pressable, useWindowDimensions, StyleSheet`; `loadDrawState` is mocked at `:93-97` to return `drawStateFixture`, whose `pity` is typed `{ draws, threshold } | null` at `:10-13` — `normalizePityState(null)` returns the default at `pity.ts:106-107`, so Change 4c is safe there).

## Constraints

- **Scope (the ONLY files that may change):**
  - `mobile/src/features/gacha/draw/ceremonyCopy.ts`
  - `mobile/src/navigation/types.ts`
  - `mobile/src/screens/DrawResultScreen.tsx`
  - `mobile/src/screens/DrawScreen.tsx`
  - `mobile/tests/integration/draw-result.screen.test.tsx` (add cases only)
  - `mobile/tests/integration/draw-ceremony.screen.test.tsx` — **added to the spec's scope for one reason**: the ten literal substitutions of B00 §4.2 step 9, in place, nothing else (see Changes 6). The driver's full-suite gate would otherwise fail on this issue's own copy change.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also do NOT touch `mobile/src/theme/packArt.ts` (B12 owns it; you only import from it), `mobile/src/features/gacha/components/drawResultStyles.ts` (out of scope — new styles go in a local `StyleSheet.create` in `DrawResultScreen.tsx`), `mobile/src/screens/DrawCeremonyScreen.tsx` (B09), `tests/unit/ceremony-copy.test.ts`.
- **No dependency changes** (`package.json`/`package-lock.json` untouched; `"vite": "7.2.4"` stays). No `@sentry`.
- **Imports you rely on exist because of your deps:** `prewarmCeremonyAudio` (`mobile/src/components/ceremonyAudio.ts`, B04), `prewarmFoilShader` (`mobile/src/components/ceremony/FoilLayer.tsx`, B08), `cardFrameForRarity`, `GLOW_9SLICE`, `GLOW_9SLICE_INSET` (`mobile/src/theme/packArt.ts`, B12). Use those exact names; do not re-declare them.
- **`Image` is never imported by name from `react-native` in either screen.** Four tests mock `react-native` without `Image` and import one or both screens — `draw-result.screen.test.tsx:10-27`, `draw.screen.test.tsx:49-63`, `draw-wallet-atomicity.spec.tsx:68-82`, `pity-visibility.test.tsx:17-34` — and vitest's mock proxy throws on a missing export. Read it through the `readRN('Image', null)` facade (`HomeScreen.tsx:47-55`) and render frame/glow images only when the facade is non-null. Same rule for anything else: **every named `react-native` import in `DrawScreen.tsx` / `DrawResultScreen.tsx` must exist in all four mocks' export lists** (the intersection today: `View, Text, ActivityIndicator, Pressable, StyleSheet` for DrawScreen; add `ScrollView, Modal, useWindowDimensions` for DrawResultScreen). The verify runs all four.
- **`revealedUids` and `ceremonyEcho.tableReached` are optional.** `types.ts` declares them `?:`; `DrawResultScreen` treats "param absent" as "no reveal information" (no chips at all), never as "nothing revealed". B09 always passes both.
- **Every existing DrawResult testID stays on the same node:** `screen-draw-result-root`, `screen-draw-result-primary-cta`, `draw-result-header`, `draw-result-guarantee-badge`, `draw-result-collection-bar`, `screen-draw-result-featured-card`, `draw-result-summary-strip`, `draw-result-open-all-cards`, `draw-result-all-cards-sheet` (with `snapPoints: ['92%']`), `screen-draw-result-grid-card-${index}`, `draw-result-earn-pulls-link`, `draw-result-done-link`, `draw-result-confetti`, `screen-draw-result-detail-close`. New: `draw-result-unrevealed-chip-${index}` (mini strip), `draw-result-featured-unrevealed-chip`, `draw-result-featured-frame`, `draw-result-featured-glow`.
- **No motion changes in DrawResult** (`release-1.6.0-plan:173`): the `registerOpacityRef`/`featuredEntryRef` animations (`:116-140`) and every `A.*` call stay as they are.
- **Existing test literals allowed to change:** in `draw-result.screen.test.tsx` none — you may only ADD `it(...)` cases (B00 §4.4). In `draw-ceremony.screen.test.tsx` exactly the ten substitutions listed in Changes 6; the file must still be 787 lines and the diff against base must contain no other line.
- **Banned literals in any new code/comment:** `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. No `@ts-ignore`, `eslint-disable`, `.skip(`, `.only(`.
- **`ceremonyCopy.ts` literal hygiene (comments included):** the verify counts `'Pack inbound'` (exactly 4) and `title: 'Pack open'` (exactly 2) and rejects any `Rare inbound` / `Legendary inbound` / `Card revealed` / `featured card is visible` in the file after stripping `//` comments — so do not put an extra `'Pack inbound'` or a `title: 'Pack open'` in a `/* … */` block or a string, and keep the old literals out of the file entirely (a `//` comment such as `// was 'Rare inbound' — rarity withheld, design §3.2` is tolerated by the verify but adds nothing; prefer citing the design section).

## Changes required

1. **`mobile/src/features/gacha/draw/ceremonyCopy.ts` — withhold the rarity, name the open, add V10.** `CEREMONY_COPY` (`:5-62`) is untouched.
   a. `:72-76` — the three `rareTitles` values become `'Pack inbound'` (`COM`, `RAR`, `LEG` alike); `approach.title`/`body` (`:70-71`) unchanged.
   b. `:86-89` — `'flash-reveal'` becomes exactly:
      ```ts
      'flash-reveal': {
        title: 'Pack open',
        body: 'Your cards are sliding out.',
      },
      ```
   c. Add, next to `CEREMONY_TEAR_FLIP_SINGLE` (`:96-99`, unchanged — `'Your card is spinning into place.'` is asserted by `draw-ceremony.screen.test.tsx:455`; B00 §2.13 cites it as `:452`, the line is 455 on this tree):
      ```ts
      const CEREMONY_FLASH_REVEAL_SINGLE = {
        title: 'Pack open',
        body: 'Your card is sliding out.',
      } as const;
      ```
      and in `getCeremonyPhaseCopy` (`:110-118`) add, before the `'cards-on-table'` branch:
      ```ts
      if (phase === 'flash-reveal') {
        return isMulti ? CEREMONY_COPY_V9['flash-reveal'] : CEREMONY_FLASH_REVEAL_SINGLE;
      }
      ```
   d. Append the new export verbatim (B00 §2.13):
      ```ts
      export const CEREMONY_COPY_V10 = {
        packA11yLabel: 'Reward pack',
        packA11yHint: 'Swipe right or double-tap to open',
        activateAction: 'Open pack',
        leaveCeremony: 'Leave ceremony',
        speedUp: 'Speed up',
        showResult: 'Show result',
        continueCta: 'Continue',
        skipProgress: (revealed: number, total: number) => `Skip · ${revealed}/${total}`,
        cardFaceDown: (n: number, total: number) => `Card ${n} of ${total}, face down`,
        cardRevealed: (n: number, total: number, rarity: string) => `Card ${n} of ${total}, ${rarity} revealed`,
        dealing: (percent: number) => `Dealing cards, ${percent} percent`,
        unrevealedChip: 'Not flipped',
        shareCta: 'Share this pull',
      } as const;
      ```
      Do not add these strings to `CEREMONY_COPY` (its jargon scan rejects `·`).

2. **`mobile/src/navigation/types.ts` — params.** Keep every existing member; only add:
   ```ts
   DrawCeremony: {
     …existing (:82-100)…
     /** Test hook (design §3.3): forces tap-to-flip on/off; undefined → motionAvailable && cards.length > 0. */
     tapFlow?: boolean;
     pityThreshold?: number;
     /** Slot whose card the guarantee paid out on, null when it did not fire this pull. */
     pityCardIndex?: number | null;
     poolExhausted?: boolean;
   };
   DrawResult: {
     …existing (:103-119, :124-125)…
     /** stableUids the player flipped on the table; absent = no reveal information (pre-table exits). */
     revealedUids?: string[];
     ceremonyEcho?: {
       rarity: 'COM' | 'RAR' | 'LEG';
       phaseCue: string;
       tableReached?: boolean;
     } | null;
   };
   ```
   `tableReached` is optional (B00 §2.14 now spells it `tableReached?: boolean` for the same reason) because `DrawCeremonyScreen.tsx:477-480` on this issue's base does not pass it and that file is B09's; B09 passes it on every `goResult`.

3. **`mobile/src/screens/DrawResultScreen.tsx` — reveal chips + CardFace.**
   a. Replace `readAnimated()` (`:27-38`) with the `readRN` facade from `HomeScreen.tsx:47-54` and keep the derived constants unchanged in meaning:
      ```ts
      function readRN<T = any>(key: string, fallback: T): T { try { const value = (RN as any)[key]; return (value ?? fallback) as T; } catch { return fallback; } }
      const A: any = readRN('Animated', {});
      const RNImage: any = readRN('Image', null);
      const AnimatedView: any = A.View ?? View;
      const hasAnimated = typeof A.Value === 'function';
      ```
      Add `StyleSheet` to the `react-native` named import (`:2-9`; both test mocks export it) and imports `import { CEREMONY_COPY_V10 } from '../features/gacha/draw/ceremonyCopy';` and `cardFrameForRarity, GLOW_9SLICE, GLOW_9SLICE_INSET` from `'../theme/packArt'` (extend `:19-24`).
   b. After `const cards = drawResult?.cards ?? [];` (`:91`):
      ```ts
      // Absent = the ceremony left before the table (or an old caller): no reveal
      // information, so no chips. An empty array means "table reached, nothing flipped".
      const revealedUids = params.revealedUids;
      const hasRevealInfo = Array.isArray(revealedUids);
      const revealedSet = useMemo(() => new Set(revealedUids ?? []), [revealedUids]);
      const isUnrevealed = (uid: string) => hasRevealInfo && !revealedSet.has(uid);
      ```
   c. Local styles (module level, after `FEATURED_GRADIENT_BY_RARITY`):
      ```ts
      const localStyles = StyleSheet.create({
        featuredFrame: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
        unrevealedChip: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(58,35,5,0.10)' },
        unrevealedChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: colors.inkMuted },
        featuredUnrevealedChip: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.85)' },
      });
      ```
      (`colors.inkMuted` exists — `colors.ts`; if a token you pick is missing, use a literal, never edit `colors.ts`.)
   d. Featured card (`:367-436`):
      - Halo (`:376-379`): when `RNImage` is non-null render
        `<RNImage testID="draw-result-featured-glow" pointerEvents="none" source={GLOW_9SLICE} resizeMode="stretch" capInsets={{ top: GLOW_9SLICE_INSET, left: GLOW_9SLICE_INSET, bottom: GLOW_9SLICE_INSET, right: GLOW_9SLICE_INSET }} style={[styles.featuredHalo, { tintColor: featuredHalo }]} />`
        else the existing `<View pointerEvents="none" style={[styles.featuredHalo, { backgroundColor: featuredHalo }]} />`.
      - Frame: as the LAST child of the `LinearGradient` (`:387-433`, after `featuredShine`), when `RNImage` is non-null:
        `<RNImage testID="draw-result-featured-frame" pointerEvents="none" source={cardFrameForRarity(featured.rarity)} resizeMode="stretch" style={localStyles.featuredFrame} />`.
        The frame PNG is 400×560 with a transparent art window and transparent lower slab (B00 §6, B12), the featured card is 260 wide at 5:7 (`drawResultStyles.ts:130-141`), so `stretch` is exact.
      - Top bar (`:394-400`): after the rarity chip, when `cards.length === 1 && isUnrevealed(featured.stableUid)` render
        `<View testID="draw-result-featured-unrevealed-chip" style={localStyles.featuredUnrevealedChip}><Text style={localStyles.unrevealedChipText} numberOfLines={1}>{CEREMONY_COPY_V10.unrevealedChip}</Text></View>`.
        (Multi pulls carry the chip on the strip instead — never both, so `findByProps` stays unambiguous.)
   e. Mini strip (`:476-508`): inside each mini `Pressable`, after the `miniCardChip` View (`:501-505`), when `isUnrevealed(card.stableUid)`:
      `<View testID={`draw-result-unrevealed-chip-${index}`} style={localStyles.unrevealedChip}><Text style={localStyles.unrevealedChipText} numberOfLines={1}>{CEREMONY_COPY_V10.unrevealedChip}</Text></View>`.
      The grid sheet (`:526-578`) is unchanged (no duplicate testIDs).
   f. `ceremonyEcho.tableReached` is not rendered by this issue; do not add copy for it.

4. **`mobile/src/screens/DrawScreen.tsx` — preheat + params.**
   a. Imports (after `:27`):
      ```ts
      import { prewarmCeremonyAudio } from '../components/ceremonyAudio';
      import { prewarmFoilShader } from '../components/ceremony/FoilLayer';
      ```
   b. Mount effect, placed right after the bob/shine effect (`:344-354`):
      ```ts
      // Design §3.8: the first LEG flip must stall < 50 ms, so the samples and
      // the foil SkSL are warmed while the player is still choosing a pack.
      // Both are no-ops when their native module is absent and never throw.
      useEffect(() => {
        try { prewarmCeremonyAudio(); } catch { /* audio stays cold; the ceremony plays silent */ }
        try { prewarmFoilShader(); } catch { /* shader compiles lazily on the first foil frame */ }
      }, []);
      ```
      If — and only if — `tests/integration/draw.screen.test.tsx` fails at import time because a module in `FoilLayer`'s graph touches an export missing from that test's `react-native` mock (`:49-63` — vitest's mock proxy throws on a named import the factory did not return), replace the `FoilLayer` static import with a guarded require inside the effect, in exactly this shape so the verify greps still hold (`prewarmFoilShader()` and `components/ceremony/FoilLayer` must both appear as literals):
      ```ts
      try {
        const foil = require('../components/ceremony/FoilLayer') as { prewarmFoilShader?: () => void };
        if (typeof foil.prewarmFoilShader === 'function') foil.prewarmFoilShader();
      } catch { /* shader compiles lazily on the first foil frame */ }
      ```
      (not `foil.prewarmFoilShader?.()` — that spelling does not contain the literal `prewarmFoilShader()` the verify greps). The audio import stays static either way (`ceremonyAudio.ts` has no `react-native` import after B04). Report which form you shipped.
   c. `DrawReady` (`:46-55`) gains `pityThreshold: number;`. `loadDrawStatus` (`:103-130`) returns `{ pityLabel, collectionComplete, pityThreshold }` where `pityThreshold = normalizePityState(state.pity).threshold` (and `DEFAULT_PITY_STATE.threshold`-equivalent `10` in the catch branch — import `DEFAULT_PITY_STATE` from `'../features/gacha/draw/pity'` rather than writing 10). `setReady` (`:443-452`) passes `pityThreshold: status.pityThreshold`.
   d. Pure helper above `DrawScreen`, not exported:
      ```ts
      // Mirrors poolSelection.ts:106-152 — the guarantee is checked before every
      // slot, a COM advances the counter (capped at threshold), anything else
      // resets it — so the ceremony can seal the exact card it paid out on.
      function pityCardIndexFor(
        cards: ReadonlyArray<{ rarity: 'COM' | 'RAR' | 'LEG' }>,
        pityBefore: number,
        threshold: number,
        pityFiredFor: 'LEG' | 'RAR' | null,
      ): number | null {
        if (pityFiredFor === null || threshold <= 0) return null;
        let draws = pityBefore;
        for (let index = 0; index < cards.length; index += 1) {
          if (draws >= threshold && cards[index].rarity !== 'COM') return index;
          draws = cards[index].rarity === 'COM' ? Math.min(draws + 1, threshold) : 0;
        }
        return null;
      }
      ```
   e. The `DrawCeremony` navigate (`:552-565`) gains three params after `totalCards` (`:564`):
      ```ts
      poolExhausted: result.poolExhausted,
      pityThreshold: ready.pityThreshold,
      pityCardIndex: pityCardIndexFor(result.cards, result.pityBefore, ready.pityThreshold, result.pityFiredFor),
      ```
      Nothing else in `open()` changes (the draw-first/charge-second ordering and refund path stay byte-identical).

5. **`mobile/tests/integration/draw-result.screen.test.tsx` — append four cases** inside `describe('DrawResultScreen v9')`, titles verbatim (the verify script greps them). Use `makeParams({ revealedUids: [...] })`; `collectText` is at `:82-90`.
   1. `it('marks cards missing from revealedUids with a Not flipped chip', ...)` — `revealedUids: ['1']` (fixture cards `'1'`,`'2'`): `draw-result-unrevealed-chip-1` exists, `findAllByProps({ testID: 'draw-result-unrevealed-chip-0' })` has length 0, `collectText(tree)` contains `'Not flipped'`, and every testID of the first existing case (`:111-116`) is still present.
   2. `it('shows no unrevealed chips when revealedUids is absent', ...)` — default `makeParams()`: no `draw-result-unrevealed-chip-0`/`-1`, no `draw-result-featured-unrevealed-chip`, text does not contain `'Not flipped'`.
   3. `it('shows no unrevealed chips when every card was flipped', ...)` — `revealedUids: ['1', '2']`: same three absences.
   4. `it('marks a single unflipped pull on the featured card', ...)` — `drawResult: { ...DRAW_RESULT_FIXTURE, cards: [DRAW_RESULT_FIXTURE.cards[0]] }`, `revealedUids: []`: `draw-result-featured-unrevealed-chip` exists and `screen-draw-result-featured-card` still exists; re-render with `revealedUids: ['1']` (a second `renderer.create`) → the chip is absent.
   A dry run of these four against the finished screen passes; each fails on the base tree (the testIDs and the literal do not exist).

6. **`mobile/tests/integration/draw-ceremony.screen.test.tsx` — ten literals, nothing else.** Apply exactly `s/'Legendary inbound'/'Pack inbound'/g`, `s/'Rare inbound'/'Pack inbound'/g`, `s/'Card revealed'/'Pack open'/g` (lines `152, 166, 667` / `243, 258` / `197, 204, 288, 378, 384`). Do not touch any other character: no Lottie case deletion, no scaffold removal, no new cases — those are B09's, and B09's verify derives its expected prefix from this file with line-number-based deletions that only hold if the line count stays 787.

## Acceptance

Run from `mobile/`. `docs/delivery/r16-issues/B10.verify.sh` re-runs these verbatim from the worktree root.

1. Copy guards (exit 0, counts and the absence grep taken over the file with `//` comments stripped): `f=src/features/gacha/draw/ceremonyCopy.ts; grep -q "export const CEREMONY_COPY_V10" "$f" && grep -q "CEREMONY_FLASH_REVEAL_SINGLE" "$f" && [ "$(sed -E 's#//.*$##' "$f" | grep -c "title: 'Pack open'")" = 2 ] && [ "$(sed -E 's#//.*$##' "$f" | grep -c "'Pack inbound'")" = 4 ] && grep -q "body: 'Your cards are sliding out.'" "$f" && grep -q "body: 'Your card is sliding out.'" "$f" && grep -q "body: 'Your card is spinning into place.'" "$f" && grep -q "unrevealedChip: 'Not flipped'" "$f" && grep -q "shareCta: 'Share this pull'" "$f" && ! sed -E 's#//.*$##' "$f" | grep -Eq "Rare inbound|Legendary inbound|Card revealed|featured card is visible"`
2. Param guards (exit 0): `t=src/navigation/types.ts; grep -q "tapFlow?: boolean" "$t" && grep -q "pityThreshold?: number" "$t" && grep -q "pityCardIndex?: number | null" "$t" && grep -q "poolExhausted?: boolean" "$t" && grep -q "revealedUids?: string\[\]" "$t" && grep -Eq "tableReached\??: boolean" "$t"`
3. DrawResult guards (exit 0): `r=src/screens/DrawResultScreen.tsx; grep -q "readRN('Image'" "$r" && grep -q "revealedUids" "$r" && grep -q 'draw-result-unrevealed-chip-' "$r" && grep -q 'draw-result-featured-unrevealed-chip' "$r" && grep -q 'draw-result-featured-frame' "$r" && grep -q 'draw-result-featured-glow' "$r" && grep -q "cardFrameForRarity(" "$r" && grep -q "GLOW_9SLICE" "$r" && grep -q "CEREMONY_COPY_V10.unrevealedChip" "$r" && ! grep -Eq "import \{[^}]*\bImage\b[^}]*\} from 'react-native'" "$r" && ! grep -q "CeremonyLottie" "$r"` plus every testID in the Constraints list present.
4. DrawScreen guards (exit 0): `d=src/screens/DrawScreen.tsx; grep -q "prewarmCeremonyAudio()" "$d" && grep -q "prewarmFoilShader()" "$d" && grep -q "poolExhausted: result.poolExhausted" "$d" && grep -q "pityThreshold: ready.pityThreshold" "$d" && grep -q "pityCardIndex: pityCardIndexFor(" "$d" && grep -q "function pityCardIndexFor(" "$d"`
5. Ceremony-test literal rule: `git show delivery/r16-b-ceremony:mobile/tests/integration/draw-ceremony.screen.test.tsx | sed -e "s/'Legendary inbound'/'Pack inbound'/g" -e "s/'Rare inbound'/'Pack inbound'/g" -e "s/'Card revealed'/'Pack open'/g" | cmp - tests/integration/draw-ceremony.screen.test.tsx` exits 0 and the file has 787 lines.
6. `npx vitest run tests/integration/draw-result.screen.test.tsx tests/integration/draw-ceremony.screen.test.tsx tests/integration/draw.screen.test.tsx tests/integration/draw-wallet-atomicity.spec.tsx tests/integration/pity-visibility.test.tsx tests/unit/ceremony-copy.test.ts tests/unit/packArt.test.ts --reporter=dot` — 7 files pass (the two extra integration files import your screens through their own `react-native` mocks); `draw-result.screen.test.tsx` has ≥ 18 tests (14 + 4) and the four new titles exist.
7. `npm run test:typecheck` — exit 0.
8. Scope + frozen guard: only the six scope paths (plus `docs/delivery/r16-issues/*`) differ from the merge-base; frozen files, `packArt.ts`, `drawResultStyles.ts`, `DrawCeremonyScreen.tsx`, `package.json` unchanged.

## Do NOT

- Do NOT edit `CEREMONY_COPY` (`:5-62`) or `tests/unit/ceremony-copy.test.ts`; do NOT change `CEREMONY_TEAR_FLIP_SINGLE`, `CEREMONY_CARDS_ON_TABLE`, `swipe`/`hold`/`tear-flip`/`settle` copy.
- Do NOT touch `DrawCeremonyScreen.tsx` (B09 rewrites it), `packArt.ts` (B12), `drawResultStyles.ts`, `colors.ts`, `App.tsx`, `ceremonyAudio.ts`, `FoilLayer.tsx`.
- Do NOT import `Image`, `Platform`, `Animated` or `AccessibilityInfo` by name from `react-native` in `DrawResultScreen.tsx` or `DrawScreen.tsx`; go through `readRN`.
- Do NOT make `revealedUids` or `tableReached` required; do NOT treat a missing `revealedUids` as "nothing flipped".
- Do NOT add chips to the grid sheet (`screen-draw-result-grid-card-*`) — duplicate testIDs break `findByProps`.
- Do NOT change any existing `it(...)` in `draw-result.screen.test.tsx`; do NOT change anything but the ten literals in `draw-ceremony.screen.test.tsx` (no case deletions — B09 owns those).
- Do NOT add a `prewarm` call anywhere but the one mount effect; do NOT call them from `open()`.
- Standing rules: no `git push`, no PR, never touch `main`, no `npm install`/`npm ci`/EAS/expo commands, no `.skip`/`.only`/`@ts-ignore`/`eslint-disable`, no tsconfig loosening.
