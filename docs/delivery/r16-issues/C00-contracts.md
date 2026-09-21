# C00 — Wave C shared contracts (`r16-c-economy`)

The interface contract every Wave C brief (C01–C15) must follow verbatim so that fifteen independently implemented issues assemble into one OTA (mobile), one Lambda deploy (server), one console deploy and one Snowflake re-run. When a brief and this file disagree, this file wins; when this file and a plan doc disagree, the resolution is recorded in §6 and this file wins. Base: `delivery/r16-c-economy` (== `main@52594fe` after Waves A and B). Every line number below was read on that tree on 2026-09-21; the plan docs were written 2026-09-18/19 against an older tree and their line numbers are only trusted where this file repeats them.

Sources: `docs/delivery-wave-1.6-plan-2026-09-19.md:101-121` (Wave C table), `:121` (owner's post-wave list), `:136` (owner-only list); `docs/economy-v2-learn-to-earn-2026-09-19.md` (whole; §2 R1–R10 at `:24-35`, §3 at `:39-45`, §5 at `:54-60`, §6 at `:62-66`); `docs/mcq-card-type-plan-2026-09-18.md` §3 (`:62-152`), §4 (`:154-274`), §5.8 (`:325-327`), §7 (`:372-379`), §8 (`:381-395`), §9 + 改动清单 (`:397-431`); `docs/home-review-and-launch-copy-2026-09-17.md:56-58` (F9/F10/F11). Wave A and B briefs are the format precedent (`docs/delivery/r16-issues/B00-contracts.md`).

---

## 0. Non-negotiables

- **Signed by owner instruction 2026-09-21 「开始 Wave C」 — C00 §0 records it; the checkbox edit in economy-v2 §6 lands in the wave setup commit.** The three `[x]` at `docs/economy-v2-learn-to-earn-2026-09-19.md:64-66` and the status line at `:3` are that edit; no brief re-asks for a signature, and no brief may claim a fourth exception.
- **OTA-only on runtimeVersion 1.6.0.** `mobile/app.json:7` is `"version": "1.6.0"`, `:46-48` is `"runtimeVersion": { "policy": "appVersion" }`, `mobile/package.json:43` is `"expo-updates": "~29.0.15"` (installed 29.0.15). Therefore no issue may change `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, or add/remove any native module. Pure JS/TS under `mobile/src` and `mobile/tests` only. Every mobile verify greps `"expo-updates": "~29.0.15"` and `"version": "1.6.0"` unchanged, and `git diff --quiet "$MB" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json`.
- **Frozen files** (`mobile/gacha-v7.md:83-88`, narrowed by the wave to three files): `mobile/src/content/deckRepository.ts` (blob `1372a606`, 1703 lines), `mobile/src/sync/progressSync.ts` (blob `7393f532`, 1868 lines), `mobile/src/review/model.ts` (blob `ed210c33`, 225 lines). Exactly two signed exceptions (economy-v2 `:66`):
  1. **C07 — `deckRepository.ts`: exactly one added line per install mapper, two lines total.** Mapper 1 `mapRawDeckV1ToDeckExport` (`:1586-1644`, card literal `:1612-1625`), mapper 2 `mapRawDeckFlatToDeckExport` (`:1646-1703`, literal `:1671-1684`). The line is inserted immediately after `OrderInDeck: order,` (`:1620` and `:1679` on the base) and reads, byte for byte, `      Topic: typeof (c as any).topic === 'string' ? (c as any).topic : null,` (6-space indent). The cast is load-bearing: the raw card types (`:396-408`, `:419-431`) have no `topic` key and `mobile/tsconfig.json` typechecks with `strict: true`, so `c.topic` is TS2339. Guard: `git diff --numstat "$MB" HEAD -- mobile/src/content/deckRepository.ts` prints `2	0	…` and `git diff -U0 "$MB" HEAD -- mobile/src/content/deckRepository.ts | grep '^+' | grep -v '^+++'` prints that line twice and nothing else.
  2. **C14 — `progressSync.ts`: only the two optional envelope fields `clientFeatures` and `updateId`**, implemented as exactly four added lines and zero removed (§2.13): one import, one `const caps = await getClientCapabilities();`, and the two field lines under `clientVersion: getClientVersion(),` (`:1497`). Guard: numstat `4	0`, each `+` line matches its regex in §2.13.
  Every other issue keeps `git diff --quiet "$MB" HEAD -- <the three files>`; `model.ts` is zero-diff in every issue including C07 and C14.
- **Economy rules are R1–R10 of economy-v2 §2 and invariant 4' of §3, nothing else.** No issue may add a rule, a threshold or a copy line that states a rule not in that table. In particular: pulls are never sold, rarity = difficulty, pool = unowned, pity Rare+ at 10, one hard/good/easy keeps the streak, Mastered = stage ≥ 4 (`mobile/src/features/gacha/constants.ts:11`), sessions stay ≤ 5 cards (`:7`). Economy-v2 supersedes `docs/gacha-acquisition-learning-loop-plan.md` 裁决 6 (`:29`) and 不变量 4 (`:384`) and `mobile/gacha-v7.md` §2.2 bullet "Free pull cap：30 主钱包 + 5 reserve" (`:98`); C15 adds the pointer lines, nobody rewrites the history.
- **Migrations: `018_cards_topic.sql` (C05) and `019_cards_mcq.sql` (C08).** Runner regex `^\d+_.+\.sql$`, ordinal sort, duplicate version throws (`src_C/Vpc/Db/Migrate.cs:23-48`). The MCQ plan's `018_cards_mcq.sql` is superseded (§6 #1); nobody creates a file by that name (it is registered as not-on-disk at `docs/mcq-card-type-plan-2026-09-18.md:499` and rule (b) of `frontend/tests/docsPaths.test.ts:169-184` would go red). Each file is one `alter table cards add column if not exists … null;` under a header comment in the style of `017_cards_keyset_index.sql:1-4`.
- **Byte-identical artifacts for decks with no topic and no mcq.** `deck.json`, chunks, `package.json` and delta patches are all serialized with `ContentJson.Options` (`src_C/Worker/Content/ContentJson.cs:11-15`: CamelCase, not indented, **no null-ignore**), so both new `CardExportData` properties carry `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` and the Worker mapper maps DB NULL to C# null (never `?? ""`). The golden `CardJson` at `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentSerializationContractTests.cs:28-29` stays byte-identical and its four existing consumers (`:31-36`, `:38-45`, `:47-78`, `:80-116`, `:118-135`, `:137-157`) are untouched. The owner's post-deploy check is "republish both live decks, diff everything except buildId/sha" (`docs/delivery-wave-1.6-plan-2026-09-19.md:121`).
- **No new `eventType`, no `schemaVersion` bumps.** Events stay `card_reviewed` / `schemaVersion: 1` / `schedulerVersion 'ladder-v1'` (`progressSync.ts:133`, `:935-936`); deck.json `version`, package `schemaVersion 1`, delta `schemaVersion 2`, manifest `schemaVersion 2` are unchanged (`src_C/Worker/Content/ContentModels.cs:24`, `:40`, `:65`). Manifest gains no key (MCQ plan §3.4).
- **Do-not-touch list.** Sentry (out of 1.6.0, B00 §0 — no `@sentry/*`, no `src/observability/`); Wave D's mobile MCQ UI (`McqExport`, `normalizeMcq`, `isMcqCard`, `mcqVerdict`, `McqReviewBody`, `renderAsMcq`, `kindHint`, `maxPerRun` rotation — none of it in Wave C; `mobile/src/config/featureFlags.ts` and `remoteConfig.ts` are not edited); manifest keys; `mobile/src/review/storage.ts` (on gacha-v7's frozen list, untouched by every issue: the progress whitelist `:151-189` stays, so the ledger of R5 lives in its own key, never on `CardProgress`); `mobile/tests/setup/*` and `mobile/vitest.config.ts`; `src_C/Vpc/Analytics/OutboxPublisher.cs`; `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs` and migration `010`'s snapshot table (Phase 5 = migration 020, not Wave C); `frontend/src/lib/cardRules.ts` (export list pinned by `frontend/tests/cardRulesWiring.test.ts:157-167`); `frontend/src/pages/` file set (`tests/consoleDirectoryLayout.test.ts:97`); `frontend/src/hooks/` barrel (`tests/hookWiring.test.ts`); `docs/home-review-and-launch-copy-2026-09-17.md:407` (holds the sixth banned term inside the red-line table — C15 edits `:413` and never rewrites the hunk that contains `:407`).
- Banned in any added line under `mobile/src`, `frontend/src`, `src_C/Vpc`, `src_C/Worker` (driver grep, case-insensitive; the fourth term is anchored at a word start as in Wave B, so react-native-gesture-handler's host component name still passes): the six terms of B00 §0, which this file deliberately does not spell out. Use "work around", "sidestep", "sensor", "guard", "fallback", "probe". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` in any diff. Never copy ExamTopics / SAA-C03 dump content; the only MCQ example text any brief, test or fixture may quote is the two original cards at `docs/mcq-card-type-plan-2026-09-18.md:177-253` (§4.3, inside the fence `:172-254`).

---

## 1. File map

"C" = creates, "E" = edits, "D" = deletes, "L" = the signed line-budget exception. An editor of a file created by another issue lists the creator among its deps (§4). Paths are repo-relative. A file with two owners is serialised in the order shown in the "order" column; the later issue rebases on the earlier one's merge.

### 1.1 mobile

| Path | C01 | C02 | C03 | C04 | C07 | C14 | order / note |
|---|---|---|---|---|---|---|---|
| `mobile/src/features/gacha/constants.ts` | E (`:9` → 60) | | | E (append `SWEEP_SPREAD_DAYS`) | | | C01 → C04 |
| `mobile/src/features/gacha/rewards/rewardResolver.ts` | E (rewrite, §2.3) | | | | | | |
| `mobile/src/features/gacha/rewards/rewardWallet.ts` | E (add `grantPullsToStoredWallet`; nothing else moves) | | | | | | |
| `mobile/src/features/gacha/rewards/newCardLedger.ts` | C | | | | | | |
| `mobile/src/features/gacha/rewards/sessionRewards.ts` | C | | | | | | |
| `mobile/src/features/gacha/rewards/economyFloor.ts` | — (untouched, R3) | | | | | | |
| `mobile/src/features/gacha/session/sessionStore.ts` | E (§2.4) | | | | | | |
| `mobile/src/features/gacha/session/summaryMapper.ts` | E (§2.4) | | | | | | |
| `mobile/src/features/gacha/draw/drawState.ts` | E (`:60` literal 30 → `FREE_PULL_CAP`; `:84-85` copy) | | | | | | |
| `mobile/src/sync/drawStateSync.ts` | E (`:250-252` + third adoption step) | | | | | | not frozen (A08 precedent) |
| `mobile/src/screens/DebugMenuScreen.tsx` | E (`:32-33`, `:149`, `:154` → 60/5) | | | | | | |
| `mobile/src/navigation/types.ts` | E (`SessionSummary.reward?`) | | | E (`StudyMode` + `'sweep'`, `:2`) | | | C01 → C04 |
| `mobile/src/screens/SessionSummaryScreen.tsx` | E (§2.4) | | | | | | |
| `mobile/src/screens/SessionCardScreen.tsx` | E (pay hook in `handleRating`; stake pill + `computeSessionRewardPulls` removed) | E (forecast line) | | E (sweep) | | | C01 → C02 → C04 |
| `mobile/src/features/gacha/planner/sessionBuilder.ts` | | E (`:41-44`, `:47`) | | E (`buildSweepRoute`) | | | C02 → C04 |
| `mobile/src/features/gacha/planner/loadForecast.ts` | | C | | | | | |
| `mobile/src/features/gacha/planner/sessionPlanner.ts` | | | | E (`pickSweep`, `planChallengeRoute.mode`) | | | |
| `mobile/src/features/gacha/session/sessionReviewHelpers.ts` | | | | E (`:21-25`, `:51`) | | | |
| `mobile/src/features/gacha/contracts.ts` | | | E (`DeckSummary.masteredCount?`) | E (`ChallengeRoute.mode`, `:68`) | | | C03 → C04 |
| `mobile/src/features/gacha/selectors/homeSelectors.ts` | | | E (§2.6; also the preview formula `:114-124`) | | | | C02 does NOT touch it (§6 #7) |
| `mobile/src/features/gacha/home/deckActionResolver.ts` | | | E (`masteredCount`, next to `:246`) | | | | |
| `mobile/src/screens/HomeScreen.tsx` | | | E (`:516-524` kicker, `:552-558` mastered) | | | | only C03 |
| `mobile/src/content/faq.ts` | | | E (`:14`, `:18`) | | | | |
| `mobile/src/features/gacha/library/libraryMapper.ts` | | | | | E (§2.8.3) | | |
| `mobile/src/features/gacha/library/LibraryHeader.tsx` | | | | E (sweep CTA) | E (topic chips) | | C07 → C04 |
| `mobile/src/features/gacha/library/topics.ts` | | | | | C | | |
| `mobile/src/screens/LibraryScreen.tsx` | | | | E (`onStartSweep`) | E (`topicFilter` state) | | C07 → C04 |
| `mobile/src/types/deckExport.ts` | | | | | E (`Topic?`) | | |
| `mobile/src/content/deckRepository.ts` | | | | | L (2 lines) | | frozen |
| `mobile/src/sync/clientCapabilities.ts` | | | | | | C | |
| `mobile/src/sync/progressSync.ts` | | | | | | L (4 lines) | frozen |

Tests (mobile) — creates: C01 `tests/unit/newCardLedger.test.ts`, `tests/unit/sessionRewards.test.ts`, `tests/unit/rewardOutcome.test.ts`; C02 `tests/unit/loadForecast.test.ts`; C03 `tests/unit/homeBatch3.spec.ts`; C04 `tests/unit/sweepPlanner.test.ts`; C07 `tests/unit/libraryTopics.test.ts`, `tests/unit/deckRepositoryTopic.test.ts`; C14 `tests/unit/clientCapabilities.test.ts`, `tests/unit/progressSyncEnvelopeBytes.test.ts`. Edits are enumerated in §3.

### 1.2 server (`src_C`)

| Path | C05 | C08 | C09 | C10 | C13 | C14 | order / note |
|---|---|---|---|---|---|---|---|
| `src_C/Vpc/Db/Migrations/018_cards_topic.sql` | C | | | | | | |
| `src_C/Vpc/Db/Migrations/019_cards_mcq.sql` | | C | | | | | |
| `src_C/Vpc/Authoring/Cards.cs` | E (topic in GET/POST/PUT) | E (mcq, gates, `JsonbCell`) | | | | | C05 → C08 |
| `src_C/Vpc/Authoring/Helpers.cs` | E (`ParseOptionalTopic`) | E (`UpdateField.Cast`, `JsonbElement`/`JsonbCell`) | | | | | C05 → C08 |
| `src_C/Vpc/Authoring/McqValidation.cs` | | C | | | | | |
| `src_C/Vpc/Authoring/CardsPage.cs` | E (`:129-147` + `c.topic`) | | E (+ `c.mcq`, `JsonbCell`) | | | | C05 → C09 |
| `src_C/Vpc/Authoring/Publish.cs` | E (`:154-168`, `:180-191` + topic) | | E (+ mcq, pre-enqueue gate) | | | | C05 → C09 |
| `src_C/Worker/S3/IS3DeckUploader.cs` | E (`Topic` after `:60`) | | E (`Mcq` after `Topic`) | | | | C05 → C09 |
| `src_C/Worker/Services/PublishJobProcessor.cs` | E (`:119-133` select, `:137-148` mapper) | | E (mcq + 42703 fallback, `LoadCardsAsync`) | | | | C05 → C09 |
| `src_C/Worker/Content/DeckDiff.cs` | E (`:17` comment, `:60-71` + Topic) | | E (+ `McqEquals`) | | | | C05 → C09 |
| `src_C/Worker/Services/ContentArtifactsGenerator.cs` | E (`:258-284`, `:296-307` + Topic) | | E (+ Mcq) | | | | C05 → C09 |
| `src_C/Vpc/Runtime/ProgressEvents.cs` | | | | E (`card_format`, 42703 retry) | | E (`client_features`, `update_id`) | C10 → C14 |
| `src_C/Vpc/Authoring/ContentIntelligence.cs` | | | | | E (§2.12) | | |
| `src_C/Tests/…/ContentSerializationContractTests.cs` | E (add-only) | | E (add-only) | | | | |
| `src_C/Tests/…/DeckDiffTests.cs` | E (add-only) | | E (add-only) | | | | |
| `src_C/Tests/…/CardsAuthoringTopicTests.cs` | C | | | | | | |
| `src_C/Tests/…/McqValidationTests.cs` | | C | | | | | pure, no DB |
| `src_C/Tests/…/CardsAuthoringMcqTests.cs` | | C | | | | | `[Collection(PostgresCollection.Name)]` |
| `src_C/Tests/…/PublishMcqGateTests.cs`, `PublishJobProcessorSchemaTests.cs` | | | C | | | | |
| `src_C/Tests/…/ProgressEventsCardFormatTests.cs` | | | | C | | | |
| `src_C/Tests/…/ProgressEventsSingleStatementTests.cs` | | | | — | | E (`Batch()` gains `clientFeatures`/`updateId` params, `:64-80`) | C10 must NOT edit it (§6 #11) |
| `src_C/Tests/…/ContentIntelligenceMcqTests.cs`, `ProgressEventsClientFeaturesTests.cs` | | | | | C | C | |

### 1.3 console (`frontend`) and analytics/docs

| Path | C06 | C11 | C12 | C13 | order / note |
|---|---|---|---|---|---|
| `frontend/src/lib/deckImport.ts` | E (`TOPIC:`, `topic` in types/compare/serialize) | E (`OPT:`/`WHY:`/`QUALIFIER:`, `mcq`) | | | C06 → C11 |
| `frontend/src/lib/mcqRules.ts` | | C | | | |
| `frontend/src/types/mcq.ts` | | C (`McqBlob`, `McqOption`) | | | |
| `frontend/src/lib/deckImportRunner.ts` | E (`topic` params) | E (`mcq` params, readiness guard) | | | C06 → C11 |
| `frontend/src/types/card.ts` | E (`topic?`) | | E (`mcq?`) | | C06 → C12 |
| `frontend/src/api/authoring.ts` | E (`topic` in create/update) | | E (`mcq` in create/update) | E (`mcqCardCount?`) | C06 → C12 → C13 |
| `frontend/src/components/CardForm.tsx` | | | E (read-only MCQ panel) | | |
| `frontend/src/pages/CardListPage.tsx` | | | E (MCQ badge in the Rarity cell `:311-313`) | | |
| `frontend/src/pages/EditCardPage.tsx` | | | E (one prop line: `mcq={card.mcq ?? null}` on the `<CardForm/>` mount; `handleSubmit` untouched) | | C12 only (§2.11 requires it) |
| `frontend/src/pages/ContentIntelligencePage.tsx` | | | | E (banner between `:265` and `:267`) | |
| `frontend/tests/deckImport.topic.test.ts` | C | | | | |
| `frontend/tests/deckImport.mcq.test.ts` | | C | | | registered not-on-disk at `docs/delivery-wave-1.6-plan-2026-09-19.md:229` — **C11 deletes that bullet in the same PR** (§6 #12) |
| `frontend/tests/cardMcqConsole.test.tsx` | | | C | | |
| `frontend/tests/contentIntelligenceMcqBanner.test.tsx` | | | | C | |
| `snowflake/001_content_intelligence_setup.sql` | | | | E (§2.12) | only C13; C14 does not touch `snowflake/` (§6 #9) |
| `snowflake/README.md` | | | | E (one "re-run after editing" line + the new columns) | |
| `docs/delivery-wave-1.6-plan-2026-09-19.md` | | E (`:229` delete) | | | |

C15 (docs only): E `docs/content-delivery-v3.md`, `docs/console-import-plan.md`, `docs/mcq-card-type-plan-2026-09-18.md`, `docs/gacha-acquisition-learning-loop-plan.md`, `mobile/gacha-v7.md`, `docs/home-review-and-launch-copy-2026-09-17.md`, plus the one-line `:121` edit of `docs/delivery-wave-1.6-plan-2026-09-19.md` (§2.14 last bullet); nothing under `mobile/src`, `frontend/src`, `src_C`, `snowflake/*.sql`, and no other top-level `docs/*.md`.

Deviations from the wave table (`docs/delivery-wave-1.6-plan-2026-09-19.md:103-119`), all deliberate (reasons in §6): C01 edits `SessionCardScreen.tsx`, `drawState.ts`, `drawStateSync.ts`, `DebugMenuScreen.tsx`, `navigation/types.ts` (pay-point is per rating, §6 #2); C03 owns the Home route-preview formula (§6 #7); C04 enters from Library only (no `HomeScreen.tsx`, §6 #8); C11 edits the delivery plan's exemption block (§6 #12); C14 does not edit Snowflake (§6 #9); C13's Snowflake edit already keys `answer_mode` on `client_features` (§6 #9).

---

## 2. Exported APIs (signatures are verbatim contracts)

### 2.1 Caps and wallet (C01)

`mobile/src/features/gacha/constants.ts:9` becomes `export const FREE_PULL_CAP = 60;` — the only edit to that file by C01. `FREE_PULL_OVERFLOW_CAP = 5` (`:10`) is unchanged. `applyRewardToWallet` (`rewardWallet.ts:51-67`), `canAcceptMorePulls` (`:81-83`), `consumePullsFromWallet` (`:262-280`, `:270` reads the constant) and `adoptAnonRewardWallet` (`:208-260`) already read the constant and are not edited. `drawState.ts:60` `if (wallet.availablePulls >= 30 && wallet.reservePulls > 0)` becomes `>= FREE_PULL_CAP` (import from `../constants`). `DebugMenuScreen.tsx:32-33`, `:149`, `:154` say 60/5 (`saveRewardWalletState({ availablePulls: 60, reservePulls: 5 })`, `'Wallet seeded 60/5.'`, label `Seed wallet 60/5`).

New export, appended to `rewardWallet.ts` (nothing existing moves; `applySessionRewardToWallet` `:322-405` stays exported and untouched — three test files pin it, §3.1 — and simply has no app caller after C01):

```ts
/** Read → applyRewardToWallet → save. The single wallet write R1/R2 make; the ledger/marker
 *  write always precedes it (under-grant on a crash, same rationale as :375-394). */
export async function grantPullsToStoredWallet(count: number): Promise<{
  walletBefore: RewardWalletState;
  walletAfter: RewardWalletState;
  applied: AppliedRewardWalletState;
}>;
```

### 2.2 `mobile/src/features/gacha/rewards/newCardLedger.ts` (C01, R5)

Storage pattern: `economyFloor.ts:117-121` (scoped key + parse in try/catch); partition rule: `getUserScopedKey` from `mobile/src/review/storage.ts:79-81` (resolves to `devcards:u:{sub}:` / `devcards:u:anon:`, `drawStateStore.ts:29` `ANON_USER_SCOPE_PREFIX`).

```ts
import type { CardProgress } from '../../../review/model';

/** Base key; resolved key is getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`) →
 *  `devcards:u:{sub}:recallsmith:newCardPullPaidUids:<slug>`. The doc's literal
 *  `newCardPullPaidUids:<slug>` appears verbatim; the `recallsmith:` family prefix is the one every
 *  economy key carries (rewardWallet.ts:19-24, economyFloor.ts:25). */
export const NEW_CARD_LEDGER_PREFIX = 'recallsmith:newCardPullPaidUids:';

/** stableUid → paidAtMs. 0 = backfilled: the card was already learned when the ledger was first
 *  created on this partition, so it never pays (pre-OTA policy, §6 #3). */
export type NewCardLedger = Record<string, number>;

/** { ledger, present }. present=false when the key is absent. Throws on a storage error (callers
 *  fail closed). A corrupt value reads as { ledger: {}, present: true } (never re-seeded). */
export async function readNewCardLedger(slug: string): Promise<{ ledger: NewCardLedger; present: boolean }>;

/** present → returned unchanged. absent → written as { [uid]: 0 } for every entry of `progress`
 *  where isLearnedProgress (progressSelectors.ts:16-18), then returned. Throws on storage error. */
export async function seedNewCardLedgerIfAbsent(slug: string, progress: CardProgress[]): Promise<NewCardLedger>;

/** paid=false when the uid is already present (any value, including 0) or storage fails; otherwise
 *  writes ledger[uid] = nowMs FIRST and returns paid=true. Never throws. Does not seed. */
export async function payNewCardIfUnpaid(slug: string, stableUid: string, nowMs: number): Promise<{ paid: boolean; ledger: NewCardLedger }>;

/** Entries with paidAtMs > 0 whose local day (formatDateKey, model.ts:221-226) equals that of `now`. */
export function countPaidOnDay(ledger: NewCardLedger, now: Date): number;

/** R2 day marker (economyFloor pattern, :114-121): getUserScopedKey(DUE_CLEAR_MARKER_KEY) holds
 *  formatDateKey(now). Returns true and writes the marker only when it differs from today. Never throws
 *  (storage error → false). */
export const DUE_CLEAR_MARKER_KEY = 'recallsmith:due-clear:v1';
export async function markDueClearedIfFirstToday(now: Date): Promise<boolean>;

/** A08 mechanism (drawStateStore.ts:332, rewardWallet.ts:208): scans getAllKeys for
 *  `${ANON_USER_SCOPE_PREFIX}${NEW_CARD_LEDGER_PREFIX}`, unions each slug's anon ledger into the user
 *  ledger (user value wins on a uid present in both), writes the user ledger, then removes the anon key
 *  (copy-then-clear). No-op while signed out. Never throws. The R2 marker is NOT adopted (§6 #4). */
export type AnonLedgerAdoption = { ledgerDecks: number; uidsAdded: number };   // `ledgerDecks`, not `decks`: AnonDrawStateAdoption already has `decks` and the spread at drawStateSync.ts:252 would clobber it (C01 gap 1; drawStateAdoption.test.ts:54 ZERO gains `ledgerDecks: 0, uidsAdded: 0`)
export async function adoptAnonNewCardLedger(): Promise<AnonLedgerAdoption>;
```

`drawStateSync.ts:247-256` `adoptAnonGachaState` gains a third awaited step after `adoptAnonRewardWallet()` (`:251`): `const ledger = await adoptAnonNewCardLedger();` and spreads it into the result; `AnonGachaAdoption` (`:233`) becomes `AnonDrawStateAdoption & AnonWalletAdoption & AnonLedgerAdoption`. The coalescing `_adopting` (`:239`) and both callers (`:276`, `authStore.ts:124`) are unchanged.

### 2.3 `mobile/src/features/gacha/rewards/sessionRewards.ts` + `rewardResolver.ts` (C01, R1/R2/R8/R9)

The pay-point is **per rating**, inside `SessionCardScreen.handleRating` (`:396-512`), after `saveDeckProgress` (`:446`) and before `recordSessionRating` (`:461`) — never at the summary (§6 #2). `dueBefore` is the screen's existing `dueTodayCount` (`:384`, `countDueToday(progress, now, ownedSet)` over the pre-rating `progress`); `remainingDueCount` is `buildRatedSessionState(...).remainingDueCount` (`sessionReviewHelpers.ts:90`).

```ts
// sessionRewards.ts
import type { ReviewRating, CardProgress } from '../../../review/model';
import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';

export type RatingRewardInput = {
  slug: string;
  stableUid: string;
  rating: ReviewRating;
  /** The deck progress BEFORE this rating (seeds the ledger on first use, §2.2). */
  progressBefore: CardProgress[];
  /** false in sweep mode (R8): R1 is skipped, R2 is still evaluated. C01's caller passes true; C04 passes mode !== 'sweep'. */
  newCardEligible: boolean;
  /** countDueToday over progressBefore. */
  dueBefore: number;
  /** remainingDueCount after the rating. */
  remainingDueCount: number;
  now: Date;
};

export type RatingRewardStep = {
  newCardPaid: boolean;        // R1 fired for this uid
  dueClearPaid: boolean;       // R2 fired (dueBefore > 0 && remainingDueCount === 0 && first time today)
  pulls: number;               // Number(newCardPaid) + Number(dueClearPaid), 0..2
  walletBefore: RewardWalletState | null;   // null when pulls === 0
  walletAfter: RewardWalletState | null;
  applied: AppliedRewardWalletState | null;
  /** countPaidOnDay(ledger, now) for this slug AFTER the step (feeds R7 / C02). */
  newCardsLearnedToday: number;
};

/** Order: (1) seedNewCardLedgerIfAbsent(slug, progressBefore); (2) R1: newCardEligible && rating !== 'again'
 *  → payNewCardIfUnpaid; (3) R2: dueBefore > 0 && remainingDueCount === 0 → markDueClearedIfFirstToday;
 *  (4) pulls > 0 → grantPullsToStoredWallet(pulls). Ledger and marker land before the wallet. Never throws:
 *  a storage failure at (1) returns the zero step (no pay); at (4) the ledger/marker are already written and
 *  the step reports pulls with walletAfter === null (under-grant, never double-grant). */
export async function settleRatingReward(input: RatingRewardInput): Promise<RatingRewardStep>;
export const ZERO_REWARD_STEP: RatingRewardStep;
```

```ts
// rewardResolver.ts (rewrite; computeSessionRewardPulls is DELETED — R1 replaces it; §6 #2)
import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';
import type { RatingRewardStep } from './sessionRewards';

export type RewardOutcome = {
  newCardPulls: number;          // count of steps with newCardPaid
  newCardUids: string[];         // in pay order; length === newCardPulls
  dueClearPulls: 0 | 1;
  rewardPulls: number;           // newCardPulls + dueClearPulls
  applied: number;               // Σ appliedToAvailable + appliedToReserve
  dropped: number;               // Σ dropped (cap 60+5)
  walletBefore: RewardWalletState | null;   // first paying step's walletBefore
  walletAfter: RewardWalletState | null;    // last paying step's walletAfter
};
export const EMPTY_REWARD_OUTCOME: RewardOutcome;
export function accumulateRewardOutcome(prev: RewardOutcome, step: RatingRewardStep, stableUid: string): RewardOutcome;

/** Copy (economy-v2 §5):
 *  newCardPulls>0, dueClearPulls=0 → `+${n} pull${n===1?'':'s'} · ${n} new card${n===1?'':'s'} learned`
 *  newCardPulls=0, dueClearPulls=1 → `+1 · cleared today's due`
 *  both                            → `+${n+1} pulls · ${n} new card${n===1?'':'s'} learned · cleared today's due`
 *  none                            → COPY.reward.noPull ('No free pulls this run', summaryMapper.ts:22, unchanged) */
export function rewardLine(outcome: RewardOutcome): string;
/** `+${rewardPulls} pull${…}` or 'Progress saved' — same shape as COPY.reward.badge (summaryMapper.ts:20). */
export function rewardBadge(outcome: RewardOutcome): string;

export type ResolvedSessionReward = {
  rewardPulls: number;
  completedMinimumGoal: boolean;   // sessionDone >= max(1, minimumGoal)  (unchanged, :41)
  completedFullRun: boolean;       // sessionLimit > 0 && sessionDone >= sessionLimit (unchanged, :42) — titles only, never pulls
  walletAfter: AppliedRewardWalletState;
  rewardMessage: string;           // `${rewardLine(outcome)} · ${getRewardWalletMessage(walletAfter)}`
  outcome: RewardOutcome;
};
/** `reward` absent/null → EMPTY_REWARD_OUTCOME (the route-complete Continue path, SessionCardScreen.tsx:682-690,
 *  and tests/p2-smoke.ts:127-147, which must keep compiling). walletAfter = applyRewardToWallet(wallet, 0) merged with
 *  outcome.walletAfter when present. */
export function resolveSessionReward(params: {
  sessionDone: number; sessionLimit: number; minimumGoal: number;
  wallet: RewardWalletState;
  reward?: RewardOutcome | null;
}): ResolvedSessionReward;
```

Removed from `SessionCardScreen.tsx` by C01: the import at `:39`, `doneRewardPulls` (`:570-574`), `fullClearReward` (`:578-582`), `showFullClearStake` (`:588-592`) and the stake pill JSX (`:629-642`, testID `session-card-fullclear-stake` — no test pins it). Settlement navigation (`:481-495`, `:675-681`) passes `rewardPulls: outcome.rewardPulls`. The post-rating SessionSummary navigation (`:498-507`) passes `reward: outcome`; the route-complete Continue navigation (`:682-690`) passes NO `reward` key (it is the "reward absent" path of `resolveSessionReward`, and `tests/integration/session-card.screen.test.tsx:415-423` pins that literal — C01 gap 3). The awaited step is named `rewardStep` in C01's `handleRating` (this section calls the value `step`). R9 is a consequence: `rating` only decides *when* (`again` defers), never *whether*.

### 2.4 `sessionStore.ts`, `navigation/types.ts`, `SessionSummaryScreen.tsx`, `summaryMapper.ts` (C01)

```ts
// sessionStore.ts (:10-28 state, :30-39 emptyState)
rewardOutcome: RewardOutcome;                                   // EMPTY_REWARD_OUTCOME in emptyState; reset by startSession and resetSession
recordRewardStep: (step: RatingRewardStep, stableUid: string) => void;   // rewardOutcome = accumulateRewardOutcome(prev, step, stableUid)
```
The store is reset on `SessionCardScreen` unmount (`:136-140`), so the summary never reads it; the outcome travels as a **navigation param**:

```ts
// navigation/types.ts — SessionSummary (:186-195) gains ONE optional field, appended last:
reward?: RewardOutcome;
// Settlement (:137-143) is unchanged; rewardPulls receives outcome.rewardPulls.
```

`SessionSummaryScreen.tsx`: the settlement effect (`:57-99`) no longer calls `computeSessionRewardPulls` or `applySessionRewardToWallet`. With `sessionId`: `Promise.all([loadRewardWalletState(), applySessionStreak({ sessionId, earned: streakEarned })])`; `walletBeforeReward` = `reward?.walletBefore ?? loadedWallet`. Without `sessionId`: unchanged (`:80-87`). `buildSessionSummaryVM` is called with `reward: reward ?? null`. `earnedPulls` (`:163`) = `summary.resolvedReward.rewardPulls`; the gold CTA (`:218-240`, testID `summary-reward-use-pulls-cta`, label `Use ${n} new pull${…} now`) is unchanged.

`summaryMapper.ts`: `buildSessionSummaryVM(params)` (`:153-`) gains `reward?: RewardOutcome | null` and forwards it to `resolveSessionReward`. `COPY.reward.gained` (`:21`) is deleted; `rewardLine` (`:204`) = `rewardLine(outcome)`; `COPY.reward.badge` (`:20`) is kept and now receives `outcome.rewardPulls`; `legacyRewardBody` (`:206-211`) uses `rewardLine(outcome)` in place of `+N free pull(s) earned for this run.`; `COPY.reward.sectionFullClear: 'Full clear reward'` (`:17`) becomes `'Run reward'`; `COPY.progress.fullClearLabel` (`:28`) and the titles (`:8`, `:12`) are unchanged (a full run is still a full run; it just does not pay by itself). `vm.reward.walletBefore/After` (`:251-258`) read `outcome.walletBefore ?? wallet` / `resolvedReward.walletAfter`. `RewardSummaryCard.tsx` (`:8-23` props) is not edited.

### 2.5 `sessionBuilder.ts` + `mobile/src/features/gacha/planner/loadForecast.ts` (C02, R6/R7)

`buildChallengeRoute` (`sessionBuilder.ts:33-75`): `:41` (`effectiveNew`) is deleted; `:42-44` becomes

```ts
const limit = hasTodayWork ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dueCount + newCount)) : 1;
```
and `:47` becomes `const hasElite = dueCount >= 2 || newCount >= 1;`. `hasBoss` (`:46`), the node builder (`:49-58`), the summary string (`:60-62`, "fresh" wording stays) and the return shape (`:64-74`) are unchanged. Consequences pinned by tests (§3.1): due 3/new 2 → 5, due 1/new 2 → 3, due 2/new 2 → 4, due 1/new 1 → 2, **due 0/new 1 → 1** (the F10 dead end).

```ts
// loadForecast.ts (pure)
import type { CardProgress } from '../../../review/model';
import type { OwnedGate } from '../contracts';

