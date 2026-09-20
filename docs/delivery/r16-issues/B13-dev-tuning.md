# B13 — Dev tools: CeremonyTuning screen + DebugMenu ceremony seeds (`dev-tuning`)

`__DEV__`-only tuning screen for the DEVICE timing table (stepper rows writing `setCeremonyTimingOverride`, cap readout, JS-thread frame-gap probe) plus four DebugMenu seeds (wallet 30/5, only Legendary left, force fallback renderer, force repeat ceremony) and the route/`Stack.Screen` that makes the screen reachable.

## Context

The Seam of Light ceremony (B02–B12) ships a DEVICE timing table that nobody can adjust on a phone without an OTA: `resolveCeremonyTimings` merges an in-memory override only in `__DEV__` (`B00-contracts.md` §2.2, `setCeremonyTimingOverride` / `getCeremonyTimingOverride`), and the design reserves a dev screen for it — "Sliders for the DEVICE timing table + frame-gap probe readout; DebugMenu gains 'force repeat ceremony', 'seed wallet 30/5', 'only Legendary left', 'force fallback renderer' (feeds R9 screenshots and the fallback DoD check)" (`docs/release-1.6.0-plan-2026-09-19.md:174`; asset row `:148` names `src/screens/dev/CeremonyTuning.tsx` behind `__DEV__` with "probe = requestAnimationFrame delta", and row `:147` says the ray/halo stops are "tune[d] … on device via the tuning screen"). The rubric's frame gate (rubric F: p95 frame gap < 22 ms, no frame > 50 ms, `release-1.6.0-plan:133`) has no on-device readout today; the DoD wants the probe numbers in the evidence table (`:186`, "Frame-gap probe p95 < 22 ms and no frame > 50 ms during tear/spill in all 6 recordings × 3 widths") and the fallback renderer driven through "DebugMenu 'force fallback'" (`:184`).

Today `mobile/src/screens/DebugMenuScreen.tsx` (171 lines) renders `AppInfoScreen` with a single footer "DANGER ZONE" (`:80-112`) whose only action is `resetAllProgress` (`:23-41`, `:90-105`), and the `More → Settings → DebugMenu` route is itself `__DEV__`-gated (`mobile/src/screens/SettingsScreen.tsx:354`). `mobile/src/navigation/types.ts:75` has `DebugMenu: undefined` and no `CeremonyTuning` route; `mobile/App.tsx:225` registers `<Stack.Screen name="DebugMenu" component={DebugMenuScreen} />`. Three existing integration tests render `DebugMenuScreen` with a plain `react-native` mock that exports only `View/Text/ScrollView/Pressable/StyleSheet` (`mobile/tests/integration/phase-c-shells.screen.test.tsx:5-14`, `:115`; `phase-c-complete.screen.test.tsx:118`; `system-support-polish.screen.test.tsx:126-135`) and press only `Open error shell` — they must stay green untouched, which drives the lazy-import rule in Constraints.

