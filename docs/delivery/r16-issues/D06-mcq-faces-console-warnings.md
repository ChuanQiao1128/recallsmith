# D06 — MCQ card faces (mobile) + console importer warnings tier (`mcq-faces-console-warnings`)

Phase 4 polish in one issue with two roots. **Mobile:** `DrawnCardVm` gains `tag` (the C07 topic label, the slot `DrawResultScreen` already renders as the featured topic chip) and `kind`/`requiredCount` (an MCQ mark, `MC` / `MC · pick 2`, on the featured DrawResult card), `CardDetailScreen` gains a `Multiple choice` / `Multiple choice · pick 2` hero chip, `LibraryCardRow.isMcq` puts a small `MC` on Library tiles, and every mark obeys the kill switch. Options, keys, WHYs and answers never reach a face. Pure TS shipped as an OTA on runtime 1.6.0 — no dependency, manifest or native change. **Console:** a non-blocking `ParsedDeck.warnings` tier (`frontend/src/lib/mcqWarnings.ts`, six `MCQ_WARN_*` codes with the plan's thresholds) rendered as an amber "suggestions — not blocking" panel under the error panel and printed by `lint-deck.mts`; `errors`, `planImport`, `blocked` and the "N problem(s)" count do not move.

## Context

What the tree looks like today (`delivery/r16-d-mcq` == `main@107e2a2`; every line below read on 2026-09-22 on that tree; D01–D05 merge before you and touch none of the lines cited here except where noted):

- **Draw VM has no face fields.** `mobile/src/features/gacha/draw/drawCommit.ts` (171 lines): `DrawnCardVm` `:13-20` (`rank: number;` `:19` is the last field), `commitDraw` `:37-127` (`resolveDeckBySlug` dynamic import `:46`, the VM literal `:98-104` maps `stableUid, question, difficulty, rarity, rank`). No flag is read. The route shapes already declare `tag?: string` — `mobile/src/navigation/types.ts` `DrawCeremony` cards `:87-95` (`tag?` `:92`, `rank?` `:94`) and `DrawResult` cards `:116-124` (`tag?` `:121`, `rank?` `:123`); `SessionSummary` `:191-204` is where D05 appends `picks?` (below your lines, so the numbers above hold after D05). `DrawScreen.tsx:586-600` and `DrawCeremonyScreen.tsx:277-290` pass `result.cards` / `drawResult` through as whole objects, so a field added to the VM reaches DrawResult with no other edit.
- **DrawResult renders `tag` as the topic chip.** `mobile/src/screens/DrawResultScreen.tsx` (855 lines): imports `:1-39` (`react-native` named imports `:2-10`, `MCQ_COPY` is not among the imports yet), `readRN` facade `:46-53`, `DrawResultCard` type `:63` (derived from the route param), `cardTagText` `:87-89`, `localStyles` `:133-149` (`featuredChipInWindow` `:138`, `featuredTopicChip` `:139-142`, `featuredTopicText` `:143`), `featuredTopic = featured ? cardTagText(featured) : ''` `:394`, the comment naming the slot "rarity chip + topic label" `:468-472`, art window `View testID="draw-result-featured-art-window"` `:515-543` with the rarity chip `:531-535` (absolute, left 8 / top 8) and the topic chip `:536-542` (absolute, left 8 / bottom 8), question slab `:545-555` (`numberOfLines={FEATURED_STEM_LINES}` `:550`, `FEATURED_STEM_LINES = 6` `:131`), serial `:563`, grid rows `:706-710` (`styles.gridTag`). `mobile/tests/integration/draw-result.screen.test.tsx` (727 lines, untouched) mocks `react-native` with exactly `ActivityIndicator, Image, View, Text, ScrollView, Modal, Pressable, useWindowDimensions, StyleSheet` (`:10-31`), pins the topic chip's parent and text (`:569-571`), the frame as the LAST child of the featured card (`:548`) and the fixtures `tag: 'Core'` (`:85`, `:677`).
- **CardDetail.** `mobile/src/screens/CardDetailScreen.tsx` (529 lines): imports `:1-14` (`react-native` names only `Pressable, ScrollView, StyleSheet, Text, View`), guarded dynamic loaders `:30-68`, `useDeckCard` `:71-113` (`isLocked` `:111`), the dead `tag` fallback `const tag = (card as any)?.Tag ?? deck?.Title ?? '';` `:186`, hero top bar `<View style={styles.heroTopBar}>` `:219-243` = rarity chip `:220-237` then status chip `:238-242`, question slab `:262-268` (no `numberOfLines`), local `styles` `:362-529` (`heroTopBar` `:410`, `heroRarityChip` `:411`, `heroStatusChip` `:413-418`, `heroStatusChipText` `:420`). No Explanation / RealWorldUsage is rendered anywhere on this screen. Harnesses that render it: `tests/integration/plan-library-deep-polish.screen.test.tsx:5-24` (five-export `react-native` mock) and `tests/integration/owned-gate-entry-points.spec.tsx:128-140`, `:471-505` (mocks `activeDeck` / `deckRepository`, real `review/storage`).
- **Library.** `mobile/src/features/gacha/library/libraryMapper.ts` (331 lines): imports `:1-9`, `LibraryCardRow` `:22-57` (`topic` `:49`, `rank` `:56` last), `buildLibraryCardRows` params `:119-126`, row literal tail `:178-185` (`topic: normalizeTopic(card.Topic),` `:183`, `rank: ranks.get(card.StableUid) ?? 0,` `:184`), `buildLibraryVM` params `:189-200` (`topicFilter?` `:199`), destructuring `:201-212`, `const rows = buildLibraryCardRows({ deck, progress, now, isTrial, previewTotal, ownedSet });` `:213`. `LibraryCardTile.tsx` (126 lines): imports `:1-8` (`Pressable, Text, View` only), body `:102-111` (icon Text `:104-106`, question `numberOfLines={2}` `:107-109`), hidden status probe `:113-123`. `LibraryScreen.tsx` (428 lines): imports `:15-35`, `buildLibraryVM({ … topicFilter, })` call `:167-176`, deps `:177`. `libraryScreenStyles.ts` is NOT in scope (D00 §0), so the tile mark uses a plain style object.
- **Pinned row shape.** `mobile/tests/unit/libraryTopics.test.ts:231-235` pins the row key count (`toBe(14)` `:234`) and the last three keys (`slice(-3)` `:235`); `mobile/tests/unit/libraryCardTile.test.tsx:40-57` builds a full `baseRow: LibraryCardRow` (last property `topic: null,` `:56`, `};` `:57`). Both get the bounded edits below. `tests/unit/draw.test.ts` builds rows `as any` (`:49`) and needs nothing; `library.test.ts`, `ownedGatePredicates.test.ts`, `cardRank.test.ts` map single fields.
- **Flags.** `mobile/src/config/featureFlags.ts` (127 lines, not edited): `getFeatureFlags()` `:53-55`, `applyRemoteFeatures(config)` `:63-116` (`applyRemoteFeatures({ features: { mcq: { enabled: false } } })` flips the switch in a test; `applyRemoteFeatures(null)` restores the defaults). Rule `:57-62`: read once at the moment of use. Nobody under `mobile/src` reads `flags.mcq` until D03/D05; you add three readers (`commitDraw`, `CardDetailScreen`, `LibraryScreen`).
- **D01/D02 give you** `mobile/src/features/gacha/mcq/normalizeMcq.ts` (`normalizeMcq`, `mcqRequiredCount`, `resolveMcq(card, flags)`, `isMcqCard(card, flags)`; D00 §2.1) and `mcq/mcqConstants.ts` (`MCQ_COPY.faceMark = 'MC'`, `faceMarkPick(n)` → `` `MC · pick ${n}` ``, `detailChip = 'Multiple choice'`, `detailChipPick(n)` → `` `Multiple choice · pick ${n}` ``; `MCQ_TEST_IDS.drawFeaturedKind = 'draw-result-featured-kind'`, `cardDetailKind = 'card-detail-kind-chip'`, `libraryKind(uid)` → `` `library-card-kind-${uid}` ``; D00 §2.2). Both are pure. `CardExport.Mcq` is server-shaped and unvalidated (D00 §0): read it only through `resolveMcq` / `isMcqCard` / `normalizeMcq`.
- **Console.** `frontend/src/lib/deckImport.ts` (910 lines): imports `:36-39`, `ParsedDeck` `:93-98` (`errors: ImportIssue[];` `:97`), `parseDeckMarkdown` `:242-628` (`errors.push(...validateCards(cards));` `:625`, `return { deckSlug, cards, errors: sortIssues(errors) };` `:627`), `sortIssues` `:631-636`, `validateCards` `:652-720` with the MCQ block `:704-716` (comment `:704-706` "There is no warning tier in Wave C"), `planImport` `:772-859` (takes `Pick<ParsedDeck, 'cards'>` `:773`), `formatIssue(issue: ImportIssue)` `:908-910`. Nobody constructs a `ParsedDeck` literal (`DeckImportPage.tsx:22`, `:42` and the tests only consume it), so a required `warnings` field breaks no caller. `frontend/src/types/mcq.ts` (7 lines): `McqOption { key; text; why: string | null; correct }`, `McqBlob { v: 1; qualifier; shuffle; options }`. `frontend/src/pages/DeckImportPage.tsx` (618 lines): imports `:11-31` (`formatIssue … type ParsedDeck` `:16-23`), `blocked` `:224-230`, badge strip `<div className="flex flex-wrap gap-2">` `:395-401` with exactly five `<Badge>` children, error panel `:412-424` (heading `{n} problem{n === 1 ? '' : 's'} in the document` `:414-417`). `frontend/scripts/lint-deck.mts` (145 lines): header `:1-27`, type import `:34`, `LintResult` `:85-89`, `lintText` `:91-99`, `main` `:101-131` (issue lines `:123-125`, summary `:126`, `failed` `:127`, exit `:130`); the argv filter `:102` already drops `--flags`.
- **Console pins you must not disturb.** `frontend/tests/deckImportPageRun.test.tsx`: `badgeStrip()` `:221-226` reads EVERY child of the badge-strip div and `:289-295`, `:398-404` assert the 5-element array, `:376` indexes `[4]`; `:374` / `:387` pin `'2 problems in the document'` / `'1 problem in the document'`; `:375` / `:388` count ALL `listitem`s on the page (their documents are Q/A only, so a warnings `<ul>` that renders nothing for a Q/A document keeps them at 2 / 1). `frontend/tests/deckImport.mcq.test.ts:522-524` pins `Record<McqIssueCode, CodeCase>` — a warning code must NOT join `McqIssueCode`. `frontend/tests/cardRulesWiring.test.ts:173-196` pins the consumer set of `cardRules.ts` — `mcqWarnings.ts` must not import from it. `frontend/tests/uiLanguage.test.ts:65-75` walks `src/` for CJK ranges. `frontend/tests/docsPaths.test.ts:85-90` walks top-level `docs/*.md` only — nothing in Wave D edits those.
- **The plan card is the fixture.** `docs/mcq-card-type-plan-2026-09-18.md:177-253` (card 1 `:177-217`, card 2 `:218-253`; `:176` is the blank line before card 1, which is why the verify's `sed -n 176,253p` under a two-line header puts card 1 on line 4 and card 2 on line 45); `frontend/tests/deckImport.mcq.test.ts:32-73` (`MCQ_CARD_1`) and `:75-112` (`MCQ_CARD_2`) already hold them as line arrays — copy those. Measured 2026-09-22 with lines joined by `\n` as `sectionText` (`deckImport.ts:222-225`) does: card 1 — correct b = 157 chars, wrong a/c/d = 95 / 104 / 114, median 104 × 1.4 = 145.6 < 157; stem 49 words; first sentence 78 chars; every WHY ≥ 121; shape (1, 4); USAGE present → warnings exactly `['MCQ_WARN_CORRECT_LONGEST']`. Card 2 — correct a/c = 102 each, wrong b/d/e = 53 / 94 / 39, median 53 × 1.4 = 74.2 < 102; stem 47 words; first sentence 190 chars; WHYs 105 / 178 / 170; shape (2, 5); no USAGE → `['MCQ_WARN_CORRECT_LONGEST', 'MCQ_WARN_FIRST_SENTENCE_LONG', 'MCQ_WARN_NO_USAGE']`. Both cards parse with 0 issues (`node frontend/scripts/lint-deck.mts` on the two cards prints `2 cards, 2 mcq, 0 issues` today).

What D00 decided (binding; `docs/delivery/r16-issues/D00-contracts.md`): §0 (`:9-26`) non-negotiables; §1.1 (`:53-60`) and §1.2 (`:64-74`) the D06 file rows; §2.6.1 (`:396-404`) the faces; §2.6.2 (`:406-426`) the warnings tier; §3.6 (`:472-476`) the tests; §4 (`:493`) deps = **D05** (queue order, `navigation/types.ts` after D05's `picks?`); §5 (`:499-512`) verify conventions; §6 #9 (`:526`) one issue, two roots, console scope widened; #10 (`:527`) `tag` = topic, the MCQ mark is its own field; #11 (`:528`) `isMcq` is required, two tests get bounded edits; #14 (`:531`) thresholds stay the plan's numbers and "zero warnings on re-import" is NOT a gate.

Doc drift, stated so nobody re-derives it: plan §6.8 (`docs/mcq-card-type-plan-2026-09-18.md:365`) puts "Choice · pick 2" INTO `tag` — superseded by D00 §6 #10 (`tag` is the topic; `kind`/`requiredCount` carry the mark, copy `MC · pick 2`); plan `:365` cites `drawCommit.ts:12-17` and `DrawResultScreen.tsx:392-395` — the type is `:13-20` and the featured topic line is `:394`; plan `:366` cites `LibraryCardTile.tsx:90-106` — the body is `:102-111`. The wave table (`docs/delivery-wave-1.6-plan-2026-09-19.md:132`) lists only `deckImport.ts, tests` for the console — widened by D00 §6 #9 to `mcqWarnings.ts`, `DeckImportPage.tsx`, `lint-deck.mts`. Plan `:405` ("黄金 5 重导零警告") is not a gate anywhere (D00 §6 #14: the live decks warn on 122/165 and 99/142 cards for `MCQ_WARN_CORRECT_LONGEST`).

Gaps D00 leaves open — resolved here and binding for this issue:

1. **`tag` is a conditional key, not `undefined`.** D00 §2.6.1 writes `normalizeTopic(card.Topic) ?? undefined`, §3.6 requires "no `tag` key when `Topic` is null". A key holding `undefined` is a key (`'tag' in card`), so the VM literal spreads `...(tag !== null ? { tag } : {})` and `...(mcq !== null ? { kind: 'mcq' as const, requiredCount: mcqRequiredCount(mcq) } : {})` — both readings hold and the key order is pinned (`Object.keys` in the test).
2. **The reader guard admits `libraryMapper.ts` in one form.** D00 §0 lists three `.Mcq` readers, but §2.6.1 itself writes `isMcq: mcqEnabled && normalizeMcq(card.Mcq) !== null` (and §2.3 gives `sessionPlanner.ts` the same `normalizeMcq(card.Mcq)` form for D03). Decision: the raw field may be read only as the argument of `normalizeMcq(…)`, `resolveMcq(…)` or `isMcqCard(…)`; `libraryMapper.ts` contains `.Mcq` exactly once, as `normalizeMcq(card.Mcq)`; `drawCommit.ts` and `CardDetailScreen.tsx` use `resolveMcq(card, flags)` and never spell `.Mcq`. The verify allow-lists the three canonical files plus `libraryMapper.ts` and `planner/sessionPlanner.ts` and checks the form in `libraryMapper.ts`.
3. **Where the warnings are sorted.** `sortWarnings` lives in `mcqWarnings.ts` (by `line`, then `code` as a string, then original index) so `deckImport.ts` gains one loop and one return key and nothing else.
4. **`warnMcq` is total.** It runs on every card with `mcq`, including cards the blocking rules refuse (empty text, no wrong option, `why: ''`), so: no wrong options or a median of 0 → no `MCQ_WARN_CORRECT_LONGEST`; a non-array `options` → treated as `[]`; a `why` that is a string (even `''`) shorter than 40 after trim → `MCQ_WARN_WHY_SHORT`; nothing throws.
5. **Median** of an even count is the mean of the two middle values; lengths are `text.trim().length`.
6. **Group heading** in the amber panel is `${code} (${count})`; one `<ul>` per code in first-seen order (warnings arrive sorted by line then code).

## Read first

1. `docs/delivery/r16-issues/D00-contracts.md` §0 (`:9-26`), §1.1/§1.2 (`:36-76`), §2.1 (`:82-131`), §2.2 (`:133-192` — `MCQ_COPY`, `MCQ_TEST_IDS`), §2.6 (`:394-426`), §3.6 (`:472-476`), §5 (`:499-512`), §6 #9–#11, #14 (`:526-528`, `:531`).
2. `mobile/src/features/gacha/mcq/normalizeMcq.ts` and `mcqConstants.ts` (D01/D02, on your base) — the exports you consume; `mobile/src/types/deckExport.ts` (`CardExport.Mcq?`).
3. `mobile/src/features/gacha/draw/drawCommit.ts` (whole file, 171 lines); `mobile/src/navigation/types.ts:83-130`.
4. `mobile/src/screens/DrawResultScreen.tsx:1-63`, `:87-89`, `:131-149`, `:385-400`, `:465-575`, `:695-720`.
5. `mobile/src/screens/CardDetailScreen.tsx:1-14`, `:70-115`, `:172-270`, `:405-421`.
6. `mobile/src/features/gacha/library/libraryMapper.ts:1-9`, `:22-57`, `:119-127`, `:150-187`, `:189-213`; `LibraryCardTile.tsx` (whole, 126 lines); `LibraryScreen.tsx:15-35`, `:165-177`.
7. `mobile/tests/unit/drawAtomicity.test.ts:1-100` (the `commitDraw` harness you copy), `mobile/tests/integration/draw-result.screen.test.tsx:1-130` and `:540-575` (harness + the topic-chip assertions you mirror), `mobile/tests/integration/plan-library-deep-polish.screen.test.tsx:1-30` and `owned-gate-entry-points.spec.tsx:125-140`, `:220-256`, `:471-505` (CardDetail harnesses), `mobile/tests/unit/libraryCardTile.test.tsx` (whole, the tile harness + `baseRow`), `mobile/tests/unit/libraryTopics.test.ts:228-245`, `mobile/tests/unit/featureFlags.test.ts:60-130` (`applyRemoteFeatures` in tests).
8. `frontend/src/lib/deckImport.ts:36-39`, `:60-98`, `:220-226`, `:242-250`, `:618-640`, `:700-720`, `:770-776`, `:904-910`; `frontend/src/lib/mcqRules.ts:1-40` (the pure-module pattern); `frontend/src/types/mcq.ts`.
9. `frontend/src/pages/DeckImportPage.tsx:1-60`, `:215-235`, `:385-430`; `frontend/scripts/lint-deck.mts` (whole, 145 lines).
10. `frontend/tests/deckImport.mcq.test.ts:1-120` (fixtures `MCQ_CARD_1` / `MCQ_CARD_2`, the fast-check style, `:522-540` the code table you must NOT extend), `frontend/tests/deckImportPageRun.test.tsx:1-105`, `:207-300`, `:366-410` (the page harness and the pins), `frontend/tests/cardRulesWiring.test.ts:131-148`, `:173-196`, `frontend/tests/uiLanguage.test.ts:55-80`.

## Constraints

- **Scope (the ONLY files that may change):**
  mobile — `mobile/src/features/gacha/draw/drawCommit.ts`, `mobile/src/navigation/types.ts`, `mobile/src/screens/DrawResultScreen.tsx`, `mobile/src/screens/CardDetailScreen.tsx`, `mobile/src/features/gacha/library/libraryMapper.ts`, `mobile/src/features/gacha/library/LibraryCardTile.tsx`, `mobile/src/screens/LibraryScreen.tsx`, `mobile/tests/unit/drawCommitFaces.test.ts` (new), `mobile/tests/integration/draw-result-kind.screen.test.tsx` (new), `mobile/tests/integration/card-detail-kind.screen.test.tsx` (new), `mobile/tests/unit/libraryMcqMark.test.tsx` (new), plus the two bounded edits `mobile/tests/unit/libraryTopics.test.ts` (numstat `2	2`) and `mobile/tests/unit/libraryCardTile.test.tsx` (numstat `1	0`);
  console — `frontend/src/lib/mcqWarnings.ts` (new), `frontend/src/lib/deckImport.ts`, `frontend/src/pages/DeckImportPage.tsx`, `frontend/scripts/lint-deck.mts`, `frontend/tests/mcqWarnings.test.ts` (new), `frontend/tests/deckImportPageWarnings.test.tsx` (new). Nothing else.
- **Frozen files (gacha-v7 §2.1, narrowed by C00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched (D00 §0 do-not-touch): `mobile/src/review/storage.ts`, `mobile/src/content/chunkedInstall.ts`, `mobile/src/features/gacha/planner/*`, `session/*`, `rewards/*`, `components/ReviewBody.tsx`, `RatingBar.tsx`, `components/Mcq*.tsx`, `draw/poolSelection.ts`, `cardRarity.ts`, `contracts.ts`, `library/LibraryHeader.tsx`, `libraryScreenStyles.ts`, `topics.ts`, `cardRank.ts`, `mcq/*` (you consume, never edit), `screens/SessionCardScreen.tsx`, `SessionSummaryScreen.tsx`, `config/featureFlags.ts`, `remoteConfig.ts`, `forceUpdateGate.ts`, `sync/clientCapabilities.ts`, `types/deckExport.ts`, `mobile/tests/setup/*`, `mobile/vitest.config.ts`, `mobile/tsconfig.json`; `frontend/src/lib/cardRules.ts`, `mcqRules.ts`, `deckImportRunner.ts`, `frontend/src/types/*`, `frontend/src/api/*`, `frontend/src/components/*`, every other page, `frontend/tests/support/*`, every config file; `src_C/**`, `snowflake/**`, every top-level `docs/*.md`.
- **OTA rule (D00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, `frontend/package.json`, `frontend/package-lock.json`; no new dependency, no native module, no `npm install`. `"expo-updates": "~29.0.15"`, `"vite": "7.2.4"`, `"version": "1.6.0"` stay as they are.
- **Kill switch (D00 §0):** `flags.mcq.enabled === false` → no `kind`/`requiredCount` on any drawn card, no `card-detail-kind-chip`, `isMcq === false` on every row, no `library-card-kind-*` node — while `tag` (topic) keeps flowing. Read the flag once at the moment of use (`getFeatureFlags()` inside `commitDraw`, in `CardDetailScreen`'s render, in `LibraryScreen`'s `buildLibraryVM` call); never `useFeatureFlags()` as live policy.
- **No answer on any face (plan §6.8):** no option text, key, WHY, `Explanation` or `RealWorldUsage` is rendered by `DrawResultScreen`, `CardDetailScreen` or `LibraryCardTile`, and no such field is copied onto `DrawnCardVm` or `LibraryCardRow`. The only MCQ-derived data on a face is `kind` / `requiredCount` / `isMcq`.
- **Mock safety (D00 §5):** no `+` line in any mobile scope file adds a `from 'react-native'` import or names `Platform`, `AccessibilityInfo`, `Vibration`; no `expo-haptics`, `expo-updates`, `@sentry`. `View` and `Text` are already imported everywhere you render.
- **`.Mcq` readers:** `libraryMapper.ts` may contain `.Mcq` exactly once, as `normalizeMcq(card.Mcq)`; no other scope file may spell `.Mcq` (use `resolveMcq(card, flags)`).
- **Console layering:** `mcqWarnings.ts` imports only `type { McqBlob } from '../types/mcq'` (no `react`, no `./cardRules`, no `./deckImport`); a warning code never joins `McqIssueCode` / `ImportIssueCode`; `errors`, `planImport`, `validateCards`, `COMPARABLE_FIELDS`, `fieldsThatDiffer`, `serializeDeckMarkdown`, `deckImportRunner.ts` and the page's `blocked` are byte-identical; the badge strip keeps exactly five `<Badge>` children; `frontend/src/**` stays free of CJK characters; no `any`.
- **testIDs (pinned):** `draw-result-featured-kind`, `card-detail-kind-chip`, `library-card-kind-${item.stableUid}`, `data-testid="import-warnings"`. **Copy (pinned):** `MCQ_COPY.faceMark` / `faceMarkPick(n)` / `detailChip` / `detailChipPick(n)` — imported, never re-typed; page heading `${n} suggestion${n === 1 ? '' : 's'} — not blocking`; group heading `${code} (${count})`; lint lines `${line}: WARN ${code} ${message}` and `${cards} cards, ${mcq} mcq, ${issues} issues, ${warnings} warnings`.
- **Banned literals in any new/changed line and in this brief:** the six terms of B00 §0 (driver gate, case-insensitive). Use "sidestep", "work around", "guard", "fallback", "probe". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff.
- **Existing tests:** only the two bounded edits above. `mobile/tests/integration/draw-result.screen.test.tsx`, `draw.screen.test.tsx`, `library.screen.test.tsx`, `library-final.screen.test.tsx`, `library-360-columns.spec.tsx`, `owned-gate-entry-points.spec.tsx`, `plan-library-deep-polish.screen.test.tsx`, `phase-b-deeper.screen.test.tsx`, `session-summary-picks.screen.test.tsx`, `session-card-mcq.screen.test.tsx`, `mobile/tests/unit/drawAtomicity.test.ts`, `draw.test.ts`, `library.test.ts`, `ownedGatePredicates.test.ts`, `cardRank.test.ts`, `featureFlags.test.ts`; `frontend/tests/deckImport.test.ts`, `deckImport.mcq.test.ts`, `deckImport.topic.test.ts`, `deckImportPageRun.test.tsx`, `deckImportPageSource.test.tsx`, `deckImportRunner.test.ts`, `cardMcqConsole.test.tsx`, `cardRulesWiring.test.ts`, `uiLanguage.test.ts`, `docsPaths.test.ts` are zero-diff and stay green.
- **MCQ text:** the only MCQ text any test or fixture may quote is plan §4.3 (`docs/mcq-card-type-plan-2026-09-18.md:177-253`) or the live decks (`content/decks/*.md`). Everything else is synthetic (`'x'.repeat(n)`, single-letter words). Never any exam dump.
- Any explicit component return type is `React.JSX.Element` (or omitted), never `JSX.Element` (C00 §6 #23).
- Standing rules: no `git push`, no PR, never touch `main`, no EAS / expo / deploy command, no npm/git activity outside your worktree.

## Changes required

### Mobile

1. **`mobile/src/features/gacha/draw/drawCommit.ts`**
   a. Imports, next to `:11`: `import { getFeatureFlags } from '../../../config/featureFlags';`, `import { mcqRequiredCount, resolveMcq } from '../mcq/normalizeMcq';`, `import { normalizeTopic } from '../library/topics';`.
   b. `DrawnCardVm` (`:13-20`) gains three optional fields after `rank: number;` (`:19`), verbatim:
      ```ts
        /** C07 topic label (normalizeTopic(card.Topic)); the key is ABSENT when the card has no topic. DrawResult renders it as the featured topic chip. */
        tag?: string;
        /** Present only when the card is MCQ under the flags read at commit time (D00 §2.6.1); DrawResult renders the "MC · pick n" mark. No option ever travels here. */
        kind?: 'mcq';
        requiredCount?: number;
      ```
   c. The VM literal (`:97-104`) becomes (`flags` read ONCE per commit, before the map):
      ```ts
        const flags = getFeatureFlags();
        const ranks = rankCardsByOrder(deck.Cards);
        const cards: DrawnCardVm[] = selection.cards.map((card) => {
          const tag = normalizeTopic(card.Topic);
          const mcq = resolveMcq(card, flags);
          return {
            stableUid: card.StableUid,
            question: card.Question,
            difficulty: card.Difficulty,
            rarity: rarityOfCard(card),
            rank: ranks.get(card.StableUid) ?? 0,
            ...(tag !== null ? { tag } : {}),
            ...(mcq !== null ? { kind: 'mcq' as const, requiredCount: mcqRequiredCount(mcq) } : {}),
          };
        });
      ```
      Key order of a full card: `stableUid, question, difficulty, rarity, rank, tag, kind, requiredCount`. `replayDraw` (`:156-171`), the history entry (`:86-95`) and `DrawCommitResult` are untouched — no face field is persisted.

2. **`mobile/src/navigation/types.ts`** — in BOTH draw card shapes (`DrawCeremony` `:87-95`, `DrawResult` `:116-124`), directly after `rank?: number;` (`:94`, `:123`), verbatim:
   ```ts
           /** D06 MCQ face mark. Absent on Q/A cards and under the kill switch; never any option text. */
           kind?: 'mcq';
           requiredCount?: number;
   ```
   `tag?: string;` (`:92`, `:121`) is untouched; the file's other params, including D05's `picks?`, are untouched.

3. **`mobile/src/screens/DrawResultScreen.tsx`** — featured card only.
   a. Import: `import { MCQ_COPY } from '../features/gacha/mcq/mcqConstants';` beside the other feature imports (`:34-39`). No new `react-native` name.
   b. After `cardTagText` (`:87-89`):
      ```ts
      function cardKindText(card: DrawResultCard): string {
        if (card.kind !== 'mcq') return '';
        return typeof card.requiredCount === 'number' && card.requiredCount >= 2
          ? MCQ_COPY.faceMarkPick(card.requiredCount)
          : MCQ_COPY.faceMark;
      }
      ```
   c. `localStyles` (`:133-149`) gains, after `featuredTopicText` (`:143`):
      ```ts
        featuredKindChip: {
          position: 'absolute', right: 8, top: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
          backgroundColor: 'rgba(20,23,55,0.72)',
        },
      ```
      (the text reuses `localStyles.featuredTopicText`; `drawResultStyles.ts` is not in scope).
   d. Beside `featuredTopic` (`:394`): `const featuredKind = featured ? cardKindText(featured) : '';`.
   e. Inside the art window, directly after the topic chip's `) : null}` (`:542`) and before the window's closing `</View>` (`:543`):
      ```tsx
                        {featuredKind ? (
                          <View testID="draw-result-featured-kind" style={localStyles.featuredKindChip}>
                            <Text style={localStyles.featuredTopicText} numberOfLines={1}>
                              {featuredKind}
                            </Text>
                          </View>
                        ) : null}
      ```
      The rarity chip (`:531-535`), topic chip (`:536-542`), question slab (`:545-555`, `FEATURED_STEM_LINES` stays 6), serial (`:563`), the frame as the last child of the card, and the grid rows (`:695-720`, no mark) are untouched. Update the comment at `:468-472` to say "rarity chip + topic label + MCQ mark over it" — one comment line, nothing else.

4. **`mobile/src/screens/CardDetailScreen.tsx`**
   a. Imports after `:14`: `import { getFeatureFlags } from '../config/featureFlags';`, `import { mcqRequiredCount, resolveMcq } from '../features/gacha/mcq/normalizeMcq';`, `import { MCQ_COPY } from '../features/gacha/mcq/mcqConstants';`.
   b. Directly after `const tag = …` (`:186`, left alone):
      ```ts
        // Read once per render, never as live policy (featureFlags.ts:57-62). A locked
        // card names no kind: the kind is one more thing the pull is supposed to reveal.
        const mcq = card && !isLocked ? resolveMcq(card, getFeatureFlags()) : null;
        const kindChip =
          mcq === null ? null : mcqRequiredCount(mcq) >= 2 ? MCQ_COPY.detailChipPick(mcqRequiredCount(mcq)) : MCQ_COPY.detailChip;
      ```
   c. In the hero top bar (`:219-243`), between the rarity chip's closing `</View>` (`:237`) and the status chip (`:238`):
      ```tsx
                      {kindChip ? (
                        <View testID="card-detail-kind-chip" style={styles.heroKindChip}>
                          <Text style={styles.heroKindChipText} numberOfLines={1}>
                            {kindChip}
                          </Text>
                        </View>
                      ) : null}
      ```
   d. Styles, after `heroStatusChipText` (`:420`):
      ```ts
        heroKindChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(20,23,55,0.72)' },
        heroKindChipText: { color: colors.softCream, fontSize: typography.caption, fontWeight: '900', letterSpacing: 0.4 },
      ```
   Nothing else on the screen changes: no options, WHY, explanation or answer text is rendered anywhere (plan §6.8), the CTAs and the meta strip are untouched.

5. **`mobile/src/features/gacha/library/libraryMapper.ts`**
   a. Import: `import { normalizeMcq } from '../mcq/normalizeMcq';` after `:9`.
   b. `LibraryCardRow` (`:22-57`): append after `rank: number;` (`:56`), verbatim:
      ```ts
        /** MCQ under the caller's flag (mcqEnabled): the tile prints a small "MC". Never the options. */
        isMcq: boolean;
      ```
   c. `buildLibraryCardRows` params (`:119-126`) gain `mcqEnabled?: boolean;` last; the destructuring (`:127`) adds `mcqEnabled = true`.
   d. Row literal (`:178-185`): append `isMcq: mcqEnabled && normalizeMcq(card.Mcq) !== null,` as the LAST property, after `rank: ranks.get(card.StableUid) ?? 0,` (`:184`). This is the file's only `.Mcq`.
   e. `buildLibraryVM` params (`:189-200`) gain `mcqEnabled?: boolean;` last; destructure it (`:201-212`) with default `true`; `:213` becomes exactly `const rows = buildLibraryCardRows({ deck, progress, now, isTrial, previewTotal, ownedSet, mcqEnabled });`. `LibraryViewModel`'s key set, the six `filters`, the topic chips and the grouping are byte-identical.

6. **`mobile/src/features/gacha/library/LibraryCardTile.tsx`**
   a. Import: `import { MCQ_COPY } from '../mcq/mcqConstants';` after `:8`.
   b. A module-level plain style (no `StyleSheet` import, no key in `libraryScreenStyles.ts`):
      ```ts
      const KIND_MARK_STYLE = { fontSize: 9, lineHeight: 12, fontWeight: '900' as const, letterSpacing: 0.6, color: colors.inkMuted, marginBottom: 2 };
      ```
   c. In the non-missing body, between the icon Text (`:104-106`) and the question Text (`:107-109`):
      ```tsx
                {item.isMcq ? (
                  <Text style={KIND_MARK_STYLE} numberOfLines={1} testID={`library-card-kind-${item.stableUid}`}>
                    {MCQ_COPY.faceMark}
                  </Text>
                ) : null}
      ```
      The missing branch (`:96-101`), the question's `numberOfLines={2}` and the hidden status probe (`:113-123`) are untouched.

7. **`mobile/src/screens/LibraryScreen.tsx`** — import `import { getFeatureFlags } from '../config/featureFlags';` after `:16`, and in the `buildLibraryVM` call (`:167-176`) add `mcqEnabled: getFeatureFlags().mcq.enabled,` after `topicFilter,` (`:175`). The `useMemo` deps (`:177`) do not change (a flag never flips mid-session). Nothing else in the screen.

8. **`mobile/tests/unit/libraryTopics.test.ts`** — exactly two lines change (`:234-235`): `expect(rowKeys.length).toBe(14);` → `expect(rowKeys.length).toBe(15);` and `expect(rowKeys.slice(-3)).toEqual(['isUpdated', 'topic', 'rank']);` → `expect(rowKeys.slice(-4)).toEqual(['isUpdated', 'topic', 'rank', 'isMcq']);`. Numstat `2	2`; the `it` title at `:231` stays.

9. **`mobile/tests/unit/libraryCardTile.test.tsx`** — `baseRow` (`:40-57`) gains `isMcq: false,` directly after `topic: null,` (`:56`). Numstat `1	0`.

10. **`mobile/tests/unit/drawCommitFaces.test.ts` (new)** — copy the harness of `drawAtomicity.test.ts:1-60` (`store` Map, the AsyncStorage mock, `SLUG` / `SCOPE`, the `deckRepository` and `review/storage` mocks) and `:62-68`, `:78` (`commitDraw`, `invalidateDrawStateCache`, `STATE_KEY`); `beforeEach` clears `store`, calls `invalidateDrawStateCache()` and seeds `store.set(STATE_KEY, JSON.stringify({ owned: [], pity: { draws: 0, threshold: 10 } }))`; `afterEach(() => applyRemoteFeatures(null))` (`import { applyRemoteFeatures } from '../../src/config/featureFlags'`). Fixtures: `PLAN_CARD_1_MCQ` = plan §4.3 card 1 as the PG-ordered blob `{ v: 1, options: [{ key, why, text, correct }…], shuffle: true, qualifier: 'LEAST operational overhead' }` (a, c, d wrong with their WHY, b correct with `why: null`; each text is the card's lines joined by a space) and `PLAN_CARD_2_MCQ` (a, c correct, b, d, e wrong, `qualifier: null`). Deck: `c1 { Topic: 'IAM' }`, `c2 { Topic: 'Compute', Mcq: PLAN_CARD_1_MCQ }`, `c3 { Mcq: PLAN_CARD_2_MCQ }` (no `Topic` key), `c4 { Topic: '   ', Mcq: { v: 2 } }`, difficulties 1/2/3/1, `OrderInDeck` 1–4. `commitDraw(SLUG, 10)` returns all four. Cases, titles verbatim:
    1. `it('tags drawn cards with topic and kind', …)` — by uid: c1 `tag === 'IAM'`, `'kind' in c1 === false`, `'requiredCount' in c1 === false`; c2 `tag === 'Compute'`, `kind === 'mcq'`, `requiredCount === 1`, `Object.keys(c2)` `toEqual(['stableUid', 'question', 'difficulty', 'rarity', 'rank', 'tag', 'kind', 'requiredCount'])`; c3 `'tag' in c3 === false`, `kind === 'mcq'`, `requiredCount === 2`; c4 `'tag' in c4 === false` (blank topic), `'kind' in c4 === false` (garbage blob); no card has an `options`, `Mcq`, `why` or `qualifier` key.
    2. `it('drops the kind under the kill switch and keeps the tag', …)` — `applyRemoteFeatures({ features: { mcq: { enabled: false } } })` before the commit: c2 `tag === 'Compute'`, `'kind' in c2 === false`, `'requiredCount' in c2 === false`; c3 has no `kind`.

11. **`mobile/tests/integration/draw-result-kind.screen.test.tsx` (new)** — copy `draw-result.screen.test.tsx:1-130` verbatim (all mocks, `DRAW_RESULT_FIXTURE`, `makeParams`, `flush`, `collectText`, `beforeEach`). Cases, titles verbatim:
    1. `it('marks the featured MCQ card and leaves Q/A cards alone', …)` — cards `[{ stableUid: '1', question: 'Q1', difficulty: 3, rarity: 'LEG', tag: 'Core', kind: 'mcq', requiredCount: 2 }, { stableUid: '2', question: 'Q2', difficulty: 2, rarity: 'RAR' }]`: `findAllByProps({ testID: 'draw-result-featured-kind' })` has length 1; its `parent` is the `View` with `testID 'draw-result-featured-art-window'` (the way `:551`, `:570` locate them); its Text children `toEqual(['MC · pick 2'])`; the topic chip still reads `['Core']`; `draw-result-featured-question` keeps `numberOfLines === FEATURED_STEM_LINES`; the frame (`draw-result-featured-frame`) is still the last child of `screen-draw-result-featured-card`; `collectText(tree).match(/MC · pick 2/g)` has length 1 (no mark in the grid).
    2. `it('shows a plain MC mark for a single-answer card and nothing for Q/A', …)` — with `kind: 'mcq', requiredCount: 1` the node's Text children are `['MC']`; with the untouched `DRAW_RESULT_FIXTURE` (no `kind`) `findAllByProps({ testID: 'draw-result-featured-kind' })` has length 0.

12. **`mobile/tests/integration/card-detail-kind.screen.test.tsx` (new)** — harness: the `react-native` / `react-native-safe-area-context` / `expo-linear-gradient` mocks of `plan-library-deep-polish.screen.test.tsx:5-24`, plus `vi.mock('../../src/content/activeDeck', () => ({ loadActiveDeckSlug: vi.fn(async () => 'aws') }))`, `vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => DECK) }))`, `vi.mock('../../src/review/storage', () => ({ loadDeckProgress: vi.fn(async () => []) }))`, and a `let ownedFixture: Set<string> | null` behind `vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({ resolveEffectiveOwned: vi.fn(async () => ownedFixture) }))`; `flush` / `textBlob` / `renderScreen` as `owned-gate-entry-points.spec.tsx:220-253`; `afterEach(() => applyRemoteFeatures(null))`. `DECK` = `{ Slug: 'aws', Title: 'AWS', Locale: 'en-US', Version: '1', DeckType: 1, TotalCards: 3, Cards: [{ StableUid: 'one', OrderInDeck: 1, Difficulty: 2, Question: 'Q one', Mcq: PLAN_CARD_1_MCQ }, { StableUid: 'two', OrderInDeck: 2, Difficulty: 3, Question: 'Q two', Mcq: PLAN_CARD_2_MCQ }, { StableUid: 'qa', OrderInDeck: 3, Difficulty: 1, Question: 'Q plain' }] }` (the same two blobs as change 10). Cases, titles verbatim:
    1. `it('shows the multiple-choice chip and never the options', …)` — `ownedFixture = new Set(['one', 'two', 'qa'])`: card `one` → the node with `testID 'card-detail-kind-chip'` exists and its Text children are `['Multiple choice']`; card `two` → `['Multiple choice · pick 2']`; both blobs contain `'Q one'` / `'Q two'` and none of `'Amazon SQS standard queue'`, `'Vertical scaling'`, `'Object Lock'`, `'Transfer Acceleration'`, `'WHY'`.
    2. `it('hides the chip on Q/A, locked and kill-switched cards', …)` — card `qa` → no chip node; `ownedFixture = new Set(['two'])` + card `one` → no chip node and the blob contains `'Not in your collection'`; `applyRemoteFeatures({ features: { mcq: { enabled: false } } })` with everything owned + card `one` → no chip node while the blob still contains `'Q one'`.

13. **`mobile/tests/unit/libraryMcqMark.test.tsx` (new)** — harness of `libraryCardTile.test.tsx:1-27` (mocks + imports) plus `buildLibraryCardRows` from `../../src/features/gacha/library/libraryMapper`, `applyRemoteFeatures`, the two blobs, and a `baseRow` copied from `libraryCardTile.test.tsx:40-58` (with `isMcq: false`). Deck (`as any`): `'1' { Mcq: PLAN_CARD_1_MCQ }`, `'2'` (no Mcq), `'3' { Mcq: { v: 2 } }`, `NOW` fixed, `progress: []`. Cases, titles verbatim:
    1. `it('marks MCQ tiles and clears the mark under the kill switch', …)` — `rows.map((r) => r.isMcq)` `toEqual([true, false, false])`; `buildLibraryCardRows({ …, mcqEnabled: false })` → `[false, false, false]`; `Object.keys(rows[0]).length === 15` and `.slice(-4)` `toEqual(['isUpdated', 'topic', 'rank', 'isMcq'])`; rendering `<LibraryCardTile item={{ ...baseRow, isMcq: true }} numColumns={2} highlighted={false} deckSlug="csharp" onPress={…} />` yields a node `testID 'library-card-kind-card-1'` whose children are `'MC'`; with `isMcq: false` no such node.
    2. `it('keeps the mark off a missing tile', …)` — `{ ...baseRow, isMcq: true, isMissing: true, status: 'missing', statusLabel: 'Missing', badgeTone: 'missing' }` → no `library-card-kind-card-1` node and the question text is not rendered (the existing `?` branch).

### Console

14. **`frontend/src/lib/mcqWarnings.ts` (new, pure)** — exactly this API (D00 §2.6.2 plus the helpers this brief pins):
    ```ts
    import type { McqBlob } from '../types/mcq';

    export type McqWarningCode =
      | 'MCQ_WARN_CORRECT_LONGEST'
      | 'MCQ_WARN_WHY_SHORT'
      | 'MCQ_WARN_STEM_LONG'
      | 'MCQ_WARN_FIRST_SENTENCE_LONG'
      | 'MCQ_WARN_SHAPE'
      | 'MCQ_WARN_NO_USAGE';

    export interface ImportWarning { code: McqWarningCode; severity: 'warning'; line: number; message: string; stableUid: string }
    export interface McqWarningInput { question: string; realWorldUsage: string | null; mcq: McqBlob }
    export type McqWarning = { code: McqWarningCode; message: string };

    export const MCQ_WARN_LONGEST_RATIO = 1.4;
    export const MCQ_WARN_WHY_MIN_CHARS = 40;
    export const MCQ_WARN_STEM_MAX_WORDS = 120;
    export const MCQ_WARN_FIRST_SENTENCE_MAX_CHARS = 140;
    export const MCQ_WARN_SHAPES: ReadonlyArray<readonly [number, number]> = [[1, 4], [2, 5], [3, 6]];

    /** Up to and including the first `.`, `?` or `!` followed by whitespace or the end; the whole trimmed stem when there is none. */
    export function firstSentence(question: string): string;
    /** Words = runs of non-whitespace in the trimmed text; '' → 0. */
    export function wordCount(text: string): number;
    /** Total: never throws, runs on cards the blocking rules refuse. Order of the result = the union above (WHY_SHORT once per option, in stored order). */
    export function warnMcq(card: McqWarningInput): McqWarning[];
    /** `line ${line}: ${message}` — the same shape as formatIssue. */
    export function formatWarning(w: Pick<ImportWarning, 'line' | 'message'>): string;
    /** Stable: by line, then code (string order), then original index. */
    export function sortWarnings(warnings: readonly ImportWarning[]): ImportWarning[];
    ```
    Rules (`len = text.trim().length`, `correct = options.filter(o => o.correct === true)`, `wrong = the rest`, `options = Array.isArray(mcq.options) ? mcq.options : []`):
    - `MCQ_WARN_CORRECT_LONGEST` — once per card when `wrong.length > 0`, `median(wrong lens) > 0` and some correct option has `len >= 1.4 × median` (first such option in stored order names the message). Message: `` `Correct option "${key}" is ${len} characters, at least 1.4x the median wrong option (${median}); the longest answer gives itself away.` ``
    - `MCQ_WARN_WHY_SHORT` — per option whose `why` is a string with `len(why) < 40`. `` `WHY for option "${key}" is ${len} characters; under 40 it rarely explains the trap.` ``
    - `MCQ_WARN_STEM_LONG` — `wordCount(question) > 120`. `` `Question is ${words} words; over 120 the stem stops being a scenario and becomes a reading test.` ``
    - `MCQ_WARN_FIRST_SENTENCE_LONG` — `firstSentence(question).length > 140`. `` `First sentence is ${chars} characters; card faces clip after about 140, so lead with the point.` ``
    - `MCQ_WARN_SHAPE` — `(correct.length, options.length)` not in `MCQ_WARN_SHAPES`. `` `${correct.length} correct of ${options.length} options; the exam shapes are 1 of 4, 2 of 5 and 3 of 6.` ``
    - `MCQ_WARN_NO_USAGE` — `realWorldUsage === null || realWorldUsage.trim() === ''`. `No USAGE: section; MCQ cards read better with a real-world line under the explanation.`
    Header comment: the non-blocking tier of plan §4.5; never enters `errors`, `planImport` or the gate.

15. **`frontend/src/lib/deckImport.ts`**
    a. Import after `:39`: `import { warnMcq, sortWarnings, type ImportWarning } from './mcqWarnings';`.
    b. `ParsedDeck` (`:93-98`): after `errors: ImportIssue[];` (`:97`) add `/** Non-blocking suggestions (mcqWarnings.ts). Never members of errors; the page and lint-deck print them, nothing gates on them. */` and `warnings: ImportWarning[];`.
    c. In `parseDeckMarkdown`, after `errors.push(...validateCards(cards));` (`:625`):
       ```ts
         const warnings: ImportWarning[] = [];
         for (const card of cards) {
           if (!card.mcq) continue;
           for (const w of warnMcq({ question: card.question, realWorldUsage: card.realWorldUsage, mcq: card.mcq })) {
             warnings.push({ code: w.code, severity: 'warning', line: card.sourceLine, message: w.message, stableUid: card.stableUid });
           }
         }

         return { deckSlug, cards, errors: sortIssues(errors), warnings: sortWarnings(warnings) };
       ```
       (the old return at `:627` is replaced by that line).
    d. The comment at `:704-706` becomes: `// Every MCQ issue blocks: planImport re-runs validateCards and turns any` / `// issue with a stableUid into an INVALID_CARD conflict, and the page blocks` / `// on parsed.errors. The non-blocking tier lives in mcqWarnings.ts and is` / `// collected by parseDeckMarkdown into ParsedDeck.warnings, never here.`
    e. `formatIssue` (`:909`) becomes `export function formatIssue(issue: Pick<ImportIssue, 'line' | 'message'>): string {` — body unchanged.
    `validateCards`, `planImport`, `COMPARABLE_FIELDS`, `fieldsThatDiffer`, `serializeDeckMarkdown`, `ImportIssueCode` are byte-identical.

16. **`frontend/src/pages/DeckImportPage.tsx`**
    a. Import: `import { formatWarning, type ImportWarning, type McqWarningCode } from '../lib/mcqWarnings';` after the `deckImport` import block (`:16-23`).
    b. A module-level helper beside `truncate` (`:49-52`), not exported:
       ```ts
       function groupWarnings(warnings: readonly ImportWarning[]): Array<[McqWarningCode, ImportWarning[]]> {
         const groups = new Map<McqWarningCode, ImportWarning[]>();
         for (const warning of warnings) {
           const bucket = groups.get(warning.code);
           if (bucket) bucket.push(warning);
           else groups.set(warning.code, [warning]);
         }
         return [...groups.entries()];
       }
       ```
    c. Directly after the error panel's `) : null}` (`:424`), still inside the `p-4 space-y-3` div and OUTSIDE the badge strip:
       ```tsx
                       {preview.parsed.warnings.length > 0 ? (
                         <div data-testid="import-warnings" className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded">
                           <div className="font-semibold text-sm mb-1">
                             {preview.parsed.warnings.length} suggestion
                             {preview.parsed.warnings.length === 1 ? '' : 's'} — not blocking
                           </div>
                           {groupWarnings(preview.parsed.warnings).map(([code, items]) => (
                             <div key={code} className="mt-1">
                               <div className="text-xs font-semibold">{code} ({items.length})</div>
                               <ul className="text-xs font-mono space-y-1 max-h-64 overflow-y-auto">
                                 {items.map((warning, i) => (
                                   <li key={`${warning.stableUid}-${warning.line}-${i}`}>{formatWarning(warning)}</li>
                                 ))}
                               </ul>
                             </div>
                           ))}
                         </div>
                       ) : null}
       ```
       `blocked` (`:224-230`), the five `<Badge>` lines (`:396-400`), the "problem(s)" heading (`:414-417`), the table and the runner call site are byte-identical. Nothing in the panel renders when `warnings.length === 0` (no empty `<ul>`, no `<li>`).

17. **`frontend/scripts/lint-deck.mts`**
    a. Type import: `import type { ImportWarning } from '../src/lib/mcqWarnings.ts';` after `:34`.
    b. `LintResult` (`:85-89`) gains `warnings: ImportWarning[];`; `lintText` (`:91-99`) returns `warnings: deck.warnings`.
    c. `main`: `const strict = argv.includes('--strict');` after the `paths` line (`:102`); after the issue lines (`:123-125`) print `` `${warning.line}: WARN ${warning.code} ${warning.message}\n` `` per warning; the summary (`:126`) becomes `` `${result.cards} cards, ${result.mcq} mcq, ${result.issues.length} issues, ${result.warnings.length} warnings\n` ``; `:127` becomes `if (result.issues.length > 0 || (strict && result.warnings.length > 0)) failed = true;`.
    d. Header comment `:11-13`: describe the `WARN` lines, the new summary and `--strict`.

18. **`frontend/tests/mcqWarnings.test.ts` (new)** — imports `warnMcq, formatWarning, sortWarnings, firstSentence, wordCount, MCQ_WARN_SHAPES, type McqWarningCode, type McqWarningInput` from `../src/lib/mcqWarnings`, `parseDeckMarkdown` from `../src/lib/deckImport`, `fc from 'fast-check'`, `type { McqBlob, McqOption }`; `MCQ_CARD_1` / `MCQ_CARD_2` copied from `deckImport.mcq.test.ts:32-112`. Helpers: `right(key, text)`, `wrong(key, text, why)`, `blob(options, qualifier = null): McqBlob`, and `WELL_SHAPED: McqWarningInput` = 1 correct + 3 wrong, every text `'x'.repeat(100)`, every WHY `'w'.repeat(60)`, question `'Short stem. And a second sentence.'`, usage `'Used at work.'` → `warnMcq(WELL_SHAPED)` is `[]`. Cases, titles verbatim:
    1. `it('fires each warning code once from a minimal positive case', …)` — a `Record<McqWarningCode, McqWarningInput>` built from `WELL_SHAPED` with one mutation each (correct text 140 chars; one WHY of 39 chars; a 121-word stem of single letters in sentences of 20 words; a first sentence of 141 chars then `' More.'`; five options with one correct; `realWorldUsage: null`) → every entry yields `codes === [code]`, and the messages contain the offending number (`'140'`, `'39'`, `'121'`, `'141'`, `'1 correct of 5'`, `'USAGE'`).
    2. `it('sits exactly on each threshold', …)` — 139 vs 140 chars against median 100; WHY 40 vs 39; 120 vs 121 words; 140 vs 141 chars; the smaller side is silent, the larger fires.
    3. `it('stays silent on a well-shaped card', …)` — `fc.assert(fc.property(…))` over `fc.record` of shape (`fc.constantFrom(...MCQ_WARN_SHAPES)`), wrong length 20–200, ratio 0.3–1.39 (`fc.double({ noNaN: true })`), WHY length 40–200, words 1–120 (sentences of at most 20 single-letter words), usage `fc.string({ minLength: 1 }).filter((s) => s.trim() !== '')` → `warnMcq(card)` `toEqual([])`; also `wordCount('')` is 0 and `firstSentence('No terminator here')` is the whole string.
    4. `it('flags every shape outside 1 of 4, 2 of 5 and 3 of 6', …)` — for `n` in 3..6 and `r` in 1..min(3, n−1), only the three table shapes are silent on `MCQ_WARN_SHAPE`.
    5. `it('never throws on a card the blocking rules would refuse', …)` — `options: []`, all options correct, empty texts, `why: ''`, and `{ ...WELL_SHAPED, mcq: { ...blob, options: 'x' as unknown as McqOption[] } }` → each returns an array (no throw); the all-correct card has no `MCQ_WARN_CORRECT_LONGEST`; `why: ''` yields `MCQ_WARN_WHY_SHORT`.
    6. `it('reports exactly the longest-correct suggestion on the plan card', …)` — `parseDeckMarkdown(['# deck: aws-associate-architect', '', MCQ_CARD_1].join('\n'))` → `errors` `[]` and `warnings` `toEqual([{ code: 'MCQ_WARN_CORRECT_LONGEST', severity: 'warning', line: cards[0].sourceLine, message: expect.stringContaining('"b"'), stableUid: 'aws-sqs-order-buffer-mcq-01' }])`; the two-card document → per card, codes `['MCQ_WARN_CORRECT_LONGEST']` and `['MCQ_WARN_CORRECT_LONGEST', 'MCQ_WARN_FIRST_SENTENCE_LONG', 'MCQ_WARN_NO_USAGE']`, `warnings` ascending by `line`; a Q/A-only document → `warnings` `toEqual([])`; `formatWarning({ line: 3, message: 'm' }) === 'line 3: m'`; `sortWarnings` orders `[line 9 code B, line 3 code B, line 3 code A]` as `[3 A, 3 B, 9 B]`.

19. **`frontend/tests/deckImportPageWarnings.test.tsx` (new)** — `// @vitest-environment jsdom`; harness of `deckImportPageRun.test.tsx:44-64` (imports, hoisted `api` mock, `DeckImportPage` import), `deck` (`:71-86`), `body(slug)` (`:88-105`), `sourceBox` / `importButton` / `badgeStrip` (`:207-226`), `toPreview` (`:240-252`), `beforeEach` / `afterEach` (`:254-265`); `MCQ_CARD_1` copied from `deckImport.mcq.test.ts:32-73`. Documents: `DOC_WARN_ONLY = ['# deck: csharp-backend-fundamentals', '', MCQ_CARD_1].join('\n')`, `DOC_CLEAN = body(DECK_SLUG)`, `DOC_WARN_AND_PROBLEM = DOC_WARN_ONLY + '\n\n## cs-c-003 | d1\nQ:\nGamma question\n'` (a card with no `A:`). Cases, titles verbatim:
    1. `it('lists suggestions below the errors without blocking the run', …)` — `toPreview(user, DOC_WARN_ONLY, [])`: the panel `screen.getByTestId('import-warnings')` exists; `screen.queryByText('1 suggestion — not blocking')` is not null; `within(panel).getByText('MCQ_WARN_CORRECT_LONGEST (1)')`; `within(panel).getAllByRole('listitem')` has length 1 and its text starts with `'line 3:'`; `badgeStrip('parse errors')` `toEqual(['1create', '0update', '0unchanged', '0conflict', '0parse errors'])`; `screen.queryByText(/problems? in the document/)` is null; `importButton().disabled === false`; the panel is not a child of the badge-strip div and follows it in document order (`strip.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING`).
    2. `it('renders no panel for a document without suggestions', …)` — `toPreview(user, DOC_CLEAN, [])` → `screen.queryByTestId('import-warnings')` is null and `screen.queryByText(/suggestion/)` is null.
    3. `it('keeps the problem count and the gate untouched beside suggestions', …)` — `toPreview(user, DOC_WARN_AND_PROBLEM, [])` → `'1 problem in the document'` present, `'1 suggestion — not blocking'` present, `importButton().disabled === true`, `badgeStrip('parse errors')[4] === '1parse errors'`.

Estimated size: drawCommit ~25 lines, types 6, DrawResultScreen ~25, CardDetailScreen ~20, libraryMapper ~8, LibraryCardTile ~10, LibraryScreen 2, test edits 3; mobile tests ~120 + ~90 + ~110 + ~80; mcqWarnings.ts ~90, deckImport ~14, DeckImportPage ~35, lint-deck ~10, frontend tests ~200 + ~110.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/D06.verify.sh` re-runs exactly these.

1. Scope files exist: `mcqWarnings.ts`, `drawCommitFaces.test.ts`, `draw-result-kind.screen.test.tsx`, `card-detail-kind.screen.test.tsx`, `libraryMcqMark.test.tsx`, `mcqWarnings.test.ts`, `deckImportPageWarnings.test.tsx`; D01/D02/D05 have landed (`mobile/src/features/gacha/mcq/normalizeMcq.ts` exports `isMcqCard`, `mcqConstants.ts` has `faceMarkPick`, `navigation/types.ts` has `picks?: { landed: number; answered: number };`, `tests/integration/session-summary-picks.screen.test.tsx` exists).
2. Literal guards (all exit 0): `drawCommit.ts` has `tag?: string;`, `kind?: 'mcq';`, `requiredCount?: number;`, `getFeatureFlags()`, `resolveMcq(card, flags)`, `mcqRequiredCount(mcq)`, `normalizeTopic(card.Topic)`, `...(tag !== null ? { tag } : {}),`, `kind: 'mcq' as const`, the three imports, still `rank: ranks.get(card.StableUid) ?? 0,`, and no `.Mcq`; `types.ts` has `kind?: 'mcq';` and `requiredCount?: number;` exactly twice each and `tag?: string;` twice; `DrawResultScreen.tsx` has `testID="draw-result-featured-kind"`, `function cardKindText(`, `MCQ_COPY.faceMarkPick(`, `MCQ_COPY.faceMark`, `featuredKindChip`, the `mcqConstants` import, and still `testID="draw-result-featured-topic"`, `numberOfLines={FEATURED_STEM_LINES}`, `export const FEATURED_STEM_LINES = 6;`, `testID="draw-result-featured-serial"`, `styles.gridTag`; `CardDetailScreen.tsx` has `testID="card-detail-kind-chip"`, `resolveMcq(card, getFeatureFlags())`, `MCQ_COPY.detailChipPick(`, `MCQ_COPY.detailChip`, `heroKindChip`, `!isLocked`, still `const tag = (card as any)?.Tag ?? deck?.Title ?? '';`, and no `Explanation` / `RealWorldUsage` / `.options` / `.Mcq`; `libraryMapper.ts` has `isMcq: boolean;`, `mcqEnabled?: boolean;` twice, `isMcq: mcqEnabled && normalizeMcq(card.Mcq) !== null,`, the exact `:213` line with `mcqEnabled`, the `normalizeMcq` import, exactly one `.Mcq`, and still `topic: normalizeTopic(card.Topic),`, `rank: ranks.get(card.StableUid) ?? 0,`, the six `filters` lines; `LibraryCardTile.tsx` has `` testID={`library-card-kind-${item.stableUid}`} ``, `item.isMcq`, `MCQ_COPY.faceMark`, `KIND_MARK_STYLE`, and still `numberOfLines={2}`, `` testID={`library-card-status-${item.stableUid}`} ``, no `StyleSheet`; `LibraryScreen.tsx` has `mcqEnabled: getFeatureFlags().mcq.enabled,`, the `featureFlags` import, and still `topicFilter,` and `keyExtractor={(item) => item.stableUid}`; `mcqWarnings.ts` has the six code literals, the `ImportWarning` line, `export function warnMcq(`, `formatWarning(`, `sortWarnings(`, `firstSentence(`, `wordCount(`, `MCQ_WARN_LONGEST_RATIO = 1.4`, imports only `from '../types/mcq'` (no `react`, `./cardRules`, `./deckImport`), no CJK; `deckImport.ts` has `warnings: ImportWarning[];`, `from './mcqWarnings'`, `warnMcq({`, `severity: 'warning'`, `warnings: sortWarnings(warnings) };`, `export function formatIssue(issue: Pick<ImportIssue, 'line' | 'message'>): string`, and no longer `There is no warning tier in Wave C`; `mcqRules.ts` still has no `MCQ_WARN`; `DeckImportPage.tsx` has `data-testid="import-warnings"`, `formatWarning(`, `groupWarnings(`, `not blocking`, `from '../lib/mcqWarnings'`, a `<Badge ` count of exactly 8 (five in the preview strip `:396-400`, three in the result step `:541-543` — no sixth badge anywhere), the five strip lines byte-identical, `if (preview.parsed.errors.length > 0) return true;`, `in the document`; `lint-deck.mts` has `WARN ${`, `--strict`, `issues, ${result.warnings.length} warnings`; every `it('…'` title above in its file (≥ 2 / 2 / 2 / 2 / 6 / 3 `it(` blocks); the two mobile screen tests mock `deckRepository` / `activeDeck` or copy the draw-result harness; no `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in any new file or added line; the untouched suites listed under Constraints are zero-diff.
3. `cd mobile && npm run test:typecheck` — exit 0; `cd frontend && npm run lint && npm run build` — exit 0.
4. `cd mobile && npx vitest run tests/unit/drawCommitFaces.test.ts tests/integration/draw-result-kind.screen.test.tsx tests/integration/card-detail-kind.screen.test.tsx tests/unit/libraryMcqMark.test.tsx tests/unit/libraryTopics.test.ts tests/unit/libraryCardTile.test.tsx tests/integration/draw-result.screen.test.tsx tests/unit/drawAtomicity.test.ts tests/unit/draw.test.ts tests/unit/library.test.ts tests/unit/ownedGatePredicates.test.ts tests/unit/cardRank.test.ts tests/integration/library.screen.test.tsx tests/integration/library-final.screen.test.tsx tests/integration/library-360-columns.spec.tsx tests/integration/owned-gate-entry-points.spec.tsx tests/integration/plan-library-deep-polish.screen.test.tsx tests/integration/draw.screen.test.tsx --reporter=dot` — exit 0; `cd frontend && npx vitest run tests/mcqWarnings.test.ts tests/deckImportPageWarnings.test.tsx tests/deckImport.test.ts tests/deckImport.mcq.test.ts tests/deckImport.topic.test.ts tests/deckImportPageRun.test.tsx tests/deckImportPageSource.test.tsx tests/deckImportRunner.test.ts tests/cardMcqConsole.test.tsx tests/cardRulesWiring.test.ts tests/uiLanguage.test.ts --reporter=dot` — exit 0; `node frontend/scripts/lint-deck.mts <the two plan cards under a "# deck:" header>` prints `4: WARN MCQ_WARN_CORRECT_LONGEST …`, `45: WARN MCQ_WARN_NO_USAGE …` and `2 cards, 2 mcq, 0 issues, 4 warnings` with exit 0, and exits 1 with `--strict`.
5. Scope + frozen + OTA guard: `git diff --quiet <merge-base> -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts` and the do-not-touch set above; `git diff --quiet <merge-base> -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json frontend/package.json frontend/package-lock.json`; `"expo-updates": "~29.0.15"`, `"version": "1.6.0"`, `"vite": "7.2.4"` unchanged; no `@sentry` under `mobile/src`; `libraryTopics.test.ts` numstat `2	2` with exactly the four pinned ± lines; `libraryCardTile.test.tsx` numstat `1	0` with the single `+` line `isMcq: false,` directly after `topic: null,`; `grep -rl '\.Mcq' mobile/src` prints nothing outside `types/deckExport.ts`, `content/deckRepository.ts`, `features/gacha/mcq/normalizeMcq.ts`, `features/gacha/library/libraryMapper.ts`, `features/gacha/planner/sessionPlanner.ts`; no `+` line in a mobile scope file contains `from 'react-native'`, `Platform`, `AccessibilityInfo`, `Vibration`, `expo-haptics`, `expo-updates`; every changed or untracked path under `mobile/src`, `mobile/tests`, `frontend/src`, `frontend/tests`, `frontend/scripts` is one of the 19 scope files (or `docs/delivery/r16-issues/*`); no top-level `docs/*.md` changed.

## Verify

```bash
BASE=delivery/r16-d-mcq bash docs/delivery/r16-issues/D06.verify.sh
```

Runs steps 1–5 above (≈ 2–3 min; mobile `tsc` and the frontend build dominate; no network). The driver then runs both root gates — `cd mobile && npm run test:typecheck && npx vitest run` and `cd frontend && npm run lint && npx vitest run && npm run build` — plus the diff-scoped banned-term grep and the suppression scan; all must be green, so do not leave any other suite red.

## Do NOT

- Do NOT put option text, keys, WHYs, `Explanation` or `RealWorldUsage` on `DrawnCardVm`, `LibraryCardRow`, the route params or any face; do NOT render a mark on the ceremony face or in the DrawResult grid rows.
- Do NOT write "Choice · pick 2" into `tag` (plan §6.8 is superseded by D00 §6 #10); `tag` is the topic label and nothing else.
- Do NOT spell `.Mcq` outside `libraryMapper.ts`'s single `normalizeMcq(card.Mcq)`; do NOT call `normalizeMcq` on a card in a screen — screens use `resolveMcq(card, getFeatureFlags())`.
- Do NOT read `useFeatureFlags()` as live policy, add a `useMemo` dependency on flags, or edit `featureFlags.ts` / `remoteConfig.ts`.
- Do NOT add a key to `libraryScreenStyles.ts` or `drawResultStyles.ts`, import `StyleSheet` into `LibraryCardTile.tsx`, or add a `react-native` named import anywhere.
- Do NOT add a warning code to `McqIssueCode` / `ImportIssueCode`, push a warning into `errors`, touch `planImport` / `validateCards` / `deckImportRunner.ts`, change `blocked`, add a sixth `<Badge>`, change the "problem(s)" heading, or add a table column.
- Do NOT make "zero warnings on the live decks" a test or a gate (D00 §6 #14); do NOT change the plan's thresholds.
- Do NOT edit any existing test beyond the two pinned lines + one pinned line; do NOT loosen `tsconfig`; do NOT run `npm install`, `npm ci`, `eas …`, `npx expo …`.
- Do NOT run npm or git inside `/Users/qc/src/recallsmith` or anywhere under `/Users/qc/Desktop` — only inside your worktree.