export const FORECAST_START = 20;   // R7: from the 20th new card of the day
export const FORECAST_STEP = 10;    // … and every 10th after it

export type TomorrowLoad = {
  newCardsLearnedToday: number;
  /** buildUpcoming(progress, now, 2, ownedSet)[1].count (progressSelectors.ts:47-77) — cards whose next
   *  review lands on tomorrow's local day under the current ladder. */
  tomorrowDue: number;
  /** newCardsLearnedToday >= FORECAST_START && (newCardsLearnedToday - FORECAST_START) % FORECAST_STEP === 0 */
  milestone: boolean;
};
export function computeTomorrowLoad(input: {
  progress: CardProgress[]; now: Date; ownedSet?: OwnedGate; newCardsLearnedToday: number;
}): TomorrowLoad;

/** milestone ? `At this pace, about ${n} card${n === 1 ? ' comes' : 's come'} due tomorrow.` : null.
 *  One line, no dialog, never blocks the next card (R7 "不拦截"). */
export function forecastLine(load: TomorrowLoad): string | null;
```

`SessionCardScreen.tsx` (C02): after C01's step, `const line = forecastLine(computeTomorrowLoad({ progress: nextState.updatedProgress, now: nowAtRating, ownedSet, newCardsLearnedToday: step.newCardsLearnedToday }))`; screen state `const [loadForecast, setLoadForecast] = useState<string | null>(null);` (cleared on load) — NOT named `forecastLine`, which would shadow the imported function (C02); rendered as `<Text testID="session-card-load-forecast" numberOfLines={2} style={styles.forecastLine}>` directly under `<SessionProgressHeader vm={sessionVm} />` (`:643`), only when non-null. Nothing else in the screen.

### 2.6 Home F9 / F10 / F11 (C03) — `homeSelectors.ts`, `deckActionResolver.ts`, `contracts.ts`, `HomeScreen.tsx`, `faq.ts`

```ts
// contracts.ts — DeckSummary (:8-28) gains one optional field, appended after percent:
masteredCount?: number;          // countMastered = isMasteredProgress (progressSelectors.ts:28-30) over owned progress
// masteredApprox (:26) keeps meaning "learned" (pinned by tests/unit/homeOwnedGate.spec.ts:143) and still feeds percent.
```
`deckActionResolver.ts:228-248`: `masteredCount: progress.filter((p) => isOwned && isMasteredProgress(p)).length` next to `masteredApprox: learned` (`:246`); the two non-studiable branches (`:154`, `:187`) get `masteredCount: 0`. `TodayCounts.selectedMastered` (`homeSelectors.ts:180`) is **unchanged** — it renders under the label "Learned" (`TodayPressureCard.tsx:61-64`), which is what it counts (§6 #6).

```ts
// homeSelectors.ts
function buildDrawVM(wallet?: RewardWalletState | null, selectedDeck?: DeckSummary | null): HomeDrawVM;
//  wallet-full / reserve / available branches (:201-223) unchanged; `Wallet full (${FREE_PULL_CAP} + ${FREE_PULL_OVERFLOW_CAP})` follows the constant (→ "Wallet full (60 + 5)").
//  locked (:225-228), state stays 'locked', label:
//    selectedDeck?.canStudy && selectedDeck.dueToday + selectedDeck.newToday === 0 → 'No cards due · a free pull returns tomorrow'   (F10; economyFloor.ts:19 makes it true)
//    selectedDeck?.canStudy && selectedDeck.newToday === 0 && selectedDeck.dueToday > 0 → 'Clear today’s due cards to earn a pull'    (R2)
//    otherwise                                                                        → 'Learn a new card to earn a pull'               (R1; economy-v2 §5)
function buildHeroCopy(params: { statusKind: HomeCtaKind; selectedDeck: DeckSummary | null; counts: TodayCounts; hasSignedInUser: boolean; draw: HomeDrawVM }): { eyebrow; title; subtitle; helper };
//  today_done (:462-470): subtitle = draw.state === 'locked' ? 'Minimum goal done. Each new card you learn earns a pull.' : (unchanged :467)
//  today_full_clear (:471-477): subtitle = draw.state === 'locked' ? 'Route done. Learn a new card to earn your next pull.' : (unchanged :475)
//  default hasTodayWork subtitle (:516): `Each new card you learn earns a pull · up to ${SESSION_MAIN_ROUTE_DEFAULT} cards a run.`
//  wallet_full (:494-503) unchanged. buildHomeVM passes `draw` (:682-687) and `selectedDeck` into buildDrawVM (:639).
```
`buildRoutePreview` (`:114-124`) follows §2.5: `const total = Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, due + selectedDeck.newToday));` and `hasElite = due >= 2 || selectedDeck.newToday >= 1` (`fresh` deleted). `drawStatusLabel` (`:714-718`) is a legacy field rendered nowhere; unchanged (§6 #6).

`HomeScreen.tsx`: kicker (`:516-524`) gains, before `'All caught up for now'`, the F10 branch `selectedRow.canStudy && due === 0 && new === 0 && draw.state === 'locked' ? 'Caught up'`; `:552` reads `const masteredCount = (realRow.deck as any)?.masteredCount ?? 0;` and `:557-558` becomes `totalCards > 0 && masteredCount >= totalCards && dueCount === 0`. `'Mastered ✓'` (`:564`) and `'Deck mastered 🎉'` (`:603`) literals unchanged. `hero.subline` is not rendered by HomeScreen (F9 is VM-only; §6 #6).

`faq.ts:14` → `"Every new card you learn earns 1 pull the first time you rate it Hard or better, and clearing all of today's due cards earns 1 more, once a day. New accounts start with 3 starter pulls, and if you have no cards left to study and no pulls, a 1-pull daily floor keeps you going. Pulls are never sold."`; `:18` → `"Draw locks when you have no pulls to spend. Learn a new card to earn one, or wait for the daily floor pull if you have nothing left to study."`; the header comment `:1-7` names R1/R2 instead of "+1 pull per fully cleared review".

### 2.7 Sweep mode (C04, R8)

The fourth `StudyMode` value is `'sweep'`, added to exactly four unions: `navigation/types.ts:2`, `contracts.ts:68`, `sessionPlanner.ts:83`, `sessionReviewHelpers.ts:51`; `modeLabel` (`sessionReviewHelpers.ts:21-25`) returns `'Review all'` for it. `constants.ts` gains `export const SWEEP_SPREAD_DAYS = 7;` (appended).

```ts
// sessionPlanner.ts
// pickNextCard (:79-135): mode 'sweep' → pickSweep(): candidates = cards where owns(card) && isLearnedProgress(progressEntry)
//   && card.StableUid !== avoidUid, ordered by (progress.lastReviewedAt asc, card.OrderInDeck asc); falls back to ignoring
//   avoidUid like pickWith (:105-113); the due bucket is ignored. Returns null when nothing is learned.
export function planChallengeRoute(params: { deck: DeckExport; progress: CardProgress[]; now?: Date; ownedSet?: OwnedGate; mode?: StudyMode }): ChallengeRoute;
//   mode === 'sweep' → buildSweepRoute({ slug, deckTitle, learnedCount: countLearned(progress, ownedSet), dueCount, newCount }); otherwise unchanged (:143-152).
// sessionBuilder.ts
export function buildSweepRoute(params: { slug: string; deckTitle: string; learnedCount: number; dueCount: number; newCount: number }): ChallengeRoute;
//   dailyTarget = Math.ceil(learnedCount / SWEEP_SPREAD_DAYS); limit = Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dailyTarget));
//   mode: 'sweep'; minimumGoal: SESSION_MIN_GOAL; nodes: resolveRouteRole with hasElite=false, hasBoss=false;
//   summary: `${deckTitle} · ${learnedCount} learned card${…} · about ${dailyTarget} a day for ${SWEEP_SPREAD_DAYS} days`.
```

`SessionCardScreen.tsx` (C04): the three `planChallengeRoute` calls (`:321`, `:465`, `:569`) pass `mode`; the C01 pay hook receives `newCardEligible: mode !== 'sweep'` (R8: no R1; R2 still fires when the sweep happens to clear today's due); the C02 forecast line is skipped when `mode === 'sweep'`; the trial gate (`:309`, `:448`) is untouched (sweep only serves learned cards). Ratings reschedule exactly as in any mode (`scheduleNextReview` is untouched; `buildRatedSessionState` treats `'sweep'` like `'mixed'` for `pickNextCard`).

Entry point (Library only, §6 #8): `LibraryHeader.tsx` props gain `onStartSweep?: () => void; sweepCount?: number;` and render `<Pressable testID="library-sweep-cta" accessibilityRole="button" accessibilityLabel="Review all learned cards">` with text `Review all · ${sweepCount}` only when `onStartSweep && sweepCount > 0`; `LibraryScreen.tsx` passes `sweepCount={vm.counts.learningCount + vm.counts.masteredCount}` and `onStartSweep={() => navigation.navigate('SessionCard', { slug: vm.selectedDeckSlug, mode: 'sweep' })}`.

### 2.8 Topic (C05 server → C06 console → C07 mobile)

#### 2.8.1 Server (C05)

`018_cards_topic.sql`: `alter table cards add column if not exists topic text null;` (header comment: purpose, "one statement, runs inside Migrate.ApplyOne's transaction"). No index, no CHECK.

Every `cards` reader adds `topic` as the **last** column of its list: `Cards.cs:36-54` (`c.topic` after `c.updated_at as "updatedAt"`), `:147-162` and `:268-283` (`topic` after `updated_at as "updatedAt"`), `CardsPage.cs:129-147`, `Publish.cs:154-168` (+ `baseCards` anonymous object `:180-191` gains `topic = c.TryGetValue("topic", out var tp) ? tp as string : null` — explicit `null` in the preview JSON is accepted, §6 #13), `PublishJobProcessor.cs:119-133` (+ mapper `:137-148` `Topic = c.TryGetValue("topic", out var tp) ? tp as string : null` — **never** `?? string.Empty`).

```csharp
// Helpers.cs (C05)
/// absent / JSON null / blank → null; string → Trim(); > 80 chars → ValidationError("topic too long (max 80)");
/// any other ValueKind → ValidationError("topic must be a string").
public static string? ParseOptionalTopic(JsonElement body);          // reads body.topic (POST)
public static string? NormalizeTopic(JsonElement el);                // same rules for one element (PUT spec transform)
```
POST (`Cards.cs:97-193`): `topic` is `$12` in the INSERT (`:135-146`), column list `…, version, topic`. PUT spec (`:236-249`): `new("topic", "topic", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.NormalizeTopic(v))` after `revision`; editors keep it (`:251-255` unchanged). The wire key is `topic` in every response (`"topic": null` for untagged cards; the API is not byte-golden).

```csharp
// IS3DeckUploader.cs — CardExportData (:50-61): appended after Revision (:60); using System.Text.Json.Serialization; added at :1
[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
public string? Topic { get; set; }
// DeckDiff.CardChanged (:60-71): `|| !string.Equals(a.Topic, b.Topic, StringComparison.Ordinal)` appended; :17 comment "9" → "10" (C09 → "11")
// ContentArtifactsGenerator.cs — PreviousCardDocument (:296-307): `public string? Topic { get; set; }`; MapPreviousCards (:269-280): `Topic = c.Topic,`
```
Export JSON: `"topic"` is the **last** key of a card when present and absent when null: `{"stableUid":"u1",…,"revision":1,"topic":"t"}`.

#### 2.8.2 Console (C06)

```ts
// deckImport.ts
export interface DeckCardContent { …7 fields unchanged…; topic?: string; }      // ABSENT (not null) when the card has no TOPIC: line
export type ComparableField = … | 'realWorldUsage' | 'topic';                   // COMPARABLE_FIELDS (:518-526) appends 'topic' LAST
export type ImportIssueCode = … | 'TEXT_BEFORE_SECTION' | 'BAD_TOPIC' | 'DUPLICATE_TOPIC';
const TOPIC_MARKER = /^TOPIC:(.*)$/;   // column 0, loose match (§4.4 style); payload = trimmed remainder
export const TOPIC_MAX_LENGTH = 80;
// Lexer: TOPIC: is a single-line marker checked BEFORE Q: (:383); it does not open a section (currentSection stays as it was).
//   empty payload or > TOPIC_MAX_LENGTH → BAD_TOPIC (line, stableUid), card dropped like MISSING_QUESTION (:243);
//   second TOPIC: in one card → DUPLICATE_TOPIC, first wins, card kept.
// fieldsThatDiffer (:537-547): 'topic' compares normalizeText(card.topic) !== normalizeText(existing.topic) (server null == '' == absent).
// serializeDeckMarkdown (:655-679): `TOPIC: ${card.topic}` emitted immediately after the `## uid | dN` header and before `Q:`, only when card.topic is set.
// deckImportRunner.ts: CreateCardParams/UpdateCardParams gain `topic?: string`; createParamsFor/updateParamsFor send `topic: optionalText(card.topic ?? null)` (always, like the other optionals, :100-116).
// types/card.ts: `topic?: string | null;` after codeLanguage (:13). api/authoring.ts: createCard/updateCard params gain `topic?: string`; body guard `if (params.topic !== undefined) body.topic = params.topic;` (after realWorldUsage, :406 / :469).
```

#### 2.8.3 Mobile (C07)

```ts
// types/deckExport.ts — CardExport (:15-25) gains, after OrderInDeck (:24):
Topic?: string | null;
// features/gacha/library/topics.ts (new, pure)
export function normalizeTopic(raw: unknown): string | null;         // string → trim, '' → null; anything else → null
export function topicKey(topic: string): string;                    // lowercase, [^a-z0-9]+ → '-', trimmed of '-'; used in testIDs
export const UNTAGGED_TOPIC_KEY = 'untagged';
export const UNTAGGED_TOPIC_LABEL = 'Untagged';
// libraryMapper.ts
export type LibraryCardRow = { …existing…; topic: string | null };   // normalizeTopic(card.Topic), appended last in the row literal (:140-166)
export type LibraryTopicChip = { key: string; label: string; count: number };   // key 'all' | topicKey(topic) | UNTAGGED_TOPIC_KEY
export type LibraryViewModel = LibraryVM & { …existing…; topics: LibraryTopicChip[]; topicFilter: string | null };
export function buildLibraryVM(params: { …existing…; topicFilter?: string | null }): LibraryViewModel;
//  topics = [] when no card has a topic (existing decks: byte-identical VM apart from the two new keys); otherwise
//  [{all}, …one per distinct topic in first-seen deck order…, {untagged} if any card is untagged].
//  cards: when topics.length > 0, rows are ordered by (topic group in chip order, orderInDeck asc) — that is the "grouping";
//  topicFilter (a chip key other than 'all') keeps only that group. `filters` (:238-245) is untouched — the six-key pin at
//  tests/unit/library.test.ts:102-123 and the sheet probes (LibraryHeader.tsx:281-292) stay byte-identical.
// LibraryHeader.tsx: props gain `topics: LibraryTopicChip[]; topicFilter: string | null; onSelectTopic: (key: string) => void;`
//  a second horizontal chip row (testID `library-topic-chip-${key}`) rendered only when topics.length > 0, above the status chips (:240).
// LibraryScreen.tsx: `const [topicFilter, setTopicFilter] = useState<string | null>(null);` passed into buildLibraryVM (:164-175);
//  FlatList `key` (:326) becomes `${numColumns}-${filter}-${topicFilter ?? 'all'}-${selectedSlug ?? 'none'}`. No SectionList, no header rows in `cards` (keyExtractor :404 stays item.stableUid).
```
The install path validators (`deckRepository.ts:877-926`, per-card check `typeof c.stableUid === 'string'` at `:886`/`:907`) and `applyDelta` (`:1169-1200`) already pass unknown keys through whole-object, so the server's `topic` reaches disk untouched; only the two mapper lines of §0 surface it.

### 2.9 MCQ server (C08 → C09)

#### 2.9.1 Canonical shape (all four layers agree — MCQ plan §3.2)

```json
{"v":1,"options":[{"key":"a","why":null,"text":"…","correct":true},{"key":"b","why":"…","text":"…","correct":false}],"shuffle":true,"qualifier":null}
```
Top-level key order `v, options, shuffle, qualifier`; option key order `key, why, text, correct` — this is PG jsonb's order (length, then bytes) so a canonical string survives a PG round trip except for PG's `": "` / `", "` spacing. `qualifier` and each `why` are emitted as explicit `null` when absent; `shuffle` defaults to `true`. Rules: `v === 1`; 3–6 options; `key` ∈ a–f lowercase, consecutive from `a` in stored order, unique; `text` non-empty ≤ 600 chars after trim; `correct` boolean; `requiredCount = count(correct)` ∈ {1,2,3} and < option count; every `correct=false` option has non-empty `why`; `qualifier` (when non-null) non-empty, must appear case-insensitively in the question, and must not match `/choose (two|three)/i`; a question matching `/\(choose (two|three)\.?\)/i` must have requiredCount 2/3 respectively and vice versa. MCQ cards are `difficulty` 1–3.

#### 2.9.2 `src_C/Vpc/Authoring/McqValidation.cs` (C08, pure)

```csharp
public sealed class McqValidationError : Exception { public string Code { get; } public McqValidationError(string code, string message) : base(message) { Code = code; } }
// NOT `: ValidationError` — that class is `public sealed` (src_C/Shared/RecallSmith.Lambda.Common/Validation.cs:8) and src_C/Shared is outside Wave C, so the generic
// `catch (Exception ex) when (ex is ValidationError)` arms never catch it; every handler that canonicalises catches McqValidationError by name FIRST (C08, C09).

public static class McqValidation
{
  /// Validates `raw` against §2.9.1 and returns the canonical compact JSON string in the pinned key order.
  /// `question` null → the two stem checks (MCQ_QUALIFIER_NOT_IN_STEM, MCQ_CHOOSE_N_MISMATCH) are skipped.
  /// Throws McqValidationError with one of: MCQ_BAD_SHAPE, MCQ_BAD_VERSION, MCQ_TOO_FEW_OPTIONS, MCQ_TOO_MANY_OPTIONS,
  /// MCQ_KEY_SEQUENCE, MCQ_DUPLICATE_OPTION_KEY, MCQ_OPTION_EMPTY, MCQ_OPTION_TOO_LONG, MCQ_OPTION_TEXT_DUPLICATE,
  /// MCQ_NO_CORRECT, MCQ_TOO_MANY_CORRECT, MCQ_ALL_CORRECT, MCQ_WHY_MISSING, MCQ_QUALIFIER_EMPTY,
  /// MCQ_QUALIFIER_IS_CHOOSE_N, MCQ_QUALIFIER_NOT_IN_STEM, MCQ_CHOOSE_N_MISMATCH.
  public static string Canonicalize(JsonElement raw, string? question);
  /// Pure helpers used by Cards.cs / Publish.cs gates:
  public static bool IsMcqDifficulty(int difficulty);          // 1..3
  public static bool IsMcqDifficulty(long difficulty);         // same rule; Cards.cs holds difficulty as long? (C08)
}
```
Gate codes raised by the handlers, not by `Canonicalize`: `MCQ_EXPLANATION_REQUIRED` (mcq non-null and `explanation` blank), `MCQ_DIFFICULTY_RANGE` (mcq non-null and effective difficulty ∉ 1..3). `Cards.cs` catches `McqValidationError` **before** the generic `ValidationError` arm (`:183-186`, `:299-302`) and answers `res.BadRequest(ex.Code, ex.Message)` (envelope: `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:145-163`).

#### 2.9.3 `Helpers.cs` + `Cards.cs` (C08)

```csharp
public sealed record UpdateField(string BodyKey, string ColumnName, Func<JsonElement, object?> Transform, string Cast = "");
// BuildUpdateSet (:50-66): fields.Add($"{f.ColumnName} = ${idx++}{f.Cast}");  — every existing spec entry keeps Cast "" (bytes of the emitted SQL unchanged)
/// A jsonb column arrives from DbUtil.QueryAsync as a .NET string in PG text form (DbUtil.cs:24 GetValue; parameters bind
/// via AddWithValue, :63-68). Returns an OWN copy (JsonSerializer.Deserialize<JsonElement>(s)), never JsonDocument.Parse(...).RootElement.
public static JsonElement? JsonbElement(IReadOnlyDictionary<string, object?> row, string key);   // null / absent → null
public static void JsonbCell(Dictionary<string, object?> row, string key);                        // in place: row[key] = JsonbElement(row, key) when the key is present
```
`Cards.cs`: GET select adds `c.mcq` after `c.topic`; POST/PUT RETURNING add `mcq` after `topic`; POST INSERT column `mcq` = `$13::jsonb` (string from `Canonicalize(mcqEl, question)` or null); PUT spec entry `new("mcq", "mcq", v => v.ValueKind == JsonValueKind.Null ? null : McqValidation.Canonicalize(v, effectiveQuestion), "::jsonb")`. PUT pre-check (no transaction, §6 #14): `select question, explanation, difficulty, mcq from cards where id = $1` before `BuildUpdateSet`; effective values = body override ?? stored; apply `MCQ_EXPLANATION_REQUIRED` / `MCQ_DIFFICULTY_RANGE` / stem checks on the effective pair; the existing `expectedVersion` match (`:264-267`, `:290-295`) makes the pre-read safe against a concurrent edit. Every response row passes through `JsonbCell(row, "mcq")` (GET loop, POST/PUT `rows[0]`); `"mcq": null` for Q/A cards.

#### 2.9.4 `CardsPage.cs`, `Publish.cs`, Worker (C09)

`CardsPage.cs:129-147` + `c.mcq` after `c.topic`; rows pass through `JsonbCell` before `res.Ok` (`:97-102`). `Publish.cs:154-168` + `mcq`; `baseCards` (`:180-191`) gains `mcq = Helpers.JsonbElement(c, "mcq")`. **Pre-enqueue gate** (publish only, not `mode=preview`, §6 #14): between `:170` and the duplicate-job check `:221`, for each row with non-null `mcq`: `Canonicalize(elem, question)`, explanation non-blank, difficulty 1..3; first failure → `return res.BadRequest("MCQ_PUBLISH_GATE", $"{stableUid}: {code}")` (code = the `McqValidationError.Code`, or `MCQ_EXPLANATION_REQUIRED` / `MCQ_DIFFICULTY_RANGE`).

```csharp
// IS3DeckUploader.cs — CardExportData: appended after Topic (LAST property; MCQ plan §3.3 "最后一个属性" now means after Topic, §6 #2)
[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
public JsonElement? Mcq { get; set; }
// PublishJobProcessor.cs
public static Task<List<CardExportData>> LoadCardsAsync(NpgsqlConnection conn, int deckId);
//  runs the 11-column SELECT (…, revision, topic, mcq); catch (PostgresException pg) when (pg.SqlState == "42703") → re-runs the
//  10-column 018-only SELECT (…, revision, topic); a second 42703 → the 9-column legacy SELECT (:119-133 on the base) with Topic = null,
//  Mcq = null (precedent ContentArtifactsGenerator.cs:93-96, :108-111). Three steps (C09), so an 018-only database keeps `topic` in its export.
//  Publish.cs (C09): the select is lifted to `internal const string CardsSql` and the gate is `internal static (string StableUid, string Code)? FirstMcqGateFailure(IReadOnlyList<Dictionary<string, object?>> cardRows)`,
//  called once after the `mode == "preview"` return and before the duplicate-job check (tests read rows with `Publish.CardsSql` — PUBLISH_JOB_QUEUE_URL is never set in a test).
//  Mcq = c.TryGetValue("mcq", out var m) && m is string s ? JsonSerializer.Deserialize<JsonElement>(s) : (JsonElement?)null.
// DeckDiff.cs
public static bool McqEquals(JsonElement? a, JsonElement? b);   // both null → true; one null → false; else JsonNode.DeepEquals(JsonNode.Parse(a.GetRawText()), JsonNode.Parse(b.GetRawText()))
// CardChanged: `|| !McqEquals(a.Mcq, b.Mcq)` appended; comment :17 → "11 个卡片字段"
// ContentArtifactsGenerator.cs — PreviousCardDocument: `public JsonElement? Mcq { get; set; }`; MapPreviousCards: `Mcq = c.Mcq,`
```
Export JSON with both: `…,"revision":1,"topic":"t","mcq":{"v":1,"options":[…],"shuffle":true,"qualifier":null}}`; with mcq only: `…,"revision":1,"mcq":{…}}`.

### 2.10 Ingest `card_format` (C10) — `src_C/Vpc/Runtime/ProgressEvents.cs`

The outbox CTE (`:399-447`) gains one payload key and one join, nothing else moves:

```sql
-- inside jsonb_build_object(...), appended after 'deck_version', deck_version   (:442)
'card_format', case when c.mcq is not null then 'mcq' else 'qa' end
-- :444 `from ins` becomes
from ins
left join decks d on d.slug = ins.deck_slug and d.is_deleted = 0
left join cards c on c.deck_id = d.id and c.stable_uid = ins.stable_uid and c.is_deleted = 0
```
"Nothing else moves" has one amendment (C10, verified on postgres:16): with the join, the two unqualified `stable_uid` reads of the outbox select become `ins.stable_uid` (`:407` `deck_slug || ':' || ins.stable_uid,` and `:414` `'card_stable_uid', ins.stable_uid,`), unconditionally, or Postgres answers 42702 (ambiguous column).
(mirror of `ContentIntelligence.cs:131-136`; `uq_cards_deck_uid` in `001_init.sql:52` guarantees ≤ 1 row per event; an unknown card yields `'qa'`.) The SQL is built by `BuildIngestSql(bool withCardFormat)`; execution (`:595`) is `try { withCardFormat: true } catch (PostgresException pg) when (pg.SqlState == "42703") { withCardFormat: false }`. On a migrated database (the test fixture, `IntegrationTestBase.cs:45-53` applies everything) this is still exactly one statement, so `ProgressEventsSingleStatementTests.OneIngest_CostsOneStatement_AndNoTransactionShell` (`:418-449`) stays green and is not edited. Auto-prepare keys on statement text; two texts are two cache entries, fine.

### 2.11 Importer MCQ (C11) and console types/client (C12)

```ts
// frontend/src/types/mcq.ts (C11) — the console's copy of §2.9.1
export interface McqOption { key: string; text: string; why: string | null; correct: boolean }
export interface McqBlob { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }
// frontend/src/lib/mcqRules.ts (C11) — zero imports from cardRules.ts (tests/cardRulesWiring.test.ts:173-196 pins that table)
export type McqIssueCode =
  | 'MCQ_BAD_OPT_LINE' | 'MCQ_QUALIFIER_EMPTY' | 'MCQ_QUALIFIER_IS_CHOOSE_N' | 'MCQ_TOO_FEW_OPTIONS' | 'MCQ_TOO_MANY_OPTIONS'
  | 'MCQ_KEY_SEQUENCE' | 'MCQ_DUPLICATE_OPTION_KEY' | 'MCQ_OPTION_EMPTY' | 'MCQ_OPTION_TEXT_DUPLICATE' | 'MCQ_NO_CORRECT'
  | 'MCQ_TOO_MANY_CORRECT' | 'MCQ_ALL_CORRECT' | 'MCQ_WHY_MISSING' | 'MCQ_WHY_WITHOUT_OPTION' | 'MCQ_FORBIDDEN_OPTION_TEXT'
  | 'MCQ_LETTER_REFERENCE' | 'MCQ_QUALIFIER_NOT_IN_STEM' | 'MCQ_CHOOSE_N_MISMATCH' | 'MCQ_DIFFICULTY_RANGE';   // the 19 of MCQ plan §4.5 + MCQ_DUPLICATE_QUALIFIER below
