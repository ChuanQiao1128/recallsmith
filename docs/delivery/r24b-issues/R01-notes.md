# R01 — 2.0.0 (24): version bump, photo-permission text, App Store texts, release README

Issue #673, round r24b, wave r. Contract `~/.rimv-delivery/r24b-common/R24B-00-contracts.md` §1, §2, §4.

## What changed (files)

| File | Change |
|---|---|
| `mobile/app.json` | `version` 1.9.0 → 2.0.0, `ios.buildNumber` 23 → 24, `NSPhotoLibraryAddUsageDescription` "…saves a pull card image…" → "…saves a card image…" (rest of the sentence unchanged) |
| `mobile/package.json` | `version` 2.0.0 |
| `mobile/package-lock.json` | root `version` and `packages[""].version` 2.0.0 (no dependency change) |
| `mobile/scripts/release/description-2.0.0.txt` | new (3,950 UTF-16 chars; body before PREMIUM SUBSCRIPTION 2,989) |
| `mobile/scripts/release/keywords-2.0.0.txt` | new (96 chars) |
| `mobile/scripts/release/promo-2.0.0.txt` | new (152 chars) |
| `mobile/scripts/release/subtitle-2.0.0.txt` | new: `Dev interview & exam cards` (26 chars) |
| `mobile/scripts/release/whats-new-2.0.0.txt` | new |
| `mobile/scripts/release/review-notes-2.0.0.txt` | new, from `review-notes-1.9.0.txt` |
| `mobile/scripts/release/README.md` | typical run is 2.0.0 (24) with the 2.0.0 text files; rows for `whats-new-<v>` and keywords/promo/subtitle; a note on the 2.0.0 OTA runtime |
| `mobile/tests/unit/releasePlumbing190.test.ts` | version block now pins 2.0.0 (24) and the plain photo-library text |
| `mobile/tests/unit/storeSubscriptionMetadata.test.ts` | new 2.0.0 block (EULA, Privacy, auto-renew, ≤ 4000; review notes point at the paywall) |
| `mobile/tests/unit/whatsNew200.test.ts` | new |

## Surface shipped

- **Description**: sections WHAT'S INSIDE / HOW DRAWS WORK / HOW STUDY WORKS / OFFLINE AND ACCOUNT / FROM ONE DEVELOPER, using only §4 facts and §1 words (draws, saved draws, extra draws waiting, "a rare card is guaranteed"; no pull, pity, wallet, reserve, gacha, readiness). Then the PREMIUM SUBSCRIPTION block and the Terms of Use / Privacy Policy lines, copied byte for byte from 1.9.0. Then the two §2 lines: "Not official exam material and not an exam simulator." and the Amazon / Anthropic / Microsoft trademark line.
  - Gone from 1.9.0: "OFFLINE, NO ACCOUNT NEEDED", "checked by me", "every card records its source" (now "Many cards show their source"), the 7-stage ladder (now FSRS, max 90 days, Mastered at 15+ days), "seeded and replayable", the 81-card C# deck.
  - The 1.9.0 rarity line ("Rarity is difficulty") was dropped because §4 does not list it.
- **Keywords**: `fsrs,flashcards,csharp,dotnet,interview,srs,spaced,repetition,exam,cloud,architect,certification`. Dropped: gacha, quiz, study.
- **Promo**: "Free .NET & C# interview, AWS SAA-C03 and Claude Developer Foundations decks. Learn a new card, earn a draw, open a pack. Never a duplicate, never sold."
- **What's New**: headed "DeveloperCards 2.0". Covers the new .NET 8 / C# 12 deck with multiple-choice, the study-then-check first lesson ending in 3 draws, the first lesson offline, Progress by domain, FSRS, plainer words, the Settings › Privacy switch for anonymous usage counts you can turn off, and stability. No mention of crash data.
- **Review notes**:
  - Line 1 now says new users pick a goal and take a 5-card starter lesson that ends with 3 draws, and that the first launch works offline.
  - The Report a card paragraph gives both paths: "Report a problem" on the card's page, or "Report" on the recall check after you reveal the answer. It also notes that a new card's first study view has no Report button.
  - New paragraph on the anonymous usage counts setting.
  - The demo-account sentence ("The demo account above is needed only for cloud sync and to buy or restore Premium.") and the Premium/Sentry paragraphs are unchanged except "new in 1.9.0" → "since 1.9.0".
  - No credentials appear in any file. The demo login lives only in App Store Connect.

## How it is tested

- `tests/unit/releasePlumbing190.test.ts`: app.json 2.0.0 / 24, package.json and both lockfile versions 2.0.0, the exact new photo-library sentence and no "pull" in it.
- `tests/unit/whatsNew200.test.ts`:
  - Length limits for all six files, plus no email address.
  - The description and promo match none of `/\b(pulls?|pity|gacha|readiness)\b/i`. The promo also has no pull/rip/dupe.
  - The description has all five headings and both §2 disclaimer lines verbatim. It contains none of the §4 never-claims, its body stays ≤ 3,150, it states the key §4 facts, and its Premium block is byte-identical to 1.9.0.
  - Keywords have no spaces, include fsrs and flashcards, and have no gacha or trademark. The subtitle mentions interview and exam.
  - What's New: the facts are present, and "anonymous" appears only in "anonymous usage counts", with no crash wording.
  - Review notes: no pull(s), "3 draws", first launch offline, both Report paths, and the demo-account sentence identical to 1.9.0.
  - The README's typical run is 2.0.0 (24) with all 2.0.0 files.
- `tests/unit/storeSubscriptionMetadata.test.ts`: the 2.0.0 description and review notes, same checks as 1.9.0.
- The tests were committed first and failed on the base (20 failures), then passed after the change.
- Gates (from `mobile/`): `npm run test:typecheck`, `npx vitest run`.

## Owner steps

1. Before building, confirm in production that all three decks are free and that the C# deck's title is ".NET & C# Interview" (facts-store §1, "Needs a production check"). The description and promo say "Three free decks" and "nothing premium to unlock yet".
2. Confirm the `cardReport` remote flag is on. The description and review notes describe Report a card.
3. Build and submit by following `mobile/scripts/release/README.md`, "Typical run for 2.0.0 (24)". This change did not run any build, submit or asc script.
4. App Privacy: the anonymous usage counts (R24 M01) may need an App Privacy answer before submission. Check `docs/release-1.9.0-monitoring.md` §2.
5. After 2.0.0 is built, OTAs from `main` reach only 2.0.0. Send 1.9.0 hotfixes from a `release/1.9.x` checkout through `ota.sh`.

## Deferred

- The landing page (`site/index.html`) still has old deck counts. It is outside this scope.
- `ota.sh` still names 1.9.0 as its Sentry threshold. That is correct for 2.0.0 (numeric compare), so nothing changed there.
