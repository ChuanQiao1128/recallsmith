# F05 — r24b review fixes: store texts and 2.0.0 (fixes ledger)

Issue #683, round r24bx, wave r. Base `delivery/r24bx-r`. Contract `~/.rimv-delivery/r24b-common/R24B-00-contracts.md` §1, §2, §4.
I checked every finding against the code before changing anything. The tests were committed first (d3a7034) and
failed on the base. The fixes came after (8ed32e3 and the docs commit). The exception is r-tests-2, which covers
behaviour that was already correct (see below).

### r-correctness-1
Status: fixed
- Confirmed. `README.md:16` and the `ota.sh` header (lines 5-6) said "runtime-1.9.0 OTAs from main". `git branch -a` shows no `release/1.9.x`, only `origin/release/1.6.1`, `release/1.8.0` and `release/1.8.x`.
- Fix:
  - The README guard row and the `ota.sh` header now say: runtime-1.8.0 from `release/1.8.x`, runtime-1.9.0 from `release/1.9.x`, runtime-2.0.0 from `main`.
  - The README's 2.0.0 note says the branch does not exist yet, and that the owner must cut it from the last 1.9.0 commit (the parent of the version-bump commit) before 2.0.0 merges.
  - R01 owner step 5 now has the same step.
  - This worker cannot create or push branches (round rules), so cutting the branch stays an owner step.
- Files: `mobile/scripts/release/README.md`, `mobile/scripts/release/ota.sh` (comment only, no behaviour change), `docs/delivery/r24b-issues/R01-notes.md`.
- Test: `tests/unit/otaReleaseScript.test.ts` › "ota.sh dual-runtime branch rule". Both cases failed on the base.

### r-correctness-2
Status: fixed
- Confirmed. The starter pack is not bootstrapped while the lesson is open (`deckWallet.ts` `ensureDeckBootstrap`, R22 §4 comment). Its 3 draws arrive only when the lesson ends (`starterGate.ts` header comment). Every other pack gets `DECK_BOOTSTRAP_GRANT = 3` once. So "Every pack gives 3 draws the first time you open it" read as 3 + 3.
- Fix: the description bullet now says "Every other pack gives 3 draws the first time you open it." What's New and the review notes only mention the lesson's 3 draws, so they were already right.
- Files: `mobile/scripts/release/description-2.0.0.txt`.
- Test: `tests/unit/whatsNew200.test.ts` › "the starter pack reads as 3 draws in total, not 3 + 3". It checks for exactly two "3 draws" and no "Every pack gives".

### r-correctness-3
Status: fixed
- Confirmed. `NEVER` used `exam simulator(?! *\.)`, so any sentence ending in "exam simulator." passed.
- Fix: `NEVER` now matches a plain `exam simulator`. `withoutDisclaimer()` removes only the exact §2 sentence before the check.
- Files: `mobile/tests/unit/whatsNew200.test.ts`.
- Test: `whatsNew200.test.ts` › "the guards catch a claim or a jargon word that ends a sentence". "DeveloperCards 2.0 works like a real exam simulator." and "Use DeveloperCards as your exam simulator." are caught; the disclaimer alone passes. With the old regex this case fails.

### r-security-1
Status: fixed
- Confirmed. `docs/release-1.9.0-monitoring.md` §2 covers only Sentry and account data. `docs/privacy-anonymous-funnel-2026-10-02.md` has the App Privacy mapping (§8), the 30-day access-log note (§6) and the policy paragraph ready to paste (§9).
- Fix: R01 owner step 4 is now a required pre-submit step. It must be done before 2.0.0 is submitted, and in any case before `features.anonFunnel.enabled` is turned on. It points at the funnel doc.
- Deviation from the reviewer's wording: the reviewer suggested "Usage Data, not linked". The step follows the funnel doc's §8 mapping instead: Usage Data › Product Interaction, with Analytics among its purposes. That entry stays "linked" because of synced study progress, and no new data type is needed. I followed the authoritative privacy doc rather than restating the mapping.
- Files: `docs/delivery/r24b-issues/R01-notes.md`.
- Test: docs-only, no code path. The owner step is a manual App Store Connect / Notion action.

### r-tests-1
Status: fixed
- Same defect as r-correctness-1 (README guard row and `ota.sh` header against the 2.0.0 note; missing `release/1.9.x`). The same change and tests fix it.
- Files: `mobile/scripts/release/README.md`, `mobile/scripts/release/ota.sh`, `docs/delivery/r24b-issues/R01-notes.md`.
- Test: `tests/unit/otaReleaseScript.test.ts` › "ota.sh dual-runtime branch rule".