export const OPT_PAYLOAD = /^[ \t]*([A-Fa-f])[ \t]*(\*)?[ \t]*$/;
export const LETTER_REFERENCE = /\b(?:Option|Answer|Choice)\s+[A-F]\b|\b[A-F]\)\s/;        // uppercase letters only ("answer a question" must NOT match — pinned in tests)
export const FORBIDDEN_OPTION_TEXT = /\b(all|none) of the above\b|\bboth [a-f] and [a-f]\b/i;
export function validateMcq(input: { question: string; explanation: string; difficulty: number; mcq: McqBlob }): Array<{ code: McqIssueCode; message: string }>;
export function normalizeMcqForCompare(mcq: McqBlob | null | undefined): string;   // trim, why '' → null, options sorted by key, `v` dropped, JSON.stringify with sorted keys; null/undefined → ''
// deckImport.ts (C11)
export type ImportIssueCode = … | 'BAD_TOPIC' | 'DUPLICATE_TOPIC' | McqIssueCode | 'MCQ_DUPLICATE_QUALIFIER';
export interface DeckCardContent { …; topic?: string; mcq?: McqBlob }              // ABSENT on Q/A cards (deckImport.test.ts:87-97 toEqual fixture)
export type ComparableField = … | 'topic' | 'mcq';                                   // COMPARABLE_FIELDS order: …, 'realWorldUsage', 'topic', 'mcq'
const OPT_MARKER = /^OPT:(.*)$/; const WHY_MARKER = /^WHY:(.*)$/; const QUALIFIER_MARKER = /^QUALIFIER:(.*)$/;   // loose (§4.4); checked before Q: (:383)
// Section keys widen: type SectionKind = 'question' | 'answer' | 'code' | 'usage' | `option:${string}` | `why:${string}`; a repeated OPT: key is
// MCQ_DUPLICATE_OPTION_KEY (not DUPLICATE_SECTION); a second WHY: for one option is DUPLICATE_SECTION (first wins); OPT: payload not matching
// OPT_PAYLOAD → MCQ_BAD_OPT_LINE at that line, card dropped (never glued to the open section — :420 is the hazard). A card with ≥ 1 OPT: gets `mcq`;
// its validateMcq issues go through validateCards (:460-514) and block via INVALID_CARD (:566-570) — there is no warning tier in Wave C.
// fieldsThatDiffer: 'mcq' compares normalizeMcqForCompare(card.mcq) !== normalizeMcqForCompare(existing.mcq) (server null == file absent == '').
// serializeDeckMarkdown order per card: header, `TOPIC:` (C06), `QUALIFIER: …`, `Q:`+question, `OPT: k` / `OPT: k *` + text, `WHY:` + why (key order), `A:`+explanation, `CODE:`, `USAGE:`.
// deckImportRunner.ts (C11): CreateCardParams/UpdateCardParams gain `mcq?: McqBlob | null`; createParamsFor sends `mcq: card.mcq ?? null`
// (explicit null clears on update, Helpers.cs:58 drops absent keys). Readiness guard: after the FIRST successful write of an action whose
// card.mcq is non-null, if `outcome.data?.mcq` is not a non-null object → push that action and every remaining action into `failures` with
// code SERVER_NOT_READY_MCQ and stop the loop; describeFailure (:135-140) renders 'The server is not ready for MCQ cards (migration 019 / Lambda not deployed); nothing after this card was written.'
// Q/A-only runs never inspect outcome.data (fixtures return data: null, tests/deckImportRunner.test.ts:19-23).
// C12: types/card.ts `mcq?: McqBlob | null;` (import type from './mcq'); authoring.ts createCard/updateCard params `mcq?: McqBlob | null`,
// guard `if (params.mcq !== undefined) body.mcq = params.mcq;` (forwards null). CardListPage.tsx: `<span data-testid="card-mcq-badge">MCQ</span>`
// beside <RarityBadge/> in the Rarity cell (:311-313) when card.mcq; CardForm.tsx: optional prop `mcq?: McqBlob | null` rendering a read-only
// <fieldset data-testid="card-form-mcq"> between RealWorldUsage (:582) and the button row (:584); EditCardPage passes card.mcq, its submit never sends mcq.
```

### 2.12 Content Intelligence + Snowflake (C13)

```csharp
// ContentIntelligence.cs — live fallback (:105-320): event_scored (:106-145) adds `and c.mcq is null` to the where (:141-144), so MCQ answers never
// enter the Q/A baselines; a second scalar query
//   select count(*) from cards c join decks d on d.id = c.deck_id and d.is_deleted = 0
//   left join admin_deck_permissions p on p.deck_id = d.id and p.admin_sub = $2 and p.can_read = 1
//   where c.is_deleted = 0 and c.mcq is not null and ($1::text is null or d.slug = $1::text) and ($3::boolean or p.id is not null)
// feeds summary.mcqCardCount. Both wrapped: catch (PostgresException pg) when (pg.SqlState == "42703") → legacy SQL (today's text), mcqCardCount = 0.
// BuildResponse (:351-370): summary gains `mcqCardCount` LAST. Snapshot SQL (:31-91) unchanged (Phase 5); the count query is branch-independent (reads `cards`) and runs
// inside BOTH branches' try blocks (C13), so the banner is honest when the 90-day snapshot branch is taken — the only edits inside :29-103 are one added line and the extra BuildResponse argument.
```
```ts
// frontend/src/api/authoring.ts ContentIntelligenceData.summary (:653-661) gains `mcqCardCount?: number;` (optional — tests/contentIntelligencePage.test.tsx:127-139 literals compile).
// ContentIntelligencePage.tsx: `<div data-testid="content-intelligence-mcq-banner" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">`
//   rendered between the error banner (:265) and the tile grid (:267), only when (summary?.mcqCardCount ?? 0) > 0, text
//   `${n} MCQ card${n === 1 ? '' : 's'} in scope are not assessed by the Q/A model.`; derived at render time (no setState in an effect, :100-153 lint note);
//   NOT a `section.grid` child (tests/contentIntelligencePage.test.tsx:174-176 selects `section.grid > div`).
```
Snowflake `snowflake/001_content_intelligence_setup.sql` (C13 only):
- `staging.stg_review_events` (`:54-91`): after `app_version` (`:79`) add, in this order,
  `coalesce(src:payload:card_format::string, src:card_format::string, 'qa') as card_format,`
  `coalesce(src:payload:client_features, src:client_features) as client_features,`
  `coalesce(src:payload:update_id::string, src:update_id::string) as update_id,`
  `iff(coalesce(src:payload:card_format::string, src:card_format::string, 'qa') = 'mcq' and coalesce(array_contains('mcq'::variant, coalesce(src:payload:client_features, src:client_features)), false), 'mcq', 'qa') as answer_mode,`
- `staging.card_observations` (`:93-116`): `card_format, answer_mode, client_features, update_id` appended after `app_version` (`:109`) — this extra hop is mandatory (§6 #10).
- `mart_card_quality_daily`: `user_baseline` (`:131-138`) `group by user_id_hash, answer_mode` and its consumer join at `:178` becomes `left join user_baseline ub on ub.user_id_hash = e.user_id_hash and ub.answer_mode = e.answer_mode` (C13 — keeps the join 1:1); `expected_by_difficulty` (`:139-151`) selects `answer_mode` and groups by `event_date, deck_slug, stated_difficulty, answer_mode`; `card_stats` (`:152-180`) selects `e.answer_mode` and adds it to the group by (`:179`); `scored` (`:181-195`) joins `and b.answer_mode = cs.answer_mode`; `content_quality_status` (`:204-220`): a first arm `when answer_mode = 'mcq' then 'MCQ · Not Assessed'`, the other four arms unchanged in text (they are now reached only by `'qa'` rows); `answer_mode` is projected in the final select.
- `mart_card_revision_impact` (`:242-294`): `where answer_mode = 'qa'` on its source; `mart_deck_health_daily` (`:296-313`): `count_if(content_quality_status = 'MCQ · Not Assessed') as mcq_not_assessed_count` appended.
- No local runner exists; C13's verify is non-empty + literal greps (`card_format`, `answer_mode`, `client_features`, `update_id`, `MCQ · Not Assessed`, `answer_mode = 'qa'`). `snowflake/README.md` gains one line: re-run the file after editing (views and dynamic tables are `create or replace`).

### 2.13 Event envelope `clientFeatures` + `updateId` (C14)

Shape, pinned: **`clientFeatures: string[]`** (not an object) — lowercase tokens matching `^[a-z][a-z0-9_-]{0,31}$`, sorted, deduplicated, ≤ 16 entries; **omitted** from the body when empty. **`updateId: string`** — `expo-updates` `Updates.updateId` (lowercase UUID; `mobile/node_modules/expo-updates/build/Updates.d.ts:19`, `null` in dev / disabled); **omitted** when null. Neither is ever sent as JSON `null` (keeps `jsonb_strip_nulls` symmetry and the byte-identity test trivial).

```ts
// mobile/src/sync/clientCapabilities.ts (C14, new, NOT frozen)
export type ClientCapabilities = { clientFeatures?: string[]; updateId?: string };
/** Wave C ships this empty; Wave D appends 'mcq' when flags.mcq.enabled at call time. */
export const CLIENT_FEATURES: readonly string[] = [];
/** Guarded dynamic `import('expo-updates')` inside the function (B00 §9 #13: a static import breaks ≥ 9 unit suites — Updates.js:1-3 pulls
 *  react-native Image and ExpoUpdates.js:5 calls requireNativeModule). Cached after the first resolve; never throws; any failure → {}.
 *  Keys are added only when defined (no undefined-valued keys are ever present either). */