This issue lands after B09 (deps), so `ceremonyTimings.ts` (B02), `ceremonyPrefs.ts` (B03) and `reanimatedGuard.ts` (B02) exist on the branch you start from. B15 is serialised after this issue because both touch `App.tsx` (`B00-contracts.md` §5 row B15, §9 #10).

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` §2.2 (`ceremonyTimings.ts`: `CeremonyTimingTable`, `DEVICE`, `TO_TABLE_CAP_MS`, `resolveCeremonyTimings`, `setCeremonyTimingOverride`, `getCeremonyTimingOverride`), §2.5 (`ceremonyPrefs.ts`: `getCeremonyDevOverrides`, `setCeremonyDevOverride`), §2.14 (route line), §2.16 (this issue's contract — testIDs and DebugMenu button IDs are verbatim), §3.4–3.5 (what `forceFallback` does), §8 (verify conventions).
2. `mobile/src/features/gacha/draw/ceremonyTimings.ts` (B02's file as merged — confirm the export names above and that `resolveCeremonyTimings({ motionAvailable: true })` returns DEVICE merged with the override).
3. `mobile/src/features/gacha/draw/ceremonyPrefs.ts` (B03's file as merged — `CeremonyDevOverrides = { forceRepeat; forceFallback }`, in-memory, `__DEV__`-only).
4. `mobile/src/components/ceremony/reanimatedGuard.ts` (B02 — `motionAvailable`, `skiaAvailable`; informational readout only; the new test mocks this module, see Changes 6).
5. `mobile/src/screens/DebugMenuScreen.tsx:1-8` (imports, `Props`), `:19-41` (`busy`/`lastResult` state + `performReset` pattern to copy), `:63-114` (`AppInfoScreen` usage; the `footer` prop at `:80-112` is where the new block goes), `:119-171` (styles to reuse: `dangerButton`, `dangerButtonText`, `dangerResult`).
6. `mobile/src/components/AppInfoScreen.tsx:20-35` (`footer?: React.ReactNode`, rendered at `:109`).
7. `mobile/src/navigation/types.ts:75` (`DebugMenu: undefined` — add the new route next to it), `mobile/App.tsx:65` (DebugMenu import), `:225` (DebugMenu `Stack.Screen`), `:103` (`Stack` is `createNativeStackNavigator<RootStackParamList>()`, so an unregistered route name does not compile).
8. `mobile/src/features/gacha/rewards/rewardWallet.ts:117-119` (`saveRewardWalletState(state)`), `mobile/src/features/gacha/constants.ts:9-10` (`FREE_PULL_CAP = 30`, `FREE_PULL_OVERFLOW_CAP = 5` — 30/5 is exactly "wallet full with reserve").
9. `mobile/src/features/gacha/draw/drawStateStore.ts:67-73` (`DrawStateRecord = { owned: string[]; pity: PityState | null }`), `:227` (`loadDrawState(slug)`), `:300-310` (`saveDrawState(slug, record)` writes then primes the cache — always go through it, never `AsyncStorage.setItem`).
10. `mobile/src/features/gacha/draw/cardRarity.ts:5-13` (`rarityOfCard(card)`: `Difficulty >= 3` → `'LEG'`), `mobile/src/types/deckExport.ts:15-25` (`CardExport.StableUid`, `.Difficulty`).
11. `mobile/src/content/activeDeck.ts:10-19` (`loadActiveDeckSlug()`), `mobile/src/content/deckRepository.ts:582` (`resolveDeckBySlug(slug): Promise<DeckContent | null>`; `DeckContent = DeckExport` with `.Cards`, `:454`) — **frozen file, read only**.
12. Lazy-import precedent: `mobile/src/screens/CardDetailScreen.tsx:29-44` (`await import('../content/activeDeck')` at `:31` inside `:29-36`, `await import('../content/deckRepository')` at `:39` inside `:37-44`), `mobile/src/features/gacha/draw/drawCommit.ts:43`. Under vitest a dynamic `import()` IS intercepted by `vi.mock` (a bare `require()` is not — it goes to Node's own resolver; `B00-contracts.md` §9 #13), which is why the new test can mock `deckRepository` for the DebugMenu handler — and why the new test mocks `reanimatedGuard` itself (Changes 6) instead of trusting the setup file's package mocks to reach the guard's module-scope `require()`s.
13. `mobile/tests/setup/globals.ts:11` (`__DEV__ = true` under vitest), `mobile/tests/setup/ceremony.ts` (B02: `__CEREMONY_MOTION_AVAILABLE__ = false` + package mocks), `mobile/tests/integration/phase-c-shells.screen.test.tsx:1-38` (the `react-native` mock + `findPressableByText` helper to copy into the new test).
14. Format exemplar: `docs/delivery/r16-issues/A08-draw-state-adoption.md`.

## Constraints

- **Scope (the ONLY files that may change; new files marked C):**
  - C `mobile/src/screens/dev/CeremonyTuning.tsx`
  - E `mobile/src/screens/DebugMenuScreen.tsx`
  - E `mobile/src/navigation/types.ts` — exactly one added line, `CeremonyTuning: undefined;` (dev route only; do not touch `DrawCeremony`/`DrawResult` params — those are B10's)
  - E `mobile/App.tsx` — exactly one added import line and one added `{__DEV__ ? <Stack.Screen … /> : null}` line (allowed by `B00-contracts.md` §9 #10; the spec's scope had no `App.tsx` and without it the route is unreachable)
  - C `mobile/tests/unit/ceremonyTuning.test.tsx`
- **Frozen files (gacha-v7.md §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched here: `ceremonyTimings.ts`, `ceremonyPrefs.ts`, `reanimatedGuard.ts`, `DrawCeremonyScreen.tsx`, `SettingsScreen.tsx`, every existing test.
- **No new dependencies** (only B01 touches `package.json`). No slider package: "sliders" are stepper rows (`−` / `+` Pressables) — `@react-native-community/slider` is not installed and may not be added.
- **`__DEV__` is read at render time**, never captured into a module-level constant, so the test can flip `globalThis.__DEV__` per case (`tests/setup/globals.ts` sets it `true`). `CeremonyTuningScreen` with `__DEV__ === false` renders only `<Text testID="ceremony-tuning-unavailable">Not available in release builds</Text>`; the DebugMenu ceremony block is `__DEV__ ? … : null`.
- **Lazy-import rule for DebugMenu:** `deckRepository` and `activeDeck` are loaded with `await import(...)` inside the press handler (precedent `CardDetailScreen.tsx:30-38`), never at module scope — `deckRepository` pulls `expo-file-system/legacy`, `expo-crypto` and `aws-amplify/auth` into the graph, and the three existing DebugMenu tests do not mock it. `rewardWallet`, `drawStateStore`, `cardRarity`, `ceremonyPrefs` may be imported statically (AsyncStorage-only graphs; they load under node).
- **React Native surface of `CeremonyTuning.tsx`:** only `View`, `Text`, `Pressable`, `ScrollView`, `StyleSheet` from `react-native` plus `SafeAreaView` from `react-native-safe-area-context` — the new test mocks exactly those. No `Switch`, no `Slider`, no `Alert`, no `Animated`, no Reanimated/Skia components. `requestAnimationFrame` / `cancelAnimationFrame` are read from `globalThis` and guarded with `typeof … === 'function'` (absent under vitest unless the test stubs them).
- **DebugMenu handlers never call `Alert`** (the existing `react-native` mocks in the three DebugMenu tests do not export it): report through the existing `lastResult` Text (`DebugMenuScreen.tsx:106-110`).
- **Existing DebugMenu behaviour byte-for-byte:** `performReset`/`handleReset` (`:23-61`), the `AppInfoScreen` props (`:64-79`) and the DANGER ZONE block (`:81-111`) are unchanged; the new block is inserted ABOVE the danger zone inside the same `footer` (wrap both in a fragment).
- **Route / Stack.Screen:** `types.ts` gains `CeremonyTuning: undefined;` on the line after `DebugMenu: undefined;` (`:75`). `App.tsx` gains `import CeremonyTuningScreen from './src/screens/dev/CeremonyTuning';` directly after the `DebugMenuScreen` import (`:65`) and `{__DEV__ ? <Stack.Screen name="CeremonyTuning" component={CeremonyTuningScreen} /> : null}` directly after the DebugMenu `Stack.Screen` (`:225`). Locate both anchors by literal, not line number — B01 edits `App.tsx` before you (`B00-contracts.md` §2.17).
- **testIDs (verbatim, `B00-contracts.md` §2.16):** `ceremony-tuning-root`, `ceremony-tuning-unavailable`, `ceremony-tuning-probe`, `ceremony-tuning-slider-${key}`; DebugMenu `debug-seed-wallet`, `debug-only-legendary`, `debug-force-fallback`, `debug-force-repeat`, `debug-ceremony-tuning`. Additional IDs defined in Changes required (`-minus`/`-plus`/`-value`, `ceremony-tuning-cap-*`, `ceremony-tuning-probe-toggle`, `ceremony-tuning-reset`, `ceremony-tuning-motion`, `debug-ceremony-tools`) are also contract.
- **Banned literals in any new identifier/comment/string:** `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said` (driver gate). Say "skip", "guard", "probe", "fallback". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`. No `require(` in the new files (dynamic `import()` only).
- **Words that must not appear anywhere in `CeremonyTuning.tsx`, comments included** (verify.sh greps the whole file, case-sensitively): `Slider` (write "stepper row" — the lowercase testID segment `slider` is fine), `Alert`, `shadowRadius`, `require(`, `from 'react-native-reanimated'`, `@shopify/react-native-skia`. Do not write a comment such as "no Alert here" — it trips the guard.
- **Return-type annotations:** do not write `JSX.Element` — `@types/react` 19.1 has no global `JSX` namespace (`mobile/node_modules/@types/react/index.d.ts:4028` is `namespace JSX` *inside* `declare namespace React`; nothing under `mobile/src` uses a bare `JSX.Element`). B00 §2.16 writes `JSX.Element` as documentation; in code leave component return types inferred or write `React.JSX.Element`.

## Changes required

1. **`mobile/src/navigation/types.ts` — the dev route.** After `DebugMenu: undefined;` (`:75`) add `CeremonyTuning: undefined;`. Nothing else in the file.

2. **`mobile/App.tsx` — reachable in dev builds.** Two lines, both located by literal anchor:
   ```tsx
   import CeremonyTuningScreen from './src/screens/dev/CeremonyTuning';   // after the DebugMenuScreen import
   …
           <Stack.Screen name="DebugMenu" component={DebugMenuScreen} />
           {__DEV__ ? <Stack.Screen name="CeremonyTuning" component={CeremonyTuningScreen} /> : null}
   ```
   The import is unconditional (the module is tiny and self-gates on `__DEV__`); the `Stack.Screen` is conditional so a release build has no such route. Nothing else in `App.tsx` changes (B01's `RootErrorBoundary`/`GestureHandlerRootView`/worklet probe and B15's `linking` prop are theirs).

3. **`mobile/src/screens/dev/CeremonyTuning.tsx` (new) — exported surface.** Every name below is a contract (the test and verify.sh grep them).
   ```ts
   import type { NativeStackScreenProps } from '@react-navigation/native-stack';
   import type { RootStackParamList } from '../../navigation/types';
   import {
     DEVICE, TO_TABLE_CAP_MS, resolveCeremonyTimings,
     getCeremonyTimingOverride, setCeremonyTimingOverride,
     type CeremonyTimingTable, type PeakRarity,
   } from '../../features/gacha/draw/ceremonyTimings';
   import { motionAvailable, skiaAvailable } from '../../components/ceremony/reanimatedGuard';

   export type TuningKey =
     | `${'single' | 'multi'}.${'approach' | 'tearFlip' | 'flashReveal' | 'settleMs'}`
     | `${'single' | 'multi'}.hold.${PeakRarity}`
     | 'tableTailMs'
     | `${'beatMs' | 'flipMs' | 'rimSettleMs'}.${PeakRarity}`;
   /** 24 keys, in this exact order (row order on screen). */
   export const TUNING_KEYS: ReadonlyArray<TuningKey> = [
     'single.approach', 'single.hold.COM', 'single.hold.RAR', 'single.hold.LEG', 'single.tearFlip', 'single.flashReveal', 'single.settleMs',
     'multi.approach', 'multi.hold.COM', 'multi.hold.RAR', 'multi.hold.LEG', 'multi.tearFlip', 'multi.flashReveal', 'multi.settleMs',
     'tableTailMs',
     'beatMs.COM', 'beatMs.RAR', 'beatMs.LEG', 'flipMs.COM', 'flipMs.RAR', 'flipMs.LEG', 'rimSettleMs.COM', 'rimSettleMs.RAR', 'rimSettleMs.LEG',
   ];
   export const TUNING_STEP_MS = 20;
   export const TUNING_MIN_MS = 0;
   export const TUNING_MAX_MS = 4000;
   /** Rubric F (release-1.6.0-plan:133): p95 frame gap < 22 ms, no frame > 50 ms. */
   export const FRAME_GAP_P95_CAP_MS = 22;
   export const FRAME_GAP_MAX_CAP_MS = 50;
   /** Rolling window of gaps kept (≈ 10 s at 60 Hz) and how often the readout re-renders (every 30 frames ≈ 0.5 s). */
   export const PROBE_WINDOW = 600;
   export const PROBE_REPORT_EVERY = 30;

   /** Pure. Deep-copies `base` and lays `override` on top (top-level keys only — the override is Partial<CeremonyTimingTable>). null → copy of base. */
   export function mergeTimingOverride(base: CeremonyTimingTable, override: Partial<CeremonyTimingTable> | null): CeremonyTimingTable;
   /** Pure. e.g. 'single.hold.LEG' → table.single.hold.LEG; 'tableTailMs' → table.tableTailMs. */
   export function readTimingPath(table: CeremonyTimingTable, key: TuningKey): number;
   /** Pure. Returns a NEW table (never mutates), value clamped to [TUNING_MIN_MS, TUNING_MAX_MS] and rounded to an integer. */
   export function writeTimingPath(table: CeremonyTimingTable, key: TuningKey, valueMs: number): CeremonyTimingTable;
   /** Pure. Nearest-rank p95: sorted ascending, index = max(0, ceil(0.95 × n) − 1). Empty → { p95: 0, max: 0, count: 0 }. */
   export function summarizeFrameGaps(gapsMs: number[]): { p95: number; max: number; count: number };
   /** rAF-delta probe on the JS thread. Inactive or no requestAnimationFrame → { 0, 0, 0 }. */
   export function useFrameGapProbe(active: boolean): { p95: number; max: number; count: number };
   export function CeremonyTuningScreen(props: NativeStackScreenProps<RootStackParamList, 'CeremonyTuning'>);
   export default CeremonyTuningScreen;
   ```
   `useFrameGapProbe` behaviour: when `active` becomes true and `typeof globalThis.requestAnimationFrame === 'function'`, schedule a `tick(ts)` loop; the first tick only records `lastTs`; each later tick pushes `ts − lastTs` into a local array capped at `PROBE_WINDOW` (drop oldest), and every `PROBE_REPORT_EVERY` gaps calls `setState(summarizeFrameGaps(gaps))` (so the first readout needs `PROBE_REPORT_EVERY + 1` callbacks). Cleanup ALWAYS sets a `stopped` flag that `tick` checks first (returning without scheduling) AND calls `cancelAnimationFrame(handle)` when that is a function; it runs when `active` flips false or on unmount. When `active` is false the hook returns `{ p95: 0, max: 0, count: 0 }` and schedules nothing. The probe keeps running while this screen sits underneath `Draw`/`DrawCeremony` in the native stack (screens stay mounted), which is how a tester reads the ceremony's JS-thread cadence: toggle the probe on, press "Open Draw", run a pull, come back. Document in a comment that this measures JS-thread rAF gaps (the "first LEG flip stall" half of rubric F), not the UI-thread Reanimated/Skia cadence, which needs Instruments/gfxinfo.

4. **`CeremonyTuningScreen` render contract** (`__DEV__` true):
   - Root `<SafeAreaView testID="ceremony-tuning-root">` → `<ScrollView>`; title Text `Ceremony tuning`; a line `<Text testID="ceremony-tuning-motion">motion: available|unavailable · skia: available|unavailable · table: DEVICE|TEST_BASE</Text>` derived from `motionAvailable`/`skiaAvailable` (`table` = `motionAvailable ? 'DEVICE' : 'TEST_BASE'`; under vitest this reads `unavailable · … · TEST_BASE`).
   - State: `const [table, setTable] = useState(() => mergeTimingOverride(DEVICE, getCeremonyTimingOverride()))`. Every edit: `next = writeTimingPath(table, key, readTimingPath(table, key) ± TUNING_STEP_MS)`; `setCeremonyTimingOverride(next)`; `setTable(next)`. The whole table is written each time (it is a valid `Partial<CeremonyTimingTable>`), so a later `resolveCeremonyTimings` on device sees exactly what the screen shows.
   - **Cap readout** (before the rows): six Texts, `testID={`ceremony-tuning-cap-${isMulti ? 'multi' : 'single'}-${rarity}`}` for `single`/`multi` × `COM`/`RAR`/`LEG`, each `${toTableMs} / ${cap}` with the suffix ` OVER` when `toTableMs > cap`, where `toTableMs = resolveCeremonyTimings({ isMulti, peakRarity: rarity, motionAvailable: true }).toTableMs` (recomputed from the merged override every render — pass `motionAvailable: true` explicitly so the DEVICE path is previewed even under vitest) and `cap = TO_TABLE_CAP_MS[isMulti ? 'multi' : 'single']`. Untouched DEVICE: single LEG `3120 / 3300`, multi LEG `5000 / 5500` (`B00-contracts.md` §2.2).
   - **Rows**: `TUNING_KEYS.map(key => <View testID={`ceremony-tuning-slider-${key}`}>` with a label Text (the key), `<Text testID={`ceremony-tuning-slider-${key}-value`}>{readTimingPath(table, key)}</Text>`, `<Pressable testID={`ceremony-tuning-slider-${key}-minus`} accessibilityRole="button" accessibilityLabel={`Decrease ${key}`}>−</Pressable>` and `…-plus` / `Increase ${key}` / `+`.
   - `<Pressable testID="ceremony-tuning-reset" accessibilityRole="button">Reset overrides</Pressable>` → `setCeremonyTimingOverride(null); setTable(mergeTimingOverride(DEVICE, null))`.
   - **Probe**: `const [probing, setProbing] = useState(false); const probe = useFrameGapProbe(probing);` `<Pressable testID="ceremony-tuning-probe-toggle" accessibilityRole="button">{probing ? 'Stop probe' : 'Start probe'}</Pressable>` and `<Text testID="ceremony-tuning-probe">{`p95 ${probe.p95.toFixed(1)} ms · max ${probe.max.toFixed(1)} ms · n ${probe.count} · ${verdict}`}</Text>` where `verdict = probe.count === 0 ? 'IDLE' : probe.p95 < FRAME_GAP_P95_CAP_MS && probe.max <= FRAME_GAP_MAX_CAP_MS ? 'PASS' : 'FAIL'`.
   - `<Pressable testID="ceremony-tuning-open-draw" accessibilityRole="button" onPress={() => props.navigation.navigate('Draw')}>Open Draw</Pressable>` (`Draw` params are optional, `types.ts:171-174`).
   - Styles via `StyleSheet.create`; all text ≥ 11 pt; no `shadowRadius`.
   - `__DEV__` false: return `<Text testID="ceremony-tuning-unavailable">Not available in release builds</Text>` and nothing else (no hooks skipped conditionally — put the gate AFTER the hook calls, or hoist hooks into a child component; rules of hooks apply).

5. **`mobile/src/screens/DebugMenuScreen.tsx` — ceremony seeds.** Static imports added: `saveRewardWalletState` from `'../features/gacha/rewards/rewardWallet'`, `loadDrawState, saveDrawState` from `'../features/gacha/draw/drawStateStore'`, `rarityOfCard` from `'../features/gacha/draw/cardRarity'`, `getCeremonyDevOverrides, setCeremonyDevOverride` from `'../features/gacha/draw/ceremonyPrefs'`. State added: `const [devOverrides, setDevOverrides] = useState(() => getCeremonyDevOverrides());`. Handlers (each guarded by `if (busy) return; setBusy(true); try … catch (e: any) { setLastResult(`Seed failed: ${e?.message ?? String(e)}`) } finally { setBusy(false) }`, same shape as `performReset` `:23-41`):
   - `handleSeedWallet`: `await saveRewardWalletState({ availablePulls: 30, reservePulls: 5 }); setLastResult('Wallet seeded 30/5.');`
   - `handleOnlyLegendary`:
     ```ts
     const { loadActiveDeckSlug } = await import('../content/activeDeck');
     const { resolveDeckBySlug } = await import('../content/deckRepository');
     const slug = await loadActiveDeckSlug();
     if (!slug) { setLastResult('No active deck.'); return; }
     const deck = await resolveDeckBySlug(slug);
     const cards = deck?.Cards ?? [];
     if (cards.length === 0) { setLastResult(`Deck ${slug} is not installed.`); return; }
     const current = await loadDrawState(slug);
     const owned = new Set(current.owned);
     let added = 0;
     for (const card of cards) {
       if (rarityOfCard(card) !== 'LEG' && !owned.has(card.StableUid)) { owned.add(card.StableUid); added += 1; }
     }
     await saveDrawState(slug, { owned: [...owned], pity: current.pity });
     const legendaryLeft = cards.filter((card) => rarityOfCard(card) === 'LEG' && !owned.has(card.StableUid)).length;
     setLastResult(`Owned +${added} non-Legendary in ${slug}; ${legendaryLeft} Legendary left.`);
     ```
     (`pity` is carried over untouched; user order first, then deck order — the Set preserves insertion order.)
   - `handleToggle(key: 'forceFallback' | 'forceRepeat')`: `setCeremonyDevOverride(key, !devOverrides[key]); setDevOverrides(getCeremonyDevOverrides());` (synchronous, no `busy`).
   - Footer JSX: replace the `footer={<View style={styles.dangerZone}>…</View>}` value with a fragment whose FIRST child is the `__DEV__`-gated block and SECOND child is the unchanged danger-zone `View`:
     ```tsx
     {__DEV__ ? (
       <View style={styles.ceremonyTools} testID="debug-ceremony-tools">
         <Text style={styles.ceremonyEyebrow} numberOfLines={1}>CEREMONY</Text>
         <Pressable testID="debug-seed-wallet" accessibilityRole="button" accessibilityLabel="Seed wallet 30/5" disabled={busy} style={…} onPress={() => void handleSeedWallet()}><Text style={styles.ceremonyButtonText}>Seed wallet 30/5</Text></Pressable>
         <Pressable testID="debug-only-legendary" accessibilityRole="button" accessibilityLabel="Only Legendary left" disabled={busy} … onPress={() => void handleOnlyLegendary()}><Text …>Only Legendary left</Text></Pressable>
         <Pressable testID="debug-force-fallback" accessibilityRole="button" accessibilityState={{ checked: devOverrides.forceFallback }} … onPress={() => handleToggle('forceFallback')}><Text …>{`Force fallback renderer: ${devOverrides.forceFallback ? 'ON' : 'OFF'}`}</Text></Pressable>
         <Pressable testID="debug-force-repeat" accessibilityRole="button" accessibilityState={{ checked: devOverrides.forceRepeat }} … onPress={() => handleToggle('forceRepeat')}><Text …>{`Force repeat ceremony: ${devOverrides.forceRepeat ? 'ON' : 'OFF'}`}</Text></Pressable>
         <Pressable testID="debug-ceremony-tuning" accessibilityRole="button" accessibilityLabel="Open ceremony tuning" … onPress={() => navigation.navigate('CeremonyTuning')}><Text …>Ceremony tuning</Text></Pressable>
       </View>
     ) : null}
     ```
     New styles `ceremonyTools`, `ceremonyEyebrow`, `ceremonyButton`, `ceremonyButtonText` (reuse the danger-zone palette shape with a neutral colour; `shadowRadius` ≤ 8 if any). The `lastResult` Text (`:106-110`) already renders below and is the only feedback channel.

6. **`mobile/tests/unit/ceremonyTuning.test.tsx` (new).** Mocks (hoisted `vi.mock`, before imports): `react-native` → `{ View, Text, ScrollView, Pressable, StyleSheet: { create: (s) => s } }` exactly as `phase-c-shells.screen.test.tsx:5-14`; `react-native-safe-area-context` → `SafeAreaView`; `expo-linear-gradient` → `LinearGradient`; `'../../src/features/gacha/rewards/rewardWallet'` → `{ saveRewardWalletState: vi.fn(async () => {}) }`; `'../../src/features/gacha/draw/drawStateStore'` → `{ loadDrawState: vi.fn(async () => drawStateFixture), saveDrawState: vi.fn(async () => {}) }`; `'../../src/content/activeDeck'` → `{ loadActiveDeckSlug: vi.fn(async () => activeSlugFixture) }`; `'../../src/content/deckRepository'` → `{ resolveDeckBySlug: vi.fn(async () => deckFixture) }`; `'../../src/components/ceremony/reanimatedGuard'` → `{ motionAvailable: false, skiaAvailable: false }` (the readout only needs the two booleans; the real guard's module-scope guarded `require()`s of `react-native-reanimated` / `react-native-worklets` / `@shopify/react-native-skia` are NOT redirected by the setup file's `vi.mock`s — `B00-contracts.md` §9 #13 — and once B01 has installed the real packages, importing the real guard under Node 24 would execute their entry points and depend on them throwing synchronously; mocking the guard removes that dependency). Use the REAL `ceremonyTimings` and `ceremonyPrefs` (pure / in-memory). `beforeEach`: `(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; (globalThis as any).__DEV__ = true; setCeremonyTimingOverride(null); setCeremonyDevOverride('forceFallback', false); setCeremonyDevOverride('forceRepeat', false);` and `mockClear()` the fns. `afterEach`: `__DEV__ = true`, `vi.unstubAllGlobals()`. Cases, titles verbatim (verify.sh greps them):
   1. `it('summarizeFrameGaps uses nearest-rank p95 and reports max and count', …)` — `[]` → `{0,0,0}`; `[10]` → `{10,10,1}`; nineteen `16`s plus one `60` → `{ p95: 16, max: 60, count: 20 }` (n = 20, ceil(19) − 1 = index 18 of the sorted list = 16); ninety-five `16`s plus five `40`s (n = 100, index 94) → `p95 16`, `max 40`; the input array is not mutated (sort a copy).
   2. `it('readTimingPath and writeTimingPath round-trip every TUNING_KEY without mutating the input', …)` — for each of the 24 keys: `readTimingPath(DEVICE, key)` equals the nested DEVICE value; `writeTimingPath(DEVICE, key, 7)` returns a table whose `readTimingPath` is `7` while `readTimingPath(DEVICE, key)` is unchanged; clamps: `-5` → `0`, `9999` → `TUNING_MAX_MS`; `mergeTimingOverride(DEVICE, null)` deep-equals `DEVICE` and is not the same object.
   3. `it('renders the unavailable text and nothing else when __DEV__ is false', …)` — `__DEV__ = false` before `renderer.create(<CeremonyTuningScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 't', name: 'CeremonyTuning' } as any} />)`; `ceremony-tuning-unavailable` exists; `findAllByProps({ testID: 'ceremony-tuning-root' })` has length 0.
   4. `it('writes the DEVICE override through setCeremonyTimingOverride from a stepper row', …)` — `__DEV__` true; `getCeremonyTimingOverride()` is `null` before; press `ceremony-tuning-slider-single.hold.LEG-plus` → `getCeremonyTimingOverride()?.single?.hold.LEG` is `DEVICE.single.hold.LEG + TUNING_STEP_MS` and the `-value` Text shows it; press `-minus` twice → `DEVICE.single.hold.LEG - TUNING_STEP_MS`; press `ceremony-tuning-reset` → `getCeremonyTimingOverride()` is `null` and the value Text shows `DEVICE.single.hold.LEG`.
   5. `it('flags a table that exceeds the device ceiling in the cap readout', …)` — initial `ceremony-tuning-cap-single-LEG` text is `'3120 / 3300'`; press `ceremony-tuning-slider-single.approach-plus` ten times (each in `act`) → the text is `'3320 / 3300 OVER'`; `ceremony-tuning-cap-multi-LEG` still `'5000 / 5500'`.
   6. `it('reports frame gaps from requestAnimationFrame deltas while the probe is on', …)` — `const queue: Array<(ts: number) => void> = []; vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => { queue.push(cb); return queue.length; });` (the parameter type is required: `mobile/tsconfig.json` is `strict: true` with no `include` list, so `tsc --noEmit` covers `mobile/tests/` and an untyped `cb` is TS7006) and `vi.stubGlobal('cancelAnimationFrame', vi.fn())`; render; probe text ends with `IDLE`; press `ceremony-tuning-probe-toggle`; drive `PROBE_REPORT_EVERY + 1` callbacks inside `act` (shift one from `queue`, call it with the next timestamp) with timestamps `t += 16` except one step of `+60` → probe text contains `max 60.0 ms` and ends with `FAIL` (n = 30 gaps: p95 = 16 < 22 but max 60 > 50); press the toggle again inside `act` → drain whatever is still queued by calling it with `t += 16` → `queue` is empty afterwards (the `stopped` flag keeps a stale callback from rescheduling) and `cancelAnimationFrame` was called at least once.
   7. `it('DebugMenu seeds the wallet at 30/5 and reports it', …)` — render `DebugMenuScreen` (`navigation={{ navigate } as any}`, `route={{ key: 'debug', name: 'DebugMenu' } as any}`), press `debug-seed-wallet`, `await act(async () => {})` → `saveRewardWalletState` called with `{ availablePulls: 30, reservePulls: 5 }` and the tree's text contains `Wallet seeded 30/5`.
   8. `it('DebugMenu owns every non-Legendary card of the active deck and leaves Legendary unowned', …)` — `activeSlugFixture = 'csharp'`, `deckFixture = { Cards: [{ StableUid: 'a', Difficulty: 1 }, { StableUid: 'b', Difficulty: 2 }, { StableUid: 'c', Difficulty: 3 }] }`, `drawStateFixture = { owned: ['b'], pity: null }`; press `debug-only-legendary`; flush → `saveDrawState` called with `('csharp', { owned: ['b', 'a'], pity: null })` and the text contains `1 Legendary left`; with `activeSlugFixture = null` → `saveDrawState` not called and text contains `No active deck`.
   9. `it('DebugMenu toggles the ceremony dev overrides and opens the tuning screen', …)` — press `debug-force-fallback` → `getCeremonyDevOverrides().forceFallback === true` and the button text contains `ON`; press again → `false`; same for `debug-force-repeat`; press `debug-ceremony-tuning` → `navigate` called with `'CeremonyTuning'`; `findPressableByText(tree, 'Open error shell')` still exists (existing surface intact).
   10. `it('DebugMenu hides the ceremony tools when __DEV__ is false', …)` — `__DEV__ = false`; render; `findAllByProps({ testID: 'debug-ceremony-tools' })` length 0; `debug-reset-progress` still present.

Estimated size: `CeremonyTuning.tsx` ≈ 260 LOC, `DebugMenuScreen.tsx` +≈ 110, `types.ts` +1, `App.tsx` +2, test ≈ 330.

## Acceptance

Run from `mobile/`. `docs/delivery/r16-issues/B13.verify.sh` runs exactly these from the worktree root.

1. `npx vitest run tests/unit/ceremonyTuning.test.tsx tests/integration/phase-c-shells.screen.test.tsx tests/integration/phase-c-complete.screen.test.tsx tests/integration/system-support-polish.screen.test.tsx tests/unit/ceremonyTimings.test.ts tests/unit/ceremonyPrefs.test.ts --reporter=dot` exits 0; `tests/unit/ceremonyTuning.test.tsx` has ≥ 10 `it(` blocks with the ten titles above and contains `vi.mock('../../src/components/ceremony/reanimatedGuard'`.
2. `npm run test:typecheck` exits 0.
3. Literal guards on `src/screens/dev/CeremonyTuning.tsx`: exports `TUNING_KEYS`, `TUNING_STEP_MS = 20`, `FRAME_GAP_P95_CAP_MS = 22`, `FRAME_GAP_MAX_CAP_MS = 50`, `function summarizeFrameGaps`, `function useFrameGapProbe`, `function readTimingPath`, `function writeTimingPath`, `function mergeTimingOverride`, `function CeremonyTuningScreen`, `export default CeremonyTuningScreen`; strings `ceremony-tuning-root`, `ceremony-tuning-unavailable`, `Not available in release builds`, `ceremony-tuning-probe`, `ceremony-tuning-slider-${key}`, `ceremony-tuning-cap-`, `ceremony-tuning-reset`, `ceremony-tuning-probe-toggle`; imports `setCeremonyTimingOverride`, `getCeremonyTimingOverride`, `resolveCeremonyTimings`, `TO_TABLE_CAP_MS`; no `require(`, no `from 'react-native-reanimated'`, no `@shopify/react-native-skia`, no `Slider`, no `Alert`, no `shadowRadius`.
4. Literal guards on `src/screens/DebugMenuScreen.tsx`: the five testIDs `debug-seed-wallet`, `debug-only-legendary`, `debug-force-fallback`, `debug-force-repeat`, `debug-ceremony-tuning` plus `debug-ceremony-tools`; `availablePulls: 30, reservePulls: 5`; `navigate('CeremonyTuning')`; `setCeremonyDevOverride(`; `await import('../content/deckRepository')` and `await import('../content/activeDeck')`; NO static `from '../content/deckRepository'`; the existing `debug-reset-progress`, `Reset all progress`, `Open error shell` literals still present; `__DEV__ ?` present.
5. Route + registration: `types.ts` contains `CeremonyTuning: undefined;`; `App.tsx` contains `import CeremonyTuningScreen from './src/screens/dev/CeremonyTuning';` and `{__DEV__ ? <Stack.Screen name="CeremonyTuning" component={CeremonyTuningScreen} /> : null}`; `git diff --numstat <merge-base> -- mobile/App.tsx mobile/src/navigation/types.ts` shows ≤ 2 added / 0 deleted for `App.tsx` and 1 added / 0 deleted for `types.ts`.
6. Scope + frozen guard (purely negative): changed/untracked paths ⊆ scope ∪ `docs/delivery/r16-issues/`; frozen files zero diff; no `.skip(`/`.only(`/`@ts-ignore`/`eslint-disable` in the scope files; `"vite": "7.2.4"` still in `package.json`; no `@sentry` anywhere under `mobile/src`.

## Do NOT

- Do NOT add a dependency (no slider package, no `expo-dev-client` changes). Do NOT edit `package.json`, `package-lock.json`, `app.json`, `vitest.config.ts`, `tests/setup/*`.
- Do NOT edit `ceremonyTimings.ts`, `ceremonyPrefs.ts`, `reanimatedGuard.ts`, `DrawCeremonyScreen.tsx`, `DrawScreen.tsx`, `SettingsScreen.tsx` or any existing test; do NOT change `DrawCeremony`/`DrawResult` params in `types.ts` (B10) and do NOT add `linking` to `App.tsx` (B15).
- Do NOT import `deckRepository`/`activeDeck` at module scope in `DebugMenuScreen.tsx`; do NOT call `Alert` from the new handlers; do NOT write draw state with `AsyncStorage.setItem` directly (cache contract, `drawStateStore.ts:300-310`).
- Do NOT capture `__DEV__` into a module constant; do NOT render the tuning UI or the DebugMenu block when `__DEV__` is false; do NOT register the `Stack.Screen` unconditionally.
- Do NOT touch the frozen files (`mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`).
- Standing rules: no `git push`, no PR, never touch `main`, no EAS/expo/npm-install command, no test gutting (`.skip`, `.only`, `@ts-ignore`, `eslint-disable`), no loosening of `tsconfig`.