### r-tests-2
Status: fixed
- Confirmed as a coverage gap. Every `runOtaTree` case used 1.8.0 or 1.9.0.
- Fix: new suite "ota.sh at runtime 2.0.0" with two cases:
  - 2.0.0 without `EXPO_PUBLIC_SENTRY_DSN` exits 3, and no RNSentry guard message appears.
  - 2.0.0 with every name passes the guard, prints `runtime=2.0.0` and plans the publish and `SENTRY_UPLOAD=ok-planned` under `DRY_RUN=1`.
- `ota.sh` itself is correct, so these cases pass on the base. To prove they guard the claim, I ran a mutation: I changed the GE190 check to `b >= 9` (minor number only). Both 2.0.0 cases failed. I then restored the script.
- Files: `mobile/tests/unit/otaReleaseScript.test.ts`.
- Test: `otaReleaseScript.test.ts` › "ota.sh at runtime 2.0.0".

### r-tests-3
Status: fixed
- Same defect as r-correctness-3. The same `withoutDisclaimer()` + plain `exam simulator` change fixes it. "Use DeveloperCards as your exam simulator." is now one of the self-test samples.
- Files: `mobile/tests/unit/whatsNew200.test.ts`.
- Test: `whatsNew200.test.ts` › "the guards catch a claim or a jargon word that ends a sentence".

### r-tests-4
Status: fixed
- Confirmed. `JARGON` was only pulls/pity/gacha/readiness, and `NEVER` was applied only to the description, while R01-notes claimed wallet/reserve coverage.
- Fix:
  - `JARGON` now covers `pulls?|pity|gacha|readiness|wallet|reserve|runs?|boss|elite|full clear|ceremony|route|momentum`.
  - A new `it.each` applies `JARGON` and `NEVER` (after removing the disclaimer) to all six 2.0.0 files.
  - The self-test checks that "Your draw wallet holds 60 draws." and "Thousands of cards, also on Android." are caught.
  - The current texts already pass the wider guard, so no text change was needed for this finding.
  - R01-notes now says what the test enforced as first shipped and what F05 widened.
- Files: `mobile/tests/unit/whatsNew200.test.ts`, `docs/delivery/r24b-issues/R01-notes.md`.
- Test: `whatsNew200.test.ts` › "%s uses plain words only and has no claim from the never list" and the guard self-test.

## Supervisor items

All applied word for word. Each one is pinned in `whatsNew200.test.ts`; those tests failed on the base.
- **Description:**
  - The new first line.
  - "No repeat draws: a card you have drawn never comes up again."
  - "spot-checked by the developer" dropped.
  - "If a card looks wrong, sign in and tap Report a problem under its answer."
- **Promo:** "No repeat draws, never sold." The promo is 150 characters, within the 170 limit.
- **What's New:** "Rebuilt .NET & C# Interview deck (it replaces the old C# / .NET deck): …".
- **Review notes, items (a)–(e):**
  - (a) The demo-account sentence now includes card reports and Me > My reports. The test that pinned the old sentence as identical to 1.9.0 now pins the new 2.0.0 sentence and still checks that 1.9.0 keeps its own.
  - (b) The rebuilt-deck sentence. The rest of the old list now follows as "2.0.0 also adds FSRS review scheduling, …".
  - (c) The Library / Show answer report path.
  - (d) The Sentry sentence. The old "or other identifiers" claim is gone, and the kill-switch clause is its own sentence.
  - (e) The milestone wording for the usage counts.
- No credential or demo login appears in any file. The demo login lives only in App Store Connect.

## Gates

From `mobile/`: `npx tsc --noEmit`, `npm run test:typecheck`, `npx vitest run`. The F05 verify script was also run (results in the run report).

## Base gate repair (not a reviewer finding)

On the base `delivery/r24bx-r`, `tests/unit/plainWordsGuard.test.ts` › "keeps PENDING honest" failed every time:
`features/gacha/draw/ceremonyCopy.ts: expected [] to not deeply equal []`. W01–W03 (#669–#671) have merged and
cleaned all five PENDING modules, and the test asks for them to leave the list once clean. PENDING is now empty,
so the guard covers all five modules with their own "uses plain words" case (15 cases, all green). This only adds
coverage: no allow-list entry or regex was widened. Without it the mobile root gate cannot pass.