export async function getClientCapabilities(): Promise<ClientCapabilities>;
export function resetClientCapabilitiesForTests(): void;
```

`progressSync.ts` — the four added lines, exact (regexes for the verify):
1. import block (after `:11`): `import { getClientCapabilities } from './clientCapabilities';` — `^\+import \{ getClientCapabilities \} from '\./clientCapabilities';$`
2. after `const deviceId = await getDeviceId();` (`:1485` on the tree): `  const caps = await getClientCapabilities();` — `^\+  const caps = await getClientCapabilities\(\);$`
3. after `clientVersion: getClientVersion(),` (`:1497`): `        clientFeatures: caps.clientFeatures,` — `^\+        clientFeatures: caps\.clientFeatures,$`
4. next line: `        updateId: caps.updateId,` — `^\+        updateId: caps\.updateId,$`

`apiJson` serialises with `JSON.stringify(opts.body)` (`mobile/src/api/apiClient.ts:52`), which drops undefined-valued keys, so a capability-less client sends today's bytes exactly (`deviceId, clientPlatform, clientVersion, events`).

```csharp
// ProgressEvents.cs (C14): after :97 read
//   clientFeatures: body.clientFeatures when ValueKind == Array → distinct string items (non-strings ignored, ≤ 16, each ≤ 32 chars, lowercase) serialised as a JSON array string; else null
//   updateId:       body.updateId when ValueKind == String and non-blank (≤ 64 chars) → trimmed; else null
// two parameters appended after userHashParam (:364-365): featuresParam (string? JSON array), updateIdParam (string?)
// outbox payload keys appended after 'card_format' (C10): 'client_features', {featuresParam}::jsonb, 'update_id', {updateIdParam}::text
// — explicit casts because AddWithValue binds nulls untyped (F7 PreparedStatement_BindsNullAndNonNullParametersAlike, :472-…); null → stripped by jsonb_strip_nulls.
// No users column, no migration, still one statement (F5 :418-449).
```

### 2.14 Docs (C15)

Exact edits (all in top-level docs scanned by `frontend/tests/docsPaths.test.ts`, so every backticked repo path must exist or be registered):
- `docs/mcq-card-type-plan-2026-09-18.md`: `:64` heading and `:415` → `019_cards_mcq.sql`; `:402` "迁移 018" → 019; `:376`, `:406`, `:429` "迁移 019" → 020; **delete** the bullet `src_C/Vpc/Db/Migrations/018_cards_mcq.sql` from the block at `:495-500` (never renumber it); `:375` Phase 3 sentence "card_format + app_version ≥ 1.6.0" → keyed on `client_features` (§2.12); §3.3 "最后一个属性" → "after `Topic`".
- `docs/content-delivery-v3.md`: §Contract card shape (`:30-31`) gains `topic?` and `mcq?` "optional, omitted when null, appended last in that order"; `:50-51` "9 card fields" → 11 + `DeckDiff.McqEquals`; §Deployment (`:111`) "018/019 via the same runner".
- `docs/console-import-plan.md`: rules list (`:41-46`) + field map (`:44-45`) gain `TOPIC:` and `OPT:`/`WHY:`/`QUALIFIER:` with a pointer to the MCQ plan §4.1–4.5; a dated "2026-09 增补" section, not a rewrite (`:16` "服务端零改动" stays as history); §四 (`:81-87`) adds "the two §4.3 example cards import; a re-import is all unchanged".
- `docs/gacha-acquisition-learning-loop-plan.md`: one pointer line after `:29` and one after `:384` to `docs/economy-v2-learn-to-earn-2026-09-19.md` §2. `mobile/gacha-v7.md`: one pointer line after `:94` ("cap 60+5, rules R1–R10").
- `docs/home-review-and-launch-copy-2026-09-17.md`: live marketing copy at `:159`, `:165`, `:275`, `:303`, `:323` → "learn a new card, earn a pull"; `:208` "30+5" → "60+5" and "1 pull per full clear" → "one pull per new card learned"; red-line table row `:413` rewritten to the new rule plus a new row "不能说 full clear +1 / 1 pull per cleared review"; `:39`, `:52`, `:56`, `:57`, `:79-80` are history and stay. The hunk containing `:407` is never touched.
- `docs/delivery-wave-1.6-plan-2026-09-19.md:121` gains the clause "Snowflake `001` re-run by owner".

---

## 3. Test contracts

### 3.1 Existing test files each issue may change (exhaustive) — everything not listed here is byte-identical

**C01**
- `mobile/tests/unit/rewards.test.ts`: cases 4–6 (`:66-80`, the `computeSessionRewardPulls` trio) are deleted with their comment; the cap literals move 30 → 60 in cases 1, 2 and 7 (`:34-52`, `:82-86`: `{59,4}+3 → {60,5}, dropped 1`; `{60,5}+2 → dropped 2`; `{60,4}` true / `{60,5}` false); case 3 (`:54-64`) drops `sessionDone/sessionLimit` reliance and asserts `resolveSessionReward({ …, reward: null }).rewardPulls === 0`; the starter-seeding `describe` (`:92-`) and `persists and deduplicates a session reward application` (`:130-143`) are byte-identical.
- `mobile/tests/unit/summaryMapper.spec.ts`: the four wallet scenarios (`:11-72`) are rewritten to pass `reward` outcomes (0 → 0 with `No free pulls this run`; 12 → 12; 59 → 60 with `+1 pull · 1 new card learned` and `60 ready to use`; 60/5 full with `Free pulls full · 5 pending in reserve`); `maps next-action titles` (`:74-`), `keeps all primary action labels short…` (`:114-`) and the COPY-terms case (`:133-`) unchanged in intent (their inputs gain `reward` where a pull is expected).
- `mobile/tests/unit/summary-home.test.ts`: the three `buildSessionSummaryVM` cases (`:6-52`) are rewritten to the outcome API; the `buildHomeVM` describe (`:54-`) including `:121` is byte-identical.
- `mobile/tests/integration/session-summary.screen.test.tsx`: case 1 (`:88-192`) passes `reward` in params and expects `+1 pull · 1 new card learned` / `1 ready to use`; the wallet-write assertion (`:185-186`) becomes "the wallet is NOT written by the summary"; case 2 (`:194-`) spies `loadRewardWalletState` instead of `applySessionRewardToWallet`; case 3 (`:248-`) resolves that spy instead; cases 4 (`:321`) and 5 (`:363`) byte-identical; every testID unchanged.
- `mobile/tests/integration/session-card.screen.test.tsx`: adds `vi.mock('../../src/features/gacha/rewards/sessionRewards', …)` returning a step with `newCardPaid: true, pulls: 1` for hard+ and the zero step for again; the `toHaveBeenCalledWith('SessionSummary', {…})` literal (`:270-279`) gains `reward: expect.any(Object)`; case `:317` is retitled `settles the rating reward and hands the outcome to Settlement` and expects `rewardPulls: 1`. Nothing else.
- `mobile/tests/unit/session-store.test.ts`: add-only (one case for `recordRewardStep`).
- `mobile/tests/unit/draw.test.ts` (`:69`, `:93`, `:95`: 30 → 60), `mobile/tests/unit/drawStateAdoption.test.ts` (`:97`: 28 → 58; expected `{60,5}`, added 7, dropped 3 unchanged), `mobile/tests/unit/homeSelectors.spec.ts` (`:51`, `:135`, `:239`: `{30,5}` → `{60,5}`), `mobile/tests/integration/home-primary-cta.test.tsx` (`:308-310`: `{60,5}`, `'Wallet full (60 + 5)'`), `mobile/tests/unit/ceremonyTuning.test.tsx` (`:228-239`: 60/5): literal moves only.
- `mobile/tests/p2-smoke.ts` (typechecked by `tsc --noEmit`, not run in CI): `:115-147` reward assertions rewritten to the outcome API; cap literals → 60.
- Byte-identical: `tests/unit/rewardWalletOrdering.test.ts`, `tests/unit/gachaUserScope.test.ts`, `tests/unit/economyFloor.test.ts`, `tests/integration/economy-floor.spec.tsx`, `tests/integration/home-economy-floor.spec.tsx` (C03 later moves one literal at `:221`).

**C02**: `mobile/tests/unit/planner.test.ts` (`:42` 4 → 5, `:65` 2 → 3), `mobile/tests/unit/ownedGatePredicates.test.ts` (`:105` 3 → 4; `:224` stays 2), `mobile/tests/p2-smoke.ts` (`:44` 4 → 5, `:65` 2 → 3); `tests/integration/economy-floor.spec.tsx` (`:511` `'Run 0/2'` → `'Run 0/1'` + its comment `:507-510`) and `tests/integration/owned-gate-entry-points.spec.tsx` (`:375` `(2 cards)` → `(1 cards)` + its comment `:372-374`) — both are direct consequences of the F10 fix and are C02's (`ChallengeScreen.tsx:31` itself stays, §6 #20); `tests/integration/session-card.screen.test.tsx` add-only (one case: the mocked step reports `newCardsLearnedToday: 20` → `session-card-load-forecast` present; 19 → absent). `home.screen.test.tsx:196` (`'Full clear: 2 cards'`, from `buildGoalVM`) is unaffected.

**C03**: `mobile/tests/unit/homeSelectors.spec.ts` `:293` → `'Each new card you learn earns a pull · up to 5 cards a run.'`, `:332` → `'Learn a new card to earn a pull'`; `mobile/tests/integration/home-economy-floor.spec.tsx:221` → `'Learn a new card to earn a pull'` (the seeded card `c1` is new); `mobile/tests/integration/home-primary-cta.test.tsx:283` → `'Learn a new card to earn a pull'`; add-only cases elsewhere. `tests/unit/homeOwnedGate.spec.ts:143` (`masteredApprox === 1`) byte-identical.

**C04**: add-only in `tests/unit/planner.test.ts`, `tests/unit/sessionRewards.test.ts` (R8 case), `tests/integration/library-final.screen.test.tsx` (sweep CTA present when learned > 0, absent otherwise). `tests/unit/session-store.test.ts` untouched.

**C05**: `src_C/Tests/…/ContentSerializationContractTests.cs` add-only (`Card_WithTopic_AppendsTopicLast`; the existing `CardJson` and its six consumers untouched); `DeckDiffTests.cs` add-only (`topic` row in `SingleFieldMutations` `:115-126`, comment "8" → "9"); `CardsPageTests.cs` untouched (its `NewCardAsync` inserts without topic and never reads it).

**C06**: `frontend/tests/deckImport.test.ts` — `contentOf` (`:61-72`) gains `topic: card.topic` **only when defined** (spread `...(card.topic !== undefined ? { topic: card.topic } : {})`) and `cardArb` (`:477-500`) gains `topic: fc.option(topicArb, { nil: undefined })` mapped the same way; the `toEqual` fixture (`:87-97`) and every `it` title byte-identical. `frontend/tests/authoringRequestBody.test.ts`: `topic` added to both "sends every optional field" objects (`:54-80`, `:96-126`) and both "absent" lists (`:89`, `:134`). `frontend/tests/deckImportRunner.test.ts` untouched.

**C08**: none existing (new files only). **C09**: `ContentSerializationContractTests.cs` add-only (`Card_WithTopicAndMcq_AppendsMcqLast`, `Card_WithMcqOnly_OmitsTopic`, PG-shaped input string → compact output per §2.9.4); `DeckDiffTests.cs` add-only (`mcq` mutation row; `Compute_SameMcqDifferentSpacing_IsUnchanged`). **C10**: none existing — `ProgressEventsSingleStatementTests.cs` is byte-identical (§6 #11). **C11**: `frontend/tests/deckImport.test.ts` `cardArb` gains an optional `mcq` branch (mapped only when present) and `contentOf` gains `mcq` the same way; nothing else; `docs/delivery-wave-1.6-plan-2026-09-19.md:229` deleted. **C12**: `frontend/tests/authoringRequestBody.test.ts` — `mcq` in both "sends" objects, both "absent" lists, plus one case proving `mcq: null` is sent as an own key with value `null`. **C13**: `frontend/tests/contentIntelligencePage.test.tsx` add-only (banner shown for `mcqCardCount: 2`, absent for 0/undefined; the six-tile assertion `:266-273` byte-identical). **C14**: `ProgressEventsSingleStatementTests.cs` `Batch()` (`:64-80`) gains two optional parameters defaulting to absent — no assertion changes; every mobile `progressSync*` suite is untouched (they never import `expo-updates`; the new module is dynamic-imported and mocked only by C14's own suites).

### 3.2 New test files and what they must contain

- `mobile/tests/unit/newCardLedger.test.ts` (C01, fast-check): key literal `devcards:u:anon:recallsmith:newCardPullPaidUids:<slug>` pinned exactly (harness: `tests/unit/drawStateAdoption.test.ts:1-49` Map-backed AsyncStorage with `getAllKeys`/`removeItem` + `setActiveUserSubForStorage`); properties: for any sequence of `payNewCardIfUnpaid` calls over any uids, each uid pays at most once; seeding marks exactly the learned uids with 0 and never overwrites a present ledger; `countPaidOnDay` counts only today's positive stamps; adoption unions and clears the anon key, is a no-op signed-out and on a second run.
- `mobile/tests/unit/sessionRewards.test.ts` (C01, fast-check over rating sequences): for any card, `again` never pays; the first `hard|good|easy` pays exactly 1; later ratings pay 0; a pre-OTA learned card (seeded 0) never pays; R2 fires once per local day and only on a `dueBefore > 0 → remainingDueCount === 0` transition; R8 (`newCardEligible: false`) pays 0 for R1 and still fires R2; the ledger write precedes the wallet write (spy order, pattern `tests/unit/rewardWalletOrdering.test.ts:46-53`); a storage failure yields the zero step and no wallet change.
- `mobile/tests/unit/rewardOutcome.test.ts` (C01): `accumulateRewardOutcome` arithmetic and the four `rewardLine` strings verbatim (`+1 pull · 1 new card learned`, `+3 pulls · 3 new cards learned`, `+1 · cleared today's due`, `+4 pulls · 3 new cards learned · cleared today's due`).
- `mobile/tests/unit/loadForecast.test.ts` (C02, fast-check): milestone true iff n ∈ {20, 30, 40, …}; `tomorrowDue` equals `buildUpcoming(...)[1].count`; `forecastLine` null off-milestone; 1 new card `limit === 1` is asserted in `planner.test.ts` (new case `gives a single new card a one-node route`).
- `mobile/tests/unit/homeBatch3.spec.ts` (C03): the three locked labels, the two F9 sublines, `Caught up` kicker conditions, `masteredCount` on `DeckSummary` and `isFullyMastered`, preview node count equals `buildChallengeRoute(...).limit` for (due, new) ∈ {(0,1),(3,2),(1,2)}.
- `mobile/tests/unit/sweepPlanner.test.ts` (C04, fast-check): sweep order is `lastReviewedAt` ascending over owned learned cards (unowned and new excluded), `limit === max(1, min(5, ceil(learned/7)))`, rating in sweep reschedules via `scheduleNextReview` unchanged, `rewardPulls === 0` when no due was cleared.
- `mobile/tests/unit/libraryTopics.test.ts` (C07): `normalizeTopic`/`topicKey`, chip set and order, grouping order, filter, `topics === []` and identical card order for a deck without topics.
- `mobile/tests/unit/deckRepositoryTopic.test.ts` (C07): a raw v1 and a raw flat deck with a `topic` key resolve to `CardExport.Topic`; without it `Topic === null`; a non-string topic → `null`.
- `mobile/tests/unit/clientCapabilities.test.ts` (C14): `{}` when `expo-updates` is unavailable/throws (`vi.doMock('expo-updates', () => { throw … })` and the real module both); `{ updateId }` when mocked with a value; features validation (sort/dedupe/regex/16-cap); cached.
- `mobile/tests/unit/progressSyncEnvelopeBytes.test.ts` (C14, **the golden-bytes test**): harness of `tests/unit/progressSyncDropCounter.test.ts:20-66` plus `vi.mock('../../src/sync/clientCapabilities', …)`; with `getClientCapabilities → {}` the captured push body satisfies `JSON.stringify(body) === JSON.stringify({ deviceId, clientPlatform: 'ios', clientVersion: 'test', events })` — built from the same event fixtures — and `Object.keys(JSON.parse(JSON.stringify(body)))` is exactly `['deviceId','clientPlatform','clientVersion','events']`; with `{ clientFeatures: ['mcq'], updateId: 'abc' }` both keys appear after `clientVersion` and before `events`.
- `frontend/tests/deckImport.topic.test.ts` (C06): `TOPIC:` parse, `BAD_TOPIC` (empty, > 80), `DUPLICATE_TOPIC`, round trip with topic, `changedFields` contains `'topic'` and its position is last, server `null` == absent.
- `frontend/tests/deckImport.mcq.test.ts` (C11, fast-check `mcqArb`): both §4.3 example cards parse to the documented `requiredCount`/keys/qualifier; a mistyped `OPT: g` / `OPT: a Increase…` / `OPT: A)` line is `MCQ_BAD_OPT_LINE` at that line and not glued; every code in `McqIssueCode` has at least one positive case; `LETTER_REFERENCE` does not match "answer a question"; `parse(serialize(x))` deep-equals `x`; re-planning the serialized document against server rows built from it is all `unchanged`; the runner guard stops after the first MCQ write whose echo lacks `mcq` and leaves Q/A-only runs untouched.
- `frontend/tests/cardMcqConsole.test.tsx` (C12, jsdom): badge present/absent; read-only panel present on edit with mcq, absent on new; `EditCardPage` submit body has no `mcq` key.
- `frontend/tests/contentIntelligenceMcqBanner.test.tsx` (C13, jsdom).
- `src_C/Tests/…/CardsAuthoringTopicTests.cs` (C05, DB; pattern `CardsPageTests.cs:66-98` JWT event + direct handler): POST with topic returns `topic`; blank → `null`; > 80 → `VALIDATION_ERROR`; PUT `topic: null` clears; GET/page/preview all carry the key.
- `src_C/Tests/…/McqValidationTests.cs` (C08, pure): canonical string bytes for the §4.3 cards (hand-typed blobs), one negative per code, key-order stability after `JsonSerializer.Deserialize<JsonElement>` of a PG-spaced string.
- `src_C/Tests/…/CardsAuthoringMcqTests.cs` (C08, DB): POST/PUT/GET `mcq` is `ValueKind == Object` (never a JSON string); `MCQ_EXPLANATION_REQUIRED`; `MCQ_DIFFICULTY_RANGE`; PUT `mcq: null` clears; a Q/A PUT without `mcq` leaves it intact.
- `src_C/Tests/…/PublishMcqGateTests.cs` (C09, DB): publish with an invalid stored blob → `MCQ_PUBLISH_GATE`; preview is not gated. `PublishJobProcessorSchemaTests.cs` (C09, DB, scratch database via `IntegrationTestBase.cs:118-128` + `ApplyMigrationsAsync(conn, 18)`): `LoadCardsAsync` on a 018-only schema returns `Topic` set and `Mcq == null` through the 42703 fallback; on the full schema returns the parsed `Mcq`.
- `src_C/Tests/…/ProgressEventsCardFormatTests.cs` (C10, DB): outbox payload has `card_format = 'qa'` for a Q/A card, `'mcq'` for an mcq card, `'qa'` for an unknown card; one statement (reuse the log probe of `ProgressEventsSingleStatementTests.cs:379-397` only if a new probe is needed — prefer asserting through `analytics_event_outbox` as `ProgressEventsIntegrationTests.cs:151` does).
- `src_C/Tests/…/ContentIntelligenceMcqTests.cs` (C13, DB): `mcqCardCount` present and correct; MCQ events excluded from `cards`. `ProgressEventsClientFeaturesTests.cs` (C14, DB): payload carries `client_features` (jsonb array) and `update_id` when sent, neither key when absent, neither when sent as null; one statement.

### 3.3 Property tests required (fast-check is a devDependency in both roots: `mobile/package.json:66`, `frontend` 4.9.0)

C01 (ledger idempotence, pay-once), C02 (milestone arithmetic), C04 (sweep ordering), C06/C11 (`cardArb` round trip), C14 (features normalisation). C05/C08/C09/C10 use xunit `[Theory]` tables.

---

## 4. Dependency edges and merge order

| Issue | deps | why the + edges |
|---|---|---|
| C01 | – | canary (mobile) |
| C02 | C01 | forecast reads `step.newCardsLearnedToday`; shares `SessionCardScreen.tsx` |
| C03 | C02 | Home preview formula must equal §2.5; shares `homeSelectors.ts` |
| C04 | C03, **+C07** | linear mobile chain (`SessionCardScreen.tsx`, `types.ts`, `contracts.ts`, `constants.ts`, `sessionBuilder.ts` all touched earlier); `LibraryScreen.tsx`/`LibraryHeader.tsx` after C07 (§1.1) |
| C05 | – | canary (server) |
| C06 | C05 | console `topic` needs the API to echo it |
| C07 | C05 | mobile `Topic` needs published decks to carry it |
| C08 | C05 | `Cards.cs`/`Helpers.cs`/`IS3DeckUploader.cs` after topic; `Mcq` goes after `Topic` |
| C09 | C08 | `CardsPage.cs`/`Publish.cs`/Worker after both column additions |
| C10 | C08 | `c.mcq` must exist for `card_format` |
| C11 | C06 | importer builds on `TOPIC:` lexer changes and `COMPARABLE_FIELDS` order |
| C12 | C11 | `McqBlob` type from C11; `authoring.ts` after C06 |
| C13 | C10, **+C12** | `authoring.ts` (`mcqCardCount?`) after C12's edit to the same file |
| C14 | C13 | `ProgressEvents.cs` after C10 (via C13); `Batch()` after C10's tests exist |
| C15 | C01, C09, **+C14** | documents the shipped numbers, the envelope keys and the migration names |

Merge order implied: **C01 ∥ C05 → C02, C06, C07, C08 → C03, C09, C10, C11 → C04, C12, C13 → C14 → C15.** Issues in one row may run in parallel worktrees; the driver's `queue.tsv` stays serial and follows this order.

---

## 5. verify.sh conventions (all issues)

Copy `docs/delivery/r16-issues/A02.verify.sh`'s skeleton (`:1-24`): `#!/usr/bin/env bash`, `set -euo pipefail`, `ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"`, `BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"` (the driver exports `BASE=delivery/r16-c-economy`), `MB="$(git merge-base "$BASE_REF" HEAD)"`, `fail()`, numbered `echo "[k/n] …"` steps, and a header comment that starts `# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:` naming exactly why (a missing new file, a missing `it('…'` title, a literal still at 30, a column absent from a select). Step 1 is always the one that fails on base; the baseline gates come later.

