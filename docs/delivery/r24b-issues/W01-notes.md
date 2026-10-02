# W01 — Plain words: Draw tab, Draw screen, pack opening, Draw result, share sheet (#669)

Round r24b, wave w. Contract: `R24B-00-contracts.md` §0/§1; inventory: facts-copy §2, §3 (FeedbackSection
excluded, another issue owns it), §4 and §10 (drawState.ts, pity.ts, ceremonyCopy.ts `CEREMONY_COPY`).
This changes copy only. Behaviour, layout, navigation, identifiers, testIDs, storage keys and event names are unchanged.

## What changed (files)

- `mobile/src/screens/DrawScreen.tsx`
- `mobile/src/screens/DrawResultScreen.tsx`
- `mobile/src/features/gacha/share/shareDraw.ts`
- `mobile/src/features/gacha/draw/ceremonyCopy.ts`
- `mobile/src/features/gacha/draw/drawState.ts`
- `mobile/src/features/gacha/draw/pity.ts`
- Tests: see "How it is tested".

`DrawCeremonyScreen.tsx` has no literal of its own. It reads `CEREMONY_COPY_V10.leaveCeremony`, so it needed no change.

## Exact surface shipped

| Where | Before | After |
|---|---|---|
| Draw screen, Open 10 with 1–9 draws | Open 10 · need 10 pulls | Open 10 · need 10 draws |
| Draw screen badge, VoiceOver | {n} pull(s) for {deck} | {n} draw(s) for {deck} |
| Draw screen, empty pack (VoiceOver-readable) | No pulls for this pack yet. Learn its cards to earn more. | No draws for this pack yet. Learn its cards to earn more. |
| Draw screen, empty-pack button | Earn pulls by studying  → | Earn draws by studying  → |
| Draw screen, that button's VoiceOver label | Start today's session to earn pulls | Start today's session to earn draws |
| Draw screen, load error body | Unable to load draw chamber right now. | Unable to load Draw right now. |
| Draw result, primary (loading) | Checking pulls... | Checking draws... |
| Draw result, primary | Continue draw  ·  {n} pull(s) left | Continue drawing  ·  {n} draw(s) left |
| Draw result, primary (empty) | Go to Library  ·  earn pulls in study | Go to Library  ·  earn draws in study |
| Draw result, primary VoiceOver (loading) | Checking remaining pulls | Checking remaining draws |
| Draw result, empty state | Nothing pulled | No cards drawn |
| Draw result, guarantee badge | GUARANTEE PAID OUT | GUARANTEED RARE |
| Draw result, share button + label | Share this pull | Share these cards |
| Draw result, earn link VoiceOver | Earn more pulls by studying | Earn more draws by studying |
| Draw result, earn link | Earn more pulls → | Earn more draws → |
| iOS share sheet title | {deck} pull | {deck} cards |
| Pack opening, leave button VoiceOver | Leave ceremony | Leave pack opening |
| `CEREMONY_COPY` (no production reader) | Pity bonus rare or better / Single pull ceremony / Single-pull spotlight / Reward draw ceremony / "…next study run" | Guaranteed rare or better / Single card opening / Single-card spotlight / Reward pack opening / "…next study session" |
| `buildPityProgressLabel` (no callers) | {n}/10 cards until guaranteed RAR+ | {n}/10 cards until a rare or better is guaranteed |
| `buildDrawState` titles/helpers (not rendered) | Reward pulls ready; Wallet full, reserve waiting; "…queued in reserve…"; "…new pulls."; "…draw pool…" | Reward draws ready; Saved draws full, extra draws waiting; "{a} draws are saved and {r} more are waiting…"; "…new draws."; "…active pack…" |

Pluralisation logic (`=== 1 ? '' : 's'`) is kept unchanged everywhere.

## How it is tested

Tests were changed first. They failed on the base: 16 tests across 11 files. With the copy change, all of them pass.
- Pins updated to the new strings: `draw-pack-arming.spec.tsx`, `draw-deck-wallet.spec.tsx`,
  `draw.screen.test.tsx`, `draw-result.screen.test.tsx`, `draw-result-pulls-left.spec.tsx`,
  `draw-ceremony.screen.test.tsx`, `pity-visibility.test.tsx` (now an exact `GUARANTEED RARE`), `pity.test.ts`,
  `shareDraw.test.ts`, `draw.test.ts`.
- New assertions:
  - Draw screen: the VoiceOver label of the empty-pack button.
  - Draw result:
    - the full Library label, the earn-link label and its text
    - `Continue drawing  ·  60 draws left`
- New negative guards:
  - `ceremony-copy.test.ts`: `CEREMONY_COPY`, `_V9` and `_V10` contain none of pull(s), pity, wallet, reserve, run(s) or ceremony.
  - `draw.test.ts`: every `buildDrawState` branch is free of pull(s), pity, wallet, reserve, run(s) and pool. This test also checks the singular forms.
- Gates: `npx tsc --noEmit` and `npx vitest run` (286 files, 2192 tests) pass. The facts-copy §11 negative guards stay green.

## Owner steps

None. The change is OTA-safe and JS-only.

## Deferred / notes

- `npm run test:smoke` (`tests/p2-smoke.ts`) already fails on the base branch: `/\+2 pull/i` vs `'Progress saved'`, which is reward copy in summaryMapper/rewardResolver. None of the W01 files are involved and it is outside this issue's strings, so it is left for its owner. Its `tsc` step also reports type conflicts from the symlinked `node_modules` in this worktree.
- "Unable to load draw chamber right now." is not in the §1 list. Because "draw chamber" is jargon, it was replaced with "Unable to load Draw right now." No test pinned it.
- Comments and identifiers that still say pull/pity/wallet are intentional (contract §0).
- The plain-words guard test (`plainWordsGuard.test.ts`) belongs to W04. The `pity.ts`, `ceremonyCopy.ts` `_V9`/`_V10` strings it will scan now contain none of its words.