- **Scope guard**: `git diff --name-only "$MB" HEAD` ∪ `git ls-files --others --exclude-standard -- <pathspecs>` filtered by an allow-regex built from the issue's §1 row plus `^docs/delivery/r16-issues/`. The untracked scan is pathspec-scoped, never bare (the driver symlinks `mobile/node_modules` and `frontend/node_modules` into the worktree and a symlink is not matched by the `node_modules/` ignore rule): mobile issues scan `mobile/src mobile/tests`; frontend issues `frontend/src frontend/tests docs`; server issues `src_C/Vpc src_C/Worker src_C/Tests src_C/Shared`; C13 adds `snowflake`; C15 `docs mobile/gacha-v7.md snowflake/README.md`.
- **Frozen guard**: `git diff --quiet "$MB" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts` in every issue except C07 (numstat `2	0` on `deckRepository.ts` + the exact-line check of §0; `--quiet` on the other two) and C14 (numstat `4	0` on `progressSync.ts` + the four regexes of §2.13; `--quiet` on the other two).
- **OTA guard** (every mobile issue): `git diff --quiet "$MB" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json`, `grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json`, `grep -Fq '"version": "1.6.0"' mobile/app.json`, `grep -Fq '"vite": "7.2.4"' mobile/package.json`, no `@sentry` under `mobile/src`.
- **Suppression / gutting**: `grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable'` over the issue's files fails; existing `it('…'` titles the issue must keep are grepped with `-F`.
- **Gates**: mobile → `( cd mobile && npx vitest run <the issue's test files> --reporter=dot )` then `( cd mobile && npm run test:typecheck )` (`tsc` at most once); frontend → `( cd frontend && npx vitest run <files> --reporter=dot )` and `npm run lint` are the targeted part, `npm run build` only when the issue touches `src/`; server → `( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~<TestClass>" )` for each new/edited class (xunit substring match), Docker running (`docker info >/dev/null` as a precondition step that `fail`s with a clear message); Snowflake → non-empty + literal greps only. The driver's per-root gate (`npm run test:typecheck && npx vitest run`; `npm run lint && npx vitest run && npm run build`; `dotnet test Tests/RecallSmith.Lambda.IntegrationTests`) runs in addition, so a verify never repeats the whole suite. Total < 5 min for mobile/frontend; server verifies may take longer (one Testcontainers start).
- **docsPaths**: any issue that adds or edits a top-level `docs/*.md` (C11 for the `:229` bullet, C15) runs `( cd frontend && npx vitest run tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot )` when `frontend/node_modules/.bin/vitest` exists, and reproduces the CITATION regex in bash/python for the files it names (B14.verify.sh `:132-171` is the template). C15's allow-list is exactly its §1 file list and the "no top-level docs changed" check of B14 is inverted for it.
- **Banned terms**: `grep -Eiq '<the six terms>'` over the issue's added lines (`git diff -U0 "$MB" HEAD -- <files> | grep '^+' | grep -v '^+++'`), never over whole files that pre-date the wave (C15's launch-copy doc holds one at `:407`).
- Final line `echo "C0N VERIFY OK"`. No `npm install`/`npm ci`/`dotnet restore`/network. No `expo prebuild` in Wave C (nothing native changes).

---

## 6. Contradictions resolved (plan docs vs. tree, doc vs. doc) — decisions binding on every brief

1. **Migration numbers.** MCQ plan §3.1 (`:64`), `:402`, `:415` say `018_cards_mcq.sql`; §7 Phase 5 (`:376`, `:406`, `:429`) says migration 019 for the snapshot table. Tree: latest is `017_cards_keyset_index.sql`. Decision: 018 = `cards.topic` (C05), 019 = `cards.mcq` (C08), Phase 5 = 020 (not in Wave C). C15 renumbers the prose and **deletes** (never renumbers) the registered `018_cards_mcq.sql` bullet at `:499`. The release plan (`docs/release-1.6.0-plan-2026-09-19.md:204`, `:224`, `:231`, `:278`, `:300`) and the wave plan (`:17`, `:109`, `:121`, `:188`) already say 018 topic / 019 mcq.
2. **Where the reward is paid.** Tree pays once, at `SessionSummaryScreen.tsx:65-69` (`computeSessionRewardPulls` + `applySessionRewardToWallet(sessionId, …)`), and derives it a second time in `summaryMapper.ts:179-184`; the wave table gives C01 no `SessionCardScreen.tsx`. R1 pays at the *first hard+ rating of a card*, and a paused run (`SessionCardScreen.tsx:561-566`, `goBack`, no summary) or the route-complete Continue (`:682-690`, no `sessionId`) would otherwise lose pulls. Decision: pay per rating inside `handleRating` (§2.3); the outcome travels as the `SessionSummary.reward` param (§2.4); `computeSessionRewardPulls` is deleted; `applySessionRewardToWallet` stays exported and untouched (three test files pin it) with no app caller; C01's scope gains `SessionCardScreen.tsx`, `drawState.ts`, `drawStateSync.ts`, `DebugMenuScreen.tsx`, `navigation/types.ts`. MCQ plan §3.3's "Mcq is the last property" becomes "after Topic" because C05 lands first.
3. **"Has this card ever been rated hard+" is not derivable from `CardProgress`.** After a first `again` a card is `stage 0, lapses ≥ 1, hardStreak 0, lastReviewedAt > 0` (`model.ts:99-102`, `:127`) — indistinguishable from "hard then again"; `storage.ts:151-189` drops any new field on reload and is frozen. Decision: the R5 ledger is the only source of truth (§2.2); on a partition's first use it is **seeded** with every already-learned card as paid (`0`), so pre-OTA learned cards never pay and pre-OTA first-`again` cards are under-paid by one — bounded, and in the safe direction the codebase already prefers (`rewardWallet.ts:375-394`).
4. **R1 says "跨设备都不重复"; R5 defines the ledger as AsyncStorage-only and `drawStateSync.ts:22-66` syncs owned/pity/wallet only.** Decision: cross-device dedupe is **not** delivered in Wave C; each device seeds its own ledger from synced progress on first use, so the only duplicate is a card learned on device A *after* device B seeded and then rated hard+ on B — bounded by one pull per such card. No server field, no sync change. The R2 day marker is likewise per device and not adopted at sign-in (same as the economy-floor marker today).
5. **R2 scope: per deck or all decks?** Economy-v2 `:27` says "当天所有到期卡"; the session knows one deck. Decision: the trigger is the session deck's `dueBefore > 0 → remainingDueCount === 0` transition; the day marker is global per user, so at most one R2 per local day whatever the deck. Copy stays `+1 · cleared today's due`.
6. **F9/F10/F11 wording (home-review `:56-58`) is full-clear-era copy and cites stale lines.** Doc says `homeSelectors.ts:418, 466, 474` / `:225-228` / `HomeScreen.tsx:557` / `deckActionResolver.ts:206, 241`; tree: `buildHeroCopy` `:419`, subtitles `:467`/`:475`, locked label `:225-228` (text `'Review today’s cards to earn a pull'` — A03 already replaced the economy doc's "Clear today's route to unlock pulls"; economy-v2 `:58` cites a string that is not on the tree), kicker `HomeScreen.tsx:516-524`, mastered `:552-558`, resolver `:205-206`/`:246`. F9's strings "Minimum goal done — the rest of the route earns your next pull." / "Full clear done. Earn tomorrow's pull with tomorrow's route." contradict R1. Decision: the three copy lines of §2.6 replace them; `hero.subline` is VM-only (HomeScreen renders no subline since A02); `selectedMastered` keeps feeding the "Learned" tile (`TodayPressureCard.tsx:61-64`) and only `isFullyMastered` reads the new `masteredCount`; `drawStatusLabel` (`homeSelectors.ts:714-718`, rendered nowhere) is left alone with its two regex pins.
7. **The Home route preview duplicates the planner formula** (`homeSelectors.ts:114-124` vs `sessionBuilder.ts:41-44`); the wave table gives C02 no `homeSelectors.ts`. Decision: C02 changes the planner only; C03 (deps C02) aligns the preview. Between the two merges the integration branch's Home preview may disagree with the session length — accepted, no user build is cut from it.
8. **C04's "Library/Home 入口".** Both `HomeScreen.tsx` (C03) and the primary-CTA tests are dense; a second Home entry point would collide with C03 and A-wave CTA contracts (`home-primary-cta.test.tsx` asserts one `home-primary-cta`). Decision: Wave C ships the sweep entry in Library only (§2.7); a Home entry is deferred.
9. **Who edits Snowflake for `answer_mode`.** MCQ plan §7 Phase 3 (`:375`) keys `answer_mode` on `app_version ≥ 1.6.0`; the release plan (`:206`, `:279`) supersedes with `clientFeatures`/`updateId`; the wave table lists `snowflake/*.sql` under both C13 and C14. Decision: C13 writes the final expression keyed on `client_features` (§2.12) and projects `client_features`/`update_id` columns even though no client sends them yet (absent → `'qa'`); C14 touches server + mobile only and its verify greps C13's expression. The kill-switch case (Wave D `flags.mcq.enabled=false` → feature not advertised) then reads as `'qa'`, which is the honest label.
10. **`staging.card_observations` (`001:93-116`) is a hop the MCQ plan never mentions.** Decision: every new column is added there too (§2.12), or the marts cannot see it. The marts' downstream grain changes are pinned in §2.12 (revision impact filters `'qa'`, deck health adds a count).
11. **One statement per ingest** (`ProgressEventsSingleStatementTests.cs:418-449`, F5) vs the 42703 retry. Decision: the retry is a second statement only when `cards.mcq` is absent, which never holds on the migrated fixture; a design that probes the column first is forbidden. C10 does not edit that test file; C14 edits only `Batch()`.
12. **`docs/delivery-wave-1.6-plan-2026-09-19.md:229` registers `frontend/tests/deckImport.mcq.test.ts` as not-on-disk; C11 creates that file**, so C11's own frontend gate (`docsPaths.test.ts:169-184`, rule b) would go red. Decision: C11 deletes that one bullet in the same PR (its scope gains that doc) and runs the docsPaths test in its verify. Likewise the economy doc's citation of this file (`:3`) is satisfied by the wave setup commit that adds C00.
13. **Publish preview vs byte identity.** `Publish.cs` `baseCards` (`:180-191`) is an anonymous type, so the preview export shows `"topic": null` / `"mcq": null` on Q/A cards while the Worker omits them. Decision: accepted — the preview is a console read, not the S3 artifact; byte identity is asserted on `CardExportData` only.
14. **MCQ plan §3.1 asks for a PUT "in a transaction … rollback".** `Cards.cs` has no transaction anywhere (`DbUtil.QueryAsync(conn, null, …)` at `:180`, `:289`) and `expectedVersion` is required (`:206-215`). Decision: a pre-read + effective-value check before the UPDATE; the optimistic version match makes it race-safe. The pre-enqueue gate applies to publish only, not `mode=preview`.
15. **`DeckCardContent` location and `orderInDeck` line.** MCQ plan §3.7 puts `DeckCardContent.mcq?` in `frontend/src/types/card.ts`; tree declares it at `frontend/src/lib/deckImport.ts:36-44` (`types/card.ts` holds only `Card`, 23 lines). §4.4's ":421" is `:420` (`currentSection.lines.push(raw.trimEnd())`). §4.2 `:258`/`:521` and §4.6 `:518-526` match. Decision: as §2.11; the shared blob type lives in the new `frontend/src/types/mcq.ts` (unscanned by `tests/apiSurfaceCensus.test.ts:72-77`, which counts exports of `authoring.ts`).
16. **`Cards.cs` line drift.** MCQ plan §3.1 cites `:127` for nullable explanation and `:240` for PUT null; tree is `:126` and `:241`; `:105-111` and `:247` match. `ProgressEvents.cs` outbox CTE: doc `:400-443`, tree `:399-447`; `content_quality_status`: doc `:204-218`, tree `:204-220`. Economy-v2 R6 cites `sessionBuilder.ts:41` — matches (the survey note claiming `:42` was wrong).
17. **Static `import 'expo-updates'` would break ≥ 9 mobile unit suites** (no suite mocks it; `Updates.js:1-3` imports react-native `Image`, `ExpoUpdates.js:5` calls `requireNativeModule`). Decision: §2.13 — guarded dynamic `import()` inside a function in a new non-frozen module, per B00 §9 #13; the frozen file gains only the four lines.
18. **`clientFeatures` shape.** Release plan and economy-v2 name the field without a type. Decision: `string[]` (§2.13); server stores it as a jsonb array in the payload; Snowflake tests membership with `array_contains('mcq'::variant, client_features)`.
19. **`tests/p2-smoke.ts` is already inconsistent with the tree** (`:145` expects 1 pull for 1/4 while `computeSessionRewardPulls` returns 0) and is not in CI, but `tsc --noEmit` compiles it. Decision: C01/C02 keep it compiling and move its literals; nobody is required to make it pass at runtime.
20. **Old-rule copy that survives Wave C.** `ChallengeScreen.tsx:31` ("+2 free pulls", pinned by `tests/integration/owned-gate-entry-points.spec.tsx:375`, screen skipped by Home `HomeScreen.tsx:352-356`), `libraryMapper.ts:216` (due-first is still true under R2), `DrawScreen.tsx:843`, `DrawResultScreen.tsx:222` are left untouched; C15 does not cite them. `summaryMapper.ts` keeps `'No free pulls this run'` and the full-run titles.
21. **The wave table's C01 verify says "每 uid 只付一次、Again 首见不付、重发 Hard+ 才付"** — that is §3.2's `sessionRewards.test.ts`; "SessionSummary 接线" is §2.4. The table's `sessionStore.ts` mention is the `rewardOutcome` accumulator, not a store-based summary (the store resets on unmount, `SessionCardScreen.tsx:136-140`).
22. **Sentry.** Any plan sentence naming Sentry / `src/observability/` is out (B00 §0, 2026-09-20 scope change); Wave C adds none.
23. **`JSX.Element`** in any mobile signature is `React.JSX.Element` or omitted (B00 §9 #19; `@types/react` 19.1 has no global `JSX` namespace).

### 2026-09-21 review addendum (post-C01 review of `newCardLedger.ts` / `sessionRewards.ts`; branch `fix/r16c-ledger-seed`)

Two findings changed the §2.2/§2.3 semantics; the signatures above are unchanged and the outcome type grew one optional field. Where the prose above says "present ⇒ seeded" or "seeds on first use", this addendum wins.

1. **"Seeded" is an explicit marker, not the ledger key's presence.** `adoptAnonNewCardLedger` writes the user-partition ledger key (union of the anon uids) at sign-in, before the user partition has ever settled a rating; under "present ⇒ seeded" `seedNewCardLedgerIfAbsent` then never backfilled the account's already-learned cards, so every pre-OTA learned card paid R1 on its next hard+ after sign-in (review finding A, repro `mobile/tests/unit/ledgerSeedRace.test.ts`). Decision: a per-partition, per-slug marker `recallsmith:newCardPullSeeded:<slug>` through the same `getUserScopedKey` helper (`NEW_CARD_LEDGER_SEEDED_PREFIX`, value `{ seededAtMs, backfilled }`, informational — its presence is the fact; an unreadable value still reads as seeded). Seeding = union the backfill (every learned uid → `0`) **into** whatever ledger entries already exist (an existing paidAt is never overwritten), write the ledger, then write the marker (ledger first; a kill between the two replays an idempotent union). `adoptAnonNewCardLedger` keeps unioning anon uids into the user ledger, never creates or implies the user marker, and removes the anon marker before the anon ledger key (copy-then-clear, so a later signed-out period re-seeds from its own progress instead of paying adopted cards twice). Consequence for §2.2's corrupt-value rule: a corrupt ledger **with** the marker stays `{}` and is never re-seeded (as before); a corrupt ledger **without** the marker is replaced by the backfill on the next settled rating (safe direction). `readNewCardLedger().present` now describes the key only; `readNewCardLedgerSeed(slug)` is the seeded-ness read.
2. **Seeding and R1 require settled progress for the active partition.** `sessionRewards.ts` seeded permanently from whatever local progress existed at the first rating; on a new device / reinstall that seed could run before the first remote progress pull landed (or after it failed), so later-arriving learned cards paid (review finding B). Decision (`mobile/src/features/gacha/rewards/progressSettled.ts`): anon partition → always settled; signed in → settled only once this device has completed at least one successful remote progress pull for this user. `progressSync.ts` is frozen and exports no such getter (`_lastPullAtMs` is module-private; `sync:last:v1` is written even when the pull threw or was skipped, so it would settle an offline sign-in), so the signal is the presence of the per-user keys the frozen file writes **only** after a pull page came back and was applied: `sync:remoteCache:v1:<slug>` (the cache `applyCachedRemoteProgress` reads) or `sync:cursorMs:v1` / `sync:cursor:v2` (advanced only after success). Read-only; the names are pinned by `sessionRewards.test.ts`. When not settled: no seed, no R1 (R2 unaffected), `settleRatingReward` returns `newCardPaid: false` with the additive `skipped: 'progress-unsettled'`; the next rating after the pull lands seeds normally and pays that card if it is genuinely new. The `ZERO_REWARD_STEP` storage-failure path now carries `skipped: 'storage-error'`. Accepted under-pay: cards rated on a signed-in partition before its first pull with rows are backfilled as `0` when it lands (an account with no rows on the server leaves no trace after an empty pull, so its first session's cards fall in this window); never over-pay. §6 #4's cross-device bound is unchanged.
3. Also in the same branch: the R7 forecast line travels to `SessionSummary` as the optional route param `loadForecast?: string` when the milestone rating ends the run (rendered under the reward card, testID `session-summary-load-forecast`; §2.4's "ONE optional field" is now two, appended last); `topicKey` (§2.8.3) falls back to `t-` + 8-hex FNV-1a of the normalised label when the slug is empty and appends the hash when a non-ASCII character was dropped, so ASCII labels keep their keys.
